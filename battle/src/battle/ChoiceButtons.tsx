import { HAND_KEYS, HAND_META, HandIcon } from '../components/HandIcon';
import { cx } from '../cx';
import { HANDS, type Hand } from '../types';

// 手をえらぶ3枚のカード(左からグー・チョキ・パー。会場のボタンと同じ並び)
export function ChoiceButtons({
  disabled,
  selected,
  coach = false,
  onSelect,
}: {
  disabled: boolean;
  selected: Hand | null;
  coach?: boolean;
  onSelect: (hand: Hand) => void;
}) {
  return (
    <div className={cx('choice-area', disabled && 'choice-area--locked', coach && 'choice-area--coach')}>
      <p className="choice-prompt">{disabled ? 'しょうぶの けっかは…' : 'どの手にする？'}</p>
      <div className="choice-buttons">
        {HANDS.map((hand) => (
          <button
            key={hand}
            className={cx('hand-button', `hand-button--${hand}`, selected === hand && 'hand-button--selected')}
            disabled={disabled}
            onClick={() => onSelect(hand)}
            aria-label={HAND_META[hand].label}
          >
            <span className="hand-emoji" aria-hidden="true"><HandIcon hand={hand} alt="" /></span>
            <span className="hand-label">{HAND_META[hand].label}</span>
            <span className="hand-key" aria-hidden="true">{HAND_KEYS[hand]}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
