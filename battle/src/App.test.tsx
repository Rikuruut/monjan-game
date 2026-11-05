import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  App,
  ATTACK_DISPLAY_MS,
  AUTOPLAY_HAND_MS,
  AUTOPLAY_RULES_MS,
  AUTOPLAY_TITLE_MS,
  IMPACT_DISPLAY_MS,
  JANKEN_BEAT_MS,
  NEXT_ROUND_DISPLAY_MS,
  MASH_DUEL_MS,
  MASH_RESULT_MS,
  RESULT_DISPLAY_MS,
  REVEAL_DISPLAY_MS,
  SELECTED_DISPLAY_MS,
  SPECIAL_ATTACK_MS,
  SPECIAL_DISPLAY_MS,
  SUMMON_DISPLAY_MS,
} from './App';
import { CPU_MASH_MAX, CPU_MASH_MIN } from './game/logic';
import {
  pauseGameBgm,
  setGameBgmMuted,
  setGameBgmVolume,
  startGameBgm,
  stopGameBgm,
} from './audio/gameBgm';
import {
  playGameSound,
  setSfxMuted,
  setSfxVolume,
  unlockGameAudio,
} from './audio/gameAudio';
import { navigateTo } from './integration';

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

function mockDataFetch() {
  const byPath: Record<string, unknown> = {
    '/data/game-config.json': {
      samplePlayerMonsterId: 'MON-0001',
      sampleCpuMonsterId: 'MON-0002',
      monsters: ['/player.json', '/cpu.json'],
    },
    '/player.json': player,
    '/cpu.json': cpu,
  };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
    ok: true,
    json: async () => byPath[String(input)],
  })));
}

async function advance(milliseconds: number) {
  await act(async () => {
    vi.advanceTimersByTime(milliseconds);
  });
}

// スタートを押す(最初は、本物のバトル画面で練習ラウンドから始まる)
async function startToPractice() {
  render(<App />);
  const startButton = await screen.findByRole('button', { name: /スタート！/ });
  vi.useFakeTimers();
  fireEvent.click(startButton);
}

// 練習ラウンドを、結果で止まるところまで進める(グーを出す。練習は必ず勝つ)
async function playPractice() {
  await advance(SUMMON_DISPLAY_MS);
  fireEvent.click(screen.getByRole('button', { name: 'グー' }));
  await advanceSelectedToReveal();
  await advanceRevealToAttack(false);
  await advance(ATTACK_DISPLAY_MS);
  await advance(IMPACT_DISPLAY_MS);
}

// 「つぎへ」で「れんしゅうクリア」の画面へ、「ほんばん スタート!」で本番の召喚から。
// 練習で鳴った音は消して、本番ラウンド1の手えらびまで進める
async function endPracticeToChoosing() {
  fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));
  fireEvent.click(screen.getByRole('button', { name: 'ほんばん スタート！' }));
  await advance(SUMMON_DISPLAY_MS);
  vi.mocked(playGameSound).mockClear();
}

async function openBattle() {
  await startToPractice();
  await playPractice();
  await endPracticeToChoosing();
}

async function advanceSelectedToReveal() {
  await advance(SELECTED_DISPLAY_MS);
  await advance(JANKEN_BEAT_MS);
  await advance(JANKEN_BEAT_MS);
  await advance(JANKEN_BEAT_MS);
}

// 違う手は、手を見せたあと すぐ攻撃。あいこは連打勝負 → どちらが勝ったか を見せてから
async function advanceRevealToAttack(mashDuel: boolean) {
  await advance(REVEAL_DISPLAY_MS);
  if (mashDuel) {
    await advance(MASH_DUEL_MS);
    await advance(MASH_RESULT_MS);
  }
}

// special:相手の♡が1で じゃんけんに勝つラウンド(必殺技のカットインと、長い ため が入る)
async function completeDifferentHandRound(special = false) {
  await advanceSelectedToReveal();
  await advanceRevealToAttack(false);
  if (special) await advance(SPECIAL_DISPLAY_MS);
  await advance(special ? SPECIAL_ATTACK_MS : ATTACK_DISPLAY_MS);
  await advance(IMPACT_DISPLAY_MS);
  await advance(RESULT_DISPLAY_MS);
}

