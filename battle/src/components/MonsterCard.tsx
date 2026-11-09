import { useState, type ReactNode } from 'react';
import { getAttributeTheme } from '../attributes';
import { cx } from '../cx';
import type { Monster } from '../types';

/** ⚔・♡ の数(JSON では 1000 = 1個) */
export function statCount(value: number): number {
  return value / 1000;
}

export function Hearts({ current, max, damage = 0 }: { current: number; max: number; damage?: number }) {
  return (
    <span className="hearts" aria-label={`HP ${current} / ${max}`}>
      {Array.from({ length: max }, (_, index) => {
        const isLost = damage > 0 && index >= current && index < current + damage;
        const stateClass = index < current ? 'heart--full' : 'heart--empty';
        return (
          <span key={index} className={`heart ${stateClass} ${isLost ? 'heart--lost' : ''}`} aria-hidden="true">
            ♥
          </span>
        );
      })}
    </span>
  );
}

// glow:攻撃のときに光らせる ⚔ の数(相手に与えたダメージと同じ数)
export function Swords({ count, glow = 0 }: { count: number; glow?: number }) {
  return (
    <span className="swords" aria-label={`こうげき力 ${count}`}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} className={`sword ${index < glow ? 'sword--glow' : ''}`} aria-hidden="true">⚔</span>
      ))}
    </span>
  );
}

export function MonsterImage({ monster }: { monster: Monster }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <div className="monster-image monster-image--fallback" role="img" aria-label={monster.name}>？</div>;
  }
  return (
    <img
      className="monster-image"
      src={monster.image}
      alt={monster.name}
      width={1024}
      height={768}
      decoding="async"
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

/** 撮影・合体の画面の誕生カード(fusion の .card)と同じ作りのカード:名前とタイプの帯・絵 */
// footer:絵の下にのせる段(バトルの こうげき ⚔ / HP ♥)。ほかの画面では使わない
export function MonsterCard({
  monster,
  className = '',
  imageClassName = '',
  footer,
}: { monster: Monster; className?: string; imageClassName?: string; footer?: ReactNode }) {
  const theme = getAttributeTheme(monster.attribute);
  return (
    <div className={cx('monster-card', className)}>
      <header className="monster-card__head">
        <h2>{monster.name}</h2>
        <span className={`attribute-badge el-${theme}`}>{monster.attribute}タイプ</span>
      </header>
      <div className={cx('monster-frame monster-image-container', imageClassName)}>
        <MonsterImage monster={monster} />
      </div>
      {footer}
    </div>
  );
}
