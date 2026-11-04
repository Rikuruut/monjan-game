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
import { burstAt, chargeAt, createParticleFire, type ParticleFire } from './attackParticles';
import { getAttributeTheme, specialMoveName } from './attributes';
import { AttackProjectile, Drift, ImpactBurst, ParticleLayer } from './BattleEffects';
import { loadGameData, type GameData } from './data/loadGameData';
import { Deck } from './Deck';
import { DevMenu, type DevJump, type FxDirection } from './DevMenu';
import { readAutoplay, writeAutoplay, type Autoplay } from './devTools';
import {
  applyPlayerBonus,
  cpuHandFor,
  getGameOutcome,
  isPinch,
  MASH_FULL,
  mashBonus,
  pickCpuHand,
  resolveRound,
  shuffleStars,
  withStarAt,
  type ForcedResult,
} from './game/logic';
import {
  assetUrl,
  BASE_URL,
  GENERATOR_URL,
  navigateTo,
  readLaunch,
  usePadButtons,
  type Launch,
  type PadButton,
} from './integration';
import { Stage } from './stage';
import { HANDS, type Hand, type Monster, type RoundResult, type StarMap, type Winner } from './types';

type Screen = 'title' | 'battle' | 'practice-clear' | 'victory' | 'defeat' | 'draw' | 'thanks';
// 立て札のルール説明は、「📖 ルール」の見直しだけ。最初は本物のバトル画面で練習ラウンド(practice)をする
type TutorialMode = 'review';
const TITLE_LOGO_PATH = assetUrl('/assets/monjan-title-logo.png');
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
  // プレイヤーが勝ったときだけ:ピンチなら必殺技のカットイン(special)→ 連打(power-up)→ 攻撃
  | 'special'
  | 'power-up'
  | 'attack'
  | 'impact'
  | 'result'
  | 'next-round';

export const SUMMON_DISPLAY_MS = 1200;
// 最後の一撃のときは、この間に 倒れたカードが沈む演出を見せる
export const RESULT_DISPLAY_MS = 2000;
export const NEXT_ROUND_DISPLAY_MS = 700;
export const RARITY_ROLL_MS = 650;
export const SELECTED_DISPLAY_MS = 400;
export const JANKEN_BEAT_MS = 700;
export const REVEAL_DISPLAY_MS = 1000;
export const STAR_SHOWDOWN_MS = 1200;
// 攻撃:ためる → 飛ぶ → 当たる を見せる(2026年11月2日 480 → 700ms)
export const ATTACK_DISPLAY_MS = 700;
// 命中:一瞬止まって(ヒットストップ)から ゆれる(2026年11月2日 420 → 600ms)
export const IMPACT_DISPLAY_MS = 600;
// 必殺技のカットイン(自分の♡が1のときに勝つと、⚔×2)
export const SPECIAL_DISPLAY_MS = 1400;
// 勝ったあとの連打の時間(ゲージが満タンになると +1ダメージ。満タンの回数は logic.ts の MASH_FULL)
export const POWER_UP_MS = 2000;
// 練習の はじまりで、スタートの音のあとに召喚の音を鳴らすまで
const PRACTICE_SUMMON_SOUND_MS = 350;
// あいこの攻撃で、2つめのタイプの音を遅らせる
const TIE_SECOND_SOUND_MS = 60;
// 開発者メニューの「攻撃エフェクトを見る」:バトル画面へ移ってから始めるまで / 「8つ順番に」の間かく
export const FX_PREVIEW_LEAD_MS = 300;
export const FX_PREVIEW_STEP_MS = 1600;
// 通しの自動プレイ(開発者メニュー)で、ボタンを押すまでに待つ時間
export const AUTOPLAY_TITLE_MS = 2000;
export const AUTOPLAY_RULES_MS = 800;
export const AUTOPLAY_HAND_MS = 1000;
export const AUTOPLAY_WAIT_MS = 3000;
export const AUTOPLAY_MASH_MS = 300;

const HAND_META: Record<Hand, { emoji: string; label: string }> = {
  rock: { emoji: '✊', label: 'グー' },
  scissors: { emoji: '✌️', label: 'チョキ' },
  paper: { emoji: '✋', label: 'パー' },
};

// 手のカードの下に出す、会場のボタンの案内(左からグー・チョキ・パー)
const HAND_KEYS: Record<Hand, string> = { rock: '◀', scissors: '●', paper: '▶' };

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
  // 練習ラウンドのおわり(本番とは別の、練習だけで完結する画面)
  practice: {
    eyebrow: 'ルールは ばっちり！',
    title: 'れんしゅう クリア！',
    message: 'つぎは いよいよ ほんばん！ あいては だれかな…？',
  },
} as const;

