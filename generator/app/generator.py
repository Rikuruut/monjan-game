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
from types import SimpleNamespace
from typing import Callable, Protocol

from PIL import Image as PILImage, ImageDraw, ImageFilter

from .openai_client import (
    allow_person,
    get_client,
    get_image_timeout,
    image_prompt_style,
    is_dry_run,
)
from .pricing import estimate_cost, format_cost, read_usage, to_yen
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


# 途中の絵を受け取る関数:(何枚目か(0から), PNG のバイト列)
PartialCallback = Callable[[int, bytes], None]


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
        on_partial: PartialCallback | None = None,
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

# IMAGE_SIZE の形(幅x高さ)
_SIZE_PATTERN = re.compile(r"^(\d+)x(\d+)$")

# 画質を指定しないことを表す値
QUALITY_OMITTED = "(指定なし)"

# 画質を送らない設定値
_QUALITY_SKIP_VALUES = {"", "auto", "none", QUALITY_OMITTED}

# 途中の絵の枚数の既定値(.env の IMAGE_PARTIAL_IMAGES。0 で使わない。APIの決まりで 0〜3)
# ※ 2026年11月2日:待ち時間を楽しくするため、画像ができていく途中の絵を受け取って、たまごのテーマで見せる
DEFAULT_PARTIAL_IMAGES = 2
MAX_PARTIAL_IMAGES = 3


def partial_images_setting() -> int:
    """途中の絵の枚数(`.env` の IMAGE_PARTIAL_IMAGES)。読めなければ既定値、範囲外は 0〜3 にそろえる。"""
    try:
        value = int(os.getenv("IMAGE_PARTIAL_IMAGES", DEFAULT_PARTIAL_IMAGES))
    except (TypeError, ValueError):
        return DEFAULT_PARTIAL_IMAGES
    return max(0, min(value, MAX_PARTIAL_IMAGES))


