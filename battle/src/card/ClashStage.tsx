import type { AttributeTheme } from '../attributes';
import { cx } from '../cx';
import type { Side } from '../game/engine';
import { CardView } from './CardView';
import type { CardBattleView, Clash } from './useCardBattle';

// じゃんけんの見せ場(戦闘システム設計書 8章「じゃんけん」。見た目は cardbattle.css の .cb-clash)。
// 画面の真ん中に 大きなカード2枚が すべりこんで向かい合い(どちらも裏向き)、かけ声に合わせて はねる →
// 「ぽん!」で同時に めくれる → 勝ったほうが大きく タイプの色で光り、負けたほうは小さく暗く。
// あいこは★の多いほうが勝ち(★も同じなら このあと連打勝負)

const BEAT_COPY = ['', 'じゃん', 'けん', 'ぽん！'];

/** 結果の ひとこと(上)と くわしいこと(下) */
function resultCopy(clash: Clash): { shout: string; sub?: string } {
  if (clash.winner === 'rendan') return { shout: 'あいこ！', sub: '★も おなじ！ れんだで しょうぶ！' };
  const shout = clash.winner === 'player' ? 'あなたの かち！' : 'あいての かち…';
  return clash.by === 'star' ? { shout, sub: 'あいこ！ ★が おおい ほうの かち' } : { shout };
}

export function ClashStage({
  clash,
  view,
  beat,
  themes,
}: {
  clash: Clash;
  view: CardBattleView;
  beat: number;
  themes: Record<Side, AttributeTheme>;
}) {
  const revealed = view === 'reveal';
  const decided: Side | null = revealed && clash.winner !== 'rendan' ? clash.winner : null;
  const copy = revealed ? resultCopy(clash) : { shout: BEAT_COPY[beat] ?? '' };

  const slot = (side: Side) => {
    const card = side === 'player' ? clash.playerCard : clash.cpuCard;
    return (
      <div
        className={cx(
          'cb-clash__slot',
          `cb-clash__slot--${side}`,
          `cb-type-${themes[side]}`,
          decided === side && 'cb-clash__slot--won',
          decided !== null && decided !== side && 'cb-clash__slot--lost',
          // あいこ(★も同じ)は 2枚とも光る
          revealed && clash.winner === 'rendan' && 'cb-clash__slot--even',
        )}
      >
        <span className="cb-clash__who">{side === 'player' ? 'あなた' : 'あいて'}</span>
        {/* めくると key が変わって、表のカードが くるっと出る */}
        <div className="cb-clash__card" key={revealed ? 'front' : 'back'}>
          <CardView card={card} size="clash" back={!revealed} />
        </div>
      </div>
    );
  };

  return (
    <div className={cx('cb-clash', `cb-clash--${view}`, `cb-clash--beat${beat}`)} role="status" aria-live="assertive">
      <span className="cb-clash__veil" aria-hidden="true" />
      {/* key で出しなおして、かけ声ごとに はねて出る */}
      <strong key={copy.shout} className={cx('cb-clash__shout', revealed && 'cb-clash__shout--result')}>{copy.shout}</strong>
      <div className="cb-clash__row">
        {slot('player')}
        <span className="cb-clash__vs" aria-hidden="true">VS</span>
        {slot('cpu')}
      </div>
      {copy.sub && <span className="cb-clash__sub">{copy.sub}</span>}
    </div>
  );
}
