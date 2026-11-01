"""モンスター画像の生成。

あとで別のサービス(OpenAI以外)に差し替えられるように、
「画像生成器」の形を決めてから、その中身としてOpenAIの実装を書く。
差し替えるときは、同じ形の実装を足して `get_generator()` の中身を変えるだけでよい。
"""

from __future__ import annotations

import base64
import io
import logging
import os
import re
import time
from dataclasses import dataclass, field
from typing import Protocol

from PIL import Image as PILImage, ImageDraw

from .openai_client import (
    allow_person,
    get_client,
    get_image_timeout,
    image_prompt_style,
    is_dry_run,
)
from .pricing import format_cost, read_usage
from .prompts import build_image_prompt

logger = logging.getLogger(__name__)


class ImageGenerationError(RuntimeError):
    """画像生成に失敗したときのエラー。"""


class ContentFilterError(ImageGenerationError):
    """コンテンツフィルターで止められたときのエラー。

    同じ入力でリトライしてはいけないので、他の失敗と区別する。
    """


@dataclass
class GenerationResult:
    """画像生成の結果。"""

    image_bytes: bytes             # 生成された画像(PNG)
    elapsed_seconds: float         # かかった時間
    model: str                     # 使ったモデル名
    quality: str                   # 実際に使った画質(送らなかった場合は "(指定なし)")
    size: str                      # 実際に使ったサイズ(例 1024x768)
    prompt: str                    # 実際に送ったプロンプト
    notes: list[str] = field(default_factory=list)  # 補足(パラメーターを外した等)
    usage: dict = field(default_factory=dict)       # 使ったトークン数と料金の試算


class ImageGenerator(Protocol):
    """画像生成器の形。別のサービスに差し替えるときも、この形に合わせる。"""

    def generate(
        self,
        photo_bytes: bytes,
        animal: str,
        object_name: str,
        element: str,
        design_plan: dict[str, str] | None = None,
        has_person: bool = False,
    ) -> GenerationResult:
        ...


# ----------------------------------------------------------------------
# OpenAIの画像生成モデルを使う実装
# ----------------------------------------------------------------------

# 出力の設定
#
# サイズは `.env` の IMAGE_SIZE で変えられる。
# 既定は 4:3 の 1024x768(カードの絵柄の枠とゲーム内画像の両方で使う想定)。
# APIの決まりで、幅・高さとも16の倍数、縦横比は1:3〜3:1の範囲にする必要がある。
DEFAULT_IMAGE_SIZE = "1024x768"
IMAGE_FORMAT = "png"

# 16の倍数かどうかを確かめるための正規表現
_SIZE_PATTERN = re.compile(r"^(\d+)x(\d+)$")

# 画質を指定しないことを表す値
QUALITY_OMITTED = "(指定なし)"

# 画質を送らない設定値
_QUALITY_SKIP_VALUES = {"", "auto", "none", QUALITY_OMITTED}


