"""PC とスマホのつなぎ(WebSocket・スマホの URL と QR コード・撮影の合図・動物の一覧)。"""

from __future__ import annotations

import functools
import io
import logging

import qrcode
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

from .. import config
from ..animals import ANIMAL_ICONS, ANIMALS, DEFAULT_ANIMAL_ICON
from ..ws_manager import ROLE_PC, ROLE_PHONE, ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket, role: str = "pc") -> None:
    """PCとスマホの両方がつなぐWebSocket。

    接続先は /ws?role=pc または /ws?role=phone
    """
    if role not in (ROLE_PC, ROLE_PHONE):
        await ws.close(code=1008)
        return

    await ws_manager.connect(role, ws)
    try:
        while True:
            # 受信は使っていないが、接続を保つために待ち受ける
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.debug("WebSocketでエラー(切断として扱う)", exc_info=True)
    finally:
        await ws_manager.disconnect(role, ws)


@router.get("/api/animals")
async def api_animals() -> dict:
    """動物の一覧を返す。"""
    # icons は PC画面の「とどいたもの」で使う(一覧にない動物は default_icon)
    return {"animals": ANIMALS, "icons": ANIMAL_ICONS, "default_icon": DEFAULT_ANIMAL_ICON}


@router.get("/api/info")
async def api_info() -> dict:
    """PC画面に出す情報(スマホ用URL、設定値、接続状態)を返す。"""
    return {
        "phone_url": config.phone_url(),
        "phone_connected": ws_manager.phone_connected(),
        **config.current_settings(),
    }


@functools.lru_cache(maxsize=4)
def _qr_png(url: str) -> bytes:
    """URL の QR コード(PNG)。同じ URL なら作り直さない。"""
    buf = io.BytesIO()
    qrcode.make(url).save(buf, format="PNG")
    return buf.getvalue()


@router.get("/api/qr")
async def api_qr() -> Response:
    """スマホ用URLのQRコードをPNGで返す。"""
    png = await run_in_threadpool(_qr_png, config.phone_url())
    return Response(content=png, media_type="image/png")


@router.post("/api/capture-request")
async def api_capture_request() -> JSONResponse:
    """PCの「スマホでとる」ボタン。スマホに撮影の合図を送る。

    動物はスマホ側で選ぶので、ここでは送らない。
    """
    if not ws_manager.phone_connected():
        return JSONResponse(
            status_code=409,
            content={"ok": False, "error": "スマホがつながっていません"},
        )

    sent = await ws_manager.request_capture()
    logger.info("撮影の合図を送信: 送信先=%d台", sent)
    return JSONResponse({"ok": True, "sent": sent})
