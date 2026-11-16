import { HandIcon } from '../components/HandIcon';
import { PRACTICE_COACH_PAGE_MS } from '../timings';

// 練習ラウンドの はじめの説明のページ数(ページを足したら、下の PAGES にも足す)
export const PRACTICE_INTRO_PAGES = 2;

// 説明の各ページ。言葉は「📖 ルール」(Tutorial.tsx)とそろえる
function IntroPage({ page }: { page: number }) {
  if (page === 0) {
    return (
      <>
        <p className="coach-title">れんしゅうだよ！</p>
        <p>グー・チョキ・パーから <strong>1つ えらぼう！</strong></p>
        <div className="coach-figure coach-figure--hands" aria-hidden="true">
          <span><HandIcon hand="rock" alt="" /><b>◀</b></span>
          <span><HandIcon hand="scissors" alt="" /><b>●</b></span>
          <span><HandIcon hand="paper" alt="" /><b>▶</b></span>
        </div>
        <p className="coach-sub">◀ ● ▶ の ボタンで えらぶよ</p>
      </>
    );
  }
  return (
    <>
      <p className="coach-title">あいこなら れんだ しょうぶ！</p>
      <p>同じ手が出たら<br /><strong>ボタンを たくさん おした方の かち！</strong></p>
      <div className="coach-figure coach-figure--mash" aria-hidden="true">
        <span className="coach-tie"><HandIcon hand="rock" alt="" /><i>＝</i><HandIcon hand="rock" alt="" /></span>
        <i className="coach-arrow">→</i>
        <span className="coach-mash"><b>◀ ● ▶</b><small>どれでも れんだ！</small></span>
      </div>
      <p className="coach-sub">おなじ かずなら おたがいの♡が 1つ へるよ</p>
    </>
  );
}

/**
 * 練習ラウンドの はじめの説明。ページは App が時間で進める(1ページ PRACTICE_COACH_PAGE_MS)。
 * 下のバーが のこり時間。見た目は battle.css の .coach
 */
export function PracticeIntro({ page }: { page: number }) {
  return (
    <>
      <div className="coach-veil" aria-hidden="true" />
      <aside className="coach coach--intro" aria-live="polite">
        <div className="coach-page" key={page}>
          <IntroPage page={page} />
        </div>
        <div className="coach-foot">
          <div className="coach-dots" aria-label={`せつめい ${page + 1} / ${PRACTICE_INTRO_PAGES}`}>
            {Array.from({ length: PRACTICE_INTRO_PAGES }, (_, index) => (
              <span key={index} className={index === page ? 'is-current' : index < page ? 'is-done' : ''} />
            ))}
          </div>
          <div className="coach-timer" role="progressbar" aria-label="のこり時間">
            <span key={page} style={{ animationDuration: `${PRACTICE_COACH_PAGE_MS}ms` }} />
          </div>
        </div>
      </aside>
    </>
  );
}
