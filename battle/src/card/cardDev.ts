import { useEffect, useRef } from 'react';
import { sortHand, type Card, type CardFace, type JankenCard } from '../game/cards';
import type { BattleState } from '../game/engine';
import { cpuHandFor, type ForcedResult } from '../game/logic';

// 開発者メニュー(DevMenu.tsx)から カードバトルを動かすための決まりごと。
// - 命令(CardDevCommand):いま戦っている画面へ window の CustomEvent で送る。自分のターン(手札えらび)で効き、
//   ほかの場面で押したときは 次の自分のターンまで ためておく(useCardBattle.ts)
// - 演出を見る(CardDemoKind):バトルを作り直して、その演出が起きる手札・相手のカードを用意し、自分のターンから すぐ流す
// - 勝ち負けを決める(ForcedResult):カードを出したときに、相手の ふせたカードを その結果になる手に差しかえる

export type CardDevCommand =
  /** 必殺技・回復・封じ手・ドロー・リセットのカードを手札に足す(手札の上限 7枚は こえる) */
  | 'add-finisher'
  | 'add-heal'
  | 'add-seal'
  | 'add-draw3'
  | 'add-reset'
  /** 合体できるペア(グー★1 を2枚)を足す */
  | 'add-pair'
  /** 自分の HP を3割に(ピンチの点滅) */
  | 'player-pinch'
  /** 相手の HP を半分に(ボスなら 次のドローで必殺技が来る) */
  | 'cpu-half'
  /** 相手の HP を1に(次に勝てば倒せる) */
  | 'cpu-one'
  /** 相手に ため技を予告させる(次のターンに ためる) */
  | 'cpu-charge';

export type CardDemoKind = 'merge' | 'heal' | 'seal' | 'draw3' | 'reset' | 'finisher' | 'win' | 'lose' | 'rendan' | 'charge';

export type { ForcedResult };

const EVENT = 'monjan-card-dev';

/** 開発者メニューから 命令を送る */
export function sendCardDev(command: CardDevCommand) {
  window.dispatchEvent(new CustomEvent<CardDevCommand>(EVENT, { detail: command }));
}

/** 命令を受け取る(handler は毎回の描画のものを使う) */
export function useCardDev(handler: (command: CardDevCommand) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    const onCommand = (event: Event) => handlerRef.current((event as CustomEvent<CardDevCommand>).detail);
    window.addEventListener(EVENT, onCommand);
    return () => window.removeEventListener(EVENT, onCommand);
  }, []);
}

// 足したカードの id(通し番号は 状態が持つ)
function withCards(state: BattleState, faces: CardFace[]): { state: BattleState; added: Card[] } {
  const added = faces.map((face, index) => ({ ...face, id: `c${state.cardSeq + index + 1}` }) as Card);
  return {
    state: { ...state, cardSeq: state.cardSeq + faces.length, player: { ...state.player, hand: sortHand([...state.player.hand, ...added]) } },
    added,
  };
}

/** 命令を 状態に当てる。focusId は カーソルを置くカード(足したカード) */
export function applyCardDev(state: BattleState, command: CardDevCommand): { state: BattleState; focusId?: string } {
  const add = (...faces: CardFace[]) => {
    const result = withCards(state, faces);
    return { state: result.state, focusId: result.added[0]?.id };
  };
  switch (command) {
    case 'add-finisher': return add({ kind: 'finisher' });
    case 'add-heal': return add({ kind: 'skill', skill: 'heal' });
    case 'add-seal': return add({ kind: 'skill', skill: 'seal' });
    case 'add-draw3': return add({ kind: 'skill', skill: 'draw3' });
    case 'add-reset': return add({ kind: 'skill', skill: 'reset' });
    case 'add-pair': return add({ kind: 'janken', hand: 'rock', star: 1 }, { kind: 'janken', hand: 'rock', star: 1 });
    case 'player-pinch': return { state: { ...state, player: { ...state.player, hp: Math.floor(state.player.maxHp * 0.3) } } };
    case 'cpu-half': return { state: { ...state, cpu: { ...state.cpu, hp: Math.max(1, Math.floor(state.cpu.maxHp * 0.5)) } } };
    case 'cpu-one': return { state: { ...state, cpu: { ...state.cpu, hp: 1 } } };
    case 'cpu-charge': return { state: { ...state, cpu: { ...state.cpu, chargeAnnounced: true } } };
  }
}

