// カードバトルの進み方(戦闘システム設計書 5章・6章)。画面を持たない pure function で、状態を受けて 新しい状態と「起きたこと」を返す。
//
// 1ラウンドの流れ(phase):
//   pack ─openPack→ player ─(mergeCards / useSkill)→ player ─playCard→ turn_end ─beginNextTurn→ player …
//                                                      └ 同じ手・同じ★ → rendan ─resolveRendan→ turn_end
//   どちらかの HP が 0 → round_end ─(roundDestination で行き先)─ startNextRound → pack
//
// 「起きたこと」(BattleEvent)は起きた順に並ぶ。画面はこれを順に演出する
import type { Hand } from '../types';
import {
  canMerge,
  canSeal,
  isJanken,
  mergedFace,
  pickIndex,
  randomInt,
  rollDraw,
  rollJanken,
  rollPack,
  sortHand,
  type Card,
  type CardFace,
  type JankenCard,
} from './cards';
import type { BattleConfig, RoundConfig } from './config';
import { decideMashDuel, decideWinner, type RandomSource } from './logic';

export type Side = 'player' | 'cpu';
export type EnginePhase = 'pack' | 'player' | 'rendan' | 'turn_end' | 'round_end';
export type RoundResult = 'win' | 'lose';
/** ラウンドの終わりの行き先:次のラウンド / 全クリア(リザルト)/ 負け(リザルト) */
export type RoundDestination = 'next-round' | 'clear' | 'defeat';

export interface PlayerState {
  hp: number;
  maxHp: number;
  attack: number;
  hand: Card[];
  /** このターンに使ったスキルの枚数 */
  skillsUsed: number;
  /** このラウンドで出た回復カードの枚数(パックとドローを合わせて) */
  healDrawn: number;
}

export interface CpuState {
  hp: number;
  maxHp: number;
  attack: number;
  /** 手札(ユーザーには手のマークだけ見せる)。ふせたカードも この中にある */
  hand: JankenCard[];
  /** ふせたカードの id */
  placedId: string | null;
  /** 封じられた手(そのターンだけ) */
  sealedHand: Hand | null;
  healUsed: boolean;
  /** ため技:このターン、CPU が勝つとダメージが倍 */
  charging: boolean;
  /** ため技を予告した(次のターンに charging になる) */
  chargeAnnounced: boolean;
}

export interface BattleState {
  config: BattleConfig;
  /** 1 = 練習、2 = 2体目、3 = ボス */
  round: number;
  turn: number;
  phase: EnginePhase;
  /** 必殺技を使った(1試合に1回) */
  finisherUsed: boolean;
  /** カードの id の通し番号 */
  cardSeq: number;
  player: PlayerState;
  cpu: CpuState;
  /** 連打勝負を待っている2枚(phase が rendan のあいだ) */
  pending: { playerCard: JankenCard; cpuCard: JankenCard } | null;
  roundResult: RoundResult | null;
}

export type BattleEvent =
  | { type: 'pack'; cards: Card[] }
  | { type: 'draw'; card: Card }
  | { type: 'cpu-heal'; amount: number }
  | { type: 'cpu-charge-announce' }
  | { type: 'cpu-place' }
  | { type: 'merge'; from: [JankenCard, JankenCard]; card: JankenCard }
  | { type: 'heal'; amount: number }
  | { type: 'seal'; hand: Hand }
  // by:勝ち負けが決まった理由(hand = じゃんけん、star = あいこで★が多い)。winner が rendan なら連打勝負へ
  | { type: 'janken'; playerCard: JankenCard; cpuCard: JankenCard; winner: Side | 'rendan'; by: 'hand' | 'star' }
  | { type: 'rendan'; playerPresses: number; cpuPresses: number; winner: Side }
  | { type: 'finisher' }
  // charged:ため技で倍になった
  | { type: 'damage'; target: Side; amount: number; charged: boolean }
  // ため技のターンにユーザーが勝った(「ふせいだ!」)
  | { type: 'charge-blocked' }
  | { type: 'round-end'; result: RoundResult; destination: RoundDestination };