// 最後の一撃のあと、結果の画面へ移るまでに大きく出す ひとこと
const FINAL_BLOW_COPY = {
  victory: 'やったー！',
  defeat: 'まけちゃった…',
  draw: 'あいうち！',
} as const;

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
  onToggle,
  onBgmVolumeChange,
  onSfxVolumeChange,
}: {
  enabled: boolean;
  bgmVolume: number;
  sfxVolume: number;
  onToggle: () => void;
  onBgmVolumeChange: (value: number) => void;
  onSfxVolumeChange: (value: number) => void;
}) {
  return (
    <div className="sound-controls" aria-label="サウンド設定">
      <button
        className="sound-toggle"
        type="button"
        aria-pressed={enabled}
        aria-label={`サウンドを${enabled ? 'オフ' : 'オン'}にする`}
        onClick={onToggle}
      >
        <span aria-hidden="true">{enabled && (bgmVolume > 0 || sfxVolume > 0) ? '🔊' : '🔇'}</span>
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

/** 撮影・合体の画面の誕生カード(fusion の .card)と同じ作りのカード:名前とタイプの帯・絵 */
function MonsterCard({ monster, className = '', imageClassName = '' }: { monster: Monster; className?: string; imageClassName?: string }) {
  const theme = getAttributeTheme(monster.attribute);
  return (
    <div className={`monster-card ${className}`.trim()}>
      <header className="monster-card__head">
        <h2>{monster.name}</h2>
        <span className={`attribute-badge el-${theme}`}>{monster.attribute}タイプ</span>
      </header>
      <div className={`monster-frame monster-image-container ${imageClassName}`.trim()}>
        <MonsterImage monster={monster} />
      </div>
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
  pinch = false,
}: {
  monster: Monster;
  hp: number;
  side: 'player' | 'cpu';
  phase: BattlePhase;
  result: RoundResult | null;
  isHit: boolean;
  pinch?: boolean;
}) {
  const theme = getAttributeTheme(monster.attribute);
  const damage = side === 'player' ? result?.playerDamage ?? 0 : result?.cpuDamage ?? 0;
  const isAttacking = phase === 'attack' && (result?.winner === side || result?.winner === 'none');
  const isSummoning = phase === 'summon';
  const showDamage = phase === 'impact' && damage > 0;
  // そのラウンドで勝った側は金に光り、負けた側は少し暗くなる
  const roundDecided = result && result.winner !== 'none' && ['attack', 'impact', 'result'].includes(phase);
  const isRoundWinner = Boolean(roundDecided && result?.winner === side);
  const isRoundLoser = Boolean(roundDecided && result?.winner !== side && phase === 'result');
  const isDefeated = hp === 0 && (phase === 'impact' || phase === 'result');

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
        isRoundWinner ? 'monster-panel--round-winner' : '',
        isRoundLoser ? 'monster-panel--round-loser' : '',
        isDefeated ? 'monster-panel--defeated' : '',
        pinch ? 'monster-panel--pinch' : '',
      ].filter(Boolean).join(' ')}
    >
      <div className="monster-tag">
        <span className="side-label">{side === 'player' ? 'あなた' : 'CPU'}</span>
        <Swords count={statCount(monster.attack)} />
      </div>
      <div className="monster-card-motion">
        {isSummoning && (
          <div className="summon-fx" aria-hidden="true">
            <i /><i /><b>✦</b>
          </div>
        )}
        <MonsterCard monster={monster} imageClassName="monster-image-container--battle" />
      </div>
      <div className="monster-hp">
        <span className="monster-hp__label">HP</span>
        <Hearts current={hp} max={statCount(monster.hp)} damage={phase === 'impact' ? damage : 0} />
      </div>
      {showDamage && <span className="damage-burst" aria-label={`${damage}ダメージ`}>−{damage}</span>}
    </article>
  );
}

function NextRoundNotice({ round }: { round: number }) {
  return (
    <div className="banner-layer" role="status" aria-live="assertive">
      <div className="banner next-round-notice">
        <small>ラウンド {round}</small>
        <strong>次のラウンド！</strong>
        <span>あたらしい★になったよ</span>
      </div>
    </div>
  );
}

function RarityNotice() {
  return (
    <div className="banner-layer banner-layer--low" role="status" aria-live="polite">
      <div className="banner banner--small rarity-notice">
        <strong>★ レア度抽選！</strong>
      </div>
    </div>
  );
}

function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const isLastStep = step === 2;
  const next = () => { if (isLastStep) onClose(); else setStep((current) => current + 1); };
  const back = () => setStep((current) => Math.max(0, current - 1));

  // 左「もどる」・中「つぎへ」
  usePadButtons((button) => {
    if (button === 'center') next();
    else if (button === 'left' && step > 0) back();
  });

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-labelledby="tutorial-title">
      <section className="tutorial-card">
        <div className="tutorial-progress" aria-label={`ルール ${step + 1} / 3`}>
          {[0, 1, 2].map((index) => (
            <span key={index} className={index === step ? 'is-current' : index < step ? 'is-done' : ''}>
              {index + 1}
            </span>
          ))}
        </div>

        {step === 0 && (
          <div className="tutorial-page">
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
      </section>

      <Deck
        knobs={{
          left: step > 0 ? { label: 'もどる', onClick: back } : undefined,
          center: {
            label: isLastStep ? 'バトルにもどる' : 'つぎへ',
            onClick: next,
            call: true,
          },
        }}
      />
    </div>
  );
}

// 勝ったあとの連打のゲージ。会場の3つのボタンのどれでも1回(画面を押しても数える)
function PowerUpGauge({ count, onMash }: { count: number; onMash: () => void }) {
  const full = count >= MASH_FULL;
  const ratio = Math.min(1, count / MASH_FULL);
  return (
    <div className={['power-up', full ? 'power-up--full' : ''].filter(Boolean).join(' ')} role="status" aria-live="polite">
      <strong>{full ? 'パワー MAX！ ダメージ +1' : 'ボタンを れんだ！'}</strong>
      <button type="button" className="power-up__gauge" onClick={onMash} aria-label={`れんだ ${count}かい`}>
        <span className="power-up__fill" style={{ width: `${ratio * 100}%` }} />
      </button>
      <span className="power-up__keys" aria-hidden="true">◀ ● ▶</span>
    </div>
  );
}

// 練習ラウンドの吹き出し。手をえらぶ前(choose)と、結果で止まっているとき(result)。見た目は battle.css の .coach
function PracticeCoach({ step }: { step: 'choose' | 'result' }) {
  return (
    <aside className={`coach coach--${step}`} aria-live="polite">
      {step === 'choose' ? (
        <>
          <p className="coach-title">れんしゅうだよ！</p>
          <p>グー・チョキ・パーから <strong>1つ えらぼう！</strong></p>
          <p className="coach-sub">◀ ● ▶ の ボタンでも えらべるよ</p>
          <p className="coach-stars"><strong>★</strong> は つよさ。同じ手のときは <strong>★が多い方の かち！</strong></p>
        </>
      ) : (
        <>
          <p className="coach-title">かったね！</p>
          <p>かつと <strong>⚔の数だけ</strong> 相手の♡が へるよ！</p>
          <p>かったら <strong>ボタンを れんだ！</strong> 満タンで ダメージ +1</p>
          <p><strong>相手の♡を ぜんぶなくしたら かち！</strong></p>
          <p className="coach-sub">れんしゅうは これで おしまい！</p>
        </>
      )}
    </aside>
  );
}

