import { describe, expect, it } from 'vitest';
import { ELEMENTS, getAttributeTheme, specialMoveName, type AttributeTheme } from './attributes';

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
