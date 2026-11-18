import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { startGameBgm } from './audio/gameBgm';
import { playGameSound } from './audio/gameAudio';
import { navigateTo, readLaunch } from './integration';
import {
  AUTOPLAY_KEY_MS,
  AUTOPLAY_TITLE_MS,
  CARD_CLASH_IN_MS,
  CARD_CPU_TURN_MS,
  CARD_DEV_DEMO_LEAD_MS,
  CARD_JANKEN_TOTAL_MS,
  CARD_PLAYER_PLACE_MS,
  CARD_REVEAL_MS,
} from './timings';

// 画面の切りかえ(タイトル → カードバトル → リザルト → カードゲット → タイトル)と、会場の3つのボタン・開発者メニュー。
// カードバトルの中の進み方は card/CardBattle.test.tsx。これまでのじゃんけんバトルのテストは generator/archive/20261116_before_card_swap/

vi.mock('./audio/gameBgm', () => ({
  startGameBgm: vi.fn(async () => undefined),
  pauseGameBgm: vi.fn(),
  stopGameBgm: vi.fn(),
  setGameBgmMuted: vi.fn(),
  setGameBgmVolume: vi.fn(),
  disposeGameBgm: vi.fn(),
}));

vi.mock('./integration', async (importOriginal) => ({
  ...await importOriginal<typeof import('./integration')>(),
  navigateTo: vi.fn(),
}));

vi.mock('./audio/gameAudio', () => ({
  unlockGameAudio: vi.fn(async () => true),
  playGameSound: vi.fn(),
  setSfxMuted: vi.fn(),
  setSfxVolume: vi.fn(),
  closeGameAudio: vi.fn(),
}));

const player = {
  id: 'MON-0001',
  name: 'ボトルマンタ',
  source: { animal: 'エイ', object: '水筒' },
  attribute: '水',
  attack: 2000,
  hp: 4000,
  description: 'テスト',
  image: '/monsters/player.png',
};

const cpu = {
  id: 'MON-0002',
  name: 'パンチイーグル',
  source: { animal: 'ワシ', object: 'パンチ' },
  attribute: '風',
  attack: 3000,
  hp: 5000,
  description: 'テスト',
  image: '/monsters/cpu.png',
};

// fetch を差しかえ、パスごとに決まった JSON を返す(battle-config.json などは 既定の値になる)
function mockDataFetch() {
  const byPath: Record<string, unknown> = {
    '/data/game-config.json': {
      samplePlayerMonsterId: 'MON-0001',
      sampleCpuMonsterId: 'MON-0002',
      monsters: ['/player.json', '/cpu.json'],
    },
    '/player.json': player,
    '/cpu.json': cpu,
    '/api/battle-monster/abc': player,
    '/api/battle-monster/demo': player,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const body = byPath[String(input)];
    return { ok: body !== undefined, json: async () => body };
  }));
}

async function advance(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}

/** 読みこみ(fetch)を終わらせる(偽のタイマーのときは 待たずに 約束だけ進める) */
async function flush() {
  for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });
}

const press = (key: 'ArrowLeft' | 'ArrowRight' | 'Enter') => {
  fireEvent.keyDown(window, { key });
  fireEvent.keyUp(window, { key });
};
const openMenu = () => fireEvent.keyDown(window, { key: 'd' });
const openTab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const menu = () => screen.getByRole('complementary', { name: '開発者メニュー' });

