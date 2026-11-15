import { useEffect, useRef, type CSSProperties } from 'react';
import { createParticleFire, stopParticleFire, type ParticleFire } from '../attackParticles';
import { cx } from '../cx';
import { gsap, useGSAP } from '../fx/gsap';
import { mergeablePairs, type Card } from '../game/cards';
import { CARD_PACK_TEAR_MS } from '../timings';
import { CardView } from './CardView';
import { isRareCard, type CardBattleApi } from './useCardBattle';

// パック選び・開封の画面(設計書4-1・7章・8章。見た目は cardbattle.css の .cb-pack-stage)。
// えらぶ(パックが並び、えらんだパックが浮いて ゆれる)→ あける(ほかのパックが消え、えらんだパックが まんなかで ぶるぶる →
// 上のふちが ビリッと ちぎれて飛び、粒が はじけ、裏向きのカードが せり上がる)→ めくる(横に広がって 左から1枚ずつ)→ バトル スタートを待つ。
// トレーディングカードのパックを参考にした 仮の外装(あとで 画像に差しかえる)。
// 進む時間は useCardBattle のタイマーが決める。ここは 見た目だけ(GSAP)

// ラウンドごとの パックの色(設計書5-2:1体目 ふつう・2体目 銀・3体目 金)
const TIERS = ['normal', 'silver', 'gold'] as const;

// めくったカードの 横の間隔(px。.cb-pack-card の幅 + すきま)
const CARD_GAP = 236;
// えらぶあいだの パックの縮み(cardbattle.css の .cb-pack の zoom と同じ。上3・下2 の2段が 画面に入る大きさ)
const PACK_ZOOM = 0.72;

function PackFace({ index, round }: { index: number; round: number }) {
  return (
    <>
      {/* 上の ちぎれる帯(ギザギザのふち) */}
      <span className="cb-pack__top" aria-hidden="true" />
      <span className="cb-pack__body" aria-hidden="true">
        <span className="cb-pack__logo">モンじゃん！</span>
        <span className="cb-pack__name">カード<br />パック</span>
        <span className="cb-pack__emblem">✦</span>
        <span className="cb-pack__count">5まい いり</span>
        <span className="cb-pack__round">ラウンド {round}</span>
      </span>
      {/* 光の すじ(ホイルの照り返し) */}
      <span className="cb-pack__shine" aria-hidden="true" style={{ '--i': index } as CSSProperties} />
    </>
  );
}

