import confetti from 'canvas-confetti';
import type { AttributeTheme } from './attributes';

// 攻撃の粒(canvas-confetti)。CSS の飛び道具・光の輪の上に、重さのある粒をはじけさせる。
// 粒は 1つずつ重力・空気抵抗・回転で動く(CSS ではむずかしいところ)。絵文字も粒にできる(shapeFromText)
// 位置は舞台(1920×1080)の座標。カードの絵の中心は effects.css の冒頭と同じ

export type ParticleFire = confetti.CreateTypes;
export type BurstAt = 'player' | 'cpu' | 'center';

const CENTER_X = { player: 510, cpu: 1410, center: 960 } as const;
const CENTER_Y = 490;
const STAGE = { width: 1920, height: 1080 };
// 表の大きさ・速さに、まとめてかける(1920×1080 の舞台では小さく速く散りすぎたので、大きく・ゆっくりに)
const SIZE = 1.5;
const SPEED = 0.8;

// 1回の発射。emoji は絵文字の粒(shapes のかわり)。count はダメージ1のときの数
type Shot = {
  count: number;
  colors?: string[];
  shapes?: confetti.Shape[];
  emoji?: string[];
  spread?: number;
  velocity: number;
  gravity: number;
  decay?: number;
  drift?: number;
  ticks?: number;
  scalar: number;
  flat?: boolean;
};

// タイプごとの、命中ではじける粒
const IMPACT: Record<AttributeTheme, Shot[]> = {
  // 火:火の粉が上へ舞いあがる
  fire: [
    { count: 70, colors: ['#ffb02e', '#ff6a00', '#e0301e', '#fff1a8'], shapes: ['circle'], velocity: 55, gravity: -0.35, decay: 0.9, ticks: 110, scalar: 1.8 },
    { count: 14, emoji: ['🔥'], velocity: 40, gravity: -0.5, decay: 0.9, ticks: 90, scalar: 4, flat: true },
  ],
  // 水:しぶきが飛んで、下へ落ちる
  water: [
    { count: 80, colors: ['#7fd8ff', '#1a6fd1', '#ffffff', '#b8ecff'], shapes: ['circle'], velocity: 60, gravity: 1.6, ticks: 120, scalar: 1.6 },
    { count: 14, emoji: ['💧'], velocity: 45, gravity: 1.3, ticks: 110, scalar: 3.6, flat: true },
  ],
  // 草:葉と花びらが ひらひら残る
  nature: [
    { count: 26, emoji: ['🍃', '🌸', '🌿'], velocity: 45, gravity: 0.35, decay: 0.92, drift: 0.6, ticks: 200, scalar: 4 },
    { count: 40, colors: ['#8fdc5a', '#F7A8C4', '#3F8F4A', '#fff6d0'], velocity: 50, gravity: 0.4, decay: 0.92, ticks: 180, scalar: 1.8 },
  ],
  // 光:星と雷が大きく広がる
  light: [
    { count: 70, colors: ['#fff6b0', '#ffc928', '#ffffff'], shapes: ['star'], velocity: 70, gravity: 0.5, decay: 0.89, ticks: 100, scalar: 2.6 },
    { count: 12, emoji: ['⚡', '✨'], velocity: 55, gravity: 0.3, decay: 0.9, ticks: 90, scalar: 4.2, flat: true },
  ],
  // 闇:むらさきの玉がゆっくり広がって、早く消える
  dark: [
    { count: 60, colors: ['#b48cff', '#3a1b6e', '#7b4fd8', '#12051f'], shapes: ['circle'], velocity: 35, gravity: 0.1, decay: 0.94, ticks: 80, scalar: 2.4, flat: true },
    { count: 10, emoji: ['🌑', '💜'], velocity: 30, gravity: 0, decay: 0.94, ticks: 70, scalar: 3.6, flat: true },
  ],
  // 風:うずと白緑の粒が、攻撃の向きへ流れる(drift は向きで反転)
  wind: [
    { count: 80, colors: ['#f4fff6', '#3fbf9a', '#7ad9b8', '#c8f5e4'], shapes: ['square', 'circle'], velocity: 55, gravity: 0.2, decay: 0.93, drift: 3, ticks: 140, scalar: 1.6 },
    { count: 16, emoji: ['🌀', '🍃'], velocity: 45, gravity: 0.1, decay: 0.93, drift: 3, ticks: 120, scalar: 3.8 },
  ],
  // 土:岩のかけらが重く落ちる(重すぎると すぐ画面の外へ消えたので 1.8)
  earth: [
    { count: 70, colors: ['#e8cfa4', '#8a6a4a', '#4f3a26', '#c98b3a'], shapes: ['square'], velocity: 65, gravity: 1.8, ticks: 120, scalar: 2.4 },
    { count: 16, emoji: ['🪨'], velocity: 55, gravity: 1.5, ticks: 110, scalar: 4.2 },
  ],
  // 無:金と白の星
  neutral: [
    { count: 60, colors: ['#fff6d0', '#ff9f1c', '#ffffff', '#ffd23f'], shapes: ['star', 'circle'], velocity: 60, gravity: 0.8, decay: 0.9, ticks: 110, scalar: 2.2 },
    { count: 10, emoji: ['⭐'], velocity: 45, gravity: 0.6, ticks: 100, scalar: 3.8, flat: true },
  ],
};

// 絵文字の形は作るのが重いので、1回だけ作って取っておく
const emojiShapes = new Map<string, confetti.Shape>();
function emojiShape(text: string, scalar: number) {
  const key = `${text}:${scalar}`;
  let shape = emojiShapes.get(key);
  if (!shape) {
    shape = confetti.shapeFromText({ text, scalar });
    emojiShapes.set(key, shape);
  }
  return shape;
}

