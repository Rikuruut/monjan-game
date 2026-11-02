import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  App,
  ATTACK_DISPLAY_MS,
  AUTOPLAY_TITLE_MS,
  IMPACT_DISPLAY_MS,
  JANKEN_BEAT_MS,
  NEXT_ROUND_DISPLAY_MS,
  RARITY_ROLL_MS,
  RESULT_DISPLAY_MS,
  REVEAL_DISPLAY_MS,
  SELECTED_DISPLAY_MS,
  STAR_SHOWDOWN_MS,
  SUMMON_DISPLAY_MS,
} from './App';
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

async function startToTutorial() {
  render(<App />);
  const startButton = await screen.findByRole('button', { name: /スタート！/ });
  vi.useFakeTimers();
  fireEvent.click(startButton);
}

async function closeTutorialToChoosing() {
  fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));
  fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));
  fireEvent.click(screen.getByRole('button', { name: 'バトルスタート！' }));
  await advance(SUMMON_DISPLAY_MS);
  await advance(RARITY_ROLL_MS);
}

async function openBattle() {
  await startToTutorial();
  await closeTutorialToChoosing();
}

async function advanceSelectedToReveal() {
  await advance(SELECTED_DISPLAY_MS);
  await advance(JANKEN_BEAT_MS);
  await advance(JANKEN_BEAT_MS);
  await advance(JANKEN_BEAT_MS);
}

async function advanceRevealToAttack(hasStarShowdown: boolean) {
  await advance(REVEAL_DISPLAY_MS);
  if (hasStarShowdown) await advance(STAR_SHOWDOWN_MS);
}

