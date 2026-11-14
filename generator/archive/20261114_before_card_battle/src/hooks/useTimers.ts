import { useCallback, useEffect, useRef } from 'react';

/**
 * バトルの進行のタイマー。schedule で予約し、clearTimers で予約をすべて取り消す。
 * 取り消したあとに動きかけたもの(同じ時刻に重なったもの)も、何回目の予約かで見分けて動かさない。
 * 画面を閉じたら(アンマウント)すべて取り消す
 */
export function useTimers() {
  const timersRef = useRef<Set<number>>(new Set());
  const sequenceRef = useRef(0);

  const schedule = useCallback((callback: () => void, delay: number, sequence = sequenceRef.current) => {
    const timer = window.setTimeout(() => {
      timersRef.current.delete(timer);
      if (sequence === sequenceRef.current) callback();
    }, delay);
    timersRef.current.add(timer);
  }, []);

  const clearTimers = useCallback(() => {
    sequenceRef.current += 1;
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  return { schedule, clearTimers };
}
