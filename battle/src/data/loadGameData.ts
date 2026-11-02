import { assetUrl, battleMonsterUrl } from '../integration';
import type { Monster } from '../types';

interface GameConfig {
  samplePlayerMonsterId: string;
  sampleCpuMonsterId: string;
  monsters: string[];
}

export interface GameData {
  player: Monster;
  cpu: Monster;
}

type Fetcher = (input: RequestInfo | URL) => Promise<Response>;

export interface LoadOptions {
  /** 生成したモンスターの ID。あればプレイヤーをサーバーから読み、CPU は見本から選ぶ */
  photoId?: string | null;
  /** 見本(テストプレイ)のときの名前。サーバーに渡す */
  playerName?: string | null;
  /** CPU を見本から選ぶ方法(テスト用に差しかえられる) */
  pickIndex?: (length: number) => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseMonster(value: unknown): Monster {
  if (!isRecord(value) || !isRecord(value.source)) {
    throw new Error('モンスターデータの形が正しくありません。');
  }

  const validAttack = [1000, 2000, 3000].includes(value.attack as number);
  const validHp = [1000, 2000, 3000, 4000, 5000].includes(value.hp as number);
  const stringFields = ['id', 'name', 'attribute', 'description', 'image'] as const;
  const sourceIsValid = typeof value.source.animal === 'string' && typeof value.source.object === 'string';
  const stringsAreValid = stringFields.every(
    (field) => typeof value[field] === 'string' && value[field].length > 0,
  );

  if (!stringsAreValid || !sourceIsValid || !validAttack || !validHp || !(value.image as string).startsWith('/')) {
    throw new Error('モンスターデータに不足または不正な値があります。');
  }

  return value as unknown as Monster;
}

function parseConfig(value: unknown): GameConfig {
  if (
    !isRecord(value) ||
    typeof value.samplePlayerMonsterId !== 'string' ||
    typeof value.sampleCpuMonsterId !== 'string' ||
    !Array.isArray(value.monsters) ||
    !value.monsters.every((path) => typeof path === 'string' && path.startsWith('/'))
  ) {
    throw new Error('ゲーム設定データが正しくありません。');
  }
  return value as unknown as GameConfig;
}

async function fetchJson(fetcher: Fetcher, path: string): Promise<unknown> {
  const response = await fetcher(path);
  if (!response.ok) throw new Error(`${path} を読み込めませんでした。`);
  return response.json();
}

// 見本のモンスターの JSON は `/monsters/…` のように書いてあるので、公開する場所(/battle/)を付ける。
// JSON そのものは変えない(AGENTS.md「画像素材・JSONは変更せず」)
function withAssetImage(monster: Monster): Monster {
  return { ...monster, image: assetUrl(monster.image) };
}

export async function loadGameData(fetcher: Fetcher = fetch, options: LoadOptions = {}): Promise<GameData> {
  const config = parseConfig(await fetchJson(fetcher, assetUrl('/data/game-config.json')));
  const monsters = await Promise.all(
    config.monsters.map(async (path) => withAssetImage(parseMonster(await fetchJson(fetcher, assetUrl(path))))),
  );

  if (options.photoId) {
    // 撮影・合体の画面で生まれたモンスター。画像はサーバーの API(/api/monster-image/…)なので、そのまま使う
    const player = parseMonster(await fetchJson(fetcher, battleMonsterUrl(options.photoId, options.playerName)));
    // 相手は見本のモンスターから毎回ランダムに選ぶ(最初に出す相手は仕様で未決定。結合のときに決めた)
    const pickIndex = options.pickIndex ?? ((length: number) => Math.floor(Math.random() * length));
    const cpu = monsters[pickIndex(monsters.length)];
    if (!cpu) throw new Error('対戦に使うモンスターが見つかりません。');
    return { player, cpu };
  }

  const player = monsters.find((monster) => monster.id === config.samplePlayerMonsterId);
  const cpu = monsters.find((monster) => monster.id === config.sampleCpuMonsterId);

  if (!player || !cpu) throw new Error('対戦に使うモンスターが見つかりません。');
  return { player, cpu };
}
