import { useRef } from 'react';
import { getAttributeTheme } from '../attributes';
import { Hearts, MonsterCard, Swords, statCount } from '../components/MonsterCard';
import { Backdrop } from '../components/Scenery';
import { cx } from '../cx';
import { Deck } from '../Deck';
import { landFromAbove, popIn, slamChars } from '../fx/entrance';
import { useGSAP } from '../fx/gsap';
import type { Monster } from '../types';

// ありがとう:もらえるカード(左)と、ことば(右)。
// 撮影のモンスターは、実際に刷ったカード(generator の /card。No. つき)をそのまま見せる
// (2026年11月9日。画面と手元のカードをそろえ、スタッフが No. を見て渡せるように)。
// バトルの見本・単体の開発用は、刷ったカードがないので、これまでのカード
export function ThanksScreen({ monster, cardUrl, onTitle }: { monster: Monster; cardUrl: string | null; onTitle: () => void }) {
  const theme = getAttributeTheme(monster.attribute);
  const rootRef = useRef<HTMLElement>(null);
  // もらえるカードが 上から落ちて はずみ、「ゲット!」が1文字ずつ たたきつけられ、ことばが ポンと出る
  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    const visual = root.querySelector('.thanks-card__visual');
    if (visual) landFromAbove(visual, 0.1);
    popIn(root.querySelectorAll('.acquisition-kicker, .thanks-message'), 0.35);
    const get = root.querySelector('.thanks-card__side h1 span');
    if (get) slamChars(get, 0.55, 0.08);
  }, { scope: rootRef });
  return (
    <main ref={rootRef} className="screen thanks-screen">
      <Backdrop rays />
      <section className="thanks-card">
        <div className={cx('thanks-card__visual', cardUrl && 'thanks-card__visual--printed')}>
          {cardUrl ? (
            <div className="printed-card">
              {/* フォーカスを取らない(会場の3つのボタンは、このページで受ける) */}
              <iframe className="printed-card__frame" src={cardUrl} title="もらえるカード" tabIndex={-1} />
            </div>
          ) : (
            <div className={`acquired-card acquired-card--${theme}`}>
              <MonsterCard monster={monster} className="acquired-card__card" />
              <div className="acquired-card__stats">
                <span><small>こうげき</small><Swords count={statCount(monster.attack)} /></span>
                <span><small>HP</small><Hearts current={statCount(monster.hp)} max={statCount(monster.hp)} /></span>
              </div>
            </div>
          )}
        </div>
        <div className="thanks-card__side">
          <p className="acquisition-kicker">✦ SPECIAL MONSTER CARD ✦</p>
          <h1>きみだけのモンスターを<br /><span>ゲット！</span></h1>
          <p className="thanks-message">あそんでくれて ありがとう！<br />スタッフから カードを うけとってね！</p>
        </div>
      </section>
      <Deck knobs={{ center: { label: 'タイトルへ もどる', onClick: onTitle, call: true } }} />
    </main>
  );
}
