import { describe, expect, it } from 'vitest';
import {
  canSeal,
  initialCursor,
  mergeablePairs,
  mergedFace,
  rollDraw,
  rollPack,
  rollStar,
  sortHand,
  type Card,
  type JankenCard,
} from './cards';
import { DEFAULT_BATTLE_CONFIG as config } from './config';
import { seededRandom } from './simulate';
import type { Hand } from '../types';

const janken = (id: string, hand: Hand, star: 1 | 2 | 3): JankenCard => ({ id, kind: 'janken', hand, star });
const heal: Card = { id: 'h', kind: 'skill', skill: 'heal' };
const seal: Card = { id: 's', kind: 'skill', skill: 'seal' };
const finisher: Card = { id: 'f', kind: 'finisher' };
const [practice, second] = config.rounds;

describe('★の抽選', () => {
  it('乱数の位置で ★1(60%)・★2(30%)・★3(10%)', () => {
    expect(rollStar(config, () => 0)).toBe(1);
    expect(rollStar(config, () => 0.59)).toBe(1);
    expect(rollStar(config, () => 0.6)).toBe(2);
    expect(rollStar(config, () => 0.89)).toBe(2);
    expect(rollStar(config, () => 0.9)).toBe(3);
    expect(rollStar(config, () => 1)).toBe(3);
  });
});

describe('パック', () => {
  it('5枚で、じゃんけんカードが1枚は入り、回復は1枚まで', () => {
    const random = seededRandom(1);
    const jankenCounts = [0, 0, 0, 0, 0, 0];
    for (let index = 0; index < 5000; index += 1) {
      const { cards, healDrawn } = rollPack(config, second, random);
      const jankens = cards.filter((card) => card.kind === 'janken').length;
      const heals = cards.filter((card) => card.kind === 'skill' && card.skill === 'heal').length;
      expect(cards).toHaveLength(5);
      expect(jankens).toBeGreaterThanOrEqual(1);
      expect(heals).toBeLessThanOrEqual(1);
      expect(healDrawn).toBe(heals);
      jankenCounts[jankens] += 1;
    }
    // 設計書 4-1:3枚 31% / 4枚 38% くらい
    expect(jankenCounts[3] / 5000).toBeGreaterThan(0.25);
    expect(jankenCounts[4] / 5000).toBeGreaterThan(0.3);
  });

  it('練習のパックには パーが2枚 かならず入る', () => {
    const random = seededRandom(2);
    for (let index = 0; index < 500; index += 1) {
      const { cards } = rollPack(config, practice, random);
      expect(cards.filter((card) => card.kind === 'janken' && card.hand === 'paper').length).toBeGreaterThanOrEqual(2);
    }
  });

  it('回復が もう出ているラウンドでは、パックに回復が入らない', () => {
    const random = seededRandom(3);
    for (let index = 0; index < 500; index += 1) {
      const { cards } = rollPack(config, second, random, 1);
      expect(cards.some((card) => card.kind === 'skill' && card.skill === 'heal')).toBe(false);
    }
  });
});

describe('ドロー', () => {
  const normal = { finisherChances: [], hasJanken: true, healAvailable: true };

  it('必殺技の条件を満たしていて確率が100%なら、かならず必殺技', () => {
    expect(rollDraw(config, { ...normal, finisherChances: [1] }, () => 0.99)).toEqual({ kind: 'finisher' });
  });

  it('必殺技は 条件ごとに順に判定する(1つめが外れても 2つめで来る)', () => {
    const values = [0.9, 0.4];
    expect(rollDraw(config, { ...normal, finisherChances: [0.1, 0.5] }, () => values.shift() ?? 0)).toEqual({ kind: 'finisher' });
  });

  it('手札に じゃんけんカードがなければ、かならず じゃんけんカード', () => {
    const random = seededRandom(4);
    for (let index = 0; index < 300; index += 1) {
      expect(rollDraw(config, { ...normal, hasJanken: false }, random).kind).toBe('janken');
    }
  });

  it('それ以外:回復10% / 封じ手15% / じゃんけんカード75%。回復が上限なら その枠は じゃんけんカード', () => {
    expect(rollDraw(config, normal, () => 0.05)).toEqual({ kind: 'skill', skill: 'heal' });
    expect(rollDraw(config, normal, () => 0.2)).toEqual({ kind: 'skill', skill: 'seal' });
    expect(rollDraw(config, normal, () => 0.5).kind).toBe('janken');
    expect(rollDraw(config, { ...normal, healAvailable: false }, () => 0.05).kind).toBe('janken');
  });
});

describe('合成', () => {
  it('同じ手・同じ★の2枚がペア。★3 と ちがう手・ちがう★は ペアにならない', () => {
    const hand = [janken('a', 'rock', 1), janken('b', 'rock', 1), janken('c', 'rock', 2), janken('d', 'paper', 3), janken('e', 'paper', 3)];
    expect(mergeablePairs(hand).map((pair) => pair.map((card) => card.id))).toEqual([['a', 'b']]);
  });

  it('同じ組が4枚あれば2組', () => {
    const hand = ['a', 'b', 'c', 'd'].map((id) => janken(id, 'scissors', 2));
    expect(mergeablePairs(hand)).toHaveLength(2);
  });

  it('合成すると★が1つ上がる', () => {
    expect(mergedFace(janken('a', 'rock', 2))).toEqual({ kind: 'janken', hand: 'rock', star: 3 });
  });
});

describe('手札の並び', () => {
  it('左にスキル、右に じゃんけんカード(グー・チョキ・パー)、右はしに必殺技', () => {
    const hand = [finisher, janken('p', 'paper', 1), seal, janken('r2', 'rock', 2), heal, janken('r1', 'rock', 1), janken('c', 'scissors', 3)];
    expect(sortHand(hand).map((card) => card.id)).toEqual(['h', 's', 'r1', 'r2', 'c', 'p', 'f']);
  });

  it('カーソルの最初の位置は じゃんけんカードの先頭', () => {
    expect(initialCursor(sortHand([janken('p', 'paper', 1), seal, heal]))).toBe(2);
    expect(initialCursor([heal, finisher])).toBe(1);
    expect(initialCursor([heal])).toBe(0);
  });
});

describe('封じ手', () => {
  it('相手の手札が全部同じ手のときは使えない', () => {
    expect(canSeal([janken('a', 'rock', 1), janken('b', 'rock', 2), janken('c', 'rock', 3)])).toBe(false);
    expect(canSeal([janken('a', 'rock', 1), janken('b', 'paper', 2), janken('c', 'rock', 3)])).toBe(true);
  });
});
