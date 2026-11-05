"""バトルの CPU 用モンスター(見本のモンスター)を API で作って、battle/public/ に足す。

撮影の写真がないので、まず「物の写真」を画像生成で作り(安い画質 low)、
そのあとはふだんの合体と同じ流れ(すぐ要る判定 → 名前・タイプ・説明 → 画像生成)で作る。
名前・タイプ・説明は API の答えのまま(validator のチェックは通す)。⚔・♡ はここでランダムに決める。

使い方(generator/ で):
    .\\.venv\\Scripts\\python.exe -m tools.make_cpu_monsters --dry-run   # API を呼ばない(料金0円)。書き出し先は --out
    .\\.venv\\Scripts\\python.exe -m tools.make_cpu_monsters             # API を呼ぶ(1体 約5円)

できたもの:
    battle/public/monsters/cpu_<名前>.png・battle/public/data/monsters/cpu_<名前>.json を足し、
    battle/public/data/game-config.json の monsters に足す(元の見本のファイルは変えない)。
    記録(写真・絵・result.json)は outputs/ にも残す。
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import logging
import os
import random
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BASE_DIR.parent
BATTLE_PUBLIC = REPO_DIR / "battle" / "public"

# .env を読んでから app を読み込む(main.py と同じく .env を優先する)
load_dotenv(BASE_DIR / ".env", override=True)

from app.generator import get_generator  # noqa: E402
from app.openai_client import get_client, get_image_timeout, is_dry_run  # noqa: E402
from app.pricing import read_usage, to_yen  # noqa: E402
from app.recognizer import choose_plan, combine, describe, quick_check  # noqa: E402
from app.storage import append_usage_log, save_result  # noqa: E402

logger = logging.getLogger("make_cpu_monsters")

# 作る組み合わせ(動物・物・ファイル名)。見本(ゴリラ・ティラノサウルス・キリギリス)と動物がかぶらないようにした
COMBOS = [
    ("ライオン", "ドライヤー", "lion_dryer"),
    ("サメ", "かさ", "shark_umbrella"),
    ("ペンギン", "やかん", "penguin_kettle"),
]

# CPU の ⚔・♡(1000 = 1個)。見本のモンスターと同じく ♡ は少なめ(プレイヤーは ♡3〜5)
CPU_ATTACK_CHOICES = (1000, 2000, 3000)
CPU_HP_CHOICES = (2000, 3000)

# 物の写真(合体の材料)。スマホで撮ったような写真にする
PHOTO_QUALITY = "low"
PHOTO_SIZE = "1024x768"


def photo_prompt(object_name: str) -> str:
    return (
        f"家の中で、スマートフォンで撮ったような自然な写真。テーブルの上に置かれた{object_name}が1つ、"
        "画面の中央に大きく写っている。人や手は写さない。文字・ロゴなし。"
    )


def make_photo(object_name: str) -> tuple[bytes, dict]:
    """物の写真を作る(JPEG・長辺1024px)。からうちのときは無地の絵。"""
    if is_dry_run():
        img = Image.new("RGB", (1024, 768), (200, 200, 190))
        return _jpeg(img), {}
    model = (os.getenv("IMAGE_MODEL") or "").strip()
    client = get_client(timeout=get_image_timeout())
    response = client.images.generate(
        model=model, prompt=photo_prompt(object_name), size=PHOTO_SIZE,
        quality=PHOTO_QUALITY, output_format="jpeg", n=1,
    )
    img = Image.open(io.BytesIO(base64.b64decode(response.data[0].b64_json))).convert("RGB")
    return _jpeg(img), read_usage(response, model)


def _jpeg(img: Image.Image) -> bytes:
    img.thumbnail((1024, 1024))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return buf.getvalue()


def make_one(animal: str, object_name: str, slug: str, number: int, out_dir: Path) -> dict:
    """1体作って、バトルの JSON を返す。絵は out_dir/monsters/cpu_<slug>.png に書く。"""
    photo, photo_usage = make_photo(object_name)

    plan = choose_plan(animal, simple=True)
    check = quick_check(photo)
    first, _ = combine(animal, plan, check, None)
    if first["needs_retake"]:
        raise RuntimeError(f"{animal} × {object_name}:撮り直しと判定されました({first['retake_reason']})")
    parts = {k: first[k] for k in ("object_part", "object_sub_part") if first.get(k)}
    design_plan: dict = {}
    plan.apply(design_plan, animal)
    design_plan.update(parts)

    details = describe(photo, animal, first["object_name"], plan, False)
    monster, notes = combine(animal, plan, check, details)
    monster["design_plan"].update(parts)

    generation = get_generator().generate(photo, animal, first["object_name"], "", design_plan, False, None)

    # 料金(写真 + 判定 + 名前・説明 + 画像)
    usages = {"photo": photo_usage, "check": check.usage, "describe": details.usage, "generate": generation.usage}
    costs = [u["estimated_cost_usd"] for u in usages.values() if u and u.get("estimated_cost_usd") is not None]
    total = round(sum(costs), 6) if costs else 0.0
    if total:
        append_usage_log(BASE_DIR / "outputs", {
            "at": datetime.now().isoformat(timespec="seconds"), "cost_usd": total, "note": "CPU用モンスター",
        })

    battle = {"attack": random.choice(CPU_ATTACK_CHOICES), "hp": random.choice(CPU_HP_CHOICES)}
    result = {
        "created_at": datetime.now().isoformat(timespec="seconds"), "animal": animal, "purpose": "CPU用",
        "monster": monster, "validator_notes": notes, "usage": {**usages, "total_cost_usd": total},
        "image_prompt": generation.prompt, "needs_retake": False, "battle": battle,
    }
    if not is_dry_run():
        save_result(BASE_DIR / "outputs", photo, generation.image_bytes, result)

    image_name = f"cpu_{slug}.png"
    (out_dir / "monsters").mkdir(parents=True, exist_ok=True)
    (out_dir / "monsters" / image_name).write_bytes(generation.image_bytes)
    print(f"  {monster['monster_name']}(タイプ {monster['element']}・⚔{battle['attack'] // 1000} ♡{battle['hp'] // 1000})"
          f" 約{to_yen(total) or 0:.1f}円")
    return {
        "id": f"MON-{number:04d}",
        "name": monster["monster_name"],
        "source": {"animal": animal, "object": monster["object_name"]},
        "attribute": monster["element"],
        "attack": battle["attack"],
        "hp": battle["hp"],
        "description": monster["description"],
        "image": f"/monsters/{image_name}",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="API を呼ばない(料金0円)")
    parser.add_argument("--out", type=Path, default=BATTLE_PUBLIC, help="書き出し先(battle/public と同じ形)")
    args = parser.parse_args()
    # Windows のターミナル(cp932)でも ⚔・♡ を出せるように
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if args.dry_run:
        os.environ["DRY_RUN"] = "true"
    logging.basicConfig(level=logging.WARNING)

    config_path = BATTLE_PUBLIC / "data" / "game-config.json"
    config = json.loads(config_path.read_text(encoding="utf-8"))
    number = len(config["monsters"]) + 1
    print(f"CPU 用モンスターを {len(COMBOS)} 体つくります({'からうち' if is_dry_run() else 'API を使う'})")

    added = []
    for animal, object_name, slug in COMBOS:
        print(f"- {animal} × {object_name}")
        try:
            data = make_one(animal, object_name, slug, number, args.out)
        except Exception as e:   # 1体失敗しても、ほかは続ける
            print(f"  失敗しました: {type(e).__name__}: {e}")
            continue
        path = args.out / "data" / "monsters" / f"cpu_{slug}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        added.append(f"/data/monsters/cpu_{slug}.json")
        number += 1

    # game-config.json の monsters に足す(書き出し先が battle/public のときだけ)
    if args.out.resolve() == BATTLE_PUBLIC.resolve() and added:
        config["monsters"] += [p for p in added if p not in config["monsters"]]
        config_path.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"できた: {len(added)} 体")


if __name__ == "__main__":
    main()
