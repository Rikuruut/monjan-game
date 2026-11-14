import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, JankenCard } from '../game/cards';
import { DEFAULT_BATTLE_CONFIG } from '../game/config';
import type { BattleState } from '../game/engine';
import { seededRandom } from '../game/simulate';
import {
  CARD_ATTACK_MS,
  CARD_CLASH_IN_MS,
  CARD_CPU_PLACE_MS,
  CARD_CPU_THINK_MS,
  CARD_CPU_TURN_MS,
  CARD_DAMAGE_MS,
  CARD_DRAW_MS,
  CARD_FINISHER_ATTACK_MS,
  CARD_HEAL_MS,
  CARD_JANKEN_BEAT_MS,
  CARD_PLAYER_TURN_BANNER_MS,
  CARD_REVEAL_MS,
  CARD_SKILL_MS,
  MASH_DUEL_MS,
  MASH_RESULT_MS,
  SPECIAL_DISPLAY_MS,
} from '../timings';
import type { Hand, Monster } from '../types';
import { CardBattle, trialConfig } from './CardBattle';
import { sendCardDev } from './cardDev';

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

// 見せ場:すべりこみ → じゃん・けん・ぽん(めくる)まで / めくった結果のあと(攻撃のはじめ)まで / 攻撃 → 命中 まで
const TO_PON = CARD_CLASH_IN_MS + CARD_JANKEN_BEAT_MS * 2;
const TO_FLIP = CARD_CLASH_IN_MS + CARD_JANKEN_BEAT_MS * 3;
const TO_REVEAL = TO_FLIP + CARD_REVEAL_MS;
const TO_IMPACT = TO_REVEAL + CARD_ATTACK_MS;
// 1ターンが かならず終わる長さ(じゃんけん → めくる → 連打 → 攻撃 → 命中 → ドロー → 相手のスキル2つ → 相手のターン)
const TURN_MS = TO_IMPACT + MASH_DUEL_MS + MASH_RESULT_MS + CARD_DAMAGE_MS + CARD_DRAW_MS + CARD_SKILL_MS * 2 + CARD_CPU_TURN_MS;

const press = (key: 'ArrowLeft' | 'ArrowRight' | 'Enter') => {
  fireEvent.keyDown(window, { key });
  fireEvent.keyUp(window, { key });
};
const wait = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
const handItems = () => screen.getAllByTestId(/^hand-item-/);
const cursorIndex = () => handItems().findIndex((item) => item.getAttribute('aria-current') === 'true');
/** 説明パネルの文字(出ていなければ 空) */
const info = () => screen.queryByTestId('hand-info')?.textContent ?? '';
/** 手札の上の 案内の1行(出ていなければ 空) */
const guide = () => screen.queryByTestId('hand-guide')?.textContent ?? '';
const GUIDE_PICK = '◀ ▶ で えらんで ● で けってい';
const hpOf = (side: 0 | 1) => screen.getAllByLabelText(/^HP \d+ \/ \d+$/)[side].getAttribute('aria-label');

/** 手札と相手の手札を決めて始める(相手は cpuHand の先頭を ふせる) */
function withHands(hand: Card[], cpuHand: JankenCard[], extra: (state: BattleState) => BattleState = (state) => state) {
  return (state: BattleState): BattleState => extra({
    ...state,
    player: { ...state.player, hand },
    cpu: { ...state.cpu, hand: cpuHand, placedId: cpuHand[0].id },
  });
}

function renderBattle(options: { seed?: number; setup?: (state: BattleState) => BattleState; keepCpuTurn?: boolean } = {}) {
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
  // はじめは 相手のターン(カードを えらんで置く)。待って 自分のターンから
  if (!options.keepCpuTurn) wait(CARD_CPU_TURN_MS);
  return { playSound, ...view };
}

