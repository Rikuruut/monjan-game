"""`.env` の値を読む小さな道具。"""

from __future__ import annotations

import os

# 「はい」とみなす書き方
_TRUE_VALUES = ("1", "true", "yes", "on")


def env_flag(name: str, default: bool = False) -> bool:
    """`.env` の true / false の設定を読む。書いていなければ `default`。"""
    value = os.getenv(name)
    if value is None or not value.strip():
        return default
    return value.strip().lower() in _TRUE_VALUES
