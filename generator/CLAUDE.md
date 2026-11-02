# モンじゃん! プロトタイプ 開発指示書

Claude Code が作業の前に読む指示書。仕様に迷ったらここを優先する。
経緯をくわしく残した以前の版は `archive/20261101_before_claude_md_trim/CLAUDE.md`。

## 1. 概要

- 2027年1月初旬にイオンモールで行う展示用のゲーム。子供(小学生)が選んだ**動物**と、スマホで撮った**身の回りの物**を AI で合体させてモンスターを作る
- 今は**仕組みを確かめるプロトタイプ**。確かめること:処理時間・画質・物の判定の精度
- タイトル画面・じゃんけんバトルは友人の担当で、このリポジトリの `../battle/` にある(つなぎ方は `../CLAUDE.md`)。
  「たたかう!」でバトル(`/battle/?photo=…`)へ移る
- 作らないもの:カードの生成と印刷。「いんさつ」は「じゅんびちゅう」と出すだけ

## 2. 守ること

- **API には実費がかかる**。画像生成を伴うテストの前に、必ず依頼者に確認する(何回・いくらかを先に伝える)。同じ確認で何度も呼ばない
- API を使わずに済む確認は、からうちモード(`.env` の `DRY_RUN=true`。料金0円)か pytest(`python -m pytest`)で行う
  - ※ `app/main.py` は `load_dotenv(override=True)` なので、**起動前に環境変数で `DRY_RUN=true` にしても `.env` の値に戻る**。
    `uvicorn` の一時サーバーはからうちにならない(`?demo=1` の画面は API を呼ばないので、それだけに使う)
  - `tests/conftest.py` は、からうちにしたうえで API を呼ぼうとしたら失敗させる
- API キーはコードに書かず `.env` から読む。`.env`・`outputs/`・`uploads/` は Git に入れない
- OpenAI API の書き方・モデル名は、推測せず公式ドキュメントで確認する
- 仕様にない大きな変更は、作業の前に確認する。作り直すときは元のファイルを `archive/<日付>_before_<内容>/` に控える
- コードのコメントは日本語

## 3. 技術と構成

- Python 3.11+ / FastAPI + Uvicorn / WebSocket / Pillow / `openai` / python-dotenv / pytest
- 画面は HTML + CSS + 素の JavaScript(フレームワークなし)
- ライブラリとフォントは**ネットから読まず `static/vendor/` に置く**(会場の Wi-Fi 対策。ネットを止めて全ページの字体が出ることを確認済み)
  - GSAP 3.15.0(SplitText 含む。無料・商用可)/ tsParticles 4.5.0(MIT)/ Howler.js 2.2.4(MIT)/ フォント(SIL OFL 1.1)
  - tsParticles 4 は 3 と書き方が違う(色は `particles.paint.color`。`particles.color` だと白になる)
- ノートPCでサーバーを `0.0.0.0` で動かし、PC とスマホのブラウザからつなぐ(同じ Wi-Fi。公共 Wi-Fi は端末同士の通信が禁止されがち)
- `python -m app.main` で起動すると、スマホの URL をターミナルに出し、バトルのタイトル(`/battle/`)を Edge(なければ Chrome)のキオスクモードで開く(`app/kiosk.py`。`KIOSK_MODE=false` で開かない。終わるのは Alt + F4)

```
app/      main.py(ルーティング)・battle.py(バトルへの受け渡し)・recognizer.py(判定)・generator.py(画像生成。別サービスに差し替えられる作り)・
          prompts.py・validator.py・animals.py・openai_client.py・pricing.py(単価)・storage.py・ws_manager.py・kiosk.py
static/   common/(app.js:場面の進行と開発者メニュー / sound.js:効果音 / common.css)・themes/<名前>/・
          phone.html/js/css・vendor/・sounds/(今は仮の音。README 参照)・
          battle/(../battle/ をビルドしたもの。手で書きかえない)
tests/    pytest(API は呼ばない)
outputs/  YYYYMMDD_HHMMSS/ に photo.jpg・monster.png・result.json(判定・モデル・画質・時間・料金 usage・バトルの ⚔♡ battle)
```

## 4. 処理の流れ

