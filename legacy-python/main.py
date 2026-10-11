# -*- coding: utf-8 -*-
"""UpdatePilot 2.0 — giriş noktası.

Yerel sunucuyu başlatır, arayüzü Edge/Chrome "uygulama penceresi"
olarak açar. Pencere kapatıldığında (kalp atışı kesildiğinde) sunucu
kendiliğinden kapanır.
"""
import os
import subprocess
import sys
import threading
import time

EDGE_PATHS = (
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
)
CHROME_PATHS = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    os.path.join(os.environ.get("LOCALAPPDATA", ""), r"Google\Chrome\Application\chrome.exe"),
)


def find_app_browser():
    for p in EDGE_PATHS + CHROME_PATHS:
        if p and os.path.isfile(p):
            return p
    return None


def open_window(url):
    exe = find_app_browser()
    if exe:
        try:
            subprocess.Popen([exe, "--app=" + url, "--window-size=1200,800"],
                             creationflags=0x08000000)  # CREATE_NO_WINDOW
            return True
        except Exception:
            pass
    import webbrowser
    webbrowser.open(url)
    return False


def main():
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass

    import server
    forced_port = os.environ.get("UPDATEPILOT_PORT")
    srv, port = server.create_server(int(forced_port) if forced_port else None)
    app_state = server.AppState(on_shutdown=srv.shutdown)
    server.Handler.app_state = app_state
    app_state.start_scan()  # açılışta otomatik tarama
    url = f"http://127.0.0.1:{port}/"

    # Test/otomasyon kancası
    autoclose = os.environ.get("UPDATEPILOT_QA_AUTOCLOSE_MS")
    if autoclose:
        url += "?qa=" + os.environ.get("UPDATEPILOT_QA_PAGE", "1")
        threading.Timer(float(autoclose) / 1000.0, srv.shutdown).start()

    threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.5},
                     daemon=True).start()
    if not os.environ.get("UPDATEPILOT_NO_WINDOW"):
        open_window(url)

    # Bekçi: arayüz sayfası kapanırsa (kalp atışı ~3 dk) sunucuyu kapat
    def watchdog():
        while True:
            time.sleep(10)
            idle = time.time() - app_state.last_heartbeat
            busy = (app_state.scan_running or app_state.check_running
                    or any(d["running"] for d in app_state.downloads.values()))
            if idle > 180 and not busy:
                srv.shutdown()
                return

    threading.Thread(target=watchdog, daemon=True).start()
    srv.serve_forever(poll_interval=0.5)  # kapanana dek ana iş parçacığında bekle


if __name__ == "__main__":
    main()
