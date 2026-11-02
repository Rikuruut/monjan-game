# モンじゃん! 開発指示書(全体)

2027年1月初旬にイオンモールで行う展示用のゲーム。子供(小学生)が選んだ動物と、スマホで撮った身の回りの物を AI で合体させてモンスターを作り、そのモンスターで CPU とじゃんけんバトルをする。
このリポジトリには2つが入っている。中身の仕様は、それぞれのフォルダの指示書を優先する。

| フォルダ | 中身 | 担当 | 指示書 |
|---|---|---|---|
| `generator/` | 撮影 → 合体 → 誕生(FastAPI + 素の JS)。元は `monjan-prototype`(履歴ごと入れた) | 依頼者 | `generator/CLAUDE.md` |
| `battle/` | タイトル・じゃんけんバトル・結果・ありがとう(React + TypeScript + Vite) | 友人 | `battle/AGENTS.md`・`battle/docs/` |

## 守ること
- **API には実費がかかる**。画像生成を伴うテストの前に、必ず依頼者に確認する(何回・いくらかを先に伝える)。API を使わない確かめ方は `generator/CLAUDE.md` の 2.
- API キーはコードに書かず `generator/.env` から読む。`.env`・`outputs/`・`uploads/` は Git に入れない
- 仕様にない大きな変更は、作業の前に確認する。作り直すときは元のファイルを `generator/archive/<日付>_before_<内容>/` に控える
- `battle/` の画像素材・JSON は変えない(`battle/AGENTS.md`)。友人の元のフォルダ(`Desktop\monjan\…`)は触らない
- `battle/` を変えたら、必ずビルドして `generator/static/battle/` を更新し、それもコミットする(会場では Node を使わない)
- コードのコメントは日本語

## 起動とビルド
この PC の `python` は Microsoft Store の仮のコマンドなので、`generator/.venv` の Python を使う(最初の1回は `py -m venv .venv` → `.venv\Scripts\python.exe -m pip install -r requirements-dev.txt`)。
```powershell
cd generator; .\.venv\Scripts\python.exe -m app.main     # 展示。キオスクで /battle/ が開く(直下の start.bat でも同じ)
cd generator; .\.venv\Scripts\python.exe -m pytest       # API は呼ばない
cd battle; npm.cmd install                # 最初の1回(版は package.json で固定してある)
cd battle; npm.cmd test                   # vitest
cd battle; npm.cmd run build              # 型チェック + ../generator/static/battle/ に出力
cd battle; npm.cmd run dev                # バトルだけを単体で開発(見本のモンスター。サーバー不要)
```
- 起動すると、スマホの URL をターミナルに出し、`/battle/` を Edge(なければ Chrome)のキオスクモードで開く(`generator/app/kiosk.py`。`.env` の `KIOSK_MODE=false` で開かない。終わるのは Alt + F4 で、**ブラウザを閉じるとサーバーも止まる**。前のキオスクの窓が残っていたときは止まらない)。`--autoplay-policy=no-user-gesture-required` なので、ページを移って BGM がいったん切れても、移った直後から音が出る

## つなぎ方
```
/battle/(タイトル)→ スタート → /(撮影・合体・誕生)→ たたかう! → /battle/?photo=<photo_id>(ルール → バトル)
 → 勝ち/負け/引き分け → ありがとう → タイトルへ もどる(/battle/)
```
- サーバー(`generator/app/main.py`)が `generator/static/battle/` を `/battle/` で配る(`battle/vite.config.ts` の `base`・`build.outDir`)
- 受け渡しは `GET /api/battle-monster/{id}`(`generator/app/battle.py`)。バトルの JSON 形式(`battle/docs/DATA_SPEC.md`)で返す
  - `name` は子供が選んだ名前、`attribute` はタイプ(火 など8つ。バトルの属性と同じ)、`image` は `/api/monster-image/{photo_id}`
  - ⚔(attack)は 1〜3、♡(hp)は 3〜5 をランダム。絵ができたときに決めて `result.json` の `battle` に残す(カード印刷と数字をそろえるため)
  - id は photo_id のほか、`outputs/` のフォルダ名(絵は `/api/output-image/<フォルダ名>`)と `demo`(見本のゴリラ × はさみ。`?name=` で名前)も受け付ける
  - CPU は バトルの見本のモンスター(`battle/public/data/monsters/`)からランダム
- バトル側のつなぎは `battle/src/integration.ts` にまとめてある(URL の読み方・パス・3つのボタン)
  - `?photo=<id>`:そのモンスターで、タイトルを飛ばしてルール説明から
  - `?play=demo&name=<名前>`:見本のゴリラ × はさみで同じ(撮影側のテストプレイ・確認用の「たたかう!」)/ `?play=sample`:バトルの見本で同じ
  - `?standalone=1`:スタートで撮影の画面へ行かない。ビルドしていない開発用(`npm.cmd run dev`)とテストは、これまでどおり単体で動く
- 操作は会場の3つのボタン(← / Enter・Space / →)。バトルでは左からグー・チョキ・パー、それ以外は中ボタンで進む。ルール説明は左で「もどる」
- タイプは バトルの属性そのもの:火・水・草・光・闇・風・土・無(攻撃の色・音が変わる)。撮影側の判定が8つから選ぶ(2026年11月2日まではひらがなの性質6つで、バトルが読みかえていた。古い outputs/ の値もバトルはそのまま読める)

## 開発者メニュー
D キーか右下の ⚙ で開く(会場の3つのボタンでは開かない)。撮影・合体(`generator/static/common/app.js`)とバトル(`battle/src/DevMenu.tsx`)で同じ見た目で、上の3つは共通。
- ページ:タイトル・撮影・テストプレイ(`/?autotest=1`)・見本でバトル
- 通しの自動プレイ:タイトル → テストプレイ → バトル(手はランダム)→ 結果 → タイトル をくり返す(API なし。展示前の耐久テスト用)。`sessionStorage` の `monjan-autoplay` で2つのページに受け渡す。メニューを開いているあいだは止まる
- 作ったモンスターで戦う:`GET /api/recent-monsters`(`outputs/` の新しい順に30件)から選ぶと `/battle/?photo=<フォルダ名>`(サーバーを再起動したあとでも戦える)
- バトルだけ:画面へとぶ(タイトル〜ありがとう)・勝ち負けを決める(ふつう / かつ / まける / あいこ。`logic.ts` の `cpuHandFor`)・♡を1に・自分と相手の JSON
- 撮影・合体だけ:`generator/CLAUDE.md` の 5.