/** ボス(round 3)と戦う */
function renderBoss(setup: (state: BattleState) => BattleState) {
  const view = render(
    <CardBattle
      player={monster('p', 'ゴリザミ', 2000)}
      cpu={monster('c', 'ドライオン', 1000)}
      config={trialConfig(DEFAULT_BATTLE_CONFIG, 3)}
      playSound={vi.fn()}
      random={seededRandom(1)}
      setup={setup}
    />,
  );
  wait(CARD_CPU_TURN_MS);
  return view;
}

describe('カードバトル:手札と じゃんけん', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const basic = withHands(
    [janken('a', 'rock', 1), janken('b', 'scissors', 2), janken('c', 'paper', 1), janken('d', 'paper', 3), janken('e', 'rock', 2)],
    [janken('x', 'rock', 1), janken('y', 'paper', 2), janken('z', 'scissors', 1)],
  );

  it('はじまり:相手の手札は マークだけ3枚と ふせたカード、HP は数字、カーソルのカードの説明が出る', () => {
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
    expect(cursorIndex()).toBe(0);
    expect(info()).toContain('グー ★1');
    expect(info()).toContain('かつと 20 ダメージ！');
    expect(guide()).toBe(GUIDE_PICK);
  });

  it('←→でカーソルが動き、端で止まる。説明も カーソルのカードに変わる', () => {
    renderBattle({ setup: basic });
    press('ArrowLeft');
    expect(cursorIndex()).toBe(0);
    press('ArrowRight');
    press('ArrowRight');
    expect(cursorIndex()).toBe(2);
    expect(info()).toContain('パー ★1');
    for (let index = 0; index < 6; index += 1) press('ArrowRight');
    expect(cursorIndex()).toBe(4);
  });

  it('決定は2回押し:1回目で浮いて「もういちど」、←→で取り消し(カーソルは動かない)', () => {
    renderBattle({ setup: basic });
    press('ArrowRight');
    press('Enter');
    expect(info()).toContain('チョキ ★2');
    expect(info()).toContain('かつと 35 ダメージ！');
    expect(guide()).toBe('● を もういちど おすと だすよ！');
    expect(handItems()[1].className).toContain('cb-hand__slot--armed');
    press('ArrowRight');
    expect(guide()).toBe(GUIDE_PICK);
    expect(cursorIndex()).toBe(1);
    expect(handItems()).toHaveLength(5);
  });

  it('2回目の決定で出す:じゃん・けん・ぽん → めくる → 攻撃 → 命中 → 1枚引いて 次のターン', () => {
    // パー★1 で 相手のグー★1 に勝つ
    const { playSound } = renderBattle({ setup: basic });
    press('ArrowRight');
    press('ArrowRight');
    press('Enter');
    press('Enter');
    // 見せ場:大きなカード2枚(どちらも裏向き)が すべりこむ
    expect(document.querySelectorAll('.cb-clash .cb-card--back')).toHaveLength(2);
    expect(handItems()).toHaveLength(4);
    // じゃんけんの あいだは 手札を動かせない・説明パネルは出ない
    expect(info()).toBe('');
    press('ArrowRight');
    press('Enter');
    wait(CARD_CLASH_IN_MS);
    expect(screen.getByText('じゃん')).toBeInTheDocument();
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.getByText('けん')).toBeInTheDocument();
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.getByText('ぽん！')).toBeInTheDocument();
    wait(CARD_JANKEN_BEAT_MS);
    // めくれる:勝ったほうが大きく(タイプの色で光る)
    expect(screen.queryByLabelText('ふせたカード')).not.toBeInTheDocument();
    expect(screen.getByText('あなたの かち！')).toBeInTheDocument();
    expect(document.querySelector('.cb-clash__slot--player.cb-clash__slot--won.cb-type-wind')).not.toBeNull();
    expect(document.querySelector('.cb-clash__slot--cpu.cb-clash__slot--lost')).not.toBeNull();

    wait(CARD_REVEAL_MS);
    // 攻撃:見せ場は消えて、勝った側が前へ出て、カードのまわりが タイプの色で光り、飛び道具が飛ぶ
    expect(document.querySelector('.cb-clash')).toBeNull();
    const [playerPanel] = document.querySelectorAll('.monster-panel');
    expect(playerPanel.className).toContain('monster-panel--attacking');
    expect(playerPanel.className).toContain('cb-fighter--striking');
    expect(document.querySelector('.projectile--from-player.projectile--wind')).not.toBeNull();
    expect(playSound).toHaveBeenCalledWith('attack', { attribute: '風' });
    expect(hpOf(1)).toMatch(/^HP (\d+) \/ \1$/);

    wait(CARD_ATTACK_MS);
    // 命中:当たった側が揺れて、光の輪・ダメージの数字・画面の揺れ。HP が減る
    expect(screen.getByLabelText('20ダメージ')).toBeInTheDocument();
    expect(document.querySelectorAll('.monster-panel')[1].className).toContain('monster-panel--hit');
    expect(document.querySelector('.impact-effect--cpu')).not.toBeNull();
    expect(document.querySelector('.hit-flash')).not.toBeNull();
    expect(document.querySelector('.battlefield--shake-1')).not.toBeNull();
    expect(playSound).toHaveBeenCalledWith('impact');

    wait(CARD_DAMAGE_MS);
    expect(info()).toContain('を ひいた！');
    wait(CARD_DRAW_MS);
    expect(handItems().filter((item) => item.querySelector('.cb-card'))).toHaveLength(5);
    // 次のターン:相手のターン → 自分のターン
    expect(screen.getByText('カードを えらんでいる…')).toBeInTheDocument();
    wait(CARD_CPU_TURN_MS);
    expect(screen.getByText('あなたの ターン！')).toBeInTheDocument();
    expect(guide()).toBe(GUIDE_PICK);
  });

  it('★が多いと 揺れも大きい(★3 は shake-3)', () => {
    renderBattle({ setup: withHands([janken('d', 'paper', 3)], [janken('x', 'rock', 1)]) });
    press('Enter');
    press('Enter');
    wait(TO_IMPACT);
    expect(document.querySelector('.battlefield--shake-3')).not.toBeNull();
  });

  it('連打勝負:同じ手・同じ★なら どのボタンでも1回に数える', () => {
    // グー★1 どうし
    renderBattle({ setup: basic });
    press('Enter');
    press('Enter');
    wait(TO_REVEAL);
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
      wait(TURN_MS + CARD_FINISHER_ATTACK_MS + SPECIAL_DISPLAY_MS);
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
    expect(info()).toContain('おなじ カード 2まいで');
    expect(handItems().filter((item) => item.className.includes('cb-hand__slot--pair'))).toHaveLength(2);
    press('Enter');
    expect(guide()).toBe('● を もういちど おすと がったい するよ！');
    press('Enter');
    expect(screen.getByText('がったい！')).toBeInTheDocument();
    expect(screen.getByText('グー ★3 に なった')).toBeInTheDocument();
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
    expect(info()).toContain('どれを がったいする？');
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
    expect(screen.getByText('パー ★3 に なった')).toBeInTheDocument();
  });
});

