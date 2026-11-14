import { getAttributeTheme } from '../attributes';
import { MonsterCard } from '../components/MonsterCard';
import { cx } from '../cx';
import type { Side } from '../game/engine';
import type { Monster } from '../types';
import type { DamageShown } from './useCardBattle';

/** HP バーと数字。減った分は 少しのあいだ うすい色で残る(cardbattle.css の .cb-hp__ghost が おくれて縮む) */
export function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const ratio = maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0;
  const level = ratio <= 0.3 ? 'low' : ratio <= 0.5 ? 'mid' : 'high';
  return (
    <span className={`cb-hp cb-hp--${level}`} role="img" aria-label={`HP ${hp} / ${maxHp}`}>
      <span className="cb-hp__bar" aria-hidden="true">
        <span className="cb-hp__ghost" style={{ transform: `scaleX(${ratio})` }} />
        <span className="cb-hp__fill" style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span className="cb-hp__number" aria-hidden="true"><b>{hp}</b> / {maxHp}</span>
    </span>
  );
}

// 左右のモンスター(カード・HP バー・こうげきの数字)。位置は これまでのバトルの .monster-panel と同じ
export function FighterPanel({
  monster,
  side,
  hp,
  maxHp,
  attack,
  damage,
  healed = false,
  charging = false,
  defeated,
}: {
  monster: Monster;
  side: Side;
  hp: number;
  maxHp: number;
  attack: number;
  damage: DamageShown | null;
  /** 回復したところ(足元から緑の光) */
  healed?: boolean;
  /** ため技を ためている(相手。紫のオーラ) */
  charging?: boolean;
  defeated: boolean;
}) {
  const theme = getAttributeTheme(monster.attribute);
  const hit = damage?.target === side ? damage : null;
  return (
    <article
      data-attribute-theme={theme}
      className={cx(
        'monster-panel',
        `monster-panel--${side}`,
        `monster-panel--element-${theme}`,
        'cb-fighter',
        hit && 'cb-fighter--hit',
        healed && 'cb-fighter--healed',
        charging && 'cb-fighter--charging',
        defeated && 'cb-fighter--defeated',
      )}
    >
      <div className="monster-tag">
        <span className="side-label">{side === 'player' ? 'あなた' : 'あいて'}</span>
        {charging && <span className="cb-charge-chip">⚡ ためている</span>}
      </div>
      <MonsterCard
        monster={monster}
        imageClassName="monster-image-container--battle"
        footer={
          <div className="cb-stats">
            <span className="cb-stats__label cb-stats__label--hp">HP</span>
            <HpBar hp={hp} maxHp={maxHp} />
            <span className="cb-stats__label">こうげき</span>
            <b className="cb-stats__attack" aria-label={`こうげき力 ${attack}`}>{attack}</b>
          </div>
        }
      />
      {hit && <span className="damage-burst" aria-label={`${hit.amount}ダメージ`}>−{hit.amount}</span>}
    </article>
  );
}
