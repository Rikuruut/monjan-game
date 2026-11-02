"""物を2つのパーツに分けて作り変える取り込み方(武器 / 体の部位)のテスト。API は呼ばない。"""

import collections

import pytest

from app import recognizer
from app.prompts import SUB_PART_EXCLUDED, WEAPON_PARTS, build_image_prompt
from app.validator import validate_monster
from tests.test_validator import good_raw

PARTS = {"object_part": "刃", "object_sub_part": "持ち手の輪"}


@pytest.fixture(autouse=True)
def no_fixed_settings(monkeypatch):
    for name in ("FUSION_STYLE", "FUSION_PART", "BACKGROUND"):
        monkeypatch.delenv(name, raising=False)


def plan_and_prompt(animal, style, monkeypatch, parts=PARTS):
    monkeypatch.setenv("FUSION_STYLE", style)
    plan = recognizer.choose_plan(animal, simple=True)
    design_plan = dict(parts)
    plan.apply(design_plan, animal)
    return plan, design_plan, build_image_prompt(animal, "はさみ", "", design_plan, prompt_style="simple")


def fusion_lines(prompt):
    return [line for line in prompt.splitlines() if "作り変" in line]


def test_weapon_line_has_two_parts_and_two_places(monkeypatch):
    plan, design_plan, prompt = plan_and_prompt("ライオン", "weapon", monkeypatch)
    [line] = fusion_lines(prompt)
    assert "はさみを部品に分けて" in line
    assert "「刃」は「前足の先」の武器に" in line and "「持ち手の輪」は「" in line and "の飾りにする" in line
    assert "それぞれ1か所だけに使う" in line
    assert design_plan["fusion_style"] == "weapon" and design_plan["fusion_part_label"].startswith("武器(前足の先) + 飾り(")


def test_body_line_turns_place_itself(monkeypatch):
    _, design_plan, prompt = plan_and_prompt("ライオン", "body", monkeypatch)
    [line] = fusion_lines(prompt)
    assert "そのものに作り変え" in line and "の武器に" not in line
    assert design_plan["fusion_style"] == "body"


@pytest.mark.parametrize("animal, part", [("ライオン", "arm"), ("ゴリラ", "arm"), ("カピバラ", "arm"),
                                          ("ペンギン", "back"), ("サメ", "tail"), ("ゾウ", "jaw")])
def test_weapon_place_per_animal(animal, part, monkeypatch):
    plan, _, _ = plan_and_prompt(animal, "weapon", monkeypatch)
    assert plan.fusion_part == part == WEAPON_PARTS.get(animal, "arm")


def test_sub_place_differs_and_avoids_mouth_and_arm(monkeypatch):
    for animal in ("ライオン", "ワニ", "ゴリラ", "鷹", "サメ"):
        for style in ("weapon", "body"):
            for _ in range(10):
                plan, _, _ = plan_and_prompt(animal, style, monkeypatch)
                if plan.sub_fusion_part:
                    assert plan.sub_fusion_part != plan.fusion_part
                    assert plan.sub_fusion_part not in SUB_PART_EXCLUDED


def test_style_is_about_half_and_half(monkeypatch):
    counts = collections.Counter(recognizer.choose_plan("ライオン", simple=True).fusion_style for _ in range(400))
    assert set(counts) == {"weapon", "body"}
    assert 140 < counts["weapon"] < 260


def test_one_part_or_none_falls_back(monkeypatch):
    _, _, one = plan_and_prompt("ライオン", "weapon", monkeypatch, parts={"object_part": "刃"})
    assert "はさみの「刃」でできた武器" in fusion_lines(one)[0] and "部品に分けて" not in one
    _, _, none = plan_and_prompt("ライオン", "body", monkeypatch, parts={})
    assert "はさみに作り変わった" in fusion_lines(none)[0]


def test_detailed_plan_has_no_style():
    plan = recognizer.choose_plan("ライオン", simple=False)
    assert plan.fusion_style == "" and plan.sub_fusion_part == ""


def test_sub_part_same_as_main_is_dropped():
    monster, notes = validate_monster(good_raw(object_part="刃", object_sub_part="刃"))
    assert monster["object_part"] == "刃" and monster["object_sub_part"] == ""
    assert any("object_sub_part" in n for n in notes)


