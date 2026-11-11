// バトルの進み方の時間(ミリ秒)。テストは App.tsx から読む(App.tsx が出し直している)

export const SUMMON_DISPLAY_MS = 1200;
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
