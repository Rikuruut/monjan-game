import { useEffect, useRef } from 'react';
import { burstAt, chargeAt, createParticleFire, stopParticleFire, type ParticleFire } from '../attackParticles';
import { getAttributeTheme, specialMoveFontSize, specialMoveName, specialMoveParts, type AttributeTheme } from '../attributes';
import { AttackProjectile, ImpactBurst, ParticleLayer } from '../BattleEffects';
import { MonsterImage } from '../components/MonsterCard';
import { Backdrop, Logo } from '../components/Scenery';
import { cx } from '../cx';
import { Deck } from '../Deck';
import { getGameOutcome, isFinishChance } from '../game/logic';
import type { Hand, Monster, RoundResult } from '../types';
import { ChoiceButtons } from './ChoiceButtons';
import { MashDuel } from './MashDuel';
import { MonsterPanel } from './MonsterPanel';
import { DECIDED_PHASES, FINISH_CHANCE_PHASES, INTRO_PHASES, phaseIn, SPECIAL_PHASES, type BattlePhase, type HandWinner, type TutorialMode } from './phases';
import type { BattleData } from './practice';
import { PracticeIntro } from './PracticeIntro';
import { RoundFeedback } from './RoundFeedback';
import { Tutorial } from './Tutorial';

// 最後の一撃のあと、結果の画面へ移るまでに大きく出す ひとこと
const FINAL_BLOW_COPY = {
  victory: 'やったー！',
  defeat: 'まけちゃった…',
  draw: 'あいうち！',
} as const;

// 必殺技の命中で、真ん中のはじけのあと もう1回 当たったところに はじけさせるまで
const SPECIAL_REBURST_MS = 220;

// 必殺技のカットインの名前。撮った物とタイプの言葉を2行に分け、長いほど字を小さくして枠に収める
function SpecialMoveTitle({ monster }: { monster: Monster }) {
  const parts = specialMoveParts(monster);
  return (
    <strong title={specialMoveName(monster)} style={{ fontSize: `${specialMoveFontSize(parts)}px` }}>
      {parts.object && <span className="special-cutin__object">{parts.object}</span>}
      <span className="special-cutin__word">{parts.word}</span>
    </strong>
  );
}

// 必殺技のカットイン(自分のモンスターの絵 + 技の名前)。カードバトル(card/)でも使う
export function SpecialCutin({ monster, theme }: { monster: Monster; theme: AttributeTheme }) {
  return (
    <div className={`special-cutin special-cutin--${theme}`} role="status" aria-live="assertive">
      <span className="special-cutin__lines" aria-hidden="true" />
      <span className="special-cutin__band" aria-hidden="true" />
      <div className="special-cutin__monster" aria-hidden="true">
        <MonsterImage monster={monster} />
      </div>
      <div className="special-cutin__copy">
        <small>ひっさつわざ！</small>
        <SpecialMoveTitle monster={monster} />
        <span>とどめの いちげき！</span>
      </div>
      <span className="special-cutin__flash" aria-hidden="true" />
    </div>
  );
}

// 本番のはじまりの登場シーンで、下の帯に出す ひとこと(相手があらわれる → 自分が出る → VS)
function introCopy(phase: BattlePhase, data: BattleData): string {
  if (phase === 'intro-cpu') return `${data.cpu.name}が あらわれた！`;
  if (phase === 'intro-player') return `いけっ！ ${data.player.name}！`;
  return 'バトル スタート！';
}

function NextRoundNotice({ round }: { round: number }) {
  return (
    <div className="banner-layer" role="status" aria-live="assertive">
      <div className="banner next-round-notice">
        <small>ラウンド {round}</small>
        <strong>次のラウンド！</strong>
      </div>
    </div>
  );
}

// 練習ラウンドの結果で止まっているときの吹き出し(中ボタン「つぎへ」で進む)。
// 手をえらぶ前の説明は PracticeIntro.tsx(時間で進む)。見た目は battle.css の .coach
function PracticeResultCoach() {
  return (
    <aside className="coach coach--result" aria-live="polite">
      <p className="coach-title">かったね！</p>
      <p>かつと <strong>⚔の数だけ</strong> 相手の♡が へるよ！</p>
      <p><strong>相手の♡を ぜんぶなくしたら かち！</strong></p>
      <p className="coach-sub">れんしゅうは これで おしまい！</p>
    </aside>
  );
}

/**
 * タイプの粒(attackParticles.ts):攻撃のはじめに攻撃する側でためて、命中で当たったカードの上にはじける。
 * 粒を描く canvas の ref を返す
 */
