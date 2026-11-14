import { useEffect, useMemo, useState } from 'react';
import type { GameSound, GameSoundOptions } from '../audio/gameAudio';
import { MashDuel } from '../battle/MashDuel';
import { Backdrop, Logo } from '../components/Scenery';
import { cx } from '../cx';
import type { Card } from '../game/cards';
import { attackFromLegacy, loadBattleConfig, type BattleConfig } from '../game/config';
import { cardDamage } from '../game/engine';
import type { RandomSource } from '../game/logic';
import { assetUrl, usePadButtons } from '../integration';
import type { Monster } from '../types';
import { cardLabel, CardView } from './CardView';
import { FighterPanel } from './FighterPanel';
import { useCardBattle, type CardBattleView, type Clash } from './useCardBattle';

type PlaySound = (sound: GameSound, options?: GameSoundOptions) => void;

// ---- 文言 ----

const BEAT_COPY = ['', 'じゃん', 'けん', 'ぽん！'];

// 場の真ん中に出す ひとこと(じゃんけんの かけ声・めくった結果)
function fieldCopy(view: CardBattleView, beat: number, clash: Clash | null): string {
  if (view === 'janken') return BEAT_COPY[beat] ?? '';
  if (!clash || view === 'player' || view === 'draw' || view === 'round-end') return '';
  if (clash.winner === 'rendan') return 'あいこ！ ★も おなじ！';
  const who = clash.winner === 'player' ? 'あなたの かち！' : 'あいての かち…';
  return clash.by === 'star' ? `あいこ！ ★が おおい ${clash.winner === 'player' ? 'あなた' : 'あいて'}の かち！` : who;
}

// 手札の上に出す案内(えらぶ前・決定の1回目で浮いたカードの説明)
function promptCopy(view: CardBattleView, armedCard: Card | null, damage: number): string {
  if (view === 'draw') return 'カードを 1まい ひいたよ！';
  if (view !== 'player') return '';
  if (!armedCard) return 'だす カードを えらぼう！';
  if (armedCard.kind === 'janken') return `${cardLabel(armedCard)}:かつと ${damage} ダメージ！ もういちど けっていで だす`;
  return `${cardLabel(armedCard)}:もういちど けっていで つかう`;
}

/**
 * カードバトルの画面(戦闘システム設計書 12章)。
 * いまは段階2a:1ラウンドだけ・じゃんけんカードだけ。パック選び・合成・スキル・必殺技・演出は このあと
 */
