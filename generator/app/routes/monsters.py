"""できたモンスターを渡す(じゃんけんバトル・カード・開発者メニューの「作ったモンスターで戦う」)。API は呼ばない。"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse

from .. import config
from ..battle import DEMO_ID, demo_battle_monster, output_image_url, recent_monster_entry, to_battle_monster
from ..card import CARD_PDF_NAME, card_number, make_card_pdf, to_card
from ..kiosk import find_browser
from ..session import find_monster
from ..storage import MONSTER_NAME, OUTPUT_NAME_PATTERN, iter_finished_outputs

logger = logging.getLogger(__name__)

router = APIRouter()

RECENT_MONSTERS_LIMIT = 30


@router.get(f"/api/battle-monster/{DEMO_ID}")
async def api_battle_monster_demo(name: str | None = None) -> JSONResponse:
    """テストプレイ・確認用の見本(ゴリラ × はさみ)を、バトルが読む形で返す(バトルの /battle/?play=demo が読む)。
    下の {photo_id} より先に書く(先に書いたほうが使われる)。"""
    return JSONResponse(demo_battle_monster(name))


@router.get("/api/battle-monster/{photo_id}")
async def api_battle_monster(photo_id: str) -> JSONResponse:
    """できたモンスターを、じゃんけんバトルが読む形で返す(バトルの /battle/?photo=<photo_id> が読む)。

    photo_id の代わりに outputs/ のフォルダ名も受け付ける(開発者メニューの「作ったモンスターで戦う」。
    サーバーを再起動したあとでも、前に作ったモンスターで戦える)。
    """
    _, result, image = await run_in_threadpool(find_monster, photo_id)
    return JSONResponse(to_battle_monster(photo_id, result, image=image))


# ----------------------------------------------------------------------
# モンスターカード(印刷用。2026年11月9日の試作。app/card.py・static/card/)
# ----------------------------------------------------------------------
def _card_data(monster_id: str) -> dict:
    out_name, result, _ = find_monster(monster_id)
    # 絵は、サーバーを再起動したあとでも見られるフォルダ名の URL にする
    monster = to_battle_monster(monster_id, result, image=output_image_url(out_name))
    no = card_number(config.OUTPUTS_DIR, out_name, result)
    return to_card(monster, result.get("created_at") or "", no)


@router.get("/api/card-data/{monster_id}")
async def api_card_data(monster_id: str, name: str | None = None) -> JSONResponse:
    """カードに載せる情報。demo は見本のゴリラ × はさみ(?name= で名前)。"""
    if monster_id == DEMO_ID:
        return JSONResponse(to_card(demo_battle_monster(name), no=0))
    return JSONResponse(await run_in_threadpool(_card_data, monster_id))


@router.post("/api/card-pdf/{monster_id}")
async def api_card_pdf(monster_id: str) -> JSONResponse:
    """カードを PDF にして outputs/<フォルダ>/card.pdf に残す(ブラウザを画面に出さずに使う。API は使わない)。"""
    if monster_id == DEMO_ID:
        return JSONResponse({"ok": False, "error": "見本のモンスターは PDF にしません"}, status_code=400)
    out_name, _, _ = await run_in_threadpool(find_monster, monster_id)
    browser = find_browser()
    if browser is None:
        return JSONResponse({"ok": False, "error": "ブラウザ(Edge / Chrome)が見つかりません"}, status_code=500)
    out_path = config.OUTPUTS_DIR / out_name / CARD_PDF_NAME
    url = f"http://localhost:{config.PORT}/card?id={out_name}"
    try:
        # ブラウザがこのサーバーからカードのページを読むので、待つあいだもサーバーが止まらないよう別のスレッドで
        await run_in_threadpool(make_card_pdf, browser, url, out_path)
    except RuntimeError as e:
        logger.warning("カードの PDF を作れませんでした(%s): %s", out_name, e)
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    logger.info("カードの PDF を保存しました: %s", out_path)
    return JSONResponse({"ok": True, "output_dir": out_name, "file": CARD_PDF_NAME})


# ----------------------------------------------------------------------
# 開発者メニューの「作ったモンスターで戦う」(outputs/ に残っている絵から選ぶ)
# ----------------------------------------------------------------------
def _recent_monsters() -> list[dict]:
    monsters = []
    for out_name, result in iter_finished_outputs(config.OUTPUTS_DIR, newest_first=True):
        if result.get("needs_retake"):
            continue
        monsters.append(recent_monster_entry(out_name, result))
        if len(monsters) >= RECENT_MONSTERS_LIMIT:
            break
    return monsters


@router.get("/api/recent-monsters")
async def api_recent_monsters() -> dict:
    """outputs/ にある、絵までできたモンスター(新しい順に最大30件)。"""
    return {"monsters": await run_in_threadpool(_recent_monsters)}


@router.get("/api/output-image/{out_name}")
async def api_output_image(out_name: str) -> FileResponse:
    """outputs/<out_name>/ のモンスターの絵。フォルダ名の形を確かめて、outputs/ の外は読ませない。"""
    if not OUTPUT_NAME_PATTERN.match(out_name or ""):
        raise HTTPException(status_code=400, detail="フォルダの名前の形が正しくありません")
    path = config.OUTPUTS_DIR / out_name / MONSTER_NAME
    if not path.is_file():
        raise HTTPException(status_code=404, detail="その絵は見つかりませんでした")
    return FileResponse(path, media_type="image/png")
