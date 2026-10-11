# -*- coding: utf-8 -*-
r"""Windows kayıt defterinden kurulu programları tarar.

Windows'un "Uygulamalar ve Özellikler" listesinin kullandığı
Uninstall kayıt defteri anahtarlarını okur:
  - HKLM\...\Uninstall  (64-bit ve 32-bit görünüm)
  - HKCU\...\Uninstall  (yalnızca bu kullanıcıya kurulanlar)
Microsoft Store uygulamaları bu listede yer almadığından taranamaz.
"""
import datetime
import winreg

_UNINSTALL = r"Software\Microsoft\Windows\CurrentVersion\Uninstall"

_VIEWS = (
    (winreg.HKEY_LOCAL_MACHINE, _UNINSTALL, winreg.KEY_WOW64_64KEY),
    (winreg.HKEY_LOCAL_MACHINE, _UNINSTALL, winreg.KEY_WOW64_32KEY),
    (winreg.HKEY_CURRENT_USER, _UNINSTALL, 0),
)


def _read(key, name, default=""):
    try:
        value, _type = winreg.QueryValueEx(key, name)
        return value
    except OSError:
        return default


def _fmt_install_date(raw):
    """'20250312' veya DWORD 20250312 -> '12.03.2025'"""
    s = str(raw or "").strip()
    if len(s) == 8 and s.isdigit():
        try:
            d = datetime.date(int(s[:4]), int(s[4:6]), int(s[6:8]))
            return d.strftime("%d.%m.%Y")
        except ValueError:
            return s
    return ""


def _fmt_size(kb):
    try:
        kb = int(kb)
    except (TypeError, ValueError):
        return ""
    if kb <= 0:
        return ""
    if kb >= 1024 * 1024:
        return f"{kb / 1024 / 1024:.1f} GB"
    if kb >= 1024:
        return f"{kb / 1024:.0f} MB"
    return f"{kb} KB"


def scan_installed(include_user=True):
    """Kurulu programların listesini döndürür.

    Her öğe: name, version, publisher, date, location, uninstall,
    icon, size, entry_count (boyut sütunları için).
    """
    programs = {}
    for hive, path, access in _VIEWS:
        if hive == winreg.HKEY_CURRENT_USER and not include_user:
            continue
        try:
            root = winreg.OpenKey(hive, path, 0, winreg.KEY_READ | access)
        except OSError:
            continue
        with root:
            i = 0
            while True:
                try:
                    subkey = winreg.EnumKey(root, i)
                    i += 1
                except OSError:
                    break
                try:
                    key = winreg.OpenKey(root, subkey)
                except OSError:
                    continue
                try:
                    name = _read(key, "DisplayName")
                    if not name:
                        continue
                    # Gizli sistem bileşenlerini atla (Denetim Masası da göstermez)
                    if int(_read(key, "SystemComponent", 0) or 0):
                        continue
                    version = str(_read(key, "DisplayVersion") or "").strip()
                    location = str(_read(key, "InstallLocation") or "").strip()
                    uninstall = str(_read(key, "UninstallString") or "").strip()
                    if not version and not uninstall and not location:
                        continue

                    entry = {
                        "name": name,
                        "version": version,
                        "publisher": str(_read(key, "Publisher") or "").strip(),
                        "date": _fmt_install_date(_read(key, "InstallDate")),
                        "location": location,
                        "uninstall": uninstall,
                        "icon": str(_read(key, "DisplayIcon") or "").strip(),
                        "size": _fmt_size(_read(key, "EstimatedSize")),
                    }
                    # Aynı adda birden fazla girdi olabilir (64/32-bit, eski
                    # kalıntılar); en dolu bilgili olanı tutulur.
                    existing = programs.get(name.lower())
                    if existing is None or _richness(entry) > _richness(existing):
                        programs[name.lower()] = entry
                except OSError:
                    continue
    return sorted(programs.values(), key=lambda p: p["name"].lower())


def _richness(p):
    return sum(1 for v in p.values() if v)