1. PC の「スマホでとる」→ WebSocket でスマホに合図 → スマホに動物のプルダウン(10種類)と「とる!」
2. スマホで撮影(`<input type="file" accept="image/*" capture="environment">`。`getUserMedia` は HTTPS が要るので使わない。カメラはスマホでのタップが必要)
3. スマホが canvas で**長辺1024pxの JPEG** にして、動物と一緒に `POST /api/upload`(HEIC 対策)。サーバーは Pillow で開けるか確かめ、動物を `photo_id` に紐づける
4. PC の「がったい!」→ `POST /api/generate`:判定 → チェック → (撮り直しなら理由を出して終了)→ 画像生成 → 保存。
   `simple` では判定を2つに分け、すぐ要る判定(物の名前・撮り直し)のあと、画像生成と名前・説明を**同時に**行う(6. 参照)
5. 画像を作っているあいだ、スマホで子供が名前を選ぶ(`POST /api/choose-name`)

- WebSocket は `/ws?role=pc|phone`。メッセージ:`capture_request` / `photo_received` / `phone_status` / `upload_done` /
  `progress`(`stage`:naming・drawing・names・partial・done・retake・error。drawing に `expected_seconds`(detailed では `name_choices` も)、
  names に `name_choices`(simple。絵を作っているあいだに届く)、partial に途中の絵の `image_url`・`index`・`total`、done に `image_url`)/ `name_chosen` / `revealed`(PC の誕生の演出が終わった。スマホはここで絵を見せる。PC が `POST /api/revealed` で知らせる)
- バトル:`/battle/`(タイトル・バトル。`static/battle/`)・`/api/battle-monster/{photo_id}`(バトルが読む形のモンスター。⚔1〜3・♡3〜5 は絵ができたときに決める)
- そのほかの API:`/api/photo/{photo_id}`・`/api/monster-image/{photo_id}`・`/api/partial-image/{photo_id}/{index}`(写真と絵と途中の絵。`uploads/`・`outputs/` は公開しない)・`/api/capture-request`・`/api/name-test`(名前だけを作る。1回0.1円以下)・`/api/themes`・`/api/qr`・`/api/info`
- 動物は一覧(`animals.py`:ライオン・ゾウ・ウサギ・ペンギン・ネコ・鷹・ワニ・ゴリラ・サメ・ティラノサウルス)から選ぶが、
  製品版は自由入力の予定なので、**どこでも任意の文字列として動くようにする**

## 5. 画面

### PC(`/`。展示の大画面 1920×1080)
- 1920×1080 の舞台を、モニターに合わせて拡大縮小(`app.js` の `fitStage`)。操作は3つのボタン = ← / Enter・Space / →。D キーか歯車で開発者メニュー(テストプレイ:見本のゴリラ × はさみで「がったい!」から誕生後まで通しで流す(がったい中 約25秒)・確認用の場面・演出・効果音のボタン(APIなし)・判定の JSON・時間・料金・名前のテスト)
- 場面は `#stage` の `data-scene`:s1 しゃしんを とろう / s2 しゃしん × どうぶつ = ? / s3 がったい中 / s4 たんじょう(左 もう一回・中 たたかう!・右 いんさつ)
  - バトルのタイトルの「スタート!」で s1 に来る。「たたかう!」は `/battle/?photo=<photo_id>` へ(テストプレイ・確認用は `?play=demo&name=<名前>` で、見本のゴリラ × はさみのまま戦う)
- **見た目はテーマで切りかえる**:`static/themes/<名前>/`(index.html・style.css・theme.json)。`/?theme=名前`、なければ `.env` の `PC_THEME`(既定 lab)。フォルダを足すだけで選べる
  - 今あるテーマ:lab(ひみつけんきゅうじょ)/ fantasy(たまご)/ cardpack / pot / gacha / summon / fusion(もりのつむじかぜ。写真と動物がうずのまわりを回りながら吸いこまれ、一点に縮んでから風がはじけて葉と花びらが舞う)。背景は1枚の絵 `static/themes/fusion/bg.webp`(依頼者が用意した絵を 1920×1080 の WebP に整えたもの)
  - テーマに用意する要素(ID)は `app.js` 先頭の「テーマとの約束」
  - 進み具合は `#stage` の `--progress`(0〜1)と `data-level`(0〜5)を CSS で見せる。**段ごとの見た目は静的な指定で出し、transition やアニメーションを使わない**(回る・ゆれる要素の中で途中のまま止まって見えた)
  - 場面転換は `#stage.shut` を CSS で見せる。時間は `--scene-close-ms` / `--scene-open-ms`
  - JavaScript の演出は任意:`window.themeFx.birth(showCard)` で誕生をまかせられる(失敗しても `app.js` がカードを出す)。段が変わると `#stage` に `levelchange`。
    今は fantasy・fusion の `effects.js`(GSAP・tsParticles)。ライブラリが読めないときは `<html>` に `fx` が付かず、CSS の演出で動く
  - 効果音 `window.sfx.play(名前)`:press・tick(段が上がった)・crack・fanfare。themeFx のあるテーマは誕生の音を自分で鳴らす。`?sound=0` で消す
