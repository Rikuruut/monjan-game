"""1回の生成の流れ(判定 → 画像生成 → 保存)と、料金の記録・途中の絵。

POST /api/generate(app/routes/generate.py)から呼ぶ。
エラーが起きてもサーバーは止めず、内容をPCの画面に出せる形(JSONResponse)で返す。
短いプロンプト(simple)と詳しいプロンプト(detailed)で、判定のしかたが違う(_generate_split / _generate_detailed)。
"""

from __future__ import annotations

import asyncio
import functools
import logging
import time
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import anyio
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from . import config, session
from .battle import make_battle_stats, monster_image_url
from .card import next_card_number
from .generator import GenerationResult, PartialCallback, get_generator
from .openai_client import allow_person, image_prompt_style
from .pricing import format_cost, to_yen
from .recognizer import choose_plan, combine, describe, image_design_plan, object_parts, quick_check, recognize
from .storage import append_usage_log, save_result
from .uploads import load_photo, remove_upload
from .ws_manager import ws_manager

logger = logging.getLogger(__name__)

# 画像生成にかかる時間の目安(秒)。ローディングの「もうすぐ!」の切り替えに使う。
# 最初は実測(gpt-image-2.5-sunburst / high で約39秒、medium で約24秒)の間くらいにしておき、
# 生成するたびに前回の実測で置きかえる
last_generate_seconds: float = 30.0

# 途中の絵(photo_id → 何枚目か → PNG)。いま作っている1回分だけを持つ(次の生成を始めるときに消す)
partials: dict[str, dict[int, bytes]] = {}

# 生成は1つずつ(PCのタブが2つあるときなどに、2回呼ばれて料金が2回かからないように)
generate_lock = asyncio.Lock()


def now_iso() -> str:
    """いまの日時(記録に残す形。秒まで)。"""
    return datetime.now().isoformat(timespec="seconds")


def log_cost(cost_usd: float, at: str | None = None, **fields: Any) -> float:
    """料金の記録(outputs/api_usage_log.jsonl)に1行足し、これまでの合計(ドル)を返す。"""
    return append_usage_log(config.OUTPUTS_DIR, {"at": at or now_iso(), "cost_usd": cost_usd, **fields})


def build_usage(**parts: dict[str, Any] | None) -> dict[str, Any]:
    """処理ごとの使用量をまとめ、1回あたりの料金を試算する。

    `parts` は処理の名前ごとの使用量(recognize:判定 / check:すぐ要る判定 / describe:名前と説明 / generate:画像生成)。
    どれだけAPIを使ったかを、結果のJSONとPC画面の両方で確認できるようにする。
    料金の記録のファイルを読み書きするので、`run_in_threadpool` で呼ぶ。
    """
    costs = [u["estimated_cost_usd"] for u in parts.values() if u and u.get("estimated_cost_usd") is not None]
    total = round(sum(costs), 6) if costs else None

    usage = {
        **{name: u or {} for name, u in parts.items()},
        "total_cost_usd": total,
        "total_cost_yen": None if total is None else round(to_yen(total), 2),
        "note": "料金は2026年10月28日時点の単価による試算です(app/pricing.py)",
    }

    # APIを使ったときだけ、累計の記録に1行足す(からうちモードは記録しない)
    if total:
        cumulative = log_cost(total, **{f"{name}_tokens": (u or {}).get("total_tokens") for name, u in parts.items()})
        usage["cumulative_cost_usd"] = cumulative
        usage["cumulative_cost_yen"] = round(to_yen(cumulative), 2)

    return usage


def _seconds_since(started: float) -> float:
    return round(time.monotonic() - started, 2)


