"""モンじゃん! プロトタイプ のFastAPIサーバー。

PCのブラウザとスマホのブラウザの両方からアクセスして使う。
起動すると、スマホで開くURLをターミナルに表示する。
"""

from __future__ import annotations

import asyncio
import io
import json
import logging
import os
import re
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

from .animals import ANIMAL_ICONS, ANIMALS, DEFAULT_ANIMAL_ICON, normalize_animal
from .generator import get_generator
from .kiosk import kiosk_enabled, open_kiosk_in_background
from .net_utils import get_lan_ip
from .openai_client import image_prompt_style, is_dry_run
from .pricing import format_cost, to_yen
from .recognizer import generate_names, recognize
from .storage import MONSTER_NAME, RESULT_NAME, append_jsonl, append_usage_log, save_result
from .ws_manager import ROLE_PC, ROLE_PHONE, WSManager

# .envの読み込み
# override=True:ターミナルに同じ名前の環境変数が残っていても、.env の値を優先する。
# (2026年10月30日:.env を gpt-image-2.5-sunburst に変えたのに、起動したターミナルに残っていた
#   IMAGE_MODEL=gpt-image-2 が使われてしまったため。設定は .env にまとめる方針なので、.env を正とする)
load_dotenv(override=True)

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
    print("", flush=True)
    print("=" * 56)
    print("  モンじゃん! プロトタイプ サーバーを起動しました")
    print("=" * 56)
    print(f"  PC用ページ   : http://localhost:{PORT}/")
    print(f"  スマホ用ページ: {phone_url()}", flush=True)
    print("", flush=True)
    print("  ※ PCとスマホを同じWi-Fiにつないでください")
    print("=" * 56)
    print("", flush=True)
    yield


app = FastAPI(title="モンじゃん! プロトタイプ", lifespan=lifespan)

# 静的ファイルの配信
@app.middleware("http")
async def no_cache_for_pages(request, call_next):
    """画面のファイル(HTML・CSS・JavaScript)に「毎回、変わっていないか確認する」指示を付ける。

    ※ 2026年10月31日:PC画面を作り直したあと、ブラウザが古い pc.js と style.css を使い回し、
      新しい pc.html と組み合わさって画面が崩れた(サーバーへの読み込みが1回もなかった)。
      指示がないと、ブラウザは自分の判断で古いファイルを使うことがあるため。
      変わっていなければ短い返事(304)で済むので、表示は遅くならない。
    """
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/phone") or path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


# uploads/ と outputs/ は丸ごとは公開しない(届いた写真と、できた絵だけを下の API で返す)。
# ※ 2026年11月2日:それまでは両方を公開していて、outputs/ のフォルダ名は日時なので、
#   同じ Wi-Fi の誰でも、子供の写真(photo.jpg)や記録のファイルを推測して開けた
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def phone_url() -> str:
    """スマホで開くURL。"""
    return f"http://{get_lan_ip()}:{PORT}/phone"


def current_settings() -> dict[str, str]:
    """いまの .env の設定(モデル名・画質など)。PC画面と result.json に出す。"""
    return {
        "text_model": os.getenv("TEXT_MODEL", ""),
        "image_model": os.getenv("IMAGE_MODEL", ""),
        "image_quality": os.getenv("IMAGE_QUALITY", ""),
        "image_size": os.getenv("IMAGE_SIZE", ""),
        # 画像プロンプトの書き方(detailed / simple)。比べるときに、どちらで作ったか分かるように残す
        "image_prompt_style": image_prompt_style(),
    }


# ----------------------------------------------------------------------
# PC用ページのテーマ(見た目)
# ----------------------------------------------------------------------
# 見た目はテーマごとに static/themes/<テーマ名>/(index.html と style.css)に分けてあり、
# 動き(撮影・生成・場面の進行)は static/common/app.js が共通で受け持つ。
# /?theme=lab のように付けると、そのテーマで表示する。何も付けないときは .env の PC_THEME。
# 新しいテーマは、static/themes/ にフォルダを足すだけで選べるようになる(theme.json に表示名を書ける)。
THEMES_DIR = STATIC_DIR / "themes"
DEFAULT_PC_THEME = "lab"


def list_themes() -> list[dict[str, str]]:
    """使えるテーマの一覧(index.html があるフォルダ)。"""
    themes = []
    for d in sorted(THEMES_DIR.iterdir()) if THEMES_DIR.is_dir() else []:
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


