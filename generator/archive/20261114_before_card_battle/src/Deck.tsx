import type { ReactNode } from 'react';
import type { PadButton } from './integration';

// 下の操作盤:会場の3つのボタン(← / Enter・Space / →)と同じ並びの、緑の丸ボタン。
// 撮影・合体の画面(generator/static/themes/fusion の .deck / .knob)と同じ見た目。
// 会場のボタンは各画面の usePadButtons が受け取る。ここはマウスでも押せる見本と、押せることの案内

export interface Knob {
  label: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  // 押してほしいときに光って呼びかける
  call?: boolean;
}

const POSITIONS: PadButton[] = ['left', 'center', 'right'];

export function Deck({ knobs, className = '' }: { knobs: Partial<Record<PadButton, Knob>>; className?: string }) {
  return (
    <footer className={`deck ${className}`.trim()}>
      {POSITIONS.map((pos) => {
        const knob = knobs[pos];
        if (!knob) return null;
        return (
          <button
            key={pos}
            type="button"
            className={['knob', pos === 'center' ? 'knob-main' : 'knob-side', knob.call ? 'knob--call' : ''].filter(Boolean).join(' ')}
            data-pos={pos}
            disabled={knob.disabled}
            onClick={knob.onClick}
          >
            <span className="knob-face" aria-hidden="true" />
            <span className="knob-label">{knob.label}</span>
          </button>
        );
      })}
    </footer>
  );
}
