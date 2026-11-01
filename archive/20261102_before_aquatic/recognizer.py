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
from dataclasses import dataclass, field
from typing import Any, Literal

from pydantic import BaseModel

from .openai_client import allow_person, get_client, is_dry_run
from .pricing import format_cost, read_usage
from .prompts import (
    FUSION_PARTS,
    FUSION_STYLES,
    POSES_AVOIDED_WITH_ARM,
    FUSION_TYPES,
    NAME_TEST_INSTRUCTIONS,
    QUICK_CHECK_PROMPT,
    STAGING_OPTIONS,
    background_place_candidates,
    sub_part_candidates,
    weapon_part,
    build_describe_instructions,
    build_describe_prompt,
    build_name_test_prompt,
    build_quick_check_instructions,
    build_recognize_instructions,
    build_recognize_prompt,
    fusion_part_candidates,
    fusion_part_place,
)
from .validator import DEFAULT_RETAKE_REASON, choose_monster_name, validate_monster

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


def choose_staging(avoid_poses: tuple[str, ...] = ()) -> dict[str, str]:
    """演出(ポーズ・視点・表情・時間帯と天気)を、項目ごとにランダムに1つずつ選ぶ。

    大きな方向だけを決め、中身は判定と画像モデルにまかせる(prompts.STAGING_OPTIONS のコメント参照)。
    時間帯・天気は背景の色を大きく変えるので、直前と同じものは選ばない。
    """
    global _last_scene
    staging = {key: random.choice(options) for key, options in STAGING_OPTIONS.items()}
    # 取り込む場所と合わないポーズを外す(前足の回:prompts.POSES_AVOIDED_WITH_ARM)
    poses = [p for p in STAGING_OPTIONS["pose"] if p not in avoid_poses] or STAGING_OPTIONS["pose"]
    staging["pose"] = random.choice(poses)
    scenes = [s for s in STAGING_OPTIONS["scene"] if s != _last_scene] or STAGING_OPTIONS["scene"]
    staging["scene"] = _last_scene = random.choice(scenes)
    return staging


# 直前に選んだ時間帯・天気と、背景の場所(同じものが続かないようにするため)
_last_scene: str | None = None
_last_background_place: str | None = None


def choose_background_place(animal: str) -> str:
    """背景の場所を1つ選ぶ(短いプロンプト用。prompts.BACKGROUND_PLACES のコメント参照)。

    `.env` の BACKGROUND に場所の言葉(例:森)があれば、それに固定する(比べるとき用)。
    なければ、その動物のすみかの中からランダムに選ぶ。直前と同じ場所は選ばない。
    """
    global _last_background_place
    fixed = (os.getenv("BACKGROUND") or "").strip()
    if fixed:
        return fixed
    pool = background_place_candidates(animal)
    candidates = [p for p in pool if p != _last_background_place] or pool
    _last_background_place = random.choice(candidates)
    return _last_background_place


@dataclass
class Plan:
    """判定の前にプログラムが決める「大きな方向」(prompts.STAGING_OPTIONS のコメント参照)。"""

    fusion_type: str            # 融合の型(詳しいプロンプトだけ。短いプロンプトでは "")
    fusion_part: str            # 物を取り込む場所のパターン(メインのパーツの行き先)
    staging: dict[str, str]     # 演出(ポーズ・視点・表情・時間帯と天気)
    background_place: str = ""  # 背景の場所(短いプロンプトだけ。詳しいプロンプトでは "")
    fusion_style: str = ""      # 取り込み方 weapon / body(短いプロンプトだけ)
    sub_fusion_part: str = ""   # サブのパーツ(飾り)の行き先(短いプロンプトだけ。候補がなければ "")

    def apply(self, design_plan: dict[str, Any], animal: str) -> None:
        """選んだ方向を design_plan に入れる(画像プロンプトと result.json・PC画面で使う)。"""
        if self.fusion_type:
            design_plan["fusion_type"] = self.fusion_type
        design_plan["staging"] = self.staging
        if self.background_place:
            design_plan["background_place"] = self.background_place
        _set_fusion_part(design_plan, animal, self.fusion_part)
        if self.fusion_style:
            design_plan["fusion_style"] = self.fusion_style
            main = fusion_part_place(animal, self.fusion_part)
            label = f"武器({main})" if self.fusion_style == "weapon" else design_plan["fusion_part_label"]
            if self.sub_fusion_part:
                design_plan["sub_fusion_part"] = self.sub_fusion_part
                label += f" + 飾り({fusion_part_place(animal, self.sub_fusion_part)})"
            design_plan["fusion_part_label"] = label