function getCpuHandPanel(): HTMLElement {
  const panel = document.querySelector<HTMLElement>('.revealed-hand--cpu');
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

function expectCpuHandToBeConcealed() {
  const panel = getCpuHandPanel();
  expect(within(panel).getByLabelText('CPUの手はまだひみつ')).toBeInTheDocument();
  expect(panel).not.toHaveTextContent('✊');
}

function setRandomSequence(...values: number[]) {
  const random = vi.mocked(Math.random);
  random.mockReset();
  values.forEach((value) => random.mockReturnValueOnce(value));
  random.mockReturnValue(0);
}

describe('画面上のゲーム進行と演出', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDataFetch();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('子どもが読める長さで、じゃんけんと連打勝負のテロップを表示する', () => {
    expect(SELECTED_DISPLAY_MS).toBe(400);
    expect(JANKEN_BEAT_MS).toBe(700);
    expect(REVEAL_DISPLAY_MS).toBe(1000);
    expect(MASH_DUEL_MS).toBe(2500);
  });

  it('最初のスタートは練習ラウンド:吹き出し→どの手でも勝つ→結果で止まる→れんしゅうクリア→本番は召喚から', async () => {
    await startToPractice();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('れんしゅう')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ルール/ })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('れんしゅう スタート');

    await advance(SUMMON_DISPLAY_MS);
    // 吹き出し①:手をえらぶまで待つ
    expect(screen.getByText('れんしゅうだよ！')).toBeInTheDocument();
    expect(screen.getByText(/れんだ しょうぶ/)).toBeInTheDocument();
    expect(document.querySelector('.star-badge')).toBeNull();
    await advance(RESULT_DISPLAY_MS * 2);
    expect(screen.getByText('れんしゅうだよ！')).toBeInTheDocument();

    // どの手を出しても勝つ(練習)。⚔の数だけ相手の♡がへる
    fireEvent.click(screen.getByRole('button', { name: 'チョキ' }));
    expect(screen.queryByText('れんしゅうだよ！')).not.toBeInTheDocument();
    await advanceSelectedToReveal();
    await advanceRevealToAttack(false);
    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('HP 3 / 5')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 4 / 4')).toBeInTheDocument();

    // 吹き出し②:結果で止まったまま、進まない
    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByText('かったね！')).toBeInTheDocument();
    await advance(RESULT_DISPLAY_MS * 2);
    expect(screen.getByText('かったね！')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 3 / 5')).toBeInTheDocument();

    // 「つぎへ」で、練習だけで完結する「れんしゅうクリア」の画面へ(バトルの表示は消える)
    fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));
    expect(screen.getByRole('heading', { name: 'れんしゅう クリア！' })).toBeInTheDocument();
    expect(screen.getByAltText(player.name)).toBeInTheDocument();
    expect(screen.queryByText('れんしゅう')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'グー' })).not.toBeInTheDocument();
    expect(playGameSound).toHaveBeenCalledWith('victory');
    await advance(RESULT_DISPLAY_MS * 2);
    expect(screen.getByRole('heading', { name: 'れんしゅう クリア！' })).toBeInTheDocument();

    // 「ほんばん スタート！」で、本番を召喚から始める:♡は満タン、ラウンド1
    fireEvent.click(screen.getByRole('button', { name: 'ほんばん スタート！' }));
    expect(screen.getByRole('status')).toHaveTextContent('モンスター召喚');
    expect(screen.getByLabelText('HP 4 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();
    expect(screen.queryByText('れんしゅう')).not.toBeInTheDocument();
    expect(document.querySelector('.round-chip b')).toHaveTextContent('1');
    await advance(SUMMON_DISPLAY_MS);
    expect(screen.getByRole('button', { name: 'グー' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /ルール/ })).toBeEnabled();
  });

  it('練習の相手は本番の相手とは別の見本で、本番の相手は本番の召喚ではじめて出てくる', async () => {
    const third = { ...cpu, id: 'MON-0003', name: 'バッタ', image: '/monsters/third.png' };
    const byPath: Record<string, unknown> = {
      '/data/game-config.json': {
        samplePlayerMonsterId: 'MON-0001',
        sampleCpuMonsterId: 'MON-0002',
        monsters: ['/player.json', '/cpu.json', '/third.json'],
      },
      '/player.json': player,
      '/cpu.json': cpu,
      '/third.json': third,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => byPath[String(input)],
    })));

    await startToPractice();
    await playPractice();
    expect(screen.getByAltText('バッタ')).toBeInTheDocument();
    expect(screen.queryByAltText(cpu.name)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));
    fireEvent.click(screen.getByRole('button', { name: 'ほんばん スタート！' }));
    expect(screen.getByAltText(cpu.name)).toBeInTheDocument();
    expect(screen.queryByAltText('バッタ')).not.toBeInTheDocument();
  });

  it('CPU の♡が少なくても、練習では♡が0にならず、勝負が終わらない', async () => {
    const weakCpu = { ...cpu, hp: 1000 };
    const byPath: Record<string, unknown> = {
      '/data/game-config.json': {
        samplePlayerMonsterId: 'MON-0001',
        sampleCpuMonsterId: 'MON-0002',
        monsters: ['/player.json', '/cpu.json'],
      },
      '/player.json': player,
      '/cpu.json': weakCpu,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => byPath[String(input)],
    })));

    await startToPractice();
    await playPractice();
    // 練習のあいだ CPU の♡は、自分の⚔(2)より多い 3 つ。2へって 1 のこる
    expect(screen.getByLabelText('HP 1 / 3')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'しょうり！' })).not.toBeInTheDocument();
    expect(document.querySelector('.final-banner')).toBeNull();

    // 本番では、本来の♡(1つ)にもどる
    await endPracticeToChoosing();
    expect(screen.getByLabelText('HP 1 / 1')).toBeInTheDocument();
  });

  it('タイトルには指定ロゴだけを正しい比率で表示し、モンスター画像はバトル開始後だけ表示する', async () => {
    render(<App />);
    const startButton = await screen.findByRole('button', { name: /スタート！/ });

    const logo = screen.getByRole('img', { name: /モンじゃん！/ });
    expect(logo).toHaveAttribute('src', '/assets/monjan-title-logo.png');
    expect(logo).toHaveAttribute('width', '1774');
    expect(logo).toHaveAttribute('height', '887');
    expect(document.querySelector('.title-copy h1')).toBeNull();
    expect(screen.queryByText('まほうの じゃんけんバトル')).not.toBeInTheDocument();
    expect(screen.queryByText('じゃんけんで モンスター対決！')).not.toBeInTheDocument();
    expect(document.querySelector('.rule-pills')).toBeNull();
    expect(screen.queryByRole('button', { name: /スタッフ用 SEテスト/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'SEテスト' })).not.toBeInTheDocument();
    expect(document.querySelector('.se-test-card')).toBeNull();
    expect(screen.queryByAltText(player.name)).not.toBeInTheDocument();
    expect(screen.queryByAltText(cpu.name)).not.toBeInTheDocument();

    vi.useFakeTimers();
    fireEvent.click(startButton);

    for (const name of [player.name, cpu.name]) {
      const image = screen.getByAltText(name);
      expect(image).toHaveAttribute('width', '1024');
      expect(image).toHaveAttribute('height', '768');
      expect(image.closest('.monster-image-container')).toHaveClass('monster-image-container--battle');
    }

    const battleLogo = screen.getByRole('img', { name: 'モンじゃん！' });
    expect(battleLogo).toHaveClass('battle-logo');
    expect(battleLogo).toHaveAttribute('src', '/assets/monjan-title-logo.png');
    expect(battleLogo).toHaveAttribute('width', '1774');
    expect(battleLogo).toHaveAttribute('height', '887');
    expect(document.querySelector('.battle-topbar .mini-logo')).toBeNull();
  });

  it('召喚のあとに選択でき、じゃん・けん・ぽんの後までCPUの手をDOMへ出さない', async () => {
    await startToPractice();
    expect(screen.getByRole('status')).toHaveTextContent('れんしゅう スタート');
    expect(screen.queryByRole('button', { name: 'グー' })).not.toBeInTheDocument();

    await advance(SUMMON_DISPLAY_MS - 1);
    expect(playGameSound).toHaveBeenCalledWith('summon');
    expect(screen.getByRole('status')).toHaveTextContent('れんしゅう スタート');
    await advance(1);

    // 星はなくなった(レア度抽選もない)。召喚のあと すぐ選べる
    expect(screen.queryByText(/レア度抽選/)).not.toBeInTheDocument();
    const paper = screen.getByRole('button', { name: 'パー' });
    expect(paper).toBeEnabled();
    expect(paper.querySelector('.star-badge')).toBeNull();
    fireEvent.click(paper);
    expect(paper).toBeDisabled();
    expect(document.querySelector('.revealed-hand--cpu')).toBeNull();

    await advance(SELECTED_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('じゃん');
    expectCpuHandToBeConcealed();

    await advance(JANKEN_BEAT_MS);
    expect(screen.getByRole('status')).toHaveTextContent('けん');
    expectCpuHandToBeConcealed();

    await advance(JANKEN_BEAT_MS);
    expect(screen.getByRole('status')).toHaveTextContent('ぽん');
    expectCpuHandToBeConcealed();

    await advance(JANKEN_BEAT_MS - 1);
    expectCpuHandToBeConcealed();
    await advance(1);

    expect(screen.getByRole('status')).toHaveTextContent('CPUの手を こうかい');
    const cpuHand = getCpuHandPanel();
    expect(within(cpuHand).getByText('✊')).toBeInTheDocument();
    expect(cpuHand.querySelector('.star-strength')).toBeNull();

    // 違う手は、連打勝負なしで すぐ攻撃
    await advance(REVEAL_DISPLAY_MS);
    expect(document.querySelector('.mash-duel')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('こうげき');
  });

  // 本番のあいこ(Math.random = 0 なので CPU はグー、CPU の連打は CPU_MASH_MIN 回)
  async function openMashDuel() {
    await openBattle();
    fireEvent.click(screen.getByRole('button', { name: 'グー' }));
    await advanceSelectedToReveal();
    expect(screen.getByRole('status')).toHaveTextContent('あいこ');
    await advance(REVEAL_DISPLAY_MS);
    expect(screen.getByText('れんだ しょうぶ！')).toBeInTheDocument();
    expect(playGameSound).toHaveBeenCalledWith('tie');
  }

  const mash = (times: number) => {
    for (let index = 0; index < times; index += 1) {
      fireEvent.keyDown(window, { key: ['ArrowLeft', 'Enter', 'ArrowRight'][index % 3] });
    }
  };

  it('あいこは連打勝負:CPU より多く押すと、自分の⚔の数だけ攻撃', async () => {
    await openMashDuel();
    // 会場の3つのボタンのどれでも1回。押しっぱなし(repeat)は数えない
    mash(CPU_MASH_MIN + 1);
    fireEvent.keyDown(window, { key: 'Enter', repeat: true });
    expect(screen.getByLabelText(`あなたの れんだ ${CPU_MASH_MIN + 1}かい`)).toBeInTheDocument();
    // CPU の回数は、終わるまで ひみつ
    expect(screen.getByLabelText('CPUも れんだ中')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();

    await advance(MASH_DUEL_MS);
    expect(screen.getByText('あなたの かち！', { selector: '.mash-duel__title' })).toBeInTheDocument();
    expect(screen.getByLabelText(`CPUの れんだ ${CPU_MASH_MIN}かい`)).toBeInTheDocument();
    // 時間が終わったら、もう数えない
    mash(5);
    expect(screen.getByLabelText(`あなたの れんだ ${CPU_MASH_MIN + 1}かい`)).toBeInTheDocument();

    await advance(MASH_RESULT_MS);
    expect(screen.getByRole('status')).toHaveTextContent('こうげき');
    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('HP 3 / 5')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 4 / 4')).toBeInTheDocument();
  });

  it('連打が CPU より少ないと、CPU の⚔の数だけ攻撃される', async () => {
    await openMashDuel();
    mash(CPU_MASH_MIN - 1);
    await advance(MASH_DUEL_MS);
    expect(screen.getByText('CPUの かち！', { selector: '.mash-duel__title' })).toBeInTheDocument();
    await advance(MASH_RESULT_MS);
    await advance(ATTACK_DISPLAY_MS);
    // CPU の⚔は 3
    expect(screen.getByLabelText('HP 1 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();
  });

  it('連打が同じ数なら あいこで、命中時に双方のHPを1だけ減らす', async () => {
    await openMashDuel();
    mash(CPU_MASH_MIN);
    await advance(MASH_DUEL_MS);
    expect(screen.getByText('おなじ かず！ あいこ！')).toBeInTheDocument();
    await advance(MASH_RESULT_MS);
    expect(screen.getByRole('status')).toHaveTextContent('おたがいに ダメージ');
    expect(screen.getByLabelText('HP 4 / 4')).toBeInTheDocument();

    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('HP 3 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 4 / 5')).toBeInTheDocument();
    expect(screen.getAllByLabelText('1ダメージ')).toHaveLength(2);

    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('あいこ！');
  });

  it('CPU の連打の回数は、はばの中', () => {
    expect(CPU_MASH_MIN).toBeGreaterThan(0);
    expect(CPU_MASH_MAX).toBeGreaterThanOrEqual(CPU_MASH_MIN);
  });

  it('手を選ぶ画面のルールボタンで説明を再確認し、HPとラウンドを保って戻れる', async () => {
    await openBattle();
    const playerHpBefore = screen.getByLabelText('HP 4 / 4');
    const cpuHpBefore = screen.getByLabelText('HP 5 / 5');
    const summonCallsBefore = vi.mocked(playGameSound).mock.calls.filter(([sound]) => sound === 'summon').length;

    fireEvent.click(screen.getByRole('button', { name: /ルール/ }));
    const dialog = screen.getByRole('dialog');
    // 見直しは今までの3ページ(練習ラウンドは出さない)
    expect(within(dialog).getByRole('heading', { name: /じゃんけんで\s*勝負/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/グー・チョキ・パーから\s*1つ\s*えらぼう/);
    expect(screen.queryByText('れんしゅうだよ！')).not.toBeInTheDocument();
    expect(screen.queryByText('れんしゅう')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'パー' })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'つぎへ' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'つぎへ' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /バトルにもどる/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'パー' })).toBeEnabled();
    expect(playerHpBefore).toBeInTheDocument();
    expect(cpuHpBefore).toBeInTheDocument();
    expect(vi.mocked(playGameSound).mock.calls.filter(([sound]) => sound === 'summon')).toHaveLength(summonCallsBefore);
  });

  it('演出中に連打しても判定・効果音・HP反映を一度だけ行う', async () => {
    await openBattle();
    const paper = screen.getByRole('button', { name: 'パー' });
    fireEvent.click(paper);
    fireEvent.click(paper);
    fireEvent.click(paper);

    expect(vi.mocked(playGameSound).mock.calls.filter(([sound]) => sound === 'select')).toHaveLength(1);
    await advanceSelectedToReveal();
    await advanceRevealToAttack(false);

    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();
    await advance(ATTACK_DISPLAY_MS - 1);
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();
    await advance(1);

    expect(screen.getByLabelText('HP 3 / 5')).toBeInTheDocument();
    expect(screen.queryByLabelText('HP 1 / 5')).not.toBeInTheDocument();
    expect(vi.mocked(playGameSound).mock.calls.filter(([sound]) => sound === 'impact')).toHaveLength(1);
    expect(vi.mocked(playGameSound).mock.calls.filter(([sound]) => sound === 'hp-loss')).toHaveLength(1);

    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('あなたの かち');
    await advance(RESULT_DISPLAY_MS);
    expect(screen.getByText('次のラウンド！')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 3 / 5')).toBeInTheDocument();

    await advance(NEXT_ROUND_DISPLAY_MS - 1);
    expect(screen.queryByRole('button', { name: 'パー' })).not.toBeInTheDocument();
    await advance(1);
    expect(screen.getByRole('button', { name: 'パー' })).toBeEnabled();
  });

  it('タイトルからBGMを試し、全画面で継続しながらSEと個別調整・全体ミュートできる', async () => {
    render(<App />);
    const startButton = await screen.findByRole('button', { name: /スタート！/ });

    await waitFor(() => expect(startGameBgm).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    fireEvent.click(startButton);
    expect(unlockGameAudio).toHaveBeenCalledTimes(1);
    expect(playGameSound).toHaveBeenCalledWith('start');
    expect(startGameBgm).toHaveBeenCalledTimes(2);

    fireEvent.change(screen.getByRole('slider', { name: 'BGM音量' }), {
      target: { value: '40' },
    });
    expect(setGameBgmVolume).toHaveBeenCalledWith(0.4);
    expect(setSfxVolume).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole('slider', { name: '効果音音量' }), {
      target: { value: '25' },
    });
    expect(setSfxVolume).toHaveBeenCalledWith(0.25);
    expect(setGameBgmVolume).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'サウンドをオフにする' }));
    expect(setSfxMuted).toHaveBeenCalledWith(true);
    expect(setGameBgmMuted).toHaveBeenCalledWith(true);
    expect(pauseGameBgm).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'サウンドをオンにする' }));
    expect(setSfxMuted).toHaveBeenCalledWith(false);
    expect(setGameBgmMuted).toHaveBeenCalledWith(false);
    expect(playGameSound).toHaveBeenCalledWith('toggle');
    expect(startGameBgm).toHaveBeenCalledTimes(3);
    expect(stopGameBgm).not.toHaveBeenCalled();
  });

  it('バトル終了後にプレイヤーの獲得カードを表示し、タイトル復帰で初期化する', async () => {
    await openBattle();

    // CPU の♡ 5 → 3 → 1。3ラウンド目は とどめのチャンスなので必殺技になる
    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'パー' }));
      await completeDifferentHandRound(round === 2);
      if (round < 2) {
        expect(screen.getByText('次のラウンド！')).toBeInTheDocument();
        await advance(NEXT_ROUND_DISPLAY_MS);
      }
    }

    expect(screen.getByRole('heading', { name: 'しょうり！' })).toBeInTheDocument();
    const resultBrand = document.querySelector<HTMLImageElement>('.result-brand');
    expect(resultBrand).not.toBeNull();
    expect(resultBrand).toHaveAttribute('src', '/assets/monjan-title-logo.png');
    expect(resultBrand).toHaveAttribute('width', '1774');
    expect(resultBrand).toHaveAttribute('height', '887');
    expect(resultBrand).toHaveAttribute('alt', 'モンじゃん！');
    expect(document.querySelector('.result-icon')).toBeNull();
    expect(playGameSound).toHaveBeenCalledWith('victory');
    fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));

    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('きみだけのモンスターを');
    expect(heading).toHaveTextContent('ゲット！');
    const card = document.querySelector<HTMLElement>('.acquired-card');
    expect(card).not.toBeNull();
    expect(card).toHaveClass('acquired-card--water');
    expect(within(card as HTMLElement).getByAltText(player.name)).toBeInTheDocument();
    expect(card).toHaveTextContent(player.name);
    expect(card).toHaveTextContent('水タイプ');
    expect(within(card as HTMLElement).getByLabelText('こうげき力 2')).toBeInTheDocument();
    expect(within(card as HTMLElement).getByLabelText('HP 4 / 4')).toBeInTheDocument();
    expect(screen.getByText(/あそんでくれて ありがとう/)).toBeInTheDocument();
    expect(playGameSound).toHaveBeenCalledWith('card-get');
    expect(stopGameBgm).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'タイトルへ もどる' }));
    expect(document.querySelector('.title-screen .title-logo')).toHaveAttribute('src', '/assets/monjan-title-logo.png');
    expect(stopGameBgm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /スタート！/ }));
    expect(screen.getByLabelText('HP 4 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();
    // もう一度はじめると、また練習ラウンドから
    expect(screen.getByText('れんしゅう')).toBeInTheDocument();
  });

  // 相手(CPU)の♡が1のモンスターで、練習を終えて本番の手えらびまで進める(weak = 'player' なら自分の♡が1)
  async function openFinishBattle(weak: 'player' | 'cpu' = 'cpu') {
    const byPath: Record<string, unknown> = {
      '/data/game-config.json': {
        samplePlayerMonsterId: 'MON-0001',
        sampleCpuMonsterId: 'MON-0002',
        monsters: ['/player.json', '/cpu.json'],
      },
      '/player.json': weak === 'player' ? { ...player, hp: 1000 } : player,
      '/cpu.json': weak === 'cpu' ? { ...cpu, hp: 1000 } : cpu,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => byPath[String(input)],
    })));

    await startToPractice();
    await advance(SUMMON_DISPLAY_MS);
    // 練習では とどめのチャンスにしない
    expect(document.querySelector('.finish-notice')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'グー' }));
    await advanceSelectedToReveal();
    await advance(REVEAL_DISPLAY_MS);
    expect(document.querySelector('.special-cutin')).toBeNull();
    await advance(ATTACK_DISPLAY_MS);
    await advance(IMPACT_DISPLAY_MS);
    await endPracticeToChoosing();
  }

  it('相手の♡が1のとき じゃんけんで勝つと、必殺技のカットインのあと 特大の攻撃で ⚔×2', async () => {
    await openFinishBattle();
    // 予告:相手のカードが光る
    expect(screen.getByText(/あと1！/)).toBeInTheDocument();
    expect(document.querySelector('.monster-panel--cpu')).toHaveClass('monster-panel--finish');
    expect(document.querySelector('.monster-panel--player')).not.toHaveClass('monster-panel--finish');
    // CPU はグー(Math.random = 0)。パーで勝つ
    fireEvent.click(screen.getByRole('button', { name: 'パー' }));
    await advanceSelectedToReveal();
    await advance(REVEAL_DISPLAY_MS);
    // 名前は 撮った物 + タイプの言葉。自分のモンスターの絵もカットインに出る
    const cutin = document.querySelector<HTMLElement>('.special-cutin');
    expect(cutin).not.toBeNull();
    expect(within(cutin as HTMLElement).getByText('水筒 スプラッシュ!')).toBeInTheDocument();
    expect(within(cutin as HTMLElement).getByAltText(player.name)).toBeInTheDocument();
    expect(cutin).toHaveClass('special-cutin--water');
    expect(document.querySelector('.battlefield')).toHaveClass('battlefield--shake-special');
    expect(playGameSound).toHaveBeenCalledWith('star-showdown');

    await advance(SPECIAL_DISPLAY_MS);
    expect(document.querySelector('.battle-screen')).toHaveClass('battle-screen--special');
    expect(screen.getByRole('status')).toHaveTextContent('ひっさつわざ');
    // 必殺技は ためが長い
    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('HP 1 / 1')).toBeInTheDocument();
    await advance(SPECIAL_ATTACK_MS - ATTACK_DISPLAY_MS);
    // ⚔2 × 2 = 4
    expect(screen.getByLabelText('HP 0 / 1')).toBeInTheDocument();
    expect(screen.getByLabelText('4ダメージ')).toBeInTheDocument();
    expect(document.querySelector('.special-impact-flash')).not.toBeNull();
    expect(document.querySelector('.battlefield')).toHaveClass('battlefield--shake-special');
  });

  it('相手の♡が1でも、あいこの連打勝負で勝ったときは ふつうの攻撃', async () => {
    await openFinishBattle();
    fireEvent.click(screen.getByRole('button', { name: 'グー' }));
    await advanceSelectedToReveal();
    await advance(REVEAL_DISPLAY_MS);
    for (let index = 0; index < CPU_MASH_MIN + 1; index += 1) fireEvent.keyDown(window, { key: 'Enter' });
    await advance(MASH_DUEL_MS);
    await advance(MASH_RESULT_MS);
    expect(document.querySelector('.special-cutin')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('こうげき');
    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('2ダメージ')).toBeInTheDocument();
  });

  it('相手の♡が1でも、負けたら必殺技は出ない', async () => {
    await openFinishBattle();
    // CPU はグー(Math.random = 0)。チョキは負け
    fireEvent.click(screen.getByRole('button', { name: 'チョキ' }));
    await advanceSelectedToReveal();
    await advance(REVEAL_DISPLAY_MS);
    expect(document.querySelector('.special-cutin')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('こうげき');
  });

  it('自分の♡が1のときは、予告も必殺技もない', async () => {
    await openFinishBattle('player');
    expect(document.querySelector('.finish-notice')).toBeNull();
    expect(document.querySelector('.monster-panel--finish')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'パー' }));
    await advanceSelectedToReveal();
    await advance(REVEAL_DISPLAY_MS);
    expect(document.querySelector('.special-cutin')).toBeNull();
    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('2ダメージ')).toBeInTheDocument();
  });
});

