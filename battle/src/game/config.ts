// カードバトルの調整用の数値(戦闘システム設計書 9章)。
// 会場では public/data/battle-config.json を読む(コードを直さずに変えられる)。読めないとき・足りない項目は、ここの既定値。
// 既定値と JSON は同じ中身にしておく(config.test.ts で確かめている)

/** はば [最小, 最大](両はしを含む整数) */
export type Range = [number, number];

/** 1ラウンド(CPU 1体)ごとの設定 */
export interface RoundConfig {
  cpuHp: Range;
  cpuAttack: Range;
  /** CPU の手札が全部グー(練習) */
  cpuAllRock: boolean;
  /** CPU が回復を1回使う */
  cpuHeal: boolean;
  /** CPU が ため技を使う(ボス) */
  cpuCharge: boolean;
  /** 相手の HP が半分以下のとき、1回のドローで必殺技が来る確率 */
  finisherChance: number;
  /** 逆転のチャンス:自分の HP が3割以下のとき、1回のドローで必殺技が来る確率 */
  comebackChance: number;
  /** パックに かならず入るパーの枚数(練習で勝てるように) */
  packPaper: number;
  /** 自分の HP が これより下がらない(練習は 1。ふつうは 0) */
  playerHpFloor: number;
}

export interface BattleConfig {
  /** ★1・★2・★3 のダメージ */
  starDamage: [number, number, number];
  /** ★1・★2・★3 の出やすさ(重み) */
  starWeights: [number, number, number];
  playerHp: Range;
  playerAttack: Range;
  /** 古い ⚔1・⚔2・⚔3(生成側が変わるまでの読みかえ)の攻撃力 */
  legacyAttack: [number, number, number];
  handLimit: number;
  cpuHandSize: number;
  /** 画面に並ぶパックの数 */
  packChoices: number;
  packSize: number;
  /** パックに かならず入る じゃんけんカードの枚数 */
  packJanken: number;
  packHealRate: number;
  packSealRate: number;
  drawHealRate: number;
  drawSealRate: number;
  /** 回復カードが出る上限(1ラウンド。パックとドローを合わせて) */
  healPerRound: number;
  /** スキルを使える上限(1ターン) */
  skillPerTurn: number;
  /** 必殺技が来る条件:相手の HP が この割合以下 */
  finisherCpuHpRatio: number;
  /** 逆転のチャンスの条件:自分の HP が この割合以下 */
  comebackHpRatio: number;
  cpuHealAmount: number;
  /** CPU が回復を使う条件:HP が この割合以下 */
  cpuHealHpRatio: number;
  /** ため技:このターン数ごとに予告する */
  chargeInterval: number;
  chargeMultiplier: number;
  mashMs: number;
  cpuMashMin: number;
  cpuMashMax: number;
  /** 連打が同じ数のときに勝ちにする側 */
  mashTieWinner: 'player' | 'cpu';
  packAutoOpenMs: number;
  /** 戦う相手の並び(1つ以上)。ふつうは 1体目(練習)・2体目・ボス。最後のラウンドに勝つと全クリア */
  rounds: RoundConfig[];
}

