import { useRef } from 'react';
import type { AttributeTheme } from '../attributes';
import { cx } from '../cx';
import { gsap, useGSAP } from '../fx/gsap';
import type { Side } from '../game/engine';
import { CARD_CLASH_IN_MS } from '../timings';
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
  const rootRef = useRef<HTMLDivElement>(null);

  // ---- 動き(GSAP。進む時間は useCardBattle のタイマーが決める。ここは見た目だけ) ----
  // すべりこむ:左右から 回りながら入って、着地で つぶれる
  useGSAP(() => {
    const inSec = CARD_CLASH_IN_MS / 1000;
    gsap.timeline()
      .fromTo('.cb-clash__slot--player', { x: -560, rotation: -20, opacity: 0 }, { x: 0, rotation: 0, opacity: 1, duration: inSec, ease: 'back.out(1.5)' }, 0)
      .fromTo('.cb-clash__slot--cpu', { x: 560, rotation: 20, opacity: 0 }, { x: 0, rotation: 0, opacity: 1, duration: inSec, ease: 'back.out(1.5)' }, 0)
      .fromTo('.cb-clash__card', { scaleX: 1.12, scaleY: 0.88 }, { scaleX: 1, scaleY: 1, duration: 0.35, ease: 'elastic.out(1, 0.45)' }, inSec * 0.85);
  }, { scope: rootRef });

  // かけ声ごとに はねる(ぽん!は 高く)。上で少し伸びて、着地で つぶれる
  useGSAP(() => {
    if (view !== 'janken' || beat < 1) return;
    const high = beat === 3 ? 90 : 56;
    const tilt = beat === 2 ? 5 : -5;
    gsap.timeline()
      .to('.cb-clash__card', { y: -high, rotation: tilt, scaleX: 0.94, scaleY: 1.08, duration: 0.17, ease: 'power2.out' })
      .to('.cb-clash__card', { y: 0, rotation: 0, scaleX: 1, scaleY: 1, duration: 0.15, ease: 'power2.in' })
      .to('.cb-clash__card', { scaleX: 1.12, scaleY: 0.88, duration: 0.05, ease: 'power1.out' })
      .to('.cb-clash__card', { scaleX: 1, scaleY: 1, duration: 0.3, ease: 'elastic.out(1, 0.4)' });
    // ぽん!:真ん中の VS も ドンと はずむ
    if (beat === 3) gsap.fromTo('.cb-clash__vs', { scale: 1.7, rotation: -12 }, { scale: 1, rotation: 0, duration: 0.45, ease: 'back.out(3)' });
  }, { scope: rootRef, dependencies: [view, beat] });

  // めくる → 勝ったほうが ドンと大きく、負けたほうは 押されて 小さく。あいこは 2枚とも はずむ
  useGSAP(() => {
    if (!revealed) return;
    const tl = gsap.timeline();
    tl.fromTo('.cb-clash__card', { rotationY: 90, scaleY: 1.14 }, { rotationY: 0, scaleY: 1, duration: 0.34, ease: 'back.out(2)' });
    if (decided) {
      const loser: Side = decided === 'player' ? 'cpu' : 'player';
      const away = loser === 'cpu' ? 1 : -1;
      tl.to(`.cb-clash__slot--${decided}`, { scale: 1.24, y: -18, duration: 0.16, ease: 'power2.out' }, 0.36)
        .to(`.cb-clash__slot--${decided}`, { scale: 1.15, y: 0, duration: 0.4, ease: 'elastic.out(1, 0.4)' })
        .to(`.cb-clash__slot--${loser}`, { scale: 0.82, x: away * 50, rotation: away * 9, duration: 0.32, ease: 'power3.out' }, 0.38);
    } else {
      tl.fromTo('.cb-clash__slot', { scale: 1 }, { scale: 1.08, duration: 0.18, yoyo: true, repeat: 1, ease: 'power1.inOut' }, 0.36);
    }
  }, { scope: rootRef, dependencies: [revealed] });

  // かけ声・結果の字:ぐっと はずんで出る
  useGSAP(() => {
    if (!copy.shout) return;
    gsap.fromTo(
      '.cb-clash__shout',
      { scale: 0.3, rotation: revealed ? 0 : -8, opacity: 0 },
      { scale: 1, rotation: 0, opacity: 1, duration: revealed ? 0.45 : 0.32, ease: revealed ? 'back.out(2.2)' : 'back.out(3)' },
    );
  }, { scope: rootRef, dependencies: [copy.shout] });

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
    <div ref={rootRef} className={cx('cb-clash', `cb-clash--${view}`, `cb-clash--beat${beat}`)} role="status" aria-live="assertive">
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
