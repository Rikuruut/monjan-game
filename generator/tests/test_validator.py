"""AIの返答のチェックと補正(app/validator.py)のテスト。CLAUDE.md の「チェックのルール」の表どおりか。"""

import pytest

from app.validator import (
    DEFAULT_DESCRIPTION,
    DEFAULT_MONSTER_NAME,
    DEFAULT_OBJECT_NAME,
    MAX_DESCRIPTION,
    check_monster_name,
    choose_monster_name,
    validate_monster,
)


def good_raw(**override):
    """チェックに合格する返答(ここから1か所ずつ崩して試す)。"""
    raw = {
        "needs_retake": False,
        "has_person": False,
        "retake_reason": "",
        "object_name": "はさみ",
        "element": "風",
        "monster_name": "シザレオン",
        "name_candidates": ["シザレオン", "チョキオン", "ハサミガオン"],
        "description": "するどい たてがみで なんでも きりさく",
        "design_plan": {
            "animal_identity": "たてがみのある顔",
            "primary_fusion": "刃を たてがみに",
            "secondary_fusion": "持ち手を しっぽに",
            "ability": "きりさく 風",
            "pose": "前に ふみだす",
            "background": "草原",
        },
    }
    raw.update(override)
    return raw


# ----------------------------------------------------------------------
# 名前のチェック
# ----------------------------------------------------------------------
@pytest.mark.parametrize("name", ["シザレオン", "ドライオン", "タカッター", "ペタシャーク"])
def test_good_names_pass(name):
    assert check_monster_name(name, "ライオン", "はさみ") == ""


@pytest.mark.parametrize("name, reason_part", [
    ("", "空"),
    ("ハサミlion", "カタカナ以外"),
    ("はさみおん", "カタカナ以外"),
    ("ガ", "短すぎる"),
    ("ハサミハサミハサミオン", "こえている"),
    ("バカオン", "使わない言葉"),
    ("ハサッャオン", "小さい文字"),
])
def test_bad_names_fail(name, reason_part):
    assert reason_part in check_monster_name(name, "ライオン", "はさみ")


def test_name_just_joined_fails():
    # 物(ひらがなでもよい)と動物の名前を、そのまま並べただけ
    assert "並べただけ" in check_monster_name("ハサミライオン", "ライオン", "はさみ")


def test_choose_only_from_passed_candidates():
    for _ in range(30):
        name, checked, notes = choose_monster_name(
            ["バカオン", "シザレオン", "ハサミlion"], "フォールバック", "ライオン", "はさみ")
        assert name == "シザレオン"
    assert [c["ok"] for c in checked] == [False, True, False]
    assert len(notes) == 2


def test_choose_falls_back_when_no_candidate_passes():
    name, _, _ = choose_monster_name(["バカオン"], "", "ライオン", "はさみ")
    assert name == DEFAULT_MONSTER_NAME


def test_fallback_name_with_ng_word_is_not_used():
    # 候補がすべて不合格のとき、モデルの monster_name もチェックに通す(NGの言葉なら使わない)
    name, _, _ = choose_monster_name(["バカオン"], "バカガオン", "ライオン", "はさみ")
    assert name == DEFAULT_MONSTER_NAME


def test_fallback_name_that_passes_is_used():
    name, _, _ = choose_monster_name(["ばかおん"], "シザレオン", "ライオン", "はさみ")
    assert name == "シザレオン"


# ----------------------------------------------------------------------
# 返答全体の補正
# ----------------------------------------------------------------------
def test_good_raw_has_no_notes():
    monster, notes = validate_monster(good_raw(), animal="ライオン")
    assert notes == []
    assert monster["element"] == "風"
    assert monster["monster_name"] in ("シザレオン", "チョキオン", "ハサミガオン")


def test_defaults_are_not_shared():
    # 既定値の design_plan を書きかえても、次の既定値には残らない
    monster, _ = validate_monster(None)
    monster["design_plan"]["staging"] = {"pose": "前に跳びかかる"}
    again, _ = validate_monster(None)
    assert "staging" not in again["design_plan"]


def test_not_a_dict_gives_defaults():
    monster, notes = validate_monster("こわれた返答")
    assert monster["object_name"] == DEFAULT_OBJECT_NAME
    assert monster["monster_name"] == DEFAULT_MONSTER_NAME
    assert notes


def test_unknown_element_becomes_mu():
    # 前の性質(あつい など)も、いまは一覧にないので「無」になる
    monster, _ = validate_monster(good_raw(element="あつい"))
    assert monster["element"] == "無"


def test_empty_object_name_gets_default():
    monster, _ = validate_monster(good_raw(object_name="  "))
    assert monster["object_name"] == DEFAULT_OBJECT_NAME


def test_long_description_is_cut():
    monster, _ = validate_monster(good_raw(description="あ" * 100))
    assert len(monster["description"]) == MAX_DESCRIPTION


def test_empty_description_gets_default():
    monster, _ = validate_monster(good_raw(description=""))
    assert monster["description"] == DEFAULT_DESCRIPTION


def test_retake_without_reason_gets_default_reason():
    monster, _ = validate_monster(good_raw(needs_retake=True, retake_reason=""))
    assert monster["needs_retake"] is True
    assert monster["retake_reason"]


def test_reason_is_cleared_when_not_retake():
    monster, _ = validate_monster(good_raw(needs_retake=False, retake_reason="ひとが うつっている"))
    assert monster["retake_reason"] == ""


def test_design_plan_is_filled_and_cut():
    plan = dict(good_raw()["design_plan"], pose="", background="あ" * 300)
    monster, _ = validate_monster(good_raw(design_plan=plan))
    assert monster["design_plan"]["pose"]          # 空 → 既定値
    assert len(monster["design_plan"]["background"]) == 120


# ----------------------------------------------------------------------
# 説明文の切り方(ことばの途中で終わらない)
# ----------------------------------------------------------------------
def test_long_description_is_cut_at_a_break():
    text = "とげの とさかを ひからせ、ひくく かまえて にやりと わらう ペンギンかいじゅう"
    monster, _ = validate_monster(good_raw(description=text))
    assert monster["description"] == "とげの とさかを ひからせ、ひくく かまえて にやりと わらう"


def test_description_keeps_sentence_end_mark():
    text = "ひくく かまえて にやり。せなかの ホッチキスで ねらったものを がっちり とめる"
    cut = validate_monster(good_raw(description=text))[0]["description"]
    assert len(cut) <= MAX_DESCRIPTION and not cut.endswith(" ")
    assert text.startswith(cut)


def test_too_long_object_part_is_dropped():
    monster, notes = validate_monster(good_raw(object_part="あ" * 30))
    assert monster["object_part"] == "" and any("object_part" in n for n in notes)
