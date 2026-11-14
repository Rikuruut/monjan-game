import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, JankenCard } from '../game/cards';
import { DEFAULT_BATTLE_CONFIG } from '../game/config';
import type { BattleState } from '../game/engine';
import { seededRandom } from '../game/simulate';
import {
  CARD_DAMAGE_MS,
  CARD_DRAW_MS,
  CARD_JANKEN_BEAT_MS,
  CARD_REVEAL_MS,
  CARD_SKILL_MS,
  MASH_DUEL_MS,
  MASH_RESULT_MS,
  SPECIAL_DISPLAY_MS,
} from '../timings';
import type { Hand, Monster } from '../types';
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

const janken = (id: string, hand: Hand, star: 1 | 2 | 3): JankenCard => ({ id, kind: 'janken', hand, star });
const heal: Card = { id: 'heal', kind: 'skill', skill: 'heal' };
const seal: Card = { id: 'seal', kind: 'skill', skill: 'seal' };

// 1ターンが かならず終わる長さ(じゃんけん → めくる → 連打 → ダメージ → ドロー)
const TURN_MS = CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS + MASH_DUEL_MS + MASH_RESULT_MS + CARD_DAMAGE_MS + CARD_DRAW_MS;

const press = (key: 'ArrowLeft' | 'ArrowRight' | 'Enter') => {
  fireEvent.keyDown(window, { key });
  fireEvent.keyUp(window, { key });
};
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const handItems = () => screen.getAllByTestId(/^hand-item-/);
const cursorIndex = () => handItems().findIndex((item) => item.getAttribute('aria-current') === 'true');
const prompt = () => screen.getByLabelText('じぶんの てふだ').querySelector('.cb-hand__prompt')?.textContent ?? '';
const hpOf = (side: 0 | 1) => screen.getAllByLabelText(/^HP \d+ \/ \d+$/)[side].getAttribute('aria-label');

/** 手札と相手の手札を決めて始める(相手は cpuHand の先頭を ふせる) */
function withHands(hand: Card[], cpuHand: JankenCard[], extra: (state: BattleState) => BattleState = (state) => state) {
  return (state: BattleState): BattleState => extra({
    ...state,
    player: { ...state.player, hand },
    cpu: { ...state.cpu, hand: cpuHand, placedId: cpuHand[0].id },
  });
}

function renderBattle(options: { seed?: number; setup?: (state: BattleState) => BattleState } = {}) {
  const playSound = vi.fn();
  const view = render(
    <CardBattle
      player={monster('p', 'ゴリザミ', 2000)}
      cpu={monster('c', 'ドライオン', 1000)}
      config={trialConfig(DEFAULT_BATTLE_CONFIG)}
      playSound={playSound}
      random={seededRandom(options.seed ?? 1)}
      setup={options.setup}
    />,
  );
  return { playSound, ...view };
}

/** ボス(round 3)と戦う */
function renderBoss(setup: (state: BattleState) => BattleState) {
  return render(
    <CardBattle
      player={monster('p', 'ゴリザミ', 2000)}
      cpu={monster('c', 'ドライオン', 1000)}
      config={trialConfig(DEFAULT_BATTLE_CONFIG, 3)}
      playSound={vi.fn()}
      random={seededRandom(1)}
      setup={setup}
    />,
  );
}