export interface Step {
  state: BattleState;
  events: BattleEvent[];
}

export function roundConfig(state: Pick<BattleState, 'config' | 'round'>): RoundConfig {
  const { rounds } = state.config;
  return rounds[Math.min(rounds.length, Math.max(1, state.round)) - 1];
}

/** できない操作(phase が違う・カードがない など)。画面は操作を出さないようにし、ここは守りとして投げる */
function fail(message: string): never {
  throw new Error(`カードバトル:${message}`);
}

function need(state: BattleState, phase: EnginePhase) {
  if (state.phase !== phase) fail(`phase が ${phase} のときだけできます(いまは ${state.phase})`);
}

// id を付ける(通し番号は状態が持つ)
function withIds(state: BattleState, faces: CardFace[]): { cards: Card[]; cardSeq: number } {
  const cards = faces.map((face, index) => ({ ...face, id: `c${state.cardSeq + index + 1}` }) as Card);
  return { cards, cardSeq: state.cardSeq + faces.length };
}

// ---- 試合・ラウンドのはじまり ----

// ラウンドのはじまり:ユーザーの HP は全回復、手札は捨てる。CPU の数値はラウンドごとの値
function setupRound(base: BattleState, round: number, random: RandomSource): BattleState {
  const config = roundConfig({ config: base.config, round });
  const cpuHp = randomInt(random, config.cpuHp);
  return {
    ...base,
    round,
    turn: 1,
    phase: 'pack',
    pending: null,
    roundResult: null,
    player: { ...base.player, hp: base.player.maxHp, hand: [], skillsUsed: 0, healDrawn: 0 },
    cpu: {
      hp: cpuHp,
      maxHp: cpuHp,
      attack: randomInt(random, config.cpuAttack),
      hand: [],
      placedId: null,
      sealedHand: null,
      healUsed: false,
      charging: false,
      chargeAnnounced: false,
    },
  };
}

/** 試合のはじまり(1体目のパック選びから)。playerAttack はユーザーのモンスターの攻撃力 */
export function startMatch(config: BattleConfig, playerAttack: number, random: RandomSource = Math.random): BattleState {
  const maxHp = randomInt(random, config.playerHp);
  const base: BattleState = {
    config,
    round: 1,
    turn: 1,
    phase: 'pack',
    finisherUsed: false,
    cardSeq: 0,
    player: { hp: maxHp, maxHp, attack: playerAttack, hand: [], skillsUsed: 0, healDrawn: 0 },
    cpu: { hp: 0, maxHp: 0, attack: 0, hand: [], placedId: null, sealedHand: null, healUsed: false, charging: false, chargeAnnounced: false },
    pending: null,
    roundResult: null,
  };
  return setupRound(base, 1, random);
}

// CPU の手札を cpuHandSize 枚にする(練習は全部グー)
function fillCpuHand(state: BattleState, random: RandomSource): BattleState {
  const round = roundConfig(state);
  const missing = Math.max(0, state.config.cpuHandSize - state.cpu.hand.length);
  const faces = Array.from({ length: missing }, () => rollJanken(state.config, random, round.cpuAllRock ? 'rock' : undefined));
  const { cards, cardSeq } = withIds(state, faces);
  return { ...state, cardSeq, cpu: { ...state.cpu, hand: [...state.cpu.hand, ...(cards as JankenCard[])] } };
}

// ふせるカードを、封じられていない手の中から ランダムに選ぶ
function placeCpuCard(state: BattleState, random: RandomSource): BattleState {
  const choices = state.cpu.hand.filter((card) => card.hand !== state.cpu.sealedHand);
  const pool = choices.length > 0 ? choices : state.cpu.hand;
  return { ...state, cpu: { ...state.cpu, placedId: pool[pickIndex(random, pool.length)].id } };
}

