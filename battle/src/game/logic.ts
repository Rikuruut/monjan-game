import { HANDS, type GameOutcome, type Hand, type RoundResult, type Winner } from '../types';

export type RandomSource = () => number;

const beats: Record<Hand, Hand> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

/** じゃんけんの勝ち負け。同じ手は 'tie'(このあと連打勝負で決める) */
export function decideWinner(playerHand: Hand, cpuHand: Hand): 'player' | 'cpu' | 'tie' {
  if (playerHand === cpuHand) return 'tie';
  return beats[playerHand] === cpuHand ? 'player' : 'cpu';
}

/** あいこの連打勝負で、CPU が押す回数の はば(子供が頑張れば勝てる速さ) */
export const CPU_MASH_MIN = 6;
export const CPU_MASH_MAX = 11;

/** 連打勝負:多く押した方の勝ち。同じ数なら勝者なし(双方1ダメージ) */
export function decideMashDuel(playerPresses: number, cpuPresses: number): Winner {
  if (playerPresses > cpuPresses) return 'player';
  if (cpuPresses > playerPresses) return 'cpu';
  return 'none';
}

/** CPU の連打の回数(CPU_MASH_MIN〜CPU_MASH_MAX) */
export function pickCpuMash(random: RandomSource = Math.random): number {
  return CPU_MASH_MIN + normalizedIndex(random, CPU_MASH_MAX - CPU_MASH_MIN + 1);
}

/** ピンチ:ラウンドが始まったときに自分の♡が1。勝てば必殺技(⚔×2) */
export function isPinch(hp: number): boolean {
  return hp === 1;
}

/**
 * 勝者が決まったあとのダメージと HP。
 * 勝った側は⚔の数だけ(プレイヤーがピンチで勝つと必殺技で ×2)。勝者なしは双方1。
 */
export function resolveRound(input: {
  winner: Winner;
  reason: RoundResult['reason'];
  playerAttack: number;
  cpuAttack: number;
  playerHp: number;
  cpuHp: number;
  pinch?: boolean;
}): RoundResult {
  const special = input.winner === 'player' && Boolean(input.pinch);
  const playerDamage = input.winner === 'cpu' ? input.cpuAttack : input.winner === 'none' ? 1 : 0;
  const cpuDamage = input.winner === 'player'
    ? input.playerAttack * (special ? 2 : 1)
    : input.winner === 'none' ? 1 : 0;

  return {
    winner: input.winner,
    reason: input.reason,
    special,
    playerDamage,
    cpuDamage,
    playerHp: Math.max(0, input.playerHp - playerDamage),
    cpuHp: Math.max(0, input.cpuHp - cpuDamage),
  };
}

export function getGameOutcome(playerHp: number, cpuHp: number): GameOutcome {
  if (playerHp === 0 && cpuHp === 0) return 'draw';
  if (cpuHp === 0) return 'victory';
  if (playerHp === 0) return 'defeat';
  return 'ongoing';
}

function normalizedIndex(random: RandomSource, size: number): number {
  const value = random();
  const safeValue = Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999999) : 0;
  return Math.floor(safeValue * size);
}

export function pickCpuHand(random: RandomSource = Math.random): Hand {
  return HANDS[normalizedIndex(random, HANDS.length)];
}

/** 開発者メニューの「勝ち負けを決める」。normal はふつう(ランダム)。 */
export type ForcedResult = 'normal' | 'win' | 'lose' | 'tie';

/** 決めた結果になる CPU の手。かつ:プレイヤーの手に負ける手 / まける:勝つ手 / あいこ:同じ手(連打勝負になる)。 */
export function cpuHandFor(playerHand: Hand, mode: ForcedResult, random: RandomSource = Math.random): Hand {
  if (mode === 'win') return beats[playerHand];
  if (mode === 'lose') return HANDS.find((hand) => beats[hand] === playerHand) ?? playerHand;
  if (mode === 'tie') return playerHand;
  return pickCpuHand(random);
}
