"""じゃんけんバトルへの受け渡し(app/battle.py・/api/battle-monster)のテスト。からうちモードなので料金0円。"""

import json
import random

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app.battle import ATTACK_CHOICES, HP_CHOICES, make_battle_stats, to_battle_monster
from tests.test_api_dry_run import upload


@pytest.fixture
def client():
    return TestClient(main.app)


def test_battle_stats_are_in_range():
    rng = random.Random(0)
    for _ in range(50):
        stats = make_battle_stats(rng)
        assert stats["attack"] in ATTACK_CHOICES
        assert stats["hp"] in HP_CHOICES


def test_to_battle_monster_has_the_battle_format():
    result = {
        "animal": "ゴリラ",
        "monster": {"monster_name": "ゴリシザー", "object_name": "はさみ", "element": "風",
                    "description": "はさみの うでで なんでも きっちゃう"},
        "battle": {"attack": 2000, "hp": 4000},
    }
    m = to_battle_monster("a" * 32, result)
    assert m == {
        "id": "a" * 32,
        "name": "ゴリシザー",
        "source": {"animal": "ゴリラ", "object": "はさみ"},
        "attribute": "風",
        "attack": 2000,
        "hp": 4000,
        "description": "はさみの うでで なんでも きっちゃう",
        "image": "/api/monster-image/" + "a" * 32,
    }


def test_to_battle_monster_fills_missing_values():
    # バトルは文字が空・数字が範囲外だとエラーで止まるので、記録が欠けていても必ず埋める
    m = to_battle_monster("b" * 32, {"monster": {}, "battle": {"attack": 9999}})
    assert m["name"] and m["attribute"]
    assert m["attack"] in ATTACK_CHOICES and m["hp"] in HP_CHOICES


def test_battle_monster_api_uses_saved_stats_and_chosen_name(client):
    photo_id = upload(client, animal="ゴリラ")["photo_id"]
    data = client.post("/api/generate", data={"photo_id": photo_id}).json()
    assert data["ok"] is True, data
    result_path = main.OUTPUTS_DIR / data["output_dir"] / "result.json"
    saved = json.loads(result_path.read_text(encoding="utf-8"))["battle"]

    # 絵ができたあとに子供が名前を選んでも、バトルにはその名前が渡る
    other = main._name_choices[photo_id][-1]
    assert client.post("/api/choose-name", data={"photo_id": photo_id, "name": other}).status_code == 200

    m = client.get(f"/api/battle-monster/{photo_id}").json()
    assert m["name"] == other
    assert m["source"]["animal"] == "ゴリラ"
    assert (m["attack"], m["hp"]) == (saved["attack"], saved["hp"])
    assert client.get(m["image"]).status_code == 200


def test_battle_monster_api_unknown_and_bad_id(client):
    assert client.get("/api/battle-monster/" + "0" * 32).status_code == 404
    assert client.get("/api/battle-monster/nai").status_code == 400


def test_battle_monster_api_demo(client):
    # 開発者メニューのテストプレイの「たたかう!」(/battle/?play=demo)。見本のゴリラ × はさみを、選んだ名前で返す
    m = client.get("/api/battle-monster/demo", params={"name": "ゴリシザー"}).json()
    assert m["name"] == "ゴリシザー"
    assert m["source"] == {"animal": "ゴリラ", "object": "はさみ"}
    assert m["attack"] in ATTACK_CHOICES and m["hp"] in HP_CHOICES
    assert client.get(m["image"]).status_code == 200
    # 名前がなければ見本の名前。長すぎる名前は切る
    assert client.get("/api/battle-monster/demo").json()["name"] == "ゴリザミ"
    assert len(client.get("/api/battle-monster/demo", params={"name": "ア" * 100}).json()["name"]) == 20


def make_output(name, *, retake=False, image=True, monster_name="ゴリシザー"):
    """outputs/ に、前に作ったモンスターのフォルダを作る(テストでは一時フォルダ)。"""
    d = main.OUTPUTS_DIR / name
    d.mkdir(parents=True)
    result = {
        "created_at": "2026-11-02T10:00:00", "animal": "ゴリラ", "needs_retake": retake,
        "monster": {"monster_name": monster_name, "object_name": "はさみ", "element": "風"},
        "battle": {"attack": 3000, "hp": 5000},
    }
    (d / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    if image:
        (d / "monster.png").write_bytes(b"\x89PNG\r\n\x1a\n")


def test_recent_monsters_lists_finished_ones_newest_first(client):
    make_output("20261101_090000", monster_name="ふるい")
    make_output("20261102_090000", monster_name="あたらしい")
    make_output("20261102_090000_2", retake=True)   # 撮り直しになったもの
    make_output("20261102_100000", image=False)      # 絵がないもの
    monsters = client.get("/api/recent-monsters").json()["monsters"]
    assert [m["name"] for m in monsters] == ["あたらしい", "ふるい"]
    assert monsters[0]["id"] == "20261102_090000"
    assert client.get(monsters[0]["image"]).status_code == 200


def test_battle_monster_api_by_output_folder(client):
    # サーバーを再起動したあと(_photo_outputs が空)でも、フォルダ名で前のモンスターと戦える
    make_output("20261102_090000")
    m = client.get("/api/battle-monster/20261102_090000").json()
    assert m["name"] == "ゴリシザー"
    assert (m["attack"], m["hp"]) == (3000, 5000)
    assert m["image"] == "/api/output-image/20261102_090000"
    assert client.get("/api/battle-monster/20261102_000000").status_code == 404


def test_output_image_rejects_bad_names(client):
    assert client.get("/api/output-image/nai").status_code == 400
    assert client.get("/api/output-image/..%2F..%2Fapp").status_code in (400, 404)
    assert client.get("/api/output-image/20261102_000000").status_code == 404


def test_battle_page_is_served(client):
    if not (main.BATTLE_DIR / "index.html").is_file():
        pytest.skip("static/battle/ がまだビルドされていない")
    res = client.get("/battle/")
    assert res.status_code == 200
    assert '<div id="root">' in res.text
