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
  if (mergePick !== null) return '◀ ▶ で えらんで ● で がったい';
  const item = items[cursor];
  if (item?.kind === 'card' && skillBlockedReason(state, item.card)) return 'この カードは いま つかえないよ';
  if (!armed) return '◀ ▶ で えらんで ● で けってい';
  if (item?.kind === 'merge') return '● を もういちど おすと がったい するよ！';
  if (item?.kind === 'card' && item.card.kind === 'skill') return '● を もういちど おすと つかうよ！';
  return '● を もういちど おすと だすよ！';
}

/** 手札のゾーン(うしろを少し暗くして囲む)と、その上のふちの 案内の1行 */
export function HandZone({ battle }: { battle: CardBattleApi }) {
  const guide = handGuide(battle);
  return (
    <div className={`cb-hand-zone${battle.armed && battle.view === 'player' ? ' cb-hand-zone--armed' : ''}`} aria-hidden={guide ? undefined : true}>
      {/* key で出しなおして、文言が変わるたびに はねて出る */}
      {guide && <p key={guide} className="cb-guide" role="status" aria-live="polite" data-testid="hand-guide">{guide}</p>}
    </div>
  );
}
