import { describe, expect, it } from 'vitest';
import type { Hand } from '../types';
import type { Card, JankenCard } from './cards';
import { DEFAULT_BATTLE_CONFIG as config } from './config';
import {
  beginNextTurn,
  canUseSkill,
  healAmount,
  mergeCards,
  openPack,
  playCard,
  resolveRendan,
  roundDestination,
  startMatch,
  startNextRound,
  useSkill,
  type BattleState,
} from './engine';
import { seededRandom } from './simulate';

const janken = (id: string, hand: Hand, star: 1 | 2 | 3): JankenCard => ({ id, kind: 'janken', hand, star });
const heal: Card = { id: 'h', kind: 'skill', skill: 'heal' };
const seal: Card = { id: 's', kind: 'skill', skill: 'seal' };
const finisher: Card = { id: 'f', kind: 'finisher' };
const ATTACK = 10;

/** 自分のターンの状態を作る。相手は cpuHand の先頭を ふせている */
function playerTurn(options: {
  round?: number;
  turn?: number;
  hand: Card[];
  cpuHand: JankenCard[];
  playerHp?: number;
  cpuHp?: number;
  cpuMaxHp?: number;
  cpuAttack?: number;
  charging?: boolean;
  chargeAnnounced?: boolean;
}): BattleState {
  const base = startMatch(config, ATTACK, seededRandom(1));
  const cpuMaxHp = options.cpuMaxHp ?? 60;
  return {
    ...base,
    round: options.round ?? 2,
    turn: options.turn ?? 1,
    phase: 'player',
    player: { ...base.player, hp: options.playerHp ?? 100, hand: options.hand },
    cpu: {
      ...base.cpu,
      hp: options.cpuHp ?? cpuMaxHp,
      maxHp: cpuMaxHp,
      attack: options.cpuAttack ?? 10,
      hand: options.cpuHand,
      placedId: options.cpuHand[0].id,
      charging: options.charging ?? false,
      chargeAnnounced: options.chargeAnnounced ?? false,
    },
  };
}

const types = (events: { type: string }[]) => events.map((event) => event.type);

