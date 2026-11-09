import { getAttributeTheme } from '../attributes';

export type GameSound =
  | 'start'
  | 'select'
  | 'summon'
  | 'janken-jan'
  | 'janken-ken'
  | 'janken-pon'
  | 'reveal'
  | 'star-showdown'
  | 'attack'
  | 'impact'
  | 'hp-loss'
  | 'victory'
  | 'defeat'
  | 'draw'
  | 'tie'
  | 'card-get'
  | 'toggle';

export type GameSoundOptions = {
  attribute?: string;
};

type AudioContextConstructor = typeof AudioContext;

const SFX_MASTER_VOLUME = 0.84;
const SFX_OUTPUT_MULTIPLIER = 5;
const SFX_TONE_BOOST = 2.4;
const MAX_TONE_VOLUME = 0.28;
const AUDIO_LOG_PREFIX = '[モンじゃん！ SE]';

let audioContext: AudioContext | null = null;
let masterGain: GainNode | null = null;
let outputLimiter: DynamicsCompressorNode | null = null;
let sfxVolume = 0.9;
let muted = false;
let resumePromise: Promise<boolean> | null = null;
let warnedUnsupported = false;

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function applyMasterVolume() {
  if (!masterGain || !audioContext) return;
  const value = muted
    ? 0.0001
    : Math.max(0.0001, SFX_MASTER_VOLUME * sfxVolume * SFX_OUTPUT_MULTIPLIER);
  masterGain.gain.setValueAtTime(value, audioContext.currentTime);
}

function configureOutputLimiter(context: AudioContext, limiter: DynamicsCompressorNode) {
  const now = context.currentTime;
  // 5倍した信号はほぼそのまま通し、0dB付近だけを強く抑えて音割れを防ぐ。
  limiter.threshold.setValueAtTime(-1, now);
  limiter.knee.setValueAtTime(0, now);
  limiter.ratio.setValueAtTime(20, now);
  limiter.attack.setValueAtTime(0.001, now);
  limiter.release.setValueAtTime(0.08, now);
}

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
  if (!AudioContextClass) {
    if (!warnedUnsupported) {
      warnedUnsupported = true;
      console.warn(`${AUDIO_LOG_PREFIX} このブラウザはWeb Audio APIに対応していません。`);
    }
    return null;
  }

  if (!audioContext || audioContext.state === 'closed') {
    try {
      audioContext = new AudioContextClass();
      masterGain = audioContext.createGain();
      outputLimiter = audioContext.createDynamicsCompressor();
      configureOutputLimiter(audioContext, outputLimiter);
      masterGain.connect(outputLimiter);
      outputLimiter.connect(audioContext.destination);
      applyMasterVolume();
    } catch (error) {
      audioContext = null;
      masterGain = null;
      outputLimiter = null;
      console.error(`${AUDIO_LOG_PREFIX} AudioContextを作成できませんでした。`, error);
      return null;
    }
  }
  return audioContext;
}

function ensureAudioRunning(context: AudioContext): Promise<boolean> {
  if (context.state === 'running') return Promise.resolve(true);
  if (context.state === 'closed') {
    console.error(`${AUDIO_LOG_PREFIX} AudioContextが閉じているため再生できません。`);
    return Promise.resolve(false);
  }

  if (!resumePromise) {
    resumePromise = context.resume()
      .then(() => {
        if (context.state !== 'running') {
          console.warn(`${AUDIO_LOG_PREFIX} AudioContextを再開できませんでした（state: ${context.state}）。`);
          return false;
        }
        return true;
      })
      .catch((error: unknown) => {
        console.error(`${AUDIO_LOG_PREFIX} AudioContextのresumeに失敗しました。`, error);
        return false;
      })
      .finally(() => {
        resumePromise = null;
      });
  }

  return resumePromise;
}

function scheduleTone(
  context: AudioContext,
  startTime: number,
  frequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  endFrequency?: number,
) {
  if (!masterGain) return;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const audibleVolume = Math.min(MAX_TONE_VOLUME, volume * SFX_TONE_BOOST);
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);
  if (endFrequency) {
    oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startTime + duration);
  }
  gain.gain.setValueAtTime(0.0001, startTime);
  gain.gain.exponentialRampToValueAtTime(audibleVolume, startTime + Math.min(0.018, duration / 3));
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  oscillator.connect(gain);
  gain.connect(masterGain);
  oscillator.start(startTime);
  oscillator.stop(startTime + duration + 0.02);
}

export function unlockGameAudio(): Promise<boolean> {
  const context = getAudioContext();
  if (!context) return Promise.resolve(false);
  return ensureAudioRunning(context);
}

export function setSfxVolume(value: number) {
  sfxVolume = clamp(value);
  applyMasterVolume();
}

export function setSfxMuted(value: boolean) {
  muted = value;
  applyMasterVolume();
}

