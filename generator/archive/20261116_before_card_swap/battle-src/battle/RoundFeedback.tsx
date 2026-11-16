import { HandIcon } from '../components/HandIcon';
import { cx } from '../cx';
import type { Hand, RoundResult, Winner } from '../types';
import { winnerMessage } from './MashDuel';
import { CPU_VISIBLE_PHASES, MASH_DECIDED_PHASES, phaseIn, type BattlePhase, type HandWinner } from './phases';

// 段階ごとの大きな ひとこと と 小さな説明(勝負がついたあとは、下の message・sub)
const PHASE_COPY: Partial<Record<BattlePhase, [string, string]>> = {
  'janken-jan': ['じゃん', 'せーのっ！'],
  'janken-ken': ['けん', 'どっちを だすかな？'],
  'janken-pon': ['ぽん！', 'CPUの手は…'],
  'mash-duel': ['れんだ！', 'ボタンを たくさん おそう！'],
  special: ['ひっさつわざ！', 'とどめの いちげき！'],
};

// 手を見せる帯。handWinner はじゃんけんだけの勝ち負け(同じ手は tie)。
// result は勝者が決まってから(あいこは連打勝負のあと)。
// 手を選んだところ(selected)までは手のカード(ChoiceButtons)を出すので、ここは じゃん から
export function RoundFeedback({
  handWinner,
  result,
  phase,
  playerHand,
  cpuHand,
}: {
  handWinner: HandWinner;
  result: RoundResult | null;
  phase: BattlePhase;
  playerHand: Hand;
  cpuHand: Hand;
}) {
  const cpuVisible = phaseIn(phase, CPU_VISIBLE_PHASES);
  const sameHand = handWinner === 'tie';
  const winner: Winner | null = result?.winner ?? (sameHand ? null : handWinner);
  // 手のぶつかりで、勝った手を大きく、負けた手を灰色にする(ぽん!のあと。あいこは連打勝負が終わってから)
  const decided = cpuVisible && winner !== null && (!sameHand || phaseIn(phase, MASH_DECIDED_PHASES));

  let [phaseMessage, phaseSub] = PHASE_COPY[phase] ?? [
    winnerMessage(winner, 'あいこ！'),
    sameHand
      ? (winner === 'none' ? 'おたがいの HPが 1へるよ' : 'れんだで しょうぶがついた！')
      : 'じゃんけんで しょうぶがついた！',
  ];
  if (phase === 'reveal') {
    phaseMessage = sameHand ? 'あいこ！' : 'CPUの手を こうかい！';
    phaseSub = sameHand ? 'おなじ手だ！ れんだで しょうぶ！' : 'じゃんけんの しょうぶ！';
  } else if (phase === 'attack') {
    phaseMessage = winner === 'none' ? 'あいこ！' : result?.special ? 'ひっさつわざ！' : 'こうげき！';
    phaseSub = winner === 'none' ? 'おたがいに ダメージ！' : 'モンスターが とびだした！';
  } else if (phase === 'impact') {
    phaseMessage = 'ドカーン！';
    phaseSub = winner === 'none' ? 'おたがいに 1ダメージ！' : 'こうげきが めいちゅう！';
  }

  const handClass = (side: 'player' | 'cpu') => cx(
    'revealed-hand',
    `revealed-hand--${side}`,
    sameHand && 'revealed-hand--same-hand',
    decided && winner === side && 'revealed-hand--won',
    decided && winner !== side && winner !== 'none' && 'revealed-hand--lost',
    side === 'cpu' && !cpuVisible && 'revealed-hand--concealed',
  );

  return (
    <div
      className={cx(
        'round-feedback',
        `round-feedback--${phase}`,
        `round-feedback--reason-${sameHand ? 'mash' : 'hand'}`,
        `round-feedback--winner-${winner ?? 'pending'}`,
      )}
      role="status"
      aria-live="assertive"
    >
      <div className="clash">
        <div className={handClass('player')}>
          <span>あなた</span>
          <b><HandIcon hand={playerHand} /></b>
        </div>
        <div className={handClass('cpu')}>
          <span>CPU</span>
          {cpuVisible ? (
            <b><HandIcon hand={cpuHand} /></b>
          ) : (
            <b aria-label="CPUの手はまだひみつ">？</b>
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