describe('試合のはじまりとパック', () => {
  it('1体目(練習)のパック選びから始まる。HP は100、相手は HP30・攻撃力8', () => {
    const state = startMatch(config, ATTACK, seededRandom(1));
    expect(state).toMatchObject({ round: 1, turn: 1, phase: 'pack', finisherUsed: false });
    expect(state.player).toMatchObject({ hp: 100, maxHp: 100, attack: ATTACK, hand: [] });
    expect(state.cpu).toMatchObject({ hp: 30, maxHp: 30, attack: 8 });
  });

  it('パックを開けると5枚もらい、相手は3枚持って1枚ふせる。練習の相手は全部グー', () => {
    const { state, events } = openPack(startMatch(config, ATTACK, seededRandom(1)), seededRandom(2));
    expect(state.phase).toBe('player');
    expect(state.player.hand).toHaveLength(5);
    expect(state.player.hand.filter((card) => card.kind === 'janken' && card.hand === 'paper').length).toBeGreaterThanOrEqual(2);
    expect(state.cpu.hand).toHaveLength(3);
    expect(state.cpu.hand.every((card) => card.hand === 'rock')).toBe(true);
    expect(state.cpu.hand.map((card) => card.id)).toContain(state.cpu.placedId);
    expect(types(events)).toEqual(['pack', 'cpu-place']);
    // id は かぶらない
    const ids = [...state.player.hand, ...state.cpu.hand].map((card) => card.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('じゃんけんの勝負', () => {
  it('勝つと ★のダメージ + 攻撃力 を与える。ふせたカードは相手の手札から なくなる', () => {
    const start = playerTurn({ hand: [janken('p', 'paper', 2)], cpuHand: [janken('x', 'rock', 3), janken('y', 'paper', 1), janken('z', 'rock', 1)] });
    const { state, events } = playCard(start, 'p');
    expect(state.cpu.hp).toBe(60 - (25 + ATTACK));
    expect(state.player.hp).toBe(100);
    expect(state.phase).toBe('turn_end');
    expect(state.cpu.hand.map((card) => card.id)).toEqual(['y', 'z']);
    expect(state.cpu.placedId).toBeNull();
    expect(events[0]).toMatchObject({ type: 'janken', winner: 'player', by: 'hand' });
    expect(events[1]).toEqual({ type: 'damage', target: 'cpu', amount: 35, charged: false });
  });

  it('負けると 相手のカードの★のダメージ + 相手の攻撃力 を受ける', () => {
    const start = playerTurn({ hand: [janken('c', 'scissors', 3)], cpuHand: [janken('x', 'rock', 1)], cpuAttack: 9 });
    const { state } = playCard(start, 'c');
    expect(state.player.hp).toBe(100 - (10 + 9));
    expect(state.cpu.hp).toBe(60);
  });

  it('あいこは★の多い方の勝ち', () => {
    const win = playCard(playerTurn({ hand: [janken('r', 'rock', 2)], cpuHand: [janken('x', 'rock', 1)] }), 'r');
    expect(win.events[0]).toMatchObject({ type: 'janken', winner: 'player', by: 'star' });
    expect(win.state.cpu.hp).toBe(60 - 35);
    const lose = playCard(playerTurn({ hand: [janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 3)] }), 'r');
    expect(lose.events[0]).toMatchObject({ winner: 'cpu', by: 'star' });
    expect(lose.state.player.hp).toBe(100 - 60);
  });

  it('★も同じなら連打勝負。多く押した方が勝ち、同じ数はユーザーの勝ち', () => {
    const start = playerTurn({ hand: [janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 1)] });
    const tie = playCard(start, 'r');
    expect(tie.state.phase).toBe('rendan');
    expect(tie.events[0]).toMatchObject({ winner: 'rendan' });
    expect(tie.state.cpu.hp).toBe(60);

    expect(resolveRendan(tie.state, 3, 8).state.player.hp).toBe(80);
    expect(resolveRendan(tie.state, 9, 8).state.cpu.hp).toBe(40);
    const same = resolveRendan(tie.state, 8, 8);
    expect(same.events[0]).toMatchObject({ type: 'rendan', winner: 'player' });
    expect(same.state.cpu.hp).toBe(40);
    expect(same.state.phase).toBe('turn_end');
  });

  it('スキルカードは出せない。自分のターン以外は出せない', () => {
    const start = playerTurn({ hand: [heal, janken('r', 'rock', 1)], cpuHand: [janken('x', 'paper', 1)] });
    expect(() => playCard(start, 'h')).toThrow();
    expect(() => playCard(start, 'ない')).toThrow();
    expect(() => playCard(playCard(start, 'r').state, 'h')).toThrow();
  });
});

describe('ラウンドの終わり', () => {
  it('相手の HP が0で勝ち。1体目・2体目は次のラウンドへ、ボスは全クリア', () => {
    const start = playerTurn({ round: 2, hand: [janken('p', 'paper', 3)], cpuHand: [janken('x', 'rock', 1)], cpuHp: 20 });
    const { state, events } = playCard(start, 'p');
    expect(state).toMatchObject({ phase: 'round_end', roundResult: 'win' });
    expect(state.cpu.hp).toBe(0);
    expect(events.at(-1)).toEqual({ type: 'round-end', result: 'win', destination: 'next-round' });
    expect(roundDestination({ config, round: 3 }, 'win')).toBe('clear');
  });

  it('自分の HP が0で負け。リザルトへ', () => {
    const start = playerTurn({ hand: [janken('c', 'scissors', 1)], cpuHand: [janken('x', 'rock', 3)], playerHp: 30 });
    const { state, events } = playCard(start, 'c');
    expect(state).toMatchObject({ phase: 'round_end', roundResult: 'lose' });
    expect(state.player.hp).toBe(0);
    expect(events.at(-1)).toMatchObject({ destination: 'defeat' });
    expect(() => startNextRound(state)).toThrow();
  });

  it('練習では 自分の HP が1より下がらない', () => {
    const start = playerTurn({ round: 1, hand: [janken('c', 'scissors', 1)], cpuHand: [janken('x', 'rock', 3)], playerHp: 5 });
    const { state } = playCard(start, 'c');
    expect(state.player.hp).toBe(1);
    expect(state.phase).toBe('turn_end');
  });

  it('次のラウンド:HP は全回復、手札は捨てる。パック選びから', () => {
    const start = playerTurn({ round: 2, hand: [janken('p', 'paper', 3), heal], cpuHand: [janken('x', 'rock', 1)], cpuHp: 20, playerHp: 40 });
    const next = startNextRound(playCard(start, 'p').state, seededRandom(5));
    expect(next).toMatchObject({ round: 3, turn: 1, phase: 'pack', roundResult: null });
    expect(next.player).toMatchObject({ hp: 100, hand: [], healDrawn: 0 });
    expect(next.cpu.hp).toBeGreaterThanOrEqual(55);
    expect(next.cpu.hp).toBeLessThanOrEqual(65);
    expect(next.cpu.hp).toBe(next.cpu.maxHp);
  });
});

describe('次のターン', () => {
  it('お互い1枚引いて、相手がまた1枚ふせる', () => {
    const start = playerTurn({ hand: [janken('p', 'paper', 1), janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 1), janken('y', 'paper', 1), janken('z', 'rock', 1)] });
    const { state, events } = beginNextTurn(playCard(start, 'p').state, seededRandom(6));
    expect(state).toMatchObject({ turn: 2, phase: 'player' });
    expect(state.player.hand).toHaveLength(2);
    expect(state.cpu.hand).toHaveLength(3);
    expect(state.cpu.placedId).not.toBeNull();
    expect(types(events)).toEqual(['draw', 'cpu-place']);
  });

  it('手札に じゃんけんカードがなければ、かならず じゃんけんカードを引く', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const start = playerTurn({ hand: [janken('p', 'paper', 1), seal], cpuHand: [janken('x', 'rock', 1)] });
      const { state } = beginNextTurn(playCard(start, 'p').state, seededRandom(seed));
      expect(state.player.hand.some((card) => card.kind === 'janken')).toBe(true);
    }
  });

  it('回復カードは 1ラウンドに1枚まで', () => {
    const random = seededRandom(7);
    for (let match = 0; match < 200; match += 1) {
      let state = openPack({ ...startMatch(config, ATTACK, random), round: 2 }, random).state;
      let heals = state.player.hand.filter((card) => card.kind === 'skill' && card.skill === 'heal').length;
      for (let turn = 0; turn < 8; turn += 1) {
        // カードを出さずに ターンだけ進める(手札は じゃんけんカード1枚にして 引けるようにする)
        const keep = state.player.hand.filter((card) => card.kind === 'janken').slice(0, 1);
        const step = beginNextTurn({ ...state, phase: 'turn_end', player: { ...state.player, hand: keep } }, random);
        heals += step.events.filter((event) => event.type === 'draw' && event.card.kind === 'skill' && event.card.skill === 'heal').length;
        state = step.state;
      }
      expect(heals).toBeLessThanOrEqual(1);
    }
  });
});

