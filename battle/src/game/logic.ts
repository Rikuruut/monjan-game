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
