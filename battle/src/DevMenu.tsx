import { useEffect, useState, type ReactNode } from 'react';
import { sendCardDev } from './card/cardDev';
import { ELEMENTS } from './attributes';
import { battleUrlFor, DEV_PAGES, loadRecentMonsters, type Autoplay, type RecentMonster } from './devTools';
import type { GameData } from './data/loadGameData';
import type { ForcedResult } from './game/logic';
import { navigateTo } from './integration';

// 開発者メニュー(D キー・⚙)。タブで分ける。見た目と「よく使う」のタブは、撮影・合体の画面のメニューと同じ

// 攻撃エフェクトを見るときの向き(自分→相手 / 相手→自分 / あいこ)
export type FxDirection = 'player' | 'cpu' | 'tie';

const FX_DIRECTIONS: { direction: FxDirection; label: string }[] = [
  { direction: 'player', label: '自分→相手' },
  { direction: 'cpu', label: '相手→自分' },
  { direction: 'tie', label: 'あいこ(双方)' },
];

export type DevJump = 'title' | 'rules' | 'practice-clear' | 'battle' | 'victory' | 'defeat' | 'draw' | 'thanks';

const JUMPS: { target: DevJump; label: string; title: string }[] = [
  { target: 'title', label: 'タイトル', title: 'スタート! の画面' },
  { target: 'rules', label: 'れんしゅう', title: '練習ラウンド(必ず勝つ)' },
  { target: 'practice-clear', label: 'れんしゅうクリア', title: '練習のあと、本番の前の画面' },
  { target: 'battle', label: 'バトル', title: '本番のじゃんけん(召喚から)' },
  { target: 'victory', label: 'かち', title: '勝ちの結果' },
  { target: 'defeat', label: 'まけ', title: '負けの結果' },
  { target: 'draw', label: 'ひきわけ', title: '引き分けの結果' },
  { target: 'thanks', label: 'ありがとう', title: '最後のカードを渡す画面' },
];

const FORCED: { mode: ForcedResult; label: string }[] = [
  { mode: 'normal', label: 'ふつう(ランダム)' },
  { mode: 'win', label: 'かつ' },
  { mode: 'lose', label: 'まける' },
  { mode: 'tie', label: 'あいこ(連打勝負)' },
];

type DevTab = 'common' | 'screens' | 'card' | 'fx' | 'data';

const TABS: { tab: DevTab; label: string }[] = [
  { tab: 'common', label: 'よく使う' },
  { tab: 'screens', label: '画面・勝ち負け' },
  { tab: 'card', label: 'カードバトル' },
  { tab: 'fx', label: '攻撃エフェクト' },
  { tab: 'data', label: 'データ' },
];

// 最後に開いたタブを覚えておく(読めなければ「よく使う」)
const TAB_KEY = 'monjan-dev-tab-battle';

function readTab(): DevTab {
  try {
    const saved = window.localStorage.getItem(TAB_KEY);
    return TABS.some((item) => item.tab === saved) ? (saved as DevTab) : 'common';
  } catch {
    return 'common';
  }
}

function writeTab(tab: DevTab) {
  try {
    window.localStorage.setItem(TAB_KEY, tab);
  } catch {
    // 覚えられなくても動く
  }
}

