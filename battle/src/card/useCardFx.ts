import { useRef, type RefObject } from 'react';
import { impactFeedback, TIERS } from '../fx/feedback';
import { gsap, useGSAP } from '../fx/gsap';
import { cancelHitStop, hitStop } from '../fx/hitStop';
import { createShaker, type Shaker } from '../fx/shake';
import { SPECIAL_CUTIN_SLAM_MS } from '../timings';
import type { CardBattleApi } from './useCardBattle';

// カードバトルの手ざわり(game-feel + GSAP)。見た目だけを動かし、進行のタイミングには さわらない。
// - 命中:ヒットストップ → 揺れ(trauma。ダメージが大きいほど強い)・少し寄る・当たったカードが のけぞる・
//   ダメージの数字が はずむ・HP の数字と バーが ゆれる。強さは fx/feedback.ts の段(medium / large)
// - 必殺技のカットイン:たたきつける瞬間に 大きく揺れる
// - 相手が カードを ふせる:相手の手札から 弧をえがいて飛んできて、つぶれて着地(small の揺れ)
// - ターンの札:はずんで出る
// 動かす先は root の中から class で探す(どれも React が描いたあとの DOM。useGSAP の scope で root の中だけ)

export function useCardFx(
  rootRef: RefObject<HTMLElement | null>,
  battle: CardBattleApi,
  /** 立て札の横の ターンの札(変わったら はずませる) */
  turnSide: string | null,
) {
  const { view, damage, cpuStep, notice } = battle;
  const shakerRef = useRef<Shaker | null>(null);

  // 揺らすのは 左右のモンスターと 真ん中の列(手札は 揺らさない:読んでいる字が ぶれないように)
  useGSAP(() => {
    const root = rootRef.current;
    if (!root) return;
    shakerRef.current = createShaker([...root.querySelectorAll('.battlefield, .cb-center')]);
    return () => {
      shakerRef.current?.stop();
      shakerRef.current = null;
      cancelHitStop();
    };
  }, { scope: rootRef });

  // ---- 命中 ----
  useGSAP(() => {
    const root = rootRef.current;
    if (view !== 'damage' || !damage || !root) return;
    const feedback = impactFeedback(damage);
    // 当たった側が押される向き(相手に当たったら右へ)
    const dir = damage.target === 'cpu' ? 1 : -1;
    const panel = root.querySelector(`.monster-panel--${damage.target}`);

    // 当たったカード:押されて、ばねで もどる(行きすぎて ゆれる)。当たった瞬間は 横につぶれる
    const card = panel?.querySelector('.monster-card');
    if (card) {
      gsap.timeline()
        .fromTo(card, { x: 0, scaleX: 0.86, scaleY: 1.1 }, { x: dir * feedback.knockback, duration: 0.09, ease: 'power2.out' })
        .to(card, { x: 0, scaleX: 1, scaleY: 1, duration: 0.6, ease: 'elastic.out(1, 0.35)' });
      gsap.fromTo(card, { rotation: 0 }, { rotation: dir * (feedback.tier === 'large' ? 9 : 5), duration: 0.7, ease: 'fx.wiggle' });
    }

    // ダメージの数字:下から はずんで出て、着地で つぶれて伸びる。重なっても見えるように 横に少し ばらす
    const burst = panel?.querySelector('.damage-burst');
    if (burst) {
      gsap.set(burst, { xPercent: -50 });
      gsap.timeline({ delay: 0.04 })
        .fromTo(
          burst,
          { opacity: 0, x: 0, y: 50, scale: 0.3, rotation: -dir * 10 },
          { opacity: 1, x: gsap.utils.random(-24, 24), y: -26, scale: 1.18, rotation: dir * 4, duration: 0.24, ease: 'back.out(2.6)' },
        )
        .to(burst, { scaleX: 1.22, scaleY: 0.82, duration: 0.06, ease: 'power1.out' })
        .to(burst, { scaleX: 1, scaleY: 1, y: -34, rotation: 0, duration: 0.45, ease: 'elastic.out(1, 0.45)' });
    }

    // HP:数字が 赤く ふくらんで、バーが ゆれる
    const hpNumber = panel?.querySelector('.cb-hp__number');
    if (hpNumber) gsap.fromTo(hpNumber, { scale: 1.5 }, { scale: 1, duration: 0.5, ease: 'back.out(3)', clearProps: 'scale' });
    const hpBar = panel?.querySelector('.cb-hp__bar');
    if (hpBar) gsap.fromTo(hpBar, { x: 0 }, { x: dir * 10, duration: 0.45, ease: 'fx.wiggle', clearProps: 'x' });

    // 画面を少し寄せて もどす(大きな当たりほど)
    const field = root.querySelector('.battlefield');
    if (field && feedback.zoom > 1) gsap.fromTo(field, { scale: feedback.zoom }, { scale: 1, duration: 0.45, ease: 'power3.out' });

    shakerRef.current?.add(feedback.trauma);
    // さいごに 止める:ここまでで作った動きは 当たった瞬間の形のまま 止まって、少しして一気に動き出す
    hitStop(root, feedback.hitStop);
  }, { scope: rootRef, dependencies: [view, damage] });

  // ---- 必殺技のカットイン:たたきつける瞬間に 大きく揺らす ----
  useGSAP(() => {
    if (view !== 'finisher') return;
    gsap.delayedCall(SPECIAL_CUTIN_SLAM_MS / 1000, () => shakerRef.current?.add(TIERS.large.trauma[0]));
  }, { scope: rootRef, dependencies: [view] });

  // ---- 相手が カードを ふせる:相手の手札から 弧をえがいて飛んできて、つぶれて着地 ----
  useGSAP(() => {
    const root = rootRef.current;
    if (view !== 'cpu-turn' || cpuStep !== 'place' || !root) return;
    const fly = root.querySelector<HTMLElement>('.cb-field__fly');
    const from = root.querySelector('.cb-cpu-hand__cards');
    if (!fly || !from) return;
    // 画面は 舞台ごと縮めて映しているので、見た目の px を 要素の px に直す
    const box = fly.getBoundingClientRect();
    const scale = fly.offsetWidth > 0 && box.width > 0 ? box.width / fly.offsetWidth : 1;
    const start = from.getBoundingClientRect();
    const dx = (start.left + start.width / 2 - (box.left + box.width / 2)) / scale;
    const dy = (start.top + start.height / 2 - (box.top + box.height / 2)) / scale;
    gsap.timeline()
      .fromTo(
        fly,
        { x: dx, y: dy, rotation: -220, scale: 0.55, opacity: 0 },
        {
          keyframes: [
            { x: dx * 0.45, y: dy - 90, rotation: -100, scale: 0.85, opacity: 1, duration: 0.28, ease: 'power1.out' },
            { x: 0, y: 0, rotation: 0, scale: 1, duration: 0.26, ease: 'power2.in' },
          ],
        },
      )
      .to(fly, { scaleX: 1.14, scaleY: 0.84, duration: 0.06, ease: 'power1.out' })
      .call(() => shakerRef.current?.add(TIERS.small.trauma[1]))
      .to(fly, { scaleX: 1, scaleY: 1, duration: 0.4, ease: 'elastic.out(1, 0.4)' });
  }, { scope: rootRef, dependencies: [view, cpuStep] });

  // ---- スキル・相手のスキル(notice) ----
  // 回復:回復した側のカードが ふわっと ふくらんで もどる(うれしいことは 揺らさない)
  // 封じ手:鎖が 上から たたきつけられて、少し揺れる / ため技の予告:相手のカードが ぶるぶる ふるえる
  // 合成は 手札(HandRow)が ポンと出す
  useGSAP(() => {
    const root = rootRef.current;
    if (view !== 'notice' || !notice || !root) return;
    if (notice.type === 'heal' || notice.type === 'cpu-heal') {
      const card = root.querySelector(`.monster-panel--${notice.type === 'heal' ? 'player' : 'cpu'} .monster-card`);
      if (card) {
        gsap.timeline()
          .to(card, { scale: 1.07, y: -10, duration: 0.35, ease: 'power2.out' })
          .to(card, { scale: 1, y: 0, duration: 0.9, ease: 'elastic.out(1, 0.35)' });
      }
    } else if (notice.type === 'seal') {
      const chain = root.querySelector('.cb-chain');
      if (chain) {
        gsap.timeline()
          .fromTo(chain, { scale: 3, y: -60, rotation: -40, opacity: 0 }, { scale: 1, y: 0, rotation: 0, opacity: 1, duration: 0.3, ease: 'power3.in' })
          .call(() => shakerRef.current?.add(TIERS.small.trauma[1]))
          .to(chain, { scaleX: 1.25, scaleY: 0.8, duration: 0.05 })
          .to(chain, { scaleX: 1, scaleY: 1, duration: 0.4, ease: 'elastic.out(1, 0.4)' });
      }
    } else if (notice.type === 'cpu-charge') {
      const card = root.querySelector('.monster-panel--cpu .monster-card');
      if (card) gsap.fromTo(card, { x: 0 }, { x: 8, duration: 0.9, ease: 'fx.wiggleBig', clearProps: 'x' });
      shakerRef.current?.add(TIERS.small.trauma[0]);
    }
  }, { scope: rootRef, dependencies: [view, notice] });

  // ---- ターンの札:はずんで出る ----
  useGSAP(() => {
    const chip = rootRef.current?.querySelector('.cb-turn-chip');
    if (!chip) return;
    gsap.fromTo(chip, { scale: 0.3, rotation: -12, opacity: 0 }, { scale: 1, rotation: 0, opacity: 1, duration: 0.5, ease: 'back.out(3)' });
  }, { scope: rootRef, dependencies: [turnSide] });
}
