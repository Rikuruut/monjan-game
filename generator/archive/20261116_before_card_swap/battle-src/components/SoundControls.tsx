import { memo } from 'react';

// 音のオン・オフと音量(舞台の右上)。手を選ぶたびの描き直しに付き合わないよう memo にしてある
export const SoundControls = memo(function SoundControls({
  enabled,
  bgmVolume,
  sfxVolume,
  onToggle,
  onBgmVolumeChange,
  onSfxVolumeChange,
}: {
  enabled: boolean;
  bgmVolume: number;
  sfxVolume: number;
  onToggle: () => void;
  onBgmVolumeChange: (value: number) => void;
  onSfxVolumeChange: (value: number) => void;
}) {
  return (
    <div className="sound-controls" aria-label="サウンド設定">
      <button
        className="sound-toggle"
        type="button"
        aria-pressed={enabled}
        aria-label={`サウンドを${enabled ? 'オフ' : 'オン'}にする`}
        onClick={onToggle}
      >
        <span aria-hidden="true">{enabled && (bgmVolume > 0 || sfxVolume > 0) ? '🔊' : '🔇'}</span>
      </button>
      <div className="sound-mixer">
        <label className="volume-control">
          <span>BGM</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(bgmVolume * 100)}
            aria-label="BGM音量"
            onChange={(event) => onBgmVolumeChange(Number(event.currentTarget.value) / 100)}
          />
        </label>
        <label className="volume-control">
          <span>SE</span>
          <input
            type="range"
            min="0"
            max="100"
            step="5"
            value={Math.round(sfxVolume * 100)}
            aria-label="効果音音量"
            onChange={(event) => onSfxVolumeChange(Number(event.currentTarget.value) / 100)}
          />
        </label>
      </div>
    </div>
  );
});
