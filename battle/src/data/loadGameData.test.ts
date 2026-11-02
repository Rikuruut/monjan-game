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

  it('生成したモンスターの ID があれば、プレイヤーはサーバーから読み、CPU は見本から選ぶ', async () => {
    const generated = { ...player, id: 'abc', name: 'ゴリシザー', attribute: 'とがってる', image: '/api/monster-image/abc' };
    const byPath: Record<string, unknown> = {
      '/data/game-config.json': {
        samplePlayerMonsterId: 'MON-0001',
        sampleCpuMonsterId: 'MON-0002',
        monsters: ['/player.json', '/cpu.json'],
      },
      '/player.json': player,
      '/cpu.json': cpu,
      '/api/battle-monster/abc': generated,
    };
    const fetcher = vi.fn(async (input: RequestInfo | URL) => ({
      ok: true,
      json: async () => byPath[String(input)],
    })) as unknown as typeof fetch;

    const data = await loadGameData(fetcher, { photoId: 'abc', pickIndex: () => 0 });
    expect(data.player).toMatchObject({ id: 'abc', name: 'ゴリシザー', image: '/api/monster-image/abc' });
    // 見本のモンスターが CPU になる(プレイヤー役だった見本も相手に選ばれる)
    expect(data.cpu.id).toBe('MON-0001');
  });

  it('生成したモンスターを読めなければエラーにする', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => (
      String(input).startsWith('/api/')
        ? { ok: false, json: async () => ({}) }
        : {
          ok: true,
          json: async () => (String(input).endsWith('game-config.json')
            ? { samplePlayerMonsterId: 'MON-0001', sampleCpuMonsterId: 'MON-0002', monsters: ['/player.json'] }
            : player),
        }
    )) as unknown as typeof fetch;

    await expect(loadGameData(fetcher, { photoId: 'abc' })).rejects.toThrow('読み込めませんでした');
  });
});