class OpenAIImageGenerator:
    """OpenAIの画像編集エンドポイント(images.edit)で生成する。

    撮った写真を参照画像として渡すため、生成ではなく編集の呼び出し方を使う。
    """

    def __init__(self) -> None:
        self.model = (os.getenv("IMAGE_MODEL") or "").strip()
        self.quality = (os.getenv("IMAGE_QUALITY") or "").strip().lower()
        self.size = _valid_size(os.getenv("IMAGE_SIZE"))
        self.partial_images = partial_images_setting()

    def generate(
        self,
        photo_bytes: bytes,
        animal: str,
        object_name: str,
        element: str,
        design_plan: dict[str, str] | None = None,
        has_person: bool = False,
        on_partial: PartialCallback | None = None,
    ) -> GenerationResult:
        """モンスターの絵を作る。

        `on_partial` を渡し、途中の絵の枚数(IMAGE_PARTIAL_IMAGES)が1以上なら、
        ストリーミングで途中の絵を受け取り、届くたびに `on_partial(何枚目か, PNG)` を呼ぶ。
        """
        if not self.model:
            raise ImageGenerationError(".envの IMAGE_MODEL が設定されていません")

        prompt = build_image_prompt(
            animal, object_name, element, design_plan,
            allow_person=allow_person(), has_person=has_person,
            prompt_style=image_prompt_style(),
        )

        stream = on_partial is not None and self.partial_images > 0

        # からうちモード:APIを呼ばずにダミー画像を返す(料金0円)
        if is_dry_run():
            logger.info("からうちモード(DRY_RUN)のため、画像生成のAPIは呼びません")
            image_bytes = _dummy_image(self.size, animal, object_name)
            if stream:
                # 画面の確認用に、ぼかしたダミー画像を途中の絵として渡す
                for i in range(self.partial_images):
                    _send_partial(on_partial, i, _blurred(image_bytes, 24 // (i + 1)))
            return GenerationResult(
                image_bytes=image_bytes,
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
        # 途中の絵(ストリーミング)も同じ考え方:断られたら、途中の絵なしで1回だけやり直す

        started = time.monotonic()
        response = None
        # やり直しは、画質・ストリーミングをそれぞれ1回ずつ外すだけなので、多くて3回
        for _ in range(3):
            try:
                response = self._call(client, photo_bytes, prompt, send_quality,
                                      on_partial if stream else None)
                break
            except _QualityNotSupported as e:
                logger.info("画質の指定が使えなかったので、外してやり直します: %s", e)
                notes.append(f"このモデルは画質の指定({self.quality})を受け付けないため、画質なしで生成しました")
                send_quality = False
            except _StreamNotSupported as e:
                logger.info("途中の絵(ストリーミング)が使えなかったので、外してやり直します: %s", e)
                notes.append("このモデルは途中の絵(ストリーミング)を受け付けないため、途中の絵なしで生成しました")
                stream = False
            except Exception as e:
                raise self._to_error(e, time.monotonic() - started) from e
        if response is None:
            raise ImageGenerationError("画像生成の呼び出しに失敗しました(やり直しの回数をこえました)")
        used_quality = self.quality if send_quality else QUALITY_OMITTED

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
        _add_partial_image_cost(usage, self.model, getattr(response, "partial_count", 0))

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
    def _call(self, client, photo_bytes: bytes, prompt: str, send_quality: bool,
              on_partial: PartialCallback | None = None):
        """images.edit を呼ぶ。`on_partial` があれば、ストリーミングで途中の絵も受け取る。"""
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
        if on_partial is not None:
            params["stream"] = True
            params["partial_images"] = self.partial_images

        try:
            if on_partial is None:
                return client.images.edit(**params)
            return self._read_stream(client.images.edit(**params), on_partial)
        except Exception as e:
            # パラメーターが原因で断られた場合は、やり直せるように区別する
            if send_quality and self._is_param_problem(e, ("quality",)):
                raise _QualityNotSupported(str(e)) from e
            if on_partial is not None and self._is_param_problem(e, ("stream", "partial")):
                raise _StreamNotSupported(str(e)) from e
            raise

    @staticmethod
    def _read_stream(events, on_partial: PartialCallback):
        """ストリーミングのイベントを読む。途中の絵は on_partial に渡し、できあがりを返事の形にして返す。

        イベント(公式のAPIリファレンス):
          image_edit.partial_image:b64_json・partial_image_index
          image_edit.completed    :b64_json・usage
        返事の形は、ストリーミングでないとき(data[0].b64_json・usage)にそろえ、届いた途中の絵の枚数(partial_count)を足す。
        """
        partial_count = 0
        for event in events:
            kind = getattr(event, "type", "")
            if kind == "image_edit.partial_image":
                partial_count += 1
                try:
                    _send_partial(on_partial, getattr(event, "partial_image_index", 0),
                                  base64.b64decode(event.b64_json))
                except Exception as e:   # 途中の絵が読めなくても、生成は続ける
                    logger.warning("途中の絵を読めませんでした(続けます): %s", e)
            elif kind == "image_edit.completed":
                return SimpleNamespace(data=[SimpleNamespace(b64_json=event.b64_json)],
                                       usage=getattr(event, "usage", None),
                                       partial_count=partial_count)
        raise ImageGenerationError("できあがりの絵が届く前に、ストリーミングが終わりました")

    @staticmethod
    def _is_param_problem(e: Exception, words: tuple[str, ...]) -> bool:
        """エラーが「そのパラメーターが使えない」ことによるもの(400 で、パラメーター名を含む)かを判定する。"""
        if getattr(e, "status_code", None) != 400:
            return False
        text = str(e).lower()
        return any(w in text for w in words)

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


class _StreamNotSupported(Exception):
    """途中の絵(stream・partial_images)が受け付けられなかったことを表す、内部用の印。"""


def _send_partial(on_partial: PartialCallback, index: int, png: bytes) -> None:
    """途中の絵を渡す。受け取る側で失敗しても、生成は止めない。"""
    try:
        on_partial(index, png)
    except Exception as e:
        logger.warning("途中の絵を画面に送れませんでした(続けます): %s", e)


# 途中の絵1枚ごとに増える画像出力トークン
# ※ 公式の画像生成ガイド:「each partial image will incur an additional 100 image output tokens」
#   (2026年11月2日に確認)。sunburst・medium で、途中の絵ありの回の出力トークン(371)が、
#   なしの回(441)より少なかったので、API が返す使用量には入っていないと考え、試算に足している。
#   実際に請求に入っているかは、OpenAI の管理画面の Usage で確かめること
PARTIAL_IMAGE_OUTPUT_TOKENS = 100


def _add_partial_image_cost(usage: dict, model: str, partial_count: int) -> None:
    """途中の絵の分(1枚 100 画像出力トークン)を、使用量と料金の試算に足す。"""
    if partial_count <= 0 or not usage:
        return
    extra_tokens = partial_count * PARTIAL_IMAGE_OUTPUT_TOKENS
    usage["partial_images"] = partial_count
    usage["partial_image_output_tokens"] = extra_tokens
    extra_cost = estimate_cost(model, output_tokens=extra_tokens)
    if extra_cost is None or usage.get("estimated_cost_usd") is None:
        return
    usage["estimated_cost_usd"] = round(usage["estimated_cost_usd"] + extra_cost, 6)
    usage["estimated_cost_yen"] = round(to_yen(usage["estimated_cost_usd"]), 2)


def _blurred(png: bytes, radius: int) -> bytes:
    """ぼかした画像(からうちモードの途中の絵)。"""
    img = PILImage.open(io.BytesIO(png)).filter(ImageFilter.GaussianBlur(radius))
    buf = io.BytesIO()
    img.save(buf, "PNG")
    return buf.getvalue()


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
