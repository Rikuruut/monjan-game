"""テストの共通の準備。

OpenAI API は一切呼ばない(料金0円)。そのために2重に守っている。
  1. からうちモード(DRY_RUN=true)にする
  2. それでも API を呼ぼうとしたら、テストを失敗させる(get_client を差しかえる)

※ app.main を読みこむと、.env の内容で環境変数が上書きされる(load_dotenv(override=True))。
  .env は DRY_RUN=false なので、DRY_RUN は app.main を読みこんだ「あと」に設定する。
"""

import pytest

import app.main as main  # 先に読みこむ(.env で上書きされるのを、ここで済ませておく)
from app import generator, openai_client, recognizer


def _no_api(*args, **kwargs):
    raise AssertionError("テストで OpenAI API を呼ぼうとしました(料金がかかるので止めました)")


@pytest.fixture(autouse=True)
def safe_env(monkeypatch, tmp_path):
    monkeypatch.setenv("DRY_RUN", "true")
    monkeypatch.setenv("TEXT_MODEL", "test-text-model")
    monkeypatch.setenv("IMAGE_MODEL", "test-image-model")
    for module in (openai_client, recognizer, generator):
        if hasattr(module, "get_client"):
            monkeypatch.setattr(module, "get_client", _no_api)
    assert openai_client.is_dry_run()

    # 写真と結果は、テストごとの一時フォルダに保存する(uploads/・outputs/ を汚さない)
    uploads = tmp_path / "uploads"
    outputs = tmp_path / "outputs"
    uploads.mkdir()
    outputs.mkdir()
    monkeypatch.setattr(main, "UPLOADS_DIR", uploads)
    monkeypatch.setattr(main, "OUTPUTS_DIR", outputs)

    # 名前の候補の記録は、テストごとに空にする
    for store in (main._name_choices, main._chosen_names, main._photo_outputs):
        store.clear()
    yield