describe('カードバトル:スキル', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('回復:説明に もどる量が出て、決定2回で HP が満タンに。そのターンは もうスキルを使えない', () => {
    const hand = [heal, seal, janken('a', 'rock', 1)];
    const cpu = [janken('x', 'rock', 1), janken('y', 'paper', 2)];
    const { playSound } = renderBattle({ setup: withHands(hand, cpu, (state) => ({ ...state, player: { ...state.player, hp: 40 } })) });
    expect(hpOf(0)).toBe('HP 40 / 100');
    press('ArrowLeft');
    press('ArrowLeft');
    expect(info()).toContain('HPが 60 もどる');
    press('Enter');
    press('Enter');
    expect(screen.getByText('かいふく！')).toBeInTheDocument();
    expect(screen.getByText('HPが 60 もどった')).toBeInTheDocument();
    expect(hpOf(0)).toBe('HP 100 / 100');
    // 回復の演出:「+60」・足もとの光の輪と ✚・HP の段が光る・専用の音
    expect(screen.getByLabelText('60かいふく')).toBeInTheDocument();
    const [playerPanel] = document.querySelectorAll('.monster-panel');
    expect(playerPanel.querySelectorAll('.cb-heal-fx__plus').length).toBeGreaterThan(3);
    expect(playerPanel.querySelector('.cb-heal-fx__ring')).not.toBeNull();
    expect(playerPanel.querySelector('.cb-hp--healing')).not.toBeNull();
    expect(playSound).toHaveBeenCalledWith('heal');
    // 回復は 少し長めに見せる
    wait(CARD_SKILL_MS);
    expect(screen.getByText('HPが 60 もどった')).toBeInTheDocument();
    wait(CARD_HEAL_MS - CARD_SKILL_MS);
    expect(screen.queryByLabelText('60かいふく')).not.toBeInTheDocument();

    expect(screen.getByLabelText('スキルは しようずみ')).toBeInTheDocument();
    // 封じ手は 暗くなって 浮かない(理由が説明パネルに出る)
    press('ArrowLeft');
    expect(info()).toContain('ふうじて');
    expect(info()).toContain('スキルは 1ターンに 1まいまで！');
    press('Enter');
    expect(handItems()[cursorIndex()].className).not.toContain('cb-hand__slot--armed');
    expect(handItems()[cursorIndex()].className).toContain('cb-hand__slot--blocked');
  });

  it('封じ手:相手の手を1つ封じ、ふせたカードは 封じた手以外で 出し直される', () => {
    for (let seed = 1; seed <= 20; seed += 1) {
      const cpu = [janken('x', 'rock', 1), janken('y', 'paper', 2), janken('z', 'rock', 3)];
      const view = renderBattle({ seed, setup: withHands([seal, janken('a', 'scissors', 1)], cpu) });
      press('ArrowLeft');
      expect(info()).toContain('あいての 手を 1つ ふうじる');
      press('Enter');
      press('Enter');
      const message = screen.getByText(/を ふうじた！$/).textContent ?? '';
      const sealed = message.startsWith('グー') ? 'rock' : 'paper';
      // 封じた手のカードに 鎖
      expect(screen.getAllByLabelText('ふうじられている')).toHaveLength(sealed === 'rock' ? 2 : 1);

      // 出したあと:相手が出したのは 封じた手ではない
      wait(CARD_SKILL_MS);
      press('Enter');
      press('Enter');
      wait(TO_FLIP);
      const fieldCard = document.querySelectorAll('.cb-field .cb-card')[1];
      expect(fieldCard?.getAttribute('aria-label')).not.toMatch(sealed === 'rock' ? /^グー/ : /^パー/);
      view.unmount();
    }
    // 20回 画面を作り直すので 時間の上限をのばす
  }, 20000);

  it('相手の手札が全部同じ手のとき、封じ手は暗くなって使えない', () => {
    renderBattle({ setup: withHands([seal, janken('a', 'paper', 1)], [janken('x', 'rock', 1), janken('y', 'rock', 2)]) });
    press('ArrowLeft');
    expect(info()).toContain('あいての 手が ぜんぶ おなじなので つかえない');
    press('Enter');
    press('Enter');
    expect(screen.queryByText(/ふうじた！/)).not.toBeInTheDocument();
  });
});

