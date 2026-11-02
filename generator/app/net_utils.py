"""ネットワーク関係の小さな道具。"""

from __future__ import annotations

import socket


def get_lan_ip() -> str:
    """このPCのLAN内IPアドレスを調べて返す。

    外部へUDPソケットを「つなぐ」ふりをして、OSが選んだ送信元アドレスを読む。
    実際には通信しないので、インターネットにつながっていなくても動くことが多い。
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        # 調べられなかったときはループバックを返す
        return "127.0.0.1"
    finally:
        s.close()
