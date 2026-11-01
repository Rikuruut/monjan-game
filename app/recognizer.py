"""物の判定(テキスト用モデル)。

写真と動物の名前をモデルに渡し、モンスター情報をJSONで受け取る。
決まった形式で受け取るため、OpenAI APIの構造化出力(JSONスキーマ指定)を使う。
"""

from __future__ import annotations

import base64
import logging
import os
import random
import time
from typing import Any, Literal

from pydantic import BaseModel

from .openai_client import allow_person, get_client, image_prompt_style, is_dry_run
from .pricing import estimate_cost, format_cost
from .prompts import (
    ELEMENTS,
    FUSION_PARTS,
    FUSION_TYPES,
    NAME_TEST_INSTRUCTIONS,
    STAGING_OPTIONS,
    build_name_test_prompt,
    build_recognize_instructions,
    build_recognize_prompt,
    build_recognize_prompt_simple,
    fusion_part_candidates,
    fusion_part_place,
)
from .validator import choose_monster_name, validate_monster

logger = logging.getLogger(__name__)


class RecognizeError(RuntimeError):
    """判定に失敗したときのエラー。"""


class DesignPlan(BaseModel):
    """融合デザイン(画像生成プロンプトに差し込む設計図)。

    画像生成モデルに「どう融合させるか」を先に決めて渡すための項目。
    画像プロンプト(ChatGPTが考えたもの、2026年10月30日〜)の差し込み口に合わせている。
    """

    animal_identity: str    # 動物の特徴(顔つき・骨格・手足としっぽの数・足先の形)
    primary_fusion: str     # メインの融合(物のいちばん目立つ特徴を、どの部位にどう取り込むか)
    secondary_fusion: str   # サブの融合(2番目の特徴を、別の部位に控えめに)
    ability: str            # 能力(攻撃エフェクトとして描けるもの)
    pose: str               # ポーズ
    background: str         # 背景(動物のすみか × 物の使われ方)


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
    name_candidates: list[str]   # 名前の候補3つ(validator がチェックし、合格したものからランダムに選ぶ)
    description: str
    design_plan: DesignPlan
    has_person: bool   # 写真に人がはっきり写っているか(人モードで人の節を入れるかどうかに使う)


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


# 直前に選んだ融合の型(同じ型が続かないようにするため。サーバーを再起動すると忘れる)
_last_fusion_type: str | None = None


def choose_fusion_type() -> str:
    """融合の型を1つ選ぶ。

    `.env` の FUSION_TYPE に型の名前(weapon / body / armor)があればそれに固定し、
    なければ毎回ランダムに選ぶ(同じ物でもモンスターに個性が出るように)。
    ランダムのときは、直前と同じ型を選ばない(4回続けて武器型になったことがあったため)。
    """
    global _last_fusion_type
    fixed = (os.getenv("FUSION_TYPE") or "").strip().lower()
    if fixed in FUSION_TYPES:
        return fixed
    candidates = [t for t in FUSION_TYPES if t != _last_fusion_type] or list(FUSION_TYPES)
    _last_fusion_type = random.choice(candidates)
    return _last_fusion_type


# 直前に選んだ「物を取り込む場所」のパターン(同じ場所が続かないようにするため)
_last_fusion_part: str | None = None


def choose_fusion_part(animal: str) -> str:
    """物を取り込む場所のパターンを1つ選ぶ(短いプロンプト用)。

    `.env` の FUSION_PART にパターンの名前(jaw / tail / back / head / arm / armor / silhouette)があれば
    それに固定する(パターンごとに崩れないか確かめるとき用。動物の一覧に無いパターンでも使う)。
    なければ、その動物で使うパターンの中からランダムに選ぶ。直前と同じパターンは選ばない。
    """
    global _last_fusion_part
    fixed = (os.getenv("FUSION_PART") or "").strip().lower()
    if fixed in FUSION_PARTS:
        return fixed
    pool = fusion_part_candidates(animal)
    candidates = [k for k in pool if k != _last_fusion_part] or pool
    _last_fusion_part = random.choice(candidates)
    return _last_fusion_part


def _set_fusion_part(design_plan: dict[str, Any], animal: str, part: str) -> None:
    """選んだパターンを design_plan に入れる(画像プロンプトと result.json・PC画面で使う)。"""
    design_plan["fusion_part"] = part
    design_plan["fusion_part_label"] = (
        f"{FUSION_PARTS[part]['label']}({fusion_part_place(animal, part)})"
    )


def choose_staging() -> dict[str, str]:
    """演出(ポーズ・視点・表情・時間帯と天気)を、項目ごとにランダムに1つずつ選ぶ。

    大きな方向だけを決め、中身は判定と画像モデルにまかせる(prompts.STAGING_OPTIONS のコメント参照)。
    """
    return {key: random.choice(options) for key, options in STAGING_OPTIONS.items()}


