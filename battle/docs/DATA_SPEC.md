# JSONデータ仕様

## ファイル配置
- `public/data/game-config.json` … 読み込むモンスターと初期の対戦相手を指定。
- `public/data/monsters/*.json` … 1体につき1ファイル。
- `public/monsters/*.png` … JSONの `image` と一致する画像ファイル。

## Monster定義（TypeScript例）
```ts
export type Hand = 'rock' | 'scissors' | 'paper';
export type Star = 1 | 2 | 3;
export interface Monster {
  id: string;
  name: string;
  source: { animal: string; object: string };
  attribute: string;
  attack: 1000 | 2000 | 3000;
  hp: 1000 | 2000 | 3000 | 4000 | 5000;
  description: string;
  image: string;
}
```

## 数値とUIの変換
- 表示ATK = '⚔' × (`attack / 1000`)
- 初期表示HP = '♡' × (`hp / 1000`)
- 現在HP = バトル状態で管理（ハート個数）。JSONの初期HPは上書きしない。
- レア度（★）の制度は2026年11月4日にやめた。JSONに含めない。
- ATKは攻撃が当たったときのダメージ数を表す。属性で倍率をかけない。

## サンプル
一覧は `public/data/game-config.json` の `monsters`。本番では CPU の相手がここからランダムに選ばれる。
- `MON-0001`: ミツキング（ゴリラ＋みつき、⚔1 / ♡1）→ `/monsters/monster_mitsuki.png`（JSON は `monster_bottle_ray.json`）
- `MON-0002`: チョキチョキザウルス（ティラノサウルス＋ハサミ、⚔2 / ♡3）→ `/monsters/monster_saurus.png`（JSON は `monster_punch_eagle.json`）
- `MON-0004`: ドライオン（ライオン＋ドライヤー、⚔1 / ♡2）→ `/monsters/cpu_lion_dryer.png`
- `MON-0005`: サメラソル（サメ＋かさ、⚔3 / ♡2）→ `/monsters/cpu_shark_umbrella.png`
- `MON-0006`: ペンケトル（ペンギン＋やかん、⚔2 / ♡2）→ `/monsters/cpu_penguin_kettle.png`

※ MON-0004〜0006 は 2026年11月5日に API で作った（`generator/tools/make_cpu_monsters.py`）。
※ `MON-0003` ボトルキリギリスは絵がなかったので、2026年11月5日に削除した（依頼者の指示）。

## データ読み込みと安全性
- 起動時にJSONを検証する。欠損や数値範囲外の場合は画面上のエラー表示で停止し、白画面や無限ローディングを避ける。
- 画像が読めない場合はフォールバック表示。
- 将来APIから受け取る場合も同じJSON形式に変換してからゲームへ渡す。
