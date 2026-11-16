import { memo } from 'react';
import { getAttributeTheme } from '../attributes';
import { MonsterCard, Hearts, Swords, statCount } from '../components/MonsterCard';
import { cx } from '../cx';
import type { Monster, RoundResult } from '../types';
import { DECIDED_PHASES, phaseIn, type BattlePhase } from './phases';

// バトルの左右のモンスター(カード・こうげき ⚔・HP ♥)。
// 連打勝負で押すたびの描き直しに付き合わないよう memo にしてある(変わるのは phase・HP・結果だけ)
export const MonsterPanel = memo(function MonsterPanel({
  monster,
  hp,
  side,
  phase,
  result,
  isHit,
  finishChance = false,
}: {
  monster: Monster;
  hp: number;
  side: 'player' | 'cpu';
  phase: BattlePhase;
  result: RoundResult | null;
  isHit: boolean;
  finishChance?: boolean;
}) {
  const theme = getAttributeTheme(monster.attribute);
  const damage = side === 'player' ? result?.playerDamage ?? 0 : result?.cpuDamage ?? 0;
  const isAttacking = phase === 'attack' && (result?.winner === side || result?.winner === 'none');
  const isSummoning = phase === 'summon';
  // 本番の登場シーン:相手が先にすべりこみ、自分はそのあと(相手のあいだは隠しておく)
  const isEntering = side === 'cpu' ? phase === 'intro-cpu' : phase === 'intro-player';
  const isHiddenForIntro = side === 'player' && phase === 'intro-cpu';
  const showDamage = phase === 'impact' && damage > 0;
  // そのラウンドで勝った側は金に光り、負けた側は少し暗くなる
  const roundDecided = result && result.winner !== 'none' && phaseIn(phase, DECIDED_PHASES);
  const isRoundWinner = Boolean(roundDecided && result?.winner === side);
  const isRoundLoser = Boolean(roundDecided && result?.winner !== side && phase === 'result');
  const isDefeated = hp === 0 && (phase === 'impact' || phase === 'result');
  // 攻撃のとき、相手に与えるダメージの数だけ ⚔ を光らせる(⚔ の数だけ ♥ が減ることを見せる)
  const dealt = side === 'player' ? result?.cpuDamage ?? 0 : result?.playerDamage ?? 0;
  const swordGlow = isAttacking ? dealt : 0;

  return (
    <article
      data-attribute-theme={theme}
      className={cx(
        'monster-panel',
        `monster-panel--${side}`,
        `monster-panel--element-${theme}`,
        isHit && 'monster-panel--hit',
        isAttacking && 'monster-panel--attacking',
        isSummoning && 'monster-panel--summoning',
        isEntering && 'monster-panel--intro-enter',
        isHiddenForIntro && 'monster-panel--intro-hidden',
        isRoundWinner && 'monster-panel--round-winner',
        isRoundLoser && 'monster-panel--round-loser',
        isDefeated && 'monster-panel--defeated',
        finishChance && 'monster-panel--finish',
      )}
    >
      <div className="monster-tag">
        <span className="side-label">{side === 'player' ? 'あなた' : 'CPU'}</span>
      </div>
      <div className="monster-card-motion">
        {isSummoning && (
          <div className="summon-fx" aria-hidden="true">
            <i /><i /><b>✦</b>
          </div>
        )}
        {/* カードの下の段に、こうげき ⚔ と HP ♥(カードといっしょに動く) */}
        <MonsterCard
          monster={monster}
          imageClassName="monster-image-container--battle"
          footer={
            <div className="monster-stats">
              <span className="stat stat--attack">
                <span className="stat__label">こうげき</span>
                <Swords count={statCount(monster.attack)} glow={swordGlow} />
              </span>
              <span className="stat__divider" aria-hidden="true" />
              <span className="stat stat--hp">
                <span className="stat__label">HP</span>
                <Hearts current={hp} max={statCount(monster.hp)} damage={phase === 'impact' ? damage : 0} />
              </span>
            </div>
          }
        />
      </div>
      {showDamage && <span className="damage-burst" aria-label={`${damage}ダメージ`}>−{damage}</span>}
    </article>
  );
});
