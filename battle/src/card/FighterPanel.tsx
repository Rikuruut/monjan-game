import { getAttributeTheme } from '../attributes';
import { MonsterCard } from '../components/MonsterCard';
import { cx } from '../cx';
import type { Side } from '../game/engine';
import type { Monster } from '../types';
import type { DamageShown } from './useCardBattle';

/**
 * HP バーと数字。減った分は 少しのあいだ うすい色で残る(cardbattle.css の .cb-hp__ghost が おくれて縮む)。
 * 3割以下は ひんし:数字とバーが 赤く ゆっくり点滅する(0 になったら止める。字は出さない)
 */
export function HpBar({ hp, maxHp }: { hp: number; maxHp: number }) {
  const ratio = maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0;
  const level = hp <= 0 ? 'empty' : ratio <= 0.3 ? 'low' : ratio <= 0.5 ? 'mid' : 'high';
  return (
    <span className={`cb-hp cb-hp--${level}`} role="img" aria-label={`HP ${hp} / ${maxHp}`}>
      <span className="cb-hp__label" aria-hidden="true">HP</span>
      <span className="cb-hp__bar" aria-hidden="true">
        <span className="cb-hp__ghost" style={{ transform: `scaleX(${ratio})` }} />
        <span className="cb-hp__fill" style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span className="cb-hp__number" aria-hidden="true"><b>{hp}</b>/{maxHp}</span>
    </span>
  );
}

/**
 * 左右のモンスター(カード・下の2段:HP / こうげき)。位置は これまでのバトルの .monster-panel と同じ(cardbattle.css で 0.8倍)。
 * 攻撃と命中の動きは main のバトルと同じ class(effects.css の .monster-panel--attacking / --hit。.monster-card-motion が動く)
 */
export function FighterPanel({
  monster,
  side,
  hp,
  maxHp,
  attack,
  damage,
  attacking = false,
  striking = false,
  healed = false,
  charging = false,
  defeated,
}: {
  monster: Monster;
  side: Side;
  hp: number;
  maxHp: number;
  attack: number;
  /** 命中で見せるダメージ(当たった側だけ数字が出る) */
  damage: DamageShown | null;
  /** 攻撃している(前へ出る) */
  attacking?: boolean;
  /** 攻撃して命中するまで:カードのまわりに タイプの色の光 */
  striking?: boolean;
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
        `cb-type-${theme}`,
        striking && 'cb-fighter--striking',
        attacking && 'monster-panel--attacking',
        hit && 'monster-panel--hit',
        healed && 'cb-fighter--healed',
        charging && 'cb-fighter--charging',
        defeated && 'cb-fighter--defeated',
      )}
    >
      <div className="monster-tag">
        <span className="side-label">{side === 'player' ? 'あなた' : 'あいて'}</span>
        {charging && <span className="cb-charge-chip">⚡ ためている</span>}
      </div>
      <div className="monster-card-motion">
        <MonsterCard
          monster={monster}
          imageClassName="monster-image-container--battle"
          // カードの下は2段:HP / こうげき(自分も相手も 同じ並び)
          footer={
            <div className="cb-stats">
              <HpBar hp={hp} maxHp={maxHp} />
              <span className="cb-power" aria-label={`こうげき力 ${attack}`}>
                <span className="cb-power__label" aria-hidden="true">こうげき</span>
                <b className="cb-power__value" aria-hidden="true">{attack}</b>
              </span>
            </div>
          }
        />
      </div>
      {hit && <span className="damage-burst" aria-label={`${hit.amount}ダメージ`}>−{hit.amount}</span>}
    </article>
  );
}