// 練習の対戦:相手は練習用の見本(本番の相手は、本番の召喚まで見せない)。
// 相手の♡は 自分の⚔ + 連打の1 より多くする(♡が0になって、勝負が終わらないように)
function practiceData(data: GameData): Pick<GameData, 'player' | 'cpu'> {
  const cpu = data.practiceCpu;
  const hp = Math.min(5000, Math.max(cpu.hp, data.player.attack + 2000)) as Monster['hp'];
  return { player: data.player, cpu: hp === cpu.hp ? cpu : { ...cpu, hp } };
}

function ChoiceButtons({
  stars,
  disabled,
  selected,
  rolling,
  coach = false,
  onSelect,
}: {
  stars: StarMap;
  disabled: boolean;
  selected: Hand | null;
  rolling: boolean;
  coach?: boolean;
  onSelect: (hand: Hand) => void;
}) {
  return (
    <div className={['choice-area', disabled ? 'choice-area--locked' : '', coach ? 'choice-area--coach' : ''].filter(Boolean).join(' ')}>
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
            <span className="hand-label">{HAND_META[hand].label}</span>
            <span className="hand-key" aria-hidden="true">{HAND_KEYS[hand]}</span>
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
  const cpuVisible = ['reveal', 'star-showdown', 'special', 'power-up', 'attack', 'impact', 'result'].includes(phase);
  const sameHand = result.reason === 'star' || result.reason === 'perfect-tie';
  const starShowdown = phase === 'star-showdown';
  // 手のぶつかりで、勝った手を大きく、負けた手を灰色にする(ぽん!のあと、手を見せてから)
  const decided = cpuVisible && (phase !== 'reveal' || !sameHand);
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
  } else if (phase === 'special') {
    phaseMessage = 'ひっさつわざ！';
    phaseSub = 'ピンチで こうげき 2ばい！';
  } else if (phase === 'power-up') {
    phaseMessage = 'れんだ！';
    phaseSub = 'ボタンを たくさん おそう！';
  } else if (phase === 'attack') {
    phaseMessage = result.winner === 'none' ? 'あいこ！' : 'こうげき！';
    phaseSub = result.winner === 'none' ? 'おたがいに ダメージ！' : 'モンスターが とびだした！';
  } else if (phase === 'impact') {
    phaseMessage = 'ドカーン！';
    phaseSub = result.winner === 'none' ? 'おたがいに 1ダメージ！' : 'こうげきが めいちゅう！';
  }

  const handClass = (side: 'player' | 'cpu') => [
    'revealed-hand',
    `revealed-hand--${side}`,
    sameHand ? 'revealed-hand--same-hand' : '',
    starShowdown && result.winner === side ? 'revealed-hand--winner' : '',
    starShowdown && result.winner === 'none' ? 'revealed-hand--perfect-tie' : '',
    decided && result.winner === side ? 'revealed-hand--won' : '',
    decided && result.winner !== side && result.winner !== 'none' ? 'revealed-hand--lost' : '',
    side === 'cpu' && !cpuVisible ? 'revealed-hand--concealed' : '',
  ].filter(Boolean).join(' ');
  // 同じ手のときは、2つの手のあいだに ★ の くらべ(> < =)を出す
  const starCompare = sameHand && ['star-showdown', 'special', 'power-up', 'attack', 'impact', 'result'].includes(phase)
    ? (result.winner === 'player' ? '＞' : result.winner === 'cpu' ? '＜' : '＝')
    : null;

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
      <div className="clash">
        <div className={handClass('player')}>
          <span>あなた</span>
          <b>{HAND_META[playerHand].emoji}</b>
          <em className="star-strength">{'★'.repeat(playerStar)}</em>
        </div>
        {starCompare && <span className="star-compare" aria-hidden="true">{starCompare}</span>}
        <div className={handClass('cpu')}>
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
        {phase === 'reveal' && <span className="clash-spark" aria-hidden="true" />}
      </div>
      <div className="feedback-copy" key={phase}>
        <strong>{phaseMessage}</strong>
        <span>{phaseSub}</span>
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
  round,
  tutorialMode,
  phase,
  playerHand,
  cpuHand,
  result,
  practice,
  onCloseTutorial,
  onOpenRules,
  onEndPractice,
  onSelect,
  mash,
  onMash,
  fxLabel,
}: {
  data: Pick<GameData, 'player' | 'cpu'>;
  playerHp: number;
  cpuHp: number;
  playerStars: StarMap;
  cpuStars: StarMap;
  round: number;
  tutorialMode: TutorialMode | null;
  phase: BattlePhase;
  playerHand: Hand | null;
  cpuHand: Hand | null;
  result: RoundResult | null;
  practice: boolean;
  onCloseTutorial: () => void;
  onOpenRules: () => void;
  onEndPractice: () => void;
  onSelect: (hand: Hand) => void;
  mash: number;
  onMash: () => void;
  fxLabel?: string;
}) {
  const tutorialOpen = tutorialMode !== null;
  // ピンチ(自分の♡が1):手を選ぶあいだと必殺技のあいだ、自分のカードを光らせる
  const pinch = !practice && isPinch(playerHp)
    && ['rarity', 'choosing', 'selected', 'janken-jan', 'janken-ken', 'janken-pon', 'reveal', 'star-showdown', 'special'].includes(phase);
  const playerTheme = getAttributeTheme(data.player.attribute);
  const cpuTheme = getAttributeTheme(data.cpu.attribute);
  const attackerTheme =
    result?.winner === 'player' ? playerTheme : result?.winner === 'cpu' ? cpuTheme : 'neutral';
  const isFinalBlow = Boolean(
    result
    && (result.playerHp === 0 || result.cpuHp === 0)
    && ['attack', 'impact', 'result'].includes(phase),
  );
  const outcome = result ? getGameOutcome(result.playerHp, result.cpuHp) : 'ongoing';
  // 画面のゆれは、大きいほうのダメージで強くする(1〜3)
  const shake = result ? Math.min(3, Math.max(result.playerDamage, result.cpuDamage)) : 0;

  // タイプの粒(attackParticles.ts):攻撃のはじめに攻撃する側でためて、命中で当たったカードの上にはじける
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fireRef = useRef<ParticleFire | null>(null);
  useEffect(() => {
    if (canvasRef.current) fireRef.current = createParticleFire(canvasRef.current);
    return () => {
      fireRef.current?.reset();
      fireRef.current = null;
    };
  }, []);
  useEffect(() => {
    const fire = fireRef.current;
    if (!fire || !result) return;
    if (phase === 'attack') {
      if (result.winner === 'none') {
        chargeAt(fire, 'player', playerTheme);
        chargeAt(fire, 'cpu', cpuTheme);
      } else {
        chargeAt(fire, result.winner, attackerTheme);
      }
    } else if (phase === 'impact') {
      if (result.winner === 'none') {
        burstAt(fire, 'center', playerTheme, { power: 1 });
        burstAt(fire, 'center', cpuTheme, { power: 1 });
      } else {
        const at = result.winner === 'player' ? 'cpu' : 'player';
        const damage = result.winner === 'player' ? result.cpuDamage : result.playerDamage;
        burstAt(fire, at, attackerTheme, { dir: result.winner === 'player' ? 1 : -1, power: damage, final: isFinalBlow });
      }
    }
  }, [phase, result]);

  const screenClass = [
    'screen',
    'battle-screen',
    `battle-screen--${phase}`,
    tutorialOpen ? 'battle-screen--tutorial' : '',
    practice && phase === 'result' ? 'battle-screen--practice-result' : '',
    phase === 'attack' ? `battle-screen--attack-${attackerTheme}` : '',
    isFinalBlow ? 'battle-screen--final-blow' : '',
  ].filter(Boolean).join(' ');

  return (
    <main className={screenClass}>
      <div className="scene-vignette" aria-hidden="true" />
      <Drift />
      <div className="battle-topbar">
        <div className="signboard">
          <img
            className="battle-logo"
            src={TITLE_LOGO_PATH}
            alt="モンじゃん！"
            width={1774}
            height={887}
            draggable={false}
          />
          <span className="signboard__title">じゃんけん バトル</span>
        </div>
        <span className="round-chip">ラウンド <b>{round}</b></span>
        {practice && <span className="practice-chip">れんしゅう</span>}
        <button
          className="rule-button"
          type="button"
          onClick={onOpenRules}
          disabled={phase !== 'choosing' || tutorialOpen || practice}
          aria-label="ルールをもう一度見る"
        >
          <span aria-hidden="true">📖</span> ルール
        </button>
      </div>
      <div className={`battlefield battlefield--${phase} ${phase === 'impact' ? `battlefield--shake-${shake}` : ''}`.trim()}>
        <MonsterPanel
          monster={data.player}
          hp={playerHp}
          side="player"
          phase={phase}
          result={result}
          isHit={phase === 'impact' && Boolean(result?.playerDamage)}
          pinch={pinch}
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
        {phase === 'attack' && result && (
          result.winner === 'none' ? (
            <>
              <AttackProjectile from="player" theme={playerTheme} meet />
              <AttackProjectile from="cpu" theme={cpuTheme} meet />
            </>
          ) : (
            <AttackProjectile from={result.winner} theme={attackerTheme} />
          )
        )}
        {phase === 'impact' && result && (
          result.winner === 'none' ? (
            <>
              <ImpactBurst at="center" theme="neutral" />
              <ImpactBurst at="player" theme={cpuTheme} />
              <ImpactBurst at="cpu" theme={playerTheme} />
            </>
          ) : (
            <ImpactBurst at={result.winner === 'player' ? 'cpu' : 'player'} theme={attackerTheme} />
          )
        )}
      </div>
      {(phase === 'rarity' || phase === 'choosing' || phase === 'selected') ? (
        <ChoiceButtons
          stars={playerStars}
          disabled={phase !== 'choosing' || tutorialOpen}
          selected={playerHand}
          rolling={phase === 'rarity'}
          coach={practice && phase === 'choosing'}
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
            {tutorialOpen ? 'バトルの じゅんびをしよう！' : practice ? 'れんしゅう スタート！' : 'モンスター召喚！'}
          </p>
        </div>
      )}
      {phase === 'summon' && !tutorialOpen && (
        <div className="banner-layer" role="status" aria-live="assertive">
          <div className="banner summon-announcement">
            <strong>{practice ? 'れんしゅう スタート！' : 'モンスター召喚！'}</strong>
          </div>
        </div>
      )}
      {phase === 'rarity' && <RarityNotice />}
      {pinch && phase === 'choosing' && !tutorialOpen && (
        <p className="pinch-notice" role="status">ピンチ！ かてば <strong>ひっさつわざ！</strong></p>
      )}
      {phase === 'special' && (
        <div className="special-cutin" role="status" aria-live="assertive">
          <small>ひっさつわざ！</small>
          <strong>{specialMoveName(data.player)}</strong>
          <span>こうげき 2ばい！</span>
        </div>
      )}
      {phase === 'power-up' && <PowerUpGauge count={mash} onMash={onMash} />}
      {phase === 'next-round' && <NextRoundNotice round={round} />}
      {phase === 'result' && isFinalBlow && outcome !== 'ongoing' && (
        <div className={`final-banner final-banner--${outcome}`} aria-hidden="true">
          <strong>{FINAL_BLOW_COPY[outcome]}</strong>
        </div>
      )}
      {phase === 'impact' && <div className="hit-flash" aria-hidden="true" />}
      <ParticleLayer ref={canvasRef} />
      {fxLabel && <p className="fx-preview-label" aria-hidden="true">{fxLabel}</p>}
      {practice && phase === 'choosing' && <PracticeCoach step="choose" />}
      {practice && phase === 'result' && (
        <>
          <PracticeCoach step="result" />
          <Deck knobs={{ center: { label: 'つぎへ', onClick: onEndPractice, call: true } }} />
        </>
      )}
      {tutorialOpen && <Tutorial onClose={onCloseTutorial} />}
    </main>
  );
}

