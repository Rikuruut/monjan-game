"""AIの返答のチェックと補正。

CLAUDE.md のチェックのルールに従って、不正な値をデフォルト値で補う。

| 項目 | ルール | 不正なときの扱い |
|---|---|---|
| element | タイプ8種類(火・水・草・光・闇・風・土・無)のどれか | 「無」にする |
| monster_name | 10文字以内 | 10文字で切る。候補がすべて不合格で、これもチェックに不合格なら「なぞのモンスター」 |
| name_candidates | カタカナだけ・2〜10文字・NGの言葉なし・言いやすい・単語を並べただけでない | 合格した候補からランダムに1つを monster_name にする |
| description | 50文字以内 | 50文字までの区切りで切る |
| object_name | 空でない | 「なにかのもの」にする |
| design_plan | 6項目が空でなく120文字以内 | 既定値にする / 切り詰める |
| JSON全体 | 形式が正しい | すべてデフォルト値にする |
"""

from __future__ import annotations

import copy
import logging
import random
import re
from typing import Any

from .prompts import DEFAULT_DESIGN_PLAN, DEFAULT_ELEMENT, ELEMENTS

logger = logging.getLogger(__name__)

# 文字数の上限
MAX_MONSTER_NAME = 10
MAX_DESCRIPTION = 50   # 2026年11月9日に40から(説明文を「たたかいかた」にしたため)
MAX_RETAKE_REASON = 60
MAX_OBJECT_PART = 12
# 融合デザインの各項目の上限(画像プロンプトが長くなりすぎないように)
MAX_DESIGN_FIELD = 120

# モンスター名の候補の数の上限
MAX_NAME_CANDIDATES = 5

# モンスター名に入っていたら使わない言葉(子供ががっかりしたり、保護者が困ったりする言葉)
# ※ 完全なリストではない。プロンプトでも避けるよう伝えている。見つけたらここに足す
NAME_NG_WORDS: list[str] = [
    "バカ", "アホ", "ブス", "デブ", "ハゲ", "チビ", "キモ", "ウザ",
    "ウンコ", "ウンチ", "クソ", "オシッコ", "ゲロ", "ハナクソ",
    "シネ", "コロス", "ゴミ", "クズ",
]

# カタカナだけ(長音「ー」と「ヴ」を含む)
_KATAKANA_ONLY = re.compile(r"^[ァ-ヴー]+$")
# 小さい「ッ」「ャ」などが2つ続く(言いにくい)
_SMALL_KANA_RUN = re.compile(r"[ッャュョァィゥェォ]{2,}")


def _to_katakana(text: str) -> str:
    """ひらがなをカタカナに直す(物の名前と比べるため)。"""
    return "".join(chr(ord(c) + 0x60) if "ぁ" <= c <= "ゖ" else c for c in text)


# 合格した名前の候補から選ぶときの重み(候補は良い順に並んでいるので、前ほど選ばれやすくする)。
# 2026年11月1日:それまでは同じ確率で選んでいて、弱い候補も3回に1回は使われていた
NAME_PICK_WEIGHTS = [50, 30, 20]


def check_monster_name(name: str, animal: str = "", object_name: str = "") -> str:
    """モンスター名をチェックする。問題がなければ空文字、あれば理由を返す。"""
    if not name:
        return "空"
    if not _KATAKANA_ONLY.match(name):
        return "カタカナ以外の文字がある"
    if len(name) < 2:
        return "短すぎる"
    if len(name) > MAX_MONSTER_NAME:
        return f"{MAX_MONSTER_NAME}文字をこえている"
    for word in NAME_NG_WORDS:
        if word in name:
            return f"使わない言葉「{word}」が入っている"
    if _SMALL_KANA_RUN.search(name):
        return "小さい文字が続いて言いにくい"
    # 物の名前と動物の名前を、そのまま両方とも含んでいる(並べただけ)
    animal_kana = _to_katakana(animal.strip())
    object_kana = _to_katakana(object_name.replace(" ", "").strip())
    if (animal_kana and object_kana and _KATAKANA_ONLY.match(animal_kana) and _KATAKANA_ONLY.match(object_kana)
            and animal_kana in name and object_kana in name):
        return "物と動物の名前を並べただけ"
    return ""


