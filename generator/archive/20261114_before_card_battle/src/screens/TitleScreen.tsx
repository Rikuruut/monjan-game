import { Backdrop, Logo } from '../components/Scenery';
import { Deck } from '../Deck';

export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <main className="screen title-screen">
      <Backdrop />
      <section className="title-copy">
        <Logo className="title-logo" alt="モンじゃん！ 生き物×モノで、キミだけのモンスター誕生！" />
        <p className="title-hint">まんなかの ボタンを おしてね</p>
      </section>
      <Deck knobs={{ center: { label: 'スタート！', onClick: onStart, call: true } }} />
    </main>
  );
}
