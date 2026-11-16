import type { CSSProperties } from 'react';
import { HandInfo } from './HandInfo';
import { skillBlockedReason, type CardBattleApi } from './useCardBattle';

// 案内の1行:手札のゾーンの上のふちに、いま やることを大きく1行で出す(見た目は cardbattle.css の .cb-guide)。
// くわしい効果は 説明パネル(HandInfo.tsx)、ここは「どのボタンを押せばいいか」だけ

/** 案内の1行の文言(出さないときは null) */
export function handGuide(battle: CardBattleApi): string | null {
  const { state, view, items, cursor, armed, mergePick } = battle;
  switch (view) {
    case 'cpu-turn':
      return 'あいての ばん… まってね';
    case 'draw':
      return 'カードを 1まい ひいたよ！';
    case 'rendan':
    case 'rendan-result':
      return 'どの ボタンでも れんだ！';
    case 'round-end':
      return '● で もういちど';
    case 'notice':
      return null;
    case 'player':
      break;
    default:
      return 'しょうぶ！';
  }
  if (mergePick !== null) return '◀ ▶ で くみを えらんで ● で がったい';
  const item = items[cursor];
  if (item?.kind === 'card' && skillBlockedReason(state, item.card)) return 'この カードは いま つかえないよ';
  // 新しくペアができたターンの はじめ:合体できることを 知らせる(少しのあいだ)
  if (!armed && battle.mergeHint && item?.kind !== 'merge') return '✨ がったい できるよ！ ひだりはしを みてね';
  if (!armed) return '◀ ▶ で えらんで ● で けってい';
  if (item?.kind === 'merge') return '● もういちど で がったい！ ターンは つづくよ';
  if (item?.kind === 'card' && item.card.kind === 'skill') return '● を もういちど おすと つかうよ！';
  return '● を もういちど おすと だすよ！';
}

/** 手札のゾーン(暗いトレイ)と、その上のふちの1行:左に 説明(HandInfo)、右に 案内。右はしに 山札 */
export function HandZone({ battle }: { battle: CardBattleApi }) {
  const guide = handGuide(battle);
  return (
    <div className={`cb-hand-zone${battle.armed && battle.view === 'player' ? ' cb-hand-zone--armed' : ''}`}>
      <div className="cb-hand-zone__bar">
        <HandInfo battle={battle} />
        {/* key で出しなおして、文言が変わるたびに はねて出る */}
        {guide && <p key={guide} className="cb-guide" role="status" aria-live="polite" data-testid="hand-guide">{guide}</p>}
      </div>
      {/* 山札:裏向きのカードを3枚 少しずらして重ねる。ターンのはじめは ここから1枚 引く(動きは CardBattle.tsx の HandRow)。
          カードは 引くたびに作るので 数は出さない。「ふせたカード」の読み上げと まざらないよう CardView は使わない */}
      <div className="cb-deck" aria-hidden="true">
        <span className="cb-deck__label">やまふだ</span>
        <span className="cb-deck__pile">
          {[0, 1, 2].map((i) => (
            <span key={i} className="cb-deck__card cb-card cb-card--field cb-card--back" style={{ '--i': i } as CSSProperties}>
              <span className="cb-card__back" />
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
