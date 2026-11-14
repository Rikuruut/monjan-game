// バトルの進み方の時間(ミリ秒)。テストは App.tsx から読む(App.tsx が出し直している)

export const SUMMON_DISPLAY_MS = 1200;
// 本番のはじまりの登場シーン(2026年11月11日):相手があらわれる → 自分が出る → VS。練習は SUMMON_DISPLAY_MS の召喚のまま
export const INTRO_CPU_MS = 1000;
export const INTRO_PLAYER_MS = 1000;
export const INTRO_VS_MS = 900;
export const INTRO_TOTAL_MS = INTRO_CPU_MS + INTRO_PLAYER_MS + INTRO_VS_MS;
// 最後の一撃のときは、この間に 倒れたカードが沈む演出を見せる
export const RESULT_DISPLAY_MS = 2000;
export const NEXT_ROUND_DISPLAY_MS = 700;
export const SELECTED_DISPLAY_MS = 400;
export const JANKEN_BEAT_MS = 700;
export const REVEAL_DISPLAY_MS = 1000;
// あいこの連打勝負の時間と、そのあと どちらが勝ったかを見せる時間
export const MASH_DUEL_MS = 2500;
export const MASH_RESULT_MS = 900;
// 攻撃:ためる → 飛ぶ → 当たる を見せる(2026年11月2日 480 → 700ms)
export const ATTACK_DISPLAY_MS = 700;
// 命中:一瞬止まって(ヒットストップ)から ゆれる(2026年11月2日 420 → 600ms)
export const IMPACT_DISPLAY_MS = 600;
// 必殺技のカットイン(相手の♡が1のときに じゃんけんで勝つと出る、とどめの演出)
export const SPECIAL_DISPLAY_MS = 1800;
// 必殺技の攻撃は、ためを長く見せる
export const SPECIAL_ATTACK_MS = 1000;
// カットインで名前をたたきつける音 / 必殺技の命中で2つめの音を鳴らすまで
export const SPECIAL_CUTIN_SLAM_MS = 350;
export const SPECIAL_SECOND_IMPACT_MS = 220;
// 練習の はじまりで、スタートの音のあとに召喚の音を鳴らすまで
export const PRACTICE_SUMMON_SOUND_MS = 350;
// あいこの攻撃で、2つめのタイプの音を遅らせる
export const TIE_SECOND_SOUND_MS = 60;
// 開発者メニューの「攻撃エフェクトを見る」:バトル画面へ移ってから始めるまで / 「8つ順番に」の間かく
export const FX_PREVIEW_LEAD_MS = 300;
export const FX_PREVIEW_STEP_MS = 1600;
// 通しの自動プレイ(開発者メニュー)で、ボタンを押すまでに待つ時間
export const AUTOPLAY_TITLE_MS = 2000;
export const AUTOPLAY_RULES_MS = 800;
export const AUTOPLAY_HAND_MS = 1000;
export const AUTOPLAY_WAIT_MS = 3000;
export const AUTOPLAY_MASH_MS = 300;
// 練習ラウンドの はじめの説明:1ページを見せる時間(時間で次へ進む。2ページ。終わるまで手は選べない)
export const PRACTICE_COACH_PAGE_MS = 6000;

// ---- カードバトル(card/。戦闘システム設計書 8章の長さの目安に合わせる) ----
// じゃんけんの見せ場(ClashStage):大きなカード2枚が すべりこむ → じゃん・けん・ぽん の3拍 → めくって結果(約3.3秒)
// ※ 2026年11月14日:350 / 1000ms では速すぎて わかりにくかったので のばした。そのあと 1拍を 550 → 750ms(ワンテンポ遅く)
export const CARD_CLASH_IN_MS = 300;
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
export const CARD_DRAW_MS = 800;
// 合成・スキル(回復・封じ手)を使ったあと、結果を見せる
export const CARD_SKILL_MS = 1200;
// ドローで必殺技のカードが来たときは、長めに見せる
export const CARD_FINISHER_DRAW_MS = 1400;
// カードバトルの攻撃:勝った側が前へ出て、飛び道具が飛ぶ(main の攻撃と同じ長さ)。必殺技は ためを長く
export const CARD_ATTACK_MS = ATTACK_DISPLAY_MS;
export const CARD_FINISHER_ATTACK_MS = SPECIAL_ATTACK_MS;
