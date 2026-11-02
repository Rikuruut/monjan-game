"""物の判定(テキスト用モデル)。

写真と動物の名前をモデルに渡し、モンスター情報をJSONで受け取る。
決まった形式で受け取るため、OpenAI APIの構造化出力(JSONスキーマ指定)を使う。
"""

from __future__ import annotations

import base64
import logging
import os
import time
from typing import Any, Literal

from pydantic import BaseModel

from .openai_client import allow_person, fusion_mode, get_client, is_dry_run
from .pricing import estimate_cost, format_cost
from .prompts import ELEMENTS, build_recognize_instructions, build_recognize_prompt
from .validator import validate_monster

logger = logging.getLogger(__name__)


class RecognizeError(RuntimeError):
    """判定に失敗したときのエラー。"""


class PartMapping(BaseModel):
    """置き換え対応表の1件(物のパーツ → 体の部位)。"""

    object_part: str   # 物のパーツ(例:持ち手の黒い輪)
    shape: str         # パーツの形(形の対応表の左の列)
    body_part: str     # 置き換える体の部位(例:たてがみの両側の飾り)


class DesignPlan(BaseModel):
    """融合デザイン(画像生成プロンプトに差し込む設計図)。

    画像生成モデルに「どう融合させるか」を先に決めて渡すための項目。
    ※ 以前あった body / weapon / ability / pose は、画像生成で使わなくなったうえ、
      判定がタイムアウトする原因になったので外した(2026年10月29日)。
    """

    animal_body: str                 # 生き物本来の体のつくり(脚・翼・ひれ・しっぽの数と形)
    parts_mapping: list[PartMapping]  # 置き換え対応表(2〜3件)


class MonsterInfo(BaseModel):
    """モデルに返してもらう形式(構造化出力のスキーマになる)。

    element は6種類に限定するので、モデル側でも選択肢が守られやすくなる。
    それでも念のため validator.py でもう一度チェックする。
    """

    needs_retake: bool
    retake_reason: str
    object_name: str
    element: Literal["あつい", "みず", "でんき", "かたい", "とがってる", "やわらかい"]
    monster_name: str
    description: str
    design_plan: DesignPlan


def _to_data_url(photo_bytes: bytes) -> str:
    """写真をdata URL(base64)にして、画像入力として渡せる形にする。"""
    b64 = base64.b64encode(photo_bytes).decode("ascii")
    return f"data:image/jpeg;base64,{b64}"


def _read_usage(response: Any, model: str) -> dict[str, Any]:
    """返答に含まれるトークン数を読み、料金を試算する。

    料金を把握しておきたいので、使ったトークン数は必ず記録する。
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}

    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0

    # 画像入力の分は内訳として分かれていないので、まとめてテキスト入力として試算する
    cost = estimate_cost(model, text_input_tokens=input_tokens, output_tokens=output_tokens)

    return {
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "total_tokens": getattr(usage, "total_tokens", input_tokens + output_tokens) or 0,
        "estimated_cost_usd": None if cost is None else round(cost, 6),
    }


def recognize(
    photo_bytes: bytes, animal: str
) -> tuple[dict[str, Any], list[str], float, str, dict[str, Any]]:
    """写真と動物からモンスター情報を作る。

    戻り値は (モンスター情報, 補正のメモ, かかった秒数, 使ったモデル名, 使用量) 。
    """
    model = (os.getenv("TEXT_MODEL") or "").strip()
    if not model:
        raise RecognizeError(".envの TEXT_MODEL が設定されていません")

    # からうちモード:APIを呼ばずに決まった結果を返す(料金0円)
    if is_dry_run():
        logger.info("からうちモード(DRY_RUN)のため、判定のAPIは呼びません")
        monster, notes = validate_monster({
            "needs_retake": False,
            "retake_reason": "",
            "object_name": "ダミーのもの",
            "element": "かたい",
            "monster_name": "ダミーモン",
            "description": "からうちモードの ダミーの モンスター",
            "design_plan": {
                "animal_body": "4本脚。肉球と爪のある足。長いしっぽ",
                "parts_mapping": [
                    {"object_part": "ダミーの輪", "shape": "輪・穴", "body_part": "耳"},
                    {"object_part": "ダミーの棒", "shape": "細長い棒・刃", "body_part": "しっぽ"},
                ],
            },
        })
        notes = notes + ["からうちモード(DRY_RUN)のため、APIは呼んでいません"]
        return monster, notes, 0.0, f"{model}(からうち)", {}

    client = get_client()
    started = time.monotonic()

    try:
        # 構造化出力(JSONスキーマ指定)で受け取る
        response = client.responses.parse(
            model=model,
            instructions=build_recognize_instructions(allow_person(), fusion_mode()),
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": build_recognize_prompt(animal)},
                        {"type": "input_image", "image_url": _to_data_url(photo_bytes)},
                    ],
                }
            ],
            text_format=MonsterInfo,
        )
    except Exception as e:
        elapsed = time.monotonic() - started
        logger.warning("判定に失敗しました(%.1f秒): %s", elapsed, e)
        raise RecognizeError(f"判定の呼び出しに失敗しました: {type(e).__name__}: {e}") from e

    elapsed = time.monotonic() - started

    parsed = response.output_parsed
    if parsed is None:
        # 形式が読めなかった場合は、validator側ですべて既定値にする
        logger.warning("判定の返答を読み取れませんでした(refusal など)")
        monster, notes = validate_monster(None)
    else:
        monster, notes = validate_monster(parsed.model_dump())

    usage = _read_usage(response, model)

    logger.info("判定が完了しました(%.1f秒, %sトークン, 試算 %s): %s",
                elapsed, usage.get("total_tokens", "?"),
                format_cost(usage.get("estimated_cost_usd")), monster)
    return monster, notes, elapsed, model, usage
