import { HAND_META } from './components/HandIcon';
import type { GameData } from './data/loadGameData';
import { assetUrl } from './integration';

// バトルで使う大きな絵を、先に読んで展開しておく(召喚・じゃんけん・背景が出た瞬間に、読みこみで止まらないように)。
// ゲームの進み方は待たない(読めなくても、出たときに読むだけ)
const BATTLE_BACKGROUND = assetUrl('/backgrounds/fantasy-meadow-battle.png');

export function preloadImages(urls: string[]) {
  if (typeof Image === 'undefined') return;
  urls.forEach((url) => {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    // decode のない環境(テストの jsdom など)では、読みこみだけ
    if (typeof img.decode === 'function') img.decode().catch(() => {});
  });
}

/** データが読めたら呼ぶ:自分・本番の相手・練習の相手・じゃんけんの手・バトルの背景 */
export function preloadBattleImages(data: GameData) {
  const monsters = [data.player.image, data.cpu.image, data.practiceCpu.image];
  const hands = Object.values(HAND_META).map((meta) => meta.image);
  preloadImages([...new Set([...monsters, ...hands, BATTLE_BACKGROUND])]);
}
