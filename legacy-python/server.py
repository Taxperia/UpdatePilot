# -*- coding: utf-8 -*-
"""UpdatePilot web arayüzü sunucusu.

Yalnızca 127.0.0.1 üzerinde çalışır; statik dosyaları (web/) ve JSON
API uç noktalarını sunar. Uzun işler (tarama, kontrol, indirme) arka
plan iş parçacıklarında yürür; arayüz /api/state'i yoklayarak ilerlemeyi
görür.
"""
import csv
import io
import json
import os
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import github_api
import notify
import scanner
import storage
from versioning import compare, is_newer

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

STATUS_LABELS = {
    "ok": "Güncel",
    "update": "Güncelleme var",
    "ignore": "Yoksayıldı",
    "nomatch": "Eşleşme yok",
    "error": "Kontrol edilemedi",
    "unknown": "Sürüm bilinmiyor",
}

ASSET_EXTS = (".exe", ".msi", ".msix", ".zip", ".appinstaller")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
}


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S")


def pick_asset(assets):
    if not assets:
        return None
    for a in assets:
        if a["name"].lower().endswith(ASSET_EXTS):
            return a
    return assets[0]


class AppState:
    """Sunucunun tüm durumu: ayarlar, satırlar, işler."""

    def __init__(self, on_shutdown):
        self.cfg = storage.load_config()
        storage.ensure_dirs()
        self.on_shutdown = on_shutdown
        self.lock = threading.RLock()
        self.programs = []
        self._manual_rows = []
        self.scan_running = False
        self.check_running = False
        self.progress_msg = "Hazır"
        self.check_summary = None
        self.downloads = {}          # ad -> {"msg": str, "running": bool}
        self.last_heartbeat = time.time()
        self._auto_checked = False
        self.rebuild_manual_rows()

    # ---------------- satırlar ----------------

    def rebuild_manual_rows(self):
        rows = []
        for entry in self.cfg["manual"]:
            rows.append({
                "key": "m:" + str(entry.get("id")),
                "name": entry.get("name", ""),
                "version": entry.get("version", ""),
                "publisher": "(manuel paket)",
                "date": (entry.get("added") or "")[:10],
                "location": "",
                "repo": entry.get("repo", ""),
                "url": entry.get("url", ""),
                "latest": entry.get("latest", ""),
                "notes": entry.get("notes", ""),
                "status": entry.get("status", "unknown"),
                "latest_url": entry.get("latest_url", ""),
                "note": entry.get("note", ""),
                "checked": entry.get("checked", ""),
                "is_manual": True,
                "entry": entry,
            })
        self._manual_rows = rows

    def all_rows(self):
        return self.programs + self._manual_rows

    def get_row(self, key):
        for p in self.all_rows():
            if p["key"] == key:
                return p
        return None

    def _is_ignored(self, name, version):
        ignored = self.cfg["ignored"].get(name, "")
        return bool(ignored) and compare(ignored, version) == 0

    # ---------------- tarama ----------------

    def start_scan(self):
        if self.scan_running:
            return False
        self.scan_running = True
        include_user = self.cfg["settings"].get("include_user_scope", True)

        def work():
            try:
                progs = scanner.scan_installed(include_user=include_user)
                self._apply_scan(progs)
            except Exception as e:
                self.progress_msg = "Tarama hatası: " + str(e)
                storage.append_history("hata", "Tarama", str(e))
            finally:
                self.scan_running = False

        threading.Thread(target=work, daemon=True).start()
        self.progress_msg = "Programlar taranıyor…"
        return True

    def _apply_scan(self, progs):
        old = {p["key"]: p for p in self.programs}
        rows = []
        for d in progs:
            name = d["name"]
            repo = self.cfg["repos"].get(name, "")
            prev = old.get(name)
            row = dict(d)
            row["key"] = name
            row["repo"] = repo
            if prev and repo:
                for f in ("status", "latest", "latest_url", "note", "checked"):
                    row[f] = prev.get(f)
            row["status"] = row.get("status") or (
                "unknown" if not d["version"] else "nomatch")
            if not repo:
                row["latest"] = ""
                row["latest_url"] = ""
            rows.append(row)

        with self.lock:
            known = self.cfg["known"]
            for row in rows:
                prev = known.get(row["name"])
                if (prev and prev.get("version") and row["version"]
                        and compare(row["version"], prev["version"]) != 0):
                    storage.append_history(
                        "program_guncellendi", row["name"],
                        f'{prev["version"]} → {row["version"]}')
                known[row["name"]] = {
                    "version": row["version"],
                    "latest": (prev or {}).get("latest", ""),
                    "ts": now_iso(),
                }
            self.cfg["last_scan"] = now_iso()
            storage.save_config(self.cfg)

        self.programs = rows
        self.progress_msg = f"{len(rows)} kurulu program bulundu."
        self._maybe_auto_check()

    def _maybe_auto_check(self):
        if self._auto_checked or not self.cfg["settings"].get("auto_check", True):
            return
        self._auto_checked = True
        if (any(p.get("repo") for p in self.all_rows())
                or any(m.get("repo") or m.get("url") for m in self.cfg["manual"])):
            self.start_check()

    # ---------------- güncelleme kontrolü ----------------

    def start_check(self, keys=None):
        if self.check_running:
            return False
        rows = self.all_rows()
        if keys:
            targets = [p for p in rows if p["key"] in keys]
        else:
            targets = [p for p in rows if p.get("repo")
                       or (p.get("is_manual") and p.get("url"))]
        if not targets:
            self.progress_msg = ("Kontrol edilecek eşleşme yok — önce programlara "
                                 "GitHub deposu atayın.")
            return False
        self.check_running = True
        token = self.cfg["settings"].get("token", "").strip()
        skip_pre = self.cfg["settings"].get("skip_prerelease", True)

        def work():
            updates = errors = 0
            for i, p in enumerate(targets, 1):
                self.progress_msg = f"Güncellemeler kontrol ediliyor… {i}/{len(targets)}"
                res = self._check_one(p, token, skip_pre)
                p.update(status=res["status"], latest=res["latest"],
                         latest_url=res["latest_url"], note=res["note"],
                         checked=now_iso())
                if p.get("is_manual"):
                    p["entry"].update(status=res["status"], latest=res["latest"],
                                      latest_url=res["latest_url"],
                                      note=res["note"], checked=now_iso())
                    with self.lock:
                        storage.save_config(self.cfg)
                updates += int(res["status"] == "update")
                errors += int(res["status"] == "error")
            summary = {"total": len(targets), "updates": updates,
                       "errors": errors, "ts": now_iso()}
            self.check_summary = summary
            with self.lock:
                self.cfg["last_check"] = summary["ts"]
                storage.save_config(self.cfg)
            self.check_running = False
            self.progress_msg = (f"Kontrol tamamlandı: {summary['total']} program "
                                 f"denetlendi, {summary['updates']} güncelleme, "
                                 f"{summary['errors']} hata.")
            if summary["updates"] > 0 and self.cfg["settings"].get("toasts", True):
                names = [p["name"] for p in self.all_rows()
                         if p["status"] == "update"][:3]
                extra = "…" if summary["updates"] > len(names) else ""
                notify.send_toast(
                    "UpdatePilot — güncellemeler var",
                    f"{summary['updates']} program için yeni sürüm bulundu: "
                    + ", ".join(names) + extra)

        threading.Thread(target=work, daemon=True).start()
        return True

    def _check_one(self, p, token, skip_pre):
        name = p["name"]
        res = {"status": "error", "latest": p.get("latest", ""),
               "latest_url": p.get("latest_url", ""), "note": ""}
        try:
            if p.get("repo"):
                rel = github_api.latest_release(p["repo"], token=token,
                                                skip_prerelease=skip_pre)
                res.update(latest=rel["version"], latest_url=rel["url"],
                           note=rel["name"] or rel["tag"])
                p["assets"] = rel["assets"]
                cur = p.get("version", "")
                if not cur.strip():
                    res["status"] = "unknown"
                elif self._is_ignored(name, rel["version"]):
                    res["status"] = "ignore"
                elif is_newer(rel["version"], cur):
                    res["status"] = "update"
                else:
                    res["status"] = "ok"
            elif p.get("is_manual") and p.get("url"):
                latest = (p.get("latest") or "").strip()
                if not latest or not (p.get("version") or "").strip():
                    res["status"] = "unknown"
                    res["note"] = "Bilinen en yeni sürüm girilmemiş"
                elif is_newer(latest, p["version"]):
                    res["status"] = "update"
                else:
                    res["status"] = "ok"
            else:
                res["status"] = "nomatch"
        except github_api.GitHubError as e:
            res["note"] = str(e)
        except Exception as e:
            res["note"] = f"Hata: {e}"

        if res["status"] == "update":
            prev_latest = (self.cfg["known"].get(name) or {}).get("latest", "")
            if not prev_latest or compare(res["latest"], prev_latest) != 0:
                storage.append_history(
                    "guncelleme_bulundu", name,
                    f'{p.get("version", "?")} → {res["latest"]}')
        if p.get("repo") and res.get("latest"):
            with self.lock:
                self.cfg["known"].setdefault(name, {})["latest"] = res["latest"]
        return res

    # ---------------- eylemler ----------------

    def save_repo(self, key, repo):
        p = self.get_row(key)
        if not p:
            return False
        repo = (repo or "").strip().rstrip("/")
        repo = repo.replace("https://github.com/", "").replace("http://github.com/", "")
        if repo and "/" not in repo:
            return False
        if repo:
            self.cfg["repos"][p["name"]] = repo
        else:
            self.cfg["repos"].pop(p["name"], None)
        p["repo"] = repo
        with self.lock:
            storage.save_config(self.cfg)
        if repo:
            self.start_check(keys=[key])
        return True

    def ignore(self, key, event):
        p = self.get_row(key)
        if not p:
            return False
        version = p.get("latest") or p.get("version") or ""
        if not version:
            return False
        self.cfg["ignored"][p["name"]] = version
        if p["status"] == "update":
            p["status"] = "ignore"
        if p.get("is_manual"):
            p["entry"]["status"] = "ignore"
        storage.append_history(event, p["name"], version)
        with self.lock:
            storage.save_config(self.cfg)
        return True

    def unignore(self, key):
        p = self.get_row(key)
        if not p:
            return False
        self.cfg["ignored"].pop(p["name"], None)
        storage.append_history("yoksayma_kaldirildi", p["name"])
        with self.lock:
            storage.save_config(self.cfg)
        self.start_check(keys=[key])
        return True

    def mark_manual_updated(self, key):
        p = self.get_row(key)
        if not p or not p.get("is_manual"):
            return False
        entry = p["entry"]
        if entry.get("latest"):
            entry["version"] = entry["latest"]
            entry["status"] = "ok"
            storage.append_history("isaretlendi", p["name"],
                                   entry["latest"] + " kuruldu")
            with self.lock:
                storage.save_config(self.cfg)
            self.rebuild_manual_rows()
            return True
        return False

    def save_manual(self, data):
        name = (data.get("name") or "").strip()
        repo = (data.get("repo") or "").strip()
        url = (data.get("url") or "").strip()
        if not name or not (repo or url):
            return None
        fields = {"name": name, "version": (data.get("version") or "").strip(),
                  "repo": repo, "url": url,
                  "latest": (data.get("latest") or "").strip(),
                  "notes": (data.get("notes") or "").strip()}
        mid = data.get("id")
        if mid is not None:
            for entry in self.cfg["manual"]:
                if entry.get("id") == mid:
                    entry.update(fields)
                    storage.append_history("manuel_eklendi", name, "düzenlendi")
                    break
        else:
            max_id = max((m.get("id", 0) for m in self.cfg["manual"]), default=0)
            fields["id"] = max_id + 1
            fields["added"] = now_iso()
            fields["status"] = "unknown"
            self.cfg["manual"].append(fields)
            storage.append_history("manuel_eklendi", name)
            mid = fields["id"]
        with self.lock:
            storage.save_config(self.cfg)
        self.rebuild_manual_rows()
        if repo:
            self.start_check(keys=["m:" + str(mid)])
        else:
            # Ağ gerektirmeyen durum: kurulu ve bilinen en yeni sürüm hemen kıyaslanır
            entry = next((m for m in self.cfg["manual"] if m.get("id") == mid), None)
            if entry:
                v = (entry.get("version") or "").strip()
                l = (entry.get("latest") or "").strip()
                entry["status"] = ("update" if (v and l and is_newer(l, v))
                                   else "ok" if (v and l) else "unknown")
                self.rebuild_manual_rows()
                with self.lock:
                    storage.save_config(self.cfg)
        return mid

    def delete_manual(self, mid):
        entry = next((m for m in self.cfg["manual"] if m.get("id") == mid), None)
        if not entry:
            return False
        self.cfg["manual"].remove(entry)
        storage.append_history("manuel_silindi", entry.get("name", ""))
        with self.lock:
            storage.save_config(self.cfg)
        self.rebuild_manual_rows()
        return True

    def start_download(self, url, name):
        if not url:
            return False
        self.downloads[name] = {"msg": "Başlatılıyor…", "running": True}

        def work():
            try:
                storage.ensure_dirs()
                fname = url.split("/")[-1].split("?")[0] or "paket.indir"
                target = os.path.join(storage.DOWNLOAD_DIR, fname)
                i = 1
                while os.path.exists(target):
                    root_, ext = os.path.splitext(fname)
                    target = os.path.join(storage.DOWNLOAD_DIR, f"{root_} ({i}){ext}")
                    i += 1
                import urllib.request
                req = urllib.request.Request(url, headers={"User-Agent": "UpdatePilot/2.0"})
                tmp = target + ".part"
                with urllib.request.urlopen(req, timeout=60) as r, open(tmp, "wb") as f:
                    total = int(r.headers.get("Content-Length") or 0)
                    got = 0
                    while True:
                        chunk = r.read(65536)
                        if not chunk:
                            break
                        f.write(chunk)
                        got += len(chunk)
                        if total:
                            self.downloads[name]["msg"] = (
                                f"%{got * 100 // total} ({got // 1024} KB)")
                        else:
                            self.downloads[name]["msg"] = f"{got // 1024} KB"
                os.replace(tmp, target)
                storage.append_history("indirildi", name, target)
                self.downloads[name] = {"msg": "Tamamlandı: " + target, "running": False}
            except Exception as e:
                self.downloads[name] = {"msg": "Hata: " + str(e), "running": False}

        threading.Thread(target=work, daemon=True).start()
        return True

    def save_settings(self, data):
        s = self.cfg["settings"]
        if "token" in data:
            s["token"] = str(data["token"]).strip()
        for k in ("auto_check", "toasts", "include_user_scope", "skip_prerelease"):
            if k in data:
                s[k] = bool(data[k])
        with self.lock:
            storage.save_config(self.cfg)

    def clear_history(self):
        storage.clear_history()

    # ---------------- görünüm ----------------

    def state(self):
        rows = []
        for p in self.all_rows():
            rows.append({
                "key": p["key"], "name": p["name"], "version": p.get("version", ""),
                "publisher": p.get("publisher", ""), "date": p.get("date", ""),
                "size": p.get("size", ""), "location": p.get("location", ""),
                "repo": p.get("repo", ""), "url": p.get("url", ""),
                "latest": p.get("latest", ""), "latest_url": p.get("latest_url", ""),
                "notes": p.get("notes", ""), "note": p.get("note", ""),
                "status": p.get("status", "nomatch"), "checked": p.get("checked", ""),
                "is_manual": bool(p.get("is_manual")),
                "assets": len(p.get("assets", []) or []),
            })
        stats = {"total": len(self.programs), "manual": len(self.cfg["manual"]),
                 "update": sum(1 for r in rows if r["status"] == "update"),
                 "ok": sum(1 for r in self.programs if r["status"] == "ok")}
        s = self.cfg["settings"]
        return {
            "rows": rows,
            "stats": stats,
            "statuses": STATUS_LABELS,
            "progress": {"scan": self.scan_running, "check": self.check_running,
                         "message": self.progress_msg},
            "settings": {k: s.get(k) for k in
                         ("auto_check", "toasts", "include_user_scope", "skip_prerelease")},
            "has_token": bool(s.get("token")),
            "last_scan": self.cfg.get("last_scan"),
            "last_check": self.cfg.get("last_check"),
            "rate": github_api.rate.get("remaining"),
            "downloads": self.downloads,
            "summary": self.check_summary,
            "history": storage.read_history(200),
        }