- 確認用(API なし):`/?theme=…&demo=1&scene=s3&progress=0.8&photo=…&img=…&animal=…&name=…`、`&play=birth` で割れる直前から誕生後まで流す、`&dev=1` で開発者メニュー。`photo`・`img` を付けなければ見本(`static/demo/`)を使う

### スマホ(`/phone`)
- 子供が触るので文字は大きく、ボタンは押しやすく。動物を選ぶのはスマホだけ(最初から1つ選んでおく)
- 待機中「PCの ボタンを まってね」→ 撮影待ち → 送信中「おくっているよ…」→「おくったよ!」→ 名前を選ぶ(「この なまえに する! / ほかに さがす」)→ できあがり(名前と絵。次の合図まで出したまま)
- 見た目は `phone.css` に分けてある(大画面の変更の影響を受けないように)

## 6. 判定(テキスト用モデル)

- `TEXT_MODEL=gpt-6-luna`(画像入力・構造化出力に対応を確認済み)。`client.responses.parse(text_format=...)` で JSON を受け取る。実測 約8〜16秒(simple・1回で全部作っていたころは 14〜31秒)
- **simple では2つに分ける**(2026年11月2日。待ち時間を短くするため):
  すぐ要る判定 `quick_check`(`needs_retake`・`retake_reason`・`has_person`・`object_name`)→ 画像生成を始める →
  同時に名前・説明 `describe`(`element`・`monster_name`・`name_candidates`・`description`)。design_plan は作らない。
  指示文は部品に分けてあり(`prompts.py`)、detailed の `RECOGNIZE_INSTRUCTIONS` は分ける前と1字も変わらない(テストで確かめている)
- 返す内容:`needs_retake`・`retake_reason`・`has_person`・`object_name`・`element`・`monster_name`・`name_candidates`(3つ)・`description`・`design_plan`(6項目。詳しくは `recognizer.MonsterInfo`)
- 性質 `element` は6つから1つ:あつい / みず / でんき / かたい / とがってる / やわらかい。**画像プロンプトには入れない**(バトル用に保存するだけ)
- 撮り直し:人が写っている・物がはっきりしない・子供にふさわしくない物。**物を持つ手や指だけなら人とみなさない**(指だけで人モードになり、人の特徴が描かれた)。
  判定の返答を読めない(モデルが断った)ときも撮り直し(不適切な写真で断られることが多いため)
- 説明文は子供向けにひらがな中心。simple では**図鑑の一文**(絵を見ても分からない、くせ・すきなことなどの小さなお話)。
  ポーズ・表情は伝えない(伝えると、それを写しただけの「〜を はなつ、〜な ライオン!」という同じ型になった)。具体例は書かない
- 判定に考えさせる項目を増やすと時間が伸びる(30秒を超えてタイムアウトしたことがある)

### チェック(`validator.py`。テストあり)
| 項目 | ルール | 不正なとき |
|---|---|---|
| `element` | 6種類のどれか | かたい |
| `name_candidates` | カタカナだけ・2〜10文字・NG語なし・小さい文字が続かない・物と動物を並べただけでない | 合格したものから 50/30/20% の重みで1つを `monster_name` に |
| `monster_name` | 候補がすべて不合格のときだけ使う。10文字以内で、候補と同じチェック | 切る。不合格・空なら「なぞのモンスター」 |
| `description` | 40文字以内 | 40文字までの最後の区切り(空白・、・。)で切る。15文字未満になるなら文字数で切る |
| `object_name` | 空でない | なにかのもの |
| `design_plan` の各項目 | 120文字以内 | 切る。空なら既定値 |
| JSON 全体 | 辞書 | すべて既定値 |

