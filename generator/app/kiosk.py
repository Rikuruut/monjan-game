"""PC用ページを、ブラウザのキオスクモード(全画面・アドレスバーなし)で開く。

ページの側からはキオスクモードにできないので、サーバーを起動したときに
ブラウザ(Edge。なければ Chrome)を `--kiosk` 付きで立ち上げる。
キオスクモードを終わるときは Alt + F4。ブラウザを閉じると、サーバーも止まる。
"""

from __future__ import annotations

import logging
import os
import socket
import subprocess
import threading
import time
from pathlib import Path
from typing import Callable

from .env import env_flag

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

# 立ち上げたブラウザがこれより早く終わったときは、閉じられたとはみなさない(秒)。
# 同じプロフィールのキオスクがもう開いていると、新しいブラウザは前の窓に引き継いで、すぐに終わるため
HANDOFF_SECONDS = 5.0


def kiosk_enabled() -> bool:
    """.env の KIOSK_MODE(既定 true)。"""
    return env_flag("KIOSK_MODE", default=True)


def kiosk_printing_enabled() -> bool:
    """.env の KIOSK_PRINTING(既定 false)。true なら、印刷のダイアログを出さずに既定のプリンターで刷る。"""
    return env_flag("KIOSK_PRINTING", default=False)


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


def kiosk_args(browser: Path, url: str) -> list[str]:
    """キオスクのブラウザの起動のしかた。"""
    args = [
        str(browser),
        "--kiosk", url,
        "--edge-kiosk-type=fullscreen",        # Edge:全画面のキオスク(Chrome は無視する)
        f"--user-data-dir={PROFILE_DIR}",
        "--no-first-run",
        "--disable-pinch",                     # タッチ画面で、指で拡大されないようにする
        "--overscroll-history-navigation=0",   # 横にスワイプして「戻る」にならないようにする
        "--autoplay-policy=no-user-gesture-required",  # ページを移ったあとも、ボタンを押す前から音を出せるように
    ]
    if kiosk_printing_enabled():
        # カードの「いんさつ」で、ダイアログを出さずに既定のプリンターへ(プリンターの設定は Windows 側で決めておく)
        args.append("--kiosk-printing")
    return args


def _launch(url: str, port: int, on_close: Callable[[], None] | None = None) -> None:
    browser = find_browser()
    if browser is None:
        logger.warning("キオスクモード:ブラウザ(Edge / Chrome)が見つかりませんでした。%s を手で開いてください", url)
        return
    if not _wait_for_server(port):
        logger.warning("キオスクモード:サーバーの起動を待ちきれませんでした。%s を手で開いてください", url)
        return
    args = kiosk_args(browser, url)
    try:
        started = time.monotonic()
        process = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        logger.info("キオスクモードで開きました(%s)。終わるときは Alt + F4(サーバーも止まります)", browser.name)
    except OSError as e:
        logger.warning("キオスクモード:ブラウザを起動できませんでした(%s)。%s を手で開いてください", e, url)
        return
    if on_close is not None:
        _watch(process, started, on_close)


def _watch(process: subprocess.Popen, started: float, on_close: Callable[[], None]) -> None:
    """ブラウザが閉じられるのを待って、on_close を呼ぶ(サーバーを止める)。

    ※ 2026年11月2日:それまでは Alt + F4 でブラウザだけが閉じ、サーバーは裏のターミナルで動き続けていた。
      止まっていないのに気づかず起動し直さなかったので、直したコードが読み込まれていなかった
    """
    process.wait()
    if time.monotonic() - started < HANDOFF_SECONDS:
        logger.warning("キオスクモード:前に開いたキオスクの窓が残っていたようです。"
                       "この窓を閉じても、サーバーは止まりません(止めるときはターミナルで Ctrl + C)")
        return
    logger.info("キオスクのブラウザが閉じられたので、サーバーを止めます")
    on_close()


def open_kiosk_in_background(port: int, on_close: Callable[[], None] | None = None) -> None:
    """サーバーの起動を止めないよう、別のスレッドでブラウザを開く。閉じられたら on_close を呼ぶ。"""
    # 展示はじゃんけんバトルのタイトル画面から始まる(スタートで / の撮影の画面へ進む)
    url = f"http://localhost:{port}/battle/"
    threading.Thread(target=_launch, args=(url, port, on_close), daemon=True).start()
