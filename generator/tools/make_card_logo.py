"""カード用のロゴ画像から背景を抜いて、カードで使う透明つき PNG(static/card/logo.png)を作る。

依頼者のロゴ(リポジトリの一番上の カード用ロゴ.png)は、透明の印の市松模様(白と薄いグレーのマス目)が
絵として焼き込まれていて、本当の透明ではない(RGB)。そのまま置くとカードにマス目が出る。
ロゴは太い濃い茶色のふちで全体が囲まれているので、ふちの外側(画像の端からつながったところ)を
色に関係なく透明にする(ふちで止まるので、ロゴの中の白い目・クリーム色の角は残る)。
API は使わない。

使い方(generator/ で。ロゴが変わったら、もう一度動かす):
    .\\.venv\\Scripts\\python.exe -m tools.make_card_logo ..\\カード用ロゴ.png
"""

from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT_PATH = Path(__file__).resolve().parent.parent / "static" / "card" / "logo.png"

# ロゴのふち(濃い茶色)とみなす暗さ:いちばん明るい色の成分がこれより小さい画素
OUTLINE_MAX = 110
# ふちに囲まれていて、端からは届かない背景のすき間(元の画像の座標。「モ」と「ン」のあいだ)。
# ロゴが変わったら、抜いたあとの画像を見て直す
POCKET_SEEDS = [(640, 400)]
# 境目をなめらかにするぼかし(px。元の大きさで)
EDGE_BLUR = 1.0
# できあがりの横幅(px)。カードでは 約22mm 幅なので、印刷に十分
OUT_WIDTH = 1200

_OPEN, _OUTSIDE = 255, 128


def outside_mask(img: Image.Image, seeds: list[tuple[int, int]] = POCKET_SEEDS) -> Image.Image:
    """ロゴの外側(透明にするところ)を 255 にした L 画像。

    ふち(暗い画素)以外を「通れる」として、画像の端と POCKET_SEEDS から塗りつぶすように広げる。
    色では分けない(マス目の色が場所によって少し違い、明るさで分けると粒が残ったため)。
    ふちで止まるので、ロゴの中の白い目・クリーム色の角・光沢は残る。
    """
    rgb = img.convert("RGB")
    w, h = rgb.size
    px = rgb.load()
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    for y in range(h):
        for x in range(w):
            if max(px[x, y]) >= OUTLINE_MAX:
                mp[x, y] = _OPEN
    starts = [(x, 0) for x in range(w)] + [(x, h - 1) for x in range(w)]
    starts += [(0, y) for y in range(h)] + [(w - 1, y) for y in range(h)] + list(seeds)
    for x, y in starts:
        if 0 <= x < w and 0 <= y < h and mp[x, y] == _OPEN:
            ImageDraw.floodfill(mask, (x, y), _OUTSIDE, thresh=0)
    return mask.point(lambda v: 255 if v == _OUTSIDE else 0)


def make_logo(src: Path, out: Path = OUT_PATH) -> Path:
    img = Image.open(src).convert("RGB")
    outside = outside_mask(img)
    # 境目を少しぼかして、ふちのギザギザをなくす
    outside = outside.filter(ImageFilter.GaussianBlur(EDGE_BLUR))
    alpha = outside.point(lambda v: 255 - v)

    logo = img.convert("RGBA")
    logo.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox:
        logo = logo.crop(bbox)
    if logo.width > OUT_WIDTH:
        logo = logo.resize((OUT_WIDTH, round(logo.height * OUT_WIDTH / logo.width)), Image.LANCZOS)
    out.parent.mkdir(parents=True, exist_ok=True)
    logo.save(out, optimize=True)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description="カード用ロゴの背景を抜く")
    parser.add_argument("src", type=Path, help="元のロゴ画像(カード用ロゴ.png)")
    parser.add_argument("--out", type=Path, default=OUT_PATH)
    args = parser.parse_args()
    out = make_logo(args.src, args.out)
    with Image.open(out) as done:
        print(f"できました: {out}({done.width}×{done.height})")


if __name__ == "__main__":
    main()
