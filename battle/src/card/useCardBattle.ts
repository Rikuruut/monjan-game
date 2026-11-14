import { useRef, useState } from 'react';
import type { GameSound, GameSoundOptions } from '../audio/gameAudio';
import { initialCursor, type Card, type JankenCard } from '../game/cards';
import type { BattleConfig } from '../game/config';
import {
  beginNextTurn,
  openPack,
  playCard,
  resolveRendan,
  startMatch,
  type BattleEvent,
  type BattleState,
  type Side,
} from '../game/engine';
import { pickCpuMash, type RandomSource } from '../game/logic';
import { useTimers } from '../hooks/useTimers';
import type { PadButton } from '../integration';
import {
  CARD_DAMAGE_MS,
  CARD_DRAW_MS,
  CARD_JANKEN_BEAT_MS,
  CARD_REVEAL_MS,
  MASH_DUEL_MS,
  MASH_RESULT_MS,
} from '../timings';

// カードバトルの画面の進み方(戦闘システム設計書 6章・7章)。
// 勝ち負けの計算は game/engine.ts。ここは「いつ・何を見せるか」と、3つのボタン(← ・決定・→)の受け方を持つ。
//
// 見せる段階(view):
//   player(手札をえらぶ)→ janken(じゃん・けん・ぽん)→ reveal(めくる)→(rendan → rendan-result)→ damage → draw → player …
//   どちらかの HP が 0 になったら round-end

export type CardBattleView = 'player' | 'janken' | 'reveal' | 'rendan' | 'rendan-result' | 'damage' | 'draw' | 'round-end';

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
}

type PlaySound = (sound: GameSound, options?: GameSoundOptions) => void;

export function useCardBattle({
  config,
  playerAttack,
  random = Math.random,
  playSound,
}: {
  config: BattleConfig;
  playerAttack: number;
  random?: RandomSource;
  playSound: PlaySound;
}) {
  const { schedule, clearTimers } = useTimers();
  // いまは パック選びの画面がないので、はじまりに そのままパックを開ける(パック選びは段階2b)
  const deal = () => openPack(startMatch(config, playerAttack, random), random).state;

  // 画面に見せている状態。じゃんけんの あいだは「出す前」のままにして、ダメージのところで「出したあと」に入れかえる
  const [state, setState] = useState<BattleState>(deal);
  const [view, setView] = useState<CardBattleView>('player');
  const [cursor, setCursor] = useState(() => initialCursor(state.player.hand));
  // 決定の1回目で カードが浮いている(2回目で出す。←→で取り消し)
  const [armed, setArmed] = useState(false);
  const [clash, setClash] = useState<Clash | null>(null);
  // じゃん(1)・けん(2)・ぽん(3)
  const [beat, setBeat] = useState(0);
  const [damage, setDamage] = useState<DamageShown | null>(null);
  // 連打勝負:自分の回数(数えるのは ref。表示のために state にも入れる)・CPU の回数・勝った側
  const [mash, setMash] = useState(0);
  const mashRef = useRef(0);
  const [cpuMash, setCpuMash] = useState(0);
  const [rendanWinner, setRendanWinner] = useState<Side | null>(null);

  // ダメージを見せる → ラウンドが終わりなら round-end、続くなら 次のターン(お互い1枚引く)
  const showDamage = (after: BattleState, events: BattleEvent[]) => {
    const hit = events.find((event) => event.type === 'damage');
    setState(after);
    setDamage(hit && hit.type === 'damage' ? { target: hit.target, amount: hit.amount, charged: hit.charged } : null);
    setView('damage');
    playSound('impact');
    playSound('hp-loss');

    schedule(() => {
      setDamage(null);
      setClash(null);
      if (after.phase === 'round_end') {
        setView('round-end');
        playSound(after.roundResult === 'win' ? 'victory' : 'defeat');
        return;
      }
      const next = beginNextTurn(after, random).state;
      setState(next);
      setCursor(initialCursor(next.player.hand));
      setView('draw');
      playSound('select');
      schedule(() => setView('player'), CARD_DRAW_MS);
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
      schedule(() => showDamage(step.state, step.events), MASH_RESULT_MS);
    }, MASH_DUEL_MS);
  };

  // カードを出す:じゃん・けん・ぽん → めくる →(連打勝負)→ ダメージ
  const play = (card: Card) => {
    // スキルは まだ使えない(段階2c)
    if (card.kind === 'skill') return;
    const step = playCard(state, card.id);
    const janken = step.events.find((event) => event.type === 'janken');
    setArmed(false);
    if (!janken || janken.type !== 'janken') {
      // 必殺技(演出は段階2d・3)
      showDamage(step.state, step.events);
      return;
    }
    setClash({ playerCard: janken.playerCard, cpuCard: janken.cpuCard, winner: janken.winner, by: janken.by });
    setView('janken');
    setBeat(1);
    playSound('janken-jan');
    schedule(() => {
      setBeat(2);
      playSound('janken-ken');
    }, CARD_JANKEN_BEAT_MS);
    schedule(() => {
      setBeat(3);
      playSound('janken-pon');
    }, CARD_JANKEN_BEAT_MS * 2);
    schedule(() => {
      setView('reveal');
      playSound('reveal');
      schedule(() => {
        if (step.state.phase === 'rendan') startRendan(step.state);
        else showDamage(step.state, step.events);
      }, CARD_REVEAL_MS);
    }, CARD_JANKEN_BEAT_MS * 3);
  };

  /** はじめから(パックを開けたところから)やり直す */
  const restart = () => {
    clearTimers();
    const fresh = deal();
    setState(fresh);
    setCursor(initialCursor(fresh.player.hand));
    setArmed(false);
    setClash(null);
    setDamage(null);
    setBeat(0);
    setView('player');
    playSound('start');
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

    if (button !== 'center') {
      // ←→:カードが浮いていれば取り消し。そうでなければカーソルを動かす(端で止まる)
      if (armed) {
        setArmed(false);
        playSound('toggle');
        return;
      }
      const last = state.player.hand.length - 1;
      const next = Math.min(last, Math.max(0, cursor + (button === 'left' ? -1 : 1)));
      if (next !== cursor) {
        setCursor(next);
        playSound('select');
      }
      return;
    }

    // 決定:1回目でカードが浮いて説明が出る、2回目で出す
    const card = state.player.hand[cursor];
    if (!card) return;
    if (!armed) {
      setArmed(true);
      playSound('select');
      return;
    }
    play(card);
  };

  /** 連打勝負の画面のゲージを押した(マウス) */
  const pressMash = () => {
    if (view === 'rendan') press('center');
  };

  return { state, view, cursor, armed, clash, beat, damage, mash, cpuMash, rendanWinner, press, pressMash, restart };
}