function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="screen title-screen">
      <div className="scene-vignette" aria-hidden="true" />
      <Drift />
      <section className="title-copy">
        <img
          className="title-logo"
          src={TITLE_LOGO_PATH}
          alt="モンじゃん！ 生き物×モノで、キミだけのモンスター誕生！"
          width={1774}
          height={887}
          draggable={false}
        />
        <p className="title-hint">まんなかの ボタンを おしてね</p>
      </section>
      <Deck knobs={{ center: { label: 'スタート！', onClick: onStart, call: true } }} />
    </main>
  );
}

function ResultScreen({
  kind,
  monster,
  onContinue,
}: {
  kind: 'victory' | 'defeat' | 'draw' | 'practice';
  monster: Monster;
  onContinue: () => void;
}) {
  const copy = RESULT_COPY[kind];
  return (
    <main className={`screen result-screen result-screen--${kind}`}>
      <div className="scene-vignette" aria-hidden="true" />
      <div className="result-rays" aria-hidden="true" />
      <Drift />
      <div className="signboard result-signboard">
        <img
          className="result-brand"
          src={TITLE_LOGO_PATH}
          alt="モンじゃん！"
          width={1774}
          height={887}
          draggable={false}
        />
      </div>
      <section className="result-card">
        <div className="result-card__header">
          <p className="result-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="result-message">{copy.message}</p>
        </div>
        <div className="result-card__visual">
          {kind === 'draw' ? (
            <div className="real-janken">
              <div className="real-janken__hands">
                <span aria-hidden="true">✊</span><span aria-hidden="true">✌️</span><span aria-hidden="true">✋</span>
              </div>
              <p>かいじょうの おとなと<br />じゃんけんしてね！</p>
            </div>
          ) : (
            <MonsterCard monster={monster} className={`result-monster result-monster--${kind}`} />
          )}
        </div>
      </section>
      <Deck knobs={{ center: { label: kind === 'draw' ? 'じゃんけんしたよ！' : kind === 'practice' ? 'ほんばん スタート！' : 'つぎへ', onClick: onContinue, call: true } }} />
    </main>
  );
}

