import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BATTLE_CONFIG } from '../game/config';
import { seededRandom } from '../game/simulate';
import { CARD_DAMAGE_MS, CARD_DRAW_MS, CARD_JANKEN_BEAT_MS, CARD_REVEAL_MS, MASH_DUEL_MS, MASH_RESULT_MS } from '../timings';
import type { Monster } from '../types';
import { CardBattle, trialConfig } from './CardBattle';

const monster = (id: string, name: string, attack: Monster['attack']): Monster => ({
  id,
  name,
  source: { animal: 'ゴリラ', object: 'はさみ' },
  attribute: '風',
  attack,
  hp: 3000,
  description: 'テスト用',
  image: '/monsters/test.png',
});

// 1ターンが かならず終わる長さ(じゃんけん → めくる → 連打 → ダメージ → ドロー)
const TURN_MS = CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS + MASH_DUEL_MS + MASH_RESULT_MS + CARD_DAMAGE_MS + CARD_DRAW_MS;

const press = (key: 'ArrowLeft' | 'ArrowRight' | 'Enter') => {
  fireEvent.keyDown(window, { key });
  fireEvent.keyUp(window, { key });
};
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const handCards = () => screen.getAllByTestId(/^hand-card-/);
const cursorIndex = () => handCards().findIndex((card) => card.getAttribute('aria-current') === 'true');
const prompt = () => screen.getByLabelText('じぶんの てふだ').querySelector('.cb-hand__prompt')?.textContent ?? '';

function renderBattle(seed = 1) {
  const playSound = vi.fn();
  render(
    <CardBattle
      player={monster('p', 'ゴリザミ', 2000)}
      cpu={monster('c', 'ドライオン', 1000)}
      config={trialConfig(DEFAULT_BATTLE_CONFIG)}
      playSound={playSound}
      random={seededRandom(seed)}
    />,
  );
  return { playSound };
}

describe('カードバトル(段階2a:1ラウンド・じゃんけんカードだけ)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('はじまり:手札5枚(じゃんけんカードだけ)、相手の手札は マークだけ3枚と ふせたカード、HP は数字で出る', () => {
    renderBattle();
    expect(handCards()).toHaveLength(5);
    expect(screen.getByLabelText('じぶんの てふだ').querySelectorAll('.cb-card--skill, .cb-card--finisher')).toHaveLength(0);
    const cpuHand = screen.getByLabelText('あいての てふだ');
    expect(cpuHand.querySelectorAll('.cb-card')).toHaveLength(3);
    // 相手の★は見えない
    expect(cpuHand.textContent).not.toMatch(/★★|★1|★2|★3/);
    expect(screen.getByLabelText('ふせたカード')).toBeInTheDocument();
    expect(screen.getByLabelText('HP 100 / 100')).toBeInTheDocument();
    // 古い ⚔2 は 攻撃力10
    expect(screen.getByLabelText('こうげき力 10')).toBeInTheDocument();
    expect(prompt()).toBe('だす カードを えらぼう！');
    expect(cursorIndex()).toBe(0);
  });

  it('←→でカーソルが動き、端で止まる', () => {
    renderBattle();
    press('ArrowLeft');
    expect(cursorIndex()).toBe(0);
    press('ArrowRight');
    press('ArrowRight');
    expect(cursorIndex()).toBe(2);
    for (let index = 0; index < 6; index += 1) press('ArrowRight');
    expect(cursorIndex()).toBe(4);
  });

  it('決定は2回押し:1回目で説明が出て、←→で取り消し(カーソルは動かない)', () => {
    renderBattle();
    press('ArrowRight');
    press('Enter');
    expect(prompt()).toMatch(/かつと \d+ ダメージ！ もういちど けっていで だす/);
    expect(handCards()[1].className).toContain('cb-hand__slot--armed');
    press('ArrowRight');
    expect(prompt()).toBe('だす カードを えらぼう！');
    expect(cursorIndex()).toBe(1);
    expect(handCards()).toHaveLength(5);
  });

  it('2回目の決定で出す:じゃん・けん・ぽん → めくる → ダメージ → 1枚引いて 次のターン', () => {
    const { playSound } = renderBattle();
    press('Enter');
    press('Enter');
    expect(screen.getByText('じゃん')).toBeInTheDocument();
    expect(handCards()).toHaveLength(4);
    // じゃんけんの あいだは 手札を動かせない
    press('ArrowRight');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.getByText('けん')).toBeInTheDocument();
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.getByText('ぽん！')).toBeInTheDocument();
    wait(CARD_JANKEN_BEAT_MS);
    // めくると ふせたカードは なくなる
    expect(screen.queryByLabelText('ふせたカード')).not.toBeInTheDocument();

    wait(TURN_MS);
    // どちらかの HP が減っている
    const hps = screen.getAllByLabelText(/^HP \d+ \/ \d+$/).map((bar) => bar.getAttribute('aria-label'));
    expect(hps.some((label) => { const [, hp, max] = /HP (\d+) \/ (\d+)/.exec(label ?? '') ?? []; return Number(hp) < Number(max); })).toBe(true);
    expect(playSound).toHaveBeenCalledWith('janken-pon');
    expect(playSound).toHaveBeenCalledWith('impact');
  });

  it('連打勝負:同じ手・同じ★なら どのボタンでも1回に数える', () => {
    // 連打勝負になる種を さがす(1ターン目に 先頭のカードを出す)
    for (let seed = 1; seed <= 200; seed += 1) {
      const view = render(
        <CardBattle
          player={monster('p', 'ゴリザミ', 2000)}
          cpu={monster('c', 'ドライオン', 1000)}
          config={trialConfig(DEFAULT_BATTLE_CONFIG)}
          playSound={vi.fn()}
          random={seededRandom(seed)}
        />,
      );
      press('Enter');
      press('Enter');
      wait(CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS);
      if (screen.queryByText('れんだ しょうぶ！')) {
        press('ArrowLeft');
        press('Enter');
        press('ArrowRight');
        expect(screen.getByLabelText('あなたの れんだ 3かい')).toBeInTheDocument();
        wait(MASH_DUEL_MS);
        expect(screen.getByText(/の かち！/)).toBeInTheDocument();
        view.unmount();
        return;
      }
      view.unmount();
    }
    throw new Error('連打勝負になる種が見つかりませんでした');
  });

  it('どちらかの HP が0になるまで続き、決定で はじめから やり直せる', () => {
    renderBattle(3);
    for (let turn = 0; turn < 60 && !screen.queryByText(/かった！|まけちゃった…/); turn += 1) {
      press('Enter');
      press('Enter');
      wait(TURN_MS);
    }
    expect(screen.getByText(/かった！|まけちゃった…/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^HP 0 \/ \d+$/)).toHaveLength(1);

    press('Enter');
    expect(screen.queryByText(/かった！|まけちゃった…/)).not.toBeInTheDocument();
    expect(handCards()).toHaveLength(5);
    expect(screen.getByLabelText('HP 100 / 100')).toBeInTheDocument();
  });
});
