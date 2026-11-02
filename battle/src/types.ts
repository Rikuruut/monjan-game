export const HANDS = ['rock', 'scissors', 'paper'] as const;

export type Hand = (typeof HANDS)[number];
export type Star = 1 | 2 | 3;
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

export type StarMap = Record<Hand, Star>;

export interface RoundResult {
  winner: Winner;
  reason: 'hand' | 'star' | 'perfect-tie';
  playerDamage: number;
  cpuDamage: number;
  playerHp: number;
  cpuHp: number;
}
