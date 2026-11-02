"""モンじゃん! プロトタイプ のFastAPIサーバー。

PCのブラウザとスマホのブラウザの両方からアクセスして使う。
起動すると、スマホで開くURLをターミナルに表示する。
"""

from __future__ import annotations

import io
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Any

import qrcode
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from PIL import Image

from .animals import ANIMALS, normalize_animal
from .generator import get_generator
from .net_utils import get_lan_ip
from .openai_client import fusion_mode
from .pricing import format_cost, to_yen
from .recognizer import recognize
from .storage import append_usage_log, save_result
from .ws_manager import ROLE_PC, ROLE_PHONE, WSManager

# .envの読み込み
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("monjan")

# ディレクトリの場所
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
UPLOADS_DIR = BASE_DIR / "uploads"   # 届いた写真の一時置き場
OUTPUTS_DIR = BASE_DIR / "outputs"   # 生成結果の保存先

UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)

PORT = int(os.getenv("PORT", "8000"))

ws_manager = WSManager()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """起動したときに、スマホで開くURLをターミナルに表示する。"""
    ip = get_lan_ip()
    print("", flush=True)
    print("=" * 56)
    print("  モンじゃん! プロトタイプ サーバーを起動しました")
    print("=" * 56)
    print(f"  PC用ページ   : http://localhost:{PORT}/")
    print(f"  スマホ用ページ: http://{ip}:{PORT}/phone", flush=True)
    print("", flush=True)
    print("  ※ PCとスマホを同じWi-Fiにつないでください")
    print("=" * 56)
    print("", flush=True)
    yield


app = FastAPI(title="モンじゃん! プロトタイプ", lifespan=lifespan)

# 静的ファイルの配信
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")
app.mount("/outputs", StaticFiles(directory=OUTPUTS_DIR), name="outputs")


# ----------------------------------------------------------------------
# ページ
# ----------------------------------------------------------------------
@app.get("/")
async def page_pc() -> FileResponse:
    """PC用ページ。"""
    return FileResponse(STATIC_DIR / "pc.html")


@app.get("/phone")
async def page_phone() -> FileResponse:
    """スマホ用ページ。"""
    return FileResponse(STATIC_DIR / "phone.html")


# ----------------------------------------------------------------------
# WebSocket
# ----------------------------------------------------------------------
@app.websocket("/ws")
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


# ----------------------------------------------------------------------
# API
# ----------------------------------------------------------------------
@app.get("/api/animals")
async def api_animals() -> dict:
    """動物の一覧を返す。"""
    return {"animals": ANIMALS}


@app.get("/api/info")
async def api_info() -> dict:
    """PC画面に出す情報(スマホ用URL、設定値、接続状態)を返す。"""
    ip = get_lan_ip()
    return {
        "phone_url": f"http://{ip}:{PORT}/phone",
        "phone_connected": ws_manager.phone_connected(),
        "text_model": os.getenv("TEXT_MODEL", ""),
        "image_model": os.getenv("IMAGE_MODEL", ""),
        "image_quality": os.getenv("IMAGE_QUALITY", ""),
        "image_size": os.getenv("IMAGE_SIZE", ""),
        # 融合の強さ(calm / bold)。比べるときに、どちらで作ったか分かるように残す
        "fusion_mode": fusion_mode(),
    }


@app.get("/api/qr")
async def api_qr() -> Response:
    """スマホ用URLのQRコードをPNGで返す。"""
    ip = get_lan_ip()
    url = f"http://{ip}:{PORT}/phone"
    img = qrcode.make(url)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


@app.post("/api/capture-request")
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


