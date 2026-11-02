import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  closeGameAudio,
  playGameSound,
  setSfxMuted,
  setSfxVolume,
  unlockGameAudio,
  type GameSound,
} from './gameAudio';

type FakeParam = {
  setValueAtTime: ReturnType<typeof vi.fn>;
  exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
};

type FakeOscillator = {
  type: OscillatorType;
  frequency: FakeParam;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type FakeCompressor = {
  threshold: FakeParam;
  knee: FakeParam;
  ratio: FakeParam;
  attack: FakeParam;
  release: FakeParam;
  connect: ReturnType<typeof vi.fn>;
};

const ALL_SOUNDS: GameSound[] = [
  'start',
  'select',
  'summon',
  'rarity',
  'janken',
  'janken-jan',
  'janken-ken',
  'janken-pon',
  'reveal',
  'star-showdown',
  'attack',
  'impact',
  'hp-loss',
  'victory',
  'defeat',
  'draw',
  'tie',
  'card-get',
  'toggle',
];

function installFakeAudioContext(options: {
  initialState?: AudioContextState;
  resumeError?: Error;
} = {}) {
  const oscillators: FakeOscillator[] = [];
  const gains: Array<{ gain: FakeParam; connect: ReturnType<typeof vi.fn> }> = [];
  const compressors: FakeCompressor[] = [];
  const contexts: FakeAudioContext[] = [];
  const makeParam = (): FakeParam => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });

  class FakeAudioContext {
    state: AudioContextState = options.initialState ?? 'running';
    currentTime = 1;
    destination = {};
    resume = vi.fn(async () => {
      if (options.resumeError) throw options.resumeError;
      await Promise.resolve();
      this.state = 'running';
    });
    close = vi.fn(async () => { this.state = 'closed'; });

    constructor() {
      contexts.push(this);
    }

    createOscillator() {
      const oscillator: FakeOscillator = {
        type: 'sine' as OscillatorType,
        frequency: makeParam(),
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      oscillators.push(oscillator);
      return oscillator;
    }

    createGain() {
      const gain = { gain: makeParam(), connect: vi.fn() };
      gains.push(gain);
      return gain;
    }

    createDynamicsCompressor() {
      const compressor: FakeCompressor = {
        threshold: makeParam(),
        knee: makeParam(),
        ratio: makeParam(),
        attack: makeParam(),
        release: makeParam(),
        connect: vi.fn(),
      };
      compressors.push(compressor);
      return compressor;
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext);
  return { compressors, contexts, gains, oscillators };
}

function firstFrequency(oscillator: FakeOscillator): number {
  return Number(oscillator.frequency.setValueAtTime.mock.calls[0][0]);
}

describe('会場用効果音', () => {
  beforeEach(() => {
    setSfxMuted(false);
    setSfxVolume(0.75);
  });

  afterEach(() => {
    closeGameAudio();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('Web Audio未対応環境では例外を出さずfalseを返す', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const results = await Promise.all(ALL_SOUNDS.map((sound) =>
      playGameSound(sound, sound === 'attack' ? { attribute: '水' } : undefined)));

    expect(results.every((played) => played === false)).toBe(true);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Web Audio API'));
  });

  it('全イベント音をブラウザ内で生成し、すべて停止時刻を予約する', () => {
    const { oscillators } = installFakeAudioContext();

    ALL_SOUNDS.forEach((sound) => {
      const before = oscillators.length;
      playGameSound(sound, sound === 'attack' ? { attribute: '水' } : undefined);
      expect(oscillators.length).toBeGreaterThan(before);
    });

    expect(oscillators.every((oscillator) => oscillator.start.mock.calls.length === 1)).toBe(true);
    expect(oscillators.every((oscillator) => oscillator.stop.mock.calls.length === 1)).toBe(true);
  });

  it('召喚・公開・星勝負・あいこ・カード獲得に専用の音列を生成する', () => {
    const { oscillators } = installFakeAudioContext();
    const soundLengths: Array<[GameSound, number]> = [
      ['summon', 3],
      ['reveal', 2],
      ['star-showdown', 3],
      ['tie', 2],
      ['card-get', 5],
    ];

    soundLengths.forEach(([sound, expectedLength]) => {
      const before = oscillators.length;
      playGameSound(sound);
      expect(oscillators.length - before).toBe(expectedLength);
    });
  });

  it('じゃん・けん・ぽんを別々の音程とアクセントで生成する', () => {
    const { oscillators } = installFakeAudioContext();

    playGameSound('janken-jan');
    const jan = oscillators.slice();
    playGameSound('janken-ken');
    const ken = oscillators.slice(jan.length);
    playGameSound('janken-pon');
    const pon = oscillators.slice(jan.length + ken.length);

    expect(jan).toHaveLength(1);
    expect(ken).toHaveLength(1);
    expect(pon).toHaveLength(2);
    expect([firstFrequency(jan[0]), firstFrequency(ken[0]), firstFrequency(pon[0])])
      .toEqual([220, 294, 147]);
  });

  it.each([
    ['火', 170, 'sawtooth'],
    ['水', 260, 'sine'],
    ['草', 330, 'triangle'],
    ['光', 784, 'sine'],
    ['闇', 190, 'sawtooth'],
    ['風', 210, 'triangle'],
    ['土', 120, 'triangle'],
    ['不明', 250, 'sawtooth'],
  ] as const)('%s属性に対応した攻撃音を生成する', (attribute, frequency, type) => {
    const { oscillators } = installFakeAudioContext();

    playGameSound('attack', { attribute });

    expect(oscillators.length).toBeGreaterThan(0);
    expect(firstFrequency(oscillators[0])).toBe(frequency);
    expect(oscillators[0].type).toBe(type);
  });

  it('マスター音量を0〜1に制限し、ミュート中は音を生成しない', () => {
    const { gains, oscillators } = installFakeAudioContext();
    unlockGameAudio();
    const masterGain = gains[0].gain.setValueAtTime;

    setSfxVolume(2);
    expect(masterGain).toHaveBeenLastCalledWith(4.2, 1);

    setSfxVolume(0.4);
    expect(masterGain.mock.calls.at(-1)?.[0]).toBeCloseTo(1.68);
    expect(masterGain.mock.calls.at(-1)?.[1]).toBe(1);

    setSfxMuted(true);
    expect(masterGain).toHaveBeenLastCalledWith(0.0001, 1);
    playGameSound('attack');
    expect(oscillators).toHaveLength(0);

    setSfxMuted(false);
    setSfxVolume(-1);
    playGameSound('victory');
    expect(oscillators).toHaveLength(0);
  });

  it('現在の出力を5倍にし、最終段リミッターでクリップを防ぐ', async () => {
    const { compressors, gains } = installFakeAudioContext();

    await expect(playGameSound('impact')).resolves.toBe(true);
    setSfxVolume(1);

    expect(gains[0].gain.setValueAtTime).toHaveBeenLastCalledWith(0.84 * 5, 1);
    expect(gains[0].connect).toHaveBeenCalledWith(compressors[0]);
    expect(compressors[0].threshold.setValueAtTime).toHaveBeenCalledWith(-1, 1);
    expect(compressors[0].knee.setValueAtTime).toHaveBeenCalledWith(0, 1);
    expect(compressors[0].ratio.setValueAtTime).toHaveBeenCalledWith(20, 1);
    expect(compressors[0].attack.setValueAtTime).toHaveBeenCalledWith(0.001, 1);
    expect(compressors[0].release.setValueAtTime).toHaveBeenCalledWith(0.08, 1);
    expect(compressors[0].connect).toHaveBeenCalledTimes(1);
  });

  it('個々の音を聞き取りやすく増幅し、安全な音量内で生成してtrueを返す', async () => {
    const { gains } = installFakeAudioContext();

    await expect(playGameSound('impact')).resolves.toBe(true);

    const firstToneRamp = gains[1].gain.exponentialRampToValueAtTime;
    const secondToneRamp = gains[2].gain.exponentialRampToValueAtTime;
    expect(firstToneRamp.mock.calls[0][0]).toBeCloseTo(0.24);
    expect(secondToneRamp.mock.calls[0][0]).toBeCloseTo(0.144);
    expect(gains.slice(1).every(({ gain }) =>
      Number(gain.exponentialRampToValueAtTime.mock.calls[0][0]) <= 0.28)).toBe(true);
  });

  it('ミュートまたは音量0なら生成せずfalseを返す', async () => {
    const { oscillators } = installFakeAudioContext();

    setSfxMuted(true);
    await expect(playGameSound('start')).resolves.toBe(false);
    setSfxMuted(false);
    setSfxVolume(0);
    await expect(playGameSound('start')).resolves.toBe(false);

    expect(oscillators).toHaveLength(0);
  });

  it('停止中のAudioContextを1回だけresumeし、再開後に待機中のSEを鳴らす', async () => {
    const { contexts, oscillators } = installFakeAudioContext({ initialState: 'suspended' });

    const unlocked = unlockGameAudio();
    const played = playGameSound('start');
    expect(oscillators).toHaveLength(0);

    await expect(unlocked).resolves.toBe(true);
    await expect(played).resolves.toBe(true);

    expect(contexts[0].resume).toHaveBeenCalledTimes(1);
    expect(oscillators).toHaveLength(3);
  });

  it('AudioContextのresume失敗を開発者へ通知し、SEを生成しない', async () => {
    const resumeError = new Error('autoplay blocked');
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { oscillators } = installFakeAudioContext({ initialState: 'suspended', resumeError });

    const unlocked = unlockGameAudio();
    const played = playGameSound('start');

    await expect(unlocked).resolves.toBe(false);
    await expect(played).resolves.toBe(false);

    expect(oscillators).toHaveLength(0);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('resumeに失敗'),
      resumeError,
    );
  });
});
