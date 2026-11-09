"""モンじゃん! プロトタイプ のFastAPIサーバー。

PCのブラウザとスマホのブラウザの両方からアクセスして使う。
起動すると、スマホで開くURLをターミナルに表示する。

ここではアプリを組み立てるだけ。中身は次のとおり分けてある。
    config.py(.env・フォルダの場所)/ routes/(API と画面の入口)/ pipeline.py(生成の流れ)/
    session.py(名前の選択・photo_id とフォルダ)/ uploads.py(届いた写真)/ themes.py(PC用ページの見た目)
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.datastructures import MutableHeaders

from . import config  # 先に読み込む(.env の読み込みとログの設定)
from .kiosk import kiosk_enabled, open_kiosk_in_background
from .net_utils import port_in_use
from .routes import generate, link, monsters, name_test, pages

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """起動したときに、スマホで開くURLをターミナルに表示する。"""
    print("", flush=True)
    print("=" * 56)
    print("  モンじゃん! プロトタイプ サーバーを起動しました")
    print("=" * 56)
    print(f"  PC用ページ   : http://localhost:{config.PORT}/")
    print(f"  スマホ用ページ: {config.phone_url()}", flush=True)
    print("", flush=True)
    print("  ※ PCとスマホを同じWi-Fiにつないでください")
    print("=" * 56)
    print("", flush=True)
    yield


class NoCacheForPages:
    """画面のファイル(HTML・CSS・JavaScript)に「毎回、変わっていないか確認する」指示を付ける。

    ※ 2026年10月31日:PC画面を作り直したあと、ブラウザが古い pc.js と style.css を使い回し、
      新しい pc.html と組み合わさって画面が崩れた(サーバーへの読み込みが1回もなかった)。
      指示がないと、ブラウザは自分の判断で古いファイルを使うことがあるため。
      変わっていなければ短い返事(304)で済むので、表示は遅くならない。
    ※ 2026年11月9日:@app.middleware("http") から、軽い ASGI の形に書きかえた
      (API の返事や絵まで、すべての返事を包み直していたため。付ける指示は同じ)。
    """

    def __init__(self, app) -> None:
        self.app = app

    @staticmethod
    def is_page(path: str) -> bool:
        return path in ("/", "/phone", "/card") or path.startswith(("/static/", "/battle"))

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or not self.is_page(scope["path"]):
            await self.app(scope, receive, send)
            return

        async def send_with_header(message) -> None:
            if message["type"] == "http.response.start":
                MutableHeaders(scope=message)["Cache-Control"] = "no-cache"
            await send(message)

        await self.app(scope, receive, send_with_header)


app = FastAPI(title="モンじゃん! プロトタイプ", lifespan=lifespan)
app.add_middleware(NoCacheForPages)

# 静的ファイルの配信
# uploads/ と outputs/ は丸ごとは公開しない(届いた写真と、できた絵だけを API で返す)。
# ※ 2026年11月2日:それまでは両方を公開していて、outputs/ のフォルダ名は日時なので、
#   同じ Wi-Fi の誰でも、子供の写真(photo.jpg)や記録のファイルを推測して開けた
app.mount("/static", StaticFiles(directory=config.STATIC_DIR), name="static")

# じゃんけんバトル(友人の担当。React で作り、ビルドしたものを static/battle/ に置く)。
# タイトル画面もここにあるので、展示は /battle/ から始まる
if (config.BATTLE_DIR / "index.html").is_file():
    app.mount("/battle", StaticFiles(directory=config.BATTLE_DIR, html=True), name="battle")
else:
    logger.warning("static/battle/ がありません。battle/ で npm.cmd run build してください")

for module in (pages, link, generate, monsters, name_test):
    app.include_router(module.router)


def main() -> None:
    """`python -m app.main` で起動するための入口。"""
    import uvicorn

    port = config.PORT
    # ※ 2026年11月2日:前のサーバーが窓のないまま残っていると、新しいサーバーは起動に失敗するのに、
    #   キオスクは前のサーバーの画面を開いてしまい、古いコードのまま動いているように見えた
    if port_in_use(port):
        print(f"\n  ポート {port} は、もう別のサーバーが使っています(前のサーバーが残っているかもしれません)。\n"
              "  タスクマネージャーで python.exe を終わらせるか、PC を再起動してから、もう一度起動してください。\n", flush=True)
        raise SystemExit(1)

    server = uvicorn.Server(uvicorn.Config("app.main:app", host="0.0.0.0", port=port, reload=False))

    # PC用ページをキオスクモードで開く(.env の KIOSK_MODE=false で開かない)。ブラウザを閉じたらサーバーも止める。
    # uvicorn を直接動かしたとき(確認用の一時サーバーなど)は開かないよう、ここで行う
    if kiosk_enabled():
        open_kiosk_in_background(port, on_close=lambda: setattr(server, "should_exit", True))

    server.run()


if __name__ == "__main__":
    main()
