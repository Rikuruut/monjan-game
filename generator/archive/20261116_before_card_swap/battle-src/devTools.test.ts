import { describe, expect, it } from 'vitest';
import { AUTOPLAY_KEY, battleUrlFor, readAutoplay, writeAutoplay } from './devTools';

describe('開発者メニューの決まりごと', () => {
  it('自動プレイの状態を sessionStorage に残し、止めたら消す', () => {
    writeAutoplay({ on: true, loops: 3 }, window.sessionStorage);
    expect(readAutoplay(window.sessionStorage)).toEqual({ on: true, loops: 3 });
    writeAutoplay({ on: false, loops: 0 }, window.sessionStorage);
    expect(window.sessionStorage.getItem(AUTOPLAY_KEY)).toBeNull();
    expect(readAutoplay(window.sessionStorage)).toEqual({ on: false, loops: 0 });
  });

  it('こわれた値や保存できないときは止まっている扱い', () => {
    window.sessionStorage.setItem(AUTOPLAY_KEY, '{');
    expect(readAutoplay(window.sessionStorage).on).toBe(false);
    expect(readAutoplay(null).on).toBe(false);
    window.sessionStorage.clear();
  });

  it('作ったモンスターで戦うページは ?photo=<フォルダ名>', () => {
    expect(battleUrlFor('20261102_090000')).toMatch(/\?photo=20261102_090000$/);
  });
});