describe('合成', () => {
  it('同じ手・同じ★の2枚が、★が1つ上の1枚になる(スキルの枠は使わない)', () => {
    const start = playerTurn({ hand: [janken('a', 'rock', 2), janken('b', 'rock', 2), janken('c', 'paper', 1)], cpuHand: [janken('x', 'rock', 1)] });
    const { state, events } = mergeCards(start, 'a', 'b');
    expect(state.player.hand).toHaveLength(2);
    expect(state.player.hand[0]).toMatchObject({ kind: 'janken', hand: 'rock', star: 3 });
    expect(state.player.skillsUsed).toBe(0);
    expect(state.phase).toBe('player');
    expect(events[0]).toMatchObject({ type: 'merge', card: { star: 3 } });
  });

  it('ちがう手・ちがう★・★3 は合成できない', () => {
    const start = playerTurn({
      hand: [janken('a', 'rock', 1), janken('b', 'paper', 1), janken('c', 'rock', 2), janken('d', 'rock', 3), janken('e', 'rock', 3)],
      cpuHand: [janken('x', 'rock', 1)],
    });
    expect(() => mergeCards(start, 'a', 'b')).toThrow();
    expect(() => mergeCards(start, 'a', 'c')).toThrow();
    expect(() => mergeCards(start, 'd', 'e')).toThrow();
    expect(() => mergeCards(start, 'a', 'a')).toThrow();
  });
});

