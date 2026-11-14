import { afterEach, describe, expect, it, vi } from 'vitest';
import { burstAt, stopParticleFire, type ParticleFire } from './attackParticles';

// テスト(jsdom)には canvas がないので、絵文字の粒の形を作るところだけ差しかえる
vi.mock('canvas-confetti', () => ({
  default: { shapeFromText: () => ({}), create: vi.fn() },
}));

// canvas-confetti の発射台のかわり(呼ばれた回数だけ数える)
function fakeFire() {
  const shoot = vi.fn(async () => undefined);
  const reset = vi.fn();
  return { fire: Object.assign(shoot, { reset }) as unknown as ParticleFire, shoot, reset };
}

describe('タイプの粒', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('最後の一撃は、少しおいて もう1回はじける', () => {
    vi.useFakeTimers();
    const { fire, shoot } = fakeFire();
    burstAt(fire, 'cpu', 'fire', { final: true });
    const first = shoot.mock.calls.length;
    expect(first).toBeGreaterThan(0);
    vi.advanceTimersByTime(300);
    expect(shoot.mock.calls.length).toBe(first * 2);
  });

  it('止めたあとは、予約していた粒も出さない', () => {
    vi.useFakeTimers();
    const { fire, shoot, reset } = fakeFire();
    burstAt(fire, 'cpu', 'fire', { final: true });
    const first = shoot.mock.calls.length;
    stopParticleFire(fire);
    vi.advanceTimersByTime(300);
    expect(shoot.mock.calls.length).toBe(first);
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('発射台がないときは何もしない', () => {
    expect(() => stopParticleFire(null)).not.toThrow();
  });
});
