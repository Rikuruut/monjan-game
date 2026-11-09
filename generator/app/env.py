"""`.env` の値を読む小さな道具。"""

from __future__ import annotations

import os

# 「はい」とみなす書き方
_TRUE_VALUES = ("1", "true", "yes", "on")


def env_str(name: str, lower: bool = False) -> str:
    """`.env` の文字の設定を、前後の空白を取って読む(書いていなければ "")。`lower` で小文字にそろえる。"""
    value = (os.getenv(name) or "").strip()
    return value.lower() if lower else value


def env_flag(name: str, default: bool = False) -> bool:
    """`.env` の true / false の設定を読む。書いていなければ `default`。"""
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in _TRUE_VALUES