def choose_monster_name(
    candidates: Any, fallback: str, animal: str = "", object_name: str = ""
) -> tuple[str, list[dict[str, Any]], list[str]]:
    """名前の候補をチェックし、合格したものの中からランダムに1つ選ぶ。

    ランダムにするのは、同じ動物と物の組み合わせでも、毎回ちがう名前が出るようにするため。
    候補は良い順に並んでいるので、前のものほど選ばれやすくする(NAME_PICK_WEIGHTS)。
    合格した候補が1つもなければ、モデルが選んだ名前(fallback)を使う。
    戻り値は (選んだ名前, 候補ごとのチェック結果, 補正のメモ)。
    """
    notes: list[str] = []
    checked: list[dict[str, Any]] = []
    for item in (candidates if isinstance(candidates, list) else [])[:MAX_NAME_CANDIDATES]:
        name = _as_text(item)
        reason = check_monster_name(name, animal, object_name)
        checked.append({"name": name, "ok": not reason, "reason": reason})

    passed = [c["name"] for c in checked if c["ok"]]
    for c in checked:
        if not c["ok"]:
            notes.append(f"名前の候補「{c['name']}」は使いません({c['reason']})")
    if passed:
        # 候補が重みの数より多いとき(最大 MAX_NAME_CANDIDATES)は、最後の重みでそろえる
        weights = (NAME_PICK_WEIGHTS + [NAME_PICK_WEIGHTS[-1]] * len(passed))[:len(passed)]
        return random.choices(passed, weights=weights, k=1)[0], checked, notes

    # 合格した候補がない:モデルが選んだ名前(fallback)を、同じチェックに通して使う。
    # ※ 2026年11月2日:それまでは、チェックに不合格でもそのまま使っていたので、
    #   NGの言葉が入った名前が子供の画面に出るおそれがあった。不合格なら既定の名前にする
    name = _as_text(fallback)
    if len(name) > MAX_MONSTER_NAME:
        name = name[:MAX_MONSTER_NAME]
        notes.append(f"monster_name が長いので{MAX_MONSTER_NAME}文字で切りました")
    reason = check_monster_name(name, animal, object_name)
    if reason:
        notes.append(f"使える名前がないので「{DEFAULT_MONSTER_NAME}」にしました(monster_name「{name}」:{reason})")
        return DEFAULT_MONSTER_NAME, checked, notes
    return name, checked, notes


# 不正なときに使う値
DEFAULT_OBJECT_NAME = "なにかのもの"
DEFAULT_MONSTER_NAME = "なぞのモンスター"
DEFAULT_DESCRIPTION = "なぞの わざで あいてを まどわせる モンスター"
DEFAULT_RETAKE_REASON = "もういちど とってみてね"

# 形式がまったく読めなかったときに返す内容
DEFAULT_MONSTER: dict[str, Any] = {
    "needs_retake": False,
    "has_person": False,
    "retake_reason": "",
    "object_name": DEFAULT_OBJECT_NAME,
    "object_part": "",
    "object_sub_part": "",
    "element": DEFAULT_ELEMENT,
    "monster_name": DEFAULT_MONSTER_NAME,
    "name_candidates": [],
    "description": DEFAULT_DESCRIPTION,
    "design_plan": dict(DEFAULT_DESIGN_PLAN),
}


# 説明文を切ってよい区切り(ここで終わっても、ことばの途中にならない)
_DESCRIPTION_BREAKS = (" ", "　", "、", "。", "!", "!", "?", "?")
# 区切りで切ったとき、これより短くなるなら、区切りを使わず文字数で切る(短すぎる説明文にしない)
MIN_CUT_DESCRIPTION = 15


def cut_description(text: str) -> str:
    """説明文を MAX_DESCRIPTION 文字以内にする。

    ことばの途中で終わらないように、MAX_DESCRIPTION 文字までにある最後の区切りで切る。
    ※ 2026年11月2日:それまでは40文字で機械的に切っていたので、
      「…ペンギンかいじゅ」「…ワニモンスタ」のように、ことばの途中で終わる説明文があった。
    """
    if len(text) <= MAX_DESCRIPTION:
        return text
    head = text[:MAX_DESCRIPTION + 1]   # 41文字目が区切りなら、40文字ちょうどで切れる
    cut = max(head.rfind(mark) for mark in _DESCRIPTION_BREAKS)
    if cut < MIN_CUT_DESCRIPTION:
        return text[:MAX_DESCRIPTION]
    # 「。」「!」などは残し、空白・「、」は落とす
    end = cut + 1 if head[cut] in "。!!??" else cut
    return text[:end].rstrip(" 　、")


def _as_text(value: Any) -> str:
    """文字列として取り出す。文字列でなければ空文字にする。"""
    return value.strip() if isinstance(value, str) else ""


