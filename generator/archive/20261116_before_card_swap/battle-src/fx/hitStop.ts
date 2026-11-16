import { gsap, prefersReducedMotion } from './gsap';

// ヒットストップ(当たった瞬間に 一瞬 絵を止める。game-feel)。
// - CSS の動き:root に .fx-hitstop を付けて animation-play-state: paused(cardbattle.css)
// - GSAP の動き:globalTimeline を止める
// 戻すのは 実際の時間の setTimeout(止めた時間の中で数えると 戻らなくなる)。
// 重なったら(止めているあいだに もう1回)、新しいほうの呼び出しだけが戻す。
// 進行のタイマー(useTimers)は止めない:止めるのは 0.15秒より短く、そのあいだも ボタンの入力は受ける

const CLASS = 'fx-hitstop';
let token = 0;
let frozenRoot: Element | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function release() {
  frozenRoot?.classList.remove(CLASS);
  frozenRoot = null;
  timer = null;
  gsap.globalTimeline.resume();
}

/** root の中の動きを seconds 秒だけ止める(0 なら何もしない) */
export function hitStop(root: Element | null, seconds: number) {
  // 「動きを減らす」のときは 止めない(止まって見える画面は 酔いの もとになる)
  if (!root || seconds <= 0 || prefersReducedMotion()) return;
  const mine = ++token;
  if (timer) clearTimeout(timer);
  if (frozenRoot && frozenRoot !== root) frozenRoot.classList.remove(CLASS);
  frozenRoot = root;
  root.classList.add(CLASS);
  gsap.globalTimeline.pause();
  timer = setTimeout(() => {
    if (mine === token) release();
  }, Math.min(0.15, seconds) * 1000);
}

/** 止めていたら すぐ戻す(画面を閉じるとき) */
export function cancelHitStop() {
  token += 1;
  if (timer) clearTimeout(timer);
  if (frozenRoot || gsap.globalTimeline.paused()) release();
}