describe('カードバトル:必殺技', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const finisher: Card = { id: 'fin', kind: 'finisher' };

  it('必殺技を出すと、かけ声なしで すぐカットイン → 特大の攻撃 → 相手を かならず倒す', () => {
    const cpu = [janken('x', 'rock', 3), janken('y', 'paper', 2)];
    renderBattle({ setup: withHands([janken('a', 'scissors', 1), finisher], cpu) });
    press('ArrowRight');
    expect(info()).toContain('どんな 手にも かって');
    press('Enter');
    press('Enter');
    expect(screen.queryByText('じゃん')).not.toBeInTheDocument();
    expect(screen.getByText('ひっさつわざ！')).toBeInTheDocument();
    wait(SPECIAL_DISPLAY_MS);
    expect(document.querySelector('.cb-screen')?.className).toContain('battle-screen--special');
    expect(document.querySelector('.projectile')).not.toBeNull();
    wait(CARD_FINISHER_ATTACK_MS);
    expect(hpOf(1)).toMatch(/^HP 0 \//);
    expect(document.querySelector('.battlefield--shake-special')).not.toBeNull();
    expect(document.querySelector('.special-impact-flash')).not.toBeNull();
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
    wait(TO_IMPACT + CARD_DAMAGE_MS);
    expect(info()).toContain('ひっさつわざ が きた！');
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
    wait(TO_IMPACT + CARD_DAMAGE_MS + CARD_DRAW_MS);
    expect(screen.getByText('あいての かいふく！')).toBeInTheDocument();
    expect(screen.getByText('HPが 30 もどった')).toBeInTheDocument();
    expect(hpOf(1)).toBe('HP 50 / 60');
    // 相手のスキルは 相手のターンのうち
    expect(screen.getByText('あいての ターン')).toBeInTheDocument();
    // 相手の回復も 同じ演出(相手の側)
    expect(screen.getByLabelText('30かいふく')).toBeInTheDocument();
    expect(document.querySelectorAll('.monster-panel')[1].querySelector('.cb-heal-fx')).not.toBeNull();
    wait(CARD_HEAL_MS + CARD_CPU_TURN_MS);
    expect(guide()).toBe(GUIDE_PICK);
  });

  it('ため技:3ターン目に予告して オーラが出る', () => {
    const cpu = [janken('x', 'rock', 1), janken('y', 'rock', 2), janken('z', 'scissors', 1)];
    renderBoss(withHands([janken('a', 'paper', 1), janken('b', 'rock', 1)], cpu, (state) => ({ ...state, turn: 2, finisherUsed: true })));
    expect(screen.queryByText('⚡ ためている')).not.toBeInTheDocument();
    press('Enter');
    press('Enter');
    wait(TO_IMPACT + CARD_DAMAGE_MS + CARD_DRAW_MS);
    expect(screen.getByText('ちからを ためている…！')).toBeInTheDocument();
    expect(screen.getByText('⚡ ためている')).toBeInTheDocument();
  });

  it('ためたターン:相手が勝つと ダメージ2倍、こちらが勝つと「ふせいだ!」', () => {
    const charging = (state: BattleState): BattleState => ({ ...state, finisherUsed: true, cpu: { ...state.cpu, charging: true, attack: 10 } });
    // 負ける:チョキ★1 と グー★1 → (10 + 10) × 2
    const lose = renderBoss(withHands([janken('a', 'scissors', 1)], [janken('x', 'rock', 1)], charging));
    expect(screen.getByText('ためわざ が くる！')).toBeInTheDocument();
    press('Enter');
    press('Enter');
    wait(TO_IMPACT);
    expect(screen.getByText('ダメージ 2ばい！')).toBeInTheDocument();
    expect(screen.getByLabelText('40ダメージ')).toBeInTheDocument();
    // ため技の2倍は いちばん強い揺れ
    expect(document.querySelector('.battlefield--shake-3')).not.toBeNull();
    lose.unmount();

    // 勝つ:パー★1 と グー★1
    renderBoss(withHands([janken('a', 'paper', 1)], [janken('x', 'rock', 1)], charging));
    press('Enter');
    press('Enter');
    wait(TO_IMPACT);
    expect(screen.getByText('ふせいだ！')).toBeInTheDocument();
    expect(screen.queryByText('⚡ ためている')).not.toBeInTheDocument();
  });
});