function useParticleFx(
  phase: BattlePhase,
  result: RoundResult | null,
  themes: { player: AttributeTheme; cpu: AttributeTheme; attacker: AttributeTheme },
  isFinalBlow: boolean,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fireRef = useRef<ParticleFire | null>(null);
  useEffect(() => {
    if (canvasRef.current) fireRef.current = createParticleFire(canvasRef.current);
    return () => {
      stopParticleFire(fireRef.current);
      fireRef.current = null;
    };
  }, []);
  // テーマと最後の一撃かどうかは、result と同時に変わるので、phase と result が変わったときだけ動かす
  useEffect(() => {
    const fire = fireRef.current;
    if (!fire || !result) return;
    if (phase === 'attack') {
      if (result.winner === 'none') {
        chargeAt(fire, 'player', themes.player);
        chargeAt(fire, 'cpu', themes.cpu);
      } else {
        chargeAt(fire, result.winner, themes.attacker);
        // 必殺技は、ためを2回重ねる
        if (result.special) chargeAt(fire, result.winner, themes.attacker);
      }
    } else if (phase === 'impact') {
      if (result.winner === 'none') {
        burstAt(fire, 'center', themes.player, { power: 1 });
        burstAt(fire, 'center', themes.cpu, { power: 1 });
      } else {
        const at = result.winner === 'player' ? 'cpu' : 'player';
        const damage = result.winner === 'player' ? result.cpuDamage : result.playerDamage;
        const dir = result.winner === 'player' ? 1 : -1;
        if (result.special) {
          // 必殺技:当たったところで最大の粒を2回、真ん中にも はじけさせる
          burstAt(fire, at, themes.attacker, { dir, power: 3, final: true });
          burstAt(fire, 'center', themes.attacker, { power: 3, final: true });
          const timer = window.setTimeout(
            () => burstAt(fireRef.current, at, themes.attacker, { dir, power: 3, final: true }),
            SPECIAL_REBURST_MS,
          );
          return () => window.clearTimeout(timer);
        }
        burstAt(fire, at, themes.attacker, { dir, power: damage, final: isFinalBlow });
      }
    }
  }, [phase, result]);
  return canvasRef;
}