describe('スキル', () => {
  it('回復:HP が満タンにもどる。スキルは1ターンに1枚まで', () => {
    const start = playerTurn({ hand: [heal, seal, janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 1), janken('y', 'paper', 1)], playerHp: 35 });
    expect(healAmount(start)).toBe(65);
    const { state, events } = useSkill(start, 'h');
    expect(state.player.hp).toBe(100);
    expect(events).toEqual([{ type: 'heal', amount: 65 }]);
    expect(state.player.hand.map((card) => card.id)).toEqual(['s', 'r']);
    expect(canUseSkill(state, seal)).toBe(false);
    expect(() => useSkill(state, 's')).toThrow();
    // 同じターンに じゃんけんカードは出せる
    expect(playCard(state, 'r').state.phase).not.toBe('player');
  });

  it('次のターンには また スキルを使える', () => {
    const start = playerTurn({ hand: [heal, seal, janken('r', 'rock', 1), janken('p', 'paper', 1)], cpuHand: [janken('x', 'scissors', 1), janken('y', 'paper', 1)] });
    const played = playCard(useSkill(start, 'h').state, 'r').state;
    const next = beginNextTurn(played, seededRandom(8)).state;
    expect(next.player.skillsUsed).toBe(0);
  });

  it('封じ手:相手が持っている手から1種類を封じ、相手は その手以外で出し直す', () => {
    for (let seed = 1; seed <= 100; seed += 1) {
      const start = playerTurn({ hand: [seal, janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 1), janken('y', 'paper', 1), janken('z', 'rock', 2)] });
      const { state, events } = useSkill(start, 's', seededRandom(seed));
      expect(['rock', 'paper']).toContain(state.cpu.sealedHand);
      const placed = state.cpu.hand.find((card) => card.id === state.cpu.placedId);
      expect(placed?.hand).not.toBe(state.cpu.sealedHand);
      expect(types(events)).toEqual(['seal', 'cpu-place']);
    }
  });

  it('封じ手は そのターンだけ(ターンが終わると解ける)', () => {
    // ★がちがうので、どちらが残っても連打勝負にならずに ターンが終わる
    const start = playerTurn({ hand: [seal, janken('r', 'rock', 3)], cpuHand: [janken('x', 'rock', 1), janken('y', 'paper', 1)], cpuMaxHp: 200 });
    const sealed = useSkill(start, 's', seededRandom(1)).state;
    expect(sealed.cpu.sealedHand).not.toBeNull();
    const played = playCard(sealed, 'r').state;
    expect(played.phase).toBe('turn_end');
    expect(played.cpu.sealedHand).toBeNull();
  });

  it('相手の手札が全部同じ手のとき、封じ手は使えない', () => {
    const start = playerTurn({ hand: [seal, janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 1), janken('y', 'rock', 2)] });
    expect(canUseSkill(start, seal)).toBe(false);
    expect(() => useSkill(start, 's')).toThrow();
  });
});

describe('必殺技', () => {
  it('どの手にも勝ち、相手を かならず倒す。1試合に1回', () => {
    const start = playerTurn({ round: 3, hand: [finisher, heal], cpuHand: [janken('x', 'rock', 3)], cpuHp: 44, cpuMaxHp: 85, playerHp: 20 });
    const { state, events } = playCard(useSkill(start, 'h').state, 'f');
    expect(state.cpu.hp).toBe(0);
    expect(state).toMatchObject({ finisherUsed: true, phase: 'round_end', roundResult: 'win' });
    expect(types(events)).toEqual(['finisher', 'damage', 'round-end']);
    expect(events.at(-1)).toMatchObject({ destination: 'clear' });
  });

  // 相手の HP を半分以下にして ターンを終えた状態
  const afterHit = (round: number, extra: Partial<BattleState> = {}) => {
    const start = playerTurn({ round, hand: [janken('p', 'paper', 1), janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 1), janken('y', 'rock', 1)], cpuHp: 50, cpuMaxHp: 85 });
    return { ...playCard(start, 'p').state, ...extra };
  };

  it('ボス:相手の HP が半分以下になったら、次のドローで かならず来る', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const { events } = beginNextTurn(afterHit(3), seededRandom(seed));
      expect(events[0]).toMatchObject({ type: 'draw', card: { kind: 'finisher' } });
    }
  });

  it('使ったあと・手札にあるあいだは 来ない。練習では出ない', () => {
    for (let seed = 1; seed <= 50; seed += 1) {
      const used = beginNextTurn(afterHit(3, { finisherUsed: true }), seededRandom(seed));
      expect(used.state.player.hand.some((card) => card.kind === 'finisher')).toBe(false);

      const holding = afterHit(3);
      const kept = beginNextTurn({ ...holding, player: { ...holding.player, hand: [finisher, janken('r', 'rock', 1)] } }, seededRandom(seed));
      expect(kept.state.player.hand.filter((card) => card.kind === 'finisher')).toHaveLength(1);

      const practice = beginNextTurn(afterHit(1), seededRandom(seed));
      expect(practice.state.player.hand.some((card) => card.kind === 'finisher')).toBe(false);
    }
  });

  it('2体目:相手の HP が半分以下でも 確率(10%)。逆転のチャンス(自分の HP が3割以下)は50%', () => {
    let normal = 0;
    let comeback = 0;
    const trials = 2000;
    for (let seed = 1; seed <= trials; seed += 1) {
      const first = beginNextTurn(afterHit(2), seededRandom(seed)).events[0];
      if (first.type === 'draw' && first.card.kind === 'finisher') normal += 1;
      // 相手の HP は多いまま、自分の HP だけ3割以下
      const pinch = afterHit(2);
      const drawn = beginNextTurn(
        { ...pinch, cpu: { ...pinch.cpu, hp: 85 }, player: { ...pinch.player, hp: 30 } },
        seededRandom(seed),
      ).events[0];
      if (drawn.type === 'draw' && drawn.card.kind === 'finisher') comeback += 1;
    }
    expect(normal / trials).toBeGreaterThan(0.06);
    expect(normal / trials).toBeLessThan(0.14);
    expect(comeback / trials).toBeGreaterThan(0.44);
    expect(comeback / trials).toBeLessThan(0.56);
  });
});