describe('カードバトル:相手のターンと じゃんけんの見せ場', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const cpu = [janken('x', 'rock', 1), janken('y', 'paper', 2), janken('z', 'scissors', 1)];

  it('はじめは 相手のターン:考えているあいだは ボタンを受けず、終わると 裏向きのカードが置かれて 自分のターン', () => {
    const { playSound } = renderBattle({ keepCpuTurn: true, setup: withHands([janken('a', 'rock', 1), janken('b', 'paper', 1)], cpu) });
    expect(screen.getAllByText('あいての ターン').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('カードを えらんでいる…')).toBeInTheDocument();
    expect(document.querySelector('.cb-screen--cpu-turn')).not.toBeNull();
    // 置き場は空・説明パネルは出ない・ボタンは受けない
    expect(screen.queryByLabelText('ふせたカード')).not.toBeInTheDocument();
    expect(info()).toBe('');
    press('Enter');
    press('Enter');
    expect(document.querySelector('.cb-clash')).toBeNull();

    // 考える → ふせる:裏向きのカードが 飛んできて置かれる
    wait(CARD_CPU_THINK_MS);
    expect(screen.getByText('カードを ふせた！')).toBeInTheDocument();
    expect(screen.getByLabelText('ふせたカード').className).toContain('cb-field__fly');
    expect(document.querySelector('.cb-screen--cpu-place')).not.toBeNull();
    expect(info()).toBe('');

    wait(CARD_CPU_PLACE_MS);
    expect(screen.getByLabelText('ふせたカード').className).not.toContain('cb-field__fly');
    expect(screen.getByText('あなたの ターン')).toBeInTheDocument();
    expect(screen.getByText('あなたの ターン！')).toBeInTheDocument();
    expect(guide()).toBe(GUIDE_PICK);
    expect(playSound).toHaveBeenCalledWith('select');
    wait(CARD_PLAYER_TURN_BANNER_MS);
    expect(screen.queryByText('あなたの ターン！')).not.toBeInTheDocument();
  });

  it('あいこで★くらべ:「ぽん!」のあと ★の多いほうが勝ち、くわしいことが下に出る', () => {
    // パー★2 と 相手のパー★1(先頭をふせる)
    renderBattle({ setup: withHands([janken('a', 'paper', 2)], [janken('x', 'paper', 1), janken('y', 'rock', 1)]) });
    press('Enter');
    press('Enter');
    wait(TO_PON);
    expect(screen.getByText('ぽん！')).toBeInTheDocument();
    expect(document.querySelectorAll('.cb-clash .cb-card--back')).toHaveLength(2);
    wait(CARD_JANKEN_BEAT_MS);
    expect(screen.getByText('あなたの かち！')).toBeInTheDocument();
    expect(screen.getByText('あいこ！ ★が おおい ほうの かち')).toBeInTheDocument();
    expect(document.querySelector('.cb-clash__slot--player.cb-clash__slot--won')).not.toBeNull();
  });

  it('★も同じ:2枚とも光って「れんだで しょうぶ」→ 連打勝負', () => {
    renderBattle({ setup: withHands([janken('a', 'paper', 1)], [janken('x', 'paper', 1), janken('y', 'rock', 1)]) });
    press('Enter');
    press('Enter');
    wait(TO_FLIP);
    expect(screen.getByText('★も おなじ！ れんだで しょうぶ！')).toBeInTheDocument();
    expect(document.querySelectorAll('.cb-clash__slot--even')).toHaveLength(2);
    wait(CARD_REVEAL_MS);
    expect(screen.getByText('れんだ しょうぶ！')).toBeInTheDocument();
    expect(document.querySelector('.cb-clash')).toBeNull();
  });
});

