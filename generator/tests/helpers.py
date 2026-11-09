"""いくつかのテストで使う道具(写真を送る・outputs/ に前のモンスターを作る)。"""

import io
import json

from PIL import Image

from app import config


def jpeg_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (64, 48), (200, 120, 40)).save(buf, format="JPEG")
    return buf.getvalue()


def upload(client, animal="ライオン"):
    res = client.post("/api/upload", files={"photo": ("photo.jpg", jpeg_bytes(), "image/jpeg")},
                      data={"animal": animal})
    assert res.status_code == 200, res.text
    return res.json()


def make_output(name, *, retake=False, image=True, monster_name="ゴリシザー"):
    """outputs/ に、前に作ったモンスターのフォルダを作る(テストでは一時フォルダ)。"""
    d = config.OUTPUTS_DIR / name
    d.mkdir(parents=True)
    result = {
        "created_at": "2026-11-02T10:00:00", "animal": "ゴリラ", "needs_retake": retake,
        "monster": {"monster_name": monster_name, "object_name": "はさみ", "element": "風"},
        "battle": {"attack": 3000, "hp": 5000},
    }
    (d / "result.json").write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    if image:
        (d / "monster.png").write_bytes(b"\x89PNG\r\n\x1a\n")
