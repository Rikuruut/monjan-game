import { useRef } from 'react';
import { Backdrop, Logo } from '../components/Scenery';
import { Deck } from '../Deck';
import { landFromAbove, popIn } from '../fx/entrance';
import { useGSAP } from '../fx/gsap';

export function TitleScreen({ onStart }: { onStart: () => void }) {
  const rootRef = useRef<HTMLElement>(null);
  // ロゴが 上から落ちてきて はずみ、案内が ポンと出る(ロゴの ふわふわは CSS の logoFloat。動かす要素を分けている)
  useGSAP(() => {
    const copy = rootRef.current?.querySelector('.title-copy');
    const hint = rootRef.current?.querySelector('.title-hint');
    if (copy) landFromAbove(copy, 0.1);
    if (hint) popIn(hint, 0.75);
  }, { scope: rootRef });
  return (
    <main ref={rootRef} className="screen title-screen">
      <Backdrop />
      <section className="title-copy">
        <Logo className="title-logo" alt="モンじゃん！ 生き物×モノで、キミだけのモンスター誕生！" />
        <p className="title-hint">まんなかの ボタンを おしてね</p>
      </section>
      <Deck knobs={{ center: { label: 'スタート！', onClick: onStart, call: true } }} />
    </main>
  );
}