describe('カードバトル:HP のピンチ・こうげきの表示・開発者メニュー', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const cpu = [janken('x', 'rock', 1), janken('y', 'paper', 2)];

  it('こうげきは 自分も相手も カードの下の2段目(HP の下)', () => {
    renderBattle({ setup: withHands([janken('a', 'rock', 1)], cpu) });
    const powers = document.querySelectorAll('.cb-stats .cb-power');
    expect(powers).toHaveLength(2);
    expect(screen.getByLabelText('こうげき力 10').textContent).toBe('こうげき10');
    expect(document.querySelector('.monster-tag .cb-power')).toBeNull();
  });

  it('HP が3割以下で 赤く点滅する(字は出さない)。0 なら点滅しない', () => {
    renderBattle({ setup: withHands([janken('a', 'rock', 1)], cpu, (state) => ({ ...state, player: { ...state.player, hp: 30 } })) });
    expect(screen.getByLabelText('HP 30 / 100').className).toContain('cb-hp--low');
    expect(screen.queryByText(/ピンチ/)).not.toBeInTheDocument();
    // 相手(HP 満タン)は 点滅しない
    expect(document.querySelectorAll('.cb-hp--low')).toHaveLength(1);
  });

  it('開発者メニュー:必殺技を手札に足して、そのまま出せる', () => {
    renderBattle({ setup: withHands([janken('a', 'rock', 1)], cpu) });
    act(() => sendCardDev('add-finisher'));
    // 足したカードに カーソル
    expect(handItems()).toHaveLength(2);
    expect(info()).toContain('どんな 手にも かって');
    press('Enter');
    press('Enter');
    expect(screen.getByText('ひっさつわざ！')).toBeInTheDocument();
    wait(SPECIAL_DISPLAY_MS + CARD_FINISHER_ATTACK_MS);
    expect(hpOf(1)).toMatch(/^HP 0 \//);
  });

  it('開発者メニュー:HP・ため技を変えられる。自分のターン以外では効かない', () => {
    renderBattle({ keepCpuTurn: true, setup: withHands([janken('a', 'rock', 1)], cpu) });
    act(() => sendCardDev('player-pinch'));
    expect(hpOf(0)).toBe('HP 100 / 100');
    wait(CARD_CPU_TURN_MS);
    act(() => sendCardDev('player-pinch'));
    expect(hpOf(0)).toBe('HP 30 / 100');
    act(() => sendCardDev('cpu-charge'));
    expect(screen.getByText('⚡ ためている')).toBeInTheDocument();
    act(() => sendCardDev('add-heal'));
    act(() => sendCardDev('add-seal'));
    expect(handItems()).toHaveLength(3);
  });
});