@dataclass
class _Run:
    """1回の生成の記録(写真・設定・かかった時間・使用量)。"""

    photo_id: str
    animal: str
    photo_bytes: bytes
    started: float = field(default_factory=time.monotonic)
    settings: dict[str, Any] = field(default_factory=dict)
    timings: dict[str, float] = field(default_factory=dict)
    usages: dict[str, dict[str, Any] | None] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.settings = {"animal": self.animal, **config.current_settings()}

    def record(self, step: str, seconds: float, usage: dict[str, Any] | None) -> None:
        """1つの処理の時間と使用量を残す(step:recognize / check / describe / generate)。"""
        self.timings[step] = round(seconds, 2)
        self.usages[step] = usage

    async def report(self, monster: dict[str, Any], notes: list[str], **extra: Any) -> dict[str, Any]:
        """result.json と画面への返事に共通する項目。"""
        timings = {**self.timings, "total": _seconds_since(self.started)}
        usage = await run_in_threadpool(build_usage, **self.usages)
        return {"monster": monster, "validator_notes": notes, "settings": self.settings,
                "timings": timings, "usage": usage, **extra}


def _failed(step: str, error: str, **extra: Any) -> JSONResponse:
    """失敗の返事(PC画面にそのまま出す。ステータスは 200)。"""
    return JSONResponse(status_code=200, content={"ok": False, "step": step, "error": error, **extra})


async def generate(photo_id: str) -> JSONResponse:
    """判定と画像生成を実行して、結果を保存する。

    動物はスマホから届いたものを`photo_id`から読み出して使う。
    生成中にもう一度呼ばれたら、409 を返す(同時に2つは作らない)。
    """
    if generate_lock.locked():
        return JSONResponse(
            status_code=409,
            content={"ok": False, "step": "受付", "error": "ほかの生成が終わるまで待ってください"},
        )
    async with generate_lock:
        animal, photo_bytes = await run_in_threadpool(load_photo, photo_id)
        partials.clear()
        run = _Run(photo_id, animal, photo_bytes)
        logger.info("生成を開始します: photo_id=%s animal=%s", photo_id, animal)
        try:
            if image_prompt_style() == "simple":
                return await _generate_split(run)
            return await _generate_detailed(run)
        except Exception as e:
            # 判定・画像生成の失敗は、それぞれの関数の中で返す。ここに来るのは保存の失敗など、思わぬエラー。
            # スマホがローディングのまま止まらないよう、かならず error を知らせる
            logger.exception("生成の途中で思わぬエラーが起きました")
            await ws_manager.notify_progress("error")
            return _failed("サーバー", f"{type(e).__name__}: {e}")


async def _generate_detailed(run: _Run) -> JSONResponse:
    """詳しいプロンプト:判定(設計図まで1回で作る)→(撮り直しなら終了)→ 画像生成 → 保存。

    画像プロンプトに判定の設計図(design_plan)を使うので、判定が終わってから画像生成を始める。
    """
    # ローディング:「名前を かんがえているよ」
    await ws_manager.notify_progress("naming")
    try:
        recognized = await run_in_threadpool(recognize, run.photo_bytes, run.animal)
    except Exception as e:
        return await _recognize_failed(run, e)
    run.settings["text_model"] = recognized.model
    run.record("recognize", recognized.elapsed_seconds, recognized.usage)
    monster, notes = recognized.monster, recognized.notes

    if monster["needs_retake"]:
        return await _finish_retake(run, monster, notes)

    # ローディング:「え を かいているよ」。かかる時間の目安(前回の実測)と、名前の候補も送る
    await ws_manager.notify_progress(
        "drawing",
        expected_seconds=round(last_generate_seconds, 1),
        monster_name=monster.get("monster_name", ""),
        photo_id=run.photo_id,
        # 名前の候補(スマホの「ほかに さがす」で順番に見せる)。採用した名前を先頭にする
        name_choices=session.remember_name_choices(run.photo_id, monster),
    )
    try:
        generation = await _draw(run, monster["object_name"], monster["element"],
                                 monster.get("design_plan"), monster.get("has_person", False))
    except Exception as e:
        return await _draw_failed(run, monster, notes, e)
    return await _save_success(run, monster, notes, generation)


