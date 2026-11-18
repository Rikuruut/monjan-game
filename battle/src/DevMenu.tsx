import { useEffect, useState, type ReactNode } from 'react';
import type { AppScreen } from './App';
import { ELEMENTS } from './attributes';
import type { CardDemoKind, CardDevCommand, ForcedResult } from './card/cardDev';
import type { GameData } from './data/loadGameData';
import { battleUrlFor, DEV_PAGES, loadRecentMonsters, type Autoplay, type RecentMonster } from './devTools';
import { navigateTo } from './integration';

// 開発者メニュー(D キー・⚙)。タブで分ける。見た目と「よく使う」のタブは、撮影・合体の画面のメニューと同じ。
// 画面・演出・操作のボタンは 押すと メニューが閉じ、画面いっぱいで見られる。演出は 画面の左下の「▶ もう一度」で くり返せる

export type DevJump = 'title' | 'pack' | 'battle' | 'result-win' | 'result-lose' | 'card';

type DevTab = 'common' | 'screens' | 'fx' | 'control' | 'data';

const TABS: { tab: DevTab; label: string }[] = [
  { tab: 'common', label: 'よく使う' },
  { tab: 'screens', label: '画面へとぶ' },
  { tab: 'fx', label: '演出を見る' },
  { tab: 'control', label: 'バトルを操作' },
  { tab: 'data', label: 'データ' },
];

const ROUNDS: { round: number; label: string }[] = [
  { round: 1, label: '練習' },
  { round: 2, label: '2体目' },
  { round: 3, label: 'ボス' },
];

const JUMPS: { target: DevJump; icon: string; label: string; note: string }[] = [
  { target: 'title', icon: '🏠', label: 'タイトル', note: 'スタート! の画面' },
  { target: 'pack', icon: '🎁', label: 'パック選び', note: 'パックを開けてから戦う' },
  { target: 'battle', icon: '⚔', label: 'バトル', note: 'パックを飛ばして すぐ戦う' },
  { target: 'result-win', icon: '🏆', label: 'リザルト かち', note: '見本の数字' },
  { target: 'result-lose', icon: '💧', label: 'リザルト まけ', note: '見本の数字' },
  { target: 'card', icon: '🃏', label: 'カードゲット', note: '刷るカードと「ゲット!」' },
];

const CARD_DEMOS: { kind: CardDemoKind; icon: string; label: string; note: string }[] = [
  { kind: 'merge', icon: '✨', label: '合体', note: '2枚が重なって ★が上がる' },
  { kind: 'heal', icon: '💚', label: '回復', note: 'HP 4割 → まんたん' },
  { kind: 'seal', icon: '⛓', label: '封じ手', note: '相手の手に鎖' },
  { kind: 'draw3', icon: '🃏', label: '3まい ひく', note: '山札から 3枚 つづけて' },
  { kind: 'reset', icon: '🔄', label: 'いれかえ', note: '手札を すてて 5枚 引きなおす' },
  { kind: 'finisher', icon: '⚡', label: '必殺技', note: 'カットイン → とどめ' },
];

const CLASH_DEMOS: { kind: CardDemoKind; icon: string; label: string; note: string }[] = [
  { kind: 'win', icon: '✊', label: 'かつ', note: 'じゃんけん → 自分の攻撃' },
  { kind: 'lose', icon: '✋', label: 'まける', note: 'じゃんけん → 相手の攻撃' },
  { kind: 'rendan', icon: '👊', label: '連打勝負', note: '同じ手・同じ★' },
  { kind: 'charge', icon: '🔥', label: 'ため技', note: 'ためた相手に負けて 2ばい' },
];

const FORCED: { mode: ForcedResult; label: string }[] = [
  { mode: 'normal', label: 'ふつう' },
  { mode: 'win', label: 'かつ' },
  { mode: 'lose', label: 'まける' },
  { mode: 'tie', label: 'あいこ(連打)' },
];

const ADD_CARDS: { command: CardDevCommand; icon: string; label: string }[] = [
  { command: 'add-finisher', icon: '⚡', label: '必殺技' },
  { command: 'add-heal', icon: '💚', label: '回復' },
  { command: 'add-seal', icon: '⛓', label: '封じ手' },
  { command: 'add-draw3', icon: '🃏', label: '3まい ひく' },
  { command: 'add-reset', icon: '🔄', label: 'いれかえ' },
  { command: 'add-pair', icon: '✨', label: '合体ペア' },
];