/**
 * 勝ち負けを決める:相手の ふせたカードを、出すカードに対して その結果になる手に差しかえる
 * (かつ・まける は ★も同じにして ★の差で ひっくり返らないように。あいこ は ★も同じ = 連打勝負)
 */
export function forceCpuCard(state: BattleState, playerCard: JankenCard, mode: ForcedResult): BattleState {
  if (mode === 'normal' || !state.cpu.placedId) return state;
  const hand = cpuHandFor(playerCard.hand, mode);
  const cpuHand = state.cpu.hand.map((card) => (card.id === state.cpu.placedId ? { ...card, hand, star: playerCard.star } : card));
  return { ...state, cpu: { ...state.cpu, hand: cpuHand } };
}

// ---- 演出を見る ----

/** 演出で出す(使う)カードの id */
export const DEMO_CARD_ID = 'dev-demo';

const jk = (id: string, hand: JankenCard['hand'], star: JankenCard['star']): JankenCard => ({ id, kind: 'janken', hand, star });

/** 相手の ふせたカードを決める(手札の先頭を 差しかえて ふせる) */
function placeCpu(state: BattleState, card: JankenCard, extra: Partial<BattleState['cpu']> = {}): BattleState {
  const rest = state.cpu.hand.filter((other) => other.id !== state.cpu.placedId).slice(0, 2);
  return { ...state, cpu: { ...state.cpu, ...extra, hand: [card, ...rest], placedId: card.id, sealedHand: null } };
}

function withHand(state: BattleState, hand: Card[], hp = state.player.hp): BattleState {
  return { ...state, player: { ...state.player, hand: sortHand(hand), hp } };
}

/** その演出が起きる手札・相手のカードにする(パックを開けたあとの状態に当てる) */
export function demoSetup(kind: CardDemoKind): (state: BattleState) => BattleState {
  return (state) => {
    const filler = [jk('dev-f1', 'scissors', 1), jk('dev-f2', 'paper', 2)];
    // 出すカード(勝ち負けの演出)。スキルの演出では スキルが DEMO_CARD_ID なので、そばに置くカードは べつの id(keep)にする。
    // 同じ id が2枚あると React の key が重なり、使ったカードの枠が 手札に残ってしまう(2026年11月18日 依頼者が いれかえ で見つけた)
    const play = jk(DEMO_CARD_ID, 'rock', 2);
    const keep = jk('dev-keep', 'rock', 2);
    switch (kind) {
      case 'merge':
        return withHand(state, [jk(DEMO_CARD_ID, 'rock', 1), jk('dev-pair', 'rock', 1), ...filler]);
      case 'heal':
        return withHand(state, [{ id: DEMO_CARD_ID, kind: 'skill', skill: 'heal' }, keep, ...filler], Math.floor(state.player.maxHp * 0.4));
      case 'seal':
        return withHand(state, [{ id: DEMO_CARD_ID, kind: 'skill', skill: 'seal' }, keep, ...filler]);
      case 'draw3':
        // 4枚 → 使って3枚 → 3枚 引いて 6枚
        return withHand(state, [{ id: DEMO_CARD_ID, kind: 'skill', skill: 'draw3' }, keep, ...filler]);
      case 'reset':
        // 5枚(使ったリセットのほか 4枚)を すてて 5枚 引きなおす
        return withHand(state, [{ id: DEMO_CARD_ID, kind: 'skill', skill: 'reset' }, keep, ...filler, jk('dev-f3', 'rock', 1)]);
      case 'finisher':
        return withHand(state, [{ id: DEMO_CARD_ID, kind: 'finisher' }, ...filler]);
      case 'win':
        return placeCpu(withHand(state, [play, ...filler]), jk('dev-cpu', 'scissors', 2));
      case 'lose':
        return placeCpu(withHand(state, [play, ...filler]), jk('dev-cpu', 'paper', 2));
      case 'rendan':
        return placeCpu(withHand(state, [play, ...filler]), jk('dev-cpu', 'rock', 2));
      case 'charge':
        // ためた相手に負ける → ダメージ 2ばい
        return placeCpu(withHand(state, [play, ...filler]), jk('dev-cpu', 'paper', 2), { charging: true, chargeAnnounced: false });
    }
  };
}