export function PackOpening({ battle }: { battle: CardBattleApi }) {
  const { state, packStep, packCursor, packCards, flipped } = battle;
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fireRef = useRef<ParticleFire | null>(null);
  const choices = state.config.packChoices;
  const tier = TIERS[Math.min(TIERS.length, state.round) - 1] ?? 'normal';
  const paired = new Set(mergeablePairs(packCards).flat().map((card) => card.id));

  useEffect(() => {
    if (canvasRef.current) fireRef.current = createParticleFire(canvasRef.current);
    return () => {
      stopParticleFire(fireRef.current);
      fireRef.current = null;
    };
  }, []);

  // ---- えらぶ:えらんだパックが 浮いて ゆらゆら、ほかは 少し小さく ----
  useGSAP(() => {
    if (packStep !== 'choose') return;
    const packs = gsap.utils.toArray<HTMLElement>('.cb-pack');
    packs.forEach((pack, index) => {
      gsap.killTweensOf(pack);
      if (index === packCursor) {
        gsap.to(pack, { y: -40, scale: 1.08, rotation: 0, duration: 0.3, ease: 'back.out(2.2)' });
        gsap.to(pack, { rotation: 2.5, duration: 0.7, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 0.3 });
      } else {
        gsap.to(pack, { y: 0, scale: 0.92, rotation: 0, duration: 0.3, ease: 'power2.out' });
      }
    });
  }, { scope: rootRef, dependencies: [packStep, packCursor] });

  // ---- あける(約1.5秒):ほかのパックが落ちる → まんなかへ → ぶるぶる → ビリッ(粒・光)→ カードが せり上がる → 袋が落ちる ----
  useGSAP(() => {
    if (packStep !== 'opening') return;
    const packs = gsap.utils.toArray<HTMLElement>('.cb-pack');
    const chosen = packs[packCursor];
    if (!chosen) return;
    const others = packs.filter((pack) => pack !== chosen);
    // 段(上3・下2)の まんなかへ 寄せる量:見た目の px を測り、舞台の縮みと パックの zoom で わって パックの px に直す
    const row = chosen.parentElement;
    let toCenter = { x: 0, y: 0 };
    if (row) {
      const rowBox = row.getBoundingClientRect();
      const box = chosen.getBoundingClientRect();
      const stage = row.offsetWidth > 0 && rowBox.width > 0 ? rowBox.width / row.offsetWidth : 1;
      toCenter = {
        x: (rowBox.left + rowBox.width / 2 - (box.left + box.width / 2)) / stage / PACK_ZOOM,
        y: (rowBox.top + rowBox.height / 2 - (box.top + box.height / 2)) / stage / PACK_ZOOM,
      };
    }
    const tear = CARD_PACK_TEAR_MS / 1000;
    gsap.killTweensOf(packs);
    const tl = gsap.timeline();
    tl.to(others, { y: 520, rotation: (index) => (index % 2 ? 18 : -18), opacity: 0, duration: 0.35, ease: 'power2.in' }, 0)
      .to(chosen, { x: toCenter.x, y: toCenter.y - 10, scale: 1.7, rotation: 0, duration: 0.35, ease: 'power3.out' }, 0.05)
      // ため:ぶるぶる ふるえて、少し つぶれる
      .to(chosen, { rotation: 4, duration: 0.25, ease: 'fx.wiggleBig' }, 0.42)
      .to(chosen, { scaleX: 1.78, scaleY: 1.64, duration: 0.2, ease: 'power1.in' }, 0.45)
      // ビリッ:上の帯が 回りながら飛んでいく。うしろに 光の筋と フラッシュ
      .to(chosen.querySelector('.cb-pack__top'), { x: 300, y: -260, rotation: 55, opacity: 0, duration: 0.5, ease: 'power2.out' }, tear)
      .to(chosen, { scaleX: 1.7, scaleY: 1.7, duration: 0.3, ease: 'elastic.out(1, 0.4)' }, tear)
      .fromTo('.cb-pack-stage__rays', { opacity: 0, scale: 0.4, rotation: 0 }, { opacity: 1, scale: 1, rotation: 25, duration: 0.6, ease: 'power2.out' }, tear)
      .fromTo('.cb-pack-stage__flash', { opacity: 0.9 }, { opacity: 0, duration: 0.35, ease: 'power2.out' }, tear)
      .call(() => {
        void fireRef.current?.({
          particleCount: 70,
          spread: 120,
          startVelocity: 42,
          origin: { x: 0.5, y: 0.3 },
          colors: tier === 'gold' ? ['#ffd23f', '#fff6c8', '#ff9d2e'] : tier === 'silver' ? ['#e8f0ff', '#ffffff', '#9fb4d8'] : ['#ffe27a', '#ffffff', '#7fe08a'],
          scalar: 1.1,
          ticks: 120,
        });
      }, undefined, tear)
      // 裏向きのカードが 口から せり上がり、袋は 下へ落ちる
      .fromTo('.cb-pack-stack', { y: 120, opacity: 0 }, { y: -90, opacity: 1, duration: 0.45, ease: 'back.out(1.6)' }, tear + 0.12)
      .to(chosen, { y: toCenter.y + 800, opacity: 0, duration: 0.5, ease: 'power2.in' }, tear + 0.3);
  }, { scope: rootRef, dependencies: [packStep] });

  // ---- めくる:5枚が まんなかの束から 横一列に広がる ----
  useGSAP(() => {
    if (packStep !== 'reveal') return;
    const cards = gsap.utils.toArray<HTMLElement>('.cb-pack-card');
    const center = (cards.length - 1) / 2;
    gsap.fromTo(
      cards,
      { x: (index) => (center - index) * CARD_GAP, y: -70, rotation: (index) => (index - center) * 4, scale: 0.9 },
      { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.42, ease: 'power3.out', stagger: 0.03 },
    );
    gsap.to('.cb-pack-stage__rays', { opacity: 0.45, duration: 0.6 });
  }, { scope: rootRef, dependencies: [packStep] });

  // 1枚めくるたびに:くるっと回って表になり、ポンと はずむ(レアは 大きく はずんで 光が はじける)
  useGSAP(() => {
    if (flipped < 1) return;
    const card = rootRef.current?.querySelectorAll('.cb-pack-card')[flipped - 1];
    const face = card?.querySelector('.cb-pack-card__face');
    if (!card || !face) return;
    const rare = card.classList.contains('cb-pack-card--rare');
    gsap.fromTo(face, { rotationY: 90 }, { rotationY: 0, duration: 0.22, ease: 'power2.out' });
    gsap.fromTo(card, { scale: rare ? 1.32 : 1.15, y: rare ? -30 : -14 }, { scale: 1, y: 0, duration: rare ? 0.6 : 0.4, ease: 'elastic.out(1, 0.45)' });
    const burst = card.querySelector('.cb-pack-card__burst');
    if (burst) gsap.fromTo(burst, { scale: 0.3, opacity: 1 }, { scale: 2.2, opacity: 0, duration: 0.5, ease: 'power2.out' });
  }, { scope: rootRef, dependencies: [flipped] });

  const title = packStep === 'choose' ? 'パックを えらぼう！' : packStep === 'opening' ? 'あけるよ…！' : 'なにが でたかな？';
  const guide = packStep === 'choose' ? '◀ ▶ で えらんで ● で あける！' : packStep === 'ready' ? '● で バトル スタート！' : null;

  return (
    <div ref={rootRef} className={cx('cb-pack-stage', `cb-pack-stage--${packStep}`, `cb-pack-tier-${tier}`)} role="region" aria-label="パック えらび">
      <span className="cb-pack-stage__veil" aria-hidden="true" />
      <span className="cb-pack-stage__rays" aria-hidden="true" />
      <div className="cb-pack-stage__head">
        <span className="cb-pack-stage__round">ラウンド {state.round}</span>
        {/* key で出しなおして、段が変わるたびに はねて出る */}
        <strong key={title} className="cb-pack-stage__title" role="status">{title}</strong>
      </div>

      {(packStep === 'choose' || packStep === 'opening') && (
        <div className="cb-pack-row">
          {Array.from({ length: choices }, (_, index) => (
            <div
              key={index}
              className={cx('cb-pack', index === packCursor && 'cb-pack--selected')}
              data-testid={`pack-${index}`}
              aria-current={index === packCursor ? 'true' : undefined}
              aria-label={`パック ${index + 1}`}
              role="img"
            >
              <PackFace index={index} round={state.round} />
            </div>
          ))}
          {/* 開けた口から せり上がる 裏向きのカードの束 */}
          {packStep === 'opening' && (
            <div className="cb-pack-stack" aria-hidden="true">
              {packCards.map((card, index) => (
                <div key={card.id} className="cb-pack-stack__card" style={{ '--i': index } as CSSProperties}>
                  <CardView card={card} back size="clash" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {(packStep === 'reveal' || packStep === 'ready') && (
        <div className="cb-pack-cards" aria-label="パックの カード">
          {packCards.map((card: Card, index) => {
            const open = index < flipped;
            const rare = isRareCard(card);
            return (
              <div
                key={card.id}
                className={cx('cb-pack-card', rare && 'cb-pack-card--rare', open && 'cb-pack-card--open')}
                data-testid={`pack-card-${index}`}
              >
                {/* めくると key が変わって、表のカードが くるっと出る */}
                <div className="cb-pack-card__face" key={open ? 'front' : 'back'}>
                  <CardView card={card} back={!open} size="clash" />
                </div>
                {open && rare && <span className="cb-pack-card__burst" aria-hidden="true" />}
                {/* めくり終わったら 合体できるペアに ✨ */}
                {packStep === 'ready' && paired.has(card.id) && <span className="cb-pair-tag cb-pack-card__pair" aria-label="がったい できる">✨</span>}
              </div>
            );
          })}
        </div>
      )}

      {/* 案内の1行(いま押すボタン)。えらぶあいだは のこり時間の バー(packAutoOpenMs で 自動で開く) */}
      {guide && (
        <div className="cb-pack-stage__guide">
          <p key={guide} className="cb-guide" role="status" data-testid="pack-guide">{guide}</p>
          {packStep === 'choose' && (
            <span className="cb-pack-stage__timer" aria-hidden="true">
              <i style={{ animationDuration: `${state.config.packAutoOpenMs}ms` }} />
            </span>
          )}
        </div>
      )}

      <span className="cb-pack-stage__flash" aria-hidden="true" />
      <canvas ref={canvasRef} className="particle-layer" width={1920} height={1080} aria-hidden="true" />
    </div>
  );
}