def choose_plan(animal: str, simple: bool) -> Plan:
    """融合の型・取り込む場所・演出・背景の場所を選ぶ。

    融合の型は詳しいプロンプト(simple でない)だけ、背景の場所は短いプロンプトだけで選ぶ
    (詳しいプロンプトは、判定が設計図の中で背景を書く)。
    """
    if not simple:
        return Plan(fusion_type=choose_fusion_type(), fusion_part=choose_fusion_part(animal), staging=choose_staging())
    style = choose_fusion_style()
    main = weapon_part(animal) if style == "weapon" else choose_fusion_part(animal)
    subs = sub_part_candidates(animal, main)
    return Plan(
        fusion_type="",
        fusion_part=main,
        staging=choose_staging(POSES_AVOIDED_WITH_ARM if main == "arm" else ()),
        background_place=choose_background_place(animal),
        fusion_style=style,
        sub_fusion_part=random.choice(subs) if subs else "",
    )


def choose_fusion_style() -> str:
    """取り込み方を選ぶ(短いプロンプト用。prompts.fusion_line のコメント参照)。

    `.env` の FUSION_STYLE に weapon / body があればそれに固定し、なければ半分ずつ(依頼者の希望)。
    """
    fixed = (os.getenv("FUSION_STYLE") or "").strip().lower()
    if fixed in FUSION_STYLES:
        return fixed
    return random.choice(FUSION_STYLES)


@dataclass
class RecognizeResult:
    """判定の結果。"""

    monster: dict[str, Any]          # モンスター情報(validator で補正したもの)
    notes: list[str]                 # 補正のメモ
    elapsed_seconds: float           # かかった時間
    model: str                       # 使ったモデル名
    usage: dict[str, Any] = field(default_factory=dict)   # 使ったトークン数と料金の試算


@dataclass
class StepResult:
    """判定を2つに分けたとき(短いプロンプト)の、片方の結果。中身は validator を通す前の辞書。"""

    raw: dict[str, Any] | None       # モデルの答え(読めなかったときは None)
    elapsed_seconds: float
    model: str
    usage: dict[str, Any] = field(default_factory=dict)


def _text_model() -> str:
    model = (os.getenv("TEXT_MODEL") or "").strip()
    if not model:
        raise RecognizeError(".envの TEXT_MODEL が設定されていません")
    return model


def _ask(
    model: str,
    what: str,
    instructions: str,
    text: str,
    schema: type[BaseModel],
    photo_bytes: bytes | None = None,
) -> tuple[dict[str, Any] | None, float, dict[str, Any]]:
    """テキスト用モデルに構造化出力(JSONスキーマ指定)で聞く。

    戻り値は (答えの辞書。読めなければ None, かかった秒数, 使用量)。呼び出しに失敗したら RecognizeError。
    `what` はログとエラーに出す名前(「判定」など)。
    """
    content: list[dict[str, Any]] = [{"type": "input_text", "text": text}]
    if photo_bytes is not None:
        content.append({"type": "input_image", "image_url": _to_data_url(photo_bytes)})

    client = get_client()
    started = time.monotonic()
    try:
        response = client.responses.parse(
            model=model,
            instructions=instructions,
            input=[{"role": "user", "content": content}],
            text_format=schema,
        )
    except Exception as e:
        logger.warning("%sに失敗しました(%.1f秒): %s", what, time.monotonic() - started, e)
        raise RecognizeError(f"{what}の呼び出しに失敗しました: {type(e).__name__}: {e}") from e
    elapsed = time.monotonic() - started

    parsed = response.output_parsed
    usage = read_usage(response, model)
    logger.info("%sが完了しました(%.1f秒, %sトークン, 試算 %s)", what, elapsed,
                usage.get("total_tokens", "?"), format_cost(usage.get("estimated_cost_usd")))
    return (parsed.model_dump() if parsed is not None else None), elapsed, usage


