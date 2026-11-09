"""WebSocketの接続管理。

PC用とスマホ用の接続をそれぞれ保持し、片方からもう片方へ合図を送れるようにする。
接続が切れていても例外でサーバーが止まらないように、送信は常に例外を捕まえる。
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)

# 受け付けるロール
ROLE_PC = "pc"
ROLE_PHONE = "phone"


class WSManager:
    """役割(PC / スマホ)ごとにWebSocket接続をまとめて管理する。"""

    def __init__(self) -> None:
        # 同じ役割で複数つながっても動くように集合で持つ
        self._connections: dict[str, set[WebSocket]] = {
            ROLE_PC: set(),
            ROLE_PHONE: set(),
        }

    # ------------------------------------------------------------------
    # 接続の出入り
    # ------------------------------------------------------------------
    async def connect(self, role: str, ws: WebSocket) -> None:
        """接続を受け付けて登録する。"""
        await ws.accept()
        self._connections[role].add(ws)
        logger.info("WebSocket接続: role=%s (現在 pc=%d, phone=%d)",
                    role, self.count(ROLE_PC), self.count(ROLE_PHONE))

        if role == ROLE_PHONE:
            # スマホがつながったことをPCに知らせる
            await self.notify_phone_status()
        else:
            # つないだPCに、今のスマホの接続状態をすぐ伝える
            await self.send_to(ws, {"type": "phone_status",
                                   "connected": self.count(ROLE_PHONE) > 0})

    async def disconnect(self, role: str, ws: WebSocket) -> None:
        """接続を登録から外す。"""
        self._connections[role].discard(ws)
        logger.info("WebSocket切断: role=%s (現在 pc=%d, phone=%d)",
                    role, self.count(ROLE_PC), self.count(ROLE_PHONE))

        if role == ROLE_PHONE:
            await self.notify_phone_status()

    def count(self, role: str) -> int:
        """その役割の接続数を返す。"""
        return len(self._connections.get(role, ()))

    def phone_connected(self) -> bool:
        """スマホがつながっているか。"""
        return self.count(ROLE_PHONE) > 0

    # ------------------------------------------------------------------
    # 送信
    # ------------------------------------------------------------------
    async def send_to(self, ws: WebSocket, message: dict[str, Any]) -> bool:
        """1つの接続へ送る。失敗しても無視する(切断済みなど)。送れたかを返す。"""
        try:
            await ws.send_json(message)
            return True
        except Exception:
            logger.debug("WebSocket送信に失敗(無視)", exc_info=True)
            return False

    async def broadcast(self, role: str, message: dict[str, Any]) -> int:
        """その役割の全接続へ送る。送れなかった接続は外す。送れた件数を返す。"""
        sent = 0
        # 送信中に集合が変わる可能性があるのでコピーしてから回す
        for ws in list(self._connections.get(role, ())):
            if await self.send_to(ws, message):
                sent += 1
            else:
                self._connections[role].discard(ws)
        return sent

    # ------------------------------------------------------------------
    # 仕様で決めたメッセージ
    # ------------------------------------------------------------------
    async def notify_phone_status(self) -> None:
        """スマホの接続状態をPCに知らせる。"""
        await self.broadcast(ROLE_PC, {
            "type": "phone_status",
            "connected": self.phone_connected(),
        })

    async def request_capture(self) -> int:
        """スマホに撮影の合図を送る。送れた件数を返す。

        動物はスマホ側で選ぶので、ここでは渡さない。
        """
        return await self.broadcast(ROLE_PHONE, {
            "type": "capture_request",
        })

    async def notify_photo_received(self, photo_id: str, photo_url: str, animal: str) -> None:
        """写真が届いたことを、スマホで選ばれた動物と一緒にPCに知らせる。"""
        await self.broadcast(ROLE_PC, {
            "type": "photo_received",
            "photo_id": photo_id,
            "photo_url": photo_url,
            "animal": animal,
        })

    async def notify_progress(self, stage: str, **extra: Any) -> None:
        """生成の進み具合をPCに知らせる(ローディングの表示に使う)。

        stage は次のどれか。
          naming  :判定(名前などを考えている)を始めた
          drawing :画像生成を始めた(expected_seconds に、かかる時間の目安を入れる)
          done    :すべて終わった(image_url に、できたモンスターの絵のURLを入れる)
          retake  :撮り直しと判定された
          error   :失敗した
        """
        # PCとスマホの両方に送る(どちらにもローディングを出すため)
        message = {"type": "progress", "stage": stage, **extra}
        await self.broadcast(ROLE_PC, message)
        await self.broadcast(ROLE_PHONE, message)

    async def notify_revealed(self, photo_id: str, image_url: str) -> None:
        """PC の大画面でモンスターが登場し終わったことを、スマホに知らせる(スマホはここで絵を見せる)。"""
        await self.broadcast(ROLE_PHONE, {"type": "revealed", "photo_id": photo_id, "image_url": image_url})

    async def notify_name_chosen(self, photo_id: str, name: str) -> None:
        """子供がスマホで名前を選んだことをPCに知らせる(カードの名前を書きかえるため)。"""
        await self.broadcast(ROLE_PC, {"type": "name_chosen", "photo_id": photo_id, "name": name})

    async def notify_upload_done(self, photo_id: str) -> None:
        """受け取り完了をスマホに知らせる。"""
        await self.broadcast(ROLE_PHONE, {
            "type": "upload_done",
            "photo_id": photo_id,
        })


# サーバーで1つだけ使う(app/routes/・app/pipeline.py から送る)
ws_manager = WSManager()