describe('カードバトル:手札と じゃんけん', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const basic = withHands(
    [janken('a', 'rock', 1), janken('b', 'scissors', 2), janken('c', 'paper', 1), janken('d', 'paper', 3), janken('e', 'rock', 2)],
    [janken('x', 'rock', 1), janken('y', 'paper', 2), janken('z', 'scissors', 1)],
  );

  it('はじまり:相手の手札は マークだけ3枚と ふせたカード、HP は数字で出る', () => {
    renderBattle({ setup: basic });
    expect(handItems()).toHaveLength(5);
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
    renderBattle({ setup: basic });
    press('ArrowLeft');
    expect(cursorIndex()).toBe(0);
    press('ArrowRight');
    press('ArrowRight');
    expect(cursorIndex()).toBe(2);
    for (let index = 0; index < 6; index += 1) press('ArrowRight');
    expect(cursorIndex()).toBe(4);
  });

  it('決定は2回押し:1回目で説明が出て、←→で取り消し(カーソルは動かない)', () => {
    renderBattle({ setup: basic });
    press('ArrowRight');
    press('Enter');
    expect(prompt()).toBe('チョキ ★2:かつと 35 ダメージ！ もういちど けっていで だす');
    expect(handItems()[1].className).toContain('cb-hand__slot--armed');
    press('ArrowRight');
    expect(prompt()).toBe('だす カードを えらぼう！');
    expect(cursorIndex()).toBe(1);
    expect(handItems()).toHaveLength(5);
  });

  it('2回目の決定で出す:じゃん・けん・ぽん → めくる → ダメージ → 1枚引いて 次のターン', () => {
    // パー★1 で 相手のグー★1 に勝つ
    const { playSound } = renderBattle({ setup: basic });
    press('ArrowRight');
    press('ArrowRight');
    press('Enter');
    press('Enter');
    expect(screen.getByText('じゃん')).toBeInTheDocument();
    expect(handItems()).toHaveLength(4);
    // じゃんけんの あいだは 手札を動かせない
    press('ArrowRight');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.getByText('けん')).toBeInTheDocument();
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.getByText('ぽん！')).toBeInTheDocument();
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.queryByLabelText('ふせたカード')).not.toBeInTheDocument();
    expect(screen.getByText('あなたの かち！')).toBeInTheDocument();

    wait(CARD_REVEAL_MS);
    expect(screen.getByLabelText('20ダメージ')).toBeInTheDocument();
    wait(CARD_DAMAGE_MS);
    expect(prompt()).toBe('カードを 1まい ひいたよ！');
    wait(CARD_DRAW_MS);
    expect(handItems().filter((item) => item.querySelector('.cb-card'))).toHaveLength(5);
    expect(playSound).toHaveBeenCalledWith('janken-pon');
    expect(playSound).toHaveBeenCalledWith('impact');
  });

  it('連打勝負:同じ手・同じ★なら どのボタンでも1回に数える', () => {
    // グー★1 どうし
    renderBattle({ setup: basic });
    press('Enter');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS);
    expect(screen.getByText('れんだ しょうぶ！')).toBeInTheDocument();
    press('ArrowLeft');
    press('Enter');
    press('ArrowRight');
    expect(screen.getByLabelText('あなたの れんだ 3かい')).toBeInTheDocument();
    wait(MASH_DUEL_MS);
    expect(screen.getByText(/の かち！/)).toBeInTheDocument();
  });

  it('どちらかの HP が0になるまで続き、決定で はじめから やり直せる', () => {
    renderBattle({ seed: 3 });
    for (let turn = 0; turn < 60 && !screen.queryByText(/かった！|まけちゃった…/); turn += 1) {
      // 使えるものを 先頭から さがして使う(合成・スキル・カード)
      press('Enter');
      press('Enter');
      wait(CARD_SKILL_MS);
      press('Enter');
      wait(TURN_MS);
    }
    expect(screen.getByText(/かった！|まけちゃった…/)).toBeInTheDocument();
    expect(screen.getAllByLabelText(/^HP 0 \/ \d+$/)).toHaveLength(1);

    press('Enter');
    expect(screen.queryByText(/かった！|まけちゃった…/)).not.toBeInTheDocument();
    expect(screen.getByLabelText('HP 100 / 100')).toBeInTheDocument();
  });
});

describe('カードバトル:合成', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const cpu = [janken('x', 'rock', 1), janken('y', 'paper', 2), janken('z', 'scissors', 1)];

  it('ペアがあると 左はしに「がったい!」の枠が出る。カーソルは じゃんけんカードの先頭から', () => {
    renderBattle({ setup: withHands([janken('a', 'rock', 1), janken('b', 'rock', 1), janken('c', 'paper', 1)], cpu) });
    expect(handItems()).toHaveLength(4);
    expect(screen.getByLabelText('がったい')).toBeInTheDocument();
    expect(cursorIndex()).toBe(1);
  });

  it('ペアがなければ 枠は出ない', () => {
    renderBattle({ setup: withHands([janken('a', 'rock', 1), janken('b', 'rock', 2), janken('c', 'rock', 3), janken('d', 'rock', 3)], cpu) });
    expect(screen.queryByLabelText('がったい')).not.toBeInTheDocument();
  });

  it('枠をえらぶと ペアが光り、決定2回で ★が1つ上の1枚になる(スキルの枠は使わない)', () => {
    renderBattle({ setup: withHands([seal, janken('a', 'rock', 2), janken('b', 'rock', 2), janken('c', 'paper', 1)], cpu) });
    // 並び:[がったい!, ふうじて, グー★2, グー★2, パー★1]
    press('ArrowLeft');
    press('ArrowLeft');
    expect(cursorIndex()).toBe(0);
    expect(prompt()).toBe('おなじ カードが 2まい！ がったい できるよ');
    expect(handItems().filter((item) => item.className.includes('cb-hand__slot--pair'))).toHaveLength(2);
    press('Enter');
    expect(prompt()).toMatch(/もういちど けっていで がったい/);
    press('Enter');
    expect(screen.getByText('がったい！ グー ★3 に なった！')).toBeInTheDocument();
    wait(CARD_SKILL_MS);
    // ペアがなくなったので 枠も消える。合成したカードに カーソル
    expect(screen.queryByLabelText('がったい')).not.toBeInTheDocument();
    expect(handItems()).toHaveLength(3);
    expect(handItems()[cursorIndex()].querySelector('[aria-label="グー ★3"]')).not.toBeNull();
    // スキルは まだ使える
    expect(screen.queryByLabelText('スキルは しようずみ')).not.toBeInTheDocument();
  });

  it('ペアが2組あるときは ←→でペアをえらぶ。「やめる」で もどる', () => {
    const hand = [janken('a', 'rock', 1), janken('b', 'rock', 1), janken('c', 'paper', 2), janken('d', 'paper', 2)];
    renderBattle({ setup: withHands(hand, cpu) });
    press('ArrowLeft');
    press('Enter');
    press('Enter');
    expect(prompt()).toBe('どれを がったいする？');
    expect(screen.getByRole('option', { name: 'グー ★1 × 2' })).toHaveAttribute('aria-selected', 'true');
    press('ArrowRight');
    press('ArrowRight');
    expect(screen.getByRole('option', { name: 'やめる' })).toHaveAttribute('aria-selected', 'true');
    press('Enter');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(handItems()).toHaveLength(5);

    // もういちど:2組めの パー★2 を合成
    press('Enter');
    press('Enter');
    press('ArrowRight');
    press('Enter');
    expect(screen.getByText('がったい！ パー ★3 に なった！')).toBeInTheDocument();
  });
});