### モンスター名(`prompts.NAME_RULES`)
- 子供が最初に目にする「当たり外れ」なので、しっかり組んである。名前は子供がスマホで、判定の候補から選ぶ(作り直しはしない。画像ができて60秒で自動で決定。`phone.js` の `AUTO_DECIDE_SECONDS`)
- 2語を並べず音を混ぜて1語に。少なくとも片方の材料が分かる。カタカナ3〜8文字。物は言いかえてよい(はさみ → シザー・チョキ)
- 3つの作り方を1つずつ:A 重ね合わせ / B 言いかえ合体 / C 怪獣ネーム(両方の音をまぜてから強い語尾)
- 分かっている失敗:頭を2文字ずつつなげただけ(タカサミ)・物の飾りことば(カイネコ)・部位の言葉(〜テイル)・片方に語尾だけ(ウサギドン)。
  **指示文に具体例を書くとそのまま写される**ので、例は「ライオン × ドライヤー → ドライオン」だけ
- 残っている課題:ゴリラ×えんぴつはゴリペン・ゴリピツが続く。C が「〜ガ」をつけただけになりやすい
- 調整は PC の開発者メニュー「名前のテスト」で(写真・画像生成なし。結果は `outputs/name_tests.jsonl`)

## 7. 画像生成

- `IMAGE_MODEL=gpt-image-2.5-sunburst`(依頼者の指定。編集の正確さがいちばん高い)。速さが問題なら `gpt-image-2.5-flare`、元に戻すなら `gpt-image-2`。`chatgpt-image-latest` は非推奨なので使わない
- `client.images.edit(model, image=("photo.jpg", bytes, "image/jpeg"), prompt, size, output_format, n=1)` で写真を渡す。戻りは `data[0].b64_json`
- `IMAGE_QUALITY=medium` で動く。画質が原因で断られたときだけ、画質を外して1回やり直す(公式ドキュメントの記述が食い違っているため)
- `IMAGE_SIZE=1024x768`(4:3。幅・高さは16の倍数、縦横比 1:3〜3:1)/ PNG。実測 約25〜40秒(sunburst・medium は 18〜21秒)
- 途中の絵:`IMAGE_PARTIAL_IMAGES`(既定 2。0 で使わない)が1以上なら `stream=True`・`partial_images` で受け取り、たまごのテーマで殻の内側に透かして見せる(スマホには出さない)。
  断られたら途中の絵なしで1回やり直す。途中の絵の追加料金は公式に書かれていないので `usage` で確かめる
- コンテンツフィルターで止められたら、同じ入力でリトライしない

### プロンプト(`prompts.py`。`IMAGE_PROMPT_STYLE` で切りかえ)
- 依頼者の基本:動物と写真を合成 / かっこよさ70%・かわいさ30% / 写真を最大限に生かす / 武器にしてもよい / 背景はモンスターに合うもの /
  画風「セミリアルなアニメ調、ハイファンタジー系、厚塗り、重厚な金属質感、シネマティックなライティング」/ 文字・ロゴ・数字なし
- `simple`:依頼者が Playground で良い絵が出た短いプロンプト + 「{物}の特徴は主に{場所}に」+ ポーズの1行 + 背景の1行(「背景は「月夜の森」」)。場所は動物ごとの一覧からランダム(`ANIMAL_FUSION_PARTS`。`FUSION_PART` で固定)。
  背景は時間帯・天気(`STAGING_OPTIONS["scene"]`)× 動物のすみか(`BACKGROUND_PLACES`。`BACKGROUND` で固定)の2語だけ。直前と同じものは選ばない。
  時間帯の夜は「満天の星空」だけ(夜が多いと、夜と満月の絵ばかりになった)。
  ※ 背景をまかせると、どの絵も「昼の青空・岩・飛び散る岩」になり、同じ構図に見えた(2026年11月2日)。複雑な指示は物の取り込みを不正確にするので、2語にとどめる
  判定にも**画像と同じ内容だけ**を伝える(伝えていない天気・よろいが説明文に書かれ、絵と食い違った)
