import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTLE_CONFIG } from '../game/config';
import { openPack, startMatch } from '../game/engine';
import { seededRandom } from '../game/simulate';
import { demoSetup, type CardDemoKind } from './cardDev';

const KINDS: CardDemoKind[] = ['merge', 'heal', 'seal', 'draw3', 'reset', 'finisher', 'win', 'lose', 'rendan', 'charge', 'attack-win', 'attack-lose'];

describe('演出を見る(demoSetup)', () => {
  // 同じ id のカードが2枚あると React の key が重なり、使ったカードの枠が 手札に残る(いれかえ で起きた)
  it.each(KINDS)('%s:手札・相手の手札の id が 重ならない', (kind) => {
    const random = seededRandom(1);
    const dealt = openPack(startMatch(DEFAULT_BATTLE_CONFIG, 10, random), random).state;
    const state = demoSetup(kind)(dealt);
    const ids = [...state.player.hand, ...state.cpu.hand].map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
