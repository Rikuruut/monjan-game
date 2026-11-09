import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getAttributeTheme } from './attributes';
import { BattleScreen } from './battle/BattleScreen';
import type { BattlePhase, HandWinner, Screen, TutorialMode } from './battle/phases';
import { practiceData, type BattleData } from './battle/practice';
import { statCount } from './components/MonsterCard';
import { SoundControls } from './components/SoundControls';
import { loadGameData, type GameData } from './data/loadGameData';
import { DevMenu, type DevJump, type FxDirection } from './DevMenu';
import { readAutoplay, writeAutoplay, type Autoplay } from './devTools';
import {
  CPU_MASH_MAX,
  cpuHandFor,
  decideMashDuel,
  decideWinner,
  getGameOutcome,
  isFinishChance,
  pickCpuHand,
  pickCpuMash,
  resolveRound,
  type ForcedResult,
} from './game/logic';
import { useGameSound } from './hooks/useGameSound';
import { useTimers } from './hooks/useTimers';
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
import { ResultScreen } from './screens/ResultScreen';
import { ThanksScreen } from './screens/ThanksScreen';
import { TitleScreen } from './screens/TitleScreen';
import { Stage } from './stage';
import {
  ATTACK_DISPLAY_MS,
  AUTOPLAY_HAND_MS,
  AUTOPLAY_MASH_MS,
  AUTOPLAY_RULES_MS,
  AUTOPLAY_TITLE_MS,
  AUTOPLAY_WAIT_MS,
  FX_PREVIEW_LEAD_MS,
  FX_PREVIEW_STEP_MS,
  IMPACT_DISPLAY_MS,
  JANKEN_BEAT_MS,
  MASH_DUEL_MS,
  MASH_RESULT_MS,
  NEXT_ROUND_DISPLAY_MS,
  PRACTICE_SUMMON_SOUND_MS,
  RESULT_DISPLAY_MS,
  REVEAL_DISPLAY_MS,
  SELECTED_DISPLAY_MS,
  SPECIAL_ATTACK_MS,
  SPECIAL_CUTIN_SLAM_MS,
  SPECIAL_DISPLAY_MS,
  SPECIAL_SECOND_IMPACT_MS,
  SUMMON_DISPLAY_MS,
  TIE_SECOND_SOUND_MS,
} from './timings';
import { HANDS, type Hand, type RoundResult, type Winner } from './types';

// バトルの画面の部品は battle/・screens/・components/、時間は timings.ts、タイマーと音は hooks/。
// このファイルは、場面の切りかえと1ラウンドの進み方(状態)を受け持つ
export type { BattlePhase };
export {
  ATTACK_DISPLAY_MS,
  AUTOPLAY_HAND_MS,
  AUTOPLAY_MASH_MS,
  AUTOPLAY_RULES_MS,
  AUTOPLAY_TITLE_MS,
  AUTOPLAY_WAIT_MS,
  FX_PREVIEW_LEAD_MS,
  FX_PREVIEW_STEP_MS,
  IMPACT_DISPLAY_MS,
  JANKEN_BEAT_MS,
  MASH_DUEL_MS,
  MASH_RESULT_MS,
  NEXT_ROUND_DISPLAY_MS,
  RESULT_DISPLAY_MS,
  REVEAL_DISPLAY_MS,
  SELECTED_DISPLAY_MS,
  SPECIAL_ATTACK_MS,
  SPECIAL_DISPLAY_MS,
  SUMMON_DISPLAY_MS,
};

// 会場の3つのボタンと手(左からグー・チョキ・パー。画面のボタンの並びと同じ)
const PAD_ORDER: PadButton[] = ['left', 'center', 'right'];

