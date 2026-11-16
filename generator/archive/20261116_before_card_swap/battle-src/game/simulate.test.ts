import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTLE_CONFIG as config } from './config';
import { playMatch, seededRandom, simulate } from './simulate';

describe('シミュレーション', () => {
  it('同じ種なら同じ結果', () => {
    expect(simulate(config, 'smart', { matches: 200, seed: 3 })).toEqual(simulate(config, 'smart', { matches: 200, seed: 3 }));
  });

  it('どの試合も最後まで進む(勝ったラウンドの数と ターン数が合う)', () => {
    const random = seededRandom(4);
    for (let match = 0; match < 300; match += 1) {
      const result = playMatch(config, match % 2 ? 'smart' : 'random', random);
      expect(result.turns.length).toBe(result.cleared ? 3 : result.roundsWon + 1);
      expect(result.cleared).toBe(result.roundsWon === 3);
      expect(result.turns.every((turns) => turns >= 1 && turns < 200)).toBe(true);
    }
  });

  it('練習は かならず勝つ。考えて遊ぶ子は なんとなく選ぶ子より よく勝つ', () => {
    const smart = simulate(config, 'smart', { matches: 1500, seed: 5 });
    const random = simulate(config, 'random', { matches: 1500, seed: 5 });
    expect(smart.roundWinRate[0]).toBe(1);
    expect(random.roundWinRate[0]).toBe(1);
    expect(smart.clearRate).toBeGreaterThan(random.clearRate);
    // 目標(全クリア7〜8割)から大きく外れていないこと。こまかい数字は npm.cmd run sim で見る
    expect(smart.clearRate).toBeGreaterThan(0.6);
    expect(random.clearRate).toBeGreaterThan(0.4);
  });
});
