import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CardBattleEntry, type CardBattleOutcome } from './card/CardBattle';
import { demoSetup, sendCardDev, type CardDemoKind, type CardDevCommand, type ForcedResult } from './card/cardDev';
import { SoundControls } from './components/SoundControls';
import { loadGameData, type GameData } from './data/loadGameData';
import { DevMenu, type DevJump } from './DevMenu';
import { readAutoplay, writeAutoplay, type Autoplay } from './devTools';
import { useGameSound } from './hooks/useGameSound';
import {
  BASE_URL,
  GENERATOR_URL,
  navigateTo,
  readLaunch,
  cardPreviewUrl,
  usePadButtons,
  type Launch,
  type PadButton,
} from './integration';
import { preloadBattleImages } from './preload';
import { CardResultScreen } from './screens/CardResultScreen';
import { ThanksScreen } from './screens/ThanksScreen';
import { TitleScreen } from './screens/TitleScreen';
import { Stage } from './stage';
import { AUTOPLAY_KEY_MS, AUTOPLAY_TITLE_MS, AUTOPLAY_WAIT_MS } from './timings';

// 画面の切りかえ:タイトル → カードバトル(card/)→ リザルト → カードゲット → タイトル。
// バトルの中の進み方は card/useCardBattle.ts、画面の部品は card/・screens/・components/、時間は timings.ts
// (2026年11月16日に これまでのじゃんけんバトルと入れかえた。前のソースは generator/archive/20261116_before_card_swap/)
export type AppScreen = 'title' | 'battle' | 'result' | 'card';

/** いま戦っている1試合の決めごと。id を変えると バトルを作り直す */
interface BattleRun {
  id: number;
  /** 1 = 練習・2 = 2体目・3 = ボス */
  round: number;
  /** はじめに パック選び・開封 */
  packIntro: boolean;
  /** 開発者メニューの「演出を見る」 */
  demo: CardDemoKind | null;
  /** 演出を見るときに 両方のモンスターのタイプを置きかえる(攻撃の色・音) */
  attribute: string | null;
}

// 自動プレイで押すボタン(決定を多めに。←→で カーソルを動かす)
const AUTOPLAY_KEYS = ['Enter', 'Enter', 'ArrowLeft', 'ArrowRight'] as const;

/** 開発者メニューの「画面へとぶ」で見せる リザルト(見本の数字) */
function sampleOutcome(data: GameData, result: 'win' | 'lose'): CardBattleOutcome {
  return { result, turns: 6, playerHp: result === 'win' ? 42 : 0, playerMaxHp: 100, cpu: data.cpu, finisherUsed: result === 'win' };
}

