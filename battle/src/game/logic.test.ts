import { describe, expect, it } from 'vitest';
import {
  CPU_MASH_MAX,
  CPU_MASH_MIN,
  cpuHandFor,
  decideMashDuel,
  decideWinner,
  getGameOutcome,
  isFinishChance,
  pickCpuHand,
  pickCpuMash,
  resolveRound,
} from './logic';

describe('じゃんけん判定', () => {
  it.each([
    ['rock', 'scissors'],
    ['scissors', 'paper'],
    ['paper', 'rock'],
  ] as const)('%s は %s に勝つ', (player, cpu) => {
    expect(decideWinner(player, cpu)).toBe('player');
    expect(decideWinner(cpu, player)).toBe('cpu');
  });

  it('同じ手は あいこ(このあと連打勝負)', () => {
    for (const hand of ['rock', 'scissors', 'paper'] as const) expect(decideWinner(hand, hand)).toBe('tie');
  });
});

describe('あいこの連打勝負', () => {
  it('多く押した方の勝ち、同じ数なら勝者なし', () => {
    expect(decideMashDuel(9, 7)).toBe('player');
    expect(decideMashDuel(5, 7)).toBe('cpu');
    expect(decideMashDuel(7, 7)).toBe('none');
  });

  it('CPU の回数は はばの中から、渡した乱数で決まる', () => {
    expect(pickCpuMash(() => 0)).toBe(CPU_MASH_MIN);
    expect(pickCpuMash(() => 0.999)).toBe(CPU_MASH_MAX);
    for (const value of [0.1, 0.5, 0.8]) {
      const presses = pickCpuMash(() => value);
      expect(presses).toBeGreaterThanOrEqual(CPU_MASH_MIN);
      expect(presses).toBeLessThanOrEqual(CPU_MASH_MAX);
    }
  });
});

describe('ダメージとHP', () => {
  const base = { reason: 'hand', playerAttack: 2, cpuAttack: 3, playerHp: 4, cpuHp: 5 } as const;

  it('プレイヤーが勝つと⚔の数だけ CPU の♡を減らす', () => {
    expect(resolveRound({ ...base, winner: 'player' })).toEqual({
      winner: 'player', reason: 'hand', special: false, playerDamage: 0, cpuDamage: 2, playerHp: 4, cpuHp: 3,
    });
  });

  it('CPU が勝つと CPU の⚔の数だけ減らす', () => {
    expect(resolveRound({ ...base, winner: 'cpu' })).toMatchObject({ playerDamage: 3, playerHp: 1, cpuHp: 5 });
  });

  it('勝者なし(連打が同じ数)は⚔によらず双方1ダメージ', () => {
    expect(resolveRound({ ...base, reason: 'mash', winner: 'none' }))
      .toMatchObject({ reason: 'mash', playerDamage: 1, cpuDamage: 1, playerHp: 3, cpuHp: 4 });
  });

  it('とどめのチャンスに じゃんけんで勝つと必殺技で⚔×2', () => {
    expect(resolveRound({ ...base, winner: 'player', finishChance: true, cpuHp: 1 }))
      .toMatchObject({ special: true, cpuDamage: 4, cpuHp: 0 });
  });

  it('とどめのチャンスでも、連打勝負の勝ちは ふつうの攻撃', () => {
    expect(resolveRound({ ...base, reason: 'mash', winner: 'player', finishChance: true, cpuHp: 1 }))
      .toMatchObject({ special: false, cpuDamage: 2, cpuHp: 0 });
  });

  it('とどめのチャンスでも、負けと勝者なしは必殺技にならない', () => {
    expect(resolveRound({ ...base, winner: 'cpu', finishChance: true, cpuHp: 1 })).toMatchObject({ special: false, cpuDamage: 0 });
    expect(resolveRound({ ...base, reason: 'mash', winner: 'none', finishChance: true, cpuHp: 1 }))
      .toMatchObject({ special: false, cpuDamage: 1 });
  });

  it('HPは0未満にならない', () => {
    expect(resolveRound({ ...base, winner: 'player', cpuHp: 1 }).cpuHp).toBe(0);
  });

  it('とどめのチャンスは相手の♡が1のときだけ', () => {
    expect(isFinishChance(1)).toBe(true);
    expect(isFinishChance(0)).toBe(false);
    expect(isFinishChance(2)).toBe(false);
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
  it('CPUの手は渡した乱数だけで選ばれる', () => {
    expect(pickCpuHand(() => 0)).toBe('rock');
    expect(pickCpuHand(() => 0.4)).toBe('scissors');
    expect(pickCpuHand(() => 0.9)).toBe('paper');
  });
});

describe('開発者メニューの「勝ち負けを決める」', () => {
  it('かつ・まける・あいこ になる CPU の手を返す', () => {
    for (const hand of ['rock', 'scissors', 'paper'] as const) {
      expect(decideWinner(hand, cpuHandFor(hand, 'win'))).toBe('player');
      expect(decideWinner(hand, cpuHandFor(hand, 'lose'))).toBe('cpu');
      expect(decideWinner(hand, cpuHandFor(hand, 'tie'))).toBe('tie');
    }
  });

  it('ふつう は乱数で選ぶ', () => {
    expect(cpuHandFor('rock', 'normal', () => 0.9)).toBe('paper');
  });
});
