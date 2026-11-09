"""スマホから届いた写真の一時置き場(uploads/)。

写真は `uploads/<photo_id>.jpg`、スマホで選ばれた動物は `uploads/<photo_id>.json` に置き、
生成が終わったら消す(写真は outputs/ に保存してあるので、ここにはためない)。
ファイルを読み書きする関数はイベントループを止めないよう、`run_in_threadpool` で呼ぶ。
"""

from __future__ import annotations

import io
import json
import logging
import re
import uuid
from pathlib import Path

from fastapi import HTTPException
from PIL import Image

from . import config
from .animals import normalize_animal

logger = logging.getLogger(__name__)

# photo_id の形(アップロードのときに uuid4().hex で作る、32文字の16進数)
PHOTO_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")


def check_photo_id(photo_id: str) -> str:
    """photo_id の形を確かめる。

    ファイルの場所に使うので、uploads/ の外を指す値(../ など)は受け付けない。
    """
    if not PHOTO_ID_PATTERN.match(photo_id or ""):
        raise HTTPException(status_code=400, detail="写真のIDの形が正しくありません")
    return photo_id


def photo_path(photo_id: str) -> Path:
    return config.UPLOADS_DIR / f"{photo_id}.jpg"


def _meta_path(photo_id: str) -> Path:
    return config.UPLOADS_DIR / f"{photo_id}.json"


def save_upload(data: bytes, animal: str) -> tuple[str, str]:
    """届いた写真と動物を保存し、(photo_id, 整えた動物の名前) を返す。

    スマホ側でJPEGに変換済みの想定だが、念のためPillowで開けるかを確認する。
    """
    try:
        Image.open(io.BytesIO(data)).verify()  # 壊れていないかの確認
    except Exception as e:
        logger.warning("受け取った写真を開けませんでした: %s", e)
        raise HTTPException(status_code=400, detail=f"写真を読めませんでした: {e}")

    # 動物の名前を整える(一覧に無い名前でも通す。製品版の自由入力に備える)
    animal_name = normalize_animal(animal)

    # 保存する(IDはランダムな文字列)。動物の名前を写真と一緒に覚えておく
    photo_id = uuid.uuid4().hex
    photo_path(photo_id).write_bytes(data)
    _meta_path(photo_id).write_text(json.dumps({"animal": animal_name}, ensure_ascii=False), encoding="utf-8")

    logger.info("写真を受け取りました: photo_id=%s animal=%s size=%dKB",
                photo_id, animal_name, len(data) // 1024)
    return photo_id, animal_name


def load_photo(photo_id: str) -> tuple[str, bytes]:
    """`photo_id`の写真と、紐づけて覚えておいた動物の名前を読み出す。"""
    check_photo_id(photo_id)
    meta_path, path = _meta_path(photo_id), photo_path(photo_id)
    if not meta_path.exists() or not path.exists():
        raise HTTPException(status_code=404, detail="その写真は見つかりませんでした")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("写真の情報を読めませんでした: %s", e)
        raise HTTPException(status_code=500, detail="写真の情報を読めませんでした")
    return normalize_animal(meta.get("animal")), path.read_bytes()


def remove_upload(photo_id: str) -> None:
    """生成が終わった写真を uploads/ から消す。"""
    for path in (photo_path(photo_id), _meta_path(photo_id)):
        try:
            path.unlink(missing_ok=True)
        except OSError as e:
            logger.warning("届いた写真を消せませんでした(処理は続けます): %s", e)
