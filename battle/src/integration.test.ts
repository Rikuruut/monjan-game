import { describe, expect, it } from 'vitest';
import { assetUrl, BASE_URL, battleMonsterUrl, padButtonOf, readLaunch } from './integration';

describe('撮影・合体の画面とのつなぎ', () => {
  it('?photo= があれば、そのモンスターですぐバトルから始める', () => {
    expect(readLaunch('?photo=abc', true)).toEqual({ photoId: 'abc', playerName: null, skipTitle: true, toGenerator: true });
  });

  it('テストプレイ(?play=demo)は見本のゴリラ × はさみを、選んだ名前ですぐバトルから始める', () => {
    expect(readLaunch('?play=demo&name=%E3%82%B4%E3%83%AA%E3%82%B7%E3%82%B6%E3%83%BC', true))
      .toEqual({ photoId: 'demo', playerName: 'ゴリシザー', skipTitle: true, toGenerator: true });
  });

  it('?play=sample はバトルの見本のモンスターですぐバトルから始める', () => {
    expect(readLaunch('?play=sample', true)).toEqual({ photoId: null, playerName: null, skipTitle: true, toGenerator: true });
  });

  it('何もなければタイトルから。ビルドしたものだけスタートで撮影の画面へ行く', () => {
    expect(readLaunch('', true)).toEqual({ photoId: null, playerName: null, skipTitle: false, toGenerator: true });
    expect(readLaunch('', false).toGenerator).toBe(false);
    expect(readLaunch('?standalone=1', true).toGenerator).toBe(false);
  });

  it('public/ のファイルには公開する場所を付け、サーバーの API はそのまま', () => {
    expect(assetUrl('/monsters/a.png')).toBe(`${BASE_URL}monsters/a.png`);
    expect(assetUrl('relative.png')).toBe('relative.png');
    expect(battleMonsterUrl('abc')).toBe('/api/battle-monster/abc');
    expect(battleMonsterUrl('demo', 'ゴリ ザミ')).toBe('/api/battle-monster/demo?name=%E3%82%B4%E3%83%AA%20%E3%82%B6%E3%83%9F');
  });

  it('会場の3つのボタンは ← / Enter・Space / →', () => {
    expect(padButtonOf('ArrowLeft')).toBe('left');
    expect(padButtonOf('Enter')).toBe('center');
    expect(padButtonOf(' ')).toBe('center');
    expect(padButtonOf('ArrowRight')).toBe('right');
    expect(padButtonOf('a')).toBeNull();
  });
});
