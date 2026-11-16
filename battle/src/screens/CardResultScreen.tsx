import { useRef } from 'react';
import type { CardBattleOutcome } from '../card/CardBattle';
import { MonsterCard, MonsterImage } from '../components/MonsterCard';
import { Backdrop, Logo } from '../components/Scenery';
import { Deck } from '../Deck';
import { landFromAbove, popIn, slamChars } from '../fx/entrance';
import { useGSAP } from '../fx/gsap';
import type { Monster } from '../types';

// 勝ち・負けで 見出しと ことばを かえる(ResultScreen.tsx と同じ ことば)
const COPY = {
  win: { kind: 'victory', eyebrow: 'やったね！', title: 'しょうり！', message: 'キミとモンスターの ちからで かったよ！' },
  lose: { kind: 'defeat', eyebrow: 'ナイスバトル！', title: 'おしかった！', message: 'さいごまで かっこよく たたかったね！' },
} as const;

// カードバトルのリザルト:戦いの結果(勝ち負け・ターン・のこり HP・必殺技)と、自分のモンスター。
// 中ボタン「つぎへ」で カードゲットの画面へ
export function CardResultScreen({
  monster,
  outcome,
  onContinue,
}: {
  monster: Monster;
  outcome: CardBattleOutcome;
  onContinue: () => void;
}) {
  const copy = COPY[outcome.result];
  const rootRef = useRef<HTMLElement>(null);
  // 見出しが1文字ずつ たたきつけられ、カードが 上から落ちて、結果の札が ポンと出る(ResultScreen と同じ動き)
  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    const title = root.querySelector('.result-card__header h1');
    if (title) slamChars(title, 0.05);
    popIn(root.querySelectorAll('.result-eyebrow, .result-message'), 0.45);
    const visual = root.querySelector('.card-result__visual');
    if (visual) landFromAbove(visual, 0.3, outcome.result === 'lose');
    popIn(root.querySelectorAll('.card-result__row'), 0.9);
  }, { scope: rootRef, dependencies: [outcome.result], revertOnUpdate: true });

  return (
    <main ref={rootRef} className={`screen result-screen card-result result-screen--${copy.kind}`}>
      <Backdrop rays />
      <div className="signboard result-signboard">
        <Logo className="result-brand" />
      </div>
      <section className="result-card">
        <div className="result-card__header">
          <p className="result-eyebrow">{copy.eyebrow}</p>
          <h1>{copy.title}</h1>
          <p className="result-message">{copy.message}</p>
        </div>
        <div className="card-result__visual">
          <MonsterCard monster={monster} className={`result-monster result-monster--${copy.kind}`} />
        </div>
        <ul className="card-result__stats" aria-label="たたかいの けっか">
          <li className="card-result__row card-result__row--vs">
            <span className="card-result__label">あいて</span>
            <span className="card-result__cpu">
              <span className="card-result__cpu-image"><MonsterImage monster={outcome.cpu} /></span>
              <strong>{outcome.cpu.name}</strong>
            </span>
          </li>
          <li className="card-result__row">
            <span className="card-result__label">ターン</span>
            <strong><b>{outcome.turns}</b> ターン</strong>
          </li>
          <li className="card-result__row">
            <span className="card-result__label">のこり HP</span>
            <strong><b>{outcome.playerHp}</b> / {outcome.playerMaxHp}</strong>
          </li>
          {outcome.finisherUsed && (
            <li className="card-result__row card-result__row--special">
              <strong>✨ ひっさつわざ を きめた！</strong>
            </li>
          )}
        </ul>
      </section>
      <Deck knobs={{ center: { label: 'つぎへ', onClick: onContinue, call: true } }} />
    </main>
  );
}