export const DEFAULT_BATTLE_CONFIG: BattleConfig = {
  starDamage: [10, 25, 50],
  starWeights: [60, 30, 10],
  playerHp: [100, 100],
  playerAttack: [6, 14],
  legacyAttack: [6, 10, 14],
  handLimit: 5,
  cpuHandSize: 3,
  packChoices: 3,
  packSize: 5,
  packJanken: 1,
  packHealRate: 0.15,
  packSealRate: 0.2,
  drawHealRate: 0.1,
  drawSealRate: 0.15,
  healPerRound: 1,
  skillPerTurn: 1,
  finisherCpuHpRatio: 0.5,
  comebackHpRatio: 0.3,
  cpuHealAmount: 30,
  cpuHealHpRatio: 0.4,
  chargeInterval: 3,
  chargeMultiplier: 2,
  mashMs: 2500,
  cpuMashMin: 6,
  cpuMashMax: 11,
  mashTieWinner: 'player',
  packAutoOpenMs: 10000,
  rounds: [
    // 1体目(練習):相手は全部グー。パックにパーが2枚、自分の HP は 1 より下がらない。必殺技は出さない
    { cpuHp: [30, 30], cpuAttack: [8, 8], cpuAllRock: true, cpuHeal: false, cpuCharge: false, finisherChance: 0, comebackChance: 0, packPaper: 2, playerHpFloor: 1 },
    // 2体目・ボスの HP と攻撃力は、1試合を平均6〜7ターンにするために 設計書の値から変えた(2026年11月14日。当日の時間のため)。
    // 設計書:2体目 HP55〜65・回復あり、ボス HP80〜90、攻撃力は どちらも8〜12。くらべた結果は npm.cmd run sim
    // 2体目:回復は使わない
    { cpuHp: [35, 45], cpuAttack: [10, 14], cpuAllRock: false, cpuHeal: false, cpuCharge: false, finisherChance: 0.1, comebackChance: 0.5, packPaper: 0, playerHpFloor: 0 },
    // ボス:相手の HP が半分以下になったら、次のドローで必殺技が かならず来る
    { cpuHp: [55, 65], cpuAttack: [10, 14], cpuAllRock: false, cpuHeal: true, cpuCharge: true, finisherChance: 1, comebackChance: 0.5, packPaper: 0, playerHpFloor: 0 },
  ],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// 既定値と同じ形のところだけ、読んだ値で置きかえる(型が違う・長さが違う・知らない項目は 既定値のまま)
function mergeKnown<T>(base: T, value: unknown): T {
  if (typeof base === 'number') return (typeof value === 'number' && Number.isFinite(value) ? value : base) as T;
  if (typeof base === 'boolean') return (typeof value === 'boolean' ? value : base) as T;
  if (typeof base === 'string') return (typeof value === 'string' ? value : base) as T;
  if (Array.isArray(base)) {
    if (!Array.isArray(value) || value.length !== base.length) return base;
    return base.map((item, index) => mergeKnown(item, value[index])) as T;
  }
  if (isRecord(base)) {
    if (!isRecord(value)) return base;
    const merged: Record<string, unknown> = {};
    for (const key of Object.keys(base)) merged[key] = mergeKnown(base[key], value[key]);
    return merged as T;
  }
  return base;
}

/** 読んだ JSON を設定にする。おかしな値・足りない項目は既定値 */
export function parseBattleConfig(value: unknown): BattleConfig {
  const config = mergeKnown(DEFAULT_BATTLE_CONFIG, value);
  // rounds は 読んだ並びの長さを使う(2体にする など)。各ラウンドの足りない項目は、同じ位置(なければ最後)の既定値
  if (isRecord(value) && Array.isArray(value.rounds) && value.rounds.length > 0) {
    const defaults = DEFAULT_BATTLE_CONFIG.rounds;
    config.rounds = value.rounds.map((round, index) => mergeKnown(defaults[Math.min(index, defaults.length - 1)], round));
  }
  if (config.mashTieWinner !== 'player' && config.mashTieWinner !== 'cpu') {
    config.mashTieWinner = DEFAULT_BATTLE_CONFIG.mashTieWinner;
  }
  return config;
}

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** 設定ファイルを読む。読めなければ既定値(バトルは止めない) */
export async function loadBattleConfig(url: string, fetcher: Fetcher = fetch): Promise<BattleConfig> {
  try {
    const response = await fetcher(url);
    if (!response.ok) return DEFAULT_BATTLE_CONFIG;
    return parseBattleConfig(await response.json());
  } catch {
    return DEFAULT_BATTLE_CONFIG;
  }
}

/** 古い ⚔ の数(JSON では 1000 = 1個)を、カードバトルの攻撃力にする。生成側が数字を出すようになるまでの読みかえ */
export function attackFromLegacy(attack: number, config: BattleConfig = DEFAULT_BATTLE_CONFIG): number {
  const index = Math.min(2, Math.max(0, Math.round(attack / 1000) - 1));
  return config.legacyAttack[index];
}