function Section({ title, free, desc, children }: { title: string; free?: boolean; desc?: string; children: ReactNode }) {
  return (
    <section>
      <h4>
        {title}
        {free && <span className="dev-badge dev-free">無料</span>}
      </h4>
      {desc && <p className="dev-desc">{desc}</p>}
      {children}
    </section>
  );
}

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
          <button type="button" title="このモンスターでバトルへ" onClick={() => navigateTo(battleUrlFor(monster.id))}>
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
  onPreviewFx,
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
  onPreviewFx: (attributes: string[], direction: FxDirection) => void;
}) {
  const [fxDirection, setFxDirection] = useState<FxDirection>('player');
  const [tab, setTab] = useState<DevTab>(readTab);
  const selectTab = (next: DevTab) => {
    setTab(next);
    writeTab(next);
  };

  return (
    <>
      {autoplay.on && <p className="dev-autoplay-badge">自動プレイ中 {autoplay.loops}周(D でメニュー → 停止)</p>}
      <button type="button" className="dev-toggle" title="開発者メニュー(D キー)" aria-label="開発者メニュー" onClick={onToggle}>⚙</button>
      {open && (
        <aside className="dev" aria-label="開発者メニュー">
          <div className="dev-top">
            <header className="dev-head">
              <strong>開発者メニュー <small>バトル</small></strong>
              <button type="button" className="dev-close" aria-label="とじる" title="とじる(D キー)" onClick={onClose}>×</button>
            </header>
            <nav className="dev-tabs" role="tablist" aria-label="開発者メニューのタブ">
              {TABS.map((item) => (
                <button
                  type="button"
                  role="tab"
                  key={item.tab}
                  aria-selected={tab === item.tab}
                  onClick={() => selectTab(item.tab)}
                >
                  {item.label}
                </button>
              ))}
            </nav>
          </div>

          <div className="dev-panel" role="tabpanel" aria-label={TABS.find((item) => item.tab === tab)?.label}>
            {tab === 'common' && (
              <>
                <Section title="ページを開く" free desc="そのページへ移ります。">
                  <p className="dev-row">
                    {DEV_PAGES.map((page) => (
                      <button type="button" className="dev-link" key={page.label} onClick={() => navigateTo(page.url)}>{page.label}</button>
                    ))}
                  </p>
                </Section>
                <Section
                  title="通しの自動プレイ"
                  free
                  desc="タイトル → テストプレイ → バトル(手はランダム)→ 結果 → タイトル を、止めるまでくり返します。展示前の耐久テスト用。メニューを開いているあいだは止まります。"
                >
                  <p className="dev-row">
                    {autoplay.on
                      ? <button type="button" onClick={() => onAutoplay(false)}>■ 停止</button>
                      : <button type="button" className="dev-primary" onClick={() => onAutoplay(true)}>▶ 開始</button>}
                    <span className="dev-state">{autoplay.on ? `動いています(${autoplay.loops}周)` : '止まっています'}</span>
                  </p>
                </Section>
                <Section title="作ったモンスターで戦う" desc="outputs/ の新しい順に30件。押すとそのモンスターでバトルへ。">
                  <RecentMonsters />
                </Section>
              </>
            )}

            {tab === 'screens' && (
              <>
                <Section title="画面へとぶ" desc="いまのモンスターのまま、その画面を出します。">
                  <p className="dev-row">
                    {JUMPS.map((jump) => (
                      <button type="button" key={jump.target} title={jump.title} onClick={() => onJump(jump.target)}>{jump.label}</button>
                    ))}
                  </p>
                </Section>
                <Section title="勝ち負けを決める" desc="これからのじゃんけんで、CPU が出す手を決めます。「あいこ」にすると連打勝負になります。">
                  <p className="dev-row" role="radiogroup" aria-label="これからの勝負">
                    {FORCED.map((item) => (
                      <label key={item.mode}>
                        <input type="radio" name="dev-forced" checked={forced === item.mode} onChange={() => onForced(item.mode)} />
                        {item.label}
                      </label>
                    ))}
                  </p>
                </Section>
                <Section title="♡を1にする" desc="相手を1にすると、じゃんけんで勝ったときに必殺技が出ます。">
                  <p className="dev-row">
                    <button type="button" onClick={() => onLowHp('player')}>自分の♡を1に</button>
                    <button type="button" onClick={() => onLowHp('cpu')}>相手の♡を1に</button>
                  </p>
                </Section>
              </>
            )}

            {tab === 'card' && (
              <>
                <Section title="カードを手札に足す" free desc="カードバトル(/battle/?card=1・「たたかう!」から)の 自分のターン(手札をえらぶとき)に押します。手札の上限(5枚)は こえます。">
                  <p className="dev-row">
                    <button type="button" className="dev-primary" onClick={() => sendCardDev('add-finisher')}>⚡ 必殺技を手札に足す</button>
                    <button type="button" onClick={() => sendCardDev('add-heal')}>回復を足す</button>
                    <button type="button" onClick={() => sendCardDev('add-seal')}>封じ手を足す</button>
                  </p>
                </Section>
                <Section title="HP・ため技" free desc="自分の HP を3割にすると ピンチの点滅。相手の HP を半分にすると、ボス(&round=3)は 次のドローで必殺技が来ます。ため技は 次のターンに ためます。">
                  <p className="dev-row">
                    <button type="button" onClick={() => sendCardDev('player-pinch')}>自分の HP を3割に</button>
                    <button type="button" onClick={() => sendCardDev('cpu-half')}>相手の HP を半分に</button>
                    <button type="button" onClick={() => sendCardDev('cpu-charge')}>ため技を予告させる</button>
                  </p>
                </Section>
              </>
            )}

            {tab === 'fx' && (
              <Section title="攻撃エフェクトを見る" desc="タイプごとの 攻撃 → 命中(飛び道具・光の輪・粒・音)を流します。HP は変わりません。">
                <p className="dev-row" role="radiogroup" aria-label="攻撃の向き">
                  {FX_DIRECTIONS.map((item) => (
                    <label key={item.direction}>
                      <input type="radio" name="dev-fx-direction" checked={fxDirection === item.direction} onChange={() => setFxDirection(item.direction)} />
                      {item.label}
                    </label>
                  ))}
                </p>
                <p className="dev-row">
                  {ELEMENTS.map((element) => (
                    <button
                      type="button"
                      key={element.attribute}
                      className={`dev-fx el-${element.theme}`}
                      title={`${element.attribute}タイプの攻撃`}
                      onClick={() => onPreviewFx([element.attribute], fxDirection)}
                    >
                      {element.attribute}
                    </button>
                  ))}
                </p>
                <p className="dev-row">
                  <button type="button" onClick={() => onPreviewFx(ELEMENTS.map((element) => element.attribute), fxDirection)}>8つ順番に</button>
                </p>
              </Section>
            )}

            {tab === 'data' && (
              <Section title="モンスターの中身" desc="バトルが読みこんだ JSON(battle/docs/DATA_SPEC.md の形)。">
                <p className="dev-json-title">自分:{data.player.name}</p>
                <pre>{JSON.stringify(data.player, null, 2)}</pre>
                <p className="dev-json-title">相手:{data.cpu.name}</p>
                <pre>{JSON.stringify(data.cpu, null, 2)}</pre>
              </Section>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
