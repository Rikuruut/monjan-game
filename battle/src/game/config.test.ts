import { describe, expect, it } from 'vitest';
import configJson from '../../public/data/battle-config.json';
import { attackFromLegacy, DEFAULT_BATTLE_CONFIG, loadBattleConfig, parseBattleConfig } from './config';

describe('カードバトルの設定', () => {
  it('設定ファイル(battle-config.json)は、既定値の項目を全部持ち、同じ中身', () => {
    expect(configJson).toMatchObject(DEFAULT_BATTLE_CONFIG);
    expect(parseBattleConfig(configJson)).toEqual(DEFAULT_BATTLE_CONFIG);
  });

  it('読んだ値で置きかえる。足りない項目・おかしな値は既定値のまま', () => {
    const config = parseBattleConfig({
      starDamage: [5, 20, 40],
      handLimit: 'たくさん',
      playerHp: [100],
      mashTieWinner: 'だれか',
      rounds: [{ cpuHp: [20, 20] }, {}, { finisherChance: 0.5 }],
      unknown: 1,
    });
    expect(config.starDamage).toEqual([5, 20, 40]);
    expect(config.handLimit).toBe(DEFAULT_BATTLE_CONFIG.handLimit);
    expect(config.playerHp).toEqual(DEFAULT_BATTLE_CONFIG.playerHp);
    expect(config.mashTieWinner).toBe('player');
    expect(config.rounds[0].cpuHp).toEqual([20, 20]);
    expect(config.rounds[0].cpuAllRock).toBe(true);
    expect(config.rounds[2].finisherChance).toBe(0.5);
    expect(config).not.toHaveProperty('unknown');
  });

  it('rounds は 読んだ並びの長さを使う(2体にもできる)。空なら既定値', () => {
    const two = parseBattleConfig({ rounds: [{}, { cpuHp: [70, 70], cpuCharge: true }] });
    expect(two.rounds).toHaveLength(2);
    expect(two.rounds[0]).toEqual(DEFAULT_BATTLE_CONFIG.rounds[0]);
    expect(two.rounds[1]).toMatchObject({ cpuHp: [70, 70], cpuCharge: true, cpuAllRock: false });
    expect(parseBattleConfig({ rounds: [{}, {}, {}, { cpuHp: [99, 99] }] }).rounds[3]).toMatchObject({ cpuHp: [99, 99], cpuCharge: true });
    expect(parseBattleConfig({ rounds: [] }).rounds).toEqual(DEFAULT_BATTLE_CONFIG.rounds);
  });

  it('JSON でないものは既定値', () => {
    expect(parseBattleConfig(null)).toEqual(DEFAULT_BATTLE_CONFIG);
    expect(parseBattleConfig('x')).toEqual(DEFAULT_BATTLE_CONFIG);
  });

  it('設定ファイルが読めなければ既定値(バトルは止めない)', async () => {
    const missing = async () => new Response('', { status: 404 });
    const broken = async () => { throw new Error('つながらない'); };
    const ok = async () => new Response(JSON.stringify({ handLimit: 4 }));
    expect(await loadBattleConfig('/x.json', missing)).toEqual(DEFAULT_BATTLE_CONFIG);
    expect(await loadBattleConfig('/x.json', broken)).toEqual(DEFAULT_BATTLE_CONFIG);
    expect((await loadBattleConfig('/x.json', ok)).handLimit).toBe(4);
  });

  it('古い ⚔ の数を攻撃力に読みかえる', () => {
    expect(attackFromLegacy(1000)).toBe(6);
    expect(attackFromLegacy(2000)).toBe(10);
    expect(attackFromLegacy(3000)).toBe(14);
    expect(attackFromLegacy(9000)).toBe(14);
    expect(attackFromLegacy(0)).toBe(6);
  });
});