@app.post("/api/upload")
async def api_upload(
    photo: UploadFile = File(...),
    animal: str = Form(""),
) -> JSONResponse:
    """スマホから写真と、スマホで選ばれた動物を受け取る。

    スマホ側でJPEGに変換済みの想定だが、念のためPillowで開けるかを確認する。
    動物の名前は`photo_id`に紐づけて覚えておき、生成のときに使う。
    """
    data = await photo.read()
    if not data:
        raise HTTPException(status_code=400, detail="写真が空です")

    # Pillowで開けるかを確認する
    try:
        img = Image.open(io.BytesIO(data))
        img.verify()  # 壊れていないかの確認
    except Exception as e:
        logger.warning("受け取った写真を開けませんでした: %s", e)
        raise HTTPException(status_code=400, detail=f"写真を読めませんでした: {e}")

    # 動物の名前を整える(一覧に無い名前でも通す。製品版の自由入力に備える)
    animal_name = normalize_animal(animal)

    # 保存する(IDはランダムな文字列)
    photo_id = uuid.uuid4().hex
    (UPLOADS_DIR / f"{photo_id}.jpg").write_bytes(data)

    # 動物の名前を写真と一緒に覚えておく
    (UPLOADS_DIR / f"{photo_id}.json").write_text(
        json.dumps({"animal": animal_name}, ensure_ascii=False),
        encoding="utf-8",
    )

    logger.info("写真を受け取りました: photo_id=%s animal=%s size=%dKB",
                photo_id, animal_name, len(data) // 1024)

    photo_url = f"/uploads/{photo_id}.jpg"

    # PCに「写真が届いた」と知らせる / スマホに受け取り完了を伝える
    await ws_manager.notify_photo_received(photo_id, photo_url, animal_name)
    await ws_manager.notify_upload_done(photo_id)

    return JSONResponse({
        "ok": True,
        "photo_id": photo_id,
        "photo_url": photo_url,
        "animal": animal_name,
    })


def build_usage(
    recognize_usage: dict[str, Any] | None,
    generate_usage: dict[str, Any] | None,
) -> dict[str, Any]:
    """判定と画像生成の使用量をまとめ、1回あたりの料金を試算する。

    どれだけAPIを使ったかを、結果のJSONとPC画面の両方で確認できるようにする。
    """
    recognize_cost = (recognize_usage or {}).get("estimated_cost_usd")
    generate_cost = (generate_usage or {}).get("estimated_cost_usd")

    costs = [c for c in (recognize_cost, generate_cost) if c is not None]
    total = round(sum(costs), 6) if costs else None

    usage = {
        "recognize": recognize_usage or {},
        "generate": generate_usage or {},
        "total_cost_usd": total,
        "total_cost_yen": None if total is None else round(to_yen(total), 2),
        "note": "料金は2026年10月28日時点の単価による試算です(app/pricing.py)",
    }

    # APIを使ったときだけ、累計の記録に1行足す(からうちモードは記録しない)
    if total:
        cumulative = append_usage_log(OUTPUTS_DIR, {
            "at": datetime.now().isoformat(timespec="seconds"),
            "cost_usd": total,
            "recognize_tokens": (recognize_usage or {}).get("total_tokens"),
            "generate_tokens": (generate_usage or {}).get("total_tokens"),
        })
        usage["cumulative_cost_usd"] = cumulative
        usage["cumulative_cost_yen"] = round(to_yen(cumulative), 2)

    return usage


def load_photo_animal(photo_id: str) -> str:
    """`photo_id`に紐づけて覚えておいた動物の名前を読み出す。"""
    meta_path = UPLOADS_DIR / f"{photo_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="その写真は見つかりませんでした")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("写真の情報を読めませんでした: %s", e)
        raise HTTPException(status_code=500, detail="写真の情報を読めませんでした")
    return normalize_animal(meta.get("animal"))


@app.post("/api/generate")
async def api_generate(photo_id: str = Form(...)) -> JSONResponse:
    """判定と画像生成を実行して、結果を保存する。

    動物はスマホから届いたものを`photo_id`から読み出して使う。
    エラーが起きてもサーバーは止めず、内容をPCの画面に出せる形で返す。
    """
    animal = load_photo_animal(photo_id)

    photo_path = UPLOADS_DIR / f"{photo_id}.jpg"
    if not photo_path.exists():
        raise HTTPException(status_code=404, detail="その写真は見つかりませんでした")
    photo_bytes = photo_path.read_bytes()

    logger.info("生成を開始します: photo_id=%s animal=%s", photo_id, animal)

    total_started = time.monotonic()
    settings: dict[str, Any] = {
        "animal": animal,
        "text_model": os.getenv("TEXT_MODEL", ""),
        "image_model": os.getenv("IMAGE_MODEL", ""),
        "image_quality": os.getenv("IMAGE_QUALITY", ""),
        "image_size": os.getenv("IMAGE_SIZE", ""),
        # 融合の強さ(calm / bold)。比べるときに、どちらで作ったか分かるように残す
        "fusion_mode": fusion_mode(),
    }

    # ------------------------------------------------------------------
    # 判定(テキスト用モデル)
    # ------------------------------------------------------------------
    try:
        monster, notes, recognize_seconds, text_model, recognize_usage = await run_in_threadpool(
            recognize, photo_bytes, animal
        )
        settings["text_model"] = text_model
    except Exception as e:
        logger.warning("判定に失敗しました: %s", e)
        return JSONResponse(
            status_code=200,
            content={"ok": False, "step": "判定", "error": str(e), "settings": settings},
        )

    # ------------------------------------------------------------------
    # 撮り直しが必要な場合は、ここで終了する
    # ------------------------------------------------------------------
    if monster["needs_retake"]:
        total_seconds = time.monotonic() - total_started
        timings = {"recognize": round(recognize_seconds, 2), "total": round(total_seconds, 2)}
        # 撮り直しのときは画像生成を呼ばないので、判定の分だけ料金がかかる
        usage = build_usage(recognize_usage, None)
        result = {
            "created_at": datetime.now().isoformat(timespec="seconds"),
            "animal": animal,
            "monster": monster,
            "validator_notes": notes,
            "settings": settings,
            "timings": timings,
            "usage": usage,
            "needs_retake": True,
        }
        await run_in_threadpool(save_result, OUTPUTS_DIR, photo_bytes, None, result)

        logger.info("撮り直しと判定されました: %s", monster["retake_reason"])
        return JSONResponse({
            "ok": True,
            "needs_retake": True,
            "retake_reason": monster["retake_reason"],
            "monster": monster,
            "validator_notes": notes,
            "settings": settings,
            "timings": timings,
            "usage": usage,
        })

    # ------------------------------------------------------------------
    # 画像生成
    # ------------------------------------------------------------------
    try:
        generation = await run_in_threadpool(
            get_generator().generate,
            photo_bytes,
            animal,
            monster["object_name"],
            monster["element"],
            monster.get("design_plan"),
        )
        settings["image_model"] = generation.model
        settings["image_quality"] = generation.quality
        settings["image_size"] = generation.size
    except Exception as e:
        logger.warning("画像生成に失敗しました: %s", e)
        return JSONResponse(
            status_code=200,
            content={
                "ok": False,
                "step": "画像生成",
                "error": str(e),
                "monster": monster,
                "validator_notes": notes,
                "settings": settings,
                "timings": {"recognize": round(recognize_seconds, 2),
                            "total": round(time.monotonic() - total_started, 2)},
                # 判定までは成功しているので、その分の料金は発生している
                "usage": build_usage(recognize_usage, None),
            },
        )

    total_seconds = time.monotonic() - total_started
    timings = {
        "recognize": round(recognize_seconds, 2),
        "generate": round(generation.elapsed_seconds, 2),
        "total": round(total_seconds, 2),
    }

    # ------------------------------------------------------------------
    # 保存
    # ------------------------------------------------------------------
    usage = build_usage(recognize_usage, generation.usage)

    result = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "animal": animal,
        "monster": monster,
        "validator_notes": notes,
        "generator_notes": generation.notes,
        "settings": settings,
        "timings": timings,
        "usage": usage,
        "image_prompt": generation.prompt,
        "needs_retake": False,
    }
    out_dir = await run_in_threadpool(
        save_result, OUTPUTS_DIR, photo_bytes, generation.image_bytes, result
    )

    logger.info("生成が完了しました: %s (合計 %.1f秒, 試算 %s)",
                out_dir.name, total_seconds, format_cost(usage.get("total_cost_usd")))

    return JSONResponse({
        "ok": True,
        "needs_retake": False,
        "monster": monster,
        "validator_notes": notes,
        "generator_notes": generation.notes,
        "settings": settings,
        "timings": timings,
        "usage": usage,
        "monster_url": f"/outputs/{out_dir.name}/monster.png",
        "output_dir": out_dir.name,
    })


def main() -> None:
    """`python -m app.main` で起動するための入口。"""
    import uvicorn

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)


if __name__ == "__main__":
    main()