/** タイトルまで読みこんでから 偽のタイマーにする */
async function renderTitle(search = '', integrated = false) {
  render(<App launch={readLaunch(search, integrated)} />);
  await screen.findByRole('button', { name: /スタート！/ });
  vi.useFakeTimers();
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDataFetch();
  vi.spyOn(Math, 'random').mockReturnValue(0);
  window.sessionStorage.clear();
  window.localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('画面の切りかえと 会場の3つのボタン', () => {
  it('単体ではスタートで カードバトル(パック選び)から。BGM は タイトルから流す', async () => {
    await renderTitle();
    await flush();
    expect(startGameBgm).toHaveBeenCalled();
    press('Enter');
    await flush();
    expect(screen.getByText('パックを えらぼう！')).toBeInTheDocument();
  });

  it('展示ではタイトルのスタートで撮影・合体の画面へ移る', async () => {
    await renderTitle('', true);
    press('Enter');
    expect(navigateTo).toHaveBeenCalledWith('/');
  });

  it('「たたかう!」から来たら、タイトルを飛ばして パック選びから', async () => {
    render(<App launch={readLaunch('?photo=abc', true)} />);
    expect(await screen.findByText('パックを えらぼう！')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /スタート！/ })).not.toBeInTheDocument();
  });

  it('リザルト → 中ボタン → カードゲット(刷るカード)→ 中ボタン → タイトル', async () => {
    render(<App launch={readLaunch('?photo=abc', true)} />);
    await screen.findByText('パックを えらぼう！');
    openMenu();
    openTab('画面へとぶ');
    fireEvent.click(within(menu()).getByRole('button', { name: /リザルト かち/ }));
    // 押すと メニューは閉じる
    expect(screen.queryByRole('complementary', { name: '開発者メニュー' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'しょうり！' })).toBeInTheDocument();

    press('Enter');
    expect(playGameSound).toHaveBeenCalledWith('card-get');
    expect(screen.getByRole('heading').textContent).toBe('この カードをゲット！');
    expect(screen.getByTitle('もらえるカード')).toHaveAttribute('src', '/card?id=abc&embed=1');

    press('Enter');
    expect(screen.getByRole('button', { name: /スタート！/ })).toBeInTheDocument();
  });

  it('タイトルへ もどって URL が消えたあとも、開発者メニューから始めたバトルの カードゲットは 刷るカード', async () => {
    vi.stubEnv('PROD', true);
    window.history.replaceState(null, '', '/battle/?play=demo');
    try {
      render(<App />);
      await screen.findByText('パックを えらぼう！');
      openMenu();
      openTab('画面へとぶ');
      fireEvent.click(within(menu()).getByRole('button', { name: /カードゲット/ }));
      press('Enter');
      expect(screen.getByRole('button', { name: /スタート！/ })).toBeInTheDocument();
      expect(window.location.search).toBe('');

      vi.useFakeTimers();
      openMenu();
      openTab('演出を見る');
      fireEvent.click(within(menu()).getByRole('button', { name: '火' }));
      await flush();
      openMenu();
      openTab('画面へとぶ');
      fireEvent.click(within(menu()).getByRole('button', { name: /カードゲット/ }));
      expect(screen.getByTitle('もらえるカード')).toHaveAttribute('src', '/card?id=demo&embed=1');
    } finally {
      vi.unstubAllEnvs();
      window.history.replaceState(null, '', '/');
    }
  });

  it('バトルが終わると「● つぎへ」で リザルトへ', async () => {
    await renderTitle();
    openMenu();
    openTab('演出を見る');
    fireEvent.click(within(menu()).getByRole('button', { name: /必殺技/ }));
    await flush();
    await advance(CARD_DEV_DEMO_LEAD_MS);
    expect(screen.getByText('ひっさつわざ！')).toBeInTheDocument();
    await advance(10_000);
    press('Enter');
    expect(screen.getByRole('heading', { name: 'しょうり！' })).toBeInTheDocument();
    expect(screen.getByText('✨ ひっさつわざ を きめた！')).toBeInTheDocument();
  });
});

