// バトルの進み方の時間(ミリ秒)。テストも ここから読む
// (2026年11月16日に これまでのじゃんけんバトルと入れかえたので、そちらだけで使っていた時間は外した)

// 連打勝負(あいこで ★も同じ)の時間と、そのあと どちらが勝ったかを見せる時間
export const MASH_DUEL_MS = 2500;
export const MASH_RESULT_MS = 900;
// 攻撃:ためる → 飛ぶ → 当たる を見せる(2026年11月2日 480 → 700ms)
const ATTACK_DISPLAY_MS = 700;
// 必殺技のカットイン / 必殺技の攻撃は、ためを長く見せる
export const SPECIAL_DISPLAY_MS = 1800;
const SPECIAL_ATTACK_MS = 1000;
// カットインで名前をたたきつける音 / 必殺技の命中で2つめの音を鳴らすまで
export const SPECIAL_CUTIN_SLAM_MS = 350;
export const SPECIAL_SECOND_IMPACT_MS = 220;
// 通しの自動プレイ(開発者メニュー):タイトル・リザルト・カードゲットで 中ボタンを押すまで / バトルで ボタンを1つ押す間かく
export const AUTOPLAY_TITLE_MS = 2000;
export const AUTOPLAY_WAIT_MS = 3000;
export const AUTOPLAY_KEY_MS = 700;
// 開発者メニューの「演出を見る」:バトルの画面が出てから 演出を始めるまで(画面が落ち着くのを待つ)
export const CARD_DEV_DEMO_LEAD_MS = 700;

// ---- カードバトル(card/。戦闘システム設計書 8章の長さの目安に合わせる) ----
// じゃんけんの見せ場(ClashStage):大きなカード2枚が すべりこむ → じゃん・けん・ぽん の3拍 → めくって結果(約3.3秒)
// ※ 2026年11月14日:350 / 1000ms では速すぎて わかりにくかったので のばした。そのあと 1拍を 550 → 750ms(ワンテンポ遅く)
export const CARD_CLASH_IN_MS = 300;
// 自分のカードを出す:決定のあと、選んだカードが 裏向きで 手札から場へ飛んで置かれる(相手の ふせる と同じ。見せ場の前の ひと呼吸)
// 飛んで着地するまで 約 0.6 秒、そのあと 置いたカードを 少し見せてから 見せ場へ
// ※ 2026年11月16日:800ms では 着地してすぐ じゃんけんが始まり 速かったので のばした
export const CARD_PLAYER_PLACE_MS = 1400;
export const CARD_JANKEN_BEAT_MS = 750;
export const CARD_REVEAL_MS = 1300;
// 相手のターン:考える(手札がゆれて「カードを えらんでいる…」)→ ふせる(裏向きのカードが 場へ飛んで置かれる)
// ※ 2026年11月14日:1.2秒では速すぎて 何をしているか わからなかったので、2つの段に分けて のばした
export const CARD_CPU_THINK_MS = 1400;
export const CARD_CPU_PLACE_MS = 1000;
export const CARD_CPU_TURN_MS = CARD_CPU_THINK_MS + CARD_CPU_PLACE_MS;
// 自分のターンのはじめに「あなたの ターン!」を出しておく時間
export const CARD_PLAYER_TURN_BANNER_MS = 900;
// ダメージ:数字が飛び出して HP バーが減る
export const CARD_DAMAGE_MS = 1400;
// ドロー:引いたカードを見せる
// ※ 2026年11月16日:山札から引いて 大きく見せてから 手札へ入れる動き(約 1.1 秒)にしたので 800 → 1300ms
export const CARD_DRAW_MS = 1300;
// 合成・スキル(回復・封じ手)を使ったあと、結果を見せる
export const CARD_SKILL_MS = 1200;
// 回復(自分の回復カード・相手の回復):粒・✚・「+○○」・HP が数え上がる のを見せる
export const CARD_HEAL_MS = 1800;
// 回復で HP の数字が 数え上がる時間
export const CARD_HP_COUNT_MS = 800;
// 合体:ペアの2枚が 枠へ寄って 回りながら重なる → できたカードが ポンと出る(設計書8章「合成 約1.5秒」)
export const CARD_MERGE_MS = 1500;
// 合体に気づかせる:新しいペアができたターンの はじめ、枠が はずんで 案内の1行が「がったい できるよ!」になる時間
export const CARD_MERGE_HINT_MS = 2200;
// パック開封:あける(えらばなかったパックが消える → ため → 袋が破れる → カードが せり上がる)・
// 破れる瞬間(音と粒)・5枚が横に広がる・1枚めくる間隔・めくり終わって 押さなくても バトルへ進むまで
// (設計書8章は「選ぶ時間 + 約4秒」。2026年11月16日に 依頼者が「テンポが速い」と言ったので、約1.8倍の 約7秒にした。
//  それまでは あける 1500・破れる 700・広がる 450・めくる 380)
export const CARD_PACK_OPEN_MS = 2600;
export const CARD_PACK_TEAR_MS = 1400;
export const CARD_PACK_SPREAD_MS = 900;
export const CARD_PACK_FLIP_MS = 700;
export const CARD_PACK_READY_AUTO_MS = 6000;
// ドローで必殺技のカードが来たときは、長めに見せる
export const CARD_FINISHER_DRAW_MS = 1400;
// カードバトルの攻撃:勝った側が前へ出て、飛び道具が飛ぶ(main の攻撃と同じ長さ)。必殺技は ためを長く
export const CARD_ATTACK_MS = ATTACK_DISPLAY_MS;
export const CARD_FINISHER_ATTACK_MS = SPECIAL_ATTACK_MS;
