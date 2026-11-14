// `npm.cmd run sim`:数値の案ごとに試合を回して、全クリア率などを表で出す(戦闘システム設計書 10章と比べる)。
// 案を足す・変えるときは CASES を直す。ふだんのテスト(npm.cmd test)には入らない
import { it } from 'vitest';
import { DEFAULT_BATTLE_CONFIG, type BattleConfig, type Range, type RoundConfig } from './config';
import { simulate, type Policy } from './simulate';

const MATCHES = 20000;

const base = DEFAULT_BATTLE_CONFIG;
const [practice, second, boss] = base.rounds;

// 2体目・ボスの数値を変えた設定を作る
function variant(options: {
  secondHp?: Range;
  bossHp?: Range;
  cpuAttack?: Range;
  secondHeal?: boolean;
  starDamage?: [number, number, number];
  twoRounds?: boolean;
}): BattleConfig {
  const tune = (round: RoundConfig, hp?: Range): RoundConfig => ({
    ...round,
    cpuHp: hp ?? round.cpuHp,
    cpuAttack: options.cpuAttack ?? round.cpuAttack,
  });
  const secondRound = { ...tune(second, options.secondHp), cpuHeal: options.secondHeal ?? second.cpuHeal };
  const bossRound = tune(boss, options.bossHp);
  return {
    ...base,
    starDamage: options.starDamage ?? base.starDamage,
    rounds: options.twoRounds ? [practice, bossRound] : [practice, secondRound, bossRound],
  };
}

// ターン数を 平均6〜7 にするために くらべた主な案(2026年11月14日。「いまの設定」を選んだ)。
// 相手の HP を下げると短くなるが、必殺技が来る前に倒してしまう子が増える。確実に短いのは 2体にする案
const CASES: { name: string; config: BattleConfig }[] = [
  { name: '設計書の値(2体目55〜65 回復あり・ボス80〜90・相手の攻撃8〜12)', config: variant({ secondHp: [55, 65], bossHp: [80, 90], cpuAttack: [8, 12], secondHeal: true }) },
  { name: '2体目45〜55・ボス65〜75・相手の攻撃8〜12', config: variant({ secondHp: [45, 55], bossHp: [65, 75], cpuAttack: [8, 12] }) },
  { name: 'いまの設定(2体目35〜45・ボス55〜65・相手の攻撃10〜14)', config: base },
  { name: '2体目30〜40・ボス50〜60・相手の攻撃12〜16', config: variant({ secondHp: [30, 40], bossHp: [50, 60], cpuAttack: [12, 16] }) },
  { name: '2体目45〜55・ボス65〜75・相手の攻撃8〜12・★15/30/55', config: variant({ secondHp: [45, 55], bossHp: [65, 75], cpuAttack: [8, 12], starDamage: [15, 30, 55] }) },
  { name: '2体(練習→ボス80〜90・相手の攻撃8〜12)', config: variant({ twoRounds: true, bossHp: [80, 90], cpuAttack: [8, 12] }) },
  { name: '2体(練習→いまのボス)', config: variant({ twoRounds: true }) },
];

const POLICIES: { policy: Policy; label: string }[] = [
  { policy: 'smart', label: '考えて' },
  { policy: 'random', label: 'なんとなく' },
];

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;

it('数値の案ごとの結果', () => {
  const rows = CASES.flatMap(({ name, config }) =>
    POLICIES.map(({ policy, label }) => {
      const summary = simulate(config, policy, { matches: MATCHES, seed: 20261114 });
      return {
        案: name,
        遊び方: label,
        全クリア: percent(summary.clearRate),
        ラウンドごとの勝ち: summary.roundWinRate.map(percent).join(' / '),
        ラウンドごとのターン: summary.roundTurns.map((turns) => turns.toFixed(1)).join(' / '),
        '1試合のターン': summary.totalTurns.toFixed(1),
        全クリアした試合のターン: summary.clearedTurns.toFixed(1),
        必殺技を見た: percent(summary.finisherRate),
      };
    }),
  );
  console.table(rows);
});
