"""結果の保存。

`outputs/YYYYMMDD_HHMMSS/` のフォルダを作り、次の3つを保存する。

- photo.jpg   : 元の写真(縮小後)
- monster.png : 生成されたモンスター画像
- result.json : 判定結果、使ったモデル名、画質、各処理の時間、動物の名前
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

PHOTO_NAME = "photo.jpg"
MONSTER_NAME = "monster.png"
RESULT_NAME = "result.json"

# APIを使った記録を1行ずつ足していくファイル
USAGE_LOG_NAME = "api_usage_log.jsonl"


def append_usage_log(base_dir: Path, entry: dict[str, Any]) -> float:
    """APIを使った記録を1行足し、これまでの合計の料金(ドル)を返す。

    いくら使ったかをいつでも確認できるようにしておく。
    からうちモード(料金0円)のときは記録しない。
    """
    log_path = base_dir / USAGE_LOG_NAME

    try:
        with log_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.warning("使用量の記録に失敗しました(処理は続けます): %s", e)
        return 0.0

    # これまでの合計を数える
    total = 0.0
    try:
        for line in log_path.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            cost = json.loads(line).get("cost_usd")
            if isinstance(cost, (int, float)):
                total += cost
    except Exception as e:
        logger.warning("使用量の合計を数えられませんでした: %s", e)

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

    (out_dir / RESULT_NAME).write_text(
        json.dumps(result, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    logger.info("結果を保存しました: %s", out_dir)
    return out_dir
