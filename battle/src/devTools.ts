// 開発者メニュー(D キー・⚙)で使う決まりごと。
// 撮影・合体の画面(generator/static/common/app.js の開発者メニュー)と同じ中身にそろえている。

import { BASE_URL, GENERATOR_URL } from './integration';

// ページ(どちらの画面のメニューにも同じものを出す)
export const DEV_PAGES = [
  { label: 'タイトル', url: BASE_URL },
  { label: '撮影', url: GENERATOR_URL },
  { label: 'テストプレイ', url: `${GENERATOR_URL}?autotest=1` },
  { label: '見本でバトル', url: `${BASE_URL}?play=demo` },
] as const;

// 通しの自動プレイ。/ と /battle/ は同じサーバーなので、sessionStorage で受け渡せる
export const AUTOPLAY_KEY = 'monjan-autoplay';

export interface Autoplay {
  on: boolean;
  /** 何周したか(ありがとう → タイトルで1増える) */
  loops: number;
}

const AUTOPLAY_OFF: Autoplay = { on: false, loops: 0 };

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;   // 使えないブラウザでも、メニューの他の機能は動く
  }
}

export function readAutoplay(storage: Storage | null = session()): Autoplay {
  try {
    const value = JSON.parse(storage?.getItem(AUTOPLAY_KEY) ?? 'null') as Partial<Autoplay> | null;
    if (!value || value.on !== true) return AUTOPLAY_OFF;
    return { on: true, loops: Number.isInteger(value.loops) ? Number(value.loops) : 0 };
  } catch {
    return AUTOPLAY_OFF;
  }
}

export function writeAutoplay(autoplay: Autoplay, storage: Storage | null = session()) {
  try {
    if (autoplay.on) storage?.setItem(AUTOPLAY_KEY, JSON.stringify(autoplay));
    else storage?.removeItem(AUTOPLAY_KEY);
  } catch {
    // 保存できなくても、このページの中では動く
  }
}

// 作ったモンスター(generator の GET /api/recent-monsters。outputs/ のフォルダ)
export interface RecentMonster {
  id: string;
  name: string;
  animal: string;
  object: string;
  element: string;
  created_at: string;
  image: string;
}

export const RECENT_MONSTERS_URL = '/api/recent-monsters';

export async function loadRecentMonsters(fetcher: typeof fetch = fetch): Promise<RecentMonster[]> {
  const response = await fetcher(RECENT_MONSTERS_URL);
  if (!response.ok) throw new Error('一覧を読めませんでした');
  const data = await response.json() as { monsters?: RecentMonster[] };
  return Array.isArray(data.monsters) ? data.monsters : [];
}

/** 作ったモンスターで戦うページ */
export function battleUrlFor(monsterId: string): string {
  return `${BASE_URL}?photo=${encodeURIComponent(monsterId)}`;
}