def validate_monster(
    raw: Any, animal: str = "", with_design_plan: bool = True
) -> tuple[dict[str, Any], list[str]]:
    """AIの返答をチェックして補正する。

    戻り値は (補正後の内容, 補正した項目のメモ) 。
    メモは、何を直したかをPC画面やログで確認するために使う。
    `with_design_plan` が False のとき(短いプロンプト。設計図を作らない)は、design_plan を空にし、既定値も入れない。
    """
    notes: list[str] = []

    # JSON全体の形式が正しくない場合は、すべてデフォルト値にする
    if not isinstance(raw, dict):
        logger.warning("判定の返答が辞書ではありません: %r", type(raw))
        # 深いコピーにする(design_plan をあとで書きかえても、既定値が変わらないように)
        return copy.deepcopy(DEFAULT_MONSTER), ["返答の形式が読めなかったので、すべて既定値にしました"]

    # --- 撮り直しの判定 ---
    needs_retake = raw.get("needs_retake")
    if not isinstance(needs_retake, bool):
        notes.append("needs_retake が true/false ではないので false にしました")
        needs_retake = False

    retake_reason = _as_text(raw.get("retake_reason"))
    if len(retake_reason) > MAX_RETAKE_REASON:
        retake_reason = retake_reason[:MAX_RETAKE_REASON]
        notes.append(f"retake_reason が長いので{MAX_RETAKE_REASON}文字で切りました")
    if needs_retake and not retake_reason:
        retake_reason = DEFAULT_RETAKE_REASON
        notes.append("撮り直しの理由が空だったので、既定の文にしました")
    if not needs_retake and retake_reason:
        # 撮り直しでないのに理由が入っている場合は消す
        retake_reason = ""

    # --- 人が写っているか(true/false でなければ false) ---
    has_person = raw.get("has_person")
    if not isinstance(has_person, bool):
        if has_person is not None:
            notes.append("has_person が true/false ではないので false にしました")
        has_person = False

    # --- 物の名前(空でないこと) ---
    # --- 物のいちばん特徴的なパーツ(短いプロンプトの、すぐ要る判定だけ。長すぎれば使わない) ---
    object_part = _as_text(raw.get("object_part"))
    if len(object_part) > MAX_OBJECT_PART:
        notes.append(f"object_part「{object_part}」が長いので使いません(物の全体で描きます)")
        object_part = ""
    # 2番目のパーツ(メインがないとき・メインと同じとき・長すぎるときは使わない)
    object_sub_part = _as_text(raw.get("object_sub_part"))
    if object_sub_part and (not object_part or object_sub_part == object_part or len(object_sub_part) > MAX_OBJECT_PART):
        notes.append(f"object_sub_part「{object_sub_part}」は使いません(パーツ1つで描きます)")
        object_sub_part = ""

    object_name = _as_text(raw.get("object_name"))
    if not object_name:
        object_name = DEFAULT_OBJECT_NAME
        notes.append(f"object_name が空なので「{DEFAULT_OBJECT_NAME}」にしました")

    # --- タイプ(8種類のどれか) ---
    element = _as_text(raw.get("element"))
    if element not in ELEMENTS:
        notes.append(
            f"element「{element or '(空)'}」は8種類に無いので「{DEFAULT_ELEMENT}」にしました"
        )
        element = DEFAULT_ELEMENT

    # --- モンスター名(候補をチェックし、合格したものからランダムに1つ) ---
    monster_name, name_candidates, name_notes = choose_monster_name(
        raw.get("name_candidates"), raw.get("monster_name"), animal, object_name
    )
    notes.extend(name_notes)

    # --- 説明文(40文字以内) ---
    description = _as_text(raw.get("description"))
    if not description:
        description = DEFAULT_DESCRIPTION
        notes.append("description が空なので既定の文にしました")
    elif len(description) > MAX_DESCRIPTION:
        description = cut_description(description)
        notes.append(f"description が長いので、{MAX_DESCRIPTION}文字までの区切りで切りました")

    # --- 融合デザイン(文の項目。空や長すぎるときは既定値・切り詰め) ---
    raw_plan = raw.get("design_plan") if with_design_plan else {}
    if not isinstance(raw_plan, dict):
        if raw_plan is not None:
            notes.append("design_plan の形式が読めないので既定値にしました")
        raw_plan = {}
    design_plan: dict[str, str] = {}
    for key, default_value in (DEFAULT_DESIGN_PLAN if with_design_plan else {}).items():
        value = _as_text(raw_plan.get(key))
        if not value:
            value = default_value
            notes.append(f"design_plan.{key} が空なので既定値にしました")
        elif len(value) > MAX_DESIGN_FIELD:
            value = value[:MAX_DESIGN_FIELD]
            notes.append(f"design_plan.{key} が長いので{MAX_DESIGN_FIELD}文字で切りました")
        design_plan[key] = value

    monster = {
        "needs_retake": needs_retake,
        "has_person": has_person,
        "retake_reason": retake_reason,
        "object_name": object_name,
        "object_part": object_part,
        "object_sub_part": object_sub_part,
        "element": element,
        "monster_name": monster_name,
        "name_candidates": name_candidates,
        "description": description,
        "design_plan": design_plan,
    }

    if notes:
        logger.info("判定の返答を補正しました: %s", " / ".join(notes))

    return monster, notes