// 相手のターン:回復(HP が4割以下で1回)→ ため技(予告の次のターンに ためる / chargeInterval ターンごとに予告)→ 1枚ふせる
function cpuTurn(state: BattleState, random: RandomSource): Step {
  const round = roundConfig(state);
  const events: BattleEvent[] = [];
  let cpu = { ...state.cpu, sealedHand: null };

  if (round.cpuHeal && !cpu.healUsed && cpu.hp <= cpu.maxHp * state.config.cpuHealHpRatio) {
    const amount = Math.min(state.config.cpuHealAmount, cpu.maxHp - cpu.hp);
    cpu = { ...cpu, hp: cpu.hp + amount, healUsed: true };
    events.push({ type: 'cpu-heal', amount });
  }

  if (cpu.chargeAnnounced) {
    cpu = { ...cpu, charging: true, chargeAnnounced: false };
  } else {
    const announce = round.cpuCharge && state.config.chargeInterval > 0 && state.turn % state.config.chargeInterval === 0;
    cpu = { ...cpu, charging: false, chargeAnnounced: announce };
    if (announce) events.push({ type: 'cpu-charge-announce' });
  }

  events.push({ type: 'cpu-place' });
  return { state: placeCpuCard({ ...state, cpu, phase: 'player' }, random), events };
}

/** パックを開ける:5枚をもらい、CPU も手札をそろえて1枚ふせる。自分のターンへ */
export function openPack(state: BattleState, random: RandomSource = Math.random): Step {
  need(state, 'pack');
  const pack = rollPack(state.config, roundConfig(state), random, state.player.healDrawn);
  const { cards, cardSeq } = withIds(state, pack.cards);
  const dealt: BattleState = {
    ...state,
    cardSeq,
    player: { ...state.player, hand: sortHand(cards), healDrawn: pack.healDrawn, skillsUsed: 0 },
  };
  const cpu = cpuTurn(fillCpuHand(dealt, random), random);
  return { state: cpu.state, events: [{ type: 'pack', cards }, ...cpu.events] };
}

// ---- 自分のターン ----

function findCard(state: BattleState, cardId: string): Card {
  return state.player.hand.find((card) => card.id === cardId) ?? fail(`手札にないカードです(${cardId})`);
}

/** 合成:同じ手・同じ★の2枚を、★が1つ上の1枚にする(何回でも。スキルの枠は使わない) */
export function mergeCards(state: BattleState, cardIdA: string, cardIdB: string): Step {
  need(state, 'player');
  const a = findCard(state, cardIdA);
  const b = findCard(state, cardIdB);
  if (!canMerge(a, b) || !isJanken(a) || !isJanken(b)) fail('合成できない組み合わせです');
  const { cards, cardSeq } = withIds(state, [mergedFace(a)]);
  const merged = cards[0] as JankenCard;
  const hand = sortHand([...state.player.hand.filter((card) => card.id !== a.id && card.id !== b.id), merged]);
  return {
    state: { ...state, cardSeq, player: { ...state.player, hand } },
    events: [{ type: 'merge', from: [a, b], card: merged }],
  };
}

/** そのスキルカードを いま使えるか(1ターンの上限・封じ手は相手の手が2種類以上) */
export function canUseSkill(state: BattleState, card: Card): boolean {
  if (state.phase !== 'player' || card.kind !== 'skill') return false;
  if (state.player.skillsUsed >= state.config.skillPerTurn) return false;
  return card.skill === 'heal' || canSeal(state.cpu.hand);
}

/** 回復カードで もどる量(満タンまで) */
export function healAmount(state: BattleState): number {
  return state.player.maxHp - state.player.hp;
}

/**
 * スキルを使う(その場で効果が出る)。
 * 回復:HP が満タンにもどる / 封じ手:相手が持っている手の種類からランダムに1つ封じ、相手は ふせたカードを かならず出し直す
 */
