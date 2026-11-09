"""PC用ページのテーマ(見た目)。

見た目はテーマごとに static/themes/<テーマ名>/(index.html と style.css)に分けてあり、
動き(撮影・生成・場面の進行)は static/common/ の JavaScript が共通で受け持つ。
/?theme=fusion のように付けると、そのテーマで表示する。何も付けないときは .env の PC_THEME。
新しいテーマは、static/themes/ にフォルダを足すだけで選べるようになる(theme.json に表示名を書ける)。
"""

from __future__ import annotations

import json
import os

from . import config

DEFAULT_PC_THEME = "fusion"


def list_themes() -> list[dict[str, str]]:
    """使えるテーマの一覧(index.html があるフォルダ)。"""
    themes = []
    themes_dir = config.THEMES_DIR
    for d in sorted(themes_dir.iterdir()) if themes_dir.is_dir() else []:
        if not (d / "index.html").is_file():
            continue
        info = {"id": d.name, "name": d.name, "description": ""}
        try:
            meta = json.loads((d / "theme.json").read_text(encoding="utf-8"))
            info["name"] = meta.get("name") or d.name
            info["description"] = meta.get("description") or ""
        except Exception:
            pass   # theme.json がなくても使える
        themes.append(info)
    return themes


def resolve_theme(theme: str | None, themes: list[dict[str, str]] | None = None) -> str:
    """指定されたテーマ名を、実際にあるテーマにそろえる。なければ PC_THEME、それもなければ fusion。

    `themes` は list_themes() の結果(すでに読んであれば渡す。フォルダを2回読まないため)。
    """
    available = {t["id"] for t in (list_themes() if themes is None else themes)}
    for candidate in (theme, os.getenv("PC_THEME"), DEFAULT_PC_THEME):
        if candidate and candidate.strip() in available:
            return candidate.strip()
    return next(iter(sorted(available)), DEFAULT_PC_THEME)
