import { getAttributeTheme } from '../attributes';
import { assetUrl } from '../integration';

export type GameSound =
  | 'start'
  | 'select'
  | 'summon'
  | 'janken-jan'
  | 'janken-ken'
  | 'janken-pon'
  // じゃんけんぽんの 録音の声(jankenpon_01.wav。1回で じゃん・けん・ぽん の3つ)。
  // 鳴っているあいだは 合成音の janken-jan/ken/pon を止める。読めていないときは 鳴らない(合成音だけになる)
  | 'janken-voice'
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
  // 回復:下から上へ すべり上がる音 + キラキラ(カードバトルの回復カード・相手の回復)
  | 'heal'
  // パック開封:袋が ビリッと破れる / カードを1枚めくる(step で音程が上がる。rare は 高い音を重ねる)
  | 'pack-tear'
  | 'card-flip'
  | 'toggle'
  // 2026年11月18日に足した場面(効果音ラボの音。読めないときは SYNTH_FALLBACK の合成音)
  | 'merge'        // 合体
  | 'shuffle'      // 3まい ひく・いれかえ
  | 'cpu-put'      // 相手が カードを ふせる
  | 'seal'         // 封じ手の鎖
  | 'impact-big'   // とどめ・必殺技の命中
  | 'charge';      // ボスの ため技の予告(合成音のまま。star-showdown の合成音)