def resolve_theme(theme: str | None) -> str:
    """指定されたテーマ名を、実際にあるテーマにそろえる。なければ PC_THEME、それもなければ lab。"""
    available = {t["id"] for t in list_themes()}
    for candidate in (theme, os.getenv("PC_THEME"), DEFAULT_PC_THEME):
        if candidate and candidate.strip() in available:
            return candidate.strip()
    return next(iter(sorted(available)), DEFAULT_PC_THEME)


@app.get("/")
async def page_pc(theme: str | None = None) -> FileResponse:
    """PC用ページ(展示の大画面)。?theme= で見た目を切りかえる。"""
    return FileResponse(THEMES_DIR / resolve_theme(theme) / "index.html")


@app.get("/api/themes")
async def api_themes() -> dict:
    """使えるテーマの一覧と、いま何も付けないときに使われるテーマ。"""
    return {"themes": list_themes(), "default": resolve_theme(None)}


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
    # icons は PC画面の「とどいたもの」で使う(一覧にない動物は default_icon)
    return {"animals": ANIMALS, "icons": ANIMAL_ICONS, "default_icon": DEFAULT_ANIMAL_ICON}


@app.get("/api/info")
async def api_info() -> dict:
    """PC画面に出す情報(スマホ用URL、設定値、接続状態)を返す。"""
    return {
        "phone_url": phone_url(),
        "phone_connected": ws_manager.phone_connected(),
        **current_settings(),
    }


@app.get("/api/qr")
async def api_qr() -> Response:
    """スマホ用URLのQRコードをPNGで返す。"""
    img = qrcode.make(phone_url())
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

    photo_url = f"/api/photo/{photo_id}"

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


# photo_id の形(アップロードのときに uuid4().hex で作る、32文字の16進数)
_PHOTO_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def _check_photo_id(photo_id: str) -> str:
    """photo_id の形を確かめる。

    ファイルの場所に使うので、uploads/ の外を指す値(../ など)は受け付けない。
    """
    if not _PHOTO_ID_PATTERN.match(photo_id or ""):
        raise HTTPException(status_code=400, detail="写真のIDの形が正しくありません")
    return photo_id


def _load_photo(photo_id: str) -> tuple[str, bytes]:
    """`photo_id`の写真と、紐づけて覚えておいた動物の名前を読み出す。"""
    _check_photo_id(photo_id)
    meta_path = UPLOADS_DIR / f"{photo_id}.json"
    photo_path = UPLOADS_DIR / f"{photo_id}.jpg"
    if not meta_path.exists() or not photo_path.exists():
        raise HTTPException(status_code=404, detail="その写真は見つかりませんでした")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("写真の情報を読めませんでした: %s", e)
        raise HTTPException(status_code=500, detail="写真の情報を読めませんでした")
    return normalize_animal(meta.get("animal")), photo_path.read_bytes()


def _remove_upload(photo_id: str) -> None:
    """生成が終わった写真を uploads/ から消す(写真は outputs/ に保存してあるので、ここにはためない)。"""
    for suffix in (".jpg", ".json"):
        try:
            (UPLOADS_DIR / f"{photo_id}{suffix}").unlink(missing_ok=True)
        except OSError as e:
            logger.warning("届いた写真を消せませんでした(処理は続けます): %s", e)


@app.get("/api/photo/{photo_id}")
async def api_photo(photo_id: str) -> FileResponse:
    """スマホから届いた写真(PC画面に出す)。"""
    path = UPLOADS_DIR / f"{_check_photo_id(photo_id)}.jpg"
    if not path.is_file():
        raise HTTPException(status_code=404, detail="その写真は見つかりませんでした")
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/monster-image/{photo_id}")
async def api_monster_image(photo_id: str) -> FileResponse:
    """できたモンスターの絵(PC画面とスマホに出す)。サーバーを再起動すると、前の絵はここからは見られない。"""
    out_name = _photo_outputs.get(_check_photo_id(photo_id))
    path = OUTPUTS_DIR / out_name / MONSTER_NAME if out_name else None
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="その絵は見つかりませんでした")
    return FileResponse(path, media_type="image/png")


# 画像生成にかかる時間の目安(秒)。ローディングの「もうすぐ!」の切り替えに使う。
# 最初は実測(gpt-image-2.5-sunburst / high で約39秒、medium で約24秒)の間くらいにしておき、
# 生成するたびに前回の実測で置きかえる
_last_generate_seconds: float = 30.0

