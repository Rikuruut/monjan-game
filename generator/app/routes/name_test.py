"""名前のテスト(写真も画像生成も使わず、モンスター名だけを何回か作って確かめる)。

名前のプロンプト(prompts.NAME_RULES)を調整するときに使う。
判定と同じ「名前のつけ方」とチェックを使うので、ここで良い名前が出れば判定でも出るはず。
料金は1回 0.1円以下(写真を送らず、短い文章だけのため)。結果は outputs/name_tests.jsonl に残す。
"""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

from .. import config
from ..animals import normalize_animal
from ..openai_client import is_dry_run
from ..pipeline import log_cost, now_iso
from ..pricing import to_yen
from ..recognizer import generate_names
from ..storage import append_jsonl

router = APIRouter()

NAME_TEST_MAX_COUNT = 10
NAME_TEST_LOG_NAME = "name_tests.jsonl"


@router.post("/api/name-test")
async def api_name_test(
    animal: str = Form(...),
    object_name: str = Form(...),
    count: int = Form(5),
) -> JSONResponse:
    animal = normalize_animal(animal)
    object_name = (object_name or "").strip()[:30]
    if not object_name:
        raise HTTPException(status_code=400, detail="物の名前を入れてください")
    count = max(1, min(count, NAME_TEST_MAX_COUNT))

    # 1回ずつ別々に呼ぶ(展示で子供が1回ずつ遊ぶのと同じ条件で、名前のばらつきを見るため)
    results = await asyncio.gather(
        *(run_in_threadpool(generate_names, animal, object_name) for _ in range(count)),
        return_exceptions=True,
    )
    runs: list[dict] = []
    total_usd = 0.0
    for r in results:
        if isinstance(r, Exception):
            runs.append({"error": str(r)})
            continue
        runs.append(r)
        total_usd += (r.get("usage") or {}).get("estimated_cost_usd") or 0.0

    # 結果を残す(あとで見返して、名前のプロンプトの良し悪しを比べるため)
    entry = {
        "at": now_iso(),
        "animal": animal,
        "object_name": object_name,
        "names": [r.get("name") for r in runs if "name" in r],
        "runs": runs,
    }
    # からうちモードのダミーの名前は残さない
    if not is_dry_run():
        await run_in_threadpool(append_jsonl, config.OUTPUTS_DIR / NAME_TEST_LOG_NAME, entry)

    cumulative = None
    if total_usd:
        cumulative = await run_in_threadpool(log_cost, round(total_usd, 6), entry["at"], name_test_count=count)

    return JSONResponse({
        "ok": True,
        "animal": animal,
        "object_name": object_name,
        "runs": runs,
        "total_cost_usd": round(total_usd, 6),
        "total_cost_yen": round(to_yen(total_usd), 2),
        "cumulative_cost_yen": None if cumulative is None else round(to_yen(cumulative), 2),
    })