async def _generate_split(run: _Run) -> JSONResponse:
    """短いプロンプト:すぐ要る判定 →(撮り直しなら終了)→ 画像生成と、名前・説明を同時に → 保存。

    ※ 2026年11月2日:待ち時間を短くするため、判定を2つに分けて、名前・説明を画像生成と重ねた
      (recognizer.py の「短いプロンプトの判定」のコメント参照)。
    """
    await ws_manager.notify_progress("naming")
    # 取り込む場所・演出を先に決める(画像プロンプトと、名前・説明の両方に同じものを伝える)
    plan = choose_plan(run.animal, simple=True)
    try:
        check = await run_in_threadpool(quick_check, run.photo_bytes)
    except Exception as e:
        return await _recognize_failed(run, e)
    run.settings["text_model"] = check.model
    run.record("check", check.elapsed_seconds, check.usage)

    # 撮り直しかどうかは、すぐ要る判定だけで決まる
    first, first_notes = combine(run.animal, plan, check, None)
    if first["needs_retake"]:
        return await _finish_retake(run, first, first_notes)
    object_name, has_person = first["object_name"], first["has_person"]
    parts = object_parts(first)

    # ローディング:「え を かいているよ」(名前の候補は、名前・説明ができてから names で送る)
    await ws_manager.notify_progress(
        "drawing", expected_seconds=round(last_generate_seconds, 1), photo_id=run.photo_id,
    )
    design_plan = image_design_plan(plan, run.animal, parts)
    draw_task = asyncio.create_task(_draw(run, object_name, "", design_plan, has_person))

    # 名前・説明(画像生成と同時)。失敗しても止めず、既定の名前で続ける
    describe_error = ""
    try:
        details = await run_in_threadpool(
            describe, run.photo_bytes, run.animal, object_name, plan, has_person and allow_person(),
            parts.get("object_part", ""),
        )
        run.record("describe", details.elapsed_seconds, details.usage)
    except Exception as e:
        logger.warning("名前・説明を作れませんでした(既定値で続けます): %s", e)
        details, describe_error = None, str(e)
    monster, notes = combine(run.animal, plan, check, details)
    monster["design_plan"].update(parts)
    if describe_error:
        notes.append(f"名前・説明を作れなかったので、既定値にしました: {describe_error}")

    # 名前の候補をスマホに送る(子供は、絵ができるのを待つあいだに選ぶ)
    await ws_manager.notify_progress(
        "names",
        monster_name=monster.get("monster_name", ""),
        photo_id=run.photo_id,
        name_choices=session.remember_name_choices(run.photo_id, monster),
    )
    try:
        generation = await draw_task
    except Exception as e:
        return await _draw_failed(run, monster, notes, e)
    return await _save_success(run, monster, notes, generation)


def partial_image_url(photo_id: str, index: int) -> str:
    return f"/api/partial-image/{photo_id}/{index}"


def _partial_sender(photo_id: str, total: int) -> PartialCallback | None:
    """途中の絵を受け取って、PC画面に知らせる関数を作る(画像生成のスレッドから呼ばれる)。"""
    if total <= 0:
        return None

    def send(index: int, png: bytes) -> None:
        partials.setdefault(photo_id, {})[index] = png
        # スレッドから、非同期の WebSocket の送信を呼ぶ
        anyio.from_thread.run(functools.partial(
            ws_manager.notify_progress, "partial",
            photo_id=photo_id, index=index + 1, total=total,
            image_url=partial_image_url(photo_id, index),
        ))

    return send


