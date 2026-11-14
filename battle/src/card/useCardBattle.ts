import { useEffect, useRef, useState } from 'react';
import type { GameSound, GameSoundOptions } from '../audio/gameAudio';
import { canSeal, isJanken, mergeablePairs, sortHand, type Card, type CardFace, type JankenCard } from '../game/cards';
import type { BattleConfig } from '../game/config';
import {
  beginNextTurn,
  canUseSkill,
  mergeCards,
  openPack,
  playCard,
  resolveRendan,
  startMatch,
  useSkill,
  type BattleEvent,
  type BattleState,
  type Side,
} from '../game/engine';
import { pickCpuMash, type RandomSource } from '../game/logic';
import { useTimers } from '../hooks/useTimers';
import type { PadButton } from '../integration';
import type { Hand } from '../types';
import { useCardDev, type CardDevCommand } from './cardDev';
import {
  CARD_ATTACK_MS,
  CARD_DAMAGE_MS,
  CARD_CLASH_IN_MS,
  CARD_CPU_PLACE_MS,
  CARD_CPU_THINK_MS,
  CARD_DRAW_MS,
  CARD_FINISHER_ATTACK_MS,
  CARD_FINISHER_DRAW_MS,
  CARD_HEAL_MS,
  CARD_JANKEN_BEAT_MS,
  CARD_PLAYER_TURN_BANNER_MS,
  CARD_REVEAL_MS,
  CARD_SKILL_MS,
  MASH_DUEL_MS,
  MASH_RESULT_MS,
  SPECIAL_CUTIN_SLAM_MS,
  SPECIAL_DISPLAY_MS,
  SPECIAL_SECOND_IMPACT_MS,
} from '../timings';

// カードバトルの画面の進み方(戦闘システム設計書 6章・7章)。
// 勝ち負けの計算は game/engine.ts。ここは「いつ・何を見せるか」と、3つのボタン(← ・決定・→)の受け方を持つ。
//
// 見せる段階(view):
//   cpu-turn(相手のターン:カードを えらんで 裏向きで置く)→ player(手札をえらぶ。合成・スキルは ここで使い、notice で結果を少し見せて player にもどる)
//   → janken(じゃん・けん・ぽん)→ reveal(めくる)→(rendan → rendan-result)→ attack(勝った側が前へ出て 飛び道具)→ damage(命中)
//   → draw →(相手のスキルは notice)→ cpu-turn → player …
//   必殺技は player → finisher(カットイン)→ attack → damage。攻撃と命中の見せ方は main のバトル(BattleScreen.tsx)と同じ
//   どちらかの HP が 0 になったら round-end

export type CardBattleView =
  | 'cpu-turn'
  | 'player'
  | 'notice'
  | 'janken'
  | 'reveal'
  | 'rendan'
  | 'rendan-result'
  | 'finisher'
  | 'attack'
  | 'damage'
  | 'draw'
  | 'round-end';

/** 手札の並びの1つ:「がったい!」の枠(合成できるペアがあるときだけ左はし)か、カード */
export type HandItem = { kind: 'merge' } | { kind: 'card'; card: Card };

/** 場に出た2枚と、じゃんけんの結果(winner が rendan なら連打勝負へ) */
export interface Clash {
  playerCard: JankenCard;
  cpuCard: JankenCard;
  winner: Side | 'rendan';
  by: 'hand' | 'star';
}

export interface DamageShown {
  target: Side;
  amount: number;
  charged: boolean;
  /** 当たりの強さ(揺れ・粒の大きさ):勝ったカードの★の数。ため技の2倍は 3 */
  power: 1 | 2 | 3;
  /** 必殺技の一撃 */
  finisher: boolean;
  /** とどめ(この一撃で HP が0になる) */
  final: boolean;
}

/** 合成・スキルを使ったあとに少し見せる ひとこと */
export type Notice =
  | { type: 'merge'; card: JankenCard }
  | { type: 'heal'; amount: number }
  | { type: 'seal'; hand: Hand }
  // 相手のスキル(ターンのはじめ):回復・ため技の予告
  | { type: 'cpu-heal'; amount: number }
  | { type: 'cpu-charge' };

/** ため技のターンの結果:ためた相手が勝って2倍 / こちらが勝って ふせいだ */
export type ChargeNote = 'charged' | 'blocked';

