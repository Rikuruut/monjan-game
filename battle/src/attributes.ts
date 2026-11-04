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