- `detailed`:判定の `design_plan` を設計図として差し込む。融合の型(武器 / 体の部位 / よろい。`FUSION_TYPE` で固定)と演出(`STAGING_OPTIONS`)をランダムに選ぶ
- 方針:**大きな方向はプログラムがランダムに決め、細部は AI にまかせる**(AI にまかせると、ポーズも背景も毎回同じになった)
- 分かっている失敗(プロンプトを変えるときに注意):
  - 物をまるごと体の前に重ねて描く → 「まるごとの形で前に置かない」。武器型でも製品まるごとにせず、パーツ1つを作り変える(本物のはさみが胸を貫いた)
  - simple で「{物}の特徴を{場所}に取り入れて」と書くと、本物の物をくわえる・刺さる・重なる → 言いかえだけでは直らなかった(2026年11月2日)。
    今は、すぐ要る判定で物の目立つパーツを2つ答えてもらい、「「刃」は前足の武器に、「持ち手の輪」は頭の飾りに」と、パーツごとの行き先を1行で書く
    (`prompts.fusion_line`)。パーツ1つだけだと、持ち手がなくなり何の物か分かりにくくなった。
    取り込み方は 武器 / 体の部位 を半分ずつ(`FUSION_STYLE` で固定)。武器の場所は動物ごと(`WEAPON_PARTS`)、飾りには口・前足を使わない
  - 1つのパーツを2か所に使う・サブの融合がメインと同じ手足 → 物が2本ある・体を貫いて見える
  - simple で前足を武器にして「振り返りざまに技を放つ」→ 武器の前足と立つ前足を別々に描き、前足が2本多い(2026年11月2日)。
    「守ること」に手足の数の1行を足し、四本足の動物では「腕」と言わず「前足の先」、前足の回は立ち上がる・技を放つ・空中のポーズを外した
  - パーツを「いちばん目立つもの」で聞くと、はさみの持ち手が1つ目になり、前足の籠手になった(違和感) → 1つ目は「武器や体の一部にしても自然な、とがった・かたいパーツ」で聞く
  - サメに「高い岩の上から見下ろす」→ 岩の上に立った → 水の中の動物(`AQUATIC_ANIMALS`)は専用のポーズ(`AQUATIC_POSES`)から選び、背景は水の中だけ、背景の行に「泳いでいる」
  - 「振り返りざまに技を放つ」など体をねじるポーズ → 体の形が崩れる(ライオンの前足が増えた・サメのしっぽが2本に見えた) → ポーズの候補から外した
  - 必殺技を物の形のエフェクトで描く → 向きが逆になる。「必殺技」の型と「斜め後ろから」の視点は外した。同じ型・場所は2回続けない
- プロンプトを比べるときは1枚ずつでなく、決まった組み合わせ(ライオン×はさみ・ゾウ×はさみ・形の違う物)で試す
- どの設定で作ったかは `result.json` の `settings` と `monster.design_plan`(`fusion_type`・`fusion_part`・`staging`)に残る

## 8. エラーと料金

- タイムアウト:判定 60秒(`API_TIMEOUT_SECONDS`)/ 画像生成 120秒(`IMAGE_TIMEOUT_SECONDS`)
- 失敗はエラーの内容をそのまま PC 画面に出す(本番では用意した画像に差しかえる予定)。サーバーは止めない
- 料金(`app/pricing.py`。使う前に公式の単価を確認し直す):**今の設定で1回 約4円(3.8〜4.1円)**(2026年11月2日の実測から試算。1ドル150円)。
  内訳:判定(物の名前・撮り直し)約0.03円 + 名前・説明 約0.1円 + 画像 約2.8〜3.1円(sunburst / medium / 1024×768。出力 371〜441 トークン)+ 途中の絵2枚 約0.9円。
  sunburst は gpt-image-2 と単価が同じで、1枚の出力トークンが少ない(gpt-image-2 / medium は 1204 トークンで 約7円)。high は 約7円、xhigh は 約11円。
  途中の絵は1枚 100 画像出力トークン(公式)。API の使用量に入っていないので、`generator._add_partial_image_cost` が試算に足す。
  本当の請求額は OpenAI の管理画面の Usage で確かめる
  sunburst の実際の料金は `result.json` の `usage` で見る。撮り直しなら判定の分だけ
- 生成のたびに使用量と料金の試算を PC 画面と `result.json` に出し、累計を `outputs/api_usage_log.jsonl` に足す(からうちは足さない)
