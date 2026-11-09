"""サーバー全体の設定(.env の読み込み・ログ・フォルダの場所)。

ほかのモジュールより先に読み込む(app/main.py の先頭)。
フォルダの場所はテストで差しかえるので、使う側は `config.OUTPUTS_DIR` のように、使うときに読む。
"""

from __future__ import annotations

import logging
import os
from pathlib import Path

from dotenv import load_dotenv

from .net_utils import get_lan_ip
from .openai_client import image_prompt_style

# .envの読み込み
# override=True:ターミナルに同じ名前の環境変数が残っていても、.env の値を優先する。
# (2026年10月30日:.env を gpt-image-2.5-sunburst に変えたのに、起動したターミナルに残っていた
#   IMAGE_MODEL=gpt-image-2 が使われてしまったため。設定は .env にまとめる方針なので、.env を正とする)
load_dotenv(override=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

# ディレクトリの場所
BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
BATTLE_DIR = STATIC_DIR / "battle"   # じゃんけんバトル(../battle/ を npm run build したもの)
THEMES_DIR = STATIC_DIR / "themes"   # PC用ページの見た目(app/themes.py)
UPLOADS_DIR = BASE_DIR / "uploads"   # 届いた写真の一時置き場
OUTPUTS_DIR = BASE_DIR / "outputs"   # 生成結果の保存先

UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)

PORT = int(os.getenv("PORT", "8000"))


def phone_url() -> str:
    """スマホで開くURL。"""
    return f"http://{get_lan_ip()}:{PORT}/phone"


def current_settings() -> dict[str, str]:
    """いまの .env の設定(モデル名・画質など)。PC画面と result.json に出す。"""
    return {
        "text_model": os.getenv("TEXT_MODEL", ""),
        "image_model": os.getenv("IMAGE_MODEL", ""),
        "image_quality": os.getenv("IMAGE_QUALITY", ""),
        "image_size": os.getenv("IMAGE_SIZE", ""),
        # 画像プロンプトの書き方(detailed / simple)。比べるときに、どちらで作ったか分かるように残す
        "image_prompt_style": image_prompt_style(),
    }