export type GameSoundOptions = {
  attribute?: string;
  /** card-flip:何枚目か(0 から。1枚ごとに 全音ずつ上がる) */
  step?: number;
  /** card-flip:レアなカード(★3・スキル・必殺技) */
  rare?: boolean;
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

// ---- じゃんけんぽんの声(録音) ----
export const JANKEN_VOICE_PATH = assetUrl('/audio/jankenpon_01.wav');
// 声の音量(masterGain で ×5 されるので、ここで下げる。耳で決める)
const JANKEN_VOICE_VOLUME = 0.22;
// 出力の遅れ(スピーカーに届くまで)を 声の頭を飛ばして取りかえす上限。wav の頭は 約60ms 無音
const JANKEN_VOICE_MAX_SKIP_SEC = 0.06;
let jankenVoice: AudioBuffer | null = null;
let jankenVoiceLoading: Promise<void> | null = null;
let jankenVoiceContext: AudioContext | null = null;
// 声が鳴り終わる時刻(context.currentTime)。それまでは 合成音の じゃん・けん・ぽん を重ねない
let jankenVoiceUntil = 0;
let warnedVoice = false;

/** 声の wav を前もって読みこむ(AudioContext ごとに1回。失敗したら 合成音のまま) */
function preloadJankenVoice(context: AudioContext) {
  if (jankenVoiceContext === context && (jankenVoice || jankenVoiceLoading)) return;
  if (typeof fetch !== 'function' || typeof context.decodeAudioData !== 'function') return;
  jankenVoiceContext = context;
  jankenVoice = null;
  jankenVoiceLoading = fetch(JANKEN_VOICE_PATH)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((data) => context.decodeAudioData(data))
    .then((buffer) => {
      if (jankenVoiceContext === context) jankenVoice = buffer;
    })
    .catch((error: unknown) => {
      if (!warnedVoice) {
        warnedVoice = true;
        console.warn(`${AUDIO_LOG_PREFIX} じゃんけんの声を読みこめませんでした(合成音で鳴らします): ${JANKEN_VOICE_PATH}`, error);
      }
    })
    .finally(() => {
      if (jankenVoiceContext === context) jankenVoiceLoading = null;
    });
}

/** 声を鳴らす。スピーカーまでの遅れの分だけ 頭(無音)を飛ばして、画面の拍と そろえる */
function playJankenVoice(context: AudioContext): boolean {
  if (!jankenVoice || !masterGain || jankenVoiceContext !== context) return false;
  const latency = (context.baseLatency ?? 0) + (context.outputLatency ?? 0);
  const skip = Math.min(JANKEN_VOICE_MAX_SKIP_SEC, Math.max(0, Number.isFinite(latency) ? latency : 0));
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = jankenVoice;
  gain.gain.setValueAtTime(JANKEN_VOICE_VOLUME, context.currentTime);
  source.connect(gain);
  gain.connect(masterGain);
  source.start(context.currentTime, skip);
  jankenVoiceUntil = context.currentTime + jankenVoice.duration - skip;
  return true;
}

// ---- 録音の効果音(効果音ラボ。2026年11月18日に依頼者が聴いて選んだ) ----
// ファイルは generator/static/sfx/ に置く(再配布禁止なので Git に入れない。会場の PC にだけ置く。どれが どの音かは generator/static/sounds/README.md)。
// サーバーが /static/sfx/ で配る。読めないとき(npm run dev・テスト・ファイルがない)は これまでの合成音で鳴らす。
// gain は耳で決める(masterGain で 約4倍されるので小さめ)。maxSec をこえる長い音は、終わりの FADE_SEC で消して止める
type SampleSpec = { file: string; gain?: number; maxSec?: number };
const SAMPLE_BASE = '/static/sfx/';
const SAMPLE_GAIN = 0.22;
const SAMPLE_FADE_SEC = 0.25;
type SampleKey = GameSound | `attack-${string}`;
export const SAMPLES: Partial<Record<SampleKey, SampleSpec>> = {
  start: { file: 'decision10.mp3', maxSec: 1.2 },
  'pack-tear': { file: 'treasure-chest1.mp3' },
  merge: { file: 'magic-statusup2.mp3' },
  shuffle: { file: 'card-shuffle1.mp3', maxSec: 1.6 },
  'cpu-put': { file: 'card-pick1.mp3' },
  // 攻撃(タイプは attributes.ts の getAttributeTheme。無 = default は合成音のまま)
  'attack-fire': { file: 'magic-flame1.mp3' },
  'attack-water': { file: 'sprinkle-water1.mp3' },
  'attack-nature': { file: 'dash-fallen-leaves1.mp3', maxSec: 1.2 },
  'attack-light': { file: 'magic-attack-holy1.mp3', maxSec: 1.5 },
  'attack-thunder': { file: 'magic-electron2.mp3' },
  'attack-dark': { file: 'magic-gravity1.mp3', maxSec: 1.4 },
  'attack-wind': { file: 'magic-wind1.mp3' },
  'attack-earth': { file: 'blow4.mp3' },
  impact: { file: 'blow2.mp3' },
  'impact-big': { file: 'super-arts-hit1.mp3' },
  'star-showdown': { file: 'aura2.mp3', maxSec: 2.5 },
  seal: { file: 'metal1.mp3' },
  heal: { file: 'gauge-recovery1.mp3' },
};
// 録音が読めないときに鳴らす合成音(新しく足した場面。charge は いつも合成音)
const SYNTH_FALLBACK: Partial<Record<GameSound, GameSound>> = {
  merge: 'card-get',
  shuffle: 'card-get',
  'cpu-put': 'select',
  seal: 'reveal',
  'impact-big': 'impact',
  charge: 'star-showdown',
};
const sampleBuffers = new Map<string, AudioBuffer>();
let samplesContext: AudioContext | null = null;
let warnedSamples = false;

/** 録音の効果音を前もって読みこむ(AudioContext ごとに1回。読めなかったものは 合成音のまま) */
function preloadSamples(context: AudioContext) {
  if (samplesContext === context) return;
  if (typeof fetch !== 'function' || typeof context.decodeAudioData !== 'function') return;
  samplesContext = context;
  sampleBuffers.clear();
  const files = [...new Set(Object.values(SAMPLES).map((spec) => spec!.file))];
  files.forEach((file) => {
    fetch(SAMPLE_BASE + file)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => context.decodeAudioData(data))
      .then((buffer) => {
        if (samplesContext === context) sampleBuffers.set(file, buffer);
      })
      .catch((error: unknown) => {
        if (!warnedSamples) {
          warnedSamples = true;
          console.warn(`${AUDIO_LOG_PREFIX} 録音の効果音を読みこめませんでした(合成音で鳴らします): ${SAMPLE_BASE}${file}`, error);
        }
      });
  });
}

