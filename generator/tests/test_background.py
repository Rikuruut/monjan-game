"""短いプロンプトの背景の1行のテスト(どのカードも同じ背景に見える現象の対策)。API は呼ばない。"""

import pytest

from app import recognizer
from app.prompts import (
    AQUATIC_ANIMALS,
    BACKGROUND_PLACE_INFO,
    BACKGROUND_PLACES,
    COMMON_BACKGROUND_PLACES,
    DEFAULT_BACKGROUND_PLACES,
    STAGING_OPTIONS,
    PLACES_WITHOUT_SCENE,
    background_place_group,
    background_text,
    build_describe_prompt,
    build_image_prompt,
    scene_tone,
)


@pytest.fixture(autouse=True)
def fresh_choice(monkeypatch):
    # 直前に選んだものを忘れた状態から始める
    monkeypatch.setattr(recognizer, "_background_bags", {})
    monkeypatch.setattr(recognizer, "_last_scene_tone", None)
    monkeypatch.setattr(recognizer, "_last_place_group", None)
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
    assert f"「{background_text(plan.staging['scene'], plan.background_place)}」" in lines[0]
    assert design_plan["background_place"] == plan.background_place


def test_place_comes_from_habitat_or_common():
    allowed = set(BACKGROUND_PLACES["ペンギン"]) | set(COMMON_BACKGROUND_PLACES)
    for _ in range(40):
        assert recognizer.choose_plan("ペンギン", simple=True).background_place in allowed


def test_habitat_and_common_are_about_half_each():
    # 依頼者が決めた:すみかと共通の場所を半分ずつ(2026年11月16日)
    habitat = set(BACKGROUND_PLACES["ライオン"])
    picks = [recognizer.choose_plan("ライオン", simple=True).background_place for _ in range(400)]
    ratio = sum(p in habitat for p in picks) / len(picks)
    assert 0.35 < ratio < 0.65


def test_unknown_animal_uses_default_or_common_places():
    allowed = set(DEFAULT_BACKGROUND_PLACES) | set(COMMON_BACKGROUND_PLACES)
    for _ in range(20):
        assert recognizer.choose_plan("カピバラ", simple=True).background_place in allowed


def test_aquatic_animal_never_uses_common_places():
    for animal in AQUATIC_ANIMALS:
        for _ in range(30):
            assert recognizer.choose_plan(animal, simple=True).background_place in BACKGROUND_PLACES[animal]


def test_same_place_group_and_scene_tone_do_not_repeat():
    # 言葉がちがっても、見た目の似た系統(霧の朝 → 雷の嵐 など)が続かないようにする
    previous = recognizer.choose_plan("ライオン", simple=True)
    for _ in range(60):
        plan = recognizer.choose_plan("ライオン", simple=True)
        assert background_place_group(plan.background_place) != background_place_group(previous.background_place)
        if plan.staging["scene"] and previous.staging["scene"]:
            assert scene_tone(plan.staging["scene"]) != scene_tone(previous.staging["scene"])
        assert plan.staging["scene"] in STAGING_OPTIONS["scene"] or plan.background_place in PLACES_WITHOUT_SCENE
        previous = plan


def test_every_scene_appears_within_two_rounds():
    # 袋から取り出すので、候補の数の2倍まわせば、どの時間帯も1回は出る(ランダムの偏りで出ないことがない)
    scenes = {recognizer.choose_staging()["scene"] for _ in range(len(STAGING_OPTIONS["scene"]) * 2)}
    assert scenes == set(STAGING_OPTIONS["scene"])


def test_scene_fits_the_place():
    # 「合わなければ、近い景色でよい」を外したので、合わない組み合わせ(雪のジャングル・星空の洞くつ)は選ばない
    for animal in ("ゾウ", "ワニ", "ティラノサウルス", "サメ", "ウサギ"):
        for _ in range(80):
            plan = recognizer.choose_plan(animal, simple=True)
            scene, place = plan.staging["scene"], plan.background_place
            if place in PLACES_WITHOUT_SCENE:
                assert scene == ""
            else:
                assert scene in STAGING_OPTIONS["scene"]
            assert not (scene == "雪の降る日" and place in ("ジャングル", "砂漠", "火山", "サバンナ"))


def test_gloomy_scenes_are_removed():
    # 雷・雨・霧で画面全体が暗い灰色になり、どの絵も似て見えた(2026年11月16日)
    assert not [s for s in STAGING_OPTIONS["scene"] if "嵐" in s or "雷" in s or "霧" in s]


def test_every_place_has_group_and_highlight():
    places = set(COMMON_BACKGROUND_PLACES) | set(DEFAULT_BACKGROUND_PLACES)
    for habitat in BACKGROUND_PLACES.values():
        places |= set(habitat)
    for place in places:
        group, highlight = BACKGROUND_PLACE_INFO[place]
        assert group and highlight
        # 見どころに、いつもの小物(岩・霧・滝)と文字の入りそうな物を書かない
        for word in ("霧", "滝", "町", "建物", "遺跡", "看板"):
            assert word not in highlight and word not in place


def test_common_places_cover_many_groups():
    assert len({background_place_group(p) for p in COMMON_BACKGROUND_PLACES}) >= 7


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
    assert "たたかいかた" in text


def test_describe_prompt_tells_weapon_part():
    # 説明文の戦い方が絵とつながるよう、絵と同じ「どのパーツを・武器にしたか」を伝える(2026年11月9日)
    text = build_describe_prompt("ゴリラ", "はさみ", "腕の先", "刃", "weapon")
    assert "はさみの「刃」が「腕の先」の武器になっています" in text
    text = build_describe_prompt("ゴリラ", "はさみ", "頭・角・とさか", "刃", "body")
    assert "はさみの「刃」が「頭・角・とさか」になっています" in text and "武器になって" not in text


def test_describe_instructions_use_easy_kanji():
    # 説明文は、小学3年までの漢字を使う(ひらがなだけだと読みにくかった。2026年11月9日)
    from app.prompts import build_describe_instructions
    text = build_describe_instructions()
    assert "小学3年生までに習う漢字" in text and "ひらがな中心" not in text


def test_describe_prompt_without_part_keeps_old_line():
    # パーツが分からないときは、今までどおり場所だけを伝える
    text = build_describe_prompt("ゴリラ", "はさみ", "腕の先")
    assert "主に「腕の先」に取り込まれます" in text and "50文字" in text


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


def test_common_places_do_not_repeat_across_animals(monkeypatch):
    # 共通の場所の袋は全部の動物で1つ(動物ごとだと、試しの8枚で「浮島」が2回出た。2026年11月16日)
    monkeypatch.setattr(recognizer, "COMMON_BACKGROUND_RATIO", 1.0)
    animals = ["ライオン", "ゴリラ", "ゾウ", "ワニ", "ティラノサウルス", "鷹", "ペンギン", "ウサギ"]
    picks = [recognizer.choose_plan(a, simple=True).background_place for a in animals]
    assert len(set(picks)) == len(picks)
    assert all(p in COMMON_BACKGROUND_PLACES and p not in BACKGROUND_PLACES[a] for p, a in zip(picks, animals))
