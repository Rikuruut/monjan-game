import { useEffect, useMemo, useState } from 'react';
import type { GameSound, GameSoundOptions } from '../audio/gameAudio';
import { getAttributeTheme } from '../attributes';
import { SpecialCutin } from '../battle/BattleScreen';
import { MashDuel } from '../battle/MashDuel';
import { HAND_META } from '../components/HandIcon';
import { Backdrop, Logo } from '../components/Scenery';
import { cx } from '../cx';
import type { JankenCard } from '../game/cards';
import { attackFromLegacy, loadBattleConfig, type BattleConfig } from '../game/config';
import { cardDamage, healAmount, type BattleState } from '../game/engine';
import type { RandomSource } from '../game/logic';
import { assetUrl, usePadButtons } from '../integration';
import type { Monster } from '../types';
import { cardLabel, CardView } from './CardView';
import { FighterPanel } from './FighterPanel';
import {
  skillBlockedReason,
  useCardBattle,
  type CardBattleView,
  type ChargeNote,
  type Clash,
  type HandItem,
  type Notice,
} from './useCardBattle';

type PlaySound = (sound: GameSound, options?: GameSoundOptions) => void;
type Battle = ReturnType<typeof useCardBattle>;

// ---- 文言 ----

const BEAT_COPY = ['', 'じゃん', 'けん', 'ぽん！'];

const CHARGE_COPY: Record<ChargeNote, string> = {
  charged: 'ためわざ！ ダメージ 2ばい！',
  blocked: 'ふせいだ！',
};

function noticeCopy(notice: Notice): string {
  if (notice.type === 'merge') return `がったい！ ${cardLabel(notice.card)} に なった！`;
  if (notice.type === 'heal') return `HPが ${notice.amount} もどった！`;
  if (notice.type === 'cpu-heal') return `あいての かいふく！ HPが ${notice.amount} もどった`;
  if (notice.type === 'cpu-charge') return 'あいては ちからを ためている…！';
  return `${HAND_META[notice.hand].label}を ふうじた！ あいては カードを だしなおしたよ`;
}

// 場の真ん中に出す ひとこと(じゃんけんの かけ声・めくった結果・合成やスキルの結果)
function fieldCopy(battle: Battle): string {
  const { view, beat, clash, notice, chargeNote, state } = battle;
  if (view === 'notice' && notice) return noticeCopy(notice);
  // ため技のターン:手札をえらぶあいだ 注意を出し、結果も出す
  if (view === 'player' && state.cpu.charging) return 'ためわざ が くる！ まけると ダメージ 2ばい！';
  if (view === 'damage' && chargeNote) return CHARGE_COPY[chargeNote];
  if (view === 'janken') return BEAT_COPY[beat] ?? '';
  if (!clash || view === 'player' || view === 'draw' || view === 'round-end') return '';
  if (clash.winner === 'rendan') return 'あいこ！ ★も おなじ！';
  const who = clash.winner === 'player' ? 'あなたの かち！' : 'あいての かち…';
  return clash.by === 'star' ? `あいこ！ ★が おおい ${clash.winner === 'player' ? 'あなた' : 'あいて'}の かち！` : who;
}

// 手札の上に出す案内(えらんでいるものの説明・決定の1回目で浮いたときの説明)
function promptCopy(battle: Battle): string {
  const { state, view, items, cursor, armed, mergePick } = battle;
  if (view === 'draw') return battle.drawn?.kind === 'finisher' ? 'ひっさつわざ カードが きた！' : 'カードを 1まい ひいたよ！';
  if (view !== 'player') return '';
  if (mergePick !== null) return 'どれを がったいする？';
  const item = items[cursor];
  if (!item) return 'だす カードを えらぼう！';
  if (item.kind === 'merge') {
    return armed
      ? 'がったい:おなじ 2まいで ★が 1つ ふえる！ もういちど けっていで がったい'
      : 'おなじ カードが 2まい！ がったい できるよ';
  }
  const { card } = item;
  const blocked = skillBlockedReason(state, card);
  if (blocked) return `${cardLabel(card)}:${blocked}`;
  if (!armed) return 'だす カードを えらぼう！';
  if (card.kind === 'janken') {
    return `${cardLabel(card)}:かつと ${cardDamage(state.config, card, state.player.attack)} ダメージ！ もういちど けっていで だす`;
  }
  if (card.kind === 'skill' && card.skill === 'heal') {
    return `かいふく:HPが ${healAmount(state)} もどるよ！ もういちど けっていで つかう`;
  }
  if (card.kind === 'skill') return 'ふうじて:あいての 手を 1つ ふうじる！ もういちど けっていで つかう';
  return 'ひっさつわざ:どんな 手にも かって かならず たおす！ もういちど けっていで だす';
}