describe('カードバトル:場の色分け・案内の1行', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('場は 自分(緑)と 相手(ピンク)に わかれ、それぞれ札がある', () => {
    renderBattle({ setup: withHands([janken('a', 'rock', 1)], [janken('x', 'rock', 1), janken('y', 'paper', 1)]) });
    expect(document.querySelector('.cb-field__side--player .cb-field__who')?.textContent).toBe('あなた');
    expect(document.querySelector('.cb-field__side--cpu .cb-field__who')?.textContent).toBe('あいて');
    expect(document.querySelector('.cb-field__slot--cpu')?.querySelector('[aria-label="ふせたカード"]')).not.toBeNull();
  });

  it('案内の1行:相手のターン → 自分のターン → じゃんけん、使えないスキル', () => {
    renderBattle({ keepCpuTurn: true, setup: withHands([seal, janken('a', 'rock', 1)], [janken('x', 'rock', 1), janken('y', 'rock', 2)]) });
    expect(guide()).toBe('あいての ばん… まってね');
    wait(CARD_CPU_TURN_MS);
    expect(guide()).toBe(GUIDE_PICK);
    press('ArrowLeft');
    expect(guide()).toBe('この カードは いま つかえないよ');
    press('ArrowRight');
    press('Enter');
    press('Enter');
    expect(guide()).toBe('しょうぶ！');
  });
});