describe('撮影・合体の画面とのつなぎと、会場の3つのボタン', () => {
  const generated = {
    ...player,
    id: 'abc',
    name: 'ゴリシザー',
    attribute: 'とがってる',
    attack: 1000,
    hp: 3000,
    image: '/api/monster-image/abc',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const byPath: Record<string, unknown> = {
      '/data/game-config.json': {
        samplePlayerMonsterId: 'MON-0001',
        sampleCpuMonsterId: 'MON-0002',
        monsters: ['/player.json', '/cpu.json'],
      },
      '/player.json': player,
      '/cpu.json': cpu,
      '/api/battle-monster/abc': generated,
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => byPath[String(input)],
    })));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const press = (key: string) => fireEvent.keyDown(window, { key });

  it('展示ではタイトルのスタートで撮影・合体の画面へ移る', async () => {
    render(<App launch={{ photoId: null, skipTitle: false, toGenerator: true }} />);
    fireEvent.click(await screen.findByRole('button', { name: /スタート！/ }));
    expect(navigateTo).toHaveBeenCalledWith('/');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('「たたかう!」から来たら、生まれたモンスターでタイトルを飛ばして練習ラウンドから始める', async () => {
    render(<App launch={{ photoId: 'abc', skipTitle: true, toGenerator: true }} />);
    expect(await screen.findByText('れんしゅう')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByAltText('ゴリシザー')).toHaveAttribute('src', '/api/monster-image/abc');
    expect(screen.getByText('とがってるタイプ')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 3 / 3')).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('← / Enter / → だけで、スタートから練習ラウンド・本番のじゃんけんまで遊べる', async () => {
    render(<App launch={{ photoId: null, skipTitle: false, toGenerator: false }} />);
    await screen.findByRole('button', { name: /スタート！/ });
    vi.useFakeTimers();

    press('Enter');       // スタート → 練習ラウンド
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await advance(SUMMON_DISPLAY_MS);
    expect(screen.getByText('れんしゅうだよ！')).toBeInTheDocument();

    press('ArrowRight');  // → はパー(練習は必ず勝つ)
    expect(screen.getByRole('button', { name: 'パー' })).toHaveClass('hand-button--selected');
    await advanceSelectedToReveal();
    await advanceRevealToAttack(false);
    await advance(ATTACK_DISPLAY_MS);
    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByText('かったね！')).toBeInTheDocument();

    // 結果では ← → では進まない。中ボタンで「れんしゅうクリア」へ
    press('ArrowLeft');
    press('ArrowRight');
    expect(screen.getByText('かったね！')).toBeInTheDocument();
    press('Enter');
    expect(screen.getByRole('heading', { name: 'れんしゅう クリア！' })).toBeInTheDocument();
    // ここでも ← → では進まない。中ボタンで、本番を召喚から
    press('ArrowLeft');
    press('ArrowRight');
    expect(screen.getByRole('heading', { name: 'れんしゅう クリア！' })).toBeInTheDocument();
    press('Enter');
    expect(screen.queryByRole('heading', { name: 'れんしゅう クリア！' })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('モンスター召喚');
    await advance(SUMMON_DISPLAY_MS);
    vi.mocked(playGameSound).mockClear();

    press('ArrowRight');  // → はパー
    expect(screen.getByRole('button', { name: 'パー' })).toHaveClass('hand-button--selected');
    expect(playGameSound).toHaveBeenCalledWith('select');
    // 演出中に押しても、二重に選ばない
    press('ArrowLeft');
    expect(vi.mocked(playGameSound).mock.calls.filter(([kind]) => kind === 'select')).toHaveLength(1);
  });
});

describe('開発者メニュー(D キー)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDataFetch();
    vi.spyOn(Math, 'random').mockReturnValue(0);
    window.sessionStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.sessionStorage.clear();
  });

  const openMenu = () => fireEvent.keyDown(window, { key: 'd' });

  it('D で開き、画面へとべて、モンスターの中身が見える', async () => {
    render(<App launch={{ photoId: null, skipTitle: false, toGenerator: false }} />);
    await screen.findByRole('button', { name: /スタート！/ });
    openMenu();
    const menu = screen.getByRole('complementary', { name: '開発者メニュー' });
    expect(menu).toHaveTextContent('ボトルマンタ');
    expect(menu).toHaveTextContent('パンチイーグル');

    fireEvent.click(within(menu).getByRole('button', { name: 'かち' }));
    expect(screen.getByRole('heading', { name: 'しょうり！' })).toBeInTheDocument();
    fireEvent.click(within(menu).getByRole('button', { name: 'ありがとう' }));
    expect(screen.getByText(/あそんでくれて ありがとう/)).toBeInTheDocument();

    openMenu();
    expect(screen.queryByRole('complementary', { name: '開発者メニュー' })).not.toBeInTheDocument();
  });

  it('「かつ」にすると、ふつうなら あいこ になる手でも勝つ', async () => {
    render(<App launch={{ photoId: null, skipTitle: false, toGenerator: false }} />);
    await screen.findByRole('button', { name: /スタート！/ });
    vi.useFakeTimers();
    openMenu();
    fireEvent.click(screen.getByRole('radio', { name: 'かつ' }));
    fireEvent.click(screen.getByRole('button', { name: 'バトル' }));
    fireEvent.click(screen.getByRole('button', { name: 'とじる' }));

    // Math.random が 0 なので、ふつうなら CPU もグー
    fireEvent.click(screen.getByRole('button', { name: 'グー' }));
    await advanceSelectedToReveal();
    await advanceRevealToAttack(false);
    await advance(ATTACK_DISPLAY_MS);
    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('あなたの かち');
  });

  it('通しの自動プレイは、練習 → れんしゅうクリア → 本番の召喚 と進む', async () => {
    render(<App launch={{ photoId: null, skipTitle: false, toGenerator: false }} />);
    await screen.findByRole('button', { name: /スタート！/ });
    vi.useFakeTimers();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    fireEvent.click(screen.getByRole('button', { name: 'とじる' }));

    await advance(AUTOPLAY_TITLE_MS);
    expect(screen.getByText('れんしゅう')).toBeInTheDocument();
    await advance(SUMMON_DISPLAY_MS);
    await advance(AUTOPLAY_HAND_MS);
    await advanceSelectedToReveal();
    await advanceRevealToAttack(false);
    await advance(ATTACK_DISPLAY_MS);
    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByText('かったね！')).toBeInTheDocument();

    await advance(AUTOPLAY_RULES_MS);
    expect(screen.getByRole('heading', { name: 'れんしゅう クリア！' })).toBeInTheDocument();
    await advance(AUTOPLAY_RULES_MS);
    expect(screen.getByRole('status')).toHaveTextContent('モンスター召喚');
    expect(screen.queryByText('れんしゅう')).not.toBeInTheDocument();
  });

  it('通しの自動プレイ中は、タイトルで少し待ってから撮影の画面へ進む', async () => {
    render(<App launch={{ photoId: null, skipTitle: false, toGenerator: true }} />);
    await screen.findByRole('button', { name: /スタート！/ });
    vi.useFakeTimers();
    openMenu();
    fireEvent.click(screen.getByRole('button', { name: /開始/ }));
    expect(JSON.parse(window.sessionStorage.getItem('monjan-autoplay') ?? '{}')).toEqual({ on: true, loops: 0 });
    // メニューを開いているあいだは止まっている
    await advance(AUTOPLAY_TITLE_MS);
    expect(navigateTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'とじる' }));
    expect(screen.getByText(/自動プレイ中 0周/)).toBeInTheDocument();
    await advance(AUTOPLAY_TITLE_MS - 1);
    expect(navigateTo).not.toHaveBeenCalled();
    await advance(1);
    expect(navigateTo).toHaveBeenCalledWith('/');
  });
});