async function completeDifferentHandRound() {
  await advanceSelectedToReveal();
  await advanceRevealToAttack(false);
  await advance(ATTACK_DISPLAY_MS);
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
  expect(panel.querySelector('.star-strength')).toHaveTextContent('？？？');
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

  it('子どもが読める長さで、じゃんけんと星勝負のテロップを表示する', () => {
    expect(SELECTED_DISPLAY_MS).toBe(400);
    expect(JANKEN_BEAT_MS).toBe(700);
    expect(REVEAL_DISPLAY_MS).toBe(1000);
    expect(STAR_SHOWDOWN_MS).toBe(1200);
  });

  it('初回チュートリアルを大きな絵と短い3ステップで説明し、最後まで召喚を始めない', async () => {
    await startToTutorial();

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /じゃんけんで\s*勝負/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/グー・チョキ・パーから\s*1つ\s*えらぼう/);
    expect(dialog).toHaveTextContent('✊');
    expect(dialog).toHaveTextContent('✌');
    expect(dialog).toHaveTextContent('✋');
    expect(playGameSound).not.toHaveBeenCalledWith('summon');

    fireEvent.click(within(dialog).getByRole('button', { name: 'つぎへ' }));
    expect(within(dialog).getByRole('heading', { name: /同じ手なら\s*星で勝負/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('★★★');
    expect(dialog).toHaveTextContent(/おたがいの♡が\s*1つへる/);
    expect(playGameSound).not.toHaveBeenCalledWith('summon');

    fireEvent.click(within(dialog).getByRole('button', { name: 'つぎへ' }));
    expect(within(dialog).getByRole('heading', { name: /相手の\s*ハートをへらそう/ })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('⚔');
    expect(dialog).toHaveTextContent(/相手の♡を\s*ぜんぶなくしたら\s*かち/);
    expect(within(dialog).getByRole('button', { name: 'バトルスタート！' })).toBeInTheDocument();
    expect(playGameSound).not.toHaveBeenCalledWith('summon');

    fireEvent.click(within(dialog).getByRole('button', { name: 'バトルスタート！' }));
    expect(playGameSound).toHaveBeenCalledWith('summon');
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

  it('召喚と抽選後にだけ選択でき、じゃん・けん・ぽんの後までCPUの手と星をDOMへ出さない', async () => {
    await startToTutorial();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /グー 星/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));
    fireEvent.click(screen.getByRole('button', { name: 'つぎへ' }));
    fireEvent.click(screen.getByRole('button', { name: 'バトルスタート！' }));
    expect(screen.getByRole('status')).toHaveTextContent('モンスター召喚');
    expect(screen.queryByRole('button', { name: /グー 星/ })).not.toBeInTheDocument();
    expect(playGameSound).toHaveBeenCalledWith('summon');

    await advance(SUMMON_DISPLAY_MS - 1);
    expect(screen.getByRole('status')).toHaveTextContent('モンスター召喚');
    await advance(1);

    expect(screen.getByText('★ レア度抽選！')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /パー 星/ })).toBeDisabled();
    await advance(RARITY_ROLL_MS);

    const paper = screen.getByRole('button', { name: /パー 星/ });
    expect(paper).toBeEnabled();
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
    expect(cpuHand.querySelector('.star-strength')).toHaveTextContent('★★');

    await advance(REVEAL_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('こうげき');
    expect(screen.queryByText('星の強さで勝負！')).not.toBeInTheDocument();
  });

  it('同じ手だけ星勝負を表示し、星が多い側の攻撃へ進む', async () => {
    await startToTutorial();
    // プレイヤーrock=★2、CPU rock=★1、CPU手=rock。
    setRandomSequence(0, 0, 0.999, 0.999, 0);
    await closeTutorialToChoosing();

    fireEvent.click(screen.getByRole('button', { name: /グー 星2/ }));
    await advanceSelectedToReveal();

    const playerHand = document.querySelector<HTMLElement>('.revealed-hand--player');
    const cpuHand = getCpuHandPanel();
    expect(playerHand?.querySelector('.star-strength')).toHaveTextContent('★★');
    expect(cpuHand.querySelector('.star-strength')).toHaveTextContent('★');

    await advance(REVEAL_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('星の強さで勝負');
    expect(playerHand).toHaveClass('revealed-hand--winner');
    expect(playGameSound).toHaveBeenCalledWith('star-showdown');
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();

    await advance(STAR_SHOWDOWN_MS - 1);
    expect(screen.getByRole('status')).toHaveTextContent('星の強さで勝負');
    await advance(1);
    expect(screen.getByRole('status')).toHaveTextContent('こうげき');

    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('HP 3 / 5')).toBeInTheDocument();
  });

  it('同じ手・同じ星は「あいこ」と表示し、命中時に双方のHPを1だけ減らす', async () => {
    await openBattle();
    fireEvent.click(screen.getByRole('button', { name: /グー 星2/ }));
    await advanceSelectedToReveal();
    await advance(REVEAL_DISPLAY_MS);

    expect(screen.getByRole('status')).toHaveTextContent('あいこ！');
    expect(document.body).not.toHaveTextContent('完全あいこ');
    expect(document.body).not.toHaveTextContent('まったく おなじ');
    expect(playGameSound).toHaveBeenCalledWith('tie');
    expect(screen.getByLabelText('HP 4 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();

    await advance(STAR_SHOWDOWN_MS);
    expect(screen.getByRole('status')).toHaveTextContent('おたがいに ダメージ');
    expect(screen.getByLabelText('HP 4 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 5 / 5')).toBeInTheDocument();

    await advance(ATTACK_DISPLAY_MS);
    expect(screen.getByLabelText('HP 3 / 4')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 4 / 5')).toBeInTheDocument();
    expect(screen.getAllByLabelText('1ダメージ')).toHaveLength(2);

    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('あいこ！');
    expect(document.body).not.toHaveTextContent('完全あいこ');
  });

  it('手を選ぶ画面のルールボタンで説明を再確認し、HPとラウンドを保って戻れる', async () => {
    await openBattle();
    const playerHpBefore = screen.getByLabelText('HP 4 / 4');
    const cpuHpBefore = screen.getByLabelText('HP 5 / 5');
    const summonCallsBefore = vi.mocked(playGameSound).mock.calls.filter(([sound]) => sound === 'summon').length;

    fireEvent.click(screen.getByRole('button', { name: /ルール/ }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /じゃんけんで\s*勝負/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /パー 星/ })).toBeDisabled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'つぎへ' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'つぎへ' }));
    fireEvent.click(within(dialog).getByRole('button', { name: /バトルにもどる/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /パー 星/ })).toBeEnabled();
    expect(playerHpBefore).toBeInTheDocument();
    expect(cpuHpBefore).toBeInTheDocument();
    expect(vi.mocked(playGameSound).mock.calls.filter(([sound]) => sound === 'summon')).toHaveLength(summonCallsBefore);
  });

  it('演出中に連打しても判定・効果音・HP反映を一度だけ行う', async () => {
    await openBattle();
    const paper = screen.getByRole('button', { name: /パー 星/ });
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

    await advance(NEXT_ROUND_DISPLAY_MS);
    expect(screen.getByText('★ レア度抽選！')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /パー 星/ })).toBeDisabled();
    await advance(RARITY_ROLL_MS);
    expect(screen.getByRole('button', { name: /パー 星/ })).toBeEnabled();
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

    for (let round = 0; round < 3; round += 1) {
      fireEvent.click(screen.getByRole('button', { name: /パー 星/ }));
      await completeDifferentHandRound();
      if (round < 2) {
        expect(screen.getByText('次のラウンド！')).toBeInTheDocument();
        await advance(NEXT_ROUND_DISPLAY_MS);
        await advance(RARITY_ROLL_MS);
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
    expect(screen.getByRole('dialog')).toBeInTheDocument();
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

  it('「たたかう!」から来たら、生まれたモンスターでタイトルを飛ばしてルール説明から始める', async () => {
    render(<App launch={{ photoId: 'abc', skipTitle: true, toGenerator: true }} />);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByAltText('ゴリシザー')).toHaveAttribute('src', '/api/monster-image/abc');
    expect(screen.getByText('とがってるタイプ')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 3 / 3')).toBeInTheDocument();
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('← / Enter / → だけで、スタートからじゃんけんまで遊べる', async () => {
    render(<App launch={{ photoId: null, skipTitle: false, toGenerator: false }} />);
    await screen.findByRole('button', { name: /スタート！/ });
    vi.useFakeTimers();

    press('Enter');
    expect(screen.getByRole('heading', { name: /じゃんけんで\s*勝負/ })).toBeInTheDocument();
    press('Enter');
    press('ArrowLeft');   // もどる
    expect(screen.getByRole('heading', { name: /じゃんけんで\s*勝負/ })).toBeInTheDocument();
    press('Enter');
    press('Enter');
    // ルール説明のあいだは、手を選ばない
    press('ArrowRight');
    expect(playGameSound).not.toHaveBeenCalledWith('select');
    press('Enter');       // バトルスタート！
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await advance(SUMMON_DISPLAY_MS);
    await advance(RARITY_ROLL_MS);

    press('ArrowRight');  // → はパー
    expect(screen.getByRole('button', { name: /パー 星/ })).toHaveClass('hand-button--selected');
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
    await advance(RARITY_ROLL_MS);

    // Math.random が 0 なので、ふつうなら CPU もグー
    fireEvent.click(screen.getByRole('button', { name: /グー 星/ }));
    await advanceSelectedToReveal();
    await advanceRevealToAttack(false);
    await advance(ATTACK_DISPLAY_MS);
    await advance(IMPACT_DISPLAY_MS);
    expect(screen.getByRole('status')).toHaveTextContent('あなたの かち');
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