# 名前を子供が選ぶための記録(photo_id ごと。サーバーを再起動すると消える)
#   _name_choices :選べる名前の候補(判定が終わったときに決まる)
#   _chosen_names :子供がスマホで選んだ名前
#   _photo_outputs:保存先のフォルダ(名前を選んだときに result.json を書きかえるためと、絵を返すため)
_name_choices: dict[str, list[str]] = {}
_chosen_names: dict[str, str] = {}
_photo_outputs: dict[str, str] = {}

# 生成は1つずつ(PCのタブが2つあるときなどに、2回呼ばれて料金が2回かからないように)
_generate_lock = asyncio.Lock()


def _seconds_since(started: float) -> float:
    return round(time.monotonic() - started, 2)


def _report(
    monster: dict[str, Any],
    notes: list[str],
    settings: dict[str, Any],
    timings: dict[str, float],
    usage: dict[str, Any],
    **extra: Any,
) -> dict[str, Any]:
    """result.json と画面への返事に共通する項目。"""
    return {"monster": monster, "validator_notes": notes, "settings": settings,
            "timings": timings, "usage": usage, **extra}


@app.post("/api/generate")
async def api_generate(photo_id: str = Form(...)) -> JSONResponse:
    """判定と画像生成を実行して、結果を保存する。

    動物はスマホから届いたものを`photo_id`から読み出して使う。
    エラーが起きてもサーバーは止めず、内容をPCの画面に出せる形で返す。
    生成中にもう一度呼ばれたら、409 を返す(同時に2つは作らない)。
    """
    if _generate_lock.locked():
        return JSONResponse(
            status_code=409,
            content={"ok": False, "step": "受付", "error": "ほかの生成が終わるまで待ってください"},
        )
    async with _generate_lock:
        animal, photo_bytes = _load_photo(photo_id)
        try:
            return await _generate(photo_id, animal, photo_bytes)
        except Exception as e:
            # 判定・画像生成の失敗は _generate の中で返す。ここに来るのは保存の失敗など、思わぬエラー。
            # スマホがローディングのまま止まらないよう、かならず error を知らせる
            logger.exception("生成の途中で思わぬエラーが起きました")
            await ws_manager.notify_progress("error")
            return JSONResponse(
                status_code=200,
                content={"ok": False, "step": "サーバー", "error": f"{type(e).__name__}: {e}"},
            )


