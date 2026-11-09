"""モンスターカード(印刷用)のデータと、PDF の保存。

カードに載せる情報は、まだ決まっていない(2026年11月9日の試作)。
載せる項目を変えるときは、ここの to_card() だけを直す(カードのページ static/card/ はこの JSON を読むだけ)。
⚔♡は バトルと同じ数字(result.json の battle)を、個数(1000 = 1個)にして載せる。
No. は「その日に作った順」。絵ができたときに決めて result.json の card.no に残す(刷り直しても変わらないように)。

PDF は Edge(なければ Chrome)を画面に出さずに起動し、カードのページを PDF にして
outputs/<フォルダ>/card.pdf に残す(あとで見直す・刷り直すため)。API は使わない。
"""

from __future__ import annotations

import os
import subprocess
import time
from pathlib import Path
from typing import Any

from .storage import OUTPUT_NAME_PATTERN, iter_finished_outputs

CARD_PDF_NAME = "card.pdf"

# PDF を作るときのブラウザのプロフィール。
# ふだんの Edge やキオスクの窓とぶつかると、新しいブラウザが前の窓に引き継いですぐ終わり、PDF ができないので分ける
PDF_PROFILE_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "monjan-card-pdf"

# カードのページが絵とフォントを読み終えるまで待つ時間(ミリ秒。ブラウザの中の時間)
PDF_WAIT_MS = 10000
# ブラウザが終わらないときに、あきらめるまでの秒数
PDF_TIMEOUT_SECONDS = 60
# ブラウザが終わってから、PDF が書き出されるのを待つ秒数と、確かめる間隔
PDF_WRITE_WAIT_SECONDS = 40
PDF_POLL_SECONDS = 0.5


# CPU 用に作ったモンスター(tools/make_cpu_monsters.py)の印。番号は付けない
CPU_PURPOSE = "CPU用"


def is_numbered(result: dict[str, Any]) -> bool:
    """No. を付けるモンスターか(撮り直し・CPU 用には付けない)。"""
    return not result.get("needs_retake") and result.get("purpose") != CPU_PURPOSE


def _numbered_folders(outputs_dir: Path, day: str) -> list[tuple[str, dict[str, Any]]]:
    """その日(YYYYMMDD)に作った、番号を付けるモンスターのフォルダ(作った順)。"""
    return [(name, result) for name, result in iter_finished_outputs(outputs_dir, day=day) if is_numbered(result)]


def next_card_number(outputs_dir: Path, day: str) -> int:
    """これから作るモンスターの No.(その日の何体目か)。

    残っている No. のいちばん大きいものと、数えた数の大きいほう + 1(古い記録には No. がないため)。
    """
    folders = _numbered_folders(outputs_dir, day)
    saved = [r.get("card", {}).get("no") for _, r in folders]
    saved_max = max((n for n in saved if isinstance(n, int)), default=0)
    return max(saved_max, len(folders)) + 1


def card_number(outputs_dir: Path, out_name: str, result: dict[str, Any]) -> int | None:
    """そのモンスターの No.。残っていればそれ、なければ その日の何番目かを数える。番号なしは None。"""
    if not is_numbered(result):
        return None
    saved = (result.get("card") or {}).get("no")
    if isinstance(saved, int):
        return saved
    m = OUTPUT_NAME_PATTERN.match(out_name or "")
    if not m:
        return None
    names = [name for name, _ in _numbered_folders(outputs_dir, m.group(1))]
    return names.index(out_name) + 1 if out_name in names else None


def to_card(battle_monster: dict[str, Any], created_at: str = "", no: int | None = None) -> dict[str, Any]:
    """バトルに渡す形(battle.to_battle_monster)から、カードに載せる情報を作る。no は No.(なければ None)。"""
    source = battle_monster.get("source") or {}
    return {
        "id": battle_monster.get("id") or "",
        "name": battle_monster.get("name") or "",
        "element": battle_monster.get("attribute") or "",
        "attack": int(battle_monster.get("attack") or 0) // 1000,
        "hp": int(battle_monster.get("hp") or 0) // 1000,
        "animal": source.get("animal") or "",
        "object": source.get("object") or "",
        "description": battle_monster.get("description") or "",
        "image": battle_monster.get("image") or "",
        "created_at": created_at or "",
        "no": no,
    }


def pdf_command(browser: Path, url: str, out_path: Path) -> list[str]:
    """カードのページを PDF にする、ブラウザの起動のしかた。"""
    return [
        str(browser),
        "--headless",
        "--disable-gpu",
        "--no-first-run",
        f"--user-data-dir={PDF_PROFILE_DIR}",
        "--no-pdf-header-footer",                 # 日付・URL の行を入れない
        f"--virtual-time-budget={PDF_WAIT_MS}",   # 絵とフォントを読み終えるまで待つ
        f"--print-to-pdf={out_path}",
        url,
    ]


def make_card_pdf(browser: Path, url: str, out_path: Path) -> None:
    """カードの PDF を作る。できなかったら RuntimeError。"""
    out_path.unlink(missing_ok=True)   # 前のものが残っていると、できたかどうか分からないので消しておく
    try:
        subprocess.run(
            pdf_command(browser, url, out_path),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=PDF_TIMEOUT_SECONDS, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise RuntimeError(f"ブラウザで PDF を作れませんでした({e})") from e
    if not _wait_for_file(out_path, PDF_WRITE_WAIT_SECONDS):
        raise RuntimeError("PDF ができませんでした(ブラウザが PDF を書き出さなかった)")


def _wait_for_file(path: Path, timeout: float) -> bool:
    """ファイルができて、大きさが変わらなくなるまで待つ。

    ※ 2026年11月9日:Edge は起動したコマンドがすぐに終わり、PDF は裏の Edge があとから書き出す(約8秒後)。
      終わってすぐに確かめると、まだ PDF がなかった
    """
    deadline = time.monotonic() + timeout
    last_size = -1
    while time.monotonic() < deadline:
        size = path.stat().st_size if path.is_file() else 0
        if size > 0 and size == last_size:
            return True
        last_size = size
        time.sleep(PDF_POLL_SECONDS)
    return False
