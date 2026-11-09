"""撮影 → 合体 → 誕生(写真を受け取る・生成する・名前を選ぶ・絵を返す)。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response

from .. import config, pipeline, session
from ..battle import monster_image_url
from ..storage import MONSTER_NAME
from ..uploads import check_photo_id, photo_path, save_upload
from ..ws_manager import ws_manager

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/api/upload")
async def api_upload(
    photo: UploadFile = File(...),
    animal: str = Form(""),
) -> JSONResponse:
    """スマホから写真と、スマホで選ばれた動物を受け取る。

    動物の名前は`photo_id`に紐づけて覚えておき、生成のときに使う(app/uploads.py)。
    """
    data = await photo.read()
    if not data:
        raise HTTPException(status_code=400, detail="写真が空です")

    photo_id, animal_name = await run_in_threadpool(save_upload, data, animal)
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


@router.get("/api/photo/{photo_id}")
async def api_photo(photo_id: str) -> FileResponse:
    """スマホから届いた写真(PC画面に出す)。"""
    path = photo_path(check_photo_id(photo_id))
    if not path.is_file():
        raise HTTPException(status_code=404, detail="その写真は見つかりませんでした")
    return FileResponse(path, media_type="image/jpeg")


@router.get("/api/monster-image/{photo_id}")
async def api_monster_image(photo_id: str) -> FileResponse:
    """できたモンスターの絵(PC画面とスマホに出す)。サーバーを再起動すると、前の絵はここからは見られない。"""
    out_name = session.photo_outputs.get(check_photo_id(photo_id))
    path = config.OUTPUTS_DIR / out_name / MONSTER_NAME if out_name else None
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="その絵は見つかりませんでした")
    return FileResponse(path, media_type="image/png")


@router.get("/api/partial-image/{photo_id}/{index}")
async def api_partial_image(photo_id: str, index: int) -> Response:
    """画像生成の途中の絵(PC画面のがったい中に、うずの中心に透かして見せる)。"""
    png = pipeline.partials.get(check_photo_id(photo_id), {}).get(index)
    if png is None:
        raise HTTPException(status_code=404, detail="その途中の絵は見つかりませんでした")
    return Response(content=png, media_type="image/png")


@router.post("/api/generate")
async def api_generate(photo_id: str = Form(...)) -> JSONResponse:
    """判定と画像生成を実行して、結果を保存する(app/pipeline.py)。"""
    return await pipeline.generate(photo_id)


@router.post("/api/revealed")
async def api_revealed(photo_id: str = Form(...)) -> JSONResponse:
    """PC 画面で誕生の演出が終わったことを受け取り、スマホにも絵を見せるよう知らせる。

    ※ 2026年11月2日:それまでスマホは、絵ができた(done)ときにすぐ絵を見せていたので、
      PC のたまごが割れる前に、スマホにモンスターが出てしまっていた。
    """
    if check_photo_id(photo_id) not in session.photo_outputs:
        raise HTTPException(status_code=404, detail="その写真のモンスターは見つかりませんでした")
    choices = session.name_choices.get(photo_id) or [""]
    name = session.chosen_names.get(photo_id) or choices[0]
    await ws_manager.notify_revealed(photo_id, monster_image_url(photo_id), name)
    return JSONResponse({"ok": True})


@router.post("/api/choose-name")
async def api_choose_name(photo_id: str = Form(...), name: str = Form(...)) -> JSONResponse:
    """子供が PC の3つのボタンで選んだ名前を受け取る(core.js の chooseName。2026年11月9日まではスマホで選んでいた)。

    画像を作っている途中なら、保存のときにその名前にする。
    画像ができたあとなら、保存した result.json の名前を書きかえる。
    どちらの場合も、PC画面のカードの名前を書きかえるよう知らせる。
    """
    choices = session.name_choices.get(photo_id)
    if not choices:
        raise HTTPException(status_code=404, detail="この写真の名前の候補が見つかりません")
    if name not in choices:
        raise HTTPException(status_code=400, detail="候補にない名前です")

    session.chosen_names[photo_id] = name

    out_name = session.photo_outputs.get(photo_id)
    if out_name:
        await run_in_threadpool(session.save_chosen_name, out_name, name)

    await ws_manager.notify_name_chosen(photo_id, name)
    logger.info("子供が名前を選びました: %s → %s", photo_id, name)
    return JSONResponse({"ok": True, "name": name})
