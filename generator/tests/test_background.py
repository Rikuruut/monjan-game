"""短いプロンプトの背景の1行のテスト(どのカードも同じ背景に見える現象の対策)。API は呼ばない。"""

import pytest

from app import recognizer
from app.prompts import (
    BACKGROUND_PLACES,
    DEFAULT_BACKGROUND_PLACES,
    STAGING_OPTIONS,
    build_describe_prompt,
    build_image_prompt,
)


@pytest.fixture(autouse=True)
def fresh_choice(monkeypatch):
    # 直前に選んだものを忘れた状態から始める
    monkeypatch.setattr(recognizer, "_last_scene", None)
    monkeypatch.setattr(recognizer, "_last_background_place", None)
    monkeypatch.delenv("BACKGROUND", raising=False)


def simple_prompt(animal="ゴリラ"):
    plan = recognizer.choose_plan(animal, simple=True)
    design_plan = {}
    plan.apply(design_plan, animal)
    return plan, design_plan, build_image_prompt(animal, "はさみ", "", design_plan, prompt_style="simple")


def test_simple_prompt_has_one_background_line():
    plan, design_plan, prompt = simple_prompt()
    lines = [line for line in prompt.splitlines() if line.startswith("背景は")]
    assert len(lines) == 1
    assert f"「{plan.staging['scene']}の{plan.background_place}」" in lines[0]
    assert design_plan["background_place"] == plan.background_place


def test_place_comes_from_animal_habitat():
    for _ in range(20):
        assert recognizer.choose_plan("ペンギン", simple=True).background_place in BACKGROUND_PLACES["ペンギン"]


def test_unknown_animal_uses_default_places():
    assert recognizer.choose_plan("カピバラ", simple=True).background_place in DEFAULT_BACKGROUND_PLACES


def test_same_place_and_scene_do_not_repeat():
    previous = recognizer.choose_plan("ライオン", simple=True)
    for _ in range(30):
        plan = recognizer.choose_plan("ライオン", simple=True)
        assert plan.background_place != previous.background_place
        assert plan.staging["scene"] != previous.staging["scene"]
        assert plan.staging["scene"] in STAGING_OPTIONS["scene"]
        previous = plan


def test_background_can_be_fixed(monkeypatch):
    monkeypatch.setenv("BACKGROUND", "火山")
    assert {recognizer.choose_plan("ウサギ", simple=True).background_place for _ in range(5)} == {"火山"}


def test_detailed_has_no_background_place():
    # 詳しいプロンプトは、判定が設計図の中で背景を書くので選ばない
    plan = recognizer.choose_plan("ゴリラ", simple=False)
    design_plan = {}
    plan.apply(design_plan, "ゴリラ")
    assert plan.background_place == "" and "background_place" not in design_plan


def test_describe_prompt_does_not_mention_background(monkeypatch):
    # 説明文には背景を書かせない(絵と説明文が食い違わないように)
    # ※ 場所は固定する(「森」などは、説明文の指示「森・海などは書かない」にもともと入っているため)
    monkeypatch.setenv("BACKGROUND", "火山")
    plan, _, _ = simple_prompt()
    text = build_describe_prompt("ゴリラ", "はさみ", "前足・腕の先")
    assert plan.background_place not in text and plan.staging["scene"] not in text


def test_describe_prompt_does_not_pass_pose():
    # 説明文がポーズ・表情を写した「絵の説明」にならないよう、ポーズ・表情は伝えない
    plan, _, _ = simple_prompt()
    text = build_describe_prompt("ゴリラ", "はさみ", "前足・腕の先")
    for key in ("pose", "view", "expression"):
        assert plan.staging[key] not in text
    assert "図鑑" in text


def test_fusion_line_says_body_part_turns_into_object():
    # 「取り入れて」だと、物をくわえる・刺さる絵になったので、部位そのものが作り変わる言い方にした(行は増やさない)
    _, _, prompt = simple_prompt()
    lines = prompt.splitlines()
    fusion = [line for line in lines if "作り変わった" in line]
    assert len(fusion) == 1
    assert "はさみ" in fusion[0] and "くわえる・持つ・刺さる・上に重ねるのはしない" in fusion[0]
    assert "取り入れて" not in prompt
    # ほかの行(ポーズ・背景・画風・守ること)はそのまま
    assert any(line.startswith("ポーズは") for line in lines)
    assert any(line.startswith("背景は") for line in lines)
    assert "画風は2Dデジタル風で、トレーディングカードに表示されてそうな画風。" in lines


def test_only_one_night_scene():
    # 夜の候補が多いと、夜と満月の絵ばかりになったので、夜は1つだけ
    night = [s for s in STAGING_OPTIONS["scene"] if "夜" in s or "月" in s or "星" in s]
    assert night == ["満天の星空"]


def test_fusion_line_uses_only_the_object_part():
    # 物の全体を渡すと製品まるごとになったので、いちばん特徴的なパーツだけを使わせる
    design_plan = {"fusion_part": "jaw", "object_part": "刃", "staging": {}}
    prompt = build_image_prompt("ライオン", "はさみ", "", design_plan, prompt_style="simple")
    assert "「口・あご」そのものが、はさみの「刃」に作り変わった" in prompt
    assert "はさみの全体ではなく「刃」だけを使い" in prompt


def test_fusion_line_without_part_uses_whole_object():
    prompt = build_image_prompt("ライオン", "はさみ", "", {"fusion_part": "jaw", "staging": {}}, prompt_style="simple")
    assert "「口・あご」そのものが、はさみに作り変わった" in prompt and "だけを使い" not in prompt
