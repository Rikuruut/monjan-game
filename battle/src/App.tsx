import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  closeGameAudio,
  playGameSound,
  setSfxMuted,
  setSfxVolume,
  unlockGameAudio,
} from './audio/gameAudio';
import {
  disposeGameBgm,
  pauseGameBgm,
  setGameBgmMuted,
  setGameBgmVolume,
  startGameBgm,
} from './audio/gameBgm';
import { loadGameData, type GameData } from './data/loadGameData';
import { getGameOutcome, pickCpuHand, resolveRound, shuffleStars } from './game/logic';
import { HANDS, type Hand, type Monster, type RoundResult, type StarMap } from './types';

type Screen = 'title' | 'battle' | 'victory' | 'defeat' | 'draw' | 'thanks';
type TutorialMode = 'intro' | 'review';
const TITLE_LOGO_PATH = '/assets/monjan-title-logo.png';
export type BattlePhase =
  | 'summon'
  | 'rarity'
  | 'choosing'
  | 'selected'
  | 'janken-jan'
  | 'janken-ken'
  | 'janken-pon'
  | 'reveal'
  | 'star-showdown'
  | 'attack'
  | 'impact'
  | 'result'
  | 'next-round';

export const SUMMON_DISPLAY_MS = 1200;
export const RESULT_DISPLAY_MS = 2300;
export const NEXT_ROUND_DISPLAY_MS = 700;
export const RARITY_ROLL_MS = 650;
export const SELECTED_DISPLAY_MS = 400;
export const JANKEN_BEAT_MS = 700;
export const REVEAL_DISPLAY_MS = 1000;
export const STAR_SHOWDOWN_MS = 1200;
export const ATTACK_DISPLAY_MS = 480;
export const IMPACT_DISPLAY_MS = 420;

type AttributeTheme = 'fire' | 'water' | 'nature' | 'light' | 'dark' | 'wind' | 'earth' | 'neutral';

const HAND_META: Record<Hand, { emoji: string; label: string }> = {
  rock: { emoji: '✊', label: 'グー' },
  scissors: { emoji: '✌️', label: 'チョキ' },
  paper: { emoji: '✋', label: 'パー' },
};

const RESULT_COPY = {
  victory: {
    eyebrow: 'やったね！',
    title: 'しょうり！',
    message: 'キミとモンスターの ちからで かったよ！',
  },
  defeat: {
    eyebrow: 'ナイスバトル！',
    title: 'おしかった！',
    message: 'さいごまで かっこよく たたかったね！',
  },
  draw: {
    eyebrow: 'まさかの',
    title: '引き分け！',
    message: '最後は本物のじゃんけん！！',
  },
} as const;

function getAttributeTheme(attribute: string): AttributeTheme {
  if (/火|炎|fire/i.test(attribute)) return 'fire';
  if (/水|海|氷|water|ice/i.test(attribute)) return 'water';
  if (/草|木|花|nature|grass/i.test(attribute)) return 'nature';
  if (/光|聖|light/i.test(attribute)) return 'light';
  if (/闇|影|dark/i.test(attribute)) return 'dark';
  if (/風|空|wind/i.test(attribute)) return 'wind';
  if (/土|岩|earth|rock/i.test(attribute)) return 'earth';
  return 'neutral';
}

function FantasyAtmosphere({ variant }: { variant: 'title' | 'battle' | 'thanks' }) {
  return (
    <div className={`fantasy-atmosphere fantasy-atmosphere--${variant}`} aria-hidden="true">
      {Array.from({ length: 9 }, (_, index) => <i key={index} />)}
    </div>
  );
}

function statCount(value: number): number {
  return value / 1000;
}

