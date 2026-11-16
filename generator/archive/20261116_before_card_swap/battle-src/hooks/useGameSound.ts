import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closeGameAudio,
  playGameSound,
  setSfxMuted,
  setSfxVolume,
  unlockGameAudio,
} from '../audio/gameAudio';
import {
  disposeGameBgm,
  pauseGameBgm,
  setGameBgmMuted,
  setGameBgmVolume,
  startGameBgm,
} from '../audio/gameBgm';

/**
 * 効果音と BGM(音のオン・オフ、音量、最初の操作で音を出せるようにする、画面を閉じたら止める)。
 * `ready` はゲームのデータが読めたか(読めたら BGM を流し始める)
 */
export function useGameSound(ready: boolean) {
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [bgmVolume, setBgmVolume] = useState(0.55);
  const [sfxVolume, setSfxVolumeState] = useState(0.9);
  const enabledRef = useRef(true);

  // 操作する前に始まったときは、ブラウザが音を止めていることがあるので、最初の操作で音を出せるようにする
  // (展示のキオスクは起動の設定で最初から鳴る)
  useEffect(() => {
    const unlock = () => {
      if (!enabledRef.current) return;
      void unlockGameAudio();
      void startGameBgm();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!ready || !enabledRef.current) return;

    // 可能な環境ではタイトル表示から再生する。自動再生が止められた場合も、
    // スタートボタンやミュート解除のユーザー操作で必ず再試行する。
    void startGameBgm();
  }, [ready]);

  useEffect(() => () => {
    closeGameAudio();
    disposeGameBgm();
  }, []);

  // 音を切っていないときだけ効果音を鳴らす
  const playSound = useCallback((...args: Parameters<typeof playGameSound>) => {
    if (enabledRef.current) playGameSound(...args);
  }, []);

  // バトルのはじまりの音(スタートの音と BGM。最初の操作で音を出せるようにもする)
  const playStart = useCallback(() => {
    if (!enabledRef.current) return;
    void unlockGameAudio();
    playGameSound('start');
    void startGameBgm();
  }, []);

  const toggleSound = useCallback(() => {
    const nextEnabled = !enabledRef.current;
    enabledRef.current = nextEnabled;
    setSoundEnabled(nextEnabled);
    setSfxMuted(!nextEnabled);
    setGameBgmMuted(!nextEnabled);
    if (nextEnabled) {
      playGameSound('toggle');
      void startGameBgm();
    } else {
      pauseGameBgm();
    }
  }, []);

  const changeSfxVolume = useCallback((value: number) => {
    setSfxVolumeState(value);
    setSfxVolume(value);
  }, []);

  const changeBgmVolume = useCallback((value: number) => {
    setBgmVolume(value);
    setGameBgmVolume(value);
  }, []);

  return { soundEnabled, bgmVolume, sfxVolume, playSound, playStart, toggleSound, changeSfxVolume, changeBgmVolume };
}