// 次のターンのはじめに起きた 相手のスキルを、順に見せる ひとことにする
function cpuNotices(events: BattleEvent[]): Notice[] {
  return events.flatMap((event): Notice[] => {
    if (event.type === 'cpu-heal') return [{ type: 'cpu-heal', amount: event.amount }];
    if (event.type === 'cpu-charge-announce') return [{ type: 'cpu-charge' }];
    return [];
  });
}

type PlaySound = (sound: GameSound, options?: GameSoundOptions) => void;

/** 手札の並び(合成できるペアがあれば、左はしに「がったい!」の枠) */
export function handItems(hand: Card[]): HandItem[] {
  const cards = hand.map((card): HandItem => ({ kind: 'card', card }));
  return mergeablePairs(hand).length > 0 ? [{ kind: 'merge' }, ...cards] : cards;
}

/** カーソルの最初の位置:じゃんけんカードの先頭(なければ 必殺技、それもなければ 0) */
export function itemCursor(items: HandItem[]): number {
  const janken = items.findIndex((item) => item.kind === 'card' && isJanken(item.card));
  if (janken >= 0) return janken;
  return Math.max(0, items.findIndex((item) => item.kind === 'card' && item.card.kind === 'finisher'));
}

/** そのスキルを いま使えない理由(使えるなら null) */
export function skillBlockedReason(state: BattleState, card: Card): string | null {
  if (card.kind !== 'skill' || canUseSkill(state, card)) return null;
  if (state.player.skillsUsed >= state.config.skillPerTurn) return 'スキルは 1ターンに 1まいまで！';
  if (card.skill === 'seal' && !canSeal(state.cpu.hand)) return 'あいての 手が ぜんぶ おなじなので つかえない';
  return 'いまは つかえない';
}

