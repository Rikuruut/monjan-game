// カードバトルのカード:種類・抽選(パックとドロー)・合成・手札の並び。
// 山札・捨て札は持たず、毎回その場で抽選する(戦闘システム設計書 3章・4章)。乱数は引数で渡す(テストで決められる)
import { HANDS, type Hand } from '../types';
import type { BattleConfig, Range, RoundConfig } from './config';
import type { RandomSource } from './logic';

export type Star = 1 | 2 | 3;
export type SkillName = 'heal' | 'seal';

/** カードの中身(id なし)。抽選はこれを返し、id は engine.ts が付ける */
export type JankenFace = { kind: 'janken'; hand: Hand; star: Star };
export type SkillFace = { kind: 'skill'; skill: SkillName };
export type FinisherFace = { kind: 'finisher' };
export type CardFace = JankenFace | SkillFace | FinisherFace;

export type JankenCard = JankenFace & { id: string };
export type SkillCard = SkillFace & { id: string };
export type FinisherCard = FinisherFace & { id: string };
export type Card = JankenCard | SkillCard | FinisherCard;

export const MAX_STAR: Star = 3;

// ---- 乱数の道具 ----

function unit(random: RandomSource): number {
  const value = random();
  return Number.isFinite(value) ? Math.min(Math.max(value, 0), 0.999999999999) : 0;
}

/** 0 〜 size-1 の整数 */
export function pickIndex(random: RandomSource, size: number): number {
  return Math.floor(unit(random) * size);
}

/** はば の中の整数(両はしを含む) */
export function randomInt(random: RandomSource, [min, max]: Range): number {
  return min + pickIndex(random, Math.max(1, max - min + 1));
}

/** 確率 chance で true。0 以下・1 以上のときは乱数を使わない */
export function hit(random: RandomSource, chance: number): boolean {
  if (chance <= 0) return false;
  if (chance >= 1) return true;
  return unit(random) < chance;
}

// ---- 抽選 ----

export function rollStar(config: BattleConfig, random: RandomSource): Star {
  const total = config.starWeights.reduce((sum, weight) => sum + weight, 0);
  let point = unit(random) * total;
  for (let index = 0; index < config.starWeights.length; index += 1) {
    point -= config.starWeights[index];
    if (point < 0) return (index + 1) as Star;
  }
  return 1;
}

/** じゃんけんカード。hand を渡すと その手(★だけ抽選) */
export function rollJanken(config: BattleConfig, random: RandomSource, hand?: Hand): JankenFace {
  return { kind: 'janken', hand: hand ?? HANDS[pickIndex(random, HANDS.length)], star: rollStar(config, random) };
}

// スキルか じゃんけんカードかを確率で決める(回復は上限まで。上限なら その枠は じゃんけんカード)
function rollSlot(
  config: BattleConfig,
  rates: { heal: number; seal: number },
  healAvailable: boolean,
  random: RandomSource,
): CardFace {
  const point = unit(random);
  if (point < rates.heal) return healAvailable ? { kind: 'skill', skill: 'heal' } : rollJanken(config, random);
  if (point < rates.heal + rates.seal) return { kind: 'skill', skill: 'seal' };
  return rollJanken(config, random);
}

/**
 * パックの中身(packSize 枚)。かならず入る じゃんけんカード(練習はパー)のあと、残りを1枚ずつ抽選する。
 * healDrawn:このラウンドで すでに出た回復の枚数。返す healDrawn は パックのあとの枚数
 */
export function rollPack(
  config: BattleConfig,
  round: RoundConfig,
  random: RandomSource,
  healDrawn = 0,
): { cards: CardFace[]; healDrawn: number } {
  const cards: CardFace[] = [];
  const fixed = Math.min(config.packSize, Math.max(config.packJanken, round.packPaper));
  for (let index = 0; index < fixed; index += 1) {
    cards.push(rollJanken(config, random, index < round.packPaper ? 'paper' : undefined));
  }
  let heals = healDrawn;
  while (cards.length < config.packSize) {
    const card = rollSlot(config, { heal: config.packHealRate, seal: config.packSealRate }, heals < config.healPerRound, random);
    if (card.kind === 'skill' && card.skill === 'heal') heals += 1;
    cards.push(card);
  }
  return { cards, healDrawn: heals };
}

/**
 * ドローの1枚。順番:必殺技の判定 → 手札に じゃんけんカードがなければ かならず じゃんけんカード → 確率。
 * finisherChances:いま満たしている条件ごとの確率(満たしていない条件は入れない)。先頭から順に判定する
 */
export function rollDraw(
  config: BattleConfig,
  context: { finisherChances: number[]; hasJanken: boolean; healAvailable: boolean },
  random: RandomSource,
): CardFace {
  for (const chance of context.finisherChances) {
    if (hit(random, chance)) return { kind: 'finisher' };
  }
  if (!context.hasJanken) return rollJanken(config, random);
  return rollSlot(config, { heal: config.drawHealRate, seal: config.drawSealRate }, context.healAvailable, random);
}

// ---- 合成 ----

export function isJanken(card: Card): card is JankenCard {
  return card.kind === 'janken';
}

export function canMerge(a: Card, b: Card): boolean {
  return a.id !== b.id && isJanken(a) && isJanken(b) && a.hand === b.hand && a.star === b.star && a.star < MAX_STAR;
}

/** 合成できるペア(同じ手・同じ★が2枚。★3 は合成できない)。同じ組が4枚あれば2組 */
export function mergeablePairs(hand: Card[]): [JankenCard, JankenCard][] {
  const groups = new Map<string, JankenCard[]>();
  for (const card of hand) {
    if (!isJanken(card) || card.star >= MAX_STAR) continue;
    const key = `${card.hand}-${card.star}`;
    groups.set(key, [...(groups.get(key) ?? []), card]);
  }
  const pairs: [JankenCard, JankenCard][] = [];
  for (const group of groups.values()) {
    for (let index = 0; index + 1 < group.length; index += 2) pairs.push([group[index], group[index + 1]]);
  }
  return pairs;
}

/** 合成したあとのカード(★が1つ上がる) */
export function mergedFace(card: JankenCard): JankenFace {
  return { kind: 'janken', hand: card.hand, star: Math.min(MAX_STAR, card.star + 1) as Star };
}

// ---- 手札の並び ----

const SKILL_ORDER: SkillName[] = ['heal', 'seal'];

// 左にスキル(回復・封じ手)、右に じゃんけんカード(グー・チョキ・パー、同じ手は★の少ない順)、右はしに必殺技
function sortKey(card: Card): number {
  if (card.kind === 'skill') return SKILL_ORDER.indexOf(card.skill);
  if (card.kind === 'janken') return 10 + HANDS.indexOf(card.hand) * 10 + card.star;
  return 100;
}

export function sortHand<T extends Card>(hand: T[]): T[] {
  return hand
    .map((card, index) => ({ card, index }))
    .sort((a, b) => sortKey(a.card) - sortKey(b.card) || a.index - b.index)
    .map(({ card }) => card);
}

/** カーソルの最初の位置:じゃんけんカードの先頭(なければ必殺技、それもなければ 0) */
export function initialCursor(hand: Card[]): number {
  const janken = hand.findIndex(isJanken);
  if (janken >= 0) return janken;
  return Math.max(0, hand.findIndex((card) => card.kind === 'finisher'));
}

/** 封じ手を使えるか:相手の手札に2種類以上の手がある */
export function canSeal(cpuHand: JankenCard[]): boolean {
  return new Set(cpuHand.map((card) => card.hand)).size >= 2;
}