async def _draw(
    run: _Run, object_name: str, element: str, design_plan: dict[str, Any] | None, has_person: bool,
) -> GenerationResult:
    """画像生成。設定・時間・使用量を run に残す。失敗したら例外のまま返す。"""
    global last_generate_seconds
    generator = get_generator()
    on_partial = _partial_sender(run.photo_id, getattr(generator, "partial_images", 0))
    generation = await run_in_threadpool(
        generator.generate, run.photo_bytes, run.animal, object_name, element,
        design_plan, has_person, on_partial,
    )
    run.settings["image_model"] = generation.model
    run.settings["image_quality"] = generation.quality
    run.settings["image_size"] = generation.size
    run.record("generate", generation.elapsed_seconds, generation.usage)
    # 次のローディングで使う「画像生成にかかる時間の目安」を更新する(からうちモードの0秒は使わない)
    if generation.elapsed_seconds > 1:
        last_generate_seconds = generation.elapsed_seconds
    return generation


async def _recognize_failed(run: _Run, e: Exception) -> JSONResponse:
    logger.warning("判定に失敗しました: %s", e)
    await ws_manager.notify_progress("error")
    return _failed("判定", str(e), settings=run.settings)


async def _finish_retake(run: _Run, monster: dict[str, Any], notes: list[str]) -> JSONResponse:
    """撮り直し:画像生成は呼ばずに終わる(判定の分だけ料金がかかる)。"""
    report = await run.report(monster, notes, needs_retake=True)
    result = {"created_at": now_iso(), "animal": run.animal, **report}
    await run_in_threadpool(save_result, config.OUTPUTS_DIR, run.photo_bytes, None, result)
    await run_in_threadpool(remove_upload, run.photo_id)

    logger.info("撮り直しと判定されました: %s", monster["retake_reason"])
    await ws_manager.notify_progress("retake", reason=monster["retake_reason"])
    return JSONResponse({"ok": True, "retake_reason": monster["retake_reason"], **report})


async def _draw_failed(run: _Run, monster: dict[str, Any], notes: list[str], e: Exception) -> JSONResponse:
    logger.warning("画像生成に失敗しました: %s", e)
    await ws_manager.notify_progress("error")
    # 判定までは成功しているので、その分の料金は発生している
    return _failed("画像生成", str(e), **(await run.report(monster, notes)))


async def _save_success(
    run: _Run, monster: dict[str, Any], notes: list[str], generation: GenerationResult,
) -> JSONResponse:
    """できた絵と結果を保存し、PC とスマホに知らせる。"""
    report = await run.report(monster, notes, generator_notes=generation.notes)
    now = datetime.now()
    # カードの No.(その日に作った順。app/card.py)。生成は generate_lock で1つずつなので、番号はかぶらない
    card_no = await run_in_threadpool(next_card_number, config.OUTPUTS_DIR, now.strftime("%Y%m%d"))

    # 画像を作っているあいだに、子供がスマホで名前を選んでいたら、その名前にする
    # (report の monster は同じ辞書なので、ここで変えれば返事と result.json の両方に入る)
    session.apply_chosen_name(run.photo_id, monster)
    result = {
        "created_at": now.isoformat(timespec="seconds"),
        "animal": run.animal,
        **report,
        "image_prompt": generation.prompt,
        "needs_retake": False,
        # じゃんけんバトルの ⚔ と ♡(app/battle.py)
        "battle": make_battle_stats(),
        "card": {"no": card_no},
    }
    out_dir = await run_in_threadpool(
        save_result, config.OUTPUTS_DIR, run.photo_bytes, generation.image_bytes, result
    )
    session.photo_outputs[run.photo_id] = out_dir.name
    await run_in_threadpool(remove_upload, run.photo_id)
    monster_url = monster_image_url(run.photo_id)

    # ローディング:終わり。スマホにもモンスターの絵を見せるため、画像のURLも送る
    await ws_manager.notify_progress(
        "done",
        photo_id=run.photo_id,
        monster_name=monster.get("monster_name", ""),
        image_url=monster_url,
    )

    logger.info("生成が完了しました: %s (合計 %.1f秒, 試算 %s)",
                out_dir.name, report["timings"]["total"], format_cost(report["usage"].get("total_cost_usd")))

    return JSONResponse({
        "ok": True,
        "needs_retake": False,
        **report,
        "monster_url": monster_url,
        "output_dir": out_dir.name,
    })
