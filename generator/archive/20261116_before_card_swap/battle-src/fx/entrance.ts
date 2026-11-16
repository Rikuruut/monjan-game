import { gsap, SplitText } from './gsap';

// 画面に入ったときの登場の動き(タイトル・結果・ありがとう で共通)。
// どれも useGSAP の中で呼ぶ(画面を閉じたら 動きも 文字の分けかたも もとにもどる)

/** 見出しの字を 1文字ずつ 大きく回りながら たたきつける(SplitText。読み上げの名前は もとの文のまま) */
export function slamChars(target: Element, delay = 0, stagger = 0.06) {
  const split = SplitText.create(target, { type: 'chars' });
  return gsap.from(split.chars, {
    opacity: 0,
    scale: 2.8,
    y: -36,
    rotation: () => gsap.utils.random(-24, 24),
    duration: 0.36,
    ease: 'back.out(2.4)',
    stagger,
    delay,
  });
}

/** 小さく ポンと出る(行きすぎて もどる) */
export function popIn(target: Element | Element[] | NodeListOf<Element>, delay = 0) {
  return gsap.fromTo(
    target,
    { opacity: 0, scale: 0.4, y: 30 },
    { opacity: 1, scale: 1, y: 0, duration: 0.5, ease: 'back.out(2.2)', delay, stagger: 0.08 },
  );
}

/**
 * 上から落ちてきて 着地で つぶれて はねる(カード)。光って出る。
 * soft は 負けたとき:ふわっと降りて つぶれない
 */
export function landFromAbove(target: Element, delay = 0, soft = false) {
  const tl = gsap.timeline({ delay });
  if (soft) {
    return tl.fromTo(target, { opacity: 0, y: -120, rotation: -4 }, { opacity: 1, y: 0, rotation: 0, duration: 0.9, ease: 'power2.out' });
  }
  return tl
    .fromTo(
      target,
      { opacity: 0, y: -520, rotation: -10, filter: 'brightness(2.4)' },
      { opacity: 1, y: 0, rotation: 0, duration: 0.42, ease: 'power3.in' },
    )
    .to(target, { scaleX: 1.12, scaleY: 0.86, duration: 0.06, ease: 'power1.out' })
    .to(target, { scaleX: 1, scaleY: 1, duration: 0.55, ease: 'elastic.out(1, 0.4)' })
    .to(target, { filter: 'brightness(1)', duration: 0.5, ease: 'power2.out', clearProps: 'filter' }, '<');
}