export function App({ launch: launchProp }: { launch?: Launch }) {
  // 起動したときの URL を 最初の1回だけ読む。タイトルへ もどると URL の ?photo= を消すので、描画のたびに読み直すと
  // そのあと 開発者メニューから始めたバトルで「撮影のモンスターではない」ことになり、刷るカードが出なかった(2026年11月16日)
  const [launch] = useState<Launch>(() => launchProp ?? readLaunch());
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState('');
  // 撮影・合体の画面の「たたかう!」から来たときは、タイトルを飛ばして バトル(パック選び)から
  const [screen, setScreen] = useState<AppScreen>(launch.skipTitle ? 'battle' : 'title');
  const [run, setRun] = useState<BattleRun>({
    id: 0,
    round: launch.cardRound ?? 2,
    packIntro: !launch.cardSkipPack,
    demo: null,
    attribute: null,
  });
  const [outcome, setOutcome] = useState<CardBattleOutcome | null>(null);
  // 開発者メニュー(D キー・⚙)
  const [devOpen, setDevOpen] = useState(false);
  const [forced, setForced] = useState<ForcedResult>('normal');
  const [autoplay, setAutoplayState] = useState<Autoplay>(() => readAutoplay());
  const setAutoplay = (next: Autoplay) => {
    writeAutoplay(next);
    setAutoplayState(next);
  };

  useEffect(() => {
    let alive = true;
    loadGameData(fetch, { photoId: launch.photoId, playerName: launch.playerName })
      .then((loaded) => { if (alive) setData(loaded); })
      .catch((reason: unknown) => {
        if (alive) setError(reason instanceof Error ? reason.message : 'データを読み込めませんでした。');
      });
    return () => { alive = false; };
  }, []);

  // バトルで使う大きな絵を、先に読んでおく(待たない)
  useEffect(() => {
    if (data) preloadBattleImages(data);
  }, [data]);

  const sound = useGameSound(data !== null);
  const { playSound } = sound;

  /** バトルを はじめから(options で 相手・パック・演出を変える) */
  const startBattle = (options: Partial<Omit<BattleRun, 'id'>> = {}) => {
    setRun((current) => ({
      id: current.id + 1,
      round: options.round ?? current.round,
      packIntro: options.packIntro ?? !launch.cardSkipPack,
      demo: options.demo ?? null,
      attribute: options.attribute ?? null,
    }));
    setOutcome(null);
    setScreen('battle');
  };

  // タイトルの「スタート!」。展示では撮影・合体の画面へ進む(バトルには「たたかう!」で戻ってくる)
  const pressStart = () => {
    if (launch.toGenerator) {
      playSound('start');
      navigateTo(GENERATOR_URL);
      return;
    }
    sound.playStart();
    startBattle();
  };

  const returnToTitle = () => {
    // URL の ?photo= を消す(読みこみ直したときに、前の子のモンスターでバトルが始まらないように)
    if (window.location.search) window.history.replaceState(null, '', BASE_URL);
    setOutcome(null);
    setScreen('title');
  };

  const finishBattle = (ended: CardBattleOutcome) => {
    setOutcome(ended);
    setScreen('result');
  };

  const showCardGet = () => {
    playSound('card-get');
    setScreen('card');
  };

  // 会場の3つのボタン。バトルのあいだは カードバトルが自分で受け取る。ほかの画面は 中ボタンで進む
  const pressPad = (button: PadButton) => {
    if (!data || button !== 'center') return;
    if (screen === 'title') pressStart();
    else if (screen === 'result') showCardGet();
    else if (screen === 'card') returnToTitle();
  };
  usePadButtons(pressPad);

  // 開発者メニュー:D キーで開く・閉じる(会場の3つのボタンでは開かない)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key === 'd' || event.key === 'D') && !event.repeat) setDevOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- 開発者メニューから(押したら メニューを閉じて、画面いっぱいで見せる) ----
  const jumpTo = (target: DevJump, round: number) => {
    if (!data) return;
    setDevOpen(false);
    if (target === 'title') returnToTitle();
    else if (target === 'pack') startBattle({ round, packIntro: true });
    else if (target === 'battle') startBattle({ round, packIntro: false });
    else if (target === 'result-win' || target === 'result-lose') {
      setOutcome(sampleOutcome(data, target === 'result-win' ? 'win' : 'lose'));
      setScreen('result');
    } else showCardGet();
  };
  const showDemo = (kind: CardDemoKind, round: number, attribute: string | null = null) => {
    setDevOpen(false);
    startBattle({ round, packIntro: false, demo: kind, attribute });
  };
  const sendCommand = (command: CardDevCommand) => {
    setDevOpen(false);
    sendCardDev(command);
  };

  // 通しの自動プレイ:タイトル → 撮影(撮影側のメニューが続ける)→ バトル → リザルト → カードゲット → タイトル。
  // バトルは 会場のボタンを押したのと同じキーを 少しずつ送る(手は ランダム)。メニューを開いているあいだは止まる
  useEffect(() => {
    if (!autoplay.on || !data || devOpen) return;
    if (screen === 'battle') {
      const timer = window.setInterval(() => {
        const key = AUTOPLAY_KEYS[Math.floor(Math.random() * AUTOPLAY_KEYS.length)];
        window.dispatchEvent(new KeyboardEvent('keydown', { key }));
        window.dispatchEvent(new KeyboardEvent('keyup', { key }));
      }, AUTOPLAY_KEY_MS);
      return () => window.clearInterval(timer);
    }
    const action = screen === 'title'
      ? pressStart
      : screen === 'result'
        ? showCardGet
        : () => {
          setAutoplay({ on: true, loops: autoplay.loops + 1 });
          returnToTitle();
        };
    const timer = window.setTimeout(action, screen === 'title' ? AUTOPLAY_TITLE_MS : AUTOPLAY_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [autoplay, data, devOpen, screen]);

  // 演出を見るときは、両方のモンスターのタイプを選んだものにする(攻撃の色・音)
  const fighters = useMemo(() => {
    if (!data) return null;
    if (!run.attribute) return data;
    return { ...data, player: { ...data.player, attribute: run.attribute }, cpu: { ...data.cpu, attribute: run.attribute } };
  }, [data, run.attribute]);

  if (error) {
    return (
      <Stage>
        <main className="screen error-screen" role="alert">
          <div><span aria-hidden="true">⚠️</span><h1>よみこめませんでした</h1><p>{error}</p><p>スタッフに しらせてね。</p></div>
        </main>
      </Stage>
    );
  }
  if (!data || !fighters) {
    return (
      <Stage>
        <main className="screen loading-screen"><div className="loader" /><p>モンスターを よんでいるよ…</p></main>
      </Stage>
    );
  }

  let content: ReactNode;
  if (screen === 'title') {
    content = <TitleScreen onStart={pressStart} />;
  } else if (screen === 'result' && outcome) {
    content = <CardResultScreen monster={data.player} outcome={outcome} onContinue={showCardGet} />;
  } else if (screen === 'card') {
    // 実際に刷るカード(generator の /card。撮影のモンスターのとき)と「この カードを ゲット！」
    content = <ThanksScreen monster={data.player} cardUrl={cardPreviewUrl(launch)} onTitle={returnToTitle} lead="この カードを" />;
  } else {
    content = (
      <CardBattleEntry
        key={run.id}
        player={fighters.player}
        cpu={fighters.cpu}
        practiceCpu={fighters.practiceCpu}
        round={run.round}
        packIntro={run.packIntro}
        playSound={playSound}
        onFinish={finishBattle}
        demo={run.demo}
        setup={run.demo ? demoSetup(run.demo) : undefined}
        forced={forced}
      />
    );
  }

  return (
    <>
      {/* 開発者メニューは舞台の外(窓の右はしに出す) */}
      <Stage>
        {content}
        <SoundControls
          enabled={sound.soundEnabled}
          bgmVolume={sound.bgmVolume}
          sfxVolume={sound.sfxVolume}
          onToggle={sound.toggleSound}
          onBgmVolumeChange={sound.changeBgmVolume}
          onSfxVolumeChange={sound.changeSfxVolume}
        />
      </Stage>
      <DevMenu
        open={devOpen}
        data={data}
        screen={screen}
        round={run.round}
        autoplay={autoplay}
        forced={forced}
        onClose={() => setDevOpen(false)}
        onToggle={() => setDevOpen((current) => !current)}
        onJump={jumpTo}
        onDemo={showDemo}
        onCommand={sendCommand}
        onForced={setForced}
        onAutoplay={(on) => setAutoplay({ on, loops: 0 })}
      />
    </>
  );
}
