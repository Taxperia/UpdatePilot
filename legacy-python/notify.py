# -*- coding: utf-8 -*-
"""Windows 10/11 yerel bildirimleri (toast).

Ek bağımlılık gerektirmez: PowerShell üzerinden Windows Runtime
bildirim API'si kullanılır. Gönderim en iyi çaba esaslıdır; başarısız
olursa sessizce False döner (uygulama içi bildirimler her zaman çalışır).
"""
import base64
import subprocess
import sys

_IS_WIN = sys.platform == "win32"
_CREATE_NO_WINDOW = 0x08000000 if _IS_WIN else 0


def _xml_escape(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;")
            .replace(">", "&gt;").replace('"', "&quot;"))


def send_toast(title, body):
    """Windows bildirimi gönderir. Başarılıysa True döner."""
    if not _IS_WIN:
        return False
    t, b = _xml_escape(title), _xml_escape(body)
    ps = f'''[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument,Windows.Data.Xml.Dom,ContentType=WindowsRuntime]
$xml = New-Object Windows.Data.Xml.Dom.XmlDocument
$xml.LoadXml('<toast><visual><binding template="ToastText02"><text id="1">{t}</text><text id="2">{b}</text></binding></visual></toast>')
$toast = New-Object Windows.UI.Notifications.ToastNotification $xml
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("UpdatePilot").Show($toast)
'''
    try:
        encoded = base64.b64encode(ps.encode("utf-16-le")).decode("ascii")
        subprocess.Popen(
            ["powershell", "-NoProfile", "-WindowStyle", "Hidden",
             "-EncodedCommand", encoded],
            creationflags=_CREATE_NO_WINDOW)
        return True
    except Exception:
        return False