function Hearts({ current, max, damage = 0 }: { current: number; max: number; damage?: number }) {
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

function Swords({ count }: { count: number }) {
  return (
    <span className="swords" aria-label={`こうげき力 ${count}`}>
      {Array.from({ length: count }, (_, index) => (
        <span key={index} aria-hidden="true">⚔</span>
      ))}
    </span>
  );
}

function SoundControls({
  enabled,
  bgmVolume,
  sfxVolume,
  compact = false,
  onToggle,
  onBgmVolumeChange,
  onSfxVolumeChange,
}: {
  enabled: boolean;
  bgmVolume: number;
  sfxVolume: number;
  compact?: boolean;
  onToggle: () => void;
  onBgmVolumeChange: (value: number) => void;
  onSfxVolumeChange: (value: number) => void;
}) {
  return (
    <div className={`sound-controls ${compact ? 'sound-controls--compact' : ''}`} aria-label="サウンド設定">
      <button
        className="sound-toggle"
        type="button"
        aria-pressed={enabled}
        aria-label={`サウンドを${enabled ? 'オフ' : 'オン'}にする`}
        onClick={onToggle}
      >
        <span aria-hidden="true">{enabled && (bgmVolume > 0 || sfxVolume > 0) ? '🔊' : '🔇'}</span>
        <span className="sound-toggle__label">サウンド {enabled ? 'ON' : 'OFF'}</span>
      </button>
      <div className="sound-mixer">
        <label className="volume-control">
          <span>BGM</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(bgmVolume * 100)}
            aria-label="BGM音量"
            onChange={(event) => onBgmVolumeChange(Number(event.currentTarget.value) / 100)}
          />
        </label>
        <label className="volume-control">
          <span>SE</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(sfxVolume * 100)}
            aria-label="効果音音量"
            onChange={(event) => onSfxVolumeChange(Number(event.currentTarget.value) / 100)}
          />
        </label>
      </div>
    </div>
  );
}

function MonsterImage({ monster }: { monster: Monster }) {
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
      onError={() => setFailed(true)}
      draggable={false}
    />
  );
}

function AttributeEffect({ theme }: { theme: AttributeTheme }) {
  return (
    <div className={`attribute-effect attribute-effect--${theme}`} aria-hidden="true">
      {Array.from({ length: 7 }, (_, index) => <i key={index} />)}
    </div>
  );
}

