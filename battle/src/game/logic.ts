import { HANDS, type GameOutcome, type Hand, type RoundResult, type Star, type StarMap, type Winner } from '../types';

export type RandomSource = () => number;

const beats: Record<Hand, Hand> = {
  rock: 'scissors',
  scissors: 'paper',
  paper: 'rock',
};

export function decideWinner(
  playerHand: Hand,
  cpuHand: Hand,
  playerStar: Star,
  cpuStar: Star,
): Pick<RoundResult, 'winner' | 'reason'> {
  if (playerHand !== cpuHand) {
    const winner: Winner = beats[playerHand] === cpuHand ? 'player' : 'cpu';
    return { winner, reason: 'hand' };
  }

  if (playerStar > cpuStar) return { winner: 'player', reason: 'star' };
  if (cpuStar > playerStar) return { winner: 'cpu', reason: 'star' };
  return { winner: 'none', reason: 'perfect-tie' };
}

export function resolveRound(input: {
  playerHand: Hand;
  cpuHand: Hand;
  playerStar: Star;
  cpuStar: Star;
  playerAttack: number;
  cpuAttack: number;
  playerHp: number;
  cpuHp: number;
}): RoundResult {
  const judgement = decideWinner(input.playerHand, input.cpuHand, input.playerStar, input.cpuStar);
  const playerDamage = judgement.winner === 'cpu' ? input.cpuAttack : judgement.winner === 'none' ? 1 : 0;
  const cpuDamage = judgement.winner === 'player' ? input.playerAttack : judgement.winner === 'none' ? 1 : 0;

  return {
    ...judgement,
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

export function shuffleStars(random: RandomSource = Math.random): StarMap {
  const stars: Star[] = [1, 2, 3];
  for (let index = stars.length - 1; index > 0; index -= 1) {
    const swapIndex = normalizedIndex(random, index + 1);
    [stars[index], stars[swapIndex]] = [stars[swapIndex], stars[index]];
  }
  return { rock: stars[0], scissors: stars[1], paper: stars[2] };
}

export function pickCpuHand(random: RandomSource = Math.random): Hand {
  return HANDS[normalizedIndex(random, HANDS.length)];
}

/** 開発者メニューの「勝ち負けを決める」。normal はふつう(ランダム)。 */
export type ForcedResult = 'normal' | 'win' | 'lose' | 'tie';

/** 決めた結果になる CPU の手。かつ:プレイヤーの手に負ける手 / まける:勝つ手 / あいこ:同じ手。 */
export function cpuHandFor(playerHand: Hand, mode: ForcedResult, random: RandomSource = Math.random): Hand {
  if (mode === 'win') return beats[playerHand];
  if (mode === 'lose') return HANDS.find((hand) => beats[hand] === playerHand) ?? playerHand;
  if (mode === 'tie') return playerHand;
  return pickCpuHand(random);
}

/** 星の並びはそのまま(1〜3 を1つずつ)で、hand の星を star にする(入れかえる)。あいこを「完全なあいこ」にするため。 */
export function withStarAt(stars: StarMap, hand: Hand, star: Star): StarMap {
  const other = HANDS.find((h) => stars[h] === star);
  if (!other || other === hand) return stars;
  return { ...stars, [hand]: star, [other]: stars[hand] };
}

/** 勝ったあとの連打で、ゲージが満タンになる回数(満タンで +1ダメージ) */
export const MASH_FULL = 8;

/** ピンチ:ラウンドが始まったときに自分の♡が1。勝てば必殺技(⚔×2) */
export function isPinch(hp: number): boolean {
  return hp === 1;
}

/** 連打の回数から足すダメージ。満タンで 1、ほかは 0 */
export function mashBonus(presses: number): number {
  return presses >= MASH_FULL ? 1 : 0;
}

/**
 * プレイヤーが勝ったラウンドに、必殺技と連打の分を足す。
 * cpuHpBefore はラウンドの前の CPU の♡(result.cpuHp は 0 で止まっているので、そこからは戻せない)。
 * 与えるダメージ = 基本(⚔の数)× (ピンチなら 2) + 連打の分。CPU の勝ち・あいこは変えない
 */
export function applyPlayerBonus(
  result: RoundResult,
  bonus: { pinch: boolean; mash: number; cpuHpBefore: number },
): RoundResult {
  if (result.winner !== 'player') return result;
  const cpuDamage = result.cpuDamage * (bonus.pinch ? 2 : 1) + bonus.mash;
  return { ...result, cpuDamage, cpuHp: Math.max(0, bonus.cpuHpBefore - cpuDamage) };
}
