"""画面のページ(PC用・スマホ用・カード)と、PC用ページのテーマの一覧。"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import FileResponse

from .. import config
from ..themes import list_themes, resolve_theme

router = APIRouter()


@router.get("/")
async def page_pc(theme: str | None = None) -> FileResponse:
    """PC用ページ(展示の大画面)。?theme= で見た目を切りかえる。"""
    return FileResponse(config.THEMES_DIR / resolve_theme(theme) / "index.html")


@router.get("/api/themes")
async def api_themes() -> dict:
    """使えるテーマの一覧と、いま何も付けないときに使われるテーマ。"""
    themes = list_themes()
    return {"themes": themes, "default": resolve_theme(None, themes)}


@router.get("/phone")
async def page_phone() -> FileResponse:
    """スマホ用ページ。"""
    return FileResponse(config.STATIC_DIR / "phone.html")


@router.get("/card")
async def page_card() -> FileResponse:
    """カードのページ(印刷用。2026年11月9日の試作。app/card.py・static/card/)。

    /card?id=<photo_id か outputs のフォルダ名か demo>(&print=1 で印刷)。
    """
    return FileResponse(config.STATIC_DIR / "card" / "card.html")
