import { impactFeedback, TIERS } from './feedback';
import { gsap } from './gsap';
import { cancelHitStop, hitStop } from './hitStop';
import { createShaker } from './shake';

// game-feel の「確かめ方」:重なったヒットストップのあと かならず戻る・揺れは もとの位置で終わる・強さの段が つりあう

describe('強さの段(feedback.ts)', () => {
  const hit = (amount: number, more: Partial<Parameters<typeof impactFeedback>[0]> = {}) =>
    impactFeedback({ amount, charged: false, finisher: false, final: false, ...more });

  it('ふつうの命中は medium で、ダメージが大きいほど強い', () => {
    expect(hit(6).tier).toBe('medium');
    expect(hit(14).trauma).toBeGreaterThan(hit(6).trauma);
    expect(hit(14).hitStop).toBeGreaterThan(hit(6).hitStop);
    expect(hit(6).trauma).toBe(TIERS.medium.trauma[0]);
    // はばの外は はしで止まる
    expect(hit(99).trauma).toBe(TIERS.medium.trauma[1]);
  });

  it('ため技・とどめ・必殺技は large で、ふつうより強い', () => {
    for (const more of [{ charged: true }, { final: true }, { finisher: true }]) {
      const feedback = hit(20, more);
      expect(feedback.tier).toBe('large');
      expect(feedback.trauma).toBeGreaterThan(hit(14).trauma);
      expect(feedback.hitStop).toBeGreaterThan(hit(14).hitStop);
    }
  });

  it('ヒットストップは 0.15秒を こえない(game-feel:長く止めると 遅れに見える)', () => {
    expect(hit(30, { finisher: true }).hitStop).toBeLessThanOrEqual(0.15);
  });
});

describe('ヒットストップ(hitStop.ts)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => {
    cancelHitStop();
    vi.useRealTimers();
  });

  it('止めて、時間がたつと 戻る', () => {
    const root = document.createElement('div');
    hitStop(root, 0.08);
    expect(root).toHaveClass('fx-hitstop');
    expect(gsap.globalTimeline.paused()).toBe(true);
    vi.advanceTimersByTime(80);
    expect(root).not.toHaveClass('fx-hitstop');
    expect(gsap.globalTimeline.paused()).toBe(false);
  });

  it('30ms あけて2回:1回目のタイマーでは戻らず、2回目の長さのあとで かならず戻る', () => {
    const root = document.createElement('div');
    hitStop(root, 0.06);
    vi.advanceTimersByTime(30);
    hitStop(root, 0.1);
    vi.advanceTimersByTime(40); // 1回目の 60ms は すぎた
    expect(root).toHaveClass('fx-hitstop');
    vi.advanceTimersByTime(60);
    expect(root).not.toHaveClass('fx-hitstop');
    expect(gsap.globalTimeline.paused()).toBe(false);
  });

  it('0秒なら止めない', () => {
    const root = document.createElement('div');
    hitStop(root, 0);
    expect(root).not.toHaveClass('fx-hitstop');
  });
});

describe('揺れ(shake.ts)', () => {
  it('止めると かならず もとの位置に もどる', () => {
    const el = document.createElement('div');
    const shaker = createShaker([el]);
    shaker.add(1);
    gsap.set(el, { x: 20, y: -10, rotation: 2 });
    shaker.stop();
    expect(gsap.getProperty(el, 'x')).toBe(0);
    expect(gsap.getProperty(el, 'y')).toBe(0);
    expect(gsap.getProperty(el, 'rotation')).toBe(0);
  });
});