// ---- 手札 ----

// 合成のペアに入っているカード(カーソルが「がったい!」の枠にあるときは全部、ペアをえらんでいるときは えらんだペアだけ)
function pairCardIds(battle: Battle): Set<string> {
  const { items, cursor, pairs, mergePick, view } = battle;
  if (view !== 'player') return new Set();
  if (mergePick !== null) return new Set(pairs[mergePick]?.map((card) => card.id) ?? []);
  if (items[cursor]?.kind !== 'merge') return new Set();
  return new Set(pairs.flat().map((card) => card.id));
}

function HandRow({ battle }: { battle: Battle }) {
  const { state, view, items, cursor, armed, mergePick, pairs, clash, notice } = battle;
  const choosing = view === 'player';
  // 場に出したカードは、手札からは消して見せる(状態は ダメージのところで入れかわる)。じゃんけんのあいだは「がったい!」の枠も出さない
  const shown = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => (item.kind === 'merge' ? choosing || view === 'notice' : item.card.id !== clash?.playerCard.id));
  const highlighted = pairCardIds(battle);
  const skillUsed = state.player.skillsUsed >= state.config.skillPerTurn;
  const newCardId = notice?.type === 'merge' ? notice.card.id : null;

  const slotFor = ({ item, index }: { item: HandItem; index: number }) => {
    const selected = choosing && mergePick === null && index === cursor;
    const className = cx(
      'cb-hand__slot',
      selected && 'cb-hand__slot--selected',
      selected && armed && 'cb-hand__slot--armed',
    );
    if (item.kind === 'merge') {
      return (
        <div key="merge" className={cx(className, 'cb-hand__slot--merge')} data-testid={`hand-item-${index}`} aria-current={selected ? 'true' : undefined}>
          <div className="cb-merge" role="img" aria-label="がったい">
            <span className="cb-merge__icon" aria-hidden="true">✨</span>
            <span className="cb-merge__label">がったい！</span>
            <span className="cb-merge__count">{pairs.length}くみ</span>
          </div>
        </div>
      );
    }
    const { card } = item;
    return (
      <div
        key={card.id}
        className={cx(
          className,
          highlighted.has(card.id) && 'cb-hand__slot--pair',
          card.id === newCardId && 'cb-hand__slot--new',
          skillBlockedReason(state, card) && 'cb-hand__slot--blocked',
        )}
        data-testid={`hand-item-${index}`}
        aria-current={selected ? 'true' : undefined}
      >
        <CardView card={card} />
      </div>
    );
  };

  return (
    <section className={cx('cb-hand', !choosing && 'cb-hand--locked')} aria-label="じぶんの てふだ">
      <p className="cb-hand__prompt" role="status" aria-live="polite">{promptCopy(battle)}</p>
      {mergePick !== null && (
        <div className="cb-merge-pick" role="listbox" aria-label="がったいする ペア">
          {pairs.map(([card], index) => (
            <span key={card.id} role="option" aria-selected={index === mergePick} className={cx('cb-merge-pick__option', index === mergePick && 'is-current')}>
              {cardLabel(card)} × 2
            </span>
          ))}
          <span role="option" aria-selected={mergePick === pairs.length} className={cx('cb-merge-pick__option', 'cb-merge-pick__option--cancel', mergePick === pairs.length && 'is-current')}>
            やめる
          </span>
        </div>
      )}
      <div className="cb-hand__cards">
        {/* スキルを使ったターンは、置き場所が「しようずみ」になる */}
        {skillUsed && (
          <div className="cb-hand__slot cb-hand__slot--used" aria-label="スキルは しようずみ">
            <span className="cb-used">スキル<br />しようずみ</span>
          </div>
        )}
        {shown.map(slotFor)}
      </div>
      <p className="cb-hand__keys" aria-hidden="true">
        <i>◀</i><i>▶</i> えらぶ <i className="cb-hand__key-main">●</i> {armed && choosing ? 'つかう' : 'けってい'}
      </p>
    </section>
  );
}

