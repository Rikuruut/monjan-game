"""PC用ページを、ブラウザのキオスクモード(全画面・アドレスバーなし)で開く。

ページの側からはキオスクモードにできないので、サーバーを起動したときに
ブラウザ(Edge。なければ Chrome)を `--kiosk` 付きで立ち上げる。
キオスクモードを終わるときは Alt + F4。
"""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import threading
import time
from pathlib import Path

logger = logging.getLogger("monjan")

# 探すブラウザ(上から順に。展示のPCは Windows なので Edge を先にする)
BROWSER_CANDIDATES = [
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Microsoft/Edge/Application/msedge.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Microsoft/Edge/Application/msedge.exe",
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Google/Chrome/Application/chrome.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
]

# キオスク専用のブラウザのプロフィール。
# ふだん使っている Edge が開いていると、--kiosk が無視されて普通の窓で開くため、別のプロフィールで起動する
PROFILE_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "monjan-kiosk"


def kiosk_enabled() -> bool:
    """.env の KIOSK_MODE(既定 true)。"""
    return os.getenv("KIOSK_MODE", "true").strip().lower() in ("1", "true", "yes", "on")


def find_browser() -> Path | None:
    """使うブラウザを探す。.env の KIOSK_BROWSER に書いてあれば、それを使う。"""
    custom = os.getenv("KIOSK_BROWSER", "").strip()
    if custom:
        path = Path(custom)
        return path if path.exists() else None
    for path in BROWSER_CANDIDATES:
        if path.exists():
            return path
    return None


def _wait_for_server(port: int, timeout: float = 30.0) -> bool:
    """サーバーが受け付けを始めるまで待つ(先にブラウザを開くと、つながらない画面が出るため)。"""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                return True
        except OSError:
            time.sleep(0.3)
    return False


def _launch(url: str, port: int) -> None:
    browser = find_browser()
    if browser is None:
        logger.warning("キオスクモード:ブラウザ(Edge / Chrome)が見つかりませんでした。%s を手で開いてください", url)
        return
    if not _wait_for_server(port):
        logger.warning("キオスクモード:サーバーの起動を待ちきれませんでした。%s を手で開いてください", url)
        return
    args = [
        str(browser),
        "--kiosk", url,
        "--edge-kiosk-type=fullscreen",        # Edge:全画面のキオスク(Chrome は無視する)
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--disable-pinch",                     # タッチ画面で、指で拡大されないようにする
        "--overscroll-history-navigation=0",   # 横にスワイプして「戻る」にならないようにする
    ]
    try:
        subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        logger.info("キオスクモードで開きました(%s)。終わるときは Alt + F4", browser.name)
    except OSError as e:
        logger.warning("キオスクモード:ブラウザを起動できませんでした(%s)。%s を手で開いてください", e, url)


def open_kiosk_in_background(port: int) -> None:
    """サーバーの起動を止めないよう、別のスレッドでブラウザを開く。"""
    url = f"http://localhost:{port}/"
    threading.Thread(target=_launch, args=(url, port), daemon=True).start()
