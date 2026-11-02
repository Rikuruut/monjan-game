import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  disposeGameBgm,
  GAME_BGM_PATH,
  GAME_BGM_VOLUME,
  pauseGameBgm,
  setGameBgmMuted,
  setGameBgmVolume,
  startGameBgm,
  stopGameBgm,
} from './gameBgm';

const audioInstances: FakeAudio[] = [];

class FakeAudio {
  src: string;
  loop = false;
  preload = '';
  volume = 1;
  muted = false;
  paused = true;
  currentTime = 12;
  play = vi.fn(async () => { this.paused = false; });
  pause = vi.fn(() => { this.paused = true; });
  removeAttribute = vi.fn();
  load = vi.fn();

  constructor(src: string) {
    this.src = src;
    audioInstances.push(this);
  }
}

describe('ゲームBGM', () => {
  beforeEach(() => {
    audioInstances.length = 0;
    setGameBgmVolume(0.75);
    setGameBgmMuted(false);
    vi.stubGlobal('Audio', FakeAudio);
  });

  afterEach(() => {
    disposeGameBgm();
    vi.unstubAllGlobals();
  });

  it('指定MP3を調整可能な低音量でループ再生する', async () => {
    await startGameBgm();
    const audio = audioInstances[0];

    expect(audio.src).toBe(GAME_BGM_PATH);
    expect(audio.loop).toBe(true);
    expect(audio.preload).toBe('auto');
    expect(audio.volume).toBeCloseTo(GAME_BGM_VOLUME * 0.75);
    expect(audio.muted).toBe(false);
    expect(audio.play).toHaveBeenCalledTimes(1);
  });

  it('再生中にも音量を変更でき、入力値を0〜1に制限する', async () => {
    await startGameBgm();
    const audio = audioInstances[0];

    setGameBgmVolume(0.4);
    expect(audio.volume).toBeCloseTo(GAME_BGM_VOLUME * 0.4);

    setGameBgmVolume(2);
    expect(audio.volume).toBe(GAME_BGM_VOLUME);

    setGameBgmVolume(-1);
    expect(audio.volume).toBe(0);
  });

  it('生成前後にミュートを切り替え、設定したBGM音量を保持する', async () => {
    setGameBgmMuted(true);
    await startGameBgm();
    const audio = audioInstances[0];

    expect(audio.muted).toBe(true);
    expect(audio.volume).toBeCloseTo(GAME_BGM_VOLUME * 0.75);

    setGameBgmVolume(0.4);
    setGameBgmMuted(false);
    expect(audio.muted).toBe(false);
    expect(audio.volume).toBeCloseTo(GAME_BGM_VOLUME * 0.4);

    setGameBgmMuted(true);
    expect(audio.muted).toBe(true);
    expect(audio.volume).toBeCloseTo(GAME_BGM_VOLUME * 0.4);
  });

  it('破棄後に作り直したBGMにもミュート設定を引き継ぐ', async () => {
    await startGameBgm();
    setGameBgmMuted(true);
    disposeGameBgm();

    await startGameBgm();

    expect(audioInstances).toHaveLength(2);
    expect(audioInstances[1].muted).toBe(true);
  });

  it('OFFでは位置を保って一時停止し、終了時は曲頭へ戻す', async () => {
    await startGameBgm();
    const audio = audioInstances[0];
    audio.currentTime = 24;

    pauseGameBgm();
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.currentTime).toBe(24);

    await startGameBgm();
    expect(audio.play).toHaveBeenCalledTimes(2);

    stopGameBgm();
    expect(audio.currentTime).toBe(0);
  });

  it('ブラウザに再生を拒否されてもゲームを止めない', async () => {
    class BlockedAudio extends FakeAudio {
      override play = vi.fn(async () => { throw new Error('autoplay blocked'); });
    }
    vi.stubGlobal('Audio', BlockedAudio);

    await expect(startGameBgm()).resolves.toBeUndefined();
  });
});