def recognize(
    photo_bytes: bytes, animal: str
) -> tuple[dict[str, Any], list[str], float, str, dict[str, Any]]:
    """写真と動物からモンスター情報を作る。

    戻り値は (モンスター情報, 補正のメモ, かかった秒数, 使ったモデル名, 使用量) 。
    """
    model = (os.getenv("TEXT_MODEL") or "").strip()
    if not model:
        raise RecognizeError(".envの TEXT_MODEL が設定されていません")

    # 短い画像プロンプト(simple)かどうか。simple では、画像に伝えるのと同じ内容だけを判定に伝える
    # (説明文と画像の食い違いをふせぐため。prompts.build_recognize_prompt_simple 参照)
    simple = image_prompt_style() == "simple"

    # 融合の型を先に選ぶ。選んだ型は design_plan に入れて、画像プロンプトと result.json に渡す
    # (simple では画像に使わないので選ばない)
    fusion_type = "" if simple else choose_fusion_type()
    # 演出も先に選ぶ。融合の型と同じく、design_plan に入れて画像プロンプトと result.json に渡す
    staging = choose_staging()
    # 物を取り込む場所のパターン(短いプロンプトで使う)
    fusion_part = choose_fusion_part(animal)

    # からうちモード:APIを呼ばずに決まった結果を返す(料金0円)
    if is_dry_run():
        logger.info("からうちモード(DRY_RUN)のため、判定のAPIは呼びません")
        monster, notes = validate_monster(animal=animal, raw={
            "needs_retake": False,
            "has_person": False,
            "retake_reason": "",
            "object_name": "ダミーのもの",
            "element": "かたい",
            "monster_name": "ダミーモン",
            "name_candidates": ["ダミーモン", "ダミガオン", "モノドラ"],
            "description": "からうちモードの ダミーの モンスター",
            "design_plan": {
                "animal_identity": "ダミーの顔つき。4本脚で、足先は肉球と爪。長いしっぽ",
                "primary_fusion": "ダミーのもの の形を、頭の角に取り込む",
                "secondary_fusion": "ダミーのもの の色を、しっぽの先に取り込む",
                "ability": "ダミーの ふしぎな光を放つ",
                "pose": "やや低い視点で、前に踏み出す構え",
                "background": "ダミーの 幻想的な景色",
            },
        })
        if fusion_type:
            monster["design_plan"]["fusion_type"] = fusion_type
        monster["design_plan"]["staging"] = staging
        _set_fusion_part(monster["design_plan"], animal, fusion_part)
        notes = notes + ["からうちモード(DRY_RUN)のため、APIは呼んでいません"]
        return monster, notes, 0.0, f"{model}(からうち)", {}

    client = get_client()
    started = time.monotonic()

    try:
        # 構造化出力(JSONスキーマ指定)で受け取る
        response = client.responses.parse(
            model=model,
            instructions=build_recognize_instructions(allow_person()),
            input=[
                {
                    "role": "user",
                    "content": [
                        {"type": "input_text", "text": (
                            build_recognize_prompt_simple(animal, fusion_part_place(animal, fusion_part), staging)
                            if simple else
                            build_recognize_prompt(animal, fusion_type, staging, fusion_part_place(animal, fusion_part))
                        )},
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
        monster, notes = validate_monster(None, animal)
    else:
        monster, notes = validate_monster(parsed.model_dump(), animal)
    if fusion_type:
        monster["design_plan"]["fusion_type"] = fusion_type
    monster["design_plan"]["staging"] = staging
    _set_fusion_part(monster["design_plan"], animal, fusion_part)

    usage = _read_usage(response, model)

    logger.info("判定が完了しました(%.1f秒, %sトークン, 試算 %s): %s",
                elapsed, usage.get("total_tokens", "?"),
                format_cost(usage.get("estimated_cost_usd")), monster)
    return monster, notes, elapsed, model, usage


# ----------------------------------------------------------------------
# 名前のテスト(PC画面の「名前のテスト」から使う)
# ----------------------------------------------------------------------
class NameIdeas(BaseModel):
    """名前のテストで返してもらう形式。"""

    name_candidates: list[str]   # 名前の候補3つ


def generate_names(animal: str, object_name: str) -> dict[str, Any]:
    """動物と物の名前だけから、モンスター名の候補を作る(写真も画像生成も使わない)。

    判定と同じ「名前のつけ方」(prompts.NAME_RULES)と、同じチェック(validator.choose_monster_name)を使う。
    取り込む場所も判定と同じように選び、名前のヒントとして渡す。
    料金は判定よりさらに少ない(写真を送らないため)。
    """
    model = (os.getenv("TEXT_MODEL") or "").strip()
    if not model:
        raise RecognizeError(".envの TEXT_MODEL が設定されていません")

    fusion_part = choose_fusion_part(animal)
    place = fusion_part_place(animal, fusion_part)
    result: dict[str, Any] = {"fusion_part": fusion_part, "fusion_place": place}

    # からうちモード:APIを呼ばずにダミーの候補を返す(料金0円)
    if is_dry_run():
        candidates = ["ダミーモン", "ダミガオン", "モノドラ"]
        name, checked, notes = choose_monster_name(candidates, candidates[0], animal, object_name)
        return {**result, "name": name, "candidates": checked, "notes": notes,
                "seconds": 0.0, "model": f"{model}(からうち)", "usage": {}}

    client = get_client()
    started = time.monotonic()
    try:
        response = client.responses.parse(
            model=model,
            instructions=NAME_TEST_INSTRUCTIONS,
            input=[{
                "role": "user",
                "content": [{"type": "input_text", "text": build_name_test_prompt(animal, object_name, place)}],
            }],
            text_format=NameIdeas,
        )
    except Exception as e:
        raise RecognizeError(f"名前の生成に失敗しました: {type(e).__name__}: {e}") from e
    elapsed = time.monotonic() - started

    parsed = response.output_parsed
    candidates = parsed.name_candidates if parsed is not None else []
    name, checked, notes = choose_monster_name(candidates, "", animal, object_name)
    return {**result, "name": name, "candidates": checked, "notes": notes,
            "seconds": round(elapsed, 2), "model": model, "usage": _read_usage(response, model)}
