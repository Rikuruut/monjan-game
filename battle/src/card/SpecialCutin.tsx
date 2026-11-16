import { useRef } from 'react';
import { specialMoveFontSize, specialMoveName, specialMoveParts, type AttributeTheme } from '../attributes';
import { MonsterImage } from '../components/MonsterCard';
import { gsap, SplitText, useGSAP } from '../fx/gsap';
import { SPECIAL_CUTIN_SLAM_MS } from '../timings';
import type { Monster } from '../types';

// 必殺技のカットインの名前。撮った物とタイプの言葉を2行に分け、長いほど字を小さくして枠に収める
function SpecialMoveTitle({ monster }: { monster: Monster }) {
  const parts = specialMoveParts(monster);
  return (
    <strong title={specialMoveName(monster)} style={{ fontSize: `${specialMoveFontSize(parts)}px` }}>
      {parts.object && <span className="special-cutin__object">{parts.object}</span>}
      <span className="special-cutin__word">{parts.word}</span>
    </strong>
  );
}

// 必殺技のカットイン(自分のモンスターの絵 + 技の名前)
export function SpecialCutin({ monster, theme }: { monster: Monster; theme: AttributeTheme }) {
  const rootRef = useRef<HTMLDivElement>(null);
  // 技の名前:1文字ずつ 大きく回りながら たたきつけられる(SplitText。名前の行ごとに分ける)。
  // 名前の塊の ふくらむ脈(namePulse)は CSS のまま
  useGSAP(() => {
    const lines = rootRef.current?.querySelectorAll('.special-cutin__copy strong > span');
    if (!lines?.length) return;
    const split = SplitText.create([...lines], { type: 'chars' });
    gsap.from(split.chars, {
      opacity: 0,
      scale: 3.2,
      y: -40,
      rotation: () => gsap.utils.random(-30, 30),
      duration: 0.32,
      ease: 'back.out(2.2)',
      stagger: 0.045,
      delay: SPECIAL_CUTIN_SLAM_MS / 1000,
    });
  }, { scope: rootRef });
  // モンスター(設計書8章):窓の中は はじめ カードの窓のように 寄った絵 → 全体まで ズームアウト →
  // 同じ絵が 枠より大きく 前へ飛び出す。窓が すべりこむ動き(monsterSlide)は CSS のまま
  useGSAP(() => {
    const root = rootRef.current;
    const windowImage = root?.querySelector('.special-cutin__monster .monster-image');
    const frame = root?.querySelector('.special-cutin__monster');
    const pop = root?.querySelector('.special-cutin__pop');
    const tl = gsap.timeline();
    if (windowImage) tl.fromTo(windowImage, { scale: 1.7 }, { scale: 1, duration: 0.5, ease: 'power2.out' }, 0.3);
    if (pop) {
      tl.fromTo(pop, { opacity: 0, scale: 0.98, y: 0 }, { opacity: 1, scale: 1.2, x: -24, y: -56, duration: 0.24, ease: 'back.out(2.4)' }, 0.85)
        .to(pop, { scale: 1.16, y: -48, duration: 0.5, ease: 'sine.inOut', repeat: -1, yoyo: true });
    }
    if (frame) tl.fromTo(frame, { x: 0 }, { x: 10, duration: 0.4, ease: 'fx.wiggle', clearProps: 'x' }, 0.85);
  }, { scope: rootRef });
  return (
    <div ref={rootRef} className={`special-cutin special-cutin--${theme}`} role="status" aria-live="assertive">
      <span className="special-cutin__lines" aria-hidden="true" />
      <span className="special-cutin__band" aria-hidden="true" />
      <div className="special-cutin__monster" aria-hidden="true">
        <MonsterImage monster={monster} />
      </div>
      {/* 枠の外へ 飛び出す絵(窓と同じ位置・傾き。読み上げは 窓の絵だけ) */}
      <div className="special-cutin__pop-frame" aria-hidden="true">
        <img className="special-cutin__pop" src={monster.image} alt="" draggable={false} />
      </div>
      <div className="special-cutin__copy">
        <small>ひっさつわざ！</small>
        <SpecialMoveTitle monster={monster} />
        <span>とどめの いちげき！</span>
      </div>
      <span className="special-cutin__flash" aria-hidden="true" />
    </div>
  );
}