function ThanksScreen({ monster, onTitle }: { monster: Monster; onTitle: () => void }) {
  const theme = getAttributeTheme(monster.attribute);
  return (
    <main className="screen thanks-screen">
      <div className="scene-vignette" aria-hidden="true" />
      <div className="result-rays" aria-hidden="true" />
      <Drift />
      <section className="thanks-card">
        <div className="thanks-card__visual">
          <div className={`acquired-card acquired-card--${theme}`}>
            <MonsterCard monster={monster} className="acquired-card__card" />
            <div className="acquired-card__stats">
              <span><small>こうげき</small><Swords count={statCount(monster.attack)} /></span>
              <span><small>HP</small><Hearts current={statCount(monster.hp)} max={statCount(monster.hp)} /></span>
            </div>
          </div>
        </div>
        <div className="thanks-card__side">
          <p className="acquisition-kicker">✦ SPECIAL MONSTER CARD ✦</p>
          <h1>きみだけのモンスターを<br /><span>ゲット！</span></h1>
          <p className="thanks-message">あそんでくれて ありがとう！<br />スタッフから カードを うけとってね！</p>
        </div>
      </section>
      <Deck knobs={{ center: { label: 'タイトルへ もどる', onClick: onTitle, call: true } }} />
    </main>
  );
}