export function App({ launch = readLaunch() }: { launch?: Launch }) {
  const [data, setData] = useState<GameData | null>(null);
  const [error, setError] = useState('');
  const [screen, setScreen] = useState<Screen>('title');
  const [tutorialMode, setTutorialMode] = useState<TutorialMode | null>(null);
  // 練習ラウンド(最初のスタートのあと、本物のバトル画面で1回だけ。必ず勝つ。♡は本番の前にもどす)
  const [practice, setPractice] = useState(false);
  const [playerHp, setPlayerHp] = useState(0);
  const [cpuHp, setCpuHp] = useState(0);
  const [round, setRound] = useState(1);
  const [playerHand, setPlayerHand] = useState<Hand | null>(null);
  const [cpuHand, setCpuHand] = useState<Hand | null>(null);
  // じゃんけんだけの勝ち負け(同じ手は tie)。result は勝者が決まってから(あいこは連打勝負のあと)
  const [handWinner, setHandWinner] = useState<HandWinner | null>(null);
  const [result, setResult] = useState<RoundResult | null>(null);
  const [phase, setPhase] = useState<BattlePhase>('summon');
  // あいこの連打勝負:自分の回数(数えるのは ref。表示のために state にも入れる)と CPU の回数
  const [mash, setMash] = useState(0);
  const mashRef = useRef(0);
  const [cpuMash, setCpuMash] = useState(0);
  const lockRef = useRef(false);
  const tutorialOpen = tutorialMode !== null;
  const autoStartedRef = useRef(false);
  // 開発者メニュー(D キー・⚙)
  const [devOpen, setDevOpen] = useState(false);
  const [forced, setForced] = useState<ForcedResult>('normal');
  const [autoplay, setAutoplayState] = useState<Autoplay>(() => readAutoplay());
  // 「攻撃エフェクトを見る」で流しているタイプ(そのあいだ、見せるモンスターのタイプを置きかえる)
  const [fxPreview, setFxPreview] = useState<{ attribute: string; direction: FxDirection } | null>(null);
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

  // 撮影・合体の画面の「たたかう!」から来たときは、タイトルを飛ばしてバトル(ルール説明)から始める
  useEffect(() => {
    if (!data || !launch.skipTitle || autoStartedRef.current) return;
    autoStartedRef.current = true;
    startGame();
  }, [data]);

  const { schedule, clearTimers } = useTimers();
  const sound = useGameSound(data !== null);
  const { playSound } = sound;

  // いま戦っている2体(練習は練習用の相手)。描き直しのたびに作り直さない(モンスターの部品が描き直さずに済む)
  const battleData = useMemo<BattleData | null>(
    () => (data && practice ? practiceData(data) : data),
    [data, practice],
  );

  // HP を満タンにして、ラウンドを 1 から数えなおす(バトルの始まり)
  const fillHp = (loaded: GameData) => {
    setPlayerHp(statCount(loaded.player.hp));
    setCpuHp(statCount(loaded.cpu.hp));
    setRound(1);
  };

  const clearHands = () => {
    setPlayerHand(null);
    setCpuHand(null);
    setHandWinner(null);
    setResult(null);
  };

  const resetRound = () => {
    clearHands();
    setPhase('summon');
    lockRef.current = true;
  };

  // 進行中のものを止めて、ルールの見直しを閉じる(場面を移るときの共通の片づけ)
  const stopAll = (nextPractice = false) => {
    clearTimers();
    setTutorialMode(null);
    setPractice(nextPractice);
  };

  // 手を選べるようにする(召喚・次のラウンドのあと)
  const startChoosing = () => {
    clearHands();
    setPhase('choosing');
    lockRef.current = false;
  };

  const prepareNextRound = () => {
    setRound((current) => current + 1);
    setPhase('next-round');
    schedule(startChoosing, NEXT_ROUND_DISPLAY_MS);
  };

  // バトルのはじまり(召喚 → 手をえらぶ)。練習も本番も、ここから一から始める
  const beginBattle = (isPractice: boolean) => {
    if (!data) return;
    stopAll(isPractice);
    fillHp(data);
    if (isPractice) setCpuHp(statCount(practiceData(data).cpu.hp));
    resetRound();
    setScreen('battle');
    sound.playStart();
    schedule(() => playSound('summon'), PRACTICE_SUMMON_SOUND_MS);
    schedule(startChoosing, SUMMON_DISPLAY_MS);
  };

  // 最初のスタート:練習ラウンドから
  const startGame = () => beginBattle(true);

  // 練習のおわり:練習だけで完結する「れんしゅうクリア」の画面へ(本番はそこから一から始める)
  const finishPractice = () => {
    clearTimers();
    setPractice(false);
    setScreen('practice-clear');
    playSound('victory');
  };

  // 「ほんばん スタート!」:本番の相手を召喚するところから
  const startBattle = () => beginBattle(false);

  // タイトルの「スタート!」。展示では撮影・合体の画面へ進む(バトルには「たたかう!」で戻ってくる)
  const pressStart = () => {
    if (!launch.toGenerator) {
      startGame();
      return;
    }
    playSound('start');
    navigateTo(GENERATOR_URL);
  };

  const closeTutorial = () => {
    setTutorialMode(null);
    lockRef.current = false;
  };

  const openRules = () => {
    if (screen !== 'battle' || phase !== 'choosing' || tutorialOpen || practice) return;
    lockRef.current = true;
    setTutorialMode('review');
  };

  // 攻撃の音は、攻撃する側のタイプで鳴らす。あいこは両方から飛ぶので、2つのタイプを少しずらして鳴らす
  const playAttackSound = (winner: Winner, playerAttribute: string, cpuAttribute: string) => {
    if (winner === 'cpu') {
      playSound('attack', { attribute: cpuAttribute });
      return;
    }
    playSound('attack', { attribute: playerAttribute });
    if (winner === 'none') schedule(() => playSound('attack', { attribute: cpuAttribute }), TIE_SECOND_SOUND_MS);
  };

  // 1ラウンド:手を選ぶ → じゃん・けん・ぽん → 手を見せる →(あいこなら連打勝負)→(必殺技)→ 攻撃 → 命中 → 結果
  const chooseHand = (hand: Hand) => {
    if (!data || !battleData || lockRef.current || tutorialOpen || phase !== 'choosing') return;
    lockRef.current = true;
    const { player: playerMonster, cpu: cpuMonster } = battleData;
    // 練習は必ず勝つ。開発者メニューで勝ち負けを決めているときは、その結果になる手にする(あいこは連打勝負になる)
    const mode: ForcedResult = practice ? 'win' : forced;
    const chosenCpuHand = mode === 'normal' ? pickCpuHand() : cpuHandFor(hand, mode);
    const roundHandWinner = decideWinner(hand, chosenCpuHand);
    // とどめのチャンス(ラウンドの前に相手の♡が1)に じゃんけんで勝つと必殺技(とどめの演出)
    const finishChance = !practice && isFinishChance(cpuHp);
    const resolve = (winner: Winner, reason: RoundResult['reason']) => resolveRound({
      winner,
      reason,
      playerAttack: statCount(playerMonster.attack),
      cpuAttack: statCount(cpuMonster.attack),
      playerHp,
      cpuHp,
      finishChance,
    });
    setPlayerHand(hand);
    setCpuHand(chosenCpuHand);
    setHandWinner(roundHandWinner);
    setResult(null);
    setPhase('selected');
    playSound('select');

    const beginAttack = (finalResult: RoundResult) => {
      setPhase('attack');
      playAttackSound(finalResult.winner, playerMonster.attribute, cpuMonster.attribute);

      schedule(() => {
        setPlayerHp(finalResult.playerHp);
        setCpuHp(finalResult.cpuHp);
        setPhase('impact');
        playSound('impact');
        playSound('hp-loss');
        // 必殺技は、命中の音を重ねる
        if (finalResult.special) schedule(() => playSound('impact'), SPECIAL_SECOND_IMPACT_MS);

        schedule(() => {
          setPhase('result');
          // 練習は ここで止まって、吹き出しを読んでもらう(「つぎへ」で「れんしゅうクリア」の画面へ)
          if (practice) return;
          schedule(() => {
            const outcome = getGameOutcome(finalResult.playerHp, finalResult.cpuHp);
            if (outcome === 'ongoing') {
              prepareNextRound();
            } else {
              playSound(outcome);
              setScreen(outcome);
            }
          }, RESULT_DISPLAY_MS);
        }, IMPACT_DISPLAY_MS);
      }, finalResult.special ? SPECIAL_ATTACK_MS : ATTACK_DISPLAY_MS);
    };

    // 勝者が決まったあと:とどめのチャンスに じゃんけんで勝ったなら必殺技のカットインをはさむ
    const decide = (finalResult: RoundResult) => {
      setResult(finalResult);
      if (!finalResult.special) {
        beginAttack(finalResult);
        return;
      }
      setPhase('special');
      playSound('star-showdown');
      schedule(() => playSound('impact'), SPECIAL_CUTIN_SLAM_MS);
      schedule(() => beginAttack(finalResult), SPECIAL_DISPLAY_MS);
    };

    // あいこ:CPU と連打勝負。時間が来たら回数をくらべて、勝った方が攻撃(同じ数なら双方1)
    const beginMashDuel = () => {
      const cpuPresses = pickCpuMash();
      mashRef.current = 0;
      setMash(0);
      // CPU のゲージは、連打の時間をかけて 0 から目標の回数まで CSS のアニメーションで伸びる
      setCpuMash(cpuPresses);
      setPhase('mash-duel');
      playSound('tie');
      schedule(() => {
        const finalResult = resolve(decideMashDuel(mashRef.current, cpuPresses), 'mash');
        setResult(finalResult);
        setPhase('mash-result');
        playSound(finalResult.winner === 'player' ? 'victory' : finalResult.winner === 'cpu' ? 'reveal' : 'tie');
        schedule(() => decide(finalResult), MASH_RESULT_MS);
      }, MASH_DUEL_MS);
    };

    schedule(() => {
      setPhase('janken-jan');
      playSound('janken-jan');

      schedule(() => {
        setPhase('janken-ken');
        playSound('janken-ken');

        schedule(() => {
          setPhase('janken-pon');
          playSound('janken-pon');

          schedule(() => {
            setPhase('reveal');
            playSound('reveal');

            schedule(() => {
              if (roundHandWinner === 'tie') beginMashDuel();
              else decide(resolve(roundHandWinner, 'hand'));
            }, REVEAL_DISPLAY_MS);
          }, JANKEN_BEAT_MS);
        }, JANKEN_BEAT_MS);
      }, JANKEN_BEAT_MS);
    }, SELECTED_DISPLAY_MS);
  };

  // あいこの連打勝負で数える(times は回数。自動プレイは まとめて押したことにする)
  const addMash = (times: number) => {
    mashRef.current += times;
    setMash(mashRef.current);
  };

  // あいこの連打勝負で、1回数える
  const pressMash = () => {
    if (phase !== 'mash-duel') return;
    addMash(1);
    playSound('select');
  };

  const returnToTitle = () => {
    // URL の ?photo= を消す(読みこみ直したときに、前の子のモンスターでバトルが始まらないように)
    if (window.location.search) window.history.replaceState(null, '', BASE_URL);
    stopAll();
    setScreen('title');
    setPlayerHp(0);
    setCpuHp(0);
    resetRound();
  };

  const finishGame = () => {
    playSound('card-get');
    setScreen('thanks');
  };

  // 会場の3つのボタン。手は左からグー・チョキ・パー(画面のボタンの並びと同じ)。
  // 見直しのルール説明のあいだはチュートリアルが受け取る。練習の結果では 中ボタンで「れんしゅうクリア」へ、そこから中ボタンで本番へ
  const pressPad = (button: PadButton) => {
    if (!data) return;
    if (screen === 'title') {
      if (button === 'center') pressStart();
    } else if (screen === 'battle') {
      if (phase === 'mash-duel') {
        pressMash();
      } else if (practice && phase === 'result') {
        if (button === 'center') finishPractice();
      } else if (!tutorialOpen) {
        chooseHand(HANDS[PAD_ORDER.indexOf(button)]);
      }
    } else if (screen === 'practice-clear') {
      if (button === 'center') startBattle();
    } else if (screen === 'thanks') {
      if (button === 'center') returnToTitle();
    } else if (button === 'center') {
      finishGame();
    }
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

  // 開発者メニューの「画面へとぶ」
  const jumpTo = (target: DevJump) => {
    if (!data) return;
    if (target === 'title') {
      returnToTitle();
      return;
    }
    if (target === 'rules') {
      startGame();
      return;
    }
    stopAll();
    if (target === 'battle') {
      fillHp(data);
      setScreen('battle');
      startChoosing();
      return;
    }
    setScreen(target);
  };

  // 開発者メニューの「攻撃エフェクトを見る」:バトル画面で、選んだタイプの 攻撃 → 命中 だけを流す。
  // 本番と同じ部品(飛び道具・光の輪・粒・音)を使う。HP と勝ち負けは変えない
  const showFx = (attribute: string, direction: FxDirection, isLast: boolean) => {
    if (!data) return;
    const winner: Winner = direction === 'tie' ? 'none' : direction;
    setFxPreview({ attribute, direction });
    setPlayerHand('rock');
    setCpuHand(winner === 'player' ? 'scissors' : winner === 'cpu' ? 'paper' : 'rock');
    setHandWinner(winner === 'none' ? 'tie' : winner);
    setResult({
      winner,
      reason: winner === 'none' ? 'mash' : 'hand',
      special: false,
      playerDamage: winner === 'player' ? 0 : 1,
      cpuDamage: winner === 'cpu' ? 0 : 1,
      playerHp: statCount(data.player.hp),
      cpuHp: statCount(data.cpu.hp),
    });
    setPhase('attack');
    playAttackSound(winner, attribute, attribute);
    schedule(() => {
      setPhase('impact');
      playSound('impact');
      schedule(() => {
        setPhase('choosing');
        clearHands();
        setFxPreview(null);
        if (isLast) lockRef.current = false;
      }, IMPACT_DISPLAY_MS);
    }, ATTACK_DISPLAY_MS);
  };

  const previewFx = (attributes: string[], direction: FxDirection) => {
    if (!data) return;
    stopAll();
    setDevOpen(false);
    fillHp(data);
    setScreen('battle');
    setPhase('choosing');
    lockRef.current = true;
    attributes.forEach((attribute, index) => {
      schedule(() => showFx(attribute, direction, index === attributes.length - 1), FX_PREVIEW_LEAD_MS + index * FX_PREVIEW_STEP_MS);
    });
  };

  // 通しの自動プレイ:画面ごとに、少し待ってから会場のボタンを押したのと同じことをする。
  // メニューを開いているあいだは止まる(停止ボタンを押せるように)
  useEffect(() => {
    if (!autoplay.on || !data || devOpen) return;
    let action: (() => void) | null = null;
    let delay = AUTOPLAY_WAIT_MS;
    if (screen === 'title') {
      action = pressStart;
      delay = AUTOPLAY_TITLE_MS;
    } else if (screen === 'battle') {
      if (practice && phase === 'result') {
        action = finishPractice;
        delay = AUTOPLAY_RULES_MS;
      } else if (phase === 'mash-duel') {
        // あいこの連打勝負:勝ったり負けたりする回数を、まとめて押したことにする
        action = () => addMash(Math.floor(Math.random() * (CPU_MASH_MAX + 4)));
        delay = AUTOPLAY_MASH_MS;
      } else if (!tutorialOpen && phase === 'choosing') {
        action = () => chooseHand(HANDS[Math.floor(Math.random() * HANDS.length)]);
        delay = AUTOPLAY_HAND_MS;
      }
    } else if (screen === 'practice-clear') {
      action = startBattle;
      delay = AUTOPLAY_RULES_MS;
    } else if (screen === 'thanks') {
      action = () => {
        setAutoplay({ on: true, loops: autoplay.loops + 1 });
        returnToTitle();
      };
    } else {
      action = finishGame;
    }
    if (!action) return;
    const timer = window.setTimeout(action, delay);
    return () => window.clearTimeout(timer);
  }, [autoplay, data, devOpen, screen, phase, tutorialMode, practice]);

  // 「攻撃エフェクトを見る」のあいだは、攻撃する側(あいこは両方)のタイプを選んだものにする
  const shownData = useMemo<BattleData | null>(() => {
    if (!battleData || !fxPreview) return battleData;
    return {
      player: fxPreview.direction === 'cpu' ? battleData.player : { ...battleData.player, attribute: fxPreview.attribute },
      cpu: fxPreview.direction === 'player' ? battleData.cpu : { ...battleData.cpu, attribute: fxPreview.attribute },
    };
  }, [battleData, fxPreview]);

  if (error) {
    return (
      <Stage>
        <main className="screen error-screen" role="alert">
          <div><span aria-hidden="true">⚠️</span><h1>よみこめませんでした</h1><p>{error}</p><p>スタッフに しらせてね。</p></div>
        </main>
      </Stage>
    );
  }
  if (!data || !shownData) {
    return (
      <Stage>
        <main className="screen loading-screen"><div className="loader" /><p>モンスターを よんでいるよ…</p></main>
      </Stage>
    );
  }

  let content: ReactNode;
  if (screen === 'title') {
    content = <TitleScreen onStart={pressStart} />;
  } else if (screen === 'thanks') {
    content = <ThanksScreen monster={data.player} cardUrl={cardPreviewUrl(launch)} onTitle={returnToTitle} />;
  } else if (screen === 'practice-clear') {
    content = <ResultScreen kind="practice" monster={data.player} onContinue={startBattle} />;
  } else if (screen !== 'battle') {
    content = <ResultScreen kind={screen} monster={data.player} onContinue={finishGame} />;
  } else {
    content = (
      <BattleScreen
        data={shownData}
        fxLabel={fxPreview ? `${fxPreview.attribute}タイプ(${getAttributeTheme(fxPreview.attribute)})` : undefined}
        playerHp={playerHp}
        cpuHp={cpuHp}
        round={round}
        tutorialMode={tutorialMode}
        phase={phase}
        playerHand={playerHand}
        cpuHand={cpuHand}
        result={result}
        practice={practice}
        onCloseTutorial={closeTutorial}
        onOpenRules={openRules}
        onEndPractice={finishPractice}
        onSelect={chooseHand}
        handWinner={handWinner}
        mash={mash}
        cpuMash={cpuMash}
        onMash={pressMash}
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
        autoplay={autoplay}
        forced={forced}
        onClose={() => setDevOpen(false)}
        onToggle={() => setDevOpen((current) => !current)}
        onJump={jumpTo}
        onForced={setForced}
        onLowHp={(side) => (side === 'player' ? setPlayerHp(1) : setCpuHp(1))}
        onAutoplay={(on) => setAutoplay({ on, loops: 0 })}
        onPreviewFx={previewFx}
      />
    </>
  );
}