describe('カードバトル:スキル', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('回復:1回目で もどる量が出て、2回目で HP が満タンに。そのターンは もうスキルを使えない', () => {
    const hand = [heal, seal, janken('a', 'rock', 1)];
    const cpu = [janken('x', 'rock', 1), janken('y', 'paper', 2)];
    renderBattle({ setup: withHands(hand, cpu, (state) => ({ ...state, player: { ...state.player, hp: 40 } })) });
    expect(hpOf(0)).toBe('HP 40 / 100');
    press('ArrowLeft');
    press('ArrowLeft');
    press('Enter');
    expect(prompt()).toBe('かいふく:HPが 60 もどるよ！ もういちど けっていで つかう');
    press('Enter');
    expect(screen.getByText('HPが 60 もどった！')).toBeInTheDocument();
    expect(hpOf(0)).toBe('HP 100 / 100');
    wait(CARD_SKILL_MS);

    expect(screen.getByLabelText('スキルは しようずみ')).toBeInTheDocument();
    // 封じ手は 暗くなって 浮かない
    press('ArrowLeft');
    expect(prompt()).toBe('ふうじて:スキルは 1ターンに 1まいまで！');
    press('Enter');
    expect(handItems()[cursorIndex()].className).not.toContain('cb-hand__slot--armed');
    expect(handItems()[cursorIndex()].className).toContain('cb-hand__slot--blocked');
  });

  it('封じ手:相手の手を1つ封じ、ふせたカードは 封じた手以外で 出し直される', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const cpu = [janken('x', 'rock', 1), janken('y', 'paper', 2), janken('z', 'rock', 3)];
      const view = renderBattle({ seed, setup: withHands([seal, janken('a', 'scissors', 1)], cpu) });
      press('ArrowLeft');
      press('Enter');
      expect(prompt()).toMatch(/^ふうじて:あいての 手を 1つ ふうじる！/);
      press('Enter');
      const message = screen.getByText(/を ふうじた！ あいては カードを だしなおしたよ/).textContent ?? '';
      const sealed = message.startsWith('グー') ? 'rock' : 'paper';
      // 封じた手のカードに 鎖
      const chained = screen.getAllByLabelText('ふうじられている');
      expect(chained).toHaveLength(sealed === 'rock' ? 2 : 1);

      // 出したあと:相手が出したのは 封じた手ではない
      wait(CARD_SKILL_MS);
      press('Enter');
      press('Enter');
      wait(CARD_JANKEN_BEAT_MS * 3);
      const fieldCard = screen.getByText(/あなたの かち|あいての かち|あいこ/).closest('.cb-center')?.querySelectorAll('.cb-field .cb-card')[1];
      expect(fieldCard?.getAttribute('aria-label')).not.toMatch(sealed === 'rock' ? /^グー/ : /^パー/);
      view.unmount();
    }
  });

  it('相手の手札が全部同じ手のとき、封じ手は暗くなって使えない', () => {
    renderBattle({ setup: withHands([seal, janken('a', 'paper', 1)], [janken('x', 'rock', 1), janken('y', 'rock', 2)]) });
    press('ArrowLeft');
    expect(prompt()).toBe('ふうじて:あいての 手が ぜんぶ おなじなので つかえない');
    press('Enter');
    press('Enter');
    expect(screen.queryByText(/ふうじた！/)).not.toBeInTheDocument();
  });
});

