// カードバトルのシミュレーション(戦闘システム設計書 10章)。engine.ts を そのまま使って試合を回し、全クリア率などを出す。
// 数値(HP・攻撃力・確率)を決めるための道具で、ゲームの画面からは使わない。`npm.cmd run sim` で simulate.sim.ts が回す
import { isJanken, mergeablePairs, randomInt, type Card, type JankenCard } from './cards';
import type { BattleConfig } from './config';
import {
  beginNextTurn,
  canUseSkill,
  cardDamage,
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
import { decideWinner, type RandomSource } from './logic';

/** smart:相手のマークを見て一番得な手を選ぶ「考えて遊ぶ子」 / random:ランダムに選ぶ「なんとなく選ぶ子」 */
export type Policy = 'smart' | 'random';

/** 種(seed)から同じ並びの乱数を作る(結果を くり返し出せるように) */
export function seededRandom(seed: number): RandomSource {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// 1ラウンドのターン数の上限(終わらない試合で止まらないための守り)
const TURN_LIMIT = 200;
// 考えて遊ぶ子が回復を使う HP の割合
const SMART_HEAL_RATIO = 0.5;

// 考えて遊ぶ子:そのカードを出したときの 得(与えるダメージ − 受けるダメージ)の見込み。
// 相手の手札のマーク(封じられた手は出てこない)は見えるが、★は見えないので 出やすさで見込む
function expectedGain(state: BattleState, card: JankenCard): number {
  const { config, cpu, player } = state;
  const choices = cpu.hand.filter((other) => other.hand !== cpu.sealedHand);
  const pool = choices.length > 0 ? choices : cpu.hand;
  const multiplier = cpu.charging ? config.chargeMultiplier : 1;
  const mine = cardDamage(config, card, player.attack);
  const weightTotal = config.starWeights.reduce((sum, weight) => sum + weight, 0);
  // 相手の★ごとの「受けるダメージ」と出やすさ
  const theirs = config.starDamage.map((damage, index) => ({
    star: index + 1,
    damage: (damage + cpu.attack) * multiplier,
    rate: config.starWeights[index] / weightTotal,
  }));
  const expectedLoss = theirs.reduce((sum, item) => sum + item.damage * item.rate, 0);

  let total = 0;
  for (const other of pool) {
    const result = decideWinner(card.hand, other.hand);
    if (result === 'player') total += mine;
    else if (result === 'cpu') total -= expectedLoss;
    else {
      // あいこ:★の多い方。同じなら連打(半々と見る)
      for (const item of theirs) {
        if (item.star < card.star) total += mine * item.rate;
        else if (item.star > card.star) total -= item.damage * item.rate;
        else total += (mine - item.damage) * 0.5 * item.rate;
      }
    }
  }
  return total / pool.length;
}

function pick<T>(items: T[], random: RandomSource): T {
  return items[Math.min(items.length - 1, Math.floor(random() * items.length))];
}

// 自分のターン:合成 → スキル → カードを出す(→ 連打)。出したあとの状態を返す
function playTurn(start: BattleState, policy: Policy, random: RandomSource, mashWinRate: number): BattleState {
  let state = start;

  // 合成:考えて遊ぶ子は できるだけ合成する。なんとなく選ぶ子は 半々
  for (let pairs = mergeablePairs(state.player.hand); pairs.length > 0; pairs = mergeablePairs(state.player.hand)) {
    if (policy === 'random' && random() < 0.5) break;
    state = mergeCards(state, pairs[0][0].id, pairs[0][1].id).state;
  }

  // スキル:考えて遊ぶ子は HP が減ったら回復、そうでなければ封じ手。なんとなく選ぶ子は 持っていれば半々で使う
  const usable = state.player.hand.filter((card) => canUseSkill(state, card));
  let skill: Card | undefined;
  if (policy === 'smart') {
    const low = state.player.hp <= state.player.maxHp * SMART_HEAL_RATIO;
    skill = usable.find((card) => card.kind === 'skill' && card.skill === 'heal' && low)
      ?? usable.find((card) => card.kind === 'skill' && card.skill === 'seal');
  } else if (usable.length > 0 && random() < 0.5) {
    skill = pick(usable, random);
  }
  if (skill) state = useSkill(state, skill.id, random).state;

  // 出すカード:必殺技があれば必殺技。考えて遊ぶ子は 得の見込みが一番大きいカード
  const finisher = state.player.hand.find((card) => card.kind === 'finisher');
  const jankens = state.player.hand.filter(isJanken);
  let chosen: Card;
  if (finisher) chosen = finisher;
  else if (policy === 'smart') {
    chosen = jankens.reduce((best, card) => (expectedGain(state, card) > expectedGain(state, best) ? card : best));
  } else chosen = pick(jankens, random);
  state = playCard(state, chosen.id).state;

  if (state.phase === 'rendan') {
    const win = random() < mashWinRate;
    state = resolveRendan(state, win ? 1 : 0, win ? 0 : 1).state;
  }
  return state;
}

export interface MatchResult {
  cleared: boolean;
  /** 勝ったラウンドの数(0〜3) */
  roundsWon: number;
  /** ラウンドごとのターン数(戦ったラウンドだけ) */
  turns: number[];
  finisherUsed: boolean;
  /** ため技を予告された / ため技のターン(勝つとダメージ2倍)まで行った */
  chargeAnnounced: boolean;
  chargeTurn: boolean;
}

/** 1試合を最後まで回す */
export function playMatch(
  config: BattleConfig,
  policy: Policy,
  random: RandomSource,
  options: { playerAttack?: number; mashWinRate?: number } = {},
): MatchResult {
  const attack = options.playerAttack ?? randomInt(random, config.playerAttack);
  const mashWinRate = options.mashWinRate ?? 0.5;
  let state = startMatch(config, attack, random);
  const turns: number[] = [];
  let roundsWon = 0;
  let chargeAnnounced = false;
  let chargeTurn = false;

  for (;;) {
    state = openPack(state, random).state;
    while (state.phase !== 'round_end' && state.turn < TURN_LIMIT) {
      state = playTurn(state, policy, random, mashWinRate);
      if (state.phase === 'turn_end') {
        state = beginNextTurn(state, random).state;
        if (state.cpu.chargeAnnounced) chargeAnnounced = true;
        if (state.cpu.charging) chargeTurn = true;
      }
    }
    turns.push(state.turn);
    if (state.roundResult === 'win') roundsWon += 1;
    const destination = state.roundResult ? roundDestination(state, state.roundResult) : 'defeat';
    if (destination !== 'next-round') {
      return { cleared: destination === 'clear', roundsWon, turns, finisherUsed: state.finisherUsed, chargeAnnounced, chargeTurn };
    }
    state = startNextRound(state, random);
  }
}

export interface SimSummary {
  matches: number;
  /** 全クリアした割合 */
  clearRate: number;
  /** ラウンドごとの「そのラウンドまで来た子のうち 勝った割合」 */
  roundWinRate: number[];
  /** ラウンドごとの平均ターン数(そのラウンドを戦った試合だけ) */
  roundTurns: number[];
  /** 1試合の平均ターン数(全ラウンドの合計。途中で負けた試合もふくむ) */
  totalTurns: number;
  /** 全クリアした試合だけの平均ターン数 */
  clearedTurns: number;
  /** 必殺技を使った(見られた)割合 */
  finisherRate: number;
  /** ボス(最後のラウンド)まで来た試合のうち、ため技の予告を見た割合 / ため技のターンまで行った割合 */
  chargeAnnouncedRate: number;
  chargeTurnRate: number;
}

/** matches 試合を回して まとめる */
export function simulate(
  config: BattleConfig,
  policy: Policy,
  options: { matches: number; seed?: number; playerAttack?: number; mashWinRate?: number },
): SimSummary {
  const random = seededRandom(options.seed ?? 1);
  const roundCount = config.rounds.length;
  const reached = Array.from({ length: roundCount }, () => 0);
  const won = Array.from({ length: roundCount }, () => 0);
  const turnSum = Array.from({ length: roundCount }, () => 0);
  let cleared = 0;
  let finishers = 0;
  let totalTurns = 0;
  let clearedTurns = 0;
  let lastReached = 0;
  let announced = 0;
  let chargeTurns = 0;

  for (let match = 0; match < options.matches; match += 1) {
    const result = playMatch(config, policy, random, options);
    if (result.cleared) {
      cleared += 1;
      clearedTurns += result.turns.reduce((sum, count) => sum + count, 0);
    }
    if (result.finisherUsed) finishers += 1;
    if (result.turns.length === roundCount) lastReached += 1;
    if (result.chargeAnnounced) announced += 1;
    if (result.chargeTurn) chargeTurns += 1;
    result.turns.forEach((count, index) => {
      reached[index] += 1;
      turnSum[index] += count;
      totalTurns += count;
      if (index < result.roundsWon) won[index] += 1;
    });
  }

  return {
    matches: options.matches,
    clearRate: cleared / options.matches,
    roundWinRate: reached.map((count, index) => (count ? won[index] / count : 0)),
    roundTurns: reached.map((count, index) => (count ? turnSum[index] / count : 0)),
    totalTurns: totalTurns / options.matches,
    clearedTurns: cleared ? clearedTurns / cleared : 0,
    finisherRate: finishers / options.matches,
    chargeAnnouncedRate: lastReached ? announced / lastReached : 0,
    chargeTurnRate: lastReached ? chargeTurns / lastReached : 0,
  };
}