function playAttributeAttack(context: AudioContext, now: number, attribute?: string) {
  switch (getAttributeTheme(attribute)) {
    case 'fire':
      scheduleTone(context, now, 170, 0.3, 0.07, 'sawtooth', 520);
      scheduleTone(context, now + 0.08, 680, 0.16, 0.04, 'square', 260);
      break;
    case 'water':
      scheduleTone(context, now, 260, 0.32, 0.065, 'sine', 620);
      scheduleTone(context, now + 0.09, 520, 0.22, 0.035, 'sine', 840);
      break;
    case 'nature':
      scheduleTone(context, now, 330, 0.26, 0.055, 'triangle', 660);
      scheduleTone(context, now + 0.07, 440, 0.24, 0.038, 'triangle', 760);
      break;
    case 'light':
      [784, 988, 1318].forEach((frequency, index) =>
        scheduleTone(context, now + index * 0.055, frequency, 0.2, 0.045, 'sine'));
      break;
    case 'dark':
      scheduleTone(context, now, 190, 0.38, 0.065, 'sawtooth', 64);
      scheduleTone(context, now + 0.04, 130, 0.3, 0.035, 'triangle', 52);
      break;
    case 'wind':
      scheduleTone(context, now, 210, 0.34, 0.06, 'triangle', 920);
      scheduleTone(context, now + 0.045, 360, 0.24, 0.035, 'sine', 1180);
      break;
    case 'earth':
      scheduleTone(context, now, 120, 0.32, 0.08, 'triangle', 52);
      scheduleTone(context, now + 0.08, 86, 0.24, 0.04, 'square', 48);
      break;
    default:
      scheduleTone(context, now, 250, 0.34, 0.075, 'sawtooth', 72);
      scheduleTone(context, now + 0.04, 420, 0.22, 0.035, 'triangle', 110);
  }
}

function scheduleGameSound(context: AudioContext, kind: GameSound, options: GameSoundOptions) {
  const now = context.currentTime + 0.008;

  switch (kind) {
    case 'start':
      [523.25, 659.25, 783.99].forEach((frequency, index) =>
        scheduleTone(context, now + index * 0.11, frequency, 0.2, 0.075, 'sine'));
      break;
    case 'select':
      scheduleTone(context, now, 720, 0.09, 0.05, 'sine', 920);
      break;
    case 'summon':
      scheduleTone(context, now, 196, 0.48, 0.06, 'triangle', 392);
      scheduleTone(context, now + 0.24, 523.25, 0.3, 0.045, 'sine', 783.99);
      scheduleTone(context, now + 0.42, 1046.5, 0.2, 0.035, 'sine');
      break;
    case 'janken-jan':
      scheduleTone(context, now, 220, 0.18, 0.06, 'triangle', 180);
      break;
    case 'janken-ken':
      scheduleTone(context, now, 294, 0.18, 0.06, 'triangle', 220);
      break;
    case 'janken-pon':
      scheduleTone(context, now, 147, 0.24, 0.08, 'triangle', 73);
      scheduleTone(context, now + 0.03, 588, 0.14, 0.045, 'sine');
      break;
    case 'reveal':
      scheduleTone(context, now, 740, 0.19, 0.05, 'sine', 1240);
      scheduleTone(context, now + 0.08, 988, 0.2, 0.04, 'sine');
      break;
    case 'star-showdown':
      [880, 1046.5, 1318.51].forEach((frequency, index) =>
        scheduleTone(context, now + index * 0.08, frequency, 0.18, 0.045, 'sine'));
      break;
    case 'attack':
      playAttributeAttack(context, now, options.attribute);
      break;
    case 'impact':
      scheduleTone(context, now, 115, 0.19, 0.1, 'triangle', 42);
      scheduleTone(context, now, 180, 0.1, 0.06, 'square', 70);
      break;
    case 'hp-loss':
      scheduleTone(context, now, 390, 0.28, 0.055, 'sine', 210);
      break;
    case 'victory':
      [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) =>
        scheduleTone(context, now + [0, 0.13, 0.26, 0.43][index], frequency, index === 3 ? 0.42 : 0.2, 0.075));
      break;
    case 'defeat':
      [392, 329.63, 261.63, 196].forEach((frequency, index) =>
        scheduleTone(context, now + index * 0.16, frequency, 0.23, 0.055, 'triangle'));
      break;
    case 'draw':
      scheduleTone(context, now, 392, 0.24, 0.055, 'sine');
      scheduleTone(context, now + 0.2, 440, 0.3, 0.055, 'sine');
      break;
    case 'tie':
      scheduleTone(context, now, 523.25, 0.2, 0.065, 'triangle', 392);
      scheduleTone(context, now + 0.17, 392, 0.25, 0.06, 'sine', 329.63);
      break;
    case 'card-get':
      [523.25, 659.25, 783.99, 987.77, 1046.5].forEach((frequency, index) =>
        scheduleTone(context, now + index * 0.1, frequency, index === 4 ? 0.5 : 0.2, 0.065, 'sine'));
      break;
    case 'toggle':
      scheduleTone(context, now, 660, 0.12, 0.045, 'sine', 820);
      break;
  }
}

function safelyScheduleGameSound(context: AudioContext, kind: GameSound, options: GameSoundOptions): boolean {
  try {
    scheduleGameSound(context, kind, options);
    return true;
  } catch (error) {
    console.error(`${AUDIO_LOG_PREFIX} 「${kind}」の再生準備に失敗しました。`, error);
    return false;
  }
}

export function playGameSound(kind: GameSound, options: GameSoundOptions = {}): Promise<boolean> {
  if (muted || sfxVolume <= 0) return Promise.resolve(false);
  const context = getAudioContext();
  if (!context) return Promise.resolve(false);

  if (context.state === 'running') {
    return Promise.resolve(safelyScheduleGameSound(context, kind, options));
  }

  return ensureAudioRunning(context).then((running) => {
    if (!running || context !== audioContext || muted || sfxVolume <= 0) return false;
    return safelyScheduleGameSound(context, kind, options);
  });
}

export function closeGameAudio() {
  if (audioContext) {
    void audioContext.close().catch((error: unknown) => {
      console.warn(`${AUDIO_LOG_PREFIX} AudioContextの終了処理に失敗しました。`, error);
    });
  }
  audioContext = null;
  masterGain = null;
  outputLimiter = null;
  resumePromise = null;
  warnedUnsupported = false;
}
