import { cx } from '../cx';
import { mergedFace, type CardFace, type JankenCard, type JankenFace } from '../game/cards';
import { cardDamage, healAmount } from '../game/engine';
import { cardLabel, CardView } from './CardView';
import { shownPair, skillBlockedReason, type CardBattleApi } from './useCardBattle';

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
  /** 合体の式([カード] ＋ [カード] → [できあがり])。合体の枠のときだけ */
  equation?: { from: JankenCard; result: JankenFace };
  /** ペアえらびの「いま 何組めか」(1 から。total を こえたら「やめる」) */
  pick?: { current: number; total: number };
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
  // 合体:何と何で 何になるかを 式で見せ、ダメージが どれだけ上がるかを くらべる
  const mergeInfo = (title: string, action: string, tone: Tone, pick?: CardInfo['pick']): CardInfo | null => {
    const pair = shownPair(battle);
    if (!pair) return null;
    const result = mergedFace(pair[0]);
    const before = cardDamage(state.config, pair[0], state.player.attack);
    const after = cardDamage(state.config, { ...pair[0], ...result }, state.player.attack);
    return {
      card: 'merge',
      title,
      lines: [`かつと ${before} → ${after} ダメージ！`],
      action,
      tone,
      equation: { from: pair[0], result },
      pick,
    };
  };
  if (mergePick !== null) {
    if (mergePick >= battle.pairs.length) {
      return { card: 'merge', title: 'がったいを やめる', lines: ['● で てふだに もどる'], action: '', tone: 'armed', pick: { current: mergePick + 1, total: battle.pairs.length } };
    }
    return mergeInfo('どれを がったいする？', '◀▶ で えらぶ ● で けってい', 'armed', { current: mergePick + 1, total: battle.pairs.length });
  }
  const item = items[cursor];
  if (!item) return null;
  const action = armed ? ACTION_ARMED : ACTION_PICK;
  const tone: Tone = armed ? 'armed' : 'normal';
  if (item.kind === 'merge') return mergeInfo('がったい！', action, tone);
  const { card } = item;
  const blocked = skillBlockedReason(state, card);
  if (blocked) return { card, title: cardLabel(card), lines: [blocked], action: 'いまは つかえない', tone: 'blocked' };
  if (card.kind === 'janken') {
    const lines = [`かつと ${cardDamage(state.config, card, state.player.attack)} ダメージ！`];
    // 合体できるカード:左はしの「がったい」で ★を ふやせることを知らせる
    if (battle.pairs.some((pair) => pair.some((paired) => paired.id === card.id))) lines.push('✨ ひだりの がったい で ★アップ！');
    return { card, title: cardLabel(card), lines, action, tone };
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
  if (!info) return <div className="cb-info cb-info--empty" aria-hidden="true" />;
  // 合体:上に 式([カード] ＋ [カード] → [できあがり])、下に 1行(見出しは 式で わかるので 小さく 右上)
  if (info.equation || info.pick) {
    const { equation, pick } = info;
    return (
      <aside className={cx('cb-info', 'cb-info--merge', `cb-info--${info.tone}`)} data-testid="hand-info" aria-live="polite">
        {/* 見出しは 読み上げ用(見た目は 式で わかる)。ペアえらびの「1/2」は 式の右に */}
        <span className="cb-info__merge-title">
          {info.title}
          {pick && ` ${Math.min(pick.current, pick.total)}/${pick.total}`}
        </span>
        <span className="cb-info__equation-row">
          {equation ? (
            <span className="cb-info__equation" role="img" aria-label={`${cardLabel(equation.from)} 2まいで ${cardLabel(equation.result)}`}>
              <CardView card={equation.from} size="tiny" />
              <b aria-hidden="true">＋</b>
              <CardView card={equation.from} size="tiny" />
              <b aria-hidden="true">→</b>
              <CardView card={equation.result} size="tiny" className="cb-info__result" />
            </span>
          ) : (
            <span className="cb-info__equation cb-info__equation--cancel">やめる？</span>
          )}
          {pick && <span className="cb-info__pick" aria-hidden="true">{Math.min(pick.current, pick.total)}/{pick.total}</span>}
        </span>
        <span className="cb-info__line">{info.lines[0]}</span>
      </aside>
    );
  }
  return (
    <aside className={cx('cb-info', `cb-info--${info.tone}`)} data-testid="hand-info" aria-live="polite">
      {info.card && info.card !== 'merge' && (
        <span className="cb-info__card" aria-hidden="true">
          <CardView card={info.card} size="tiny" />
        </span>
      )}
      <div className="cb-info__text">
        <strong className="cb-info__title" style={{ fontSize: `${titleSize(info.title)}px` }}>{info.title}</strong>
        {info.lines.map((line) => <span key={line} className="cb-info__line">{line}</span>)}
      </div>
    </aside>
  );
}