describe('カードバトル:必殺技', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const finisher: Card = { id: 'fin', kind: 'finisher' };

  it('必殺技を出すと、かけ声なしで すぐカットイン → 相手を かならず倒す', () => {
    const cpu = [janken('x', 'rock', 3), janken('y', 'paper', 2)];
    renderBattle({ setup: withHands([janken('a', 'scissors', 1), finisher], cpu) });
    press('ArrowRight');
    press('Enter');
    expect(prompt()).toBe('ひっさつわざ:どんな 手にも かって かならず たおす！ もういちど けっていで だす');
    press('Enter');
    expect(screen.queryByText('じゃん')).not.toBeInTheDocument();
    expect(screen.getByText('ひっさつわざ！')).toBeInTheDocument();
    wait(SPECIAL_DISPLAY_MS);
    expect(hpOf(1)).toMatch(/^HP 0 \//);
    wait(CARD_DAMAGE_MS);
    expect(screen.getByText('かった！')).toBeInTheDocument();
  });

  it('ボス:相手の HP が半分以下になったら、次のドローで 必殺技のカードが かならず来る', () => {
    const cpu = [janken('x', 'rock', 1), janken('y', 'rock', 2), janken('z', 'scissors', 1)];
    renderBoss(withHands([janken('a', 'paper', 1), janken('b', 'rock', 1)], cpu, (state) => ({
      ...state,
      cpu: { ...state.cpu, hp: 50, maxHp: 60 },
    })));
    // パー★1 で グー★1 に勝つ:50 - 20 = 30(半分以下)
    press('Enter');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS + CARD_DAMAGE_MS);
    expect(prompt()).toBe('ひっさつわざ カードが きた！');
    expect(screen.getByLabelText('じぶんの てふだ').querySelector('.cb-card--finisher')).not.toBeNull();
  });
});

describe('カードバトル:相手のスキル(ボス)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('回復:相手の HP が4割以下になった次のターンのはじめに +30', () => {
    const cpu = [janken('x', 'rock', 1), janken('y', 'rock', 2), janken('z', 'scissors', 1)];
    renderBoss(withHands([janken('a', 'paper', 1), janken('b', 'rock', 1), janken('c', 'rock', 2)], cpu, (state) => ({
      ...state,
      // 必殺技が来ないように 使ったことにする
      finisherUsed: true,
      cpu: { ...state.cpu, hp: 40, maxHp: 60 },
    })));
    press('Enter');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS + CARD_DAMAGE_MS + CARD_DRAW_MS);
    expect(screen.getByText('あいての かいふく！ HPが 30 もどった')).toBeInTheDocument();
    expect(hpOf(1)).toBe('HP 50 / 60');
    wait(CARD_SKILL_MS);
    expect(prompt()).toBe('だす カードを えらぼう！');
  });

  it('ため技:3ターン目に予告して オーラが出る', () => {
    const cpu = [janken('x', 'rock', 1), janken('y', 'rock', 2), janken('z', 'scissors', 1)];
    renderBoss(withHands([janken('a', 'paper', 1), janken('b', 'rock', 1)], cpu, (state) => ({ ...state, turn: 2, finisherUsed: true })));
    expect(screen.queryByText('⚡ ためている')).not.toBeInTheDocument();
    press('Enter');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS + CARD_DAMAGE_MS + CARD_DRAW_MS);
    expect(screen.getByText('あいては ちからを ためている…！')).toBeInTheDocument();
    expect(screen.getByText('⚡ ためている')).toBeInTheDocument();
  });

  it('ためたターン:相手が勝つと ダメージ2倍、こちらが勝つと「ふせいだ!」', () => {
    const charging = (state: BattleState): BattleState => ({ ...state, finisherUsed: true, cpu: { ...state.cpu, charging: true, attack: 10 } });
    // 負ける:チョキ★1 と グー★1 → (10 + 10) × 2
    const lose = renderBoss(withHands([janken('a', 'scissors', 1)], [janken('x', 'rock', 1)], charging));
    expect(screen.getByText('ためわざ が くる！ まけると ダメージ 2ばい！')).toBeInTheDocument();
    press('Enter');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS);
    expect(screen.getByText('ためわざ！ ダメージ 2ばい！')).toBeInTheDocument();
    expect(screen.getByLabelText('40ダメージ')).toBeInTheDocument();
    lose.unmount();

    // 勝つ:パー★1 と グー★1
    renderBoss(withHands([janken('a', 'paper', 1)], [janken('x', 'rock', 1)], charging));
    press('Enter');
    press('Enter');
    wait(CARD_JANKEN_BEAT_MS * 3 + CARD_REVEAL_MS);
    expect(screen.getByText('ふせいだ！')).toBeInTheDocument();
    expect(screen.queryByText('⚡ ためている')).not.toBeInTheDocument();
  });
});
