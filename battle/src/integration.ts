import { useEffect, useRef } from 'react';

// 撮影・合体の画面(../generator/。FastAPI のサーバー)とつなぐための決まりごと。
//
// 展示の流れ:
//   /battle/(タイトル)→ スタート → /(撮影・合体・誕生)→ たたかう! → /battle/?photo=<id>(ルール → バトル)
//   → 結果 → ありがとう → タイトル
// このゲームは `npm.cmd run build` で ../generator/static/battle/ に出力し、サーバーが /battle/ で配る。

// 公開する場所(vite.config.ts の base。/battle/)
export const BASE_URL = import.meta.env.BASE_URL;
// 撮影・合体の画面
export const GENERATOR_URL = '/';

/** public/ に置いたファイルの場所。JSON などに書かれた `/monsters/…` を `/battle/monsters/…` にする。 */
export function assetUrl(path: string): string {
  return path.startsWith('/') ? `${BASE_URL}${path.slice(1)}` : path;
}

/** 生成したモンスターを返すサーバーの API(generator/app/main.py の /api/battle-monster)。 */
export function battleMonsterUrl(photoId: string): string {
  return `/api/battle-monster/${encodeURIComponent(photoId)}`;
}

/** 別のページ(撮影・合体の画面)へ移る。 */
export function navigateTo(url: string) {
  window.location.href = url;
}

export interface Launch {
  /** 生成したモンスターの ID(`?photo=`)。null なら見本のモンスターで戦う */
  photoId: string | null;
  /** タイトルを飛ばして、すぐバトル(ルール説明)から始めるか */
  skipTitle: boolean;
  /** スタートで撮影の画面へ進むか。false なら、これまでどおり見本のモンスターでバトルへ */
  toGenerator: boolean;
}

/**
 * URL から、どう始めるかを決める。
 * - `?photo=<id>`   … 撮影・合体の画面の「たたかう!」から来た。そのモンスターで、すぐバトル
 * - `?play=sample`  … 開発者メニューのテストプレイから来た。見本のモンスターで、すぐバトル
 * - `?standalone=1` … サーバーにつながず、単体で遊ぶ(スタートで撮影の画面へ行かない)
 * ビルドしていない開発用(npm.cmd run dev)とテストは、これまでどおり単体で動く。
 */
export function readLaunch(search: string = window.location.search, integrated: boolean = import.meta.env.PROD): Launch {
  const params = new URLSearchParams(search);
  const photoId = params.get('photo') || null;
  return {
    photoId,
    skipTitle: photoId !== null || params.get('play') === 'sample',
    toGenerator: integrated && !params.has('standalone'),
  };
}

// 会場の3つのボタン(← / Enter・Space / →)。USB の大きなボタンはキーとして届く。
// 撮影・合体の画面(generator/static/common/app.js)と同じキー。
export type PadButton = 'left' | 'center' | 'right';

export function padButtonOf(key: string): PadButton | null {
  if (key === 'ArrowLeft') return 'left';
  if (key === 'ArrowRight') return 'right';
  if (key === 'Enter' || key === ' ') return 'center';
  return null;
}

/** 3つのボタンが押されたら handler を呼ぶ。handler は毎回の描画のものを使う。 */
export function usePadButtons(handler: (button: PadButton) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const button = padButtonOf(event.key);
      if (!button) return;
      // フォーカスの残った画面のボタンが Enter・Space で一緒に押されないよう、ブラウザの動きを止める
      event.preventDefault();
      if (event.repeat) return;
      handlerRef.current(button);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      // Space は離したときにボタンが押されるので、こちらも止める
      if (padButtonOf(event.key)) event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);
}
