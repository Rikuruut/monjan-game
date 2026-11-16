import { assetUrl } from '../integration';

export const GAME_BGM_PATH = assetUrl('/audio/adorable.mp3');
export const GAME_BGM_VOLUME = 0.12;

let gameBgm: HTMLAudioElement | null = null;
let bgmVolume = 0.55;
let bgmMuted = false;

function getGameBgm(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null;
  if (!gameBgm) {
    gameBgm = new Audio(GAME_BGM_PATH);
    gameBgm.loop = true;
    gameBgm.preload = 'auto';
    gameBgm.volume = GAME_BGM_VOLUME * bgmVolume;
    gameBgm.muted = bgmMuted;
    gameBgm.addEventListener?.('error', () => {
      console.error(`[モンじゃん！] BGMを読み込めませんでした: ${GAME_BGM_PATH}`, gameBgm?.error);
    });
  }
  return gameBgm;
}

export async function startGameBgm(): Promise<void> {
  const bgm = getGameBgm();
  if (!bgm || !bgm.paused) return;

  try {
    await bgm.play();
  } catch (error) {
    // ブラウザが自動再生を止めた場合は、次のユーザー操作で再試行する。
    console.warn('[モンじゃん！] BGM再生が保留されました。次のユーザー操作で再試行します。', error);
  }
}

export function pauseGameBgm() {
  gameBgm?.pause();
}

export function setGameBgmVolume(value: number) {
  bgmVolume = Math.min(1, Math.max(0, value));
  if (gameBgm) gameBgm.volume = GAME_BGM_VOLUME * bgmVolume;
}

export function setGameBgmMuted(value: boolean) {
  bgmMuted = value;
  if (gameBgm) gameBgm.muted = value;
}

export function stopGameBgm() {
  if (!gameBgm) return;
  gameBgm.pause();
  gameBgm.currentTime = 0;
}

export function disposeGameBgm() {
  if (!gameBgm) return;
  gameBgm.pause();
  gameBgm.removeAttribute('src');
  gameBgm.load();
  gameBgm = null;
}
