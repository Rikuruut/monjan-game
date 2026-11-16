import { assetUrl } from '../integration';
import type { Hand } from '../types';

// 手の絵(public/assets/janken/ の 256×256 の PNG。2026年11月5日に絵文字から置きかえ)
export const HAND_META: Record<Hand, { image: string; label: string }> = {
  rock: { image: assetUrl('/assets/janken/janken_gu_256.png'), label: 'グー' },
  scissors: { image: assetUrl('/assets/janken/janken_choki_256.png'), label: 'チョキ' },
  paper: { image: assetUrl('/assets/janken/janken_pa_256.png'), label: 'パー' },
};

// 手のカードの下に出す、会場のボタンの案内(左からグー・チョキ・パー)
export const HAND_KEYS: Record<Hand, string> = { rock: '◀', scissors: '●', paper: '▶' };

// 手の絵。大きさは親の文字の大きさ(font-size)に合わせる(battle.css の .hand-icon)。
// alt を空にすると読み上げない(ボタンの名前などで、もう伝わっているとき)
export function HandIcon({ hand, alt = HAND_META[hand].label }: { hand: Hand; alt?: string }) {
  return (
    <img
      className="hand-icon"
      src={HAND_META[hand].image}
      alt={alt}
      width={256}
      height={256}
      decoding="async"
      draggable={false}
    />
  );
}
