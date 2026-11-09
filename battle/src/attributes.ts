// タイプ(attribute)から、攻撃の色・形・音のテーマを決める。見た目(App・BattleEffects)と音(gameAudio)で同じものを使う。
// 撮影・合体の画面は 火・水・草・光・闇・風・土・無 の8つから選ぶ(generator/app/prompts.py の ElementName)。
// ひらがなの6つ(あつい など)は、2026年11月2日までの古い outputs/ の性質

export type AttributeTheme = 'fire' | 'water' | 'nature' | 'light' | 'dark' | 'wind' | 'earth' | 'neutral';

export function getAttributeTheme(attribute = ''): AttributeTheme {
  if (/火|炎|fire|あつい/i.test(attribute)) return 'fire';
  if (/水|海|氷|water|ice|みず/i.test(attribute)) return 'water';
  if (/草|木|花|nature|grass|やわらかい/i.test(attribute)) return 'nature';
  if (/光|聖|light|でんき/i.test(attribute)) return 'light';
  if (/闇|影|dark/i.test(attribute)) return 'dark';
  if (/風|空|wind|とがってる/i.test(attribute)) return 'wind';
  if (/土|岩|earth|rock|かたい/i.test(attribute)) return 'earth';
  return 'neutral';
}

// 開発者メニューの「攻撃エフェクトを見る」に並べる8つ(撮影側のタイプと同じ順)
export const ELEMENTS: { attribute: string; theme: AttributeTheme }[] = [
  { attribute: '火', theme: 'fire' },
  { attribute: '水', theme: 'water' },
  { attribute: '草', theme: 'nature' },
  { attribute: '光', theme: 'light' },
  { attribute: '闇', theme: 'dark' },
  { attribute: '風', theme: 'wind' },
  { attribute: '土', theme: 'earth' },
  { attribute: '無', theme: 'neutral' },
];

// とどめの必殺技の名前に使う、タイプの言葉
const SPECIAL_WORDS: Record<AttributeTheme, string> = {
  fire: 'ファイヤー',
  water: 'スプラッシュ',
  nature: 'リーフ',
  light: 'フラッシュ',
  dark: 'シャドー',
  wind: 'ストーム',
  earth: 'クエイク',
  neutral: 'アタック',
};

type SpecialMoveMonster = { attribute: string; source?: { object?: string } };

/** 必殺技の名前を2つに分けたもの(カットインでは2行で出す)。撮った物がなければ object は空で「ひっさつわざ!」だけ */
export function specialMoveParts(monster: SpecialMoveMonster): { object: string; word: string } {
  const object = monster.source?.object?.trim() ?? '';
  if (!object) return { object: '', word: 'ひっさつわざ!' };
  return { object, word: `${SPECIAL_WORDS[getAttributeTheme(monster.attribute)]}!` };
}

/** 必殺技の名前:撮った物 + タイプの言葉(例「はさみ ストーム!」)。撮った物がなければ「ひっさつわざ!」 */
export function specialMoveName(monster: SpecialMoveMonster): string {
  const { object, word } = specialMoveParts(monster);
  return object ? `${object} ${word}` : word;
}

// カットインの名前を置ける幅(1920 の舞台で 左 760px・右 40px をあけた 1120px から、ふちどりの分を引いた)と、字の大きさの上限・下限
const SPECIAL_NAME_WIDTH = 1060;
const SPECIAL_NAME_MAX_PX = 140;
const SPECIAL_NAME_MIN_PX = 72;

/** 文字の幅を、字の大きさに対する割合で数える(全角は1、半角の英数・記号は 0.6) */
function textUnits(text: string): number {
  let units = 0;
  for (const char of text) units += /[ -~]/.test(char) ? 0.6 : 1;
  return units;
}

/** カットインの名前の字の大きさ(px)。長いほうの行が幅に収まる大きさ(上限 140・下限 72。下限でも入らなければ CSS で折り返す) */
export function specialMoveFontSize(parts: { object: string; word: string }): number {
  const units = Math.max(textUnits(parts.object), textUnits(parts.word), 1);
  const size = Math.floor(SPECIAL_NAME_WIDTH / units);
  return Math.min(SPECIAL_NAME_MAX_PX, Math.max(SPECIAL_NAME_MIN_PX, size));
}
