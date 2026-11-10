import { HandIcon } from '../components/HandIcon';
import { MonsterCard } from '../components/MonsterCard';
import { Backdrop, Logo } from '../components/Scenery';
import { cx } from '../cx';
import { Deck } from '../Deck';
import { HANDS, type Monster } from '../types';

export type ResultKind = 'victory' | 'defeat' | 'draw' | 'practice';

const RESULT_COPY = {
  victory: {
    eyebrow: 'やったね！',
    title: 'しょうり！',
    message: 'キミとモンスターの ちからで かったよ！',
  },
  defeat: {
    eyebrow: 'ナイスバトル！',
    title: 'おしかった！',
    message: 'さいごまで かっこよく たたかったね！',
  },
  draw: {
    eyebrow: 'まさかの',
    title: '引き分け！',
    message: '最後は本物のじゃんけん！！',
  },
  // 練習ラウンドのおわり(本番とは別の、練習だけで完結する画面)
  practice: {
    eyebrow: 'ルールは ばっちり！',
    title: 'れんしゅう クリア！',
    message: 'つぎは いよいよ ほんばん！ あいては だれかな…？',
  },
} as const;

const CONTINUE_LABEL: Record<ResultKind, string> = {
  victory: 'つぎへ',
  defeat: 'つぎへ',
  draw: 'じゃんけんしたよ！',
  practice: 'ほんばん スタート！',
};

// 勝ち・負け・引き分け・れんしゅうクリア。
// 撮影のモンスター(cardUrl あり)は、ありがとうの画面と同じく 実際に刷ったカード(generator の /card)を見せる
// (2026年11月10日。それまではバトルのカードで、モンじゃん!のカードの形になっていなかった)。
// バトルの見本・単体の開発用は、刷ったカードがないので、これまでのカード
export function ResultScreen({
  kind,
  monster,
  cardUrl = null,
  onContinue,
}: {
  kind: ResultKind;
  monster: Monster;
  cardUrl?: string | null;
  onContinue: () => void;
}) {
  const copy = RESULT_COPY[kind];
  const printed = kind !== 'draw' && Boolean(cardUrl);
  return (
    <main className={`screen result-screen result-screen--${kind}`}>
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
        <div className={cx('result-card__visual', printed && 'result-card__visual--printed')}>
          {kind === 'draw' ? (
            <div className="real-janken">
              <div className="real-janken__hands">
                {HANDS.map((hand) => <span key={hand} aria-hidden="true"><HandIcon hand={hand} alt="" /></span>)}
              </div>
              <p>かいじょうの おとなと<br />じゃんけんしてね！</p>
            </div>
          ) : printed ? (
            <div className={`printed-card printed-card--result printed-card--${kind}`}>
              {/* フォーカスを取らない(会場の3つのボタンは、このページで受ける) */}
              <iframe className="printed-card__frame" src={cardUrl ?? undefined} title="モンスターカード" tabIndex={-1} />
            </div>
          ) : (
            <MonsterCard monster={monster} className={`result-monster result-monster--${kind}`} />
          )}
        </div>
      </section>
      <Deck knobs={{ center: { label: CONTINUE_LABEL[kind], onClick: onContinue, call: true } }} />
    </main>
  );
}