# ----------------------------------------------------------------------
# 足が増える・減るのを防ぐ
# ----------------------------------------------------------------------
def test_limb_count_rule_in_simple_prompt(monkeypatch):
    _, _, prompt = plan_and_prompt("ライオン", "weapon", monkeypatch)
    rules = prompt.split("守ること:")[1].strip().splitlines()
    assert rules == [
        "- モンスター1体の全身を描く",
        "- 手足・しっぽの数は、動物本来の数のままにする(武器や飾りにした部位も数に入れ、足を足さない)",
        "- 画像の中に文字・ロゴ・数字を入れない",
    ]


@pytest.mark.parametrize("animal, place", [("ライオン", "前足の先"), ("ワニ", "前足の先"), ("ネコ", "前足の先"),
                                           ("ウサギ", "前足の先"), ("ゴリラ", "腕の先"), ("カピバラ", "前足・腕の先")])
def test_arm_is_called_front_leg_for_four_legged(animal, place):
    from app.prompts import fusion_part_place
    assert fusion_part_place(animal, "arm") == place


def test_arm_plan_avoids_poses_that_add_legs(monkeypatch):
    from app.prompts import POSES_AVOIDED_WITH_ARM, STAGING_OPTIONS
    arm_poses, other_poses = set(), set()
    for _ in range(300):
        plan, _, _ = plan_and_prompt("ライオン", "weapon", monkeypatch)
        arm_poses.add(plan.staging["pose"])
        plan, _, _ = plan_and_prompt("鷹", "weapon", monkeypatch)   # 鷹の武器は翼(前足ではない陸の動物)
        other_poses.add(plan.staging["pose"])
    assert not arm_poses & set(POSES_AVOIDED_WITH_ARM)
    assert arm_poses == set(STAGING_OPTIONS["pose"]) - set(POSES_AVOIDED_WITH_ARM)
    assert other_poses == set(STAGING_OPTIONS["pose"])


# ----------------------------------------------------------------------
# 水の中の動物(サメが岩の上に立たないように)
# ----------------------------------------------------------------------
def test_aquatic_animal_swims(monkeypatch):
    from app.prompts import AQUATIC_POSES, BACKGROUND_PLACES
    poses, places = set(), set()
    for style in ("weapon", "body"):
        for _ in range(150):
            plan, _, prompt = plan_and_prompt("サメ", style, monkeypatch)
            poses.add(plan.staging["pose"])
            places.add(plan.background_place)
            [line] = [line for line in prompt.splitlines() if line.startswith("背景は")]
            assert "水の中を泳いでいるように描く。地面や岩の上に立たせない" in line
    assert poses == set(AQUATIC_POSES)   # 水の中の動物は専用のポーズだけ(4つとも出る)
    assert places == set(BACKGROUND_PLACES["サメ"]) and all("海" in p for p in places)


def test_land_animal_background_line_unchanged(monkeypatch):
    _, _, prompt = plan_and_prompt("ライオン", "body", monkeypatch)
    [line] = [line for line in prompt.splitlines() if line.startswith("背景は")]
    assert line.endswith("(合わなければ、近い景色でよい)。") and "泳いで" not in line


def test_quick_check_asks_for_shapeable_part_first():
    from app.prompts import build_quick_check_instructions
    text = build_quick_check_instructions(False)
    assert "object_part:そのまま武器や体の一部" in text and "object_sub_part:" in text
    assert "持ち手" not in text and "刃" not in text   # 具体例は書かない(写されるため)


def test_twisting_pose_is_never_chosen(monkeypatch):
    # 「振り返りざまに技を放つ」は体の形が崩れやすいので、どの動物・取り込み方でも選ばない
    from app.prompts import AQUATIC_POSES, STAGING_OPTIONS
    assert "振り返りざまに技を放つ" not in STAGING_OPTIONS["pose"]
    land = set()
    for animal in ("ライオン", "ゴリラ", "ペンギン", "鷹", "サメ", "カピバラ"):
        for style in ("weapon", "body"):
            for _ in range(40):
                plan, _, _ = plan_and_prompt(animal, style, monkeypatch)
                assert plan.staging["pose"] != "振り返りざまに技を放つ"
                if animal != "サメ":
                    land.add(plan.staging["pose"])
    assert not land & set(AQUATIC_POSES)   # 泳ぐポーズは陸の動物には出ない
    detailed = {recognizer.choose_plan("ライオン", simple=False).staging["pose"] for _ in range(200)}
    assert "振り返りざまに技を放つ" not in detailed