export function useSkill(state: BattleState, cardId: string, random: RandomSource = Math.random): Step {
  need(state, 'player');
  const card = findCard(state, cardId);
  if (card.kind !== 'skill' || !canUseSkill(state, card)) fail('そのスキルは いま使えません');
  const player = {
    ...state.player,
    hand: state.player.hand.filter((other) => other.id !== card.id),
    skillsUsed: state.player.skillsUsed + 1,
  };

  if (card.skill === 'heal') {
    const amount = healAmount(state);
    return { state: { ...state, player: { ...player, hp: player.maxHp } }, events: [{ type: 'heal', amount }] };
  }

  const kinds = [...new Set(state.cpu.hand.map((other) => other.hand))];
  const sealedHand = kinds[pickIndex(random, kinds.length)];
  const sealed: BattleState = { ...state, player, cpu: { ...state.cpu, sealedHand } };
  return { state: placeCpuCard(sealed, random), events: [{ type: 'seal', hand: sealedHand }, { type: 'cpu-place' }] };
}

// ---- 勝負 ----

/** そのカードで勝ったときのダメージ(★のダメージ + 攻撃力) */
export function cardDamage(config: BattleConfig, card: JankenCard, attack: number): number {
  return config.starDamage[card.star - 1] + attack;
}

/** ラウンドの終わりの行き先を決める(ここ1か所。「負けても次へ進む」に変えるときは ここだけ直す) */
export function roundDestination(state: Pick<BattleState, 'config' | 'round'>, result: RoundResult): RoundDestination {
  if (result === 'lose') return 'defeat';
  return state.round < state.config.rounds.length ? 'next-round' : 'clear';
}

// ターンの片づけ(ふせたカードを手札から外す・封じ手を解く)と、ラウンドが終わったかの判定
function closeTurn(state: BattleState, events: BattleEvent[]): Step {
  const cpu = {
    ...state.cpu,
    hand: state.cpu.hand.filter((card) => card.id !== state.cpu.placedId),
    placedId: null,
    sealedHand: null,
  };
  const result: RoundResult | null = cpu.hp <= 0 ? 'win' : state.player.hp <= 0 ? 'lose' : null;
  const closed: BattleState = { ...state, cpu, pending: null };
  if (!result) return { state: { ...closed, phase: 'turn_end' }, events };
  return {
    state: { ...closed, phase: 'round_end', roundResult: result },
    events: [...events, { type: 'round-end', result, destination: roundDestination(state, result) }],
  };
}

// 勝った側が、出したカードのダメージを与える(CPU の ため技は倍。練習では自分の HP が playerHpFloor より下がらない)
function strike(state: BattleState, winner: Side, playerCard: JankenCard, cpuCard: JankenCard, events: BattleEvent[]): Step {
  const { config } = state;
  if (winner === 'player') {
    const amount = cardDamage(config, playerCard, state.player.attack);
    const cpu = { ...state.cpu, hp: Math.max(0, state.cpu.hp - amount) };
    const blocked: BattleEvent[] = state.cpu.charging ? [{ type: 'charge-blocked' }] : [];
    return closeTurn({ ...state, cpu }, [...events, ...blocked, { type: 'damage', target: 'cpu', amount, charged: false }]);
  }
  const charged = state.cpu.charging;
  const amount = cardDamage(config, cpuCard, state.cpu.attack) * (charged ? config.chargeMultiplier : 1);
  const hp = Math.max(roundConfig(state).playerHpFloor, state.player.hp - amount);
  return closeTurn(
    { ...state, player: { ...state.player, hp: Math.min(state.player.hp, hp) } },
    [...events, { type: 'damage', target: 'player', amount, charged }],
  );
}

function placedCard(state: BattleState): JankenCard {
  return state.cpu.hand.find((card) => card.id === state.cpu.placedId) ?? fail('相手がカードを ふせていません');
}

/**
 * じゃんけんカードか必殺技を出す(出した時点でターンが進む)。
 * じゃんけん → あいこは★の多い方 → ★も同じなら連打勝負(phase が rendan になる)。必殺技は かならず相手を倒す
 */
