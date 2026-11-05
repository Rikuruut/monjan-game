export const HANDS = ['rock', 'scissors', 'paper'] as const;

export type Hand = (typeof HANDS)[number];
export type Winner = 'player' | 'cpu' | 'none';
export type GameOutcome = 'ongoing' | 'victory' | 'defeat' | 'draw';

export interface Monster {
  id: string;
  name: string;
  source: { animal: string; object: string };
  attribute: string;
  attack: 1000 | 2000 | 3000;
  hp: 1000 | 2000 | 3000 | 4000 | 5000;
  description: string;
  image: string;
}

export interface RoundResult {
  winner: Winner;
  // hand:じゃんけんで決まった / mash:あいこの連打勝負で決まった(同じ数なら winner は none)
  reason: 'hand' | 'mash';
  // とどめのチャンス(相手の♡が1)に じゃんけんで勝った必殺技(⚔×2。演出を特別にする)
  special: boolean;
  playerDamage: number;
  cpuDamage: number;
  playerHp: number;
  cpuHp: number;
}
