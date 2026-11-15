"""カードの裏面のマーク(じゃんけんの三すくみ)の候補を、OpenAI の画像 API で何枚か作る(試し用。ゲーム本体では使わない)。

使い方(generator フォルダで。.env の OPENAI_API_KEY・IMAGE_MODEL を使う。1枚ごとに API の料金がかかる):
  .venv\\Scripts\\python.exe ..\\tools\\gen_card_mark.py <出力フォルダ> [構図の見本の画像] [案の記号 ...]
例: .venv\\Scripts\\python.exe ..\\tools\\gen_card_mark.py out ref.png A C

絵柄の見本に static/card/logo.png を、構図の見本に 依頼者が ChatGPT で作った案 を渡し、images.edit で作る
(app/generator.py の OpenAIImageGenerator と同じ呼び方)。
"""
import base64
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

GEN = Path(__file__).resolve().parent.parent / "generator"
sys.path.insert(0, str(GEN))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(GEN / ".env", override=True)

from app.env import env_str  # noqa: E402
from app.openai_client import get_client, get_image_timeout  # noqa: E402

COMMON = """\
Create a square game emblem for the BACK of a trading card in a kids' rock-paper-scissors monster card game called "Monjan".
Image 1 is the game logo: copy its art style exactly — glossy, bubbly 3D cartoon shapes, thick dark-brown outlines,
bright saturated candy colors, cute and friendly (not scary). Image 2 is a rough draft of the composition by the client
(ignore its checkerboard background and any UI buttons); improve on it.
Theme: the rock-paper-scissors triangle. Three cute monster hands: ROCK = orange fist, SCISSORS = blue hand making a clear
two-finger V sign (exactly two fingers extended, never three), PAPER = green open hand with five fingers.
Each hand has small white monster claws like the horns in the logo.
Strict rules: the three hands are the same size and evenly spaced at 120 degrees around the center, rotationally balanced;
bold, simple, chunky shapes that stay readable when shrunk to 64 pixels; no text, no letters, no numbers;
the emblem fills about 90% of the canvas, centered; plain pure white background (it will be removed later), no shadow on the background.
"""

VARIANTS = {
    "A": "Design: a round medallion with a thick gold ring. Three golden curved arrows chase each other in a circle between "
         "the hands (rock -> scissors -> paper -> rock). In the very center, a small cute monster face: two big round "
         "googly eyes like the logo and a happy smile, on a deep forest-green disc (not navy, not dark and scary).",
    "B": "Design: in the center, a cute round monster head with two white horns and big round googly eyes like the logo, "
         "smiling. The three hands orbit around it on a forest-green circle with a gold rim, like the monster is juggling them.",
    "C": "Design: minimal. No face. Only the three hands and three thick golden curved arrows forming a circle, "
         "on a forest-green round badge with a gold rim. As simple as possible.",
    "D": "Design: a heraldic shield emblem with a gold border and a forest-green field. The three hands are arranged in a "
         "triangle inside the shield with small golden arrows between them. Two small white horns sit on top of the shield.",
    "E": "Design: a three-part swirl (tomoe / triskelion) made of three comma shapes in orange, blue and green, spinning "
         "around the center inside a gold ring. A small hand icon (fist, V sign, open hand) sits in the head of each "
         "comma in the matching color.",
    "F": "Design: a circular wreath of fresh green leaves with a gold ribbon. Inside the wreath, the three hands in a circle "
         "with small golden arrows, on a soft forest-green background. Natural, forest-themed, friendly.",
}


# E2:E案(三つ巴)に決めたあと、手が「モンスターすぎる」(依頼者 2026-11-16)ので、ゲームの手の絵と同じ肌色の手にする。
# 見本は <出力フォルダ>/mark_E.png(構図)と battle/public/assets/janken の手の絵(形・色)
JANKEN = GEN.parent / "battle/public/assets/janken"
E2_PROMPT = """\
Image 1 is our chosen game emblem: a round gold ring containing a three-part swirl (tomoe) in orange, blue and green,
with a rock-paper-scissors hand in each part. Keep this emblem's composition, swirl shapes, colors, gold ring,
glossy 3D style and thick dark-brown outlines exactly as they are.
Change ONLY the three hands: replace the monster hands with normal, friendly human cartoon hands drawn exactly like
images 2, 3 and 4 (the game's own hand icons): warm peach skin color, soft rounded fingers, thick dark outline, glossy.
No claws, no nails, no horns, no spikes, no scales, no monster features at all.
Image 2 = ROCK (fist) goes in the orange part, image 3 = SCISSORS (two-finger V sign, exactly two fingers) goes in the
blue part, image 4 = PAPER (open hand, five fingers) goes in the green part. The three hands are the same size and
large enough to be recognized when the emblem is shrunk to 64 pixels.
No text. Emblem centered, filling about 90% of the canvas, plain pure white background.
"""


def references(key: str, logo: bytes, ref: bytes | None, out: Path) -> tuple[list, str]:
    """案ごとの、見本の画像と指示"""
    if key == "E2":
        images = [("emblem.png", (out / "mark_E.png").read_bytes(), "image/png")]
        for name in ("gu", "choki", "pa"):
            images.append((f"{name}.png", (JANKEN / f"janken_{name}_256.png").read_bytes(), "image/png"))
        return images, E2_PROMPT
    images = [("logo.png", logo, "image/png")]
    if ref:
        images.append(("draft.png", ref, "image/png"))
    return images, COMMON + "\n" + VARIANTS[key]


def generate(client, model: str, logo: bytes, ref: bytes | None, key: str, out: Path, name: str) -> str:
    images, prompt = references(key, logo, ref, out)
    res = client.images.edit(
        model=model,
        image=images,
        prompt=prompt,
        size="1024x1024",
        quality="medium",
        output_format="png",
        n=1,
    )
    path = out / f"mark_{name}.png"
    path.write_bytes(base64.b64decode(res.data[0].b64_json))
    return f"{name}: {path}"


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    ref = Path(sys.argv[2]).read_bytes() if len(sys.argv) > 2 and sys.argv[2] != "-" else None
    keys = sys.argv[3:] or list(VARIANTS)
    model = env_str("IMAGE_MODEL")
    client = get_client(timeout=get_image_timeout())
    logo = (GEN / "static/card/logo.png").read_bytes()
    # 同じ案を何回も並べたら(例 E2 E2 E2)、E2_1・E2_2… の名前で別々に残す
    names = [f"{k}_{keys[:i + 1].count(k)}" if keys.count(k) > 1 else k for i, k in enumerate(keys)]
    with ThreadPoolExecutor(max_workers=len(keys)) as pool:
        futures = {n: pool.submit(generate, client, model, logo, ref, k, out, n) for k, n in zip(keys, names)}
        for k, f in futures.items():
            try:
                print(f.result(), flush=True)
            except Exception as e:  # 1枚失敗しても、ほかは残す
                print(f"{k}: しっぱい {e}", flush=True)


if __name__ == "__main__":
    main()
