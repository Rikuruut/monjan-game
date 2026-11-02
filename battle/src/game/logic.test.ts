import { describe, expect, it, vi } from 'vitest';
import { decideWinner, getGameOutcome, pickCpuHand, resolveRound, shuffleStars } from './logic';

describe('じゃんけん判定', () => {
  it.each([
    ['rock', 'scissors'],
    ['scissors', 'paper'],
    ['paper', 'rock'],
  ] as const)('%s は %s に星の数と関係なく勝つ', (player, cpu) => {
    expect(decideWinner(player, cpu, 1, 3)).toEqual({ winner: 'player', reason: 'hand' });
  });

  it('同じ手では星が多いプレイヤーが勝つ', () => {
    expect(decideWinner('rock', 'rock', 3, 1)).toEqual({ winner: 'player', reason: 'star' });
  });

  it('同じ手では星が多いCPUが勝つ', () => {
    expect(decideWinner('paper', 'paper', 1, 3)).toEqual({ winner: 'cpu', reason: 'star' });
  });

  it('手も星も同じなら勝者なし', () => {
    expect(decideWinner('scissors', 'scissors', 2, 2)).toEqual({
      winner: 'none',
      reason: 'perfect-tie',
    });
  });
});

describe('ダメージとHP', () => {
  it('プレイヤーのATK個数分だけCPUのHPを減らす', () => {
    const result = resolveRound({
      playerHand: 'rock',
      cpuHand: 'scissors',
      playerStar: 1,
      cpuStar: 3,
      playerAttack: 3,
      cpuAttack: 1,
      playerHp: 4,
      cpuHp: 5,
    });
    expect(result.cpuHp).toBe(2);
    expect(result.cpuDamage).toBe(3);
    expect(result.playerHp).toBe(4);
  });

  it('CPUのATK個数分だけプレイヤーのHPを減らす', () => {
    const result = resolveRound({
      playerHand: 'rock',
      cpuHand: 'paper',
      playerStar: 3,
      cpuStar: 1,
      playerAttack: 1,
      cpuAttack: 2,
      playerHp: 4,
      cpuHp: 5,
    });
    expect(result.playerHp).toBe(2);
    expect(result.playerDamage).toBe(2);
  });

  it('完全なあいこはATKによらず双方1ダメージ', () => {
    const result = resolveRound({
      playerHand: 'paper',
      cpuHand: 'paper',
      playerStar: 2,
      cpuStar: 2,
      playerAttack: 3,
      cpuAttack: 3,
      playerHp: 4,
      cpuHp: 5,
    });
    expect(result).toMatchObject({ playerHp: 3, cpuHp: 4, playerDamage: 1, cpuDamage: 1 });
  });

  it('HPは0未満にならない', () => {
    const result = resolveRound({
      playerHand: 'rock',
      cpuHand: 'scissors',
      playerStar: 1,
      cpuStar: 3,
      playerAttack: 3,
      cpuAttack: 3,
      playerHp: 1,
      cpuHp: 1,
    });
    expect(result.cpuHp).toBe(0);
  });
});

describe('ゲーム終了判定', () => {
  it.each([
    [4, 0, 'victory'],
    [0, 5, 'defeat'],
    [0, 0, 'draw'],
    [1, 1, 'ongoing'],
  ] as const)('HP %i 対 %i は %s', (playerHp, cpuHp, expected) => {
    expect(getGameOutcome(playerHp, cpuHp)).toBe(expected);
  });
});

describe('テスト可能な乱数処理', () => {
  it('各手の星は常に1, 2, 3の順列になる', () => {
    for (const value of [0, 0.2, 0.5, 0.999]) {
      const stars = shuffleStars(() => value);
      expect(Object.values(stars).sort()).toEqual([1, 2, 3]);
    }
  });

  it('次のラウンドでは注入した乱数に応じて再抽選できる', () => {
    const first = shuffleStars(vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0));
    const second = shuffleStars(vi.fn().mockReturnValueOnce(0.99).mockReturnValueOnce(0.99));
    expect(first).not.toEqual(second);
  });

  it('CPUの手は渡した乱数だけで選ばれる', () => {
    expect(pickCpuHand(() => 0)).toBe('rock');
    expect(pickCpuHand(() => 0.4)).toBe('scissors');
    expect(pickCpuHand(() => 0.9)).toBe('paper');
  });
});

