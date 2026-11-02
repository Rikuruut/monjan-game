"""判定を2つに分けた流れ(短いプロンプト)と、途中の絵のテスト。からうちモードなので料金0円。"""

import hashlib
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app import generator, recognizer
from app.prompts import build_recognize_instructions
from tests.test_api_dry_run import upload


@pytest.fixture
def client():
    return TestClient(main.app)


@pytest.fixture
def stages(monkeypatch):
    """WebSocket で送った progress を、送った順に記録する。"""
    sent = []

    async def record(stage, **extra):
        sent.append((stage, extra))

    monkeypatch.setattr(main.ws_manager, "notify_progress", record)
    return sent


def names_of(sent):
    return [stage for stage, _ in sent]


# ----------------------------------------------------------------------
# 指示文
# ----------------------------------------------------------------------
def test_recognize_instructions_did_not_change():
    # 部品に分ける前(2026年11月2日)の指示文と、タイプの節のほかは1字も変わっていない(詳しいプロンプトの結果を変えないため)。
    # ハッシュは、同じ日に性質をタイプ(火・水 など)に変えたときの指示文
    expected = {
        False: "6dd6581658191e386a99cc2bd82927e8288e107b9dd4cac53aa009de30080048",
        True: "ed264b30b47b0e438b1b6cac5143ff453c320c2cb790631bac42a86f87154cf7",
    }
    for allow_person, digest in expected.items():
        text = build_recognize_instructions(allow_person)
        assert hashlib.sha256(text.encode()).hexdigest() == digest


# ----------------------------------------------------------------------
# 短いプロンプト(simple):すぐ要る判定 → 画像生成と、名前・説明を同時に
# ----------------------------------------------------------------------
def test_split_flow_order(client, stages):
    photo_id = upload(client)["photo_id"]
    data = client.post("/api/generate", data={"photo_id": photo_id}).json()
    assert data["ok"] is True and data["needs_retake"] is False

    order = names_of(stages)
    assert order[:2] == ["naming", "drawing"]
    assert order[-1] == "done"
    # 名前の候補は、絵ができる(done)より前に届く
    assert "names" in order and order.index("names") < order.index("done")
    names = dict(stages)["names"]
    assert names["name_choices"] and names["photo_id"] == photo_id
    # drawing では、まだ名前を送らない
    assert "name_choices" not in dict(stages)["drawing"]
    # 途中の絵が2枚届き、どれも取り出せる
    partials = [extra for stage, extra in stages if stage == "partial"]
    assert sorted(p["index"] for p in partials) == [1, 2]
    for p in partials:
        assert p["total"] == 2
        res = client.get(p["image_url"])
        assert res.status_code == 200 and res.headers["content-type"] == "image/png"

    # 時間と料金は、処理ごとに分けて残す。simple では設計図の6項目を作らない
    assert set(data["timings"]) == {"check", "describe", "generate", "total"}
    assert "check" in data["usage"] and "describe" in data["usage"]
    plan = data["monster"]["design_plan"]
    assert "animal_identity" not in plan
    assert plan["fusion_part"] and plan["staging"]


def test_quick_check_unreadable_is_retake_without_drawing(client, stages, monkeypatch):
    # すぐ要る判定の返答を読めなければ撮り直し。画像生成と名前・説明は呼ばない
    fake = SimpleNamespace(responses=SimpleNamespace(
        parse=lambda **kwargs: SimpleNamespace(output_parsed=None, usage=None)))
    monkeypatch.setattr(recognizer, "is_dry_run", lambda: False)
    monkeypatch.setattr(recognizer, "get_client", lambda: fake)

    def must_not_call(*args, **kwargs):
        raise AssertionError("撮り直しなのに呼ばれました")

    monkeypatch.setattr(main, "get_generator", must_not_call)
    monkeypatch.setattr(main, "describe", must_not_call)

    data = client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]}).json()
    assert data["ok"] is True and data["needs_retake"] is True
    assert names_of(stages) == ["naming", "retake"]


def test_quick_check_retake(client, stages, monkeypatch):
    def retake(photo_bytes):
        return recognizer.StepResult(
            {"needs_retake": True, "retake_reason": "ひとが うつっているよ", "has_person": True, "object_name": "ひと"},
            0.1, "test-text-model")

    monkeypatch.setattr(main, "quick_check", retake)
    data = client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]}).json()
    assert data["needs_retake"] is True and data["retake_reason"] == "ひとが うつっているよ"
    assert "generate" not in data["timings"]


def test_describe_failure_still_makes_monster(client, stages, monkeypatch):
    # 名前・説明が失敗しても、絵はでき、名前は既定値になる
    def broken(*args, **kwargs):
        raise recognizer.RecognizeError("名前・説明の呼び出しに失敗しました")

    monkeypatch.setattr(main, "describe", broken)
    data = client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]}).json()
    assert data["ok"] is True
    assert data["monster"]["monster_name"] == "なぞのモンスター"
    assert any("名前・説明を作れなかった" in n for n in data["validator_notes"])
    assert "names" in names_of(stages)


def test_detailed_flow_is_sequential(client, stages, monkeypatch):
    # 詳しいプロンプトは、今までどおり判定が終わってから画像生成(名前は drawing で届く)
    monkeypatch.setenv("IMAGE_PROMPT_STYLE", "detailed")
    data = client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]}).json()
    assert data["ok"] is True
    order = names_of(stages)
    assert order[:2] == ["naming", "drawing"] and order[-1] == "done"
    assert "names" not in order
    assert dict(stages)["drawing"]["name_choices"]
    assert set(data["timings"]) == {"recognize", "generate", "total"}
    assert data["monster"]["design_plan"]["animal_identity"]