export function CardBattle({
  player,
  cpu,
  config,
  playSound,
  random,
}: {
  player: Monster;
  cpu: Monster;
  config: BattleConfig;
  playSound: PlaySound;
  random?: RandomSource;
}) {
  const battle = useCardBattle({ config, playerAttack: attackFromLegacy(player.attack, config), random, playSound });
  const { state, view, cursor, armed, clash, beat, damage, mash, cpuMash, rendanWinner } = battle;
  usePadButtons(battle.press);

  // 場に出したカードは、手札からは消して見せる(状態は ダメージのところで入れかわる)
  const hand = state.player.hand.filter((card) => card.id !== clash?.playerCard.id);
  const choosing = view === 'player';
  const armedCard = choosing && armed ? state.player.hand[cursor] ?? null : null;
  const armedDamage = armedCard?.kind === 'janken' ? cardDamage(state.config, armedCard, state.player.attack) : 0;
  // 相手のカードが おもてになっている(ぽん!のあと)
  const revealed = clash !== null && view !== 'janken';
  const decided = revealed && clash.winner !== 'rendan' ? clash.winner : view === 'rendan-result' || view === 'damage' ? rendanWinner : null;
  const copy = fieldCopy(view, beat, clash);
  const prompt = promptCopy(view, armedCard, armedDamage);

  return (
    <main className={cx('screen', 'battle-screen', 'cb-screen', `cb-screen--${view}`)}>
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
          defeated={state.player.hp <= 0}
        />
        <FighterPanel
          monster={cpu}
          side="cpu"
          hp={state.cpu.hp}
          maxHp={state.cpu.maxHp}
          attack={state.cpu.attack}
          damage={damage}
          defeated={state.cpu.hp <= 0}
        />
      </div>

      {/* 真ん中:相手の手札(マークだけ)と、場(自分の出したカード・相手の ふせたカード) */}
      <section className="cb-center">
        <div className="cb-cpu-hand" aria-label="あいての てふだ">
          <p className="cb-cpu-hand__title">あいての てふだ</p>
          <div className="cb-cpu-hand__cards">
            {state.cpu.hand.map((card) => (
              <CardView
                key={card.id}
                card={card}
                hideStar
                size="small"
                // めくったあとは、出したカードを うすくする(どれを出したかが わかる)
                className={cx(revealed && card.id === clash?.cpuCard.id && 'cb-card--used')}
              />
            ))}
          </div>
        </div>
        <div className={cx('cb-field', view === 'janken' && `cb-field--beat${beat}`)}>
          <div className={cx('cb-field__slot', decided === 'player' && 'cb-field__slot--won', decided === 'cpu' && 'cb-field__slot--lost')}>
            {clash ? <CardView card={clash.playerCard} size="field" back={view === 'janken'} /> : <span className="cb-field__empty" aria-hidden="true" />}
          </div>
          <div className={cx('cb-field__slot', decided === 'cpu' && 'cb-field__slot--won', decided === 'player' && 'cb-field__slot--lost')}>
            {clash
              ? <CardView card={clash.cpuCard} size="field" back={!revealed} />
              : state.cpu.placedId && <CardView card={{ kind: 'finisher' }} size="field" back />}
          </div>
        </div>
        {/* key で出しなおして、ひとことが1回ずつ はねて出る */}
        {copy && <p key={copy} className="cb-field__copy" role="status" aria-live="assertive">{copy}</p>}
      </section>

      {/* 下:自分の手札 */}
      <section className={cx('cb-hand', !choosing && 'cb-hand--locked')} aria-label="じぶんの てふだ">
        <p className="cb-hand__prompt" role="status" aria-live="polite">{prompt}</p>
        <div className="cb-hand__cards">
          {hand.map((card, index) => {
            const selected = choosing && state.player.hand[cursor]?.id === card.id;
            return (
              <div
                key={card.id}
                className={cx('cb-hand__slot', selected && 'cb-hand__slot--selected', selected && armed && 'cb-hand__slot--armed')}
                data-testid={`hand-card-${index}`}
                aria-current={selected ? 'true' : undefined}
              >
                <CardView card={card} />
              </div>
            );
          })}
        </div>
        <p className="cb-hand__keys" aria-hidden="true">
          <i>◀</i><i>▶</i> えらぶ <i className="cb-hand__key-main">●</i> {armed && choosing ? 'だす' : 'けってい'}
        </p>
      </section>

      {(view === 'rendan' || view === 'rendan-result') && (
        <MashDuel
          phase={view === 'rendan' ? 'mash-duel' : 'mash-result'}
          playerCount={mash}
          cpuCount={cpuMash}
          winner={rendanWinner}
          onMash={battle.pressMash}
        />
      )}

      {view === 'round-end' && (
        <div className={`cb-round-end cb-round-end--${state.roundResult}`} role="status" aria-live="assertive">
          <strong>{state.roundResult === 'win' ? 'かった！' : 'まけちゃった…'}</strong>
          <button type="button" className="cb-round-end__again" onClick={battle.restart}>● もういちど</button>
        </div>
      )}
    </main>
  );
}

// 段階2a のあいだだけ:2体目の相手との1ラウンドだけにして、スキルと必殺技は出さない
// (パック選び・3ラウンド・スキル・必殺技を作ったら、この関数ごと外す)
export function trialConfig(config: BattleConfig): BattleConfig {
  const second = config.rounds[Math.min(1, config.rounds.length - 1)];
  return {
    ...config,
    packHealRate: 0,
    packSealRate: 0,
    drawHealRate: 0,
    drawSealRate: 0,
    rounds: [{ ...second, finisherChance: 0, comebackChance: 0 }],
  };
}

/** 設定ファイル(public/data/battle-config.json)を読んでから、カードバトルを始める */
export function CardBattleEntry({ player, cpu, playSound }: { player: Monster; cpu: Monster; playSound: PlaySound }) {
  const [config, setConfig] = useState<BattleConfig | null>(null);
  useEffect(() => {
    let alive = true;
    void loadBattleConfig(assetUrl('/data/battle-config.json')).then((loaded) => {
      if (alive) setConfig(loaded);
    });
    return () => { alive = false; };
  }, []);
  const trial = useMemo(() => (config ? trialConfig(config) : null), [config]);
  if (!trial) return <main className="screen loading-screen"><div className="loader" /><p>カードを じゅんびしているよ…</p></main>;
  return <CardBattle player={player} cpu={cpu} config={trial} playSound={playSound} />;
}