describe('開発者メニュー(D キー)', () => {
  it('D で開き・閉じる。最後に開いたタブを覚えていて、モンスターの中身が見える', async () => {
    await renderTitle();
    openMenu();
    expect(screen.getByRole('tab', { name: 'よく使う' })).toHaveAttribute('aria-selected', 'true');
    openTab('データ');
    expect(menu()).toHaveTextContent('ボトルマンタ');
    expect(menu()).toHaveTextContent('パンチイーグル');
    openMenu();
    expect(screen.queryByRole('complementary', { name: '開発者メニュー' })).not.toBeInTheDocument();
    openMenu();
    expect(screen.getByRole('tab', { name: 'データ' })).toHaveAttribute('aria-selected', 'true');
  });

  it('演出を見る:合体を押すと メニューが閉じ、用意した手札で 合体が 最初から流れる。「▶ もう一度」で くり返せる', async () => {
    await renderTitle();
    openMenu();
    openTab('演出を見る');
    fireEvent.click(within(menu()).getByRole('button', { name: /合体/ }));
    await flush();
    expect(screen.queryByRole('complementary', { name: '開発者メニュー' })).not.toBeInTheDocument();
    // 相手のターンを飛ばして 自分のターンから。少し置いて 合体
    await advance(CARD_DEV_DEMO_LEAD_MS);
    expect(screen.getByText(/グー ★2 に なった/)).toBeInTheDocument();

    const replay = screen.getByRole('button', { name: /もう一度:合体/ });
    fireEvent.click(replay);
    await flush();
    expect(screen.queryByText(/に なった/)).not.toBeInTheDocument();
    await advance(CARD_DEV_DEMO_LEAD_MS);
    expect(screen.getByText(/グー ★2 に なった/)).toBeInTheDocument();
  });

  it('攻撃のタイプ:えらんだタイプで じゃんけん → 攻撃 を流す', async () => {
    await renderTitle();
    openMenu();
    openTab('演出を見る');
    fireEvent.click(within(menu()).getByRole('button', { name: '火' }));
    await flush();
    await advance(CARD_DEV_DEMO_LEAD_MS + CARD_PLAYER_PLACE_MS + CARD_CLASH_IN_MS + CARD_JANKEN_TOTAL_MS + CARD_REVEAL_MS);
    expect(document.querySelector('.battle-screen--attack-fire')).not.toBeNull();
    expect(screen.getAllByText('あなたの かち！').length).toBeGreaterThan(0);
  });

  it('勝ち負けを決める:「まける」にすると、出したカードが かならず負ける', async () => {
    await renderTitle('?pack=0');
    openMenu();
    openTab('バトルを操作');
    expect(menu()).toHaveTextContent('バトルの画面では ありません');
    fireEvent.click(within(menu()).getByRole('radio', { name: 'まける' }));
    openMenu();
    press('Enter');
    await flush();
    await advance(CARD_CPU_TURN_MS);
    press('Enter');
    press('Enter');
    await advance(CARD_PLAYER_PLACE_MS + CARD_CLASH_IN_MS + CARD_JANKEN_TOTAL_MS + 10);
    expect(screen.getAllByText('あいての かち…').length).toBeGreaterThan(0);
  });

  it('手札に足す:相手のターンに押しても、次の自分のターンで手札に入る', async () => {
    await renderTitle('?pack=0');
    press('Enter');
    await flush();
    expect(screen.queryByRole('img', { name: /必殺技/ })).not.toBeInTheDocument();
    const before = screen.getAllByTestId(/^hand-item-/).length;
    openMenu();
    openTab('バトルを操作');
    fireEvent.click(within(menu()).getByRole('button', { name: /必殺技/ }));
    expect(screen.queryByRole('complementary', { name: '開発者メニュー' })).not.toBeInTheDocument();
    expect(screen.getAllByTestId(/^hand-item-/)).toHaveLength(before);
    await advance(CARD_CPU_TURN_MS);
    expect(screen.getAllByTestId(/^hand-item-/)).toHaveLength(before + 1);
  });

  it('通しの自動プレイ(単体):タイトルで少し待ってスタート → バトルは ボタンを送って進む', async () => {
    await renderTitle();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(JSON.parse(window.sessionStorage.getItem('monjan-autoplay') ?? '{}')).toEqual({ on: true, loops: 0 });
    // メニューを開いているあいだは止まっている
    await advance(AUTOPLAY_TITLE_MS);
    expect(screen.getByRole('button', { name: /スタート！/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'とじる' }));
    expect(screen.getByText(/自動プレイ中 0周/)).toBeInTheDocument();
    await advance(AUTOPLAY_TITLE_MS);
    await flush();
    expect(screen.getByText('パックを えらぼう！')).toBeInTheDocument();
    // Math.random が 0 なので 決定(Enter)を押す → パックが開く
    await advance(AUTOPLAY_KEY_MS);
    expect(screen.getByText('あけるよ…！')).toBeInTheDocument();
  });

  it('通しの自動プレイ(展示):タイトルで少し待ってから撮影の画面へ進む', async () => {
    await renderTitle('', true);
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    fireEvent.click(screen.getByRole('button', { name: 'とじる' }));
    await advance(AUTOPLAY_TITLE_MS - 1);
    expect(navigateTo).not.toHaveBeenCalled();
    await advance(1);
    expect(navigateTo).toHaveBeenCalledWith('/');
  });
});
