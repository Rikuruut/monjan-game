"""AIの返答のチェックと補正。

CLAUDE.md のチェックのルールに従って、不正な値をデフォルト値で補う。

| 項目 | ルール | 不正なときの扱い |
|---|---|---|
| element | 6種類のどれか | 「かたい」にする |
| monster_name | 10文字以内 | 10文字で切る。空なら「なぞのモンスター」 |
| description | 40文字以内 | 40文字で切る |
| object_name | 空でない | 「なにかのもの」にする |
| design_plan | 文の項目が空でなく120文字以内 | 既定値にする / 切り詰める |
| design_plan.parts_mapping | 1〜3件。各項目が空でなく30文字以内 | 不正な件は捨てる / 0件なら既定値 |
| JSON全体 | 形式が正しい | すべてデフォルト値にする |
"""

from __future__ import annotations

import logging
from typing import Any

from .prompts import (
    DEFAULT_DESIGN_PLAN,
    DEFAULT_ELEMENT,
    DEFAULT_PARTS_MAPPING,
    ELEMENTS,
    MAX_PARTS_MAPPING,
)

logger = logging.getLogger(__name__)

# 文字数の上限
MAX_MONSTER_NAME = 10
MAX_DESCRIPTION = 40
MAX_RETAKE_REASON = 60
# 融合デザインの各項目の上限(画像プロンプトが長くなりすぎないように)
MAX_DESIGN_FIELD = 120
# 置き換え対応表の各項目の上限
MAX_PART_FIELD = 30

# 不正なときに使う値
DEFAULT_OBJECT_NAME = "なにかのもの"
DEFAULT_MONSTER_NAME = "なぞのモンスター"
DEFAULT_DESCRIPTION = "なぞに つつまれた モンスター"

# 形式がまったく読めなかったときに返す内容
DEFAULT_MONSTER: dict[str, Any] = {
    "needs_retake": False,
    "retake_reason": "",
    "object_name": DEFAULT_OBJECT_NAME,
    "element": DEFAULT_ELEMENT,
    "monster_name": DEFAULT_MONSTER_NAME,
    "description": DEFAULT_DESCRIPTION,
    "design_plan": {
        **DEFAULT_DESIGN_PLAN,
        "parts_mapping": [dict(d) for d in DEFAULT_PARTS_MAPPING],
    },
}


def _as_text(value: Any) -> str:
    """文字列として取り出す。文字列でなければ空文字にする。"""
    return value.strip() if isinstance(value, str) else ""


