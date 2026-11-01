"""APIの料金の試算。

APIの返答に含まれるトークン数から、おおよその料金を計算する。
展示では1人1回ずつ生成するので、1回あたりの料金を把握しておきたい。

※ 単価は 2026年10月28日 時点の OpenAI 公式の料金ページ(standard)の値です。
   料金は変わることがあるので、**使う前に必ず公式ページで確認し直してください**。
   https://developers.openai.com/api/docs/pricing
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger(__name__)

# 1ドルあたりの円(表示用の目安。正確な換算ではない)
YEN_PER_USD = 150.0


@dataclass(frozen=True)
class ModelPrice:
    """1Mトークンあたりの単価(ドル)。"""

    text_input: float = 0.0    # テキスト入力
    image_input: float = 0.0   # 画像入力
    output: float = 0.0        # 出力


# 1Mトークンあたりの単価(ドル)
PRICES: dict[str, ModelPrice] = {
    # 判定用のモデル(画像入力の単価は分けて書かれていないので、テキストと同じ扱い)
    "gpt-6-luna": ModelPrice(text_input=0.10, image_input=0.10, output=0.50),
    "gpt-6.1-sol": ModelPrice(text_input=0.10, image_input=0.10, output=0.50),
    # 画像生成のモデル
    "gpt-image-2": ModelPrice(text_input=5.00, image_input=8.00, output=30.00),
    # 2.5 系(2026年10月30日に公式のモデルページで確認。standard の値)
    # ※ トークンあたりの単価は gpt-image-2 と同じだが、1枚あたりのトークン数は違う可能性がある
    #   (公式:「gpt-image-2 の計算ツールでは 2.5 のトークン数は見積もれない」)。
    #   1枚あたりの料金は、実際に生成したときの result.json の usage で確認すること。
    # ※ 単価表は前方一致で探すので、書かないと「gpt-image-2」の単価が使われてしまう。はっきり書いておく
    "gpt-image-2.5-sunburst": ModelPrice(text_input=5.00, image_input=8.00, output=30.00),
    "gpt-image-2.5-flare": ModelPrice(text_input=5.00, image_input=8.00, output=30.00),
    "gpt-image-1-mini": ModelPrice(text_input=2.00, image_input=2.50, output=8.00),
}


def _base_model_name(model: str) -> str:
    """日付つきのモデル名(gpt-image-2-2026-04-21 など)を、単価表の名前に合わせる。"""
    name = (model or "").strip().lower()
    if name in PRICES:
        return name
    # いちばん長く前方一致するものを選ぶ
    matches = [k for k in PRICES if name.startswith(k)]
    return max(matches, key=len) if matches else ""


def estimate_cost(
    model: str,
    text_input_tokens: int = 0,
    image_input_tokens: int = 0,
    output_tokens: int = 0,
) -> float | None:
    """料金(ドル)を試算する。単価が分からないモデルは None を返す。"""
    key = _base_model_name(model)
    if not key:
        logger.info("単価の分からないモデルなので料金を試算できません: %s", model)
        return None

    p = PRICES[key]
    return (
        text_input_tokens * p.text_input
        + image_input_tokens * p.image_input
        + output_tokens * p.output
    ) / 1_000_000


def read_usage(response: Any, model: str) -> dict[str, Any]:
    """APIの返答に含まれるトークン数を読み、料金を試算する(判定と画像生成の両方で使う)。

    料金を把握しておきたいので、使ったトークン数は必ず記録する。
    入力の内訳(テキストと画像)が取れるとき(画像生成)は分けて試算し、
    取れないとき(判定。画像入力の分が分かれていない)は、まとめてテキスト入力として試算する。
    """
    usage = getattr(response, "usage", None)
    if usage is None:
        return {}

    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0

    details = getattr(usage, "input_tokens_details", None)
    text_in = getattr(details, "text_tokens", None) if details else None
    image_in = getattr(details, "image_tokens", None) if details else None
    if text_in is None or image_in is None:
        text_in, image_in = input_tokens, 0

    cost = estimate_cost(
        model,
        text_input_tokens=text_in,
        image_input_tokens=image_in,
        output_tokens=output_tokens,
    )

    return {
        "input_tokens": input_tokens,
        "input_text_tokens": text_in,
        "input_image_tokens": image_in,
        "output_tokens": output_tokens,
        "total_tokens": getattr(usage, "total_tokens", input_tokens + output_tokens) or 0,
        "estimated_cost_usd": None if cost is None else round(cost, 6),
        # 画面に出す円の目安(換算は YEN_PER_USD。画面側で計算しなくて済むように)
        "estimated_cost_yen": None if cost is None else round(to_yen(cost), 2),
    }


def to_yen(usd: float | None) -> float | None:
    """ドルを円の目安に直す。"""
    return None if usd is None else usd * YEN_PER_USD


def format_cost(usd: float | None) -> str:
    """画面に出す文字列にする。"""
    if usd is None:
        return "(単価が分からないため試算できません)"
    return f"${usd:.4f}(およそ {to_yen(usd):.1f}円)"