function MonsterPanel({
  monster,
  hp,
  side,
  phase,
  result,
  isHit,
}: {
  monster: Monster;
  hp: number;
  side: 'player' | 'cpu';
  phase: BattlePhase;
  result: RoundResult | null;
  isHit: boolean;
}) {
  const theme = getAttributeTheme(monster.attribute);
  const damage = side === 'player' ? result?.playerDamage ?? 0 : result?.cpuDamage ?? 0;
  const isAttacking = phase === 'attack' && result?.winner === side;
  const isSummoning = phase === 'summon';
  const showDamage = phase === 'impact' && damage > 0;

  return (
    <article
      data-attribute-theme={theme}
      className={[
        'monster-panel',
        `monster-panel--${side}`,
        `monster-panel--element-${theme}`,
        isHit ? 'monster-panel--hit' : '',
        isAttacking ? 'monster-panel--attacking' : '',
        isSummoning ? 'monster-panel--summoning' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="monster-status">
        <div className="monster-heading">
          <div>
            <span className="side-label">{side === 'player' ? 'あなた' : 'CPU'}</span>
            <h2>{monster.name}</h2>
          </div>
          <span className="attribute-badge">{monster.attribute}タイプ</span>
        </div>
        <div className="stats-row">
          <div className="attack-row">
            <span>ATK</span>
            <Swords count={statCount(monster.attack)} />
          </div>
          <div className="hp-row">
            <span>HP</span>
            <Hearts
              current={hp}
              max={statCount(monster.hp)}
              damage={phase === 'impact' ? damage : 0}
            />
          </div>
        </div>
      </div>
      <div className="monster-stage">
        {isSummoning && (
          <div className="summon-fx" aria-hidden="true">
            <i /><i /><b>✦</b><span>✧</span>
          </div>
        )}
        <div className="monster-card-motion">
          <div className="monster-frame monster-image-container monster-image-container--battle">
            <MonsterImage monster={monster} />
          </div>
          {isAttacking && <AttributeEffect theme={theme} />}
        </div>
        <div className="monster-shadow" aria-hidden="true" />
        <div className="foreground-grass" aria-hidden="true">♧ ♧ ♧</div>
        {showDamage && <span className="damage-burst" aria-label={`${damage}ダメージ`}>−{damage}♥</span>}
      </div>
    </article>
  );
}

function NextRoundNotice() {
  return (
    <div className="next-round-layer" role="status" aria-live="assertive">
      <div className="next-round-notice">
        <span aria-hidden="true">★</span>
        <strong>次のラウンド！</strong>
        <small>あたらしい★になったよ</small>
      </div>
    </div>
  );
}

function RarityNotice() {
  return (
    <div className="rarity-notice" role="status" aria-live="polite">
      <span aria-hidden="true">✦</span>
      <strong>★ レア度抽選！</strong>
      <span aria-hidden="true">✦</span>
    </div>
  );
}

function Tutorial({ onClose, isReview }: { onClose: () => void; isReview: boolean }) {
  const [step, setStep] = useState(0);
  const isLastStep = step === 2;

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <section className="tutorial-card tutorial-card--steps">
        <div className="tutorial-progress" aria-label={`ルール ${step + 1} / 3`}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={index === step ? 'is-current' : index < step ? 'is-done' : ''}>
              {index + 1}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="tutorial-page">
            <span className="tutorial-page__number">①</span>
            <h2 id="tutorial-title">じゃんけんで 勝負！</h2>
            <p>グー・チョキ・パーから<br /><strong>1つ えらぼう！</strong></p>
            <div className="tutorial-example tutorial-rps" aria-label="じゃんけんの勝ち方">
              <div><b aria-hidden="true">✊</b><span>は</span><b aria-hidden="true">✌️</b><strong>に かつ！</strong></div>
              <div><b aria-hidden="true">✌️</b><span>は</span><b aria-hidden="true">✋</b><strong>に かつ！</strong></div>
              <div><b aria-hidden="true">✋</b><span>は</span><b aria-hidden="true">✊</b><strong>に かつ！</strong></div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="tutorial-page">
            <span className="tutorial-page__number">②</span>
            <h2 id="tutorial-title">同じ手なら 星で勝負！</h2>
            <p>同じ手が出たら、<br /><strong>★が多い方の かち！</strong></p>
            <div className="tutorial-example tutorial-stars" aria-label="星の強さは3、2、1の順">
              <strong>★★★</strong><b>＞</b><strong>★★</strong><b>＞</b><strong>★</strong>
            </div>
            <p className="tutorial-note">★も同じなら <strong>あいこ！</strong><br />おたがいの♡が 1つへるよ！</p>
          </div>
        )}

        {step === 2 && (
          <div className="tutorial-page">
            <span className="tutorial-page__number">③</span>
            <h2 id="tutorial-title">相手の ハートをへらそう！</h2>
            <p>じゃんけんに勝つと、<br /><strong>⚔の数だけ 相手の♡がへるよ！</strong></p>
            <div className="tutorial-example tutorial-damage" aria-label="剣2つならハート2つのダメージ">
              <span><b aria-hidden="true">⚔⚔</b><small>こうげき</small></span>
              <strong aria-hidden="true">→</strong>
              <span><b aria-hidden="true">♡♡♡ → ♡</b><small>2ダメージ！</small></span>
            </div>
            <p className="tutorial-note"><strong>相手の♡を ぜんぶなくしたら かち！</strong></p>
          </div>
        )}

        <div className="tutorial-actions">
          {step > 0 && (
            <button className="tutorial-back" type="button" onClick={() => setStep((current) => current - 1)}>
              もどる
            </button>
          )}
          <button
            className="primary-button"
            type="button"
            onClick={() => { if (isLastStep) onClose(); else setStep((current) => current + 1); }}
          >
            {isLastStep ? (isReview ? 'バトルにもどる' : 'バトルスタート！') : 'つぎへ'}
          </button>
        </div>
      </section>
    </div>
  );
}

