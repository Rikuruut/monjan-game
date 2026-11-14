import { gsap } from './gsap';

// できごとの強さの段(game-feel の Tiers)。揺れ・ヒットストップ・光・粒の強さを ここ1か所で決めて、
// ゲーム全体で つりあいが そろうようにする。
//   small  :カードを えらぶ・ドロー・ふせる など(揺れは ほんの少し、止めない)
//   medium :ふつうの攻撃の命中
//   large  :ため技の2倍・とどめ・必殺技
// 数字は 画面で見て調整する(ここだけ変えれば 全部に効く)

export type Tier = 'small' | 'medium' | 'large';

export interface TierSpec {
  /** 足す trauma の はば(弱い〜強い。揺れの大きさは この2乗) */
  trauma: readonly [number, number];
  /** ヒットストップの秒数の はば(0 は止めない) */
  hitStop: readonly [number, number];
  /** 画面を少し寄せる(ズームの強さ。1 で寄せない) */
  zoom: number;
}

export const TIERS: Record<Tier, TierSpec> = {
  small: { trauma: [0.1, 0.2], hitStop: [0, 0], zoom: 1 },
  medium: { trauma: [0.4, 0.6], hitStop: [0.05, 0.08], zoom: 1.015 },
  large: { trauma: [0.8, 1], hitStop: [0.11, 0.15], zoom: 1.04 },
};

/** 攻撃力の はば(ユーザー 6〜14・相手 10〜14。ため技の2倍は 20〜28) */
const NORMAL_DAMAGE: readonly [number, number] = [6, 14];
const CHARGED_DAMAGE: readonly [number, number] = [12, 28];

export interface Impact {
  amount: number;
  charged: boolean;
  finisher: boolean;
  final: boolean;
}

export interface ImpactFeedback {
  tier: Tier;
  trauma: number;
  hitStop: number;
  zoom: number;
  /** 当たったカードが のけぞる大きさ(px) */
  knockback: number;
}

// a〜b の値を、範囲 [lo, hi] の中の位置で えらぶ(はみ出したら はしで止める)
function pick(range: readonly [number, number], value: number, from: readonly [number, number]): number {
  return gsap.utils.clamp(range[0], range[1], gsap.utils.mapRange(from[0], from[1], range[0], range[1], value));
}

/** 命中の強さ:必殺技・とどめ・ため技は large、ほかは medium(ダメージが大きいほど強く) */
export function impactFeedback(impact: Impact): ImpactFeedback {
  const tier: Tier = impact.finisher || impact.final || impact.charged ? 'large' : 'medium';
  const spec = TIERS[tier];
  if (impact.finisher) {
    return { tier, trauma: spec.trauma[1], hitStop: spec.hitStop[1], zoom: spec.zoom * 1.02, knockback: 90 };
  }
  const from = tier === 'large' ? CHARGED_DAMAGE : NORMAL_DAMAGE;
  return {
    tier,
    trauma: pick(spec.trauma, impact.amount, from),
    hitStop: pick(spec.hitStop, impact.amount, from),
    zoom: spec.zoom,
    knockback: tier === 'large' ? 70 : pick([28, 48], impact.amount, from),
  };
}
