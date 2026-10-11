# -*- coding: utf-8 -*-
"""GitHub Releases API istemcisi (harici bağımlılık yok, urllib tabanlı).

Kimlik doğrulaması isteğe bağlıdır: kişisel erişim tokeni (PAT)
verilmezse saatte 60 istek sınırı uygulanır; verilirse 5000'e çıkar.
"""
import json
import socket
import urllib.error
import urllib.parse
import urllib.request

from versioning import clean, is_prerelease

BASE = "https://api.github.com"
_UA = "UpdatePilot/1.0 (yerel guncelleme araci)"
_TIMEOUT = 20

# Son yanıttan hız sınırı bilgisi (arayüz durum çubuğunda gösterilir)
rate = {"remaining": None, "reset": None}


class GitHubError(Exception):
    """Kullanıcıya gösterilebilir GitHub/ağ hatası."""

    def __init__(self, message, status=0):
        super().__init__(message)
        self.status = status


def _request(path_or_url, token=None):
    url = path_or_url if path_or_url.startswith("http") else BASE + path_or_url
    req = urllib.request.Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": _UA,
        "X-GitHub-Api-Version": "2022-11-28",
    })
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
            rate["remaining"] = resp.headers.get("X-RateLimit-Remaining")
            rate["reset"] = resp.headers.get("X-RateLimit-Reset")
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("message", "")
        except Exception:
            pass
        if e.code == 403 and "rate limit" in detail.lower():
            raise GitHubError(
                "GitHub API hız sınırına ulaşıldı (saatte 60 istek). "
                "Ayarlar'dan bir kişisel erişim tokeni ekleyerek sınırı "
                "saatte 5000'e çıkarabilirsiniz.", 403)
        if e.code == 404:
            raise GitHubError("Depo bulunamadı. 'kullanici/depo' biçimini ve "
                              "deponun herkese açık olduğunu kontrol edin.", 404)
        raise GitHubError(f"GitHub hatası (HTTP {e.code}): {detail or 'bilinmeyen hata'}", e.code)
    except (urllib.error.URLError, socket.timeout, TimeoutError) as e:
        reason = getattr(e, "reason", e)
        raise GitHubError(f"Ağ hatası: {reason} — internet bağlantısını kontrol edin.")


def normalize_release(rel):
    """Ham release sözlüğünü uygulamamızın kullandığı biçime indirger."""
    assets = [
        {
            "name": a.get("name", ""),
            "size": a.get("size", 0),
            "url": a.get("browser_download_url", ""),
            "downloads": a.get("download_count", 0),
        }
        for a in (rel.get("assets") or [])
    ]
    tag = rel.get("tag_name", "")
    return {
        "tag": tag,
        "version": clean(tag),
        "name": rel.get("name") or "",
        "url": rel.get("html_url", ""),
        "published": (rel.get("published_at") or "")[:10],
        "body": rel.get("body") or "",
        "prerelease": bool(rel.get("prerelease")) or is_prerelease(tag),
        "assets": assets,
    }


def list_releases(repo, token=None, per_page=15):
    data = _request(f"/repos/{repo}/releases?per_page={per_page}", token)
    if not isinstance(data, list):
        raise GitHubError("Beklenmeyen GitHub yanıtı alındı.")
    return [normalize_release(r) for r in data]


def latest_release(repo, token=None, skip_prerelease=True):
    """Depodaki en son sürümü döndürür.

    skip_prerelease açıkken ön sürümler atlanır; yalnızca ön sürüm
    varsa en yenisi ön sürüm olarak döndürülür.
    """
    rels = list_releases(repo, token)
    if rels:
        if skip_prerelease:
            pick = next((r for r in rels if not r["prerelease"]), None)
            if pick is None:
                pick = rels[0]
            return pick
        return rels[0]
    # Sürümler listesi boşsa (bazı depolara özel) latest uç noktasını dene
    data = _request(f"/repos/{repo}/releases/latest", token)
    return normalize_release(data)


def search_repos(query, token=None, per_page=6):
    """Program adından olası depo eşleşmeleri önerir."""
    q = urllib.parse.quote(f"{query} in:name")
    data = _request(f"/search/repositories?q={q}&per_page={per_page}", token)
    items = data.get("items", []) if isinstance(data, dict) else []
    return [
        {
            "full_name": it.get("full_name", ""),
            "description": it.get("description") or "",
            "stars": it.get("stargazers_count", 0),
            "url": it.get("html_url", ""),
        }
        for it in items
    ]