function ChoiceButtons({
  stars,
  disabled,
  selected,
  rolling,
  onSelect,
}: {
  stars: StarMap;
  disabled: boolean;
  selected: Hand | null;
  rolling: boolean;
  onSelect: (hand: Hand) => void;
}) {
  return (
    <div className="choice-area">
      <p className="choice-prompt">{disabled ? 'しょうぶの けっかは…' : 'どの手にする？'}</p>
      <div className="choice-buttons">
        {HANDS.map((hand) => (
          <button
            key={hand}
            className={[
              'hand-button',
              `hand-button--${hand}`,
              selected === hand ? 'hand-button--selected' : '',
              rolling ? 'hand-button--rolling' : '',
            ].filter(Boolean).join(' ')}
            disabled={disabled}
            onClick={() => onSelect(hand)}
            aria-label={`${HAND_META[hand].label} 星${stars[hand]}`}
          >
            <span className="star-badge" aria-hidden="true">{'★'.repeat(stars[hand])}</span>
            <span className="hand-emoji" aria-hidden="true">{HAND_META[hand].emoji}</span>
            <span>{HAND_META[hand].label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoundFeedback({
  result,
  phase,
  playerHand,
  cpuHand,
  playerStar,
  cpuStar,
}: {
  result: RoundResult;
  phase: BattlePhase;
  playerHand: Hand;
  cpuHand: Hand;
  playerStar: number;
  cpuStar: number;
}) {
  const cpuVisible = ['reveal', 'star-showdown', 'attack', 'impact', 'result'].includes(phase);
  const sameHand = result.reason === 'star' || result.reason === 'perfect-tie';
  const starShowdown = phase === 'star-showdown';
  const message =
    result.winner === 'player'
      ? 'あなたの かち！'
      : result.winner === 'cpu'
        ? 'CPUの かち！'
        : 'あいこ！';
  const sub =
    result.reason === 'star'
      ? '★のかずで しょうぶがついた！'
      : result.reason === 'perfect-tie'
        ? 'おたがいの HPが 1へるよ'
        : 'じゃんけんで しょうぶがついた！';
  let phaseMessage = message;
  let phaseSub = sub;
  if (phase === 'selected') {
    phaseMessage = 'その手で しょうぶ！';
    phaseSub = 'CPUの手は まだひみつ';
  } else if (phase === 'janken-jan') {
    phaseMessage = 'じゃん';
    phaseSub = 'せーのっ！';
  } else if (phase === 'janken-ken') {
    phaseMessage = 'けん';
    phaseSub = 'どっちを だすかな？';
  } else if (phase === 'janken-pon') {
    phaseMessage = 'ぽん！';
    phaseSub = 'CPUの手は…';
  } else if (phase === 'reveal') {
    phaseMessage = 'CPUの手を こうかい！';
    phaseSub = sameHand ? 'おなじ手だ！ ★をくらべよう！' : 'じゃんけんの しょうぶ！';
  } else if (starShowdown) {
    phaseMessage = result.reason === 'perfect-tie' ? 'あいこ！' : '星の強さで勝負！';
    phaseSub = result.reason === 'perfect-tie' ? '手も★も おなじ！' : '★が多い方が かち！';
  } else if (phase === 'attack') {
    phaseMessage = result.winner === 'none' ? 'あいこ！' : 'こうげき！';
    phaseSub = result.winner === 'none' ? 'おたがいに ダメージ！' : 'モンスターが とびだした！';
  } else if (phase === 'impact') {
    phaseMessage = 'ドカーン！';
    phaseSub = result.winner === 'none' ? 'おたがいに 1ダメージ！' : 'こうげきが めいちゅう！';
  }

  const playerHandClass = [
    'revealed-hand',
    'revealed-hand--player',
    sameHand ? 'revealed-hand--same-hand' : '',
    starShowdown && result.winner === 'player' ? 'revealed-hand--winner' : '',
    starShowdown && result.winner === 'none' ? 'revealed-hand--perfect-tie' : '',
  ].filter(Boolean).join(' ');
  const cpuHandClass = [
    'revealed-hand',
    'revealed-hand--cpu',
    sameHand ? 'revealed-hand--same-hand' : '',
    starShowdown && result.winner === 'cpu' ? 'revealed-hand--winner' : '',
    starShowdown && result.winner === 'none' ? 'revealed-hand--perfect-tie' : '',
    !cpuVisible ? 'revealed-hand--concealed' : '',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={[
        'round-feedback',
        `round-feedback--${phase}`,
        `round-feedback--reason-${result.reason}`,
        `round-feedback--winner-${result.winner}`,
      ].join(' ')}
      role="status"
      aria-live="assertive"
    >
      <div className={playerHandClass}>
        <span>あなた</span>
        <b>{HAND_META[playerHand].emoji}</b>
        <em className="star-strength">{'★'.repeat(playerStar)}</em>
      </div>
      <div className="feedback-copy">
        <strong>{phaseMessage}</strong>
        <span>{phaseSub}</span>
      </div>
      <div className={cpuHandClass}>
        <span>CPU</span>
        {cpuVisible ? (
          <>
            <b>{HAND_META[cpuHand].emoji}</b>
            <em className="star-strength">{'★'.repeat(cpuStar)}</em>
          </>
        ) : (
          <>
            <b aria-label="CPUの手はまだひみつ">？</b>
            <em className="star-strength" aria-hidden="true">？？？</em>
          </>
        )}
      </div>
    </div>
  );
}

function BattleScreen({
  data,
  playerHp,
  cpuHp,
  playerStars,
  cpuStars,
  tutorialMode,
  phase,
  playerHand,
  cpuHand,
  result,
  onCloseTutorial,
  onOpenRules,
  onSelect,
}: {
  data: GameData;
  playerHp: number;
  cpuHp: number;
  playerStars: StarMap;
  cpuStars: StarMap;
  tutorialMode: TutorialMode | null;
  phase: BattlePhase;
  playerHand: Hand | null;
  cpuHand: Hand | null;
  result: RoundResult | null;
  onCloseTutorial: () => void;
  onOpenRules: () => void;
  onSelect: (hand: Hand) => void;
}) {
  const tutorialOpen = tutorialMode !== null;
  const attackerTheme =
    result?.winner === 'player'
      ? getAttributeTheme(data.player.attribute)
      : result?.winner === 'cpu'
        ? getAttributeTheme(data.cpu.attribute)
        : 'neutral';
  const isFinalBlow = Boolean(
    result
    && (result.playerHp === 0 || result.cpuHp === 0)
    && ['attack', 'impact', 'result'].includes(phase),
  );
  const screenClass = [
    'screen',
    'battle-screen',
    `battle-screen--${phase}`,
    tutorialOpen ? 'battle-screen--tutorial' : '',
    phase === 'attack' ? `battle-screen--attack-${attackerTheme}` : '',
    isFinalBlow ? 'battle-screen--final-blow' : '',
  ].filter(Boolean).join(' ');

  return (
    <main className={screenClass}>
      <FantasyAtmosphere variant="battle" />
      <div className="battle-ground-glow" aria-hidden="true" />
      <div className="battle-topbar">
        <img
          className="battle-logo"
          src={TITLE_LOGO_PATH}
          alt="モンじゃん！"
          width={1774}
          height={887}
          draggable={false}
        />
        <div className="battle-topbar__actions">
          <button
            className="rule-button"
            type="button"
            onClick={onOpenRules}
            disabled={phase !== 'choosing' || tutorialOpen}
            aria-label="ルールをもう一度見る"
          >
            <span aria-hidden="true">📖</span> ルール
          </button>
          <span className="round-chip"><span aria-hidden="true">🍃</span> じゃんけん バトル</span>
        </div>
      </div>
      <div className={`battlefield battlefield--${phase}`}>
        <div className="field-leaves field-leaves--left" aria-hidden="true" />
        <div className="field-leaves field-leaves--right" aria-hidden="true" />
        <MonsterPanel
          monster={data.player}
          hp={playerHp}
          side="player"
          phase={phase}
          result={result}
          isHit={phase === 'impact' && Boolean(result?.playerDamage)}
        />
        <div className="versus" aria-label="バーサス">
          <span>V</span><span>S</span>
        </div>
        <MonsterPanel
          monster={data.cpu}
          hp={cpuHp}
          side="cpu"
          phase={phase}
          result={result}
          isHit={phase === 'impact' && Boolean(result?.cpuDamage)}
        />
        {phase === 'impact' && (
          <div className="impact-effect" aria-hidden="true">
            <i /><i /><i /><b>✦</b>
          </div>
        )}
      </div>
      {(phase === 'rarity' || phase === 'choosing' || phase === 'selected') ? (
        <ChoiceButtons
          stars={playerStars}
          disabled={phase !== 'choosing' || tutorialOpen}
          selected={playerHand}
          rolling={phase === 'rarity'}
          onSelect={onSelect}
        />
      ) : result && playerHand && cpuHand ? (
        <RoundFeedback
          result={result}
          phase={phase}
          playerHand={playerHand}
          cpuHand={cpuHand}
          playerStar={playerStars[playerHand]}
          cpuStar={cpuStars[cpuHand]}
        />
      ) : (
        <div className="choice-area choice-area--waiting">
          <p className="choice-prompt">
            {tutorialOpen ? 'バトルの じゅんびをしよう！' : 'モンスター召喚！'}
          </p>
        </div>
      )}
      {tutorialOpen && <Tutorial onClose={onCloseTutorial} isReview={tutorialMode === 'review'} />}
      {phase === 'summon' && !tutorialOpen && (
        <div className="summon-announcement" role="status" aria-live="assertive">
          <span aria-hidden="true">✦</span>
          <strong>モンスター召喚！</strong>
          <span aria-hidden="true">✦</span>
        </div>
      )}
      {phase === 'rarity' && <RarityNotice />}
      {phase === 'next-round' && <NextRoundNotice />}
    </main>
  );
}

function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="screen title-screen">
      <FantasyAtmosphere variant="title" />
      <div className="title-cloud title-cloud--one" />
      <div className="title-cloud title-cloud--two" />
      <section className="title-copy">
        <img
          className="title-logo"
          src={TITLE_LOGO_PATH}
          alt="モンじゃん！ 生き物×モノで、キミだけのモンスター誕生！"
          width={1774}
          height={887}
          draggable={false}
        />
        <button className="primary-button start-button" onClick={onStart}>
          <span aria-hidden="true">▶</span> スタート！
        </button>
      </section>
    </main>
  );
}

function ResultScreen({
  kind,
  monster,
  onContinue,
}: {
  kind: 'victory' | 'defeat' | 'draw';
  monster: Monster;
  onContinue: () => void;
}) {
  const copy = RESULT_COPY[kind];
  return (
    <main className={`screen result-screen result-screen--${kind}`}>
      <FantasyAtmosphere variant="thanks" />
      <div className="confetti" aria-hidden="true">✦　●　★　✦　●　★</div>
      <section className="result-card">
        <div className="result-card__header">
          <img
            className="result-brand"
            src={TITLE_LOGO_PATH}
            alt="モンじゃん！"
            width={1774}
            height={887}
            draggable={false}
          />
          <p className="result-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="result-message">{copy.message}</p>
        </div>
        <div className="result-card__visual">
          {kind === 'draw' ? (
            <div className="real-janken">
              <span aria-hidden="true">✊</span><span aria-hidden="true">✌️</span><span aria-hidden="true">✋</span>
              <p>かいじょうの おとなと<br />じゃんけんしてね！</p>
            </div>
          ) : (
            <div className={`result-monster result-monster--${kind} monster-image-container`}>
              <MonsterImage monster={monster} />
            </div>
          )}
        </div>
        <div className="result-card__actions">
          <button className="primary-button" onClick={onContinue}>
            {kind === 'draw' ? 'じゃんけんしたよ！' : 'つぎへ'}
          </button>
        </div>
      </section>
    </main>
  );
}

function ThanksScreen({ monster, onTitle }: { monster: Monster; onTitle: () => void }) {
  const theme = getAttributeTheme(monster.attribute);
  return (
    <main className="screen thanks-screen">
      <FantasyAtmosphere variant="thanks" />
      <section className="thanks-card">
        <div className="thanks-card__header">
          <p className="acquisition-kicker">✦ SPECIAL MONSTER CARD ✦</p>
          <h1>きみだけのモンスターを<br /><span>ゲット！</span></h1>
        </div>
        <div className="thanks-card__visual">
          <div className={`acquired-card acquired-card--${theme}`}>
            <div className="card-get-burst" aria-hidden="true">✦　★　✦　★　✦</div>
            <div className="acquired-card__art monster-image-container">
              <MonsterImage monster={monster} />
            </div>
            <div className="acquired-card__meta">
              <div>
                <small>YOUR MONSTER</small>
                <h2>{monster.name}</h2>
              </div>
              <span>{monster.attribute}タイプ</span>
            </div>
            <div className="acquired-card__stats">
              <span>ATK <Swords count={statCount(monster.attack)} /></span>
              <span>HP <Hearts current={statCount(monster.hp)} max={statCount(monster.hp)} /></span>
            </div>
          </div>
        </div>
        <div className="thanks-card__footer">
          <p className="thanks-message">あそんでくれて ありがとう！<br />スタッフから カードを うけとってね！</p>
          <button className="primary-button" onClick={onTitle}>タイトルへ もどる</button>
        </div>
      </section>
    </main>
  );
}

export function App() {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>('title');
  const [tutorialMode, setTutorialMode] = useState<TutorialMode | null>(null);
  const [playerHp, setPlayerHp] = useState(0);
  const [cpuHp, setCpuHp] = useState(0);
  const [playerStars, setPlayerStars] = useState<StarMap>(() => shuffleStars());
  const [cpuStars, setCpuStars] = useState<StarMap>(() => shuffleStars());
  const [playerHand, setPlayerHand] = useState<Hand | null>(null);
  const [cpuHand, setCpuHand] = useState<Hand | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [phase, setPhase] = useState<BattlePhase>('summon');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bgmVolume, setBgmVolume] = useState(0.55);
  const [sfxVolume, setSfxVolumeState] = useState(0.9);
  const lockRef = useRef(false);
  const soundEnabledRef = useRef(true);
  const timersRef = useRef<Set<number>>(new Set());
  const sequenceRef = useRef(0);
  const tutorialOpen = tutorialMode !== null;

  useEffect(() => {
    let alive = true;
    loadGameData()
      .then((loaded) => { if (alive) setData(loaded); })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'データを読み込めませんでした。');
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!data || !soundEnabledRef.current) return;

    // 可能な環境ではタイトル表示から再生する。自動再生が止められた場合も、
    // スタートボタンやミュート解除のユーザー操作で必ず再試行する。
    void startGameBgm();
  }, [data]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
    closeGameAudio();
    disposeGameBgm();
  }, []);

  const schedule = (callback: () => void, delay: number, sequence = sequenceRef.current) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      if (sequence === sequenceRef.current) callback();
    }, delay);
    timersRef.current.add(timer);
  };

  const clearTimers = () => {
    sequenceRef.current += 1;
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  };

  const resetRound = () => {
    setPlayerHand(null);
    setCpuHand(null);
    setResult(null);
    setPhase('summon');
    lockRef.current = true;
  };

  const startRarityRoll = () => {
    setPlayerStars(shuffleStars());
    setCpuStars(shuffleStars());
    setPlayerHand(null);
    setCpuHand(null);
    setResult(null);
    setPhase('rarity');
    if (soundEnabledRef.current) playGameSound('rarity');
    schedule(() => {
      setPhase('choosing');
      lockRef.current = false;
    }, RARITY_ROLL_MS);
  };

  const prepareNextRound = () => {
    setPhase('next-round');
    schedule(startRarityRoll, NEXT_ROUND_DISPLAY_MS);
  };

  const toggleSound = () => {
    const nextEnabled = !soundEnabledRef.current;
    soundEnabledRef.current = nextEnabled;
    setSoundEnabled(nextEnabled);
    setSfxMuted(!nextEnabled);
    setGameBgmMuted(!nextEnabled);
    if (nextEnabled) {
      playGameSound('toggle');
      void startGameBgm();
    } else {
      pauseGameBgm();
    }
  };

  const changeSfxVolume = (value: number) => {
    setSfxVolumeState(value);
    setSfxVolume(value);
  };

  const changeBgmVolume = (value: number) => {
    setBgmVolume(value);
    setGameBgmVolume(value);
  };

  const startGame = () => {
    if (!data) return;
    clearTimers();
    setPlayerHp(statCount(data.player.hp));
    setCpuHp(statCount(data.cpu.hp));
    resetRound();
    setTutorialMode('intro');
    setScreen('battle');
    if (soundEnabledRef.current) {
      void unlockGameAudio();
      playGameSound('start');
      void startGameBgm();
    }
  };

  const closeTutorial = () => {
    if (tutorialMode === 'review') {
      setTutorialMode(null);
      lockRef.current = false;
      return;
    }

    setTutorialMode(null);
    setPhase('summon');
    lockRef.current = true;
    if (soundEnabledRef.current) playGameSound('summon');
    schedule(startRarityRoll, SUMMON_DISPLAY_MS);
  };

  const openRules = () => {
    if (screen !== 'battle' || phase !== 'choosing' || tutorialOpen) return;
    lockRef.current = true;
    setTutorialMode('review');
  };

  const chooseHand = (hand: Hand) => {
    if (!data || lockRef.current || tutorialOpen || phase !== 'choosing') return;
    lockRef.current = true;
    const chosenCpuHand = pickCpuHand();
    const nextResult = resolveRound({
      playerHand: hand,
      cpuHand: chosenCpuHand,
      playerStar: playerStars[hand],
      cpuStar: cpuStars[chosenCpuHand],
      playerAttack: statCount(data.player.attack),
      cpuAttack: statCount(data.cpu.attack),
      playerHp,
      cpuHp,
    });
    setPlayerHand(hand);
    setCpuHand(chosenCpuHand);
    setResult(nextResult);
    setPhase('selected');
    if (soundEnabledRef.current) playGameSound('select');

    const beginAttack = () => {
      setPhase('attack');
      if (soundEnabledRef.current) {
        const attackAttribute = nextResult.winner === 'player'
          ? data.player.attribute
          : nextResult.winner === 'cpu'
            ? data.cpu.attribute
            : undefined;
        playGameSound('attack', attackAttribute ? { attribute: attackAttribute } : {});
      }

      schedule(() => {
        setPlayerHp(nextResult.playerHp);
        setCpuHp(nextResult.cpuHp);
        setPhase('impact');
        if (soundEnabledRef.current) {
          playGameSound('impact');
          playGameSound('hp-loss');
        }

        schedule(() => {
          setPhase('result');
          schedule(() => {
            const outcome = getGameOutcome(nextResult.playerHp, nextResult.cpuHp);
            if (outcome === 'ongoing') {
              prepareNextRound();
            } else {
              if (soundEnabledRef.current) playGameSound(outcome);
              setScreen(outcome);
            }
          }, RESULT_DISPLAY_MS);
        }, IMPACT_DISPLAY_MS);
      }, ATTACK_DISPLAY_MS);
    };

    schedule(() => {
      setPhase('janken-jan');
      if (soundEnabledRef.current) playGameSound('janken-jan');

      schedule(() => {
        setPhase('janken-ken');
        if (soundEnabledRef.current) playGameSound('janken-ken');

        schedule(() => {
          setPhase('janken-pon');
          if (soundEnabledRef.current) playGameSound('janken-pon');

          schedule(() => {
            setPhase('reveal');
            if (soundEnabledRef.current) playGameSound('reveal');

            schedule(() => {
              if (nextResult.reason !== 'hand') {
                setPhase('star-showdown');
                if (soundEnabledRef.current) {
                  playGameSound(nextResult.reason === 'perfect-tie' ? 'tie' : 'star-showdown');
                }
                schedule(beginAttack, STAR_SHOWDOWN_MS);
              } else {
                beginAttack();
              }
            }, REVEAL_DISPLAY_MS);
          }, JANKEN_BEAT_MS);
        }, JANKEN_BEAT_MS);
      }, JANKEN_BEAT_MS);
    }, SELECTED_DISPLAY_MS);
  };

  const returnToTitle = () => {
    clearTimers();
    setScreen('title');
    setTutorialMode(null);
    setPlayerHp(0);
    setCpuHp(0);
    resetRound();
  };

  const finishGame = () => {
    if (soundEnabledRef.current) playGameSound('card-get');
    setScreen('thanks');
  };

  if (error) {
    return (
      <main className="screen error-screen" role="alert">
        <div><span aria-hidden="true">⚠️</span><h1>よみこめませんでした</h1><p>{error}</p><p>スタッフに しらせてね。</p></div>
      </main>
    );
  }
  if (!data) return <main className="screen loading-screen"><div className="loader" /><p>モンスターを よんでいるよ…</p></main>;

  let content: ReactNode;
  if (screen === 'title') {
    content = <TitleScreen onStart={startGame} />;
  } else if (screen === 'thanks') {
    content = <ThanksScreen monster={data.player} onTitle={returnToTitle} />;
  } else if (screen === 'victory') {
    content = <ResultScreen kind="victory" monster={data.player} onContinue={finishGame} />;
  } else if (screen === 'defeat') {
    content = <ResultScreen kind="defeat" monster={data.player} onContinue={finishGame} />;
  } else if (screen === 'draw') {
    content = <ResultScreen kind="draw" monster={data.player} onContinue={finishGame} />;
  } else {
    content = (
      <BattleScreen
        data={data}
        playerHp={playerHp}
        cpuHp={cpuHp}
        playerStars={playerStars}
        cpuStars={cpuStars}
        tutorialMode={tutorialMode}
        phase={phase}
        playerHand={playerHand}
        cpuHand={cpuHand}
        result={result}
        onCloseTutorial={closeTutorial}
        onOpenRules={openRules}
        onSelect={chooseHand}
      />
    );
  }

  return (
    <>
      <SoundControls
        enabled={soundEnabled}
        bgmVolume={bgmVolume}
        sfxVolume={sfxVolume}
        compact={screen === 'victory' || screen === 'defeat' || screen === 'draw' || screen === 'thanks'}
        onToggle={toggleSound}
        onBgmVolumeChange={changeBgmVolume}
        onSfxVolumeChange={changeSfxVolume}
      />
      {content}
    </>
  );
}
