"""カードの裏面のマーク(リポジトリ直下の カード用マーク.png)の白い背景を抜いて、ゲームと印刷で使う大きさに整える。

使い方(generator フォルダで): .venv\\Scripts\\python.exe ..\\tools\\make_card_mark.py
書き出し先:
  generator/static/card/mark.png          (印刷の裏面。static/card/card.html)
  battle/public/assets/card-mark.png      (ゲーム画面の裏面。battle/src/styles/cardbattle.css)

背景は「四すみからつながっている白っぽいところ」だけを抜く(マークの中の白い光沢は残す)。
マークのふちは太い茶色の線なので、その外側の白を抜けばよい。
"""
from collections import deque
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "カード用マーク.png"
OUTS = [ROOT / "generator/static/card/mark.png", ROOT / "battle/public/assets/card-mark.png"]
SIZE = 512       # 書き出す大きさ(ゲームの一番大きい裏面でも 200px ほどなので十分)
MARGIN = 0.02    # まわりの余白(大きさに対する割合)
WHITE = 225      # これより明るい(R・G・B すべて)ところを「背景の白」とみなす


def background_mask(img: Image.Image) -> Image.Image:
    """四すみから塗りつぶして、背景(白っぽい)ところを 255 にした白黒の画像を返す"""
    w, h = img.size
    px = img.load()
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    queue = deque([(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)])
    while queue:
        x, y = queue.popleft()
        if not (0 <= x < w and 0 <= y < h) or mp[x, y]:
            continue
        r, g, b = px[x, y][:3]
        if min(r, g, b) < WHITE:
            continue
        mp[x, y] = 255
        queue.extend(((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)))
    return mask


def main() -> None:
    img = Image.open(SRC).convert("RGBA")
    bg = background_mask(img)
    # ふちのギザギザを消す:背景を1px 広げてから、ほんの少しぼかして 透明度にする
    bg = bg.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    alpha = Image.eval(bg, lambda v: 255 - v)
    img.putalpha(alpha)

    # マークのところだけ切り出して、正方形の真ん中に置く
    box = alpha.point(lambda v: 255 if v > 8 else 0).getbbox()
    mark = img.crop(box)
    side = round(max(mark.size) * (1 + 2 * MARGIN))
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    canvas = canvas.resize((SIZE, SIZE), Image.LANCZOS)

    for out in OUTS:
        canvas.save(out, optimize=True)
        print(out.relative_to(ROOT), f"{out.stat().st_size // 1024}KB")


if __name__ == "__main__":
    main()
