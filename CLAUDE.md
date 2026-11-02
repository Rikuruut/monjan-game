# モンじゃん! 開発指示書(全体)

2027年1月初旬にイオンモールで行う展示用のゲーム。子供が選んだ動物と、スマホで撮った身の回りの物を AI で合体させてモンスターを作り、そのモンスターで CPU とじゃんけんバトルをする。
このリポジトリには2つが入っている。中身の仕様は、それぞれのフォルダの指示書を優先する。

| フォルダ | 中身 | 担当 | 指示書 |
|---|---|---|---|
| `generator/` | 撮影 → 合体 → 誕生(FastAPI + 素の JS)。元は `monjan-prototype`(履歴ごと入れた) | 依頼者 | `generator/CLAUDE.md` |
| `battle/` | タイトル・じゃんけんバトル・結果・ありがとう(React + TypeScript + Vite) | 友人 | `battle/AGENTS.md`・`battle/docs/` |

## 守ること
- `generator/CLAUDE.md` の「守ること」(API の実費・からうち・`.env`)は、このリポジトリ全体で守る
- `battle/` の画像素材・JSON は変えない(`battle/AGENTS.md`)。友人の元のフォルダ(`Desktop\monjan\…`)は触らない
- `battle/` を変えたら、必ずビルドして `generator/static/battle/` を更新し、それもコミットする(会場では Node を使わない)

## 起動とビルド
```powershell
cd generator; python -m app.main          # 展示。キオスクで /battle/(タイトル)が開く
cd battle; npm.cmd install                # 最初の1回(版は package.json で固定してある)
cd battle; npm.cmd test                   # vitest
cd battle; npm.cmd run build              # 型チェック + ../generator/static/battle/ に出力
cd battle; npm.cmd run dev                # バトルだけを単体で開発(見本のモンスター。サーバー不要)
cd generator; python -m pytest            # API は呼ばない
```

## つなぎ方
```
/battle/(タイトル)→ スタート → /(撮影・合体・誕生)→ たたかう! → /battle/?photo=<photo_id>(ルール → バトル)
 → 勝ち/負け/引き分け → ありがとう → タイトルへ もどる(/battle/)
```
- サーバー(`generator/app/main.py`)が `generator/static/battle/` を `/battle/` で配る(`battle/vite.config.ts` の `base`・`build.outDir`)
- 受け渡しは `GET /api/battle-monster/{photo_id}`(`generator/app/battle.py`)。バトルの JSON 形式(`battle/docs/DATA_SPEC.md`)で返す
  - `name` は子供が選んだ名前、`attribute` は性質(あつい など6つ)、`image` は `/api/monster-image/{photo_id}`
  - ⚔(attack)は 1〜3、♡(hp)は 3〜5 をランダム。絵ができたときに決めて `result.json` の `battle` に残す(カード印刷と数字をそろえるため)
  - CPU は バトルの見本のモンスター(`battle/public/data/monsters/`)からランダム
- バトル側のつなぎは `battle/src/integration.ts` にまとめてある(URL の読み方・パス・3つのボタン)
  - `?photo=<id>`:そのモンスターで、タイトルを飛ばしてルール説明から / `?play=sample`:見本で同じ(PC の開発者メニューのテストプレイから)/ `?standalone=1`:スタートで撮影の画面へ行かない
  - ビルドしていない開発用(`npm.cmd run dev`)とテストは、これまでどおり単体で動く
- 操作は会場の3つのボタン(← / Enter・Space / →)。バトルでは左からグー・チョキ・パー、それ以外は中ボタンで進む。ルール説明は左で「もどる」
- 性質6つはバトルの属性の見た目・音に対応させてある:あつい→火 / みず→水 / でんき→光 / かたい→土 / とがってる→風 / やわらかい→草
- ページを移るので BGM はいったん切れる。キオスクは `--autoplay-policy=no-user-gesture-required` で、移った直後から音が出る
