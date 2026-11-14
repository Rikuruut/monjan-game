import { cx } from '../cx';
import type { CardFace } from '../game/cards';
import { cardDamage, healAmount } from '../game/engine';
import { cardLabel, CardView } from './CardView';
import { skillBlockedReason, type CardBattleApi } from './useCardBattle';

// 説明パネル(真ん中の列の下。手札の浮いたカードと重ならない高さに固定。見た目は cardbattle.css の .cb-info)。
// カーソルのあるものの 名前(見出しの字)・効果(説明の字)を いつも出す。決定の1回目は色を変える。
// どのボタンを押せばいいか(action)は 手札の上の 案内の1行(HandGuide.tsx)が出すので、ここには出さない

type Tone = 'normal' | 'armed' | 'blocked' | 'special';

export interface CardInfo {
  /** 左に出す見本のカード(「がったい!」の枠は 'merge') */
  card?: CardFace | 'merge';
  title: string;
  /** 効果(1〜2行) */
  lines: string[];
  /** 操作の案内 */
  action: string;
  tone: Tone;
}

const ACTION_PICK = '● で えらぶ';
const ACTION_ARMED = '● もういちど で けってい ◀▶ やめる';

// 見出しの字の大きさ:パネルの文字の幅(約 270px)に1行で収まる大きさ(上限 28px)
function titleSize(text: string): number {
  return Math.min(28, Math.floor(270 / Math.max(1, [...text].length)));
}

/** 説明パネルの中身(出さないときは null) */
export function cardInfo(battle: CardBattleApi): CardInfo | null {
  const { state, view, items, cursor, armed, mergePick, drawn } = battle;
  if (view === 'draw') {
    if (drawn?.kind === 'finisher') {
      return { card: drawn, title: 'ひっさつわざ が きた！', lines: ['どんな 手にも かって', 'あいてを かならず たおす！'], action: '', tone: 'special' };
    }
    return drawn ? { card: drawn, title: `${cardLabel(drawn)} を ひいた！`, lines: [], action: '', tone: 'normal' } : null;
  }
  if (view !== 'player') return null;
  if (mergePick !== null) {
    return { card: 'merge', title: 'どれを がったいする？', lines: [], action: '◀▶ で えらぶ ● で けってい', tone: 'armed' };
  }
  const item = items[cursor];
  if (!item) return null;
  const action = armed ? ACTION_ARMED : ACTION_PICK;
  const tone: Tone = armed ? 'armed' : 'normal';
  if (item.kind === 'merge') {
    return { card: 'merge', title: 'がったい！', lines: ['おなじ カード 2まいで', '★が 1つ ふえる！'], action, tone };
  }
  const { card } = item;
  const blocked = skillBlockedReason(state, card);
  if (blocked) return { card, title: cardLabel(card), lines: [blocked], action: 'いまは つかえない', tone: 'blocked' };
  if (card.kind === 'janken') {
    return { card, title: cardLabel(card), lines: [`かつと ${cardDamage(state.config, card, state.player.attack)} ダメージ！`], action, tone };
  }
  if (card.kind === 'skill' && card.skill === 'heal') {
    return { card, title: 'かいふく', lines: [`HPが ${healAmount(state)} もどる`, '(まんたんに なる)'], action, tone };
  }
  if (card.kind === 'skill') {
    return { card, title: 'ふうじて', lines: ['あいての 手を 1つ ふうじる', 'あいては カードを だしなおす'], action, tone };
  }
  return { card, title: 'ひっさつわざ', lines: ['どんな 手にも かって', 'あいてを かならず たおす！'], action, tone: armed ? 'armed' : 'special' };
}

export function HandInfo({ battle }: { battle: CardBattleApi }) {
  const info = cardInfo(battle);
  const { mergePick, pairs } = battle;
  if (!info) return <div className="cb-info cb-info--empty" aria-hidden="true" />;
  return (
    <aside className={cx('cb-info', `cb-info--${info.tone}`)} data-testid="hand-info" aria-live="polite">
      {info.card && (
        <span className="cb-info__card" aria-hidden="true">
          {info.card === 'merge'
            ? <span className="cb-merge cb-merge--tiny"><span className="cb-merge__icon">✨</span></span>
            : <CardView card={info.card} size="tiny" />}
        </span>
      )}
      <div className="cb-info__text">
        <strong className="cb-info__title" style={{ fontSize: `${titleSize(info.title)}px` }}>{info.title}</strong>
        {mergePick !== null ? (
          <div className="cb-merge-pick" role="listbox" aria-label="がったいする ペア">
            {pairs.map(([card], index) => (
              <span key={card.id} role="option" aria-selected={index === mergePick} className={cx('cb-merge-pick__option', index === mergePick && 'is-current')}>
                {cardLabel(card)} × 2
              </span>
            ))}
            <span
              role="option"
              aria-selected={mergePick === pairs.length}
              className={cx('cb-merge-pick__option', 'cb-merge-pick__option--cancel', mergePick === pairs.length && 'is-current')}
            >
              やめる
            </span>
          </div>
        ) : (
          info.lines.map((line) => <span key={line} className="cb-info__line">{line}</span>)
        )}
      </div>
    </aside>
  );
}
