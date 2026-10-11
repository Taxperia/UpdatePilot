# -*- coding: utf-8 -*-
r"""Kalıcı depolama: ayarlar, depo eşleşmeleri, yoksayılanlar ve geçmiş.

Tüm veriler yerel olarak saklanır:
  - Ayarlar:  %LOCALAPPDATA%\UpdatePilot\config.json
  - Geçmiş:   %LOCALAPPDATA%\UpdatePilot\history.jsonl
  - İndirilen paketler: <Downloads>\UpdatePilot\
"""
import datetime
import json
import os
import threading

APP_DIR = os.path.join(
    os.environ.get("LOCALAPPDATA") or os.path.expanduser("~"), "UpdatePilot")
CONFIG_PATH = os.path.join(APP_DIR, "config.json")
HISTORY_PATH = os.path.join(APP_DIR, "history.jsonl")
DOWNLOAD_DIR = os.path.join(os.path.expanduser("~"), "Downloads", "UpdatePilot")

_lock = threading.Lock()

DEFAULTS = {
    "settings": {
        "auto_check": True,       # Açılışta güncellemeleri otomatik kontrol et
        "toasts": True,           # Windows bildirimleri
        "include_user_scope": True,  # HKCU (yalnızca bu kullanıcıya kurulanlar) dahil
        "skip_prerelease": True,  # Ön sürümleri (alpha/beta/rc) atla
        "token": "",              # İsteğe bağlı GitHub kişisel erişim tokeni
    },
    "repos": {},    # program adı -> "kullanici/depo"
    "ignored": {},  # program adı -> yoksayılan sürüm
    "manual": [],   # manuel paket girdileri
    "known": {},    # program adı -> {"version": ..., "latest": ..., "ts": ...}
    "last_scan": None,
    "last_check": None,
}


def ensure_dirs():
    os.makedirs(APP_DIR, exist_ok=True)
    os.makedirs(DOWNLOAD_DIR, exist_ok=True)


def load_config():
    cfg = json.loads(json.dumps(DEFAULTS))  # derin kopya
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            stored = json.load(f)
    except (OSError, ValueError):
        stored = {}
    for section, values in stored.items():
        if isinstance(values, dict) and isinstance(cfg.get(section), dict):
            cfg[section].update(values)
        else:
            cfg[section] = values
    return cfg


def save_config(cfg):
    ensure_dirs()
    tmp = CONFIG_PATH + ".tmp"
    with _lock:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2, ensure_ascii=False)
        os.replace(tmp, CONFIG_PATH)


def append_history(event_type, program, detail=""):
    entry = {
        "ts": datetime.datetime.now().isoformat(timespec="seconds"),
        "type": event_type,
        "program": program,
        "detail": detail,
    }
    ensure_dirs()
    with _lock:
        with open(HISTORY_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    return entry


def read_history(limit=1000):
    try:
        with open(HISTORY_PATH, "r", encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return []
    entries = []
    for line in lines[-limit:]:
        try:
            entries.append(json.loads(line))
        except ValueError:
            continue
    entries.reverse()  # en yeni önce
    return entries


def clear_history():
    ensure_dirs()
    with _lock:
        with open(HISTORY_PATH, "w", encoding="utf-8"):
            pass


def fmt_ts(iso):
    if not iso:
        return "—"
    try:
        dt = datetime.datetime.fromisoformat(iso)
        return dt.strftime("%d.%m.%Y %H:%M")
    except ValueError:
        return iso


EVENT_LABELS = {
    "guncelleme_bulundu": "Güncelleme bulundu",
    "program_guncellendi": "Program güncellendi",
    "yoksayildi": "Sürüm yoksayıldı",
    "yoksayma_kaldirildi": "Yoksayma kaldırıldı",
    "manuel_eklendi": "Manuel paket eklendi",
    "manuel_silindi": "Manuel paket silindi",
    "isaretlendi": "Güncellendi olarak işaretlendi",
    "indirildi": "Paket indirildi",
    "tarama": "Tarama",
    "hata": "Hata",
}
