# モンじゃん! セットアップ手順(新しい PC で動かすまで)

このリポジトリを自分の Windows PC に取り込んで、撮影 → 合体 → バトルまで通しで動かすための手順です。
くわしい仕様は `CLAUDE.md`(全体)・`generator/README.md`(撮影・合体)・`battle/AGENTS.md`(バトル)を見てください。

---

## 0. 用意するもの

| もの | メモ |
|---|---|
| Windows の PC | Edge か Chrome が入っていること(キオスクモードで開く) |
| スマホ | PC と**同じ Wi-Fi** につなぐ(撮影に使う) |
| Git | `git --version` で確認 |
| Python 3.11 以上 | python.org から入れる。インストール時に「py launcher」を入れる(既定で入る) |
| Node.js 20 以上 | **`battle/` を変えるときだけ**。遊ぶだけなら不要(ビルド済みのものが入っている) |
| OpenAI の API キー | 3. を参照。**画像生成1回 約4円** かかる |

---

## 1. リポジトリを取り込む

```powershell
git clone https://github.com/Rikuruut/monjan-game.git
cd monjan-game
```

> OneDrive の中に置くと、`.venv` や `node_modules` の同期で重くなることがあります。`C:\dev\` など OneDrive の外がおすすめです。

---

## 2. Python の準備(最初の1回)

```powershell
cd generator
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

- `python` ではなく **`py`** を使う(`python` と打つと Microsoft Store のダミーが開くことがある)
- 以後も Python は **`.\.venv\Scripts\python.exe`** で動かす

---

## 3. `.env` を作って、API キーとモデルを書く

`generator/.env` に API キーや設定を書きます。**このファイルは Git に入らない**ので、各自の PC で作ります。

```powershell
cd generator
Copy-Item .env.example .env
notepad .env
```

### 必ず書く3つ

`.env.example` では空になっているので、次のように書きます。

```ini
OPENAI_API_KEY=sk-...(自分の API キー)
TEXT_MODEL=gpt-6-luna
IMAGE_MODEL=gpt-image-2.5-sunburst
```

| 項目 | 内容 |
|---|---|
| `OPENAI_API_KEY` | OpenAI の API キー。**人に送らない・コードに書かない・コミットしない** |
| `TEXT_MODEL` | 写真の判定とモンスターの名前・説明に使うモデル(画像入力に対応したもの) |
| `IMAGE_MODEL` | モンスターの絵を作るモデル |

### API キーの取り方

1. https://platform.openai.com/ にログイン
2. **Billing** で支払い方法を登録し、クレジットを入れる(入れないと API が動かない)
3. **API keys** →「Create new secret key」で作り、表示されたキーを `.env` にはる(画面を閉じると二度と見られない)
4. 画像モデルは、組織の**本人確認(Organization verification)**を求められることがある。エラーが出たら Settings → Organization から行う

> 使いすぎ防止に、**Limits で月の上限金額**を決めておくと安心です。本当の請求額は管理画面の **Usage** で確かめます。

### そのままでよい項目

ほかの項目は `.env.example` のままで動きます。よく触るのは次のとおり(全部の説明は `.env.example` のコメント)。

| 項目 | いつ変える |
|---|---|
| `DRY_RUN` | `true` にすると **API を一切呼ばない(料金0円)**。画面やスマホの接続を確かめるときはこれ |
| `IMAGE_QUALITY` | `low` にすると約半分の料金(調整中向け)。本番は `medium` |
| `KIOSK_MODE` | `false` にすると起動時に全画面で開かない(開発中に便利) |
| `ALLOW_PERSON` | 人が写った写真も使うか。**展示本番は `false` のまま** |
| `PORT` | 8000 がほかで使われているとき |

---

## 4. まずはお金をかけずに動かす

最初は `.env` を **`DRY_RUN=true`** にして、通しで動くか確かめます(ダミーの絵が出る)。

```powershell
cd generator
.\.venv\Scripts\python.exe -m pytest      # テスト(API は呼ばない)
.\.venv\Scripts\python.exe -m app.main    # 起動(リポジトリ直下の start.bat をダブルクリックでも同じ)
```

起動すると:

- ターミナルに**スマホ用の URL**(`http://192.168.x.x:8000/phone`)が出る。開発者メニュー(D キー)には QR コードも出る
- PC ではタイトル画面(`/battle/`)が**キオスクモード**(全画面)で開く
- **終わるときは Alt + F4**(ブラウザを閉じるとサーバーも止まる)

### 初回だけ出るもの・つながらないとき

- **Windows ファイアウォール**の警告が出たら、**プライベートネットワーク**を許可する(許可しないとスマホからつながらない)
- PC の Wi-Fi が「パブリック ネットワーク」になっているとつながらないことがある → Windows の設定で「プライベート」にする
- 公共・ゲスト用 Wi-Fi は端末同士の通信が禁止されていることが多い → スマホのテザリングに PC をつなぐ
- 「ポート 8000 が使われている」と出たら、前のサーバーが残っている。ターミナルを閉じるか、`.env` の `PORT` を変える

### 遊び方

タイトルで「スタート」→ PC で「スマホで とる」→ スマホで動物を選んで「とる!」→ PC で「がったい!」→ スマホで名前を選ぶ → 「たたかう!」でバトル。
操作は ← / Enter・Space / → の3つのキー(会場の3つのボタンと同じ)。

---

## 5. 本当の API で動かす

`DRY_RUN=false` に戻して起動すれば、本物の絵が作られます。

- **1回 約4円**(ほぼ全額が画像生成)。撮り直しになったときは約0.03円
- 1回ごとの料金の試算は、開発者メニューと `generator/outputs/<日時>/result.json` に出る。累計は `outputs/api_usage_log.jsonl`
- 何度も試すときは、`IMAGE_QUALITY=low` で安くするか、作ったモンスターを開発者メニューの「作ったモンスターで戦う」から使い回す

---

## 6. バトル(`battle/`)を変えるとき

```powershell
cd battle
npm.cmd install          # 最初の1回
npm.cmd run dev          # バトルだけを単体で開発(サーバー・API 不要)
npm.cmd test
npm.cmd run build        # ../generator/static/battle/ に出力
```

- 変えたら**必ずビルドして、`generator/static/battle/` もコミットする**(会場の PC では Node を使わないため)
- PowerShell では `npm` ではなく `npm.cmd` と打つ(スクリプトの実行が止められていることがあるため)

---

## 7. 取り込んだあとの更新

```powershell
git pull
cd generator
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt   # requirements が変わったときだけ
```

`.env` は Git に入らないので、`git pull` しても消えません。`.env.example` に新しい項目が増えたときは、自分の `.env` にも書き足します(書かなければ既定の値で動きます)。

---

## チェックリスト

- [ ] `git clone` した
- [ ] `generator/.venv` を作り、`requirements-dev.txt` を入れた
- [ ] `generator/.env` を作り、`OPENAI_API_KEY`・`TEXT_MODEL`・`IMAGE_MODEL` を書いた
- [ ] `pytest` が通った
- [ ] `DRY_RUN=true` で、スマホからつながって通しで遊べた
- [ ] `DRY_RUN=false` で、本物の絵が1回できた
