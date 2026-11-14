import type { GameData } from '../data/loadGameData';
import type { Monster } from '../types';

export type BattleData = Pick<GameData, 'player' | 'cpu'>;

// 練習の対戦:相手は練習用の見本(本番の相手は、本番の召喚まで見せない)。
// 相手の♡は 自分の⚔より多くする(♡が0になって、勝負が終わらないように)
export function practiceData(data: GameData): BattleData {
  const cpu = data.practiceCpu;
  const hp = Math.max(cpu.hp, data.player.attack + 1000) as Monster['hp'];
  return { player: data.player, cpu: hp === cpu.hp ? cpu : { ...cpu, hp } };
}
