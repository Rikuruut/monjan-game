# モンじゃん! プロトタイプ

子供がスマホで選んだ**動物**と、撮った**身の回りの物**から、OpenAI API でモンスターの情報と絵を作るプロトタイプです(2027年1月のイオンモールでの展示用)。

- 全体の構成・処理の流れ・API・ファイルの役割:[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- 開発のルールと仕様:[CLAUDE.md](CLAUDE.md)

---

## 1. 準備

必要なもの:Python 3.11 以上 / ノートPC(Windows)とスマホ(**同じ Wi-Fi**)/ OpenAI の API キー

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt   # テストもするときは requirements-dev.txt
Copy-Item .env.example .env   # できた .env に値を書く
```

> このPCでは `python` と打つと Microsoft Store のダミーが動き、仮想環境を作れません。`py` を使ってください。
> `py` も使えないときは、Python の実体を直接指定します(例:`C:\Users\<ユーザー名>\AppData\Local\Python\pythoncore-3.14-64\python.exe -m venv .venv`)。

### `.env` の項目

| 項目 | 内容 |
|---|---|
| `OPENAI_API_KEY` | OpenAI の API キー(コードに書かない。`.env` は Git に入れない) |
| `TEXT_MODEL` | 判定に使うモデル(画像入力に対応したもの。例 `gpt-6-luna`) |
| `IMAGE_MODEL` | 画像生成のモデル(例 `gpt-image-2.5-sunburst` / `gpt-image-2` / `gpt-image-1-mini`) |
| `IMAGE_QUALITY` | 画質(`low` / `medium` / `high`。既定 `medium`) |
| `IMAGE_SIZE` | 画像サイズ(既定 `1024x768`。幅・高さとも16の倍数) |
| `API_TIMEOUT_SECONDS` / `IMAGE_TIMEOUT_SECONDS` | タイムアウト秒数(判定 60 / 画像生成 120) |
| `DRY_RUN` | `true` で API を一切呼ばない「からうちモード」(料金0円。下の「5. 料金」) |
| `ALLOW_PERSON` | 人が写った写真も生成するか(既定 `false`。下の「4. 注意」) |
| `IMAGE_PROMPT_STYLE` | 画像プロンプトの書き方。`detailed`(設計図つき)/ `simple`(短いもの) |
| `FUSION_TYPE` / `FUSION_PART` | 物を取り込む型・場所を固定する(空なら毎回ランダム。くわしくは `.env.example`) |
| `PC_THEME` | PC 画面の見た目。`lab` / `fantasy` / `cardpack` / `pot` / `gacha` / `summon`(既定 `lab`) |
| `KIOSK_MODE` / `KIOSK_BROWSER` | 起動時に PC 用ページを全画面で開くか(既定 `true`)/ 使うブラウザ(空なら Edge → Chrome) |
| `PORT` | ポート番号(既定 8000) |

---

## 2. 起動

```powershell
.\.venv\Scripts\Activate.ps1
python -m app.main
```

- ターミナルに PC 用(`http://localhost:8000/`)とスマホ用(`http://192.168.x.x:8000/phone`)の URL が出る
- PC 用ページが**キオスクモード**(全画面・アドレスバーなし)で開く
  - **終わるときは Alt + F4**。起動し直す前に閉じておく(もう1つ窓が開くため)
  - ふだんの Edge が開いていても全画面になるよう、専用のプロフィール(`%LOCALAPPDATA%\monjan-kiosk`)を使う
  - 自分でブラウザを開くときは `.env` を `KIOSK_MODE=false` にする
- スマホで、表示された URL を開く(PC の開発者メニューに QR コードも出る)

テスト(API は呼ばないので料金0円):`python -m pytest`

---

## 3. 使い方

1. PC で「スマホで とる」を押す
2. スマホに**動物のプルダウン(10種類)**と「とる!」ボタンが出る。動物を選び、「とる!」で撮影する
3. PC に写真と動物が出たら「がったい!」を押す
4. 待っているあいだに、スマホでモンスターの名前を選ぶ
5. PC にモンスターのカードが出る(「たたかう!」「いんさつ」はまだ「じゅんびちゅう」)

| キー | 動き |
|---|---|
| ← / Enter・Space / → | 画面下の3つのボタン |
| D(または右下の歯車) | 開発者メニュー(判定の JSON・時間・料金・テーマの切りかえ・名前のテスト) |

- テーマは `/?theme=fantasy` のように URL でも切りかえられる
- 名前のテスト(開発者メニュー):写真も画像生成も使わずに、モンスター名だけを作る(1回0.1円以下。結果は `outputs/name_tests.jsonl`)

---

## 4. 注意

- **ファイアウォール**:初回起動時の警告で、**プライベートネットワーク**を許可する(許可しないとスマホからつながらない)
- **Wi-Fi**:公共・ゲスト用の Wi-Fi は端末同士の通信が禁止されていることが多い。つながらないときは、スマホのテザリングに PC をつなぐ
- **カメラ**:スマホでのタップが必要(PC のボタンだけでは撮影できない)。写真はスマホで長辺1024pxの JPEG にしてから送る
- **人が写った写真**:既定では撮り直しになる。`ALLOW_PERSON=true` にすると、顔立ちなどを取り込んだモンスターを作る
  - 撮られる本人(と保護者)の同意があるときだけ使う。**展示本番は `false`** が安全(通りすがりの人が写り込むため)
  - 実在の人物はコンテンツフィルターで断られることがある(そのときはエラーをそのまま出し、リトライしない)

---

## 5. 料金

**1回の生成(判定 + 画像1枚)で約7.5円**(2026年10月28日の実測。`gpt-image-2` / medium / 1024×768)。ほぼ全額が画像生成です。

| 処理 | 料金 |
|---|---|
| 判定(`gpt-6-luna`) | 約0.1円 |
| 画像生成(`gpt-image-2` / medium / 1024×768) | 約7.4円 |
| 画像生成(`gpt-image-1-mini`) | 約2.2円 |

画質・サイズによる違い(`gpt-image-2`。料金は画素数にほぼ比例し、プロンプトの長さはほとんど影響しない):

| 設定 | 1枚あたり |
|---|---|
| `low` / **`medium`** / `high`(1024×768) | 約3.4円 / **約7.5円** / 約23.7円 |
| 1280×960 / 1024×1024 / 1024×1536 | 約10.5円 / 約9.3円 / 約12.9円 |

- 今の設定 `gpt-image-2.5-sunburst` は、トークンの単価は同じだが1枚あたりのトークン数がちがう可能性がある。**実際の料金は `result.json` の `usage` で確認する**
- 生成のたびに、PC 画面(開発者メニュー)と `outputs/.../result.json` の `usage` に使用量と料金の試算が出る。累計は `outputs/api_usage_log.jsonl`
- 単価は `app/pricing.py`(2026年10月28日時点。変わることがあるので、使う前に公式で確認する)
- 撮り直しになったときは画像生成を呼ばないので、判定の分だけ

### 料金を抑える

- **からうちモード**(`.env` の `DRY_RUN=true`):API を一切呼ばず、決まった判定結果と「DRY RUN」と書いたダミー画像を返す。画面やスマホの接続の確認はこれで行う
  - **必ず `.env` を書きかえる**。ターミナルで `$env:DRY_RUN="true"` にしてから起動しても、`.env` の値が優先される
- 調整中は `IMAGE_QUALITY=low`(約半分)や `IMAGE_MODEL=gpt-image-1-mini`(約3分の1)

---

## 6. 保存先

- 生成結果:`outputs/YYYYMMDD_HHMMSS/`(`photo.jpg`・`monster.png`・`result.json`)
- スマホから届いた写真:いったん `uploads/` に置く
- `outputs/`・`uploads/`・`.env` は Git に入れない

処理時間の目安:判定 約8〜16秒 + 画像生成 約25〜40秒(設定による)。残っている確認:スマホ実機(iPhone・Android)でのカメラと送信。
