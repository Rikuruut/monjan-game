import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { getAttributeTheme } from '../attributes';
import { MonsterCard } from '../components/MonsterCard';
import { cx } from '../cx';
import { gsap } from '../fx/gsap';
import type { Side } from '../game/engine';
import { CARD_HP_COUNT_MS } from '../timings';
import type { Monster } from '../types';
import type { DamageShown } from './useCardBattle';

/**
 * HP バーと数字。減った分は 少しのあいだ うすい色で残る(cardbattle.css の .cb-hp__ghost が おくれて縮む)。
 * 3割以下は ひんし:数字とバーが 赤く ゆっくり点滅する(0 になったら止める。字は出さない)
 */
/** 回復のとき:表示の数字を 今の値から 1ずつ数え上げる(減るときは すぐ変える) */
function useCountUp(value: number, ms: number): number {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);
  useEffect(() => {
    const from = shownRef.current;
    if (value <= from) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    // はじめ速く、おわり ゆっくり(GSAP の tween で 数を動かし、整数が変わったときだけ描きなおす)
    const counter = { value: from };
    const tween = gsap.to(counter, {
      value,
      duration: ms / 1000,
      ease: 'power3.out',
      onUpdate: () => {
        const next = Math.round(counter.value);
        if (next === shownRef.current) return;
        shownRef.current = next;
        setShown(next);
      },
    });
    return () => { tween.kill(); };
  }, [value, ms]);
  return shown;
}

export function HpBar({ hp, maxHp, healing = false }: { hp: number; maxHp: number; healing?: boolean }) {
  const ratio = maxHp > 0 ? Math.min(1, Math.max(0, hp / maxHp)) : 0;
  const shownHp = useCountUp(hp, CARD_HP_COUNT_MS);
  const level = hp <= 0 ? 'empty' : ratio <= 0.3 ? 'low' : ratio <= 0.5 ? 'mid' : 'high';
  return (
    <span className={`cb-hp cb-hp--${level}${healing ? ' cb-hp--healing' : ''}`} role="img" aria-label={`HP ${hp} / ${maxHp}`}>
      <span className="cb-hp__label" aria-hidden="true">HP</span>
      <span className="cb-hp__bar" aria-hidden="true">
        <span className="cb-hp__ghost" style={{ transform: `scaleX(${ratio})` }} />
        <span className="cb-hp__fill" style={{ transform: `scaleX(${ratio})` }} />
      </span>
      <span className="cb-hp__number" aria-hidden="true"><b>{shownHp}</b>/{maxHp}</span>
    </span>
  );
}

// 回復の ✚ を出す横の位置(カードの幅に対する %。ばらばらに見えるように並べる)
const HEAL_PLUS = [14, 72, 34, 88, 52, 24, 64];

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
  healed = null,
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
  /** 回復したところ:もどった量(足もとから光の輪・✚・粒、「+○○」、HP が数え上がる)。回復していないときは null */
  healed?: number | null;
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
        healed !== null && 'cb-fighter--healed',
        charging && 'cb-fighter--charging',
        defeated && 'cb-fighter--defeated',
      )}
    >
      <div className="monster-tag">
        <span className="side-label">{side === 'player' ? 'あなた' : 'あいて'}</span>
        {charging && <span className="cb-charge-chip">⚡ ためている</span>}
      </div>
      <div className="monster-card-motion">
        {/* 回復:足もとから光の輪が広がり、緑の ✚ が立ちのぼる(cardbattle.css の .cb-heal-fx) */}
        {healed !== null && (
          <div className="cb-heal-fx" aria-hidden="true">
            <i className="cb-heal-fx__ring" />
            <i className="cb-heal-fx__ring cb-heal-fx__ring--late" />
            {HEAL_PLUS.map((x, index) => (
              <b key={x} className="cb-heal-fx__plus" style={{ '--x': `${x}%`, '--i': index } as CSSProperties}>✚</b>
            ))}
          </div>
        )}
        <MonsterCard
          monster={monster}
          imageClassName="monster-image-container--battle"
          // カードの下は2段:HP / こうげき(自分も相手も 同じ並び)
          footer={
            <div className="cb-stats">
              <HpBar hp={hp} maxHp={maxHp} healing={healed !== null} />
              <span className="cb-power" aria-label={`こうげき力 ${attack}`}>
                <span className="cb-power__label" aria-hidden="true">こうげき</span>
                <b className="cb-power__value" aria-hidden="true">{attack}</b>
              </span>
            </div>
          }
        />
      </div>
      {hit && <span className="damage-burst" aria-label={`${hit.amount}ダメージ`}>−{hit.amount}</span>}
      {healed !== null && <span className="cb-heal-burst" aria-label={`${healed}かいふく`}>+{healed}</span>}
    </article>
  );
}
