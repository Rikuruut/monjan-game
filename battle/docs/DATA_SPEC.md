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
- レア度はモンスターの固定能力ではなく毎ラウンド抽選。JSONに含めない。
- ATKは攻撃が当たったときのダメージ数を表す。属性で倍率をかけない。

## サンプル
- `MON-0001`: ボトルマンタ（エイ＋水筒、⚔2 / ♡4）→ `/monsters/monster_bottle_ray.png`
- `MON-0002`: パンチイーグル（ワシ＋穴あけパンチ、⚔3 / ♡5）→ `/monsters/monster_punch_eagle.png`
- `MON-0003`: ボトルキリギリス（キリギリス＋水筒、⚔1 / ♡3）→ `/monsters/monster_bottle_grasshopper.png`

※ 上記の名前・ステータス・説明は開発用に作ったサンプル。実際のAI出力ではない。

## データ読み込みと安全性
- 起動時にJSONを検証する。欠損や数値範囲外の場合は画面上のエラー表示で停止し、白画面や無限ローディングを避ける。
- 画像が読めない場合はフォールバック表示。
- 将来APIから受け取る場合も同じJSON形式に変換してからゲームへ渡す。
