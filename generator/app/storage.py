"""結果の保存。

`outputs/YYYYMMDD_HHMMSS/` のフォルダを作り、次の3つを保存する。

- photo.jpg   : 元の写真(縮小後)
- monster.png : 生成されたモンスター画像
- result.json : 判定結果、使ったモデル名、画質、各処理の時間、動物の名前
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterator
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PHOTO_NAME = "photo.jpg"
MONSTER_NAME = "monster.png"
RESULT_NAME = "result.json"

# outputs/ のフォルダ名の形(make_output_dir。YYYYMMDD_HHMMSS、同じ秒なら _2 など)。1つ目の組は日付
OUTPUT_NAME_PATTERN = re.compile(r"^(\d{8})_\d{6}(_\d+)?$")

# APIを使った記録を1行ずつ足していくファイル
USAGE_LOG_NAME = "api_usage_log.jsonl"

# 料金の記録の合計(ファイル → (大きさ, 更新時刻, 合計))。
# 毎回ファイル全体を読み直さないよう覚えておく。ほかのプログラム(tools/make_cpu_monsters.py)が
# 書き足して大きさか更新時刻が変わっていたら、読み直す
_usage_totals: dict[Path, tuple[int, int, float]] = {}


def append_jsonl(path: Path, entry: dict[str, Any]) -> bool:
    """記録のファイル(1行に1つのJSON)に1行足す。失敗しても処理は止めず、False を返す。"""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return True
    except Exception as e:
        logger.warning("%s への記録に失敗しました(処理は続けます): %s", path.name, e)
        return False


def _file_stamp(path: Path) -> tuple[int, int] | None:
    """ファイルの大きさと更新時刻(なければ None)。"""
    try:
        st = path.stat()
    except OSError:
        return None
    return st.st_size, st.st_mtime_ns


def _cost_of(entry: dict[str, Any]) -> float:
    cost = entry.get("cost_usd")
    return cost if isinstance(cost, (int, float)) else 0.0


def _sum_usage_log(log_path: Path) -> tuple[float, bool]:
    """記録のファイルを全部読んで、料金の合計を数える。戻り値は (合計, 最後まで読めたか)。"""
    total = 0.0
    try:
        for line in log_path.read_text(encoding="utf-8").splitlines():
            if line.strip():
                total += _cost_of(json.loads(line))
    except Exception as e:
        logger.warning("使用量の合計を数えられませんでした: %s", e)
        return total, False
    return total, True


def append_usage_log(base_dir: Path, entry: dict[str, Any]) -> float:
    """APIを使った記録を1行足し、これまでの合計の料金(ドル)を返す。

    いくら使ったかをいつでも確認できるようにしておく。
    からうちモード(料金0円)のときは記録しない。
    """
    log_path = base_dir / USAGE_LOG_NAME
    before = _file_stamp(log_path)
    if not append_jsonl(log_path, entry):
        return 0.0

    cached = _usage_totals.get(log_path)
    if cached is not None and before is not None and cached[:2] == before:
        # 前に数えたときから、ほかに書き足されていない:足した1行の分だけ増やす
        total, ok = cached[2] + _cost_of(entry), True
    else:
        total, ok = _sum_usage_log(log_path)
    after = _file_stamp(log_path)
    if ok and after is not None:
        _usage_totals[log_path] = (*after, total)
    else:
        _usage_totals.pop(log_path, None)
    return round(total, 6)


def make_output_dir(base_dir: Path, now: datetime | None = None) -> Path:
    """`outputs/YYYYMMDD_HHMMSS/` のフォルダを作って返す。

    同じ秒に2回実行された場合は、末尾に連番を付けて重ならないようにする。
    """
    stamp = (now or datetime.now()).strftime("%Y%m%d_%H%M%S")
    path = base_dir / stamp

    suffix = 1
    while path.exists():
        suffix += 1
        path = base_dir / f"{stamp}_{suffix}"

    path.mkdir(parents=True)
    return path


def save_result(
    base_dir: Path,
    photo_bytes: bytes,
    monster_bytes: bytes | None,
    result: dict[str, Any],
) -> Path:
    """写真・モンスター画像・結果のJSONを保存し、フォルダの場所を返す。

    `monster_bytes` が None のとき(撮り直しや失敗)は、画像だけ保存しない。
    """
    out_dir = make_output_dir(base_dir)

    (out_dir / PHOTO_NAME).write_bytes(photo_bytes)

    if monster_bytes is not None:
        (out_dir / MONSTER_NAME).write_bytes(monster_bytes)

    write_result(out_dir, result)

    logger.info("結果を保存しました: %s", out_dir)
    return out_dir


def write_result(out_dir: Path, result: dict[str, Any]) -> None:
    """outputs/<フォルダ>/result.json を書く。"""
    (out_dir / RESULT_NAME).write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def read_result(out_dir: Path) -> dict[str, Any] | None:
    """outputs/<フォルダ>/result.json を読む。ないか読めなければ None。"""
    path = out_dir / RESULT_NAME
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("result.json を読めませんでした(%s): %s", out_dir.name, e)
        return None


def iter_finished_outputs(
    outputs_dir: Path, *, newest_first: bool = False, day: str | None = None,
) -> Iterator[tuple[str, dict[str, Any]]]:
    """outputs/ にある、絵までできたフォルダの (フォルダ名, result.json の中身)。

    フォルダ名の順(= 作った順。newest_first で新しい順)。day(YYYYMMDD)を渡すと、その日のものだけ。
    result.json を読めないものは飛ばす。撮り直しなどで分けるのは、使う側で行う。
    """
    if not outputs_dir.is_dir():
        return
    for d in sorted(outputs_dir.iterdir(), reverse=newest_first):
        m = OUTPUT_NAME_PATTERN.match(d.name)
        if not m or (day is not None and m.group(1) != day) or not (d / MONSTER_NAME).is_file():
            continue
        result = read_result(d)
        if result is not None:
            yield d.name, result