// ---- 相手の手札 ----

function CpuHand({ state, clash, revealed }: { state: BattleState; clash: Clash | null; revealed: boolean }) {
  const sealed = state.cpu.sealedHand;
  return (
    <div className="cb-cpu-hand" aria-label="あいての てふだ">
      <p className="cb-cpu-hand__title">あいての てふだ</p>
      <div className="cb-cpu-hand__cards">
        {state.cpu.hand.map((card: JankenCard) => (
          <div key={card.id} className={cx('cb-cpu-hand__slot', card.hand === sealed && 'cb-cpu-hand__slot--sealed')}>
            <CardView
              card={card}
              hideStar
              size="small"
              // めくったあとは、出したカードを うすくする(どれを出したかが わかる)
              className={cx(revealed && card.id === clash?.cpuCard.id && 'cb-card--used')}
            />
            {card.hand === sealed && <span className="cb-chain" aria-label="ふうじられている">⛓️</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * カードバトルの画面(戦闘システム設計書 12章)。
 * いまは段階2c:1ラウンドだけ。合成・回復・封じ手まで。パック選び・3ラウンド・必殺技・演出は このあと
 */
export function CardBattle({
  player,
  cpu,
  config,
  playSound,
  random,
  setup,
}: {
  player: Monster;
  cpu: Monster;
  config: BattleConfig;
  playSound: PlaySound;
  random?: RandomSource;
  /** パックを開けたあとの状態を差しかえる(テスト・開発者メニュー用) */
  setup?: (state: BattleState) => BattleState;
}) {
  const battle = useCardBattle({ config, playerAttack: attackFromLegacy(player.attack, config), random, playSound, setup });
  const { state, view, clash, damage, mash, cpuMash, rendanWinner, notice, chargeNote, finisherHit } = battle;
  usePadButtons(battle.press);

  // 相手のカードが おもてになっている(ぽん!のあと)
  const revealed = clash !== null && view !== 'janken';
  const decided = revealed && clash.winner !== 'rendan' ? clash.winner : view === 'rendan-result' || view === 'damage' ? rendanWinner : null;
  const copy = fieldCopy(battle);
  // ため技:予告してから その結果が出るまで、相手にオーラ(こちらが勝ったら すぐ消す)
  const charging = (state.cpu.chargeAnnounced || state.cpu.charging) && chargeNote !== 'blocked';

  return (
    <main className={cx(
        'screen',
        'battle-screen',
        'cb-screen',
        `cb-screen--${view}`,
        notice && `cb-screen--notice-${notice.type}`,
        // 必殺技の一撃:ダメージの数字を特大に(effects.css)
        finisherHit && 'battle-screen--special',
      )}>
      <Backdrop />
      <div className="battle-topbar">
        <div className="signboard">
          <Logo className="battle-logo" />
          <span className="signboard__title">カード バトル</span>
        </div>
        <span className="round-chip">ターン <b>{state.turn}</b></span>
      </div>

      <div className="battlefield">
        <FighterPanel
          monster={player}
          side="player"
          hp={state.player.hp}
          maxHp={state.player.maxHp}
          attack={state.player.attack}
          damage={damage}
          healed={notice?.type === 'heal'}
          defeated={state.player.hp <= 0}
        />
        <FighterPanel
          monster={cpu}
          side="cpu"
          hp={state.cpu.hp}
          maxHp={state.cpu.maxHp}
          attack={state.cpu.attack}
          damage={damage}
          healed={notice?.type === 'cpu-heal'}
          charging={charging}
          defeated={state.cpu.hp <= 0}
        />
      </div>

      {/* 真ん中:相手の手札(マークだけ)と、場(自分の出したカード・相手の ふせたカード) */}
      <section className="cb-center">
        <CpuHand state={state} clash={clash} revealed={revealed} />
        <div className={cx('cb-field', view === 'janken' && `cb-field--beat${battle.beat}`)}>
          <div className={cx('cb-field__slot', decided === 'player' && 'cb-field__slot--won', decided === 'cpu' && 'cb-field__slot--lost')}>
            {clash ? <CardView card={clash.playerCard} size="field" back={view === 'janken'} /> : <span className="cb-field__empty" aria-hidden="true" />}
          </div>
          <div
            className={cx(
              'cb-field__slot',
              decided === 'cpu' && 'cb-field__slot--won',
              decided === 'player' && 'cb-field__slot--lost',
              // 封じ手で出し直したとき、ふせたカードが はずんで置き直される(key を変えて やり直す)
              notice?.type === 'seal' && 'cb-field__slot--replaced',
            )}
            key={state.cpu.placedId ?? 'none'}
          >
            {clash
              ? <CardView card={clash.cpuCard} size="field" back={!revealed} />
              : state.cpu.placedId && <CardView card={{ kind: 'finisher' }} size="field" back />}
          </div>
        </div>
        {/* key で出しなおして、ひとことが1回ずつ はねて出る */}
        {copy && <p key={copy} className="cb-field__copy" role="status" aria-live="assertive">{copy}</p>}
      </section>

      <HandRow battle={battle} />

      {(view === 'rendan' || view === 'rendan-result') && (
        <MashDuel
          phase={view === 'rendan' ? 'mash-duel' : 'mash-result'}
          playerCount={mash}
          cpuCount={cpuMash}
          winner={rendanWinner}
          onMash={battle.pressMash}
        />
      )}

      {view === 'finisher' && <SpecialCutin monster={player} theme={getAttributeTheme(player.attribute)} />}

      {view === 'round-end' && (
        <div className={`cb-round-end cb-round-end--${state.roundResult}`} role="status" aria-live="assertive">
          <strong>{state.roundResult === 'win' ? 'かった！' : 'まけちゃった…'}</strong>
          <button type="button" className="cb-round-end__again" onClick={battle.restart}>● もういちど</button>
        </div>
      )}
    </main>
  );
}

// 3ラウンドの通し(段階2b)を作るまでのあいだだけ:1ラウンドだけにする。round は 1 = 練習・2 = 2体目・3 = ボス
// (通しを作ったら、この関数ごと外す)
export function trialConfig(config: BattleConfig, round = 2): BattleConfig {
  const index = Math.min(config.rounds.length, Math.max(1, Math.round(round))) - 1;
  return { ...config, rounds: [config.rounds[index]] };
}

/** 設定ファイル(public/data/battle-config.json)を読んでから、カードバトルを始める */
export function CardBattleEntry({
  player,
  cpu,
  practiceCpu,
  round = 2,
  playSound,
}: {
  player: Monster;
  cpu: Monster;
  /** 練習(round = 1)の相手 */
  practiceCpu: Monster;
  /** 戦う相手(`?round=`)。1 = 練習・2 = 2体目・3 = ボス */
  round?: number;
  playSound: PlaySound;
}) {
  const [config, setConfig] = useState<BattleConfig | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBattleConfig(assetUrl('/data/battle-config.json')).then((loaded) => {
      if (alive) setConfig(loaded);
    });
    return () => { alive = false; };
  }, []);
  const trial = useMemo(() => (config ? trialConfig(config, round) : null), [config, round]);
  if (!trial) return <main className="screen loading-screen"><div className="loader" /><p>カードを じゅんびしているよ…</p></main>;
  return <CardBattle player={player} cpu={round === 1 ? practiceCpu : cpu} config={trial} playSound={playSound} />;
}