async def _generate(photo_id: str, animal: str, photo_bytes: bytes) -> JSONResponse:
    """判定 → (撮り直しなら終了)→ 画像生成 → 保存。"""
    global _last_generate_seconds
    logger.info("生成を開始します: photo_id=%s animal=%s", photo_id, animal)

    total_started = time.monotonic()
    settings: dict[str, Any] = {"animal": animal, **current_settings()}

    # ------------------------------------------------------------------
    # 判定(テキスト用モデル)
    # ------------------------------------------------------------------
    # ローディング:「名前を かんがえているよ」
    await ws_manager.notify_progress("naming")
    try:
        recognized = await run_in_threadpool(recognize, photo_bytes, animal)
        settings["text_model"] = recognized.model
    except Exception as e:
        logger.warning("判定に失敗しました: %s", e)
        await ws_manager.notify_progress("error")
        return JSONResponse(
            status_code=200,
            content={"ok": False, "step": "判定", "error": str(e), "settings": settings},
        )
    monster, notes = recognized.monster, recognized.notes
    recognize_seconds = round(recognized.elapsed_seconds, 2)

    # ------------------------------------------------------------------
    # 撮り直しが必要な場合は、ここで終了する
    # ------------------------------------------------------------------
    if monster["needs_retake"]:
        # 撮り直しのときは画像生成を呼ばないので、判定の分だけ料金がかかる
        report = _report(
            monster, notes, settings,
            {"recognize": recognize_seconds, "total": _seconds_since(total_started)},
            build_usage(recognized.usage, None),
            needs_retake=True,
        )
        result = {"created_at": datetime.now().isoformat(timespec="seconds"), "animal": animal, **report}
        await run_in_threadpool(save_result, OUTPUTS_DIR, photo_bytes, None, result)
        _remove_upload(photo_id)

        logger.info("撮り直しと判定されました: %s", monster["retake_reason"])
        await ws_manager.notify_progress("retake", reason=monster["retake_reason"])
        return JSONResponse({"ok": True, "retake_reason": monster["retake_reason"], **report})

    # ------------------------------------------------------------------
    # 画像生成
    # ------------------------------------------------------------------
    # ローディング:「え を かいているよ」。かかる時間の目安(前回の実測)も送り、
    # 画面側で目安の7割を過ぎたら「もうすぐ!」に切り替える
    await ws_manager.notify_progress(
        "drawing",
        expected_seconds=round(_last_generate_seconds, 1),
        monster_name=monster.get("monster_name", ""),
        photo_id=photo_id,
        # 名前の候補(スマホの「ほかに さがす」で順番に見せる)。採用した名前を先頭にする
        name_choices=_remember_name_choices(photo_id, monster),
    )
    try:
        generation = await run_in_threadpool(
            get_generator().generate,
            photo_bytes,
            animal,
            monster["object_name"],
            monster["element"],
            monster.get("design_plan"),
            monster.get("has_person", False),
        )
        settings["image_model"] = generation.model
        settings["image_quality"] = generation.quality
        settings["image_size"] = generation.size
    except Exception as e:
        logger.warning("画像生成に失敗しました: %s", e)
        await ws_manager.notify_progress("error")
        # 判定までは成功しているので、その分の料金は発生している
        report = _report(
            monster, notes, settings,
            {"recognize": recognize_seconds, "total": _seconds_since(total_started)},
            build_usage(recognized.usage, None),
        )
        return JSONResponse(
            status_code=200,
            content={"ok": False, "step": "画像生成", "error": str(e), **report},
        )

    # 次のローディングで使う「画像生成にかかる時間の目安」を更新する(からうちモードの0秒は使わない)
    if generation.elapsed_seconds > 1:
        _last_generate_seconds = generation.elapsed_seconds

    # ------------------------------------------------------------------
    # 保存
    # ------------------------------------------------------------------
    # 画像を作っているあいだに、子供がスマホで名前を選んでいたら、その名前にする
    _apply_chosen_name(photo_id, monster)

    total_seconds = time.monotonic() - total_started
    usage = build_usage(recognized.usage, generation.usage)
    report = _report(
        monster, notes, settings,
        {"recognize": recognize_seconds,
         "generate": round(generation.elapsed_seconds, 2),
         "total": round(total_seconds, 2)},
        usage,
        generator_notes=generation.notes,
    )
    result = {
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "animal": animal,
        **report,
        "image_prompt": generation.prompt,
        "needs_retake": False,
    }
    out_dir = await run_in_threadpool(
        save_result, OUTPUTS_DIR, photo_bytes, generation.image_bytes, result
    )
    _photo_outputs[photo_id] = out_dir.name
    _remove_upload(photo_id)
    monster_url = f"/api/monster-image/{photo_id}"

    # ローディング:終わり。スマホにもモンスターの絵を見せるため、画像のURLも送る
    await ws_manager.notify_progress(
        "done",
        photo_id=photo_id,
        monster_name=monster.get("monster_name", ""),
        image_url=monster_url,
    )

    logger.info("生成が完了しました: %s (合計 %.1f秒, 試算 %s)",
                out_dir.name, total_seconds, format_cost(usage.get("total_cost_usd")))

    return JSONResponse({
        "ok": True,
        "needs_retake": False,
        **report,
        "monster_url": monster_url,
        "output_dir": out_dir.name,
    })


# ----------------------------------------------------------------------
# 名前を子供が選ぶ(スマホの「この なまえに する / ほかに さがす」)
# ----------------------------------------------------------------------
def _remember_name_choices(photo_id: str, monster: dict) -> list[str]:
    """選べる名前の候補を覚えて返す。採用した名前を先頭にし、チェックに合格した候補を後ろに並べる。"""
    choices = [monster.get("monster_name", "")]
    for c in monster.get("name_candidates") or []:
        if c.get("ok") and c.get("name") and c["name"] not in choices:
            choices.append(c["name"])
    choices = [c for c in choices if c]
    _name_choices[photo_id] = choices
    _chosen_names.pop(photo_id, None)
    return choices


def _apply_chosen_name(photo_id: str, monster: dict) -> None:
    """子供が選んだ名前があれば、モンスターの名前をそれにする。"""
    chosen = _chosen_names.get(photo_id)
    if chosen:
        monster["monster_name"] = chosen
        monster["name_chosen_by_child"] = True


