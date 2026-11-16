import { describe, expect, it } from 'vitest';
import { ELEMENTS, getAttributeTheme, specialMoveFontSize, specialMoveName, specialMoveParts, type AttributeTheme } from './attributes';

describe('getAttributeTheme', () => {
  const cases: [string, AttributeTheme][] = [
    // 撮影側の8つ
    ['火', 'fire'], ['水', 'water'], ['草', 'nature'], ['光', 'light'],
    ['闇', 'dark'], ['風', 'wind'], ['土', 'earth'], ['無', 'neutral'],
    // 古い outputs/ のひらがなの6つ
    ['あつい', 'fire'], ['みず', 'water'], ['やわらかい', 'nature'],
    ['でんき', 'light'], ['とがってる', 'wind'], ['かたい', 'earth'],
    // 見本の JSON などの言い方
    ['炎', 'fire'], ['氷', 'water'], ['Fire', 'fire'], ['rock', 'earth'],
    // 知らない値
    ['', 'neutral'], ['なぞ', 'neutral'],
  ];

  it.each(cases)('%s → %s', (attribute, theme) => {
    expect(getAttributeTheme(attribute)).toBe(theme);
  });

  it('開発者メニューの8つは、判定と同じテーマになる', () => {
    ELEMENTS.forEach(({ attribute, theme }) => expect(getAttributeTheme(attribute)).toBe(theme));
    expect(new Set(ELEMENTS.map((element) => element.theme)).size).toBe(8);
  });
});

describe('必殺技の名前', () => {
  it('撮った物 + タイプの言葉', () => {
    expect(specialMoveName({ attribute: '風', source: { object: 'はさみ' } })).toBe('はさみ ストーム!');
    expect(specialMoveName({ attribute: '火', source: { object: 'えんぴつ' } })).toBe('えんぴつ ファイヤー!');
  });

  it('撮った物がなければ ひっさつわざ', () => {
    expect(specialMoveName({ attribute: '水', source: { object: '' } })).toBe('ひっさつわざ!');
    expect(specialMoveName({ attribute: '水' })).toBe('ひっさつわざ!');
  });
});

describe('必殺技の名前の大きさ(カットインからはみ出さない)', () => {
  it('撮った物とタイプの言葉の2行に分ける', () => {
    expect(specialMoveParts({ attribute: '水', source: { object: 'スマートフォン' } })).toEqual({ object: 'スマートフォン', word: 'スプラッシュ!' });
    expect(specialMoveParts({ attribute: '水' })).toEqual({ object: '', word: 'ひっさつわざ!' });
  });

  it('短い名前は いちばん大きいまま', () => {
    expect(specialMoveFontSize(specialMoveParts({ attribute: '風', source: { object: 'はさみ' } }))).toBe(140);
  });

  it('長い名前ほど小さくし、幅 1060px に収める(下限 72px)', () => {
    const fit = (object: string) => specialMoveFontSize(specialMoveParts({ attribute: '水', source: { object } }));
    const long = fit('ペットボトルのふた');
    expect(long).toBeLessThan(140);
    expect(long * 9).toBeLessThanOrEqual(1060);
    expect(fit('ペットボトルのふたの うらがわの もよう')).toBe(72);
  });
});
