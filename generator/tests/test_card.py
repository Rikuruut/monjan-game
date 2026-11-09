"""モンスターカード(app/card.py・/card・/api/card-data・/api/card-pdf)のテスト。

API は呼ばない(料金0円)。PDF を作るところは、ブラウザを起動せずに差し替えて確かめる。
"""

import json
from datetime import datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import app.main as main
from app import card, kiosk
from app.card import CARD_PDF_NAME, card_number, next_card_number, pdf_command, to_card
from tests.test_api_dry_run import upload
from tests.test_battle import make_output


def edit_result(name, **fields):
    """make_output で作った result.json に項目を足す。"""
    path = main.OUTPUTS_DIR / name / "result.json"
    result = json.loads(path.read_text(encoding="utf-8"))
    result.update(fields)
    path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


@pytest.fixture
def client():
    return TestClient(main.app)


def test_to_card_counts_stats():
    # ⚔♡は 1000 = 1個なので、カードには個数で載せる
    c = to_card({
        "id": "x", "name": "ゴリシザー", "attribute": "風", "attack": 3000, "hp": 4000,
        "source": {"animal": "ゴリラ", "object": "はさみ"}, "description": "せつめい", "image": "/img",
    }, "2026-11-02T10:00:00", 42)
    assert c == {
        "id": "x", "name": "ゴリシザー", "element": "風", "attack": 3, "hp": 4,
        "animal": "ゴリラ", "object": "はさみ", "description": "せつめい", "image": "/img",
        "created_at": "2026-11-02T10:00:00", "no": 42,
    }


def test_card_data_by_output_folder(client):
    make_output("20261102_090000")
    c = client.get("/api/card-data/20261102_090000").json()
    assert (c["name"], c["element"], c["attack"], c["hp"]) == ("ゴリシザー", "風", 3, 5)
    assert (c["animal"], c["object"]) == ("ゴリラ", "はさみ")
    assert c["created_at"] == "2026-11-02T10:00:00"
    assert c["image"] == "/api/output-image/20261102_090000"
    assert client.get(c["image"]).status_code == 200


def test_card_data_by_photo_id_uses_folder_image(client):
    # いま作ったモンスター(photo_id)でも、絵はサーバーを再起動しても見られるフォルダの URL にする
    make_output("20261102_090000")
    main._photo_outputs["a" * 32] = "20261102_090000"
    c = client.get("/api/card-data/" + "a" * 32).json()
    assert c["id"] == "a" * 32
    assert c["image"] == "/api/output-image/20261102_090000"


def test_card_data_demo_and_bad_ids(client):
    c = client.get("/api/card-data/demo", params={"name": "テスト"}).json()
    assert c["name"] == "テスト" and c["attack"] == 2 and c["hp"] == 4
    assert c["no"] == 0
    assert client.get("/api/card-data/nai").status_code == 400
    assert client.get("/api/card-data/" + "b" * 32).status_code == 404
    assert client.get("/api/card-data/20261102_000000").status_code == 404


def test_card_page_is_served(client):
    res = client.get("/card", params={"id": "demo"})
    assert res.status_code == 200
    assert 'id="card"' in res.text
    assert res.headers["cache-control"] == "no-cache"


def test_pdf_command():
    cmd = pdf_command(Path("C:/edge/msedge.exe"), "http://localhost:8000/card?id=x", Path("C:/out/card.pdf"))
    assert cmd[0].endswith("msedge.exe")
    assert "--headless" in cmd
    assert "--print-to-pdf=" + str(Path("C:/out/card.pdf")) in cmd
    assert cmd[-1] == "http://localhost:8000/card?id=x"
    # キオスクの窓とぶつからないよう、別のプロフィールを使う
    assert f"--user-data-dir={card.PDF_PROFILE_DIR}" in cmd
    assert card.PDF_PROFILE_DIR != kiosk.PROFILE_DIR