def _validate_parts_mapping(raw: Any, notes: list[str]) -> list[dict[str, str]]:
    """置き換え対応表をチェックする。

    不正な件は捨て、多すぎる分は切る。1件も残らなければ既定値にする。
    """
    if not isinstance(raw, list):
        if raw is not None:
            notes.append("design_plan.parts_mapping の形式が読めないので既定値にしました")
        raw = []

    rows: list[dict[str, str]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        row = {}
        for key in ("object_part", "shape", "body_part"):
            value = _as_text(item.get(key))
            if len(value) > MAX_PART_FIELD:
                value = value[:MAX_PART_FIELD]
                notes.append(f"parts_mapping.{key} が長いので{MAX_PART_FIELD}文字で切りました")
            row[key] = value
        # 物のパーツと置き換え先がそろっていない件は使えないので捨てる
        if not row["object_part"] or not row["body_part"]:
            notes.append("parts_mapping に空の件があったので捨てました")
            continue
        rows.append(row)

    if len(rows) > MAX_PARTS_MAPPING:
        rows = rows[:MAX_PARTS_MAPPING]
        notes.append(f"parts_mapping が多いので{MAX_PARTS_MAPPING}件に切りました")
    if not rows:
        rows = [dict(d) for d in DEFAULT_PARTS_MAPPING]
        notes.append("parts_mapping が空なので既定値にしました")
    return rows


def validate_monster(raw: Any) -> tuple[dict[str, Any], list[str]]:
    """AIの返答をチェックして補正する。

    戻り値は (補正後の内容, 補正した項目のメモ) 。
    メモは、何を直したかをPC画面やログで確認するために使う。
    """
    notes: list[str] = []

    # JSON全体の形式が正しくない場合は、すべてデフォルト値にする
    if not isinstance(raw, dict):
        logger.warning("判定の返答が辞書ではありません: %r", type(raw))
        return dict(DEFAULT_MONSTER), ["返答の形式が読めなかったので、すべて既定値にしました"]

    # --- 撮り直しの判定 ---
    needs_retake = raw.get("needs_retake")
    if not isinstance(needs_retake, bool):
        notes.append("needs_retake が true/false ではないので false にしました")
        needs_retake = False

    retake_reason = _as_text(raw.get("retake_reason"))
    if len(retake_reason) > MAX_RETAKE_REASON:
        retake_reason = retake_reason[:MAX_RETAKE_REASON]
        notes.append(f"retake_reason が長いので{MAX_RETAKE_REASON}文字で切りました")
    if needs_retake and not retake_reason:
        retake_reason = "もういちど とってみてね"
        notes.append("撮り直しの理由が空だったので、既定の文にしました")
    if not needs_retake and retake_reason:
        # 撮り直しでないのに理由が入っている場合は消す
        retake_reason = ""

    # --- 物の名前(空でないこと) ---
    object_name = _as_text(raw.get("object_name"))
    if not object_name:
        object_name = DEFAULT_OBJECT_NAME
        notes.append(f"object_name が空なので「{DEFAULT_OBJECT_NAME}」にしました")

    # --- 性質(6種類のどれか) ---
    element = _as_text(raw.get("element"))
    if element not in ELEMENTS:
        notes.append(
            f"element「{element or '(空)'}」は6種類に無いので「{DEFAULT_ELEMENT}」にしました"
        )
        element = DEFAULT_ELEMENT

    # --- モンスター名(10文字以内。空なら既定値) ---
    monster_name = _as_text(raw.get("monster_name"))
    if not monster_name:
        monster_name = DEFAULT_MONSTER_NAME
        notes.append(f"monster_name が空なので「{DEFAULT_MONSTER_NAME}」にしました")
    elif len(monster_name) > MAX_MONSTER_NAME:
        monster_name = monster_name[:MAX_MONSTER_NAME]
        notes.append(f"monster_name が長いので{MAX_MONSTER_NAME}文字で切りました")

    # --- 説明文(40文字以内) ---
    description = _as_text(raw.get("description"))
    if not description:
        description = DEFAULT_DESCRIPTION
        notes.append("description が空なので既定の文にしました")
    elif len(description) > MAX_DESCRIPTION:
        description = description[:MAX_DESCRIPTION]
        notes.append(f"description が長いので{MAX_DESCRIPTION}文字で切りました")

    # --- 融合デザイン(文の項目。空や長すぎるときは既定値・切り詰め) ---
    raw_plan = raw.get("design_plan")
    if not isinstance(raw_plan, dict):
        if raw_plan is not None:
            notes.append("design_plan の形式が読めないので既定値にしました")
        raw_plan = {}
    design_plan: dict[str, Any] = {}
    for key, default_value in DEFAULT_DESIGN_PLAN.items():
        value = _as_text(raw_plan.get(key))
        if not value:
            value = default_value
            notes.append(f"design_plan.{key} が空なので既定値にしました")
        elif len(value) > MAX_DESIGN_FIELD:
            value = value[:MAX_DESIGN_FIELD]
            notes.append(f"design_plan.{key} が長いので{MAX_DESIGN_FIELD}文字で切りました")
        design_plan[key] = value
    design_plan["parts_mapping"] = _validate_parts_mapping(raw_plan.get("parts_mapping"), notes)

    monster = {
        "needs_retake": needs_retake,
        "retake_reason": retake_reason,
        "object_name": object_name,
        "element": element,
        "monster_name": monster_name,
        "description": description,
        "design_plan": design_plan,
    }

    if notes:
        logger.info("判定の返答を補正しました: %s", " / ".join(notes))

    return monster, notes
