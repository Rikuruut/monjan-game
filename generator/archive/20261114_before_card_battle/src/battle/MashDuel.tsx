import type { CSSProperties } from 'react';
import { cx } from '../cx';
import { CPU_MASH_MAX } from '../game/logic';
import { MASH_DUEL_MS } from '../timings';
import type { Winner } from '../types';

// ゲージの長さの目安(これだけ押すと いっぱい。CPU の多いときの回数より少し多い)
const MASH_GAUGE_MAX = CPU_MASH_MAX + 4;

/** 勝った側の ひとこと(連打勝負・手のぶつかりの帯で同じ) */
export function winnerMessage(winner: Winner | null, tie: string): string {
  return winner === 'player' ? 'あなたの かち！' : winner === 'cpu' ? 'CPUの かち！' : tie;
}

// ゲージの伸び(0〜1)。幅ではなく横の拡大で見せる(effects.css の .mash-duel__fill。描き直しなしで動く)
const fillStyle = (count: number, extra?: CSSProperties): CSSProperties => ({
  transform: `scaleX(${Math.min(1, count / MASH_GAUGE_MAX)})`,
  ...extra,
});

// あいこの連打勝負。会場の3つのボタンのどれでも1回(画面のゲージを押しても数える)。
// CPU のゲージは、連打の時間をかけて目標の回数まで CSS のアニメーションで伸ばす(回数は終わってから出す)
export function MashDuel({
  phase,
  playerCount,
  cpuCount,
  winner,
  onMash,
}: {
  phase: 'mash-duel' | 'mash-result';
  playerCount: number;
  cpuCount: number;
  winner: Winner | null;
  onMash: () => void;
}) {
  const done = phase === 'mash-result';
  const title = !done ? 'れんだ しょうぶ！' : winnerMessage(winner, 'おなじ かず！ あいこ！');
  return (
    <div className={cx('mash-duel', done && `mash-duel--done mash-duel--winner-${winner ?? 'none'}`)} role="status" aria-live="polite">
      <strong className="mash-duel__title">{title}</strong>
      {/* のこり時間:連打の時間をかけて 右から縮む(終わったら消す) */}
      {!done && (
        <span className="mash-duel__timer" aria-hidden="true">
          <span className="mash-duel__timer-fill" style={{ animationDuration: `${MASH_DUEL_MS}ms` }} />
        </span>
      )}
      <div className="mash-duel__row mash-duel__row--player">
        <span className="mash-duel__label">あなた</span>
        <button type="button" className="mash-duel__gauge" onClick={onMash} aria-label={`あなたの れんだ ${playerCount}かい`}>
          <span className="mash-duel__fill" style={fillStyle(playerCount)} />
        </button>
        {/* 押すたびに数字がぽんと弾む(key を変えてアニメーションをやり直す) */}
        <b className="mash-duel__count" key={playerCount}>{playerCount}</b>
      </div>
      <div className="mash-duel__row mash-duel__row--cpu">
        <span className="mash-duel__label">CPU</span>
        <span className="mash-duel__gauge" aria-label={done ? `CPUの れんだ ${cpuCount}かい` : 'CPUも れんだ中'}>
          <span
            className="mash-duel__fill mash-duel__fill--cpu"
            style={fillStyle(cpuCount, { animationDuration: `${MASH_DUEL_MS}ms` })}
          />
        </span>
        <b className="mash-duel__count">{done ? cpuCount : '？'}</b>
      </div>
      {/* 会場の3つのボタンをかたどる。押すたびに3つとも光る(key で光り直す) */}
      {!done && (
        <div className="mash-duel__keys" aria-hidden="true">
          <span className="mash-duel__buttons" key={playerCount}>
            <i>◀</i><i>●</i><i>▶</i>
          </span>
          <span className="mash-duel__keys-text">どれでも れんだ！</span>
        </div>
      )}
    </div>
  );
}
