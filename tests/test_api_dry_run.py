"""サーバーの流れ(写真を送る → 生成 → 名前を選ぶ)のテスト。からうちモードなので料金0円。"""

import io
import json

import pytest
from fastapi.testclient import TestClient
from PIL import Image

import app.main as main


@pytest.fixture
def client():
    return TestClient(main.app)


def jpeg_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 120, 40)).save(buf, format="JPEG")
    return buf.getvalue()


def upload(client, animal="ライオン"):
    res = client.post("/api/upload", files={"photo": ("photo.jpg", jpeg_bytes(), "image/jpeg")},
                      data={"animal": animal})
    assert res.status_code == 200, res.text
    return res.json()


def test_upload_saves_photo_and_animal(client):
    data = upload(client)
    assert data["ok"] and data["animal"] == "ライオン"
    assert (main.UPLOADS_DIR / f"{data['photo_id']}.jpg").exists()


def test_upload_rejects_non_image(client):
    res = client.post("/api/upload", files={"photo": ("photo.jpg", b"not an image", "image/jpeg")},
                      data={"animal": "ライオン"})
    assert res.status_code == 400


def test_generate_in_dry_run_saves_result(client):
    photo_id = upload(client)["photo_id"]
    res = client.post("/api/generate", data={"photo_id": photo_id})
    data = res.json()
    assert data["ok"] is True, data
    assert data["needs_retake"] is False
    assert data["monster"]["monster_name"]
    # からうちモードは料金0円で、累計の記録にも足さない
    assert not data["usage"]["total_cost_usd"]

    out_dir = main.OUTPUTS_DIR / data["output_dir"]
    for name in ("photo.jpg", "monster.png", "result.json"):
        assert (out_dir / name).exists(), name
    result = json.loads((out_dir / "result.json").read_text(encoding="utf-8"))
    assert result["animal"] == "ライオン"


def test_generate_unknown_photo_is_404(client):
    res = client.post("/api/generate", data={"photo_id": "0" * 32})
    assert res.status_code == 404


@pytest.mark.parametrize("photo_id", ["nai", "../outputs/x/result", "A" * 32])
def test_generate_bad_photo_id_is_400(client, photo_id):
    # ファイルの場所に使うので、uploads/ の外を指す値などは受け付けない
    res = client.post("/api/generate", data={"photo_id": photo_id})
    assert res.status_code == 400


def test_generate_while_running_is_409(client, monkeypatch):
    class Busy:
        def locked(self):
            return True

    photo_id = upload(client)["photo_id"]
    monkeypatch.setattr(main, "_generate_lock", Busy())
    res = client.post("/api/generate", data={"photo_id": photo_id})
    assert res.status_code == 409
    assert res.json()["ok"] is False


def test_unexpected_error_notifies_error(client, monkeypatch):
    # 保存に失敗しても、スマホがローディングのまま止まらないよう error を知らせる
    stages = []

    async def record(stage, **extra):
        stages.append(stage)

    def broken_save(*args, **kwargs):
        raise OSError("ディスクがいっぱい")

    photo_id = upload(client)["photo_id"]
    monkeypatch.setattr(main.ws_manager, "notify_progress", record)
    monkeypatch.setattr(main, "save_result", broken_save)
    data = client.post("/api/generate", data={"photo_id": photo_id}).json()
    assert data["ok"] is False and data["step"] == "サーバー"
    assert stages[-1] == "error"


def test_unreadable_recognize_response_is_retake(client, monkeypatch):
    # 判定のモデルが断った(output_parsed が None)ときは、画像生成に進まず撮り直しにする
    from types import SimpleNamespace

    from app import recognizer

    fake = SimpleNamespace(responses=SimpleNamespace(
        parse=lambda **kwargs: SimpleNamespace(output_parsed=None, usage=None)))
    monkeypatch.setattr(recognizer, "is_dry_run", lambda: False)
    monkeypatch.setattr(recognizer, "get_client", lambda: fake)

    photo_id = upload(client)["photo_id"]
    data = client.post("/api/generate", data={"photo_id": photo_id}).json()
    assert data["ok"] is True and data["needs_retake"] is True
    assert data["retake_reason"]


def test_photo_and_monster_image_routes(client):
    up = upload(client)
    photo_id = up["photo_id"]
    assert client.get(up["photo_url"]).headers["content-type"] == "image/jpeg"

    data = client.post("/api/generate", data={"photo_id": photo_id}).json()
    res = client.get(data["monster_url"])
    assert res.status_code == 200 and res.headers["content-type"] == "image/png"
    # 生成が終わった写真は uploads/ に残さない(outputs/ に保存してある)
    assert not (main.UPLOADS_DIR / f"{photo_id}.jpg").exists()
    assert client.get(up["photo_url"]).status_code == 404


def test_outputs_folder_is_not_public(client):
    data = client.post("/api/generate", data={"photo_id": upload(client)["photo_id"]}).json()
    assert client.get(f"/outputs/{data['output_dir']}/photo.jpg").status_code == 404
    assert client.get(f"/outputs/{data['output_dir']}/result.json").status_code == 404


def test_choose_name_updates_result(client):
    photo_id = upload(client)["photo_id"]
    data = client.post("/api/generate", data={"photo_id": photo_id}).json()
    choices = main._name_choices[photo_id]
    other = choices[-1]

    res = client.post("/api/choose-name", data={"photo_id": photo_id, "name": other})
    assert res.status_code == 200 and res.json()["name"] == other
    result = json.loads((main.OUTPUTS_DIR / data["output_dir"] / "result.json").read_text(encoding="utf-8"))
    assert result["monster"]["monster_name"] == other
    assert result["monster"]["name_chosen_by_child"] is True


def test_choose_name_not_in_choices_is_rejected(client):
    photo_id = upload(client)["photo_id"]
    client.post("/api/generate", data={"photo_id": photo_id})
    res = client.post("/api/choose-name", data={"photo_id": photo_id, "name": "ベツノナマエ"})
    assert res.status_code == 400
