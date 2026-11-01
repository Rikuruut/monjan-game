"""OpenAIクライアントの共通処理。

APIキーは必ず`.env`から読み込む(コードに直接書かない)。
タイムアウトも`.env`の`API_TIMEOUT_SECONDS`で指定する。
判定と画像生成の両方から使う。
"""

from __future__ import annotations

import os

from openai import OpenAI

# タイムアウトの既定値(秒)
#
# ※ 2026年10月29日:30秒 → 60秒に上げた。
#   判定の指示(融合デザイン・置き換え対応表)を足すにつれて判定の時間が伸び
#   (当初 約4〜7秒 → 約8〜16秒)、ばらつきで30秒を超えてタイムアウトしたため。
DEFAULT_TIMEOUT_SECONDS = 60.0

# 画像生成のタイムアウトの既定値(秒)
#
# ※ 画像生成は実測で30秒を超えることがある
#   (gpt-image-2 / 画質medium / 1024x1024 で約35秒)。
#   そのため画像生成だけ別のタイムアウトを持たせている。
DEFAULT_IMAGE_TIMEOUT_SECONDS = 120.0


class MissingApiKeyError(RuntimeError):
    """APIキーが設定されていないときのエラー。"""


def is_dry_run() -> bool:
    """「からうち」モードかどうか。

    `.env`の`DRY_RUN=true`にすると、OpenAI APIを**一切呼ばず**に、
    決まった判定結果とダミー画像を返す。料金は0円。

    画面の動作確認やスマホの接続確認など、絵の中身が関係ない作業は
    このモードで行うことで、無駄な料金が発生しないようにする。
    """
    return (os.getenv("DRY_RUN") or "").strip().lower() in ("1", "true", "yes", "on")


def allow_person() -> bool:
    """人が写った写真も生成するかどうか。

    `.env`の`ALLOW_PERSON=true`にすると、人が写っていても撮り直しにせず、
    人の見た目を取り込んだモンスターを作る(面白枠)。

    ※ 展示で使うときの注意
      - 撮られる本人(と保護者)の同意が取れている場合だけ true にすること。
      - 通りすがりの他人が写り込む可能性があるので、本番は false に戻すのが安全。
      - OpenAIの画像モデルは実在の人物の扱いに制限があり、
        コンテンツフィルターで拒否されることがある(その場合は素直にエラー表示)。
    """
    return (os.getenv("ALLOW_PERSON") or "").strip().lower() in ("1", "true", "yes", "on")


def image_prompt_style() -> str:
    """画像プロンプトの書き方(`.env`の`IMAGE_PROMPT_STYLE`)。

    detailed(設計図つきの詳しいプロンプト)/ simple(Playground と同じ短いプロンプト)。
    不明な値や未設定のときは detailed にする。
    """
    from .prompts import normalize_image_prompt_style
    return normalize_image_prompt_style(os.getenv("IMAGE_PROMPT_STYLE"))


def _read_seconds(name: str, default: float) -> float:
    """`.env`から秒数を読む。読めなければ既定値を使う。"""
    try:
        value = float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default
    return value if value > 0 else default


def get_timeout() -> float:
    """判定などに使うタイムアウト(秒)。"""
    return _read_seconds("API_TIMEOUT_SECONDS", DEFAULT_TIMEOUT_SECONDS)


def get_image_timeout() -> float:
    """画像生成に使うタイムアウト(秒)。"""
    return _read_seconds("IMAGE_TIMEOUT_SECONDS", DEFAULT_IMAGE_TIMEOUT_SECONDS)


def get_client(timeout: float | None = None) -> OpenAI:
    """OpenAIクライアントを作って返す。

    リトライはこちらで制御したいので、SDKの自動リトライは切る。
    `timeout`を渡さない場合は`API_TIMEOUT_SECONDS`を使う。
    """
    api_key = (os.getenv("OPENAI_API_KEY") or "").strip()
    if not api_key:
        raise MissingApiKeyError(
            ".envの OPENAI_API_KEY が設定されていません"
        )

    return OpenAI(
        api_key=api_key,
        timeout=get_timeout() if timeout is None else timeout,
        max_retries=0,
    )