export function App({ launch = readLaunch() }: { launch?: Launch }) {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>('title');
  const [tutorialMode, setTutorialMode] = useState<TutorialMode | null>(null);
  // 練習ラウンド(最初のスタートのあと、本物のバトル画面で1回だけ。必ず勝つ。♡は本番の前にもどす)
  const [practice, setPractice] = useState(false);
  const [playerHp, setPlayerHp] = useState(0);
  const [cpuHp, setCpuHp] = useState(0);
  const [playerStars, setPlayerStars] = useState<StarMap>(() => shuffleStars());
  const [cpuStars, setCpuStars] = useState<StarMap>(() => shuffleStars());
  const [round, setRound] = useState(1);
  const [playerHand, setPlayerHand] = useState<Hand | null>(null);
  const [cpuHand, setCpuHand] = useState<Hand | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [phase, setPhase] = useState<BattlePhase>('summon');
  // 勝ったあとの連打の回数(数えるのは ref。表示のために state にも入れる)
  const [mash, setMash] = useState(0);
  const mashRef = useRef(0);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bgmVolume, setBgmVolume] = useState(0.55);
  const [sfxVolume, setSfxVolumeState] = useState(0.9);
  const lockRef = useRef(false);
  const soundEnabledRef = useRef(true);
  const timersRef = useRef<Set<number>>(new Set());
  const sequenceRef = useRef(0);
  const tutorialOpen = tutorialMode !== null;
  const autoStartedRef = useRef(false);
  // 開発者メニュー(D キー・⚙)
  const [devOpen, setDevOpen] = useState(false);
  const [forced, setForced] = useState<ForcedResult>('normal');
  const [autoplay, setAutoplayState] = useState<Autoplay>(() => readAutoplay());
  // 「攻撃エフェクトを見る」で流しているタイプ(そのあいだ、見せるモンスターのタイプを置きかえる)
  const [fxPreview, setFxPreview] = useState<{ attribute: string; direction: FxDirection } | null>(null);
  const setAutoplay = (next: Autoplay) => {
    writeAutoplay(next);
    setAutoplayState(next);
  };

  useEffect(() => {
    let alive = true;
    loadGameData(fetch, { photoId: launch.photoId, playerName: launch.playerName })
      .then((loaded) => { if (alive) setData(loaded); })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'データを読み込めませんでした。');
      });
    return () => { alive = false; };
  }, []);

  // 撮影・合体の画面の「たたかう!」から来たときは、タイトルを飛ばしてバトル(ルール説明)から始める
  useEffect(() => {
    if (!data || !launch.skipTitle || autoStartedRef.current) return;
    autoStartedRef.current = true;
    startGame();
  }, [data]);

  // 操作する前に始まったときは、ブラウザが音を止めていることがあるので、最初の操作で音を出せるようにする
  // (展示のキオスクは起動の設定で最初から鳴る)
  useEffect(() => {
    const unlock = () => {
      if (!soundEnabledRef.current) return;
      void unlockGameAudio();
      void startGameBgm();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
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

  // 音を切っていないときだけ効果音を鳴らす
  const playSound = (...args: Parameters<typeof playGameSound>) => {
    if (soundEnabledRef.current) playGameSound(...args);
  };

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

  // HP を満タンにして、ラウンドを 1 から数えなおす(バトルの始まり)
  const fillHp = (loaded: GameData) => {
    setPlayerHp(statCount(loaded.player.hp));
    setCpuHp(statCount(loaded.cpu.hp));
    setRound(1);
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
    playSound('rarity');
    schedule(() => {
      setPhase('choosing');
      lockRef.current = false;
    }, RARITY_ROLL_MS);
  };

  const prepareNextRound = () => {
    setRound((current) => current + 1);
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

  // バトルのはじまり(召喚 → 星の抽選 → 手をえらぶ)。練習も本番も、ここから一から始める
  const beginBattle = (isPractice: boolean) => {
    if (!data) return;
    clearTimers();
    fillHp(data);
    if (isPractice) setCpuHp(statCount(practiceData(data).cpu.hp));
    resetRound();
    setTutorialMode(null);
    setPractice(isPractice);
    setScreen('battle');
    if (soundEnabledRef.current) {
      void unlockGameAudio();
      playGameSound('start');
      void startGameBgm();
    }
    schedule(() => playSound('summon'), PRACTICE_SUMMON_SOUND_MS);
    schedule(startRarityRoll, SUMMON_DISPLAY_MS);
  };

  // 最初のスタート:練習ラウンドから
  const startGame = () => beginBattle(true);

  // 練習のおわり:練習だけで完結する「れんしゅうクリア」の画面へ(本番はそこから一から始める)
  const finishPractice = () => {
    clearTimers();
    setPractice(false);
    setScreen('practice-clear');
    playSound('victory');
  };

  // 「ほんばん スタート!」:本番の相手を召喚するところから
  const startBattle = () => beginBattle(false);

  // タイトルの「スタート!」。展示では撮影・合体の画面へ進む(バトルには「たたかう!」で戻ってくる)
  const pressStart = () => {
    if (!launch.toGenerator) {
      startGame();
      return;
    }
    playSound('start');
    navigateTo(GENERATOR_URL);
  };

  const closeTutorial = () => {
    setTutorialMode(null);
    lockRef.current = false;
  };

  const openRules = () => {
    if (screen !== 'battle' || phase !== 'choosing' || tutorialOpen || practice) return;
    lockRef.current = true;
    setTutorialMode('review');
  };

  // 攻撃の音は、攻撃する側のタイプで鳴らす。あいこは両方から飛ぶので、2つのタイプを少しずらして鳴らす
  const playAttackSound = (winner: Winner, playerAttribute: string, cpuAttribute: string) => {
    if (winner === 'cpu') {
      playSound('attack', { attribute: cpuAttribute });
      return;
    }
    playSound('attack', { attribute: playerAttribute });
    if (winner === 'none') schedule(() => playSound('attack', { attribute: cpuAttribute }), TIE_SECOND_SOUND_MS);
  };

  const chooseHand = (hand: Hand) => {
    if (!data || lockRef.current || tutorialOpen || phase !== 'choosing') return;
    lockRef.current = true;
    const { player: playerMonster, cpu: cpuMonster } = practice ? practiceData(data) : data;
    // 練習は必ず勝つ。開発者メニューで勝ち負けを決めているときは、その結果になる手にする(あいこは星もそろえて完全なあいこ)
    const mode: ForcedResult = practice ? 'win' : forced;
    const chosenCpuHand = mode === 'normal' ? pickCpuHand() : cpuHandFor(hand, mode);
    const roundCpuStars = mode === 'tie' ? withStarAt(cpuStars, chosenCpuHand, playerStars[hand]) : cpuStars;
    if (roundCpuStars !== cpuStars) setCpuStars(roundCpuStars);
    // ピンチ(ラウンドの前に自分の♡が1)で勝つと必殺技。CPU の♡は、連打の分を足すときに使う
    const pinch = !practice && isPinch(playerHp);
    const cpuHpBefore = cpuHp;
    const nextResult = resolveRound({
      playerHand: hand,
      cpuHand: chosenCpuHand,
      playerStar: playerStars[hand],
      cpuStar: roundCpuStars[chosenCpuHand],
      playerAttack: statCount(playerMonster.attack),
      cpuAttack: statCount(cpuMonster.attack),
      playerHp,
      cpuHp,
    });
    setPlayerHand(hand);
    setCpuHand(chosenCpuHand);
    setResult(nextResult);
    setPhase('selected');
    playSound('select');

    const beginAttack = (finalResult: RoundResult) => {
      setPhase('attack');
      playAttackSound(finalResult.winner, playerMonster.attribute, cpuMonster.attribute);

      schedule(() => {
        setPlayerHp(finalResult.playerHp);
        setCpuHp(finalResult.cpuHp);
        setPhase('impact');
        playSound('impact');
        playSound('hp-loss');

        schedule(() => {
          setPhase('result');
          // 練習は ここで止まって、吹き出しを読んでもらう(「つぎへ」で「れんしゅうクリア」の画面へ)
          if (practice) return;
          schedule(() => {
            const outcome = getGameOutcome(finalResult.playerHp, finalResult.cpuHp);
            if (outcome === 'ongoing') {
              prepareNextRound();
            } else {
              playSound(outcome);
              setScreen(outcome);
            }
          }, RESULT_DISPLAY_MS);
        }, IMPACT_DISPLAY_MS);
      }, ATTACK_DISPLAY_MS);
    };

    // 連打:POWER_UP_MS のあいだ数えて、必殺技と連打の分を足した結果で攻撃する
    const beginPowerUp = () => {
      mashRef.current = 0;
      setMash(0);
      setPhase('power-up');
      schedule(() => {
        const finalResult = applyPlayerBonus(nextResult, { pinch, mash: mashBonus(mashRef.current), cpuHpBefore });
        setResult(finalResult);
        beginAttack(finalResult);
      }, POWER_UP_MS);
    };

    // 手を見せたあと:プレイヤーの勝ちなら(ピンチなら必殺技 →)連打、ほかは そのまま攻撃
    const afterReveal = () => {
      if (nextResult.winner !== 'player') {
        beginAttack(nextResult);
      } else if (pinch) {
        setPhase('special');
        playSound('star-showdown');
        schedule(beginPowerUp, SPECIAL_DISPLAY_MS);
      } else {
        beginPowerUp();
      }
    };

    schedule(() => {
      setPhase('janken-jan');
      playSound('janken-jan');

      schedule(() => {
        setPhase('janken-ken');
        playSound('janken-ken');

        schedule(() => {
          setPhase('janken-pon');
          playSound('janken-pon');

          schedule(() => {
            setPhase('reveal');
            playSound('reveal');

            schedule(() => {
              if (nextResult.reason !== 'hand') {
                setPhase('star-showdown');
                playSound(nextResult.reason === 'perfect-tie' ? 'tie' : 'star-showdown');
                schedule(afterReveal, STAR_SHOWDOWN_MS);
              } else {
                afterReveal();
              }
            }, REVEAL_DISPLAY_MS);
          }, JANKEN_BEAT_MS);
        }, JANKEN_BEAT_MS);
      }, JANKEN_BEAT_MS);
    }, SELECTED_DISPLAY_MS);
  };

  // 連打を1回数える(満タンになった瞬間だけ音を変える)
  const pressMash = () => {
    if (phase !== 'power-up') return;
    mashRef.current += 1;
    setMash(mashRef.current);
    playSound(mashRef.current === MASH_FULL ? 'star-showdown' : 'select');
  };

  const returnToTitle = () => {
    // URL の ?photo= を消す(読みこみ直したときに、前の子のモンスターでバトルが始まらないように)
    if (window.location.search) window.history.replaceState(null, '', BASE_URL);
    clearTimers();
    setScreen('title');
    setTutorialMode(null);
    setPractice(false);
    setPlayerHp(0);
    setCpuHp(0);
    resetRound();
  };

  const finishGame = () => {
    playSound('card-get');
    setScreen('thanks');
  };

  // 会場の3つのボタン。手は左からグー・チョキ・パー(画面のボタンの並びと同じ)。
  // 見直しのルール説明のあいだはチュートリアルが受け取る。練習の結果では 中ボタンで「れんしゅうクリア」へ、そこから中ボタンで本番へ
  const pressPad = (button: PadButton) => {
    if (!data) return;
    if (screen === 'title') {
      if (button === 'center') pressStart();
    } else if (screen === 'battle') {
      if (phase === 'power-up') {
        pressMash();
      } else if (practice && phase === 'result') {
        if (button === 'center') finishPractice();
      } else if (!tutorialOpen) {
        chooseHand(HANDS[['left', 'center', 'right'].indexOf(button)]);
      }
    } else if (screen === 'practice-clear') {
      if (button === 'center') startBattle();
    } else if (screen === 'thanks') {
      if (button === 'center') returnToTitle();
    } else if (button === 'center') {
      finishGame();
    }
  };
  usePadButtons(pressPad);

  // 開発者メニュー:D キーで開く・閉じる(会場の3つのボタンでは開かない)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'd' || event.key === 'D') && !event.repeat) setDevOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // 開発者メニューの「画面へとぶ」
  const jumpTo = (target: DevJump) => {
    if (!data) return;
    if (target === 'title') {
      returnToTitle();
      return;
    }
    if (target === 'rules') {
      startGame();
      return;
    }
    clearTimers();
    setTutorialMode(null);
    setPractice(false);
    if (target === 'battle') {
      fillHp(data);
      setScreen('battle');
      startRarityRoll();
      return;
    }
    setScreen(target);
  };

  // 開発者メニューの「攻撃エフェクトを見る」:バトル画面で、選んだタイプの 攻撃 → 命中 だけを流す。
  // 本番と同じ部品(飛び道具・光の輪・粒・音)を使う。HP と勝ち負けは変えない
  const showFx = (attribute: string, direction: FxDirection, isLast: boolean) => {
    if (!data) return;
    const winner: Winner = direction === 'tie' ? 'none' : direction;
    setFxPreview({ attribute, direction });
    setPlayerHand('rock');
    setCpuHand(winner === 'player' ? 'scissors' : winner === 'cpu' ? 'paper' : 'rock');
    setResult({
      winner,
      reason: 'hand',
      playerDamage: winner === 'player' ? 0 : 1,
      cpuDamage: winner === 'cpu' ? 0 : 1,
      playerHp: statCount(data.player.hp),
      cpuHp: statCount(data.cpu.hp),
    });
    setPhase('attack');
    playAttackSound(winner, attribute, attribute);
    schedule(() => {
      setPhase('impact');
      playSound('impact');
      schedule(() => {
        setPhase('choosing');
        setResult(null);
        setPlayerHand(null);
        setCpuHand(null);
        setFxPreview(null);
        if (isLast) lockRef.current = false;
      }, IMPACT_DISPLAY_MS);
    }, ATTACK_DISPLAY_MS);
  };

  const previewFx = (attributes: string[], direction: FxDirection) => {
    if (!data) return;
    clearTimers();
    setDevOpen(false);
    setTutorialMode(null);
    setPractice(false);
    fillHp(data);
    setScreen('battle');
    setPhase('choosing');
    lockRef.current = true;
    attributes.forEach((attribute, index) => {
      schedule(() => showFx(attribute, direction, index === attributes.length - 1), FX_PREVIEW_LEAD_MS + index * FX_PREVIEW_STEP_MS);
    });
  };

  // 通しの自動プレイ:画面ごとに、少し待ってから会場のボタンを押したのと同じことをする。
  // メニューを開いているあいだは止まる(停止ボタンを押せるように)
  useEffect(() => {
    if (!autoplay.on || !data || devOpen) return;
    let action: (() => void) | null = null;
    let delay = AUTOPLAY_WAIT_MS;
    if (screen === 'title') {
      action = pressStart;
      delay = AUTOPLAY_TITLE_MS;
    } else if (screen === 'battle') {
      if (practice && phase === 'result') {
        action = finishPractice;
        delay = AUTOPLAY_RULES_MS;
      } else if (phase === 'power-up') {
        // 連打:満タンになったり ならなかったりする回数を、まとめて押したことにする
        action = () => {
          mashRef.current += Math.floor(Math.random() * MASH_FULL * 1.5);
          setMash(mashRef.current);
        };
        delay = AUTOPLAY_MASH_MS;
      } else if (!tutorialOpen && phase === 'choosing') {
        action = () => chooseHand(HANDS[Math.floor(Math.random() * HANDS.length)]);
        delay = AUTOPLAY_HAND_MS;
      }
    } else if (screen === 'practice-clear') {
      action = startBattle;
      delay = AUTOPLAY_RULES_MS;
    } else if (screen === 'thanks') {
      action = () => {
        setAutoplay({ on: true, loops: autoplay.loops + 1 });
        returnToTitle();
      };
    } else {
      action = finishGame;
    }
    if (!action) return;
    const timer = window.setTimeout(action, delay);
    return () => window.clearTimeout(timer);
  }, [autoplay, data, devOpen, screen, phase, tutorialMode, practice]);

  if (error) {
    return (
      <Stage>
        <main className="screen error-screen" role="alert">
          <div><span aria-hidden="true">⚠️</span><h1>よみこめませんでした</h1><p>{error}</p><p>スタッフに しらせてね。</p></div>
        </main>
      </Stage>
    );
  }
  if (!data) {
    return (
      <Stage>
        <main className="screen loading-screen"><div className="loader" /><p>モンスターを よんでいるよ…</p></main>
      </Stage>
    );
  }

  let content: ReactNode;
  if (screen === 'title') {
    content = <TitleScreen onStart={pressStart} />;
  } else if (screen === 'thanks') {
    content = <ThanksScreen monster={data.player} onTitle={returnToTitle} />;
  } else if (screen === 'practice-clear') {
    content = <ResultScreen kind="practice" monster={data.player} onContinue={startBattle} />;
  } else if (screen !== 'battle') {
    content = <ResultScreen kind={screen} monster={data.player} onContinue={finishGame} />;
  } else {
    // 「攻撃エフェクトを見る」のあいだは、攻撃する側(あいこは両方)のタイプを選んだものにする
    const fxTheme = fxPreview ? getAttributeTheme(fxPreview.attribute) : null;
    const battleData = practice ? practiceData(data) : data;
    const shownData = fxPreview
      ? {
        player: fxPreview.direction === 'cpu' ? battleData.player : { ...battleData.player, attribute: fxPreview.attribute },
        cpu: fxPreview.direction === 'player' ? battleData.cpu : { ...battleData.cpu, attribute: fxPreview.attribute },
      }
      : battleData;
    content = (
      <BattleScreen
        data={shownData}
        fxLabel={fxPreview ? `${fxPreview.attribute}タイプ(${fxTheme})` : undefined}
        playerHp={playerHp}
        cpuHp={cpuHp}
        playerStars={playerStars}
        cpuStars={cpuStars}
        round={round}
        tutorialMode={tutorialMode}
        phase={phase}
        playerHand={playerHand}
        cpuHand={cpuHand}
        result={result}
        practice={practice}
        onCloseTutorial={closeTutorial}
        onOpenRules={openRules}
        onEndPractice={finishPractice}
        onSelect={chooseHand}
        mash={mash}
        onMash={pressMash}
      />
    );
  }

  return (
    <>
      {/* 開発者メニューは舞台の外(窓の右はしに出す) */}
      <Stage>
        {content}
        <SoundControls
          enabled={soundEnabled}
          bgmVolume={bgmVolume}
          sfxVolume={sfxVolume}
          onToggle={toggleSound}
          onBgmVolumeChange={changeBgmVolume}
          onSfxVolumeChange={changeSfxVolume}
        />
      </Stage>
      <DevMenu
        open={devOpen}
        data={data}
        autoplay={autoplay}
        forced={forced}
        onClose={() => setDevOpen(false)}
        onToggle={() => setDevOpen((current) => !current)}
        onJump={jumpTo}
        onForced={setForced}
        onLowHp={(side) => (side === 'player' ? setPlayerHp(1) : setCpuHp(1))}
        onAutoplay={(on) => setAutoplay({ on, loops: 0 })}
        onPreviewFx={previewFx}
      />
    </>
  );
}
