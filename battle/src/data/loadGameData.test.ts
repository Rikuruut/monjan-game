import { describe, expect, it, vi } from 'vitest';
import { loadGameData, parseMonster } from './loadGameData';

const player = {
  id: 'MON-0001',
  name: 'ボトルマンタ',
  source: { animal: 'エイ', object: '水筒' },
  attribute: '水',
  attack: 2000,
  hp: 4000,
  description: 'テスト',
  image: '/monsters/player.png',
};

const cpu = { ...player, id: 'MON-0002', name: 'パンチイーグル', image: '/monsters/cpu.png' };

describe('モンスターデータ検証', () => {
  it('正しいJSONを読み込める', () => {
    expect(parseMonster(player).id).toBe('MON-0001');
  });

  it('欠損や範囲外の値をエラーにする', () => {
    expect(() => parseMonster({ ...player, hp: 6000 })).toThrow('不正な値');
    expect(() => parseMonster({ ...player, image: 'relative.png' })).toThrow('不正な値');
    expect(() => parseMonster({ name: 'たりない' })).toThrow('形が正しくありません');
  });

  it('設定JSONのIDからプレイヤーとCPUを選ぶ', async () => {
    const values = [
      {
        samplePlayerMonsterId: 'MON-0001',
        sampleCpuMonsterId: 'MON-0002',
        monsters: ['/player.json', '/cpu.json'],
      },
      player,
      cpu,
    ];
    const fetcher = vi.fn(async () => ({
      ok: true,
      json: async () => values.shift(),
    })) as unknown as typeof fetch;

    await expect(loadGameData(fetcher)).resolves.toMatchObject({
      player: { id: 'MON-0001' },
      cpu: { id: 'MON-0002' },
    });
  });
});

