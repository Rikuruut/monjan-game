"""これまでテストのなかった API と記録のテスト(2026年11月9日。リファクタリングの前に、今の動作を固めるために足した)。
からうちモードなので料金0円。"""

import json

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app import config, pipeline, storage
from app.routes import generate, name_test
from app.ws_manager import ws_manager
from tests.helpers import make_output, upload


@pytest.fixture
def client():
    return TestClient(main.app)


# ----------------------------------------------------------------------
# 料金の記録
# ----------------------------------------------------------------------
def test_usage_log_counts_cumulative_cost(tmp_path):
    assert storage.append_usage_log(tmp_path, {"cost_usd": 0.1}) == pytest.approx(0.1)
    assert storage.append_usage_log(tmp_path, {"cost_usd": 0.2}) == pytest.approx(0.3)
    # ほかのプログラム(tools/make_cpu_monsters.py)が足した行も数える。数でない行は数えない
    with (tmp_path / storage.USAGE_LOG_NAME).open("a", encoding="utf-8") as f:
        f.write(json.dumps({"cost_usd": 0.05}) + "\n")
        f.write(json.dumps({"cost_usd": "abc"}) + "\n")
        f.write("\n")
    assert storage.append_usage_log(tmp_path, {"cost_usd": 0.15}) == pytest.approx(0.5)
    assert storage.append_usage_log(tmp_path, {"note": "料金なし"}) == pytest.approx(0.5)


def test_build_usage_with_costs_adds_to_log():
    usage = pipeline.build_usage(
        check={"estimated_cost_usd": 0.001, "total_tokens": 10},
        describe=None,
        generate={"estimated_cost_usd": 0.02, "total_tokens": 400},
    )
    assert usage["total_cost_usd"] == pytest.approx(0.021)
    assert usage["describe"] == {}
    assert usage["cumulative_cost_usd"] == pytest.approx(0.021)
    lines = (config.OUTPUTS_DIR / storage.USAGE_LOG_NAME).read_text(encoding="utf-8").splitlines()
    entry = json.loads(lines[-1])
    assert entry["cost_usd"] == pytest.approx(0.021)
    assert entry["check_tokens"] == 10 and entry["generate_tokens"] == 400

    # 2回目は累計が増える
    again = pipeline.build_usage(generate={"estimated_cost_usd": 0.02})
    assert again["cumulative_cost_usd"] == pytest.approx(0.041)


def test_build_usage_without_cost_does_not_log():
    usage = pipeline.build_usage(check={}, generate=None)
    assert usage["total_cost_usd"] is None and "cumulative_cost_usd" not in usage
    assert not (config.OUTPUTS_DIR / storage.USAGE_LOG_NAME).exists()


# ----------------------------------------------------------------------
# 名前のテスト
# ----------------------------------------------------------------------
def test_name_test_dry_run(client):
    res = client.post("/api/name-test", data={"animal": "ライオン", "object_name": " はさみ ", "count": 3})
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] and data["animal"] == "ライオン" and data["object_name"] == "はさみ"
    assert len(data["runs"]) == 3 and all(r["name"] for r in data["runs"])
    assert data["total_cost_usd"] == 0 and data["cumulative_cost_yen"] is None
    # からうちのダミーの名前は残さない
    assert not (config.OUTPUTS_DIR / name_test.NAME_TEST_LOG_NAME).exists()


def test_name_test_limits_count_and_needs_object(client):
    data = client.post("/api/name-test", data={"animal": "ネコ", "object_name": "かさ", "count": 50}).json()
    assert len(data["runs"]) == name_test.NAME_TEST_MAX_COUNT
    res = client.post("/api/name-test", data={"animal": "ネコ", "object_name": "  "})
    assert res.status_code == 400


# ----------------------------------------------------------------------
# ページ・テーマ・つなぎの情報
# ----------------------------------------------------------------------
def test_themes_and_pc_page(client, monkeypatch):
    monkeypatch.setenv("PC_THEME", "nai")
    data = client.get("/api/themes").json()
    assert "fusion" in [t["id"] for t in data["themes"]]
    assert data["default"] == "fusion"
    fusion = client.get("/").text
    assert client.get("/", params={"theme": "nai"}).text == fusion
    assert client.get("/", params={"theme": "fusion"}).text == fusion
    assert client.get("/").headers["cache-control"] == "no-cache"


def test_cache_header_only_on_pages(client):
    assert client.get("/phone").headers["cache-control"] == "no-cache"
    assert client.get("/static/common/app.js").headers["cache-control"] == "no-cache"
    assert "cache-control" not in client.get("/api/animals").headers


def test_info_and_qr(client):
    info = client.get("/api/info").json()
    assert info["phone_url"].endswith(f":{config.PORT}/phone")
    assert info["phone_connected"] is False
    assert info["text_model"] == "test-text-model"
    first = client.get("/api/qr")
    assert first.headers["content-type"] == "image/png"
    assert first.content.startswith(b"\x89PNG")
    assert client.get("/api/qr").content == first.content


def test_animals(client):
    data = client.get("/api/animals").json()
    assert "ライオン" in data["animals"] and data["default_icon"]


def test_capture_request_without_phone(client):
    res = client.post("/api/capture-request")
    assert res.status_code == 409 and res.json()["ok"] is False


# ----------------------------------------------------------------------
# 作ったモンスターの一覧
# ----------------------------------------------------------------------
def test_recent_monsters_newest_30(client):
    for i in range(35):
        make_output(f"20261102_{i:06d}", monster_name=f"モン{i}")
    monsters = client.get("/api/recent-monsters").json()["monsters"]
    assert len(monsters) == 30
    assert monsters[0]["name"] == "モン34" and monsters[-1]["name"] == "モン5"


def test_recent_monsters_skips_odd_folders(client):
    make_output("20261102_090000")
    (config.OUTPUTS_DIR / "notes").mkdir()
    bad = config.OUTPUTS_DIR / "20261102_100000"
    bad.mkdir()
    (bad / "monster.png").write_bytes(b"\x89PNG")
    (bad / "result.json").write_text("{こわれている", encoding="utf-8")
    assert [m["id"] for m in client.get("/api/recent-monsters").json()["monsters"]] == ["20261102_090000"]


# ----------------------------------------------------------------------
# 絵を作っているあいだに名前を選ぶ
# ----------------------------------------------------------------------
def test_choose_name_while_drawing(client, monkeypatch):
    chosen = {}

    async def record(stage, **extra):
        # 名前の候補が届いたら(絵ができる前に)、子供が最後の候補を選んだことにする
        if stage == "names":
            chosen["name"] = extra["name_choices"][-1]
            await generate.api_choose_name(photo_id=extra["photo_id"], name=chosen["name"])

    async def ignore(*args, **kwargs):
        pass

    monkeypatch.setattr(ws_manager, "notify_progress", record)
    monkeypatch.setattr(ws_manager, "notify_name_chosen", ignore)
    data = client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]}).json()
    assert data["monster"]["monster_name"] == chosen["name"]
    assert data["monster"]["name_chosen_by_child"] is True
    result = json.loads((config.OUTPUTS_DIR / data["output_dir"] / "result.json").read_text(encoding="utf-8"))
    assert result["monster"]["monster_name"] == chosen["name"]