def test_no_partials_when_turned_off(client, stages, monkeypatch):
    monkeypatch.setenv("IMAGE_PARTIAL_IMAGES", "0")
    client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]})
    assert "partial" not in names_of(stages)


def test_partial_image_route_checks_id(client):
    assert client.get("/api/partial-image/nai/0").status_code == 400
    assert client.get(f"/api/partial-image/{'0' * 32}/0").status_code == 404


# ----------------------------------------------------------------------
# 画像生成のストリーミング(API の代わりに、偽物のクライアントを使う)
# ----------------------------------------------------------------------
class ParamError(Exception):
    status_code = 400


def png_b64():
    import base64
    import io

    from PIL import Image
    buf = io.BytesIO()
    Image.new("RGB", (8, 8)).save(buf, "PNG")
    return base64.b64encode(buf.getvalue()).decode()


def fake_image_client(calls, reject_stream=False):
    usage = SimpleNamespace(input_tokens=10, output_tokens=20, total_tokens=30,
                            input_tokens_details=SimpleNamespace(text_tokens=4, image_tokens=6))

    def edit(**params):
        calls.append(params)
        if params.get("stream"):
            if reject_stream:
                raise ParamError("Unknown parameter: 'stream'")
            return iter([
                SimpleNamespace(type="image_edit.partial_image", partial_image_index=0, b64_json=png_b64()),
                SimpleNamespace(type="image_edit.partial_image", partial_image_index=1, b64_json=png_b64()),
                SimpleNamespace(type="image_edit.completed", b64_json=png_b64(), usage=usage),
            ])
        return SimpleNamespace(data=[SimpleNamespace(b64_json=png_b64())], usage=usage)

    return SimpleNamespace(images=SimpleNamespace(edit=edit))


@pytest.fixture
def real_generator(monkeypatch):
    monkeypatch.setattr(generator, "is_dry_run", lambda: False)
    monkeypatch.setenv("IMAGE_QUALITY", "")


def test_stream_sends_partials_and_reads_usage(monkeypatch, real_generator):
    calls, partials = [], []
    monkeypatch.setattr(generator, "get_client", lambda timeout=None: fake_image_client(calls))
    result = generator.OpenAIImageGenerator().generate(
        b"photo", "ライオン", "はさみ", "", {}, False, lambda i, png: partials.append(i))
    assert [i for i in partials] == [0, 1]
    assert calls[0]["stream"] is True and calls[0]["partial_images"] == 2
    assert result.image_bytes and result.usage["total_tokens"] == 30


def test_partial_images_are_added_to_cost(monkeypatch, real_generator):
    # 途中の絵は1枚 100 画像出力トークン(公式)。API の使用量に入っていないので、試算に足す
    monkeypatch.setenv("IMAGE_MODEL", "gpt-image-2.5-sunburst")
    calls = []
    monkeypatch.setattr(generator, "get_client", lambda timeout=None: fake_image_client(calls))
    with_partials = generator.OpenAIImageGenerator().generate(
        b"photo", "ライオン", "はさみ", "", {}, False, lambda i, png: None).usage
    without = generator.OpenAIImageGenerator().generate(b"photo", "ライオン", "はさみ", "", {}, False).usage

    assert with_partials["partial_images"] == 2 and with_partials["partial_image_output_tokens"] == 200
    # 200 トークン × $30 / 100万 = $0.006
    assert with_partials["estimated_cost_usd"] == pytest.approx(without["estimated_cost_usd"] + 0.006)
    assert with_partials["estimated_cost_yen"] == pytest.approx(with_partials["estimated_cost_usd"] * 150, abs=0.01)
    assert "partial_images" not in without


def test_stream_rejected_retries_without_stream(monkeypatch, real_generator):
    calls = []
    monkeypatch.setattr(generator, "get_client", lambda timeout=None: fake_image_client(calls, reject_stream=True))
    result = generator.OpenAIImageGenerator().generate(
        b"photo", "ライオン", "はさみ", "", {}, False, lambda i, png: None)
    assert len(calls) == 2 and "stream" not in calls[1]
    assert any("途中の絵" in n for n in result.notes)


def test_no_stream_without_callback(monkeypatch, real_generator):
    calls = []
    monkeypatch.setattr(generator, "get_client", lambda timeout=None: fake_image_client(calls))
    generator.OpenAIImageGenerator().generate(b"photo", "ライオン", "はさみ", "", {}, False)
    assert "stream" not in calls[0]


def test_object_part_goes_into_design_plan(client, stages):
    data = client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]}).json()
    assert data["monster"]["object_part"] == "ダミーのパーツ"
    assert data["monster"]["design_plan"]["object_part"] == "ダミーのパーツ"


def test_revealed_tells_phone_after_pc_birth(client, monkeypatch):
    # スマホは、PC の誕生の演出が終わった知らせ(revealed)が届いてから絵を見せる
    sent = []

    async def record(photo_id, image_url):
        sent.append((photo_id, image_url))

    photo_id = upload(client)["photo_id"]
    client.post("/api/generate", data={"photo_id": photo_id})
    monkeypatch.setattr(main.ws_manager, "notify_revealed", record)
    res = client.post("/api/revealed", data={"photo_id": photo_id})
    assert res.status_code == 200
    assert sent == [(photo_id, f"/api/monster-image/{photo_id}")]


def test_revealed_unknown_or_bad_id(client):
    assert client.post("/api/revealed", data={"photo_id": "0" * 32}).status_code == 404
    assert client.post("/api/revealed", data={"photo_id": "nai"}).status_code == 400