def build_state_factory(app_state):
    def factory():
        payload = app_state.state()
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return raw
    return factory


class Handler(BaseHTTPRequestHandler):
    app_state = None          # tip: AppState
    server_version = "UpdatePilot/2.0"
    protocol_version = "HTTP/1.1"

    # ------------ yardımcılar ------------

    def log_message(self, fmt, *args):
        pass  # konsolu kirletme

    def _json(self, obj, status=200):
        raw = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def _file(self, rel, status=200, extra_headers=None):
        path = os.path.normpath(os.path.join(WEB_DIR, rel))
        if not path.startswith(WEB_DIR) or not os.path.isfile(path):
            self._json({"error": "bulunamadı"}, 404)
            return
        ext = os.path.splitext(path)[1].lower()
        with open(path, "rb") as f:
            raw = f.read()
        self.send_response(status)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-cache")
        for k, v in (extra_headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(raw)

    def _body(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if length <= 0 or length > 1_000_000:
            return {}
        if (self.headers.get("Content-Type") or "").split(";")[0].strip() != "application/json":
            return {}  # yalnızca gerçek JSON gövdeleri kabul edilir (CSRF önlemi)
        try:
            return json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return {}

    def _csv(self, filename, header, rows):
        buf = io.StringIO()
        w = csv.writer(buf, delimiter=";")
        w.writerow(header)
        w.writerows(rows)
        raw = buf.getvalue().encode("utf-8-sig")
        self.send_response(200)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def heartbeat(self):
        self.app_state.last_heartbeat = time.time()

    # ------------ GET ------------

    def do_GET(self):
        self.heartbeat()
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        qs = urllib.parse.parse_qs(parsed.query)

        if path in ("/", "/index.html"):
            self._file("index.html")
        elif path in ("/app.css", "/app.js", "/favicon.svg"):
            self._file(path.lstrip("/"))
        elif path == "/api/state":
            payload = self.app_state.state()
            raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
            etag = f'"{hash(raw) & 0xFFFFFFFF:08x}"'
            if qs.get("h", [""])[0] and qs["h"][0] == etag:
                self._json({"changed": False, "h": etag})
            else:
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(raw.encode("utf-8"))))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(raw.encode("utf-8"))
        elif path == "/api/suggest":
            q = qs.get("q", [""])[0]
            try:
                items = github_api.search_repos(
                    q, token=self.app_state.cfg["settings"].get("token", "").strip())
                self._json({"items": items})
            except github_api.GitHubError as e:
                self._json({"error": str(e)}, 502)
        elif path == "/api/releases":
            repo = qs.get("repo", [""])[0]
            if not repo:
                self._json({"error": "repo gerekli"}, 400)
                return
            try:
                rels = github_api.list_releases(
                    repo, token=self.app_state.cfg["settings"].get("token", "").strip())
                self._json({"releases": rels[:10]})
            except github_api.GitHubError as e:
                self._json({"error": str(e)}, 502)
        elif path == "/api/export/status.csv":
            st = self.app_state.state()
            rows = [[r["name"], r["version"], STATUS_LABELS.get(r["status"], r["status"]),
                     r["latest"], r["repo"] or r["url"], r["publisher"],
                     r["date"], r["location"]] for r in st["rows"]]
            self._csv("updatepilot-rapor.csv",
                      ["Program", "Kurulu sürüm", "Durum", "En yeni sürüm", "Kaynak",
                       "Yayıncı", "Kurulum tarihi", "Konum"], rows)
        elif path == "/api/export/history.csv":
            rows = [[storage.fmt_ts(e.get("ts", "")), e.get("program", ""),
                     storage.EVENT_LABELS.get(e.get("type", ""), e.get("type", "")),
                     e.get("detail", "")] for e in storage.read_history()]
            self._csv("updatepilot-gecmis.csv",
                      ["Zaman", "Program", "Olay", "Ayrıntı"], rows)
        else:
            self._json({"error": "bilinmeyen uç nokta"}, 404)

    # ------------ POST ------------

    def do_POST(self):
        self.heartbeat()
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            # Form tabanlı CSRF istekleri bu tipte gönderilemez; reddet
            self._json({"error": "Content-Type: application/json gerekli"}, 415)
            return
        st = self.app_state
        path = urllib.parse.urlparse(self.path).path
        body = self._body()

        if path == "/api/heartbeat":
            self._json({"ok": True})
        elif path == "/api/scan":
            st.start_scan()
            self._json({"ok": True})
        elif path == "/api/check":
            st.start_check(body.get("keys"))
            self._json({"ok": True})
        elif path == "/api/repo":
            ok = st.save_repo(body.get("key", ""), body.get("repo", ""))
            self._json({"ok": bool(ok)} if ok else {"error": "Depo kaydedilemedi. "
                                                       "'kullanici/depo' biçiminde girin."}, 200 if ok else 400)
        elif path == "/api/ignore":
            ok = st.ignore(body.get("key", ""), body.get("event", "yoksayildi"))
            self._json({"ok": bool(ok)}, 200 if ok else 404)
        elif path == "/api/unignore":
            ok = st.unignore(body.get("key", ""))
            self._json({"ok": bool(ok)}, 200 if ok else 404)
        elif path == "/api/mark":
            ok = st.mark_manual_updated(body.get("key", ""))
            self._json({"ok": bool(ok)}, 200 if ok else 404)
        elif path == "/api/manual/save":
            mid = st.save_manual(body)
            if mid is None:
                self._json({"error": "Ad zorunlu; depo ya da bağlantı gerekli."}, 400)
            else:
                self._json({"ok": True, "id": mid})
        elif path == "/api/manual/delete":
            ok = st.delete_manual(body.get("id"))
            self._json({"ok": bool(ok)}, 200 if ok else 404)
        elif path == "/api/download":
            key = body.get("key")
            url = body.get("url", "")
            name = body.get("name", "paket")
            if key and not url:
                p = st.get_row(key)
                if not p:
                    self._json({"error": "satır bulunamadı"}, 404)
                    return
                asset = pick_asset(p.get("assets", []) or [])
                if asset:
                    url = asset["url"]
                elif p.get("latest_url"):
                    self._json({"open": p["latest_url"]})
                    return
                else:
                    self._json({"error": "İndirme dosyası bulunamadı. Önce kontrol edin."}, 400)
                    return
            if not url:
                self._json({"error": "url gerekli"}, 400)
                return
            st.start_download(url, name)
            self._json({"ok": True})
        elif path == "/api/settings":
            st.save_settings(body)
            self._json({"ok": True})
        elif path == "/api/clear_history":
            st.clear_history()
            self._json({"ok": True})
        elif path == "/api/open":
            kind = body.get("path", "")
            try:
                if kind == "download":
                    storage.ensure_dirs()
                    os.startfile(storage.DOWNLOAD_DIR)
                elif kind == "appwiz":
                    os.startfile("appwiz.cpl")
                elif kind == "appdata":
                    os.startfile(storage.APP_DIR)
                else:
                    loc = body.get("location", "")
                    if loc and os.path.isdir(loc):
                        os.startfile(loc)
                    else:
                        self._json({"error": "Klasör kayıtlı değil."}, 400)
                        return
                self._json({"ok": True})
            except Exception as e:
                self._json({"error": str(e)}, 400)
        elif path == "/api/shutdown":
            self._json({"ok": True})
            threading.Timer(0.3, st.on_shutdown).start()
        else:
            self._json({"error": "bilinmeyen uç nokta"}, 404)


def create_server(port=None):
    """Sunucuyu kurar, (server, port) döner. port verilmezse boş nokta seçilir."""
    if port is None:
        with __import__("socket").socket() as s:
            s.bind(("127.0.0.1", 0))
            port = s.getsockname()[1]
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    return server, port
