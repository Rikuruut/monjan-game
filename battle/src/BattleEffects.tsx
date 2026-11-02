import type { CSSProperties } from 'react';

// 戦闘のエフェクト(見た目は styles/effects.css)。
// 攻撃(attack)で、攻撃した側のカードから相手のカードへタイプごとの飛び道具が飛び、
// 命中(impact)で、当たったカードの上に光の輪とかけらがはじける。あいこは両方から飛んで真ん中でぶつかる

export type AttributeTheme = 'fire' | 'water' | 'nature' | 'light' | 'dark' | 'wind' | 'earth' | 'neutral';
export type Side = 'player' | 'cpu';

// 飛び道具のうしろに続く粒の数(--i で大きさと遅れを変える)
const TRAIL = 6;
// 命中ではじけるかけらの数(--i で向きを変える)
const SHARDS = 10;

function indexed(count: number, className?: string) {
  return Array.from({ length: count }, (_, index) => (
    <i key={index} className={className} style={{ '--i': index } as CSSProperties} />
  ));
}

/** 攻撃の飛び道具。meet は あいこ(両方から飛んで、真ん中でぶつかる) */
export function AttackProjectile({ from, theme, meet = false }: { from: Side; theme: AttributeTheme; meet?: boolean }) {
  return (
    <div
      className={[
        'projectile',
        `projectile--from-${from}`,
        `projectile--${theme}`,
        meet ? 'projectile--meet' : '',
      ].filter(Boolean).join(' ')}
      aria-hidden="true"
    >
      <b className="projectile__core" />
      {indexed(TRAIL, 'projectile__trail')}
    </div>
  );
}

/** 当たったところで はじける光の輪とかけら。at は当たったカードの側(center は あいこの真ん中) */
export function ImpactBurst({ at, theme }: { at: Side | 'center'; theme: AttributeTheme }) {
  return (
    <div className={`impact-effect impact-effect--${at} impact-effect--${theme}`} aria-hidden="true">
      <span className="impact-ring" />
      <span className="impact-ring impact-ring--late" />
      {indexed(SHARDS, 'impact-shard')}
      <b className="impact-star">✦</b>
    </div>
  );
}

/** 舞い落ちる葉と花びら(撮影・合体の画面の .drift と同じ飾り) */
export function Drift() {
  const leaves: { left: number; delay: number; time: number; petal?: boolean }[] = [
    { left: 180, delay: 0, time: 13 },
    { left: 520, delay: -4, time: 15 },
    { left: 820, delay: -9, time: 17, petal: true },
    { left: 1240, delay: -2, time: 14 },
    { left: 1520, delay: -7, time: 16, petal: true },
    { left: 1760, delay: -11, time: 13 },
  ];
  return (
    <div className="drift-layer" aria-hidden="true">
      {leaves.map((leaf) => (
        <span
          key={leaf.left}
          className={leaf.petal ? 'drift petal' : 'drift'}
          style={{ left: leaf.left, '--d': `${leaf.delay}s`, '--t': `${leaf.time}s` } as CSSProperties}
        />
      ))}
    </div>
  );
}