/** 録音の効果音を鳴らす。読めていなければ false(合成音にまかせる) */
function playSample(context: AudioContext, key: SampleKey, now: number): boolean {
  const spec = SAMPLES[key];
  const buffer = spec && samplesContext === context ? sampleBuffers.get(spec.file) : undefined;
  if (!spec || !buffer || !masterGain) return false;
  const source = context.createBufferSource();
  const gain = context.createGain();
  const level = spec.gain ?? SAMPLE_GAIN;
  source.buffer = buffer;
  gain.gain.setValueAtTime(level, now);
  source.connect(gain);
  gain.connect(masterGain);
  source.start(now);
  if (spec.maxSec !== undefined && buffer.duration > spec.maxSec) {
    const fadeAt = Math.max(0, spec.maxSec - SAMPLE_FADE_SEC);
    gain.gain.setValueAtTime(level, now + fadeAt);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + spec.maxSec);
    source.stop(now + spec.maxSec + 0.02);
  }
  return true;
}

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
      preloadJankenVoice(audioContext);
      preloadSamples(audioContext);
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
    case 'thunder':
      // ジジッと鋭く下がる電気の音 + 低い ドン(録音 magic-electron2.mp3 が読めないときの音)
      scheduleTone(context, now, 1480, 0.14, 0.04, 'square', 220);
      scheduleTone(context, now + 0.03, 96, 0.36, 0.07, 'sawtooth', 44);
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

function scheduleGameSound(context: AudioContext, kind: GameSound, options: GameSoundOptions, synthOnly = false): boolean {
  const now = context.currentTime + 0.008;
  // 声が鳴っているあいだは 合成音の かけ声を重ねない
  if ((kind === 'janken-jan' || kind === 'janken-ken' || kind === 'janken-pon') && context.currentTime < jankenVoiceUntil) {
    return false;
  }
  // 録音があれば それを鳴らす(攻撃は タイプごと)。なければ 下の合成音
  // (代わりの合成音を鳴らすときは synthOnly。charge が star-showdown の録音にならないように)
  const sampleKey: SampleKey = kind === 'attack' ? `attack-${getAttributeTheme(options.attribute)}` : kind;
  if (!synthOnly && playSample(context, sampleKey, now)) return true;
  const fallback = SYNTH_FALLBACK[kind];
  if (fallback) return scheduleGameSound(context, fallback, options, true);

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
    case 'janken-voice':
      return playJankenVoice(context);
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
    case 'heal':
      scheduleTone(context, now, 392, 0.5, 0.06, 'sine', 1046.5);
      [1318.51, 1567.98, 2093].forEach((frequency, index) =>
        scheduleTone(context, now + 0.28 + index * 0.09, frequency, 0.22, 0.035, 'sine'));
      break;
    case 'pack-tear':
      // 高いところから 一気に すべり落ちる音を 少しずらして重ねる(紙が裂ける感じ)
      scheduleTone(context, now, 1800, 0.16, 0.05, 'sawtooth', 260);
      scheduleTone(context, now + 0.04, 1400, 0.18, 0.045, 'square', 200);
      scheduleTone(context, now + 0.2, 523.25, 0.3, 0.05, 'triangle', 1046.5);
      break;
    case 'card-flip': {
      const step = Math.max(0, options.step ?? 0);
      const base = 440 * 2 ** ((step * 2) / 12);
      scheduleTone(context, now, base, 0.1, 0.05, 'triangle', base * 1.5);
      if (options.rare) {
        scheduleTone(context, now + 0.06, base * 2, 0.32, 0.05, 'sine');
        scheduleTone(context, now + 0.12, base * 2.5, 0.36, 0.04, 'sine');
      }
      break;
    }
    case 'toggle':
      scheduleTone(context, now, 660, 0.12, 0.045, 'sine', 820);
      break;
  }
  return true;
}

function safelyScheduleGameSound(context: AudioContext, kind: GameSound, options: GameSoundOptions): boolean {
  try {
    return scheduleGameSound(context, kind, options);
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
  jankenVoice = null;
  jankenVoiceLoading = null;
  jankenVoiceContext = null;
  jankenVoiceUntil = 0;
  warnedVoice = false;
  sampleBuffers.clear();
  samplesContext = null;
  warnedSamples = false;
}
