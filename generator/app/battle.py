"""じゃんけんバトル(battle/。友人の担当)にモンスターを渡すための変換。

バトルは1体を次の形の JSON で受け取る(battle/docs/DATA_SPEC.md):
    id・name・source{animal, object}・attribute・attack・hp・description・image
attack(⚔1〜3)と hp(♡1〜5)は判定では作らず、絵ができたときにここで決めて result.json に残す
(あとでカードを印刷するときに、バトルと同じ数字にするため)。
"""

from __future__ import annotations

import random
from typing import Any

from .prompts import DEFAULT_ELEMENT

# ⚔ の数(1000 = 1個)。バトルの仕様どおり 1〜3 個
ATTACK_CHOICES = (1000, 2000, 3000)
# ♡ の数(1000 = 1個)。バトルの仕様は 1〜5 個だが、1〜2 個だと1回負けただけで終わってしまうので 3〜5 個にする
# (2026年11月2日に結合したときに決めた。バトルの見本のモンスターは ♡1〜3 で、CPU 側に使う)
HP_CHOICES = (3000, 4000, 5000)


def make_battle_stats(rng: random.Random | None = None) -> dict[str, int]:
    """⚔ と ♡ をランダムに決める。"""
    rng = rng or random
    return {"attack": rng.choice(ATTACK_CHOICES), "hp": rng.choice(HP_CHOICES)}


def to_battle_monster(photo_id: str, result: dict[str, Any], image: str | None = None) -> dict[str, Any]:
    """result.json の中身を、バトルが読む形にする。

    名前は子供がスマホで選んだもの(選んだときに result.json の monster_name が書きかわる)。
    タイプ(火 など。バトルの属性と同じ)は attribute にそのまま入れる(勝ち負けには使わず、攻撃の色と音だけに使う)。
    image は絵の URL。なければ、いま作った絵(/api/monster-image/<photo_id>)。
    """
    monster = result.get("monster") or {}
    stats = result.get("battle") or {}
    return {
        "id": photo_id,
        "name": monster.get("monster_name") or "なぞのモンスター",
        "source": {
            "animal": result.get("animal") or "",
            "object": monster.get("object_name") or "",
        },
        "attribute": monster.get("element") or DEFAULT_ELEMENT,
        "attack": stats.get("attack") if stats.get("attack") in ATTACK_CHOICES else ATTACK_CHOICES[0],
        "hp": stats.get("hp") if stats.get("hp") in HP_CHOICES else HP_CHOICES[0],
        "description": monster.get("description") or "",
        "image": image or f"/api/monster-image/{photo_id}",
    }


def recent_monster_entry(out_name: str, result: dict[str, Any]) -> dict[str, Any]:
    """開発者メニューの「作ったモンスターで戦う」の一覧の1行。id は outputs/ のフォルダ名。"""
    monster = result.get("monster") or {}
    return {
        "id": out_name,
        "name": monster.get("monster_name") or "なぞのモンスター",
        "animal": result.get("animal") or "",
        "object": monster.get("object_name") or "",
        "element": monster.get("element") or "",
        "created_at": result.get("created_at") or "",
        "image": f"/api/output-image/{out_name}",
    }


# 撮影・合体の画面のテストプレイ・確認用の見本(ゴリラ × はさみ)。
# 名前・タイプ・説明・絵は static/common/app.js の demoSample と同じにしている
DEMO_ID = "demo"
DEMO_NAME = "ゴリザミ"
DEMO_NAME_MAX = 20   # URL から来る名前なので、長すぎるものは切る


def demo_battle_monster(name: str | None = None) -> dict[str, Any]:
    """見本のモンスターを、バトルが読む形で返す。name はテストプレイで選んだことにした名前。"""
    return {
        "id": DEMO_ID,
        "name": (name or "").strip()[:DEMO_NAME_MAX] or DEMO_NAME,
        "source": {"animal": "ゴリラ", "object": "はさみ"},
        "attribute": "風",
        "attack": ATTACK_CHOICES[1],
        "hp": HP_CHOICES[1],
        "description": "はさみの つのを ふりかざし、なんでも きりひらく ちからもち。",
        "image": "/static/demo/monster.jpg",
    }