def _retake_when_unreadable(monster: dict[str, Any], notes: list[str]) -> None:
    """返答を読めなかった(モデルが断ったときなど)ので、撮り直しにする。

    ※ 2026年11月2日:それまでは既定値のまま画像生成まで進んでいた。
      モデルが断るのは、子供にふさわしくない写真のときが多いので、撮り直しの判定を通り抜けていた
    """
    logger.warning("判定の返答を読み取れませんでした(refusal など)。撮り直しにします")
    monster["needs_retake"] = True
    monster["retake_reason"] = DEFAULT_RETAKE_REASON
    notes.append("判定の返答を読み取れなかったので、撮り直しにしました")


# ----------------------------------------------------------------------
# 詳しいプロンプト(detailed)の判定:1回でモンスター情報と設計図をすべて作る
# ----------------------------------------------------------------------
def recognize(photo_bytes: bytes, animal: str) -> RecognizeResult:
    """写真と動物からモンスター情報を作る(詳しいプロンプト用)。"""
    model = _text_model()
    # 融合の型・演出・取り込む場所を先に選び、design_plan に入れて画像プロンプトと result.json に渡す
    plan = choose_plan(animal, simple=False)

    # からうちモード:APIを呼ばずに決まった結果を返す(料金0円)
    if is_dry_run():
        logger.info("からうちモード(DRY_RUN)のため、判定のAPIは呼びません")
        monster, notes = validate_monster(animal=animal, raw={
            **_DRY_CHECK, **_DRY_DETAILS,
            "design_plan": {
                "animal_identity": "ダミーの顔つき。4本脚で、足先は肉球と爪。長いしっぽ",
                "primary_fusion": "ダミーのもの の形を、頭の角に取り込む",
                "secondary_fusion": "ダミーのもの の色を、しっぽの先に取り込む",
                "ability": "ダミーの ふしぎな光を放つ",
                "pose": "やや低い視点で、前に踏み出す構え",
                "background": "ダミーの 幻想的な景色",
            },
        })
        plan.apply(monster["design_plan"], animal)
        notes = notes + ["からうちモード(DRY_RUN)のため、APIは呼んでいません"]
        return RecognizeResult(monster, notes, 0.0, f"{model}(からうち)")

    raw, elapsed, usage = _ask(
        model, "判定", build_recognize_instructions(allow_person()),
        build_recognize_prompt(animal, plan.fusion_type, plan.staging, fusion_part_place(animal, plan.fusion_part)),
        MonsterInfo, photo_bytes,
    )
    monster, notes = validate_monster(raw, animal)
    if raw is None:
        _retake_when_unreadable(monster, notes)
    plan.apply(monster["design_plan"], animal)
    logger.info("判定の結果: %s", monster)
    return RecognizeResult(monster, notes, elapsed, model, usage)


# ----------------------------------------------------------------------
# 短いプロンプト(simple)の判定:2つに分ける
# ----------------------------------------------------------------------
# ※ 2026年11月2日:待ち時間を短くするため、判定を2つに分けた。
#   それまでは1回の判定(14〜31秒)が終わってから画像生成(18〜21秒)を始めていた。
#   画像生成に要るのは物の名前と撮り直しかどうかだけなので、それだけを先に短く判定し(quick_check)、
#   名前・説明(describe)は画像生成と同時に作る(app/main.py の _generate_split)。
#   simple では設計図(design_plan)を画像に使わないので、作らない。
class QuickCheck(BaseModel):
    """すぐ要る判定で返してもらう形式。"""

    needs_retake: bool
    retake_reason: str
    has_person: bool   # 写真に人がはっきり写っているか(人モードで人の節を入れるかどうかに使う)
    object_name: str
    object_part: str       # 物のいちばん目立つパーツ(画像では物の全体ではなく、パーツごとに作り変える)
    object_sub_part: str   # 2番目に目立つ別のパーツ(離れた部位の飾りにする)


