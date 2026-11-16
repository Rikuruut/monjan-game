import { gsap, prefersReducedMotion } from './gsap';

// 画面の揺れ(game-feel の trauma の考え方)。
// できごとが trauma(0〜1)を足し、trauma は 時間で一定の速さで減る。実際の揺れの大きさは trauma²
// → 小さな当たりは ほとんど動かず、大きな当たりは ぐっと揺れる。かならず ひとりでに止まる。
// 揺れの向きは 毎フレームの乱数ではなく、速さのちがう sin を重ねて なめらかにする(乱数だと ざらざらに見える)。
// 減り方は 実際の時間(performance.now)で数える:ヒットストップで止めているあいだも 揺れは弱まっていく

export interface ShakeOptions {
  /** いちばん強いときの横・縦のずれ(px)と傾き(度) */
  maxX?: number;
  maxY?: number;
  maxRotation?: number;
  /** 1秒に減る trauma */
  decay?: number;
}

export interface Shaker {
  /** trauma を足す(1 で頭打ち) */
  add(trauma: number): void;
  /** すぐ止めて、もとの位置にもどす */
  stop(): void;
}

// 速さのちがう sin を2つ重ねた、なめらかな -1〜1
function wave(seed: number, t: number, fast: number, slow: number): number {
  return 0.6 * Math.sin(t * fast + seed) + 0.4 * Math.sin(t * slow + seed * 2.3);
}

export function createShaker(targets: Element[], options: ShakeOptions = {}): Shaker {
  const { maxX = 26, maxY = 16, maxRotation = 1.2, decay = 1.6 } = options;
  // 「動きを減らす」のときは 3割の強さ
  const strength = prefersReducedMotion() ? 0.3 : 1;
  const setX = gsap.quickSetter(targets, 'x', 'px');
  const setY = gsap.quickSetter(targets, 'y', 'px');
  const setRotation = gsap.quickSetter(targets, 'rotation', 'deg');
  const seed = Math.random() * 100;
  let trauma = 0;
  let time = 0;
  let last = 0;
  let running = false;

  const rest = () => {
    setX(0);
    setY(0);
    setRotation(0);
  };
  const tick = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    time += dt;
    trauma = Math.max(0, trauma - decay * dt);
    const amount = trauma * trauma * strength;
    setX(maxX * amount * wave(seed, time, 47, 73));
    setY(maxY * amount * wave(seed + 17, time, 53, 89));
    setRotation(maxRotation * amount * wave(seed + 41, time, 31, 59));
    if (trauma === 0) stop();
  };
  function stop() {
    trauma = 0;
    if (running) gsap.ticker.remove(tick);
    running = false;
    // 終わりは かならず もとの位置へ(ずれたまま止まらない)
    rest();
  }
  return {
    add(value: number) {
      trauma = Math.min(1, trauma + value);
      if (running || trauma <= 0) return;
      running = true;
      last = performance.now();
      gsap.ticker.add(tick);
    },
    stop,
  };
}