def test_card_pdf_api_saves_into_output_folder(client, monkeypatch):
    make_output("20261102_090000")
    calls = []

    def fake_run(args, **kwargs):
        calls.append(args)
        out = next(a for a in args if a.startswith("--print-to-pdf=")).split("=", 1)[1]
        Path(out).write_bytes(b"%PDF-1.4")

    monkeypatch.setattr(main, "find_browser", lambda: Path("C:/edge/msedge.exe"))
    monkeypatch.setattr(card.subprocess, "run", fake_run)
    monkeypatch.setattr(card, "PDF_POLL_SECONDS", 0.05)
    res =client.post("/api/card-pdf/20261102_090000").json()
    assert res == {"ok": True, "output_dir": "20261102_090000", "file": CARD_PDF_NAME}
    assert (main.OUTPUTS_DIR / "20261102_090000" / CARD_PDF_NAME).read_bytes() == b"%PDF-1.4"
    assert calls[0][-1].endswith("/card?id=20261102_090000")


def test_card_pdf_api_reports_failure(client, monkeypatch):
    make_output("20261102_090000")
    monkeypatch.setattr(main, "find_browser", lambda: Path("C:/edge/msedge.exe"))
    monkeypatch.setattr(card.subprocess, "run", lambda args, **kwargs: None)   # PDF を書き出さない
    monkeypatch.setattr(card, "PDF_WRITE_WAIT_SECONDS", 0.3)
    monkeypatch.setattr(card, "PDF_POLL_SECONDS", 0.05)
    res = client.post("/api/card-pdf/20261102_090000")
    assert res.status_code == 500 and res.json()["ok"] is False
    assert client.post("/api/card-pdf/demo").status_code == 400


def test_kiosk_printing_flag(monkeypatch):
    browser = Path("C:/edge/msedge.exe")
    monkeypatch.setenv("KIOSK_PRINTING", "false")
    assert "--kiosk-printing" not in kiosk.kiosk_args(browser, "http://x/")
    monkeypatch.setenv("KIOSK_PRINTING", "true")
    assert "--kiosk-printing" in kiosk.kiosk_args(browser, "http://x/")


# ---- No.(その日に作った順) ----
def test_card_number_counts_only_that_day():
    make_output("20261101_230000")                 # 前の日
    make_output("20261102_090000")
    make_output("20261102_093000", retake=True)    # 撮り直し
    make_output("20261102_094000", image=False)    # 絵がない
    make_output("20261102_095000")
    make_output("20261102_100000")
    edit_result("20261102_100000", purpose="CPU用")  # CPU 用
    out = main.OUTPUTS_DIR
    read = lambda n: json.loads((out / n / "result.json").read_text(encoding="utf-8"))
    assert card_number(out, "20261101_230000", read("20261101_230000")) == 1
    assert card_number(out, "20261102_090000", read("20261102_090000")) == 1
    assert card_number(out, "20261102_095000", read("20261102_095000")) == 2
    assert card_number(out, "20261102_100000", read("20261102_100000")) is None   # CPU 用は番号なし
    assert next_card_number(out, "20261102") == 3
    assert next_card_number(out, "20261103") == 1                                  # 次の日は 1 から


def test_saved_card_number_wins():
    make_output("20261102_090000")
    edit_result("20261102_090000", card={"no": 7})
    out = main.OUTPUTS_DIR
    result = json.loads((out / "20261102_090000" / "result.json").read_text(encoding="utf-8"))
    assert card_number(out, "20261102_090000", result) == 7
    assert next_card_number(out, "20261102") == 8   # 残っている番号の次


def test_generate_saves_card_number(client):
    nos = []
    for _ in range(2):
        photo_id = upload(client, animal="ゴリラ")["photo_id"]
        data = client.post("/api/generate", data={"photo_id": photo_id}).json()
        assert data["ok"] is True, data
        result = json.loads((main.OUTPUTS_DIR / data["output_dir"] / "result.json").read_text(encoding="utf-8"))
        assert data["output_dir"].startswith(datetime.now().strftime("%Y%m%d"))
        nos.append(result["card"]["no"])
        assert client.get("/api/card-data/" + photo_id).json()["no"] == result["card"]["no"]
    assert nos == [1, 2]


def test_card_data_numbers_old_records(client):
    make_output("20261102_090000")
    make_output("20261102_100000")
    assert client.get("/api/card-data/20261102_100000").json()["no"] == 2
    edit_result("20261102_100000", purpose="CPU用")
    assert client.get("/api/card-data/20261102_100000").json()["no"] is None