@app.post("/api/choose-name")
async def api_choose_name(photo_id: str = Form(...), name: str = Form(...)) -> JSONResponse:
    """子供がスマホで選んだ名前を受け取る。

    画像を作っている途中なら、保存のときにその名前にする。
    画像ができたあとなら、保存した result.json の名前を書きかえる。
    どちらの場合も、PC画面のカードの名前を書きかえるよう知らせる。
    """
    choices = _name_choices.get(photo_id)
    if not choices:
        raise HTTPException(status_code=404, detail="この写真の名前の候補が見つかりません")
    if name not in choices:
        raise HTTPException(status_code=400, detail="候補にない名前です")

    _chosen_names[photo_id] = name

    out_name = _photo_outputs.get(photo_id)
    if out_name:
        result_path = OUTPUTS_DIR / out_name / RESULT_NAME
        try:
            data = json.loads(result_path.read_text(encoding="utf-8"))
            data["monster"]["monster_name"] = name
            data["monster"]["name_chosen_by_child"] = True
            result_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception as e:
            logger.warning("選んだ名前を result.json に書けませんでした(処理は続けます): %s", e)

    await ws_manager.notify_name_chosen(photo_id, name)
    logger.info("子供が名前を選びました: %s → %s", photo_id, name)
    return JSONResponse({"ok": True, "name": name})


# ----------------------------------------------------------------------
# 名前のテスト(写真も画像生成も使わず、モンスター名だけを何回か作って確かめる)
# ----------------------------------------------------------------------
# 名前のプロンプト(prompts.NAME_RULES)を調整するときに使う。
# 判定と同じ「名前のつけ方」とチェックを使うので、ここで良い名前が出れば判定でも出るはず。
# 料金は1回 0.1円以下(写真を送らず、短い文章だけのため)。結果は outputs/name_tests.jsonl に残す。
NAME_TEST_MAX_COUNT = 10
NAME_TEST_LOG_NAME = "name_tests.jsonl"


@app.post("/api/name-test")
async def api_name_test(
    animal: str = Form(...),
    object_name: str = Form(...),
    count: int = Form(5),
) -> JSONResponse:
    animal = normalize_animal(animal)
    object_name = (object_name or "").strip()[:30]
    if not object_name:
        raise HTTPException(status_code=400, detail="物の名前を入れてください")
    count = max(1, min(count, NAME_TEST_MAX_COUNT))

    # 1回ずつ別々に呼ぶ(展示で子供が1回ずつ遊ぶのと同じ条件で、名前のばらつきを見るため)
    results = await asyncio.gather(
        *(run_in_threadpool(generate_names, animal, object_name) for _ in range(count)),
        return_exceptions=True,
    )
    runs: list[dict] = []
    total_usd = 0.0
    for r in results:
        if isinstance(r, Exception):
            runs.append({"error": str(r)})
            continue
        runs.append(r)
        total_usd += (r.get("usage") or {}).get("estimated_cost_usd") or 0.0

    # 結果を残す(あとで見返して、名前のプロンプトの良し悪しを比べるため)
    entry = {
        "at": datetime.now().isoformat(timespec="seconds"),
        "animal": animal,
        "object_name": object_name,
        "names": [r.get("name") for r in runs if "name" in r],
        "runs": runs,
    }
    # からうちモードのダミーの名前は残さない
    if not is_dry_run():
        append_jsonl(OUTPUTS_DIR / NAME_TEST_LOG_NAME, entry)

    cumulative = None
    if total_usd:
        cumulative = append_usage_log(OUTPUTS_DIR, {
            "at": entry["at"],
            "cost_usd": round(total_usd, 6),
            "name_test_count": count,
        })

    return JSONResponse({
        "ok": True,
        "animal": animal,
        "object_name": object_name,
        "runs": runs,
        "total_cost_usd": round(total_usd, 6),
        "total_cost_yen": round(to_yen(total_usd), 2),
        "cumulative_cost_yen": None if cumulative is None else round(to_yen(cumulative), 2),
    })


def main() -> None:
    """`python -m app.main` で起動するための入口。"""
    import uvicorn

    # PC用ページをキオスクモードで開く(.env の KIOSK_MODE=false で開かない)。
    # uvicorn を直接動かしたとき(確認用の一時サーバーなど)は開かないよう、ここで行う
    if kiosk_enabled():
        open_kiosk_in_background(PORT)

    uvicorn.run("app.main:app", host="0.0.0.0", port=PORT, reload=False)


if __name__ == "__main__":
    main()