// 発射台ごとの、カードの絵の中心の高さ(カードバトルは カードを小さくしているので ちがう。なければ CENTER_Y)
const centerYs = new WeakMap<ParticleFire, number>();

// yOffset:カードの絵の中心から 下へずらす(回復は 足もとから出す)
function origin(fire: ParticleFire, at: BurstAt, yOffset = 0) {
  return { x: CENTER_X[at] / STAGE.width, y: ((centerYs.get(fire) ?? CENTER_Y) + yOffset) / STAGE.height };
}

// テスト(jsdom)には canvas がないので、粒は出さない
export function canUseParticles() {
  return typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent);
}

/** 粒を描く canvas(1920×1080)を、canvas-confetti の発射台にする。centerY はカードの絵の中心の高さ(省くと main のバトルの位置) */
export function createParticleFire(canvas: HTMLCanvasElement, { centerY }: { centerY?: number } = {}): ParticleFire | null {
  if (!canUseParticles()) return null;
  const fire = confetti.create(canvas, { resize: false, useWorker: false });
  if (centerY !== undefined) centerYs.set(fire, centerY);
  return fire;
}

function fireShot(fire: ParticleFire, shot: Shot, at: BurstAt, dir: number, multiplier: number, yOffset = 0) {
  void fire({
    particleCount: Math.round(shot.count * multiplier),
    origin: origin(fire, at, yOffset),
    spread: shot.spread ?? 360,
    angle: 90,
    startVelocity: shot.velocity * SPEED,
    gravity: shot.gravity,
    decay: shot.decay ?? 0.91,
    drift: (shot.drift ?? 0) * dir,
    ticks: shot.ticks ?? 100,
    scalar: shot.scalar * SIZE,
    flat: shot.flat ?? false,
    colors: shot.colors,
    shapes: shot.emoji ? shot.emoji.map((text) => emojiShape(text, shot.scalar * SIZE)) : shot.shapes,
  });
}

/**
 * 命中:当たったカードの上で、タイプの粒をはじけさせる。
 * dir は攻撃の向き(左から右へ = 1、右から左へ = −1、あいこ = 0)。power はダメージ(1〜3)、final は最後の一撃
 */
export function burstAt(fire: ParticleFire | null, at: BurstAt, theme: AttributeTheme, { dir = 0, power = 1, final = false } = {}) {
  if (!fire) return;
  const multiplier = (0.7 + 0.3 * Math.min(3, Math.max(1, power))) * (final ? 1.6 : 1);
  IMPACT[theme].forEach((shot) => fireShot(fire, shot, at, dir, multiplier));
  // 最後の一撃は、少しおいて もう1回(大きく)
  if (final) {
    later(fire, () => IMPACT[theme].forEach((shot) => fireShot(fire, { ...shot, velocity: shot.velocity * 1.3 }, at, dir, multiplier)), 220);
  }
}

// 少しおいて出す粒の予約(発射台ごと)。stopParticleFire でまとめて取り消す
const pending = new WeakMap<ParticleFire, Set<number>>();

function later(fire: ParticleFire, fn: () => void, ms: number) {
  const timers = pending.get(fire) ?? new Set<number>();
  pending.set(fire, timers);
  const timer = window.setTimeout(() => {
    timers.delete(timer);
    fn();
  }, ms);
  timers.add(timer);
}

/**
 * 粒を止める(バトル画面を閉じたとき)。描いている粒を消し、少しおいて出す予定の粒も取り消す。
 * ※ 2026年11月9日:それまでは予約を取り消せず、画面を離れたあとに、見えない canvas へ粒を出していた
 */
export function stopParticleFire(fire: ParticleFire | null) {
  if (!fire) return;
  pending.get(fire)?.forEach((timer) => window.clearTimeout(timer));
  pending.delete(fire);
  fire.reset();
}

/** 攻撃のはじめ(ためる):攻撃する側のカードのまわりに、小さく粒を出す */
export function chargeAt(fire: ParticleFire | null, at: BurstAt, theme: AttributeTheme) {
  if (!fire) return;
  const [main] = IMPACT[theme];
  fireShot(fire, { ...main, count: 22, velocity: 18, decay: 0.9, ticks: 45, scalar: main.scalar * 0.7 }, at, 0, 1);
}

// 回復の粒:足もとから ふわっと上がる(spread をせまく、重さはマイナス)
const HEAL: Shot[] = [
  { count: 46, colors: ['#a6ec7c', '#6cf08a', '#ffffff', '#d6ffb8'], shapes: ['circle'], spread: 70, velocity: 26, gravity: -0.45, decay: 0.93, ticks: 150, scalar: 1.3 },
  { count: 10, emoji: ['💚', '✨'], spread: 80, velocity: 22, gravity: -0.3, decay: 0.94, ticks: 160, scalar: 3, flat: true },
];
// 回復の粒を出す高さ:カードの絵の中心から 下へ(カードの足もと)
const HEAL_FOOT_Y = 150;

/** 回復:回復した側のカードの足もとから、緑の光の粒と 💚✨ が 上へ立ちのぼる(少しおいて もう1回 小さく) */
export function healAt(fire: ParticleFire | null, at: BurstAt) {
  if (!fire) return;
  HEAL.forEach((shot) => fireShot(fire, shot, at, 0, 1, HEAL_FOOT_Y));
  later(fire, () => HEAL.forEach((shot) => fireShot(fire, shot, at, 0, 0.6, HEAL_FOOT_Y)), 380);
}
