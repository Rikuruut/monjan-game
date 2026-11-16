import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { CustomEase } from 'gsap/CustomEase';
import { CustomWiggle } from 'gsap/CustomWiggle';
import { Flip } from 'gsap/Flip';
import { SplitText } from 'gsap/SplitText';

// GSAP の入り口(演出は ここから import する)。プラグインは ここで1回だけ登録する(gsap-plugins)。
// 進行のタイミング(いつ次の段階へ進むか)は これまでどおり useTimers と timings.ts が決める。
// GSAP は見た目だけで、動きの終わりを待って 次へ進む作りにはしない(テストの fake timers がそのまま通るように)

gsap.registerPlugin(useGSAP, Flip, SplitText, CustomEase, CustomWiggle);

// 揺れの型(行って もどって だんだん小さく)。ノックバック・ゆらゆら に使う
CustomWiggle.create('fx.wiggle', { wiggles: 5, type: 'easeOut' });
CustomWiggle.create('fx.wiggleBig', { wiggles: 8, type: 'easeOut' });

/** 「動きを減らす」の設定(OS)。揺れ・ヒットストップを弱める */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export { CustomEase, Flip, gsap, SplitText, useGSAP };
