"""いま遊んでいるモンスターの記録(photo_id ごと。サーバーを再起動すると消える)と、モンスターの探し方。

    name_choices :選べる名前の候補(判定が終わったときに決まる)
    chosen_names :子供がスマホで選んだ名前
    photo_outputs:保存先のフォルダ(名前を選んだときに result.json を書きかえるためと、絵を返すため)
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import HTTPException

from . import config
from .battle import output_image_url
from .storage import OUTPUT_NAME_PATTERN, read_result, write_result
from .uploads import check_photo_id

logger = logging.getLogger(__name__)

name_choices: dict[str, list[str]] = {}
chosen_names: dict[str, str] = {}
photo_outputs: dict[str, str] = {}


def remember_name_choices(photo_id: str, monster: dict) -> list[str]:
    """選べる名前の候補を覚えて返す。採用した名前を先頭にし、チェックに合格した候補を後ろに並べる。"""
    choices = [monster.get("monster_name", "")]
    for c in monster.get("name_candidates") or []:
        if c.get("ok") and c.get("name") and c["name"] not in choices:
            choices.append(c["name"])
    choices = [c for c in choices if c]
    name_choices[photo_id] = choices
    chosen_names.pop(photo_id, None)
    return choices


def apply_chosen_name(photo_id: str, monster: dict) -> None:
    """子供が選んだ名前があれば、モンスターの名前をそれにする。"""
    chosen = chosen_names.get(photo_id)
    if chosen:
        monster["monster_name"] = chosen
        monster["name_chosen_by_child"] = True


def save_chosen_name(out_name: str, name: str) -> None:
    """画像ができたあとに選んだ名前を、保存した result.json に書く(失敗しても処理は続ける)。"""
    out_dir = config.OUTPUTS_DIR / out_name
    try:
        data = read_result(out_dir)
        data["monster"]["monster_name"] = name
        data["monster"]["name_chosen_by_child"] = True
        write_result(out_dir, data)
    except Exception as e:
        logger.warning("選んだ名前を result.json に書けませんでした(処理は続けます): %s", e)


def find_monster(monster_id: str) -> tuple[str, dict[str, Any], str | None]:
    """photo_id か outputs/ のフォルダ名から、モンスターの記録を探す。

    戻り値は (outputs/ のフォルダ名, result.json の中身, 絵の URL)。
    絵の URL は、フォルダ名で探したときだけ /api/output-image/<フォルダ名>(photo_id のときは None = いま作った絵)。
    result.json を読むので、`run_in_threadpool` で呼ぶ。
    """
    if OUTPUT_NAME_PATTERN.match(monster_id or ""):
        result = read_result(config.OUTPUTS_DIR / monster_id)
        if result is None:
            raise HTTPException(status_code=404, detail="そのモンスターは見つかりませんでした")
        return monster_id, result, output_image_url(monster_id)

    out_name = photo_outputs.get(check_photo_id(monster_id))
    result = read_result(config.OUTPUTS_DIR / out_name) if out_name else None
    if result is None:
        raise HTTPException(status_code=404, detail="その写真のモンスターは見つかりませんでした")
    return out_name, result, None
