import { useEffect, useState } from 'react';
import { battleUrlFor, DEV_PAGES, loadRecentMonsters, type Autoplay, type RecentMonster } from './devTools';
import type { GameData } from './data/loadGameData';
import type { ForcedResult } from './game/logic';
import { navigateTo } from './integration';

// 開発者メニュー(D キー・⚙)。見た目と上の3つの項目は、撮影・合体の画面のメニューと同じ

export type DevJump = 'title' | 'rules' | 'battle' | 'victory' | 'defeat' | 'draw' | 'thanks';

const JUMPS: { target: DevJump; label: string }[] = [
  { target: 'title', label: 'タイトル' },
  { target: 'rules', label: 'ルール' },
  { target: 'battle', label: 'バトル' },
  { target: 'victory', label: 'かち' },
  { target: 'defeat', label: 'まけ' },
  { target: 'draw', label: 'ひきわけ' },
  { target: 'thanks', label: 'ありがとう' },
];

const FORCED: { mode: ForcedResult; label: string }[] = [
  { mode: 'normal', label: 'ふつう' },
  { mode: 'win', label: 'かつ' },
  { mode: 'lose', label: 'まける' },
  { mode: 'tie', label: 'あいこ' },
];

function RecentMonsters() {
  const [monsters, setMonsters] = useState<RecentMonster[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    loadRecentMonsters()
      .then((list) => { if (alive) setMonsters(list); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  if (failed) return <p className="dev-muted">サーバー(generator)につないだときだけ使えます。</p>;
  if (!monsters) return <p className="dev-muted">読みこみ中…</p>;
  if (monsters.length === 0) return <p className="dev-muted">まだ ありません(outputs/ が空)。</p>;
  return (
    <ul className="dev-monsters">
      {monsters.map((monster) => (
        <li key={monster.id}>
          <button type="button" onClick={() => navigateTo(battleUrlFor(monster.id))}>
            <img src={monster.image} alt="" width={56} height={56} loading="lazy" />
            <span>
              <strong>{monster.name}</strong>
              <small>{monster.animal} × {monster.object}・{monster.created_at.replace('T', ' ')}</small>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function DevMenu({
  open,
  data,
  autoplay,
  forced,
  onClose,
  onToggle,
  onJump,
  onForced,
  onLowHp,
  onAutoplay,
}: {
  open: boolean;
  data: GameData;
  autoplay: Autoplay;
  forced: ForcedResult;
  onClose: () => void;
  onToggle: () => void;
  onJump: (target: DevJump) => void;
  onForced: (mode: ForcedResult) => void;
  onLowHp: (side: 'player' | 'cpu') => void;
  onAutoplay: (on: boolean) => void;
}) {
  return (
    <>
      {autoplay.on && <p className="dev-autoplay-badge">自動プレイ中 {autoplay.loops}周(D でメニュー → 停止)</p>}
      <button type="button" className="dev-toggle" title="開発者メニュー(D キー)" aria-label="開発者メニュー" onClick={onToggle}>⚙</button>
      {open && (
        <aside className="dev" aria-label="開発者メニュー">
          <header className="dev-head">
            <strong>開発者メニュー</strong>
            <button type="button" className="dev-close" aria-label="とじる" onClick={onClose}>×</button>
          </header>

          <section>
            <h4>ページ</h4>
            <p className="dev-row">
              {DEV_PAGES.map((page) => (
                <button type="button" key={page.label} onClick={() => navigateTo(page.url)}>{page.label}</button>
              ))}
            </p>
          </section>

          <section>
            <h4>通しの自動プレイ</h4>
            <p className="dev-muted">タイトル → テストプレイ → バトル → 結果 → タイトル を、自動でくり返します(API は使いません)。</p>
            <p className="dev-row">
              {autoplay.on
                ? <button type="button" onClick={() => onAutoplay(false)}>■ 停止</button>
                : <button type="button" onClick={() => onAutoplay(true)}><strong>▶ 開始</strong></button>}
              <span>{autoplay.on ? `動いています(${autoplay.loops}周)` : '止まっています'}</span>
            </p>
          </section>

          <section>
            <h4>作ったモンスターで戦う</h4>
            <RecentMonsters />
          </section>

          <section>
            <h4>画面へとぶ</h4>
            <p className="dev-row">
              {JUMPS.map((jump) => (
                <button type="button" key={jump.target} onClick={() => onJump(jump.target)}>{jump.label}</button>
              ))}
            </p>
          </section>

          <section>
            <h4>勝ち負けを決める</h4>
            <p className="dev-row" role="radiogroup" aria-label="これからの勝負">
              {FORCED.map((item) => (
                <label key={item.mode}>
                  <input type="radio" name="dev-forced" checked={forced === item.mode} onChange={() => onForced(item.mode)} />
                  {item.label}
                </label>
              ))}
            </p>
            <p className="dev-row">
              <button type="button" onClick={() => onLowHp('player')}>自分の♡を1に</button>
              <button type="button" onClick={() => onLowHp('cpu')}>相手の♡を1に</button>
            </p>
          </section>

          <section>
            <h4>モンスターの中身</h4>
            <p className="dev-muted">自分</p>
            <pre>{JSON.stringify(data.player, null, 2)}</pre>
            <p className="dev-muted">相手</p>
            <pre>{JSON.stringify(data.cpu, null, 2)}</pre>
          </section>
        </aside>
      )}
    </>
  );
}