const HP_COMMANDS: { command: CardDevCommand; label: string }[] = [
  { command: 'player-pinch', label: '自分の HP を3割に' },
  { command: 'cpu-half', label: '相手の HP を半分に' },
  { command: 'cpu-one', label: '相手の HP を1に' },
  { command: 'cpu-charge', label: '相手に ため技を予告させる' },
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

/** アイコン + 名前 + 1行の説明 のボタン(3列に並ぶ) */
function Tile({ icon, label, note, onClick }: { icon: string; label: string; note?: string; onClick: () => void }) {
  return (
    <button type="button" className="dev-tile" onClick={onClick} title={note}>
      <span className="dev-tile__icon" aria-hidden="true">{icon}</span>
      <strong>{label}</strong>
      {note && <small>{note}</small>}
    </button>
  );
}

/** どの相手と戦うか(画面へとぶ・演出を見る で共通) */
function RoundPicker({ round, onChange }: { round: number; onChange: (round: number) => void }) {
  return (
    <p className="dev-segment" role="radiogroup" aria-label="相手">
      <span className="dev-segment__label">相手</span>
      {ROUNDS.map((item) => (
        <button
          type="button"
          role="radio"
          key={item.round}
          aria-checked={round === item.round}
          onClick={() => onChange(item.round)}
        >
          {item.label}
        </button>
      ))}
    </p>
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

// 最後に流した演出(画面の左下の「▶ もう一度」で くり返す)
interface LastDemo {
  label: string;
  replay: () => void;
}

export function DevMenu({
  open,
  data,
  screen,
  round: currentRound,
  autoplay,
  forced,
  onClose,
  onToggle,
  onJump,
  onDemo,
  onCommand,
  onForced,
  onAutoplay,
}: {
  open: boolean;
  data: GameData;
  screen: AppScreen;
  /** いま戦っている相手(1 = 練習・2 = 2体目・3 = ボス) */
  round: number;
  autoplay: Autoplay;
  forced: ForcedResult;
  onClose: () => void;
  onToggle: () => void;
  onJump: (target: DevJump, round: number) => void;
  onDemo: (kind: CardDemoKind, round: number, attribute?: string | null) => void;
  onCommand: (command: CardDevCommand) => void;
  onForced: (mode: ForcedResult) => void;
  onAutoplay: (on: boolean) => void;
}) {
  const [tab, setTab] = useState<DevTab>(readTab);
  const [round, setRound] = useState(currentRound);
  const [fxFrom, setFxFrom] = useState<'win' | 'lose'>('win');
  const [lastDemo, setLastDemo] = useState<LastDemo | null>(null);
  const selectTab = (next: DevTab) => {
    setTab(next);
    writeTab(next);
  };
  const demo = (label: string, kind: CardDemoKind, attribute: string | null = null) => {
    const replay = () => onDemo(kind, round, attribute);
    setLastDemo({ label, replay });
    replay();
  };
  const inBattle = screen === 'battle';

  return (
    <>
      {autoplay.on && <p className="dev-autoplay-badge">自動プレイ中 {autoplay.loops}周(D でメニュー → 停止)</p>}
      {/* 演出を くり返して見る(メニューを閉じているときだけ。バトルの画面を出ていたら消す) */}
      {!open && lastDemo && inBattle && (
        <p className="dev-replay" role="group" aria-label="演出をもう一度">
          <button type="button" className="dev-replay__go" onClick={lastDemo.replay}>▶ もう一度:{lastDemo.label}</button>
          <button type="button" className="dev-replay__close" aria-label="消す" onClick={() => setLastDemo(null)}>×</button>
        </p>
      )}
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
                  desc="タイトル → テストプレイ → カードバトル(ボタンはランダム)→ リザルト → カードゲット → タイトル を、止めるまでくり返します。展示前の耐久テスト用。メニューを開いているあいだは止まります。"
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
              <Section title="画面へとぶ" free desc="いまのモンスターのまま、その画面を出します。バトルは えらんだ相手と はじめから。">
                <RoundPicker round={round} onChange={setRound} />
                <div className="dev-grid">
                  {JUMPS.map((jump) => (
                    <Tile key={jump.target} icon={jump.icon} label={jump.label} note={jump.note} onClick={() => onJump(jump.target, round)} />
                  ))}
                </div>
              </Section>
            )}

            {tab === 'fx' && (
              <>
                <p className="dev-hint">押すと メニューが閉じ、その演出が 最初から最後まで 流れます(手札と 相手のカードは 演出に合わせて用意)。画面の左下の「▶ もう一度」で くり返せます。</p>
                <RoundPicker round={round} onChange={setRound} />
                <Section title="カード" free>
                  <div className="dev-grid dev-grid--4">
                    {CARD_DEMOS.map((item) => (
                      <Tile key={item.kind} icon={item.icon} label={item.label} note={item.note} onClick={() => demo(item.label, item.kind)} />
                    ))}
                  </div>
                </Section>
                <Section title="じゃんけん・攻撃" free>
                  <div className="dev-grid dev-grid--4">
                    {CLASH_DEMOS.map((item) => (
                      <Tile key={item.kind} icon={item.icon} label={item.label} note={item.note} onClick={() => demo(item.label, item.kind)} />
                    ))}
                  </div>
                </Section>
                <Section title="攻撃のタイプ" free desc="えらんだタイプで じゃんけん → 攻撃 → 命中 を流します(両方のモンスターを そのタイプにする)。">
                  <p className="dev-segment" role="radiogroup" aria-label="攻撃の向き">
                    <span className="dev-segment__label">向き</span>
                    <button type="button" role="radio" aria-checked={fxFrom === 'win'} onClick={() => setFxFrom('win')}>自分 → 相手</button>
                    <button type="button" role="radio" aria-checked={fxFrom === 'lose'} onClick={() => setFxFrom('lose')}>相手 → 自分</button>
                  </p>
                  <p className="dev-row">
                    {ELEMENTS.map((element) => (
                      <button
                        type="button"
                        key={element.attribute}
                        className={`dev-fx el-${element.theme}`}
                        title={`${element.attribute}タイプの攻撃`}
                        onClick={() => demo(`${element.attribute}タイプの攻撃`, fxFrom, element.attribute)}
                      >
                        {element.attribute}
                      </button>
                    ))}
                  </p>
                </Section>
                <Section title="パック" free>
                  <div className="dev-grid">
                    <Tile icon="🎁" label="パック開封" note="えらぶ → 破れる → めくる" onClick={() => onJump('pack', round)} />
                  </div>
                </Section>
              </>
            )}

            {tab === 'control' && (
              <>
                {!inBattle && <p className="dev-hint dev-hint--warn">いまは バトルの画面では ありません。「画面へとぶ」で バトルを開いてから 使います。</p>}
                <Section title="勝ち負けを決める" free desc="これから出す じゃんけんカードの結果を決めます(相手の ふせたカードを その手に差しかえる)。ふつう に もどすまで 続きます。">
                  <p className="dev-segment" role="radiogroup" aria-label="これからの勝負">
                    {FORCED.map((item) => (
                      <button type="button" role="radio" key={item.mode} aria-checked={forced === item.mode} onClick={() => onForced(item.mode)}>
                        {item.label}
                      </button>
                    ))}
                  </p>
                </Section>
                <Section title="手札に足す" free desc="押すと メニューが閉じて 手札に入ります(自分のターンで。ほかの場面なら 次の自分のターンに入る)。手札の上限(5枚)は こえます。">
                  <div className="dev-grid dev-grid--4">
                    {ADD_CARDS.map((item) => (
                      <Tile key={item.command} icon={item.icon} label={item.label} onClick={() => onCommand(item.command)} />
                    ))}
                  </div>
                </Section>
                <Section title="HP・ため技" free desc="相手の HP を半分にすると、ボスは 次のドローで必殺技が来ます。ため技は 次のターンに ためます。">
                  <p className="dev-row">
                    {HP_COMMANDS.map((item) => (
                      <button type="button" key={item.command} onClick={() => onCommand(item.command)}>{item.label}</button>
                    ))}
                  </p>
                </Section>
              </>
            )}

            {tab === 'data' && (
              <Section title="モンスターの中身" desc="バトルが読みこんだ JSON(battle/docs/DATA_SPEC.md の形)。">
                <p className="dev-json-title">自分:{data.player.name}</p>
                <pre>{JSON.stringify(data.player, null, 2)}</pre>
                <p className="dev-json-title">相手:{data.cpu.name}</p>
                <pre>{JSON.stringify(data.cpu, null, 2)}</pre>
                <p className="dev-json-title">練習の相手:{data.practiceCpu.name}</p>
                <pre>{JSON.stringify(data.practiceCpu, null, 2)}</pre>
              </Section>
            )}
          </div>
        </aside>
      )}
    </>
  );
}
