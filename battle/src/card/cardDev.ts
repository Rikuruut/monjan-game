import { useEffect, useRef } from 'react';

// 開発者メニュー(DevMenu.tsx の「カードバトル」タブ)から、カードバトルの画面へ送る命令。
// メニューと画面は 別々の場所にあるので、window の CustomEvent で知らせる(useCardBattle.ts が受け取る)。
// 自分のターン(手札えらび)のときだけ効く

export type CardDevCommand =
  /** 必殺技のカードを手札に足す */
  | 'add-finisher'
  | 'add-heal'
  | 'add-seal'
  /** 自分の HP を3割に(ピンチの点滅を見る) */
  | 'player-pinch'
  /** 相手の HP を半分に(ボスなら 次のドローで必殺技が来る) */
  | 'cpu-half'
  /** 相手に ため技を予告させる(次のターンに ためる) */
  | 'cpu-charge';

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