export function playCard(state: BattleState, cardId: string): Step {
  need(state, 'player');
  const card = findCard(state, cardId);
  if (card.kind === 'skill') fail('スキルは useSkill で使います');
  const player = { ...state.player, hand: state.player.hand.filter((other) => other.id !== card.id) };

  if (card.kind === 'finisher') {
    const amount = state.cpu.hp;
    return closeTurn(
      { ...state, player, finisherUsed: true, cpu: { ...state.cpu, hp: 0 } },
      [{ type: 'finisher' }, { type: 'damage', target: 'cpu', amount, charged: false }],
    );
  }

  const cpuCard = placedCard(state);
  const played: BattleState = { ...state, player };
  const byHand = decideWinner(card.hand, cpuCard.hand);
  if (byHand !== 'tie') {
    return strike(played, byHand, card, cpuCard, [{ type: 'janken', playerCard: card, cpuCard, winner: byHand, by: 'hand' }]);
  }
  if (card.star !== cpuCard.star) {
    const winner: Side = card.star > cpuCard.star ? 'player' : 'cpu';
    return strike(played, winner, card, cpuCard, [{ type: 'janken', playerCard: card, cpuCard, winner, by: 'star' }]);
  }
  return {
    state: { ...played, phase: 'rendan', pending: { playerCard: card, cpuCard } },
    events: [{ type: 'janken', playerCard: card, cpuCard, winner: 'rendan', by: 'star' }],
  };
}

/** 連打勝負の結果:多く押した方の勝ち。同じ数は mashTieWinner の勝ち */
export function resolveRendan(state: BattleState, playerPresses: number, cpuPresses: number): Step {
  need(state, 'rendan');
  const pending = state.pending ?? fail('連打勝負のカードがありません');
  const duel = decideMashDuel(playerPresses, cpuPresses);
  const winner: Side = duel === 'none' ? state.config.mashTieWinner : duel;
  return strike(state, winner, pending.playerCard, pending.cpuCard, [{ type: 'rendan', playerPresses, cpuPresses, winner }]);
}

// ---- 次のターン・次のラウンド ----

// 必殺技が来る確率(いま満たしている条件ごと)。使ったあと・手札にあるあいだは来ない
function finisherChances(state: BattleState): number[] {
  if (state.finisherUsed || state.player.hand.some((card) => card.kind === 'finisher')) return [];
  const round = roundConfig(state);
  const chances: number[] = [];
  if (state.cpu.hp <= state.cpu.maxHp * state.config.finisherCpuHpRatio) chances.push(round.finisherChance);
  if (state.player.hp <= state.player.maxHp * state.config.comebackHpRatio) chances.push(round.comebackChance);
  return chances;
}

/** 次のターン:お互い1枚引く(手札の上限まで)→ 相手のターン → 自分のターンへ */
export function beginNextTurn(state: BattleState, random: RandomSource = Math.random): Step {
  need(state, 'turn_end');
  const events: BattleEvent[] = [];
  let next: BattleState = { ...state, turn: state.turn + 1, player: { ...state.player, skillsUsed: 0 } };

  if (next.player.hand.length < next.config.handLimit) {
    const face = rollDraw(
      next.config,
      {
        finisherChances: finisherChances(next),
        hasJanken: next.player.hand.some(isJanken),
        healAvailable: next.player.healDrawn < next.config.healPerRound,
      },
      random,
    );
    const { cards, cardSeq } = withIds(next, [face]);
    const card = cards[0];
    const healDrawn = next.player.healDrawn + (card.kind === 'skill' && card.skill === 'heal' ? 1 : 0);
    next = { ...next, cardSeq, player: { ...next.player, hand: sortHand([...next.player.hand, card]), healDrawn } };
    events.push({ type: 'draw', card });
  }

  const cpu = cpuTurn(fillCpuHand(next, random), random);
  return { state: cpu.state, events: [...events, ...cpu.events] };
}

/** 次のラウンドへ(行き先が next-round のときだけ)。ユーザーの HP は全回復、手札は捨てる。パック選びから */
export function startNextRound(state: BattleState, random: RandomSource = Math.random): BattleState {
  need(state, 'round_end');
  if (!state.roundResult || roundDestination(state, state.roundResult) !== 'next-round') fail('次のラウンドはありません');
  return setupRound(state, state.round + 1, random);
}