export function BattleScreen({
  data,
  playerHp,
  cpuHp,
  round,
  tutorialMode,
  phase,
  playerHand,
  cpuHand,
  result,
  practice,
  introPage = null,
  onCloseTutorial,
  onOpenRules,
  onEndPractice,
  onSelect,
  handWinner,
  mash,
  cpuMash,
  onMash,
  fxLabel,
}: {
  data: BattleData;
  playerHp: number;
  cpuHp: number;
  round: number;
  tutorialMode: TutorialMode | null;
  phase: BattlePhase;
  playerHand: Hand | null;
  cpuHand: Hand | null;
  result: RoundResult | null;
  practice: boolean;
  // 練習の はじめの説明で見せているページ(null は説明なし。説明中は手を選べない)
  introPage?: number | null;
  onCloseTutorial: () => void;
  onOpenRules: () => void;
  onEndPractice: () => void;
  onSelect: (hand: Hand) => void;
  handWinner: HandWinner | null;
  mash: number;
  cpuMash: number;
  onMash: () => void;
  fxLabel?: string;
}) {
  const tutorialOpen = tutorialMode !== null;
  const inIntro = phaseIn(phase, INTRO_PHASES);
  const introOpen = practice && phase === 'choosing' && introPage !== null;
  // とどめのチャンス(相手の♡が1):手を選んでから攻撃までのあいだ、相手のカードを光らせる
  const finishChance = !practice && isFinishChance(cpuHp) && phaseIn(phase, FINISH_CHANCE_PHASES);
  // 必殺技の攻撃(とどめのチャンスに じゃんけんで勝った):ためを長く、飛び道具も命中も特大にする
  const special = Boolean(result?.special) && phaseIn(phase, SPECIAL_PHASES);
  const playerTheme = getAttributeTheme(data.player.attribute);
  const cpuTheme = getAttributeTheme(data.cpu.attribute);
  const attackerTheme =
    result?.winner === 'player' ? playerTheme : result?.winner === 'cpu' ? cpuTheme : 'neutral';
  const isFinalBlow = Boolean(
    result
    && (result.playerHp === 0 || result.cpuHp === 0)
    && phaseIn(phase, DECIDED_PHASES),
  );
  const outcome = result ? getGameOutcome(result.playerHp, result.cpuHp) : 'ongoing';
  // 画面のゆれは、大きいほうのダメージで強くする(1〜3。必殺技はいちばん強い special)
  const shake = result?.special ? 'special' : result ? Math.min(3, Math.max(result.playerDamage, result.cpuDamage)) : 0;
  const canvasRef = useParticleFx(phase, result, { player: playerTheme, cpu: cpuTheme, attacker: attackerTheme }, isFinalBlow);

  const screenClass = cx(
    'screen',
    'battle-screen',
    `battle-screen--${phase}`,
    tutorialOpen && 'battle-screen--tutorial',
    practice && phase === 'result' && 'battle-screen--practice-result',
    phase === 'attack' && `battle-screen--attack-${attackerTheme}`,
    isFinalBlow && 'battle-screen--final-blow',
    special && 'battle-screen--special',
    special && `battle-screen--special-${playerTheme}`,
  );

  return (
    <main className={screenClass}>
      <Backdrop />
      <div className="battle-topbar">
        <div className="signboard">
          <Logo className="battle-logo" />
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
      <div
        className={cx(
          'battlefield',
          `battlefield--${phase}`,
          phase === 'impact' && `battlefield--shake-${shake}`,
          // 必殺技のカットインの はじめにも 強くゆらす
          phase === 'special' && 'battlefield--shake-special',
        )}
      >
        <MonsterPanel
          monster={data.player}
          hp={playerHp}
          side="player"
          phase={phase}
          result={result}
          isHit={phase === 'impact' && Boolean(result?.playerDamage)}
        />
        <div className={cx('versus', phase === 'intro-vs' && 'versus--intro')} aria-label="バーサス">
          <span>V</span><span>S</span>
        </div>
        <MonsterPanel
          monster={data.cpu}
          hp={cpuHp}
          side="cpu"
          phase={phase}
          result={result}
          isHit={phase === 'impact' && Boolean(result?.cpuDamage)}
          finishChance={finishChance}
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
      {(phase === 'choosing' || phase === 'selected') ? (
        <ChoiceButtons
          disabled={phase !== 'choosing' || tutorialOpen || introOpen}
          selected={playerHand}
          coach={practice && phase === 'choosing' && !introOpen}
          prompt={introOpen ? 'せつめいを よもう！' : undefined}
          onSelect={onSelect}
        />
      ) : handWinner && playerHand && cpuHand ? (
        <RoundFeedback
          handWinner={handWinner}
          result={result}
          phase={phase}
          playerHand={playerHand}
          cpuHand={cpuHand}
        />
      ) : inIntro ? (
        <div className="choice-area choice-area--waiting choice-area--intro" role="status" aria-live="assertive">
          {/* key で phase ごとに出しなおし、文字が1回ずつ はねて出る */}
          <p key={phase} className="choice-prompt intro-copy">{introCopy(phase, data)}</p>
        </div>
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
      {phase === 'intro-cpu' && <div className="intro-flash" aria-hidden="true" />}
      {finishChance && phase === 'choosing' && !tutorialOpen && (
        <p className="finish-notice" role="status">あと1！ じゃんけんで かてば <strong>ひっさつわざ！</strong></p>
      )}
      {(phase === 'mash-duel' || phase === 'mash-result') && (
        <MashDuel phase={phase} playerCount={mash} cpuCount={cpuMash} winner={result?.winner ?? null} onMash={onMash} />
      )}
      {phase === 'special' && <SpecialCutin monster={data.player} theme={playerTheme} />}
      {phase === 'impact' && result?.special && (
        <div className={`special-impact-flash special-impact-flash--${playerTheme}`} aria-hidden="true" />
      )}
      {phase === 'next-round' && <NextRoundNotice round={round} />}
      {phase === 'result' && isFinalBlow && outcome !== 'ongoing' && (
        <div className={`final-banner final-banner--${outcome}`} aria-hidden="true">
          <strong>{FINAL_BLOW_COPY[outcome]}</strong>
        </div>
      )}
      {phase === 'impact' && <div className="hit-flash" aria-hidden="true" />}
      <ParticleLayer ref={canvasRef} />
      {fxLabel && <p className="fx-preview-label" aria-hidden="true">{fxLabel}</p>}
      {introOpen && introPage !== null && <PracticeIntro page={introPage} />}
      {practice && phase === 'result' && (
        <>
          <PracticeResultCoach />
          <Deck knobs={{ center: { label: 'つぎへ', onClick: onEndPractice, call: true } }} />
        </>
      )}
      {tutorialOpen && <Tutorial onClose={onCloseTutorial} />}
    </main>
  );
}