describe('CPU のスキル', () => {
  // 相手の HP を hp にして、次のターンを始める
  const nextTurn = (round: number, turn: number, cpuHp: number, extra: Partial<BattleState['cpu']> = {}) => {
    const start = playerTurn({ round, turn, hand: [janken('c', 'scissors', 1), janken('r', 'rock', 1)], cpuHand: [janken('x', 'rock', 1), janken('y', 'rock', 1)], cpuHp, cpuMaxHp: 60 });
    const played = playCard(start, 'c').state;
    return beginNextTurn({ ...played, cpu: { ...played.cpu, ...extra } }, seededRandom(9));
  };

  it('回復:ボスは HP が4割以下になったターンの最初に、+30 を1回だけ', () => {
    const healed = nextTurn(3, 1, 24);
    expect(types(healed.events)).toContain('cpu-heal');
    expect(healed.state.cpu).toMatchObject({ hp: 54, healUsed: true });

    expect(types(nextTurn(3, 1, 25).events)).not.toContain('cpu-heal');
    expect(types(nextTurn(3, 1, 10, { healUsed: true }).events)).not.toContain('cpu-heal');
    // 練習の相手と2体目は使わない
    expect(types(nextTurn(2, 1, 10).events)).not.toContain('cpu-heal');
    expect(types(nextTurn(1, 1, 10).events)).not.toContain('cpu-heal');
  });

  it('ため技:ボスは3ターンごとに予告し、次のターンに ためる', () => {
    const announced = nextTurn(3, 2, 60);
    expect(announced.state.turn).toBe(3);
    expect(types(announced.events)).toContain('cpu-charge-announce');
    expect(announced.state.cpu).toMatchObject({ chargeAnnounced: true, charging: false });

    const charged = nextTurn(3, 3, 60, { chargeAnnounced: true });
    expect(charged.state.cpu).toMatchObject({ chargeAnnounced: false, charging: true });

    // 2体目は使わない
    expect(types(nextTurn(2, 2, 60).events)).not.toContain('cpu-charge-announce');
  });

  it('ためたターンに相手が勝つとダメージ2倍。ユーザーが勝てば何も起きない(「ふせいだ!」)', () => {
    const lose = playCard(playerTurn({ round: 3, hand: [janken('c', 'scissors', 1)], cpuHand: [janken('x', 'rock', 1)], charging: true }), 'c');
    expect(lose.events).toContainEqual({ type: 'damage', target: 'player', amount: 40, charged: true });
    expect(lose.state.player.hp).toBe(60);

    const win = playCard(playerTurn({ round: 3, hand: [janken('p', 'paper', 1)], cpuHand: [janken('x', 'rock', 1)], charging: true }), 'p');
    expect(types(win.events)).toEqual(['janken', 'charge-blocked', 'damage']);
    expect(win.state.player.hp).toBe(100);
  });
});