class OpenAIImageGenerator:
    """OpenAIの画像編集エンドポイント(images.edit)で生成する。

    撮った写真を参照画像として渡すため、生成ではなく編集の呼び出し方を使う。
    """

    def __init__(self) -> None:
        self.model = (os.getenv("IMAGE_MODEL") or "").strip()
        self.quality = (os.getenv("IMAGE_QUALITY") or "").strip().lower()
        self.size = _valid_size(os.getenv("IMAGE_SIZE"))

    def generate(
        self,
        photo_bytes: bytes,
        animal: str,
        object_name: str,
        element: str,
        design_plan: dict[str, str] | None = None,
        has_person: bool = False,
    ) -> GenerationResult:
        if not self.model:
            raise ImageGenerationError(".envの IMAGE_MODEL が設定されていません")

        prompt = build_image_prompt(
            animal, object_name, element, design_plan,
            allow_person=allow_person(), has_person=has_person,
            prompt_style=image_prompt_style(),
        )

        # からうちモード:APIを呼ばずにダミー画像を返す(料金0円)
        if is_dry_run():
            logger.info("からうちモード(DRY_RUN)のため、画像生成のAPIは呼びません")
            return GenerationResult(
                image_bytes=_dummy_image(self.size, animal, object_name),
                elapsed_seconds=0.0,
                model=f"{self.model}(からうち)",
                quality=self.quality,
                size=self.size,
                prompt=prompt,
                notes=["からうちモード(DRY_RUN)のため、APIは呼んでいません(料金0円)"],
                usage={},
            )

        # 画像生成は判定より時間がかかるので、専用のタイムアウトを使う
        client = get_client(timeout=get_image_timeout())
        notes: list[str] = []

        # 画質を送るかどうか。
        # ※ 公式のAPIリファレンスには「gpt-image-2 では quality を省略する」とあり、
        #   画像生成ガイドには「以前のGPT Imageモデルは high までの画質に対応」とある。
        #   記述が食い違っているので、まず設定値を送り、画質が原因で断られた場合だけ
        #   画質を外して1回だけやり直す(入力は変えていないので、同じ失敗の繰り返しにはならない)。
        send_quality = self.quality not in _QUALITY_SKIP_VALUES

        started = time.monotonic()
        try:
            response = self._call(client, photo_bytes, prompt, send_quality)
            used_quality = self.quality if send_quality else QUALITY_OMITTED

        except _QualityNotSupported as e:
            # 画質のパラメーターが受け付けられなかったので、外してやり直す
            logger.info("画質の指定が使えなかったので、外してやり直します: %s", e)
            notes.append(f"このモデルは画質の指定({self.quality})を受け付けないため、画質なしで生成しました")
            try:
                response = self._call(client, photo_bytes, prompt, send_quality=False)
                used_quality = QUALITY_OMITTED
            except Exception as e2:
                raise self._to_error(e2, time.monotonic() - started) from e2

        except Exception as e:
            raise self._to_error(e, time.monotonic() - started) from e

        elapsed = time.monotonic() - started

        # 画像を取り出す(GPT Imageのモデルはbase64で返る)
        try:
            b64 = response.data[0].b64_json
            if not b64:
                raise ValueError("画像のデータが空でした")
            image_bytes = base64.b64decode(b64)
        except Exception as e:
            raise ImageGenerationError(
                f"生成結果から画像を取り出せませんでした: {type(e).__name__}: {e}"
            ) from e

        # 画像生成は料金が大きいので、1回ごとの使用量を必ず記録しておく
        usage = read_usage(response, self.model)

        logger.info("画像生成が完了しました(%.1f秒): model=%s quality=%s size=%s %dKB 試算=%s",
                    elapsed, self.model, used_quality, self.size, len(image_bytes) // 1024,
                    format_cost(usage.get("estimated_cost_usd")))

        return GenerationResult(
            image_bytes=image_bytes,
            elapsed_seconds=elapsed,
            model=self.model,
            quality=used_quality,
            size=self.size,
            prompt=prompt,
            notes=notes,
            usage=usage,
        )

    # ------------------------------------------------------------------
    def _call(self, client, photo_bytes: bytes, prompt: str, send_quality: bool):
        """images.edit を呼ぶ。"""
        params = {
            "model": self.model,
            # 参照画像として、撮った写真をそのまま渡す
            "image": ("photo.jpg", photo_bytes, "image/jpeg"),
            "prompt": prompt,
            "size": self.size,
            "output_format": IMAGE_FORMAT,
            "n": 1,
        }
        if send_quality:
            params["quality"] = self.quality

        try:
            return client.images.edit(**params)
        except Exception as e:
            # 画質のパラメーターが原因で断られた場合は、やり直せるように区別する
            if send_quality and self._is_quality_problem(e):
                raise _QualityNotSupported(str(e)) from e
            raise

    @staticmethod
    def _is_quality_problem(e: Exception) -> bool:
        """エラーが「画質の指定が使えない」ことによるものかを判定する。"""
        status = getattr(e, "status_code", None)
        if status != 400:
            return False
        return "quality" in str(e).lower()

    @staticmethod
    def _to_error(e: Exception, elapsed: float) -> ImageGenerationError:
        """APIのエラーを、画面に出せる形のエラーに変える。"""
        text = str(e)
        code = getattr(e, "code", None) or ""

        # コンテンツフィルターで止められた場合(同じ入力でリトライしない)
        filtered_words = ("moderation_blocked", "content_policy", "safety system", "rejected")
        if any(w in f"{code} {text}".lower() for w in filtered_words):
            logger.warning("コンテンツフィルターで止められました(%.1f秒): %s", elapsed, text)
            return ContentFilterError(
                "安全フィルターにより画像を生成できませんでした。"
                "別のものを撮ってやり直してください(同じ写真では再試行しません)"
            )

        logger.warning("画像生成に失敗しました(%.1f秒): %s", elapsed, text)
        return ImageGenerationError(f"画像生成の呼び出しに失敗しました: {type(e).__name__}: {text}")


class _QualityNotSupported(Exception):
    """画質のパラメーターが受け付けられなかったことを表す、内部用の印。"""


def _dummy_image(size: str, animal: str, object_name: str) -> bytes:
    """からうちモードで返すダミー画像を作る。

    APIを呼んでいないことが一目で分かるように、文字を入れておく。
    """
    m = _SIZE_PATTERN.match(size)
    w, h = (int(m.group(1)), int(m.group(2))) if m else (1024, 768)

    img = PILImage.new("RGB", (w, h), (235, 238, 245))
    d = ImageDraw.Draw(img)
    d.rectangle([(8, 8), (w - 9, h - 9)], outline=(150, 160, 185), width=6)

    lines = [
        "DRY RUN (からうちモード)",
        "APIは呼んでいません / 料金0円",
        f"{animal} x {object_name}",
        f"{w}x{h}",
    ]
    y = h // 2 - 40
    for text in lines:
        d.text((w // 2, y), text, fill=(70, 80, 110), anchor="mm")
        y += 26

    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


def _valid_size(value: str | None) -> str:
    """`.env`のIMAGE_SIZEを確かめて返す。おかしければ既定値にする。

    APIの決まり:幅・高さとも16の倍数、縦横比は1:3〜3:1の範囲。
    """
    size = (value or "").strip().lower()
    if not size:
        return DEFAULT_IMAGE_SIZE

    m = _SIZE_PATTERN.match(size)
    if not m:
        logger.warning("IMAGE_SIZE「%s」の形式が正しくないので %s を使います",
                       size, DEFAULT_IMAGE_SIZE)
        return DEFAULT_IMAGE_SIZE

    w, h = int(m.group(1)), int(m.group(2))
    if w % 16 or h % 16:
        logger.warning("IMAGE_SIZE「%s」は幅・高さが16の倍数ではないので %s を使います",
                       size, DEFAULT_IMAGE_SIZE)
        return DEFAULT_IMAGE_SIZE
    if not (1 / 3 <= w / h <= 3):
        logger.warning("IMAGE_SIZE「%s」は縦横比が1:3〜3:1の範囲外なので %s を使います",
                       size, DEFAULT_IMAGE_SIZE)
        return DEFAULT_IMAGE_SIZE

    return size


# ----------------------------------------------------------------------
def get_generator() -> ImageGenerator:
    """使う画像生成器を返す。

    別のサービスに差し替えるときは、ここで返す実装を変える。
    """
    return OpenAIImageGenerator()