class MonsterDetails(BaseModel):
    """名前・説明で返してもらう形式。"""

    element: Literal["あつい", "みず", "でんき", "かたい", "とがってる", "やわらかい"]
    monster_name: str
    name_candidates: list[str]   # 名前の候補3つ(validator がチェックし、合格したものからランダムに選ぶ)
    description: str


# からうちモードで返す答え
_DRY_CHECK = {"needs_retake": False, "retake_reason": "", "has_person": False, "object_name": "ダミーのもの",
              "object_part": "ダミーのパーツ", "object_sub_part": "ダミーのサブパーツ"}
_DRY_DETAILS = {
    "element": "かたい",
    "monster_name": "ダミーモン",
    "name_candidates": ["ダミーモン", "ダミガオン", "モノドラ"],
    "description": "からうちモードの ダミーの モンスター",
}


def quick_check(photo_bytes: bytes) -> StepResult:
    """すぐ要る判定:物の名前・撮り直しかどうか・人が写っているか。"""
    model = _text_model()
    if is_dry_run():
        logger.info("からうちモード(DRY_RUN)のため、判定のAPIは呼びません")
        return StepResult(dict(_DRY_CHECK), 0.0, f"{model}(からうち)")
    raw, elapsed, usage = _ask(
        model, "判定(物の名前・撮り直し)", build_quick_check_instructions(allow_person()),
        QUICK_CHECK_PROMPT, QuickCheck, photo_bytes,
    )
    return StepResult(raw, elapsed, model, usage)


def describe(photo_bytes: bytes, animal: str, object_name: str, plan: Plan, person: bool = False) -> StepResult:
    """名前・説明:性質・モンスター名の候補・説明文。画像生成と同時に呼ぶ。

    `person` は、人モードで写真の主役が人のとき(名前や説明で本人をからかわないよう伝える)。
    """
    model = _text_model()
    if is_dry_run():
        return StepResult(dict(_DRY_DETAILS), 0.0, f"{model}(からうち)")
    raw, elapsed, usage = _ask(
        model, "名前・説明", build_describe_instructions(person),
        build_describe_prompt(animal, object_name, fusion_part_place(animal, plan.fusion_part)),
        MonsterDetails, photo_bytes,
    )
    return StepResult(raw, elapsed, model, usage)


def combine(
    animal: str, plan: Plan, check: StepResult, details: StepResult | None
) -> tuple[dict[str, Any], list[str]]:
    """2つの判定の答えを1つのモンスター情報にまとめ、validator でチェックする。

    `details` が None のとき(撮り直し・名前と説明の失敗)は、名前・説明を既定値にする。
    すぐ要る判定の返答を読めなかったときは、撮り直しにする。
    """
    raw = {**(check.raw or {}), **((details.raw if details else None) or {})}
    monster, notes = validate_monster(raw if check.raw is not None else None, animal, with_design_plan=False)
    if check.raw is None:
        _retake_when_unreadable(monster, notes)
        monster["design_plan"] = {}
    elif details is not None and details.raw is None:
        notes.append("名前・説明の返答を読み取れなかったので、既定値にしました")
    plan.apply(monster["design_plan"], animal)
    return monster, notes


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
    model = _text_model()
    fusion_part = choose_fusion_part(animal)
    place = fusion_part_place(animal, fusion_part)
    result: dict[str, Any] = {"fusion_part": fusion_part, "fusion_place": place}

    # からうちモード:APIを呼ばずにダミーの候補を返す(料金0円)
    if is_dry_run():
        candidates = ["ダミーモン", "ダミガオン", "モノドラ"]
        name, checked, notes = choose_monster_name(candidates, candidates[0], animal, object_name)
        return {**result, "name": name, "candidates": checked, "notes": notes,
                "seconds": 0.0, "model": f"{model}(からうち)", "usage": {}}

    raw, elapsed, usage = _ask(model, "名前の生成", NAME_TEST_INSTRUCTIONS,
                               build_name_test_prompt(animal, object_name, place), NameIdeas)
    candidates = (raw or {}).get("name_candidates") or []
    name, checked, notes = choose_monster_name(candidates, "", animal, object_name)
    return {**result, "name": name, "candidates": checked, "notes": notes,
            "seconds": round(elapsed, 2), "model": model, "usage": usage}