export function useCardBattle({
  config,
  playerAttack,
  random = Math.random,
  playSound,
  attributes = { player: '', cpu: '' },
  setup,
}: {
  config: BattleConfig;
  playerAttack: number;
  random?: RandomSource;
  playSound: PlaySound;
  /** 自分と相手のタイプ(攻撃の音を タイプで変える) */
  attributes?: Record<Side, string>;
  /** パックを開けたあとの状態を差しかえる(テスト・開発者メニュー用) */
  setup?: (state: BattleState) => BattleState;
}) {
  const { schedule, clearTimers } = useTimers();
  // いまは パック選びの画面がないので、はじまりに そのままパックを開ける(パック選びは段階2b)
  const deal = () => {
    const dealt = openPack(startMatch(config, playerAttack, random), random).state;
    return setup ? setup(dealt) : dealt;
  };

  // 画面に見せている状態。じゃんけんの あいだは「出す前」のままにして、ダメージのところで「出したあと」に入れかえる
  const [state, setState] = useState<BattleState>(deal);
  // ラウンドのはじめは 相手のターンから(はじめの予約は 下の useEffect)
  const [view, setView] = useState<CardBattleView>('cpu-turn');
  // 相手のターンの段:考える(手札がゆれる)→ ふせる(裏向きのカードが場へ)
  const [cpuStep, setCpuStep] = useState<'think' | 'place'>('think');
  // 自分のターンに入ったところ(「あなたの ターン!」を少し出す)
  const [turnBanner, setTurnBanner] = useState(false);
  const [cursor, setCursor] = useState(() => itemCursor(handItems(state.player.hand)));
  // 決定の1回目で カードが浮いている(2回目で使う。←→で取り消し)
  const [armed, setArmed] = useState(false);
  // 合成できるペアが2組以上のとき、どれを合成するかを えらんでいる(0 から。ペアの数 = やめる)
  const [mergePick, setMergePick] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);
  // じゃん(1)・けん(2)・ぽん(3)
  const [beat, setBeat] = useState(0);
  const [damage, setDamage] = useState<DamageShown | null>(null);
  // 連打勝負:自分の回数(数えるのは ref。表示のために state にも入れる)・CPU の回数・勝った側
  const [mash, setMash] = useState(0);
  const mashRef = useRef(0);
  const [cpuMash, setCpuMash] = useState(0);
  const [rendanWinner, setRendanWinner] = useState<Side | null>(null);
  // ドローで引いたカード(必殺技なら 長めに知らせる)
  const [drawn, setDrawn] = useState<Card | null>(null);
  const [chargeNote, setChargeNote] = useState<ChargeNote | null>(null);
  // 必殺技の一撃(ダメージを特大で見せる)
  const [finisherHit, setFinisherHit] = useState(false);

  const items = handItems(state.player.hand);
  const pairs = mergeablePairs(state.player.hand);

  // 手札が変わったあと:カーソルを id のカードに(なければ じゃんけんカードの先頭に)
  const placeCursor = (next: BattleState, cardId?: string) => {
    const nextItems = handItems(next.player.hand);
    const index = cardId ? nextItems.findIndex((item) => item.kind === 'card' && item.card.id === cardId) : -1;
    setCursor(index >= 0 ? index : itemCursor(nextItems));
  };

  // 相手のターン:考える(「カードを えらんでいる…」)→ ふせる(裏向きのカードが場へ飛んで置かれる)→ 自分のターンへ
  const startCpuTurn = () => {
    setView('cpu-turn');
    setCpuStep('think');
    schedule(() => {
      setCpuStep('place');
      playSound('select');
    }, CARD_CPU_THINK_MS);
    schedule(() => {
      setView('player');
      playSound('reveal');
      setTurnBanner(true);
      schedule(() => setTurnBanner(false), CARD_PLAYER_TURN_BANNER_MS);
    }, CARD_CPU_THINK_MS + CARD_CPU_PLACE_MS);
  };

  // はじめのターン:相手のターンから(StrictMode で2回呼ばれても、片づけで予約は消える)
  useEffect(() => {
    startCpuTurn();
  }, []);

  // 相手のスキル(回復・ため技の予告)を1つずつ見せてから、相手のターンへ
  const showCpuNotices = (list: Notice[]) => {
    const [first, ...rest] = list;
    if (!first) {
      setNotice(null);
      startCpuTurn();
      return;
    }
    setNotice(first);
    setView('notice');
    playSound(first.type === 'cpu-heal' ? 'heal' : 'star-showdown');
    schedule(() => showCpuNotices(rest), first.type === 'cpu-heal' ? CARD_HEAL_MS : CARD_SKILL_MS);
  };

  // 勝負がついたあと:攻撃(勝った側が前へ出て 飛び道具)→ 命中(showImpact)
  const strike = (after: BattleState, events: BattleEvent[]) => {
    const hit = events.find((event) => event.type === 'damage');
    const finisher = events.some((event) => event.type === 'finisher');
    const janken = events.find((event) => event.type === 'janken');
    let shown: DamageShown | null = null;
    if (hit && hit.type === 'damage') {
      const winner: Side = hit.target === 'cpu' ? 'player' : 'cpu';
      const card = janken && janken.type === 'janken' ? (winner === 'player' ? janken.playerCard : janken.cpuCard) : null;
      shown = {
        target: hit.target,
        amount: hit.amount,
        charged: hit.charged,
        power: finisher || hit.charged ? 3 : card?.star ?? 1,
        finisher,
        final: after.phase === 'round_end',
      };
    }
    setDamage(shown);
    setChargeNote(shown?.charged ? 'charged' : events.some((event) => event.type === 'charge-blocked') ? 'blocked' : null);
    setFinisherHit(finisher);
    if (!shown) {
      showImpact(after, false);
      return;
    }
    setView('attack');
    playSound('attack', { attribute: attributes[shown.target === 'cpu' ? 'player' : 'cpu'] });
    schedule(() => showImpact(after, finisher), finisher ? CARD_FINISHER_ATTACK_MS : CARD_ATTACK_MS);
  };

  // 命中:HP が減る → ラウンドが終わりなら round-end、続くなら 次のターン(お互い1枚引く)
  const showImpact = (after: BattleState, finisher: boolean) => {
    setState(after);
    setView('damage');
    playSound('impact');
    playSound('hp-loss');
    // 必殺技は、命中の音を重ねる
    if (finisher) schedule(() => playSound('impact'), SPECIAL_SECOND_IMPACT_MS);

    schedule(() => {
      setDamage(null);
      setClash(null);
      setChargeNote(null);
      setFinisherHit(false);
      if (after.phase === 'round_end') {
        setView('round-end');
        playSound(after.roundResult === 'win' ? 'victory' : 'defeat');
        return;
      }
      const step = beginNextTurn(after, random);
      const next = step.state;
      const draw = step.events.find((event) => event.type === 'draw');
      const card = draw && draw.type === 'draw' ? draw.card : null;
      setState(next);
      placeCursor(next);
      setDrawn(card);
      setView('draw');
      // 必殺技のカードは 金色に光って来る(専用の音)
      playSound(card?.kind === 'finisher' ? 'star-showdown' : 'select');
      schedule(() => {
        setDrawn(null);
        showCpuNotices(cpuNotices(step.events));
      }, card?.kind === 'finisher' ? CARD_FINISHER_DRAW_MS : CARD_DRAW_MS);
    }, CARD_DAMAGE_MS);
  };

  // 連打勝負(同じ手・同じ★):時間が来たら回数をくらべる
  const startRendan = (pending: BattleState) => {
    const cpuPresses = pickCpuMash(random);
    mashRef.current = 0;
    setMash(0);
    setCpuMash(cpuPresses);
    setRendanWinner(null);
    setView('rendan');
    playSound('tie');

    schedule(() => {
      const step = resolveRendan(pending, mashRef.current, cpuPresses);
      const result = step.events.find((event) => event.type === 'rendan');
      const winner = result && result.type === 'rendan' ? result.winner : 'player';
      setRendanWinner(winner);
      setView('rendan-result');
      playSound(winner === 'player' ? 'victory' : 'reveal');
      schedule(() => strike(step.state, step.events), MASH_RESULT_MS);
    }, MASH_DUEL_MS);
  };

  // カードを出す:じゃん・けん・ぽん → めくる →(連打勝負)→ ダメージ
  const play = (card: Card) => {
    const step = playCard(state, card.id);
    const janken = step.events.find((event) => event.type === 'janken');
    setArmed(false);
    if (!janken || janken.type !== 'janken') {
      // 必殺技:じゃんけんぽんの かけ声は入れず、すぐカットイン → 相手を かならず倒す
      setView('finisher');
      playSound('star-showdown');
      schedule(() => playSound('impact'), SPECIAL_CUTIN_SLAM_MS);
      schedule(() => strike(step.state, step.events), SPECIAL_DISPLAY_MS);
      return;
    }
    setClash({ playerCard: janken.playerCard, cpuCard: janken.cpuCard, winner: janken.winner, by: janken.by });
    setTurnBanner(false);
    // 見せ場:大きなカード2枚が すべりこむ(beat 0)→ じゃん・けん・ぽん(1〜3)→ めくる
    setView('janken');
    setBeat(0);
    playSound('select');
    const beatAt = (beat: number) => CARD_CLASH_IN_MS + CARD_JANKEN_BEAT_MS * (beat - 1);
    schedule(() => {
      setBeat(1);
      playSound('janken-jan');
    }, beatAt(1));
    schedule(() => {
      setBeat(2);
      playSound('janken-ken');
    }, beatAt(2));
    schedule(() => {
      setBeat(3);
      playSound('janken-pon');
    }, beatAt(3));
    schedule(() => {
      setView('reveal');
      playSound('reveal');
      schedule(() => {
        if (step.state.phase === 'rendan') startRendan(step.state);
        else strike(step.state, step.events);
      }, CARD_REVEAL_MS);
    }, beatAt(4));
  };

  // 合成・スキルの結果を少し見せて、手札えらびにもどる(focusId のカードにカーソルを置く)
  // 回復は 粒・✚・「+○○」・HP の数え上がりを見せるので 長め(CARD_HEAL_MS)
  const showNotice = (next: BattleState, shown: Notice, focusId?: string) => {
    setState(next);
    setArmed(false);
    setMergePick(null);
    setNotice(shown);
    placeCursor(next, focusId);
    setView('notice');
    schedule(() => {
      setNotice(null);
      setView('player');
    }, shown.type === 'heal' ? CARD_HEAL_MS : CARD_SKILL_MS);
  };

  // 合成:同じ手・同じ★の2枚を、★が1つ上の1枚に(スキルの枠は使わない)
  const merge = (pair: [JankenCard, JankenCard]) => {
    const step = mergeCards(state, pair[0].id, pair[1].id);
    const event = step.events.find((item) => item.type === 'merge');
    if (!event || event.type !== 'merge') return;
    playSound('card-get');
    showNotice(step.state, { type: 'merge', card: event.card }, event.card.id);
  };

  // スキルを使う(回復:HP が満タンに / 封じ手:相手の手を1つ封じ、相手は出し直す)
  const castSkill = (card: Card) => {
    const step = useSkill(state, card.id, random);
    const event = step.events[0];
    if (event?.type === 'heal') {
      playSound('heal');
      showNotice(step.state, { type: 'heal', amount: event.amount });
    } else if (event?.type === 'seal') {
      playSound('reveal');
      showNotice(step.state, { type: 'seal', hand: event.hand });
    }
  };

  /** はじめから(パックを開けたところから)やり直す */
  const restart = () => {
    clearTimers();
    const fresh = deal();
    setState(fresh);
    placeCursor(fresh);
    setArmed(false);
    setMergePick(null);
    setNotice(null);
    setClash(null);
    setDamage(null);
    setDrawn(null);
    setChargeNote(null);
    setFinisherHit(false);
    setBeat(0);
    setTurnBanner(false);
    playSound('start');
    startCpuTurn();
  };

  // 合成のペアえらび(ペアが2組以上のとき):←→でえらび、決定で合成(右はしの「やめる」で もどる)
  const pressMergePick = (button: PadButton, pick: number) => {
    if (button !== 'center') {
      const next = Math.min(pairs.length, Math.max(0, pick + (button === 'left' ? -1 : 1)));
      if (next !== pick) {
        setMergePick(next);
        playSound('select');
      }
      return;
    }
    if (pick >= pairs.length) {
      setMergePick(null);
      setArmed(false);
      playSound('toggle');
      return;
    }
    merge(pairs[pick]);
  };

  /** 会場の3つのボタン */
  const press = (button: PadButton) => {
    if (view === 'rendan') {
      // 連打勝負は どのボタンでも1回
      mashRef.current += 1;
      setMash(mashRef.current);
      playSound('select');
      return;
    }
    if (view === 'round-end') {
      if (button === 'center') restart();
      return;
    }
    if (view !== 'player') return;
    if (mergePick !== null) {
      pressMergePick(button, mergePick);
      return;
    }

    if (button !== 'center') {
      // ←→:カードが浮いていれば取り消し。そうでなければカーソルを動かす(端で止まる)
      if (armed) {
        setArmed(false);
        playSound('toggle');
        return;
      }
      const next = Math.min(items.length - 1, Math.max(0, cursor + (button === 'left' ? -1 : 1)));
      if (next !== cursor) {
        setCursor(next);
        playSound('select');
      }
      return;
    }

    const item = items[cursor];
    if (!item) return;
    // 使えないスキルは 浮かない(理由は 手札の上に出ている)
    if (item.kind === 'card' && skillBlockedReason(state, item.card)) {
      playSound('toggle');
      return;
    }
    // 決定:1回目で浮いて説明が出る、2回目で使う
    if (!armed) {
      setArmed(true);
      playSound('select');
      return;
    }
    if (item.kind === 'merge') {
      if (pairs.length === 1) merge(pairs[0]);
      else {
        // ペアが2組以上:どれを合成するかを えらぶ
        setMergePick(0);
        playSound('select');
      }
      return;
    }
    if (item.card.kind === 'skill') castSkill(item.card);
    else play(item.card);
  };

  // 開発者メニュー(「カードバトル」タブ)の命令。自分のターン(手札えらび)のときだけ効く
  const addCard = (face: CardFace) => {
    const card = { ...face, id: `c${state.cardSeq + 1}` } as Card;
    const next: BattleState = { ...state, cardSeq: state.cardSeq + 1, player: { ...state.player, hand: sortHand([...state.player.hand, card]) } };
    setState(next);
    setArmed(false);
    setMergePick(null);
    placeCursor(next, card.id);
  };
  useCardDev((command: CardDevCommand) => {
    if (view !== 'player') return;
    if (command === 'add-finisher') addCard({ kind: 'finisher' });
    else if (command === 'add-heal') addCard({ kind: 'skill', skill: 'heal' });
    else if (command === 'add-seal') addCard({ kind: 'skill', skill: 'seal' });
    else if (command === 'player-pinch') setState({ ...state, player: { ...state.player, hp: Math.floor(state.player.maxHp * 0.3) } });
    else if (command === 'cpu-half') setState({ ...state, cpu: { ...state.cpu, hp: Math.floor(state.cpu.maxHp * 0.5) } });
    else if (command === 'cpu-charge') setState({ ...state, cpu: { ...state.cpu, chargeAnnounced: true } });
    playSound('toggle');
  });

  /** 連打勝負の画面のゲージを押した(マウス) */
  const pressMash = () => {
    if (view === 'rendan') press('center');
  };

  return {
    state,
    view,
    items,
    pairs,
    cursor,
    armed,
    mergePick,
    notice,
    clash,
    beat,
    damage,
    mash,
    cpuMash,
    rendanWinner,
    drawn,
    turnBanner,
    cpuStep,
    chargeNote,
    finisherHit,
    press,
    pressMash,
    restart,
  };
}

/** useCardBattle の返すもの(画面の部品に まとめて渡す) */
export type CardBattleApi = ReturnType<typeof useCardBattle>;
