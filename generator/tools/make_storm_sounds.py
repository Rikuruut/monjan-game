"""がったい中の嵐の 仮の音を作る(2026年11月16日)。

    .venv\\Scripts\\python.exe -m tools.make_storm_sounds

static/sounds/ に 4つの wav を書き出す(モノラル・22050Hz・16bit。乱数の種を固定してあるので 毎回同じ音):
  thunder.wav … 落雷:バリッと はじけて、低いドーンと ゴロゴロの余韻
  rumble.wav  … 遠くの稲光:遠くの低いゴロゴロ
  gust.wav    … 突風:ヒューッと 強まって 弱まる風
  storm.wav   … 雨(ザーッ)+ 風のうなり。くり返し流すので、はしを重ねて つなぎ目を消してある
  zap.wav     … がったい中の連打(雷パワーを ためる):短い ビリッ

いまの効果音(press など)と同じく **仮の音**。素材が決まったら 同じ名前のファイルを置きかえる(static/sounds/README.md)。
numpy は入っていないので、Python に最初から入っている道具だけで作る。
"""

from __future__ import annotations

import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT_DIR = Path(__file__).resolve().parent.parent / "static" / "sounds"


def lowpass(samples: list[float], cutoff: float) -> list[float]:
    """1次の ローパス(cutoff Hz より高い音を弱める)"""
    a = 1 - math.exp(-2 * math.pi * cutoff / RATE)
    y = 0.0
    out = []
    for x in samples:
        y += a * (x - y)
        out.append(y)
    return out


def highpass(samples: list[float], cutoff: float) -> list[float]:
    """1次の ハイパス(cutoff Hz より低い音を弱める)"""
    low = lowpass(samples, cutoff)
    return [x - l for x, l in zip(samples, low)]


def noise(rng: random.Random, seconds: float) -> list[float]:
    return [rng.uniform(-1, 1) for _ in range(int(RATE * seconds))]


def normalize(samples: list[float], peak: float) -> list[float]:
    top = max(abs(s) for s in samples) or 1
    return [s * peak / top for s in samples]


def fade_edges(samples: list[float], fade_in: float = 0.005, fade_out: float = 0.05) -> list[float]:
    """はしで ぷつっと鳴らないよう、はじめと終わりを 少しだけ フェード"""
    n_in, n_out = int(RATE * fade_in), int(RATE * fade_out)
    out = list(samples)
    for i in range(min(n_in, len(out))):
        out[i] *= i / n_in
    for i in range(min(n_out, len(out))):
        out[-1 - i] *= i / n_out
    return out


def slow_wobble(rng: random.Random, seconds: float, speeds: tuple[float, ...]) -> list[float]:
    """ゆっくり ゆれる大きさ(0〜1)。いくつかの 遅い波を 重ねる"""
    phases = [rng.uniform(0, 2 * math.pi) for _ in speeds]
    out = []
    for i in range(int(RATE * seconds)):
        t = i / RATE
        v = sum(math.sin(2 * math.pi * f * t + p) for f, p in zip(speeds, phases)) / len(speeds)
        out.append(0.5 + 0.5 * v)
    return out


def make_thunder(rng: random.Random) -> list[float]:
    seconds = 2.6
    n = int(RATE * seconds)
    # バリッ:高い音の ノイズが 一瞬で消える + 小さな はじけ
    crack = highpass(noise(rng, seconds), 1200)
    # ドーン:低い音のノイズ(2回 通して さらに低く)
    boom = lowpass(lowpass(noise(rng, seconds), 140), 140)
    # ゴロゴロ:もっと低い音を、ゆっくり ゆらしながら 長く
    roll = lowpass(lowpass(noise(rng, seconds), 70), 70)
    wobble = slow_wobble(rng, seconds, (3.1, 5.3, 7.7))
    boom, roll = normalize(boom, 1), normalize(roll, 1)
    out = []
    for i in range(n):
        t = i / RATE
        c = crack[i] * math.exp(-t / 0.035) * 0.9
        b = boom[i] * min(1, t / 0.015) * math.exp(-t / 0.55)
        r = roll[i] * min(1, t / 0.25) * math.exp(-t / 1.1) * (0.4 + 0.6 * wobble[i])
        out.append(c + b * 1.0 + r * 0.8)
    return fade_edges(normalize(out, 0.92))


def make_rumble(rng: random.Random) -> list[float]:
    seconds = 2.2
    roll = normalize(lowpass(lowpass(noise(rng, seconds), 85), 85), 1)
    wobble = slow_wobble(rng, seconds, (2.3, 4.1, 6.7))
    out = []
    for i, x in enumerate(roll):
        t = i / RATE
        env = min(1, t / 0.35) * math.exp(-max(0, t - 0.35) / 0.8)
        out.append(x * env * (0.35 + 0.65 * wobble[i]))
    return fade_edges(normalize(out, 0.7), fade_in=0.02, fade_out=0.2)


def make_gust(rng: random.Random) -> list[float]:
    seconds = 1.3
    n = int(RATE * seconds)
    src = noise(rng, seconds)
    # 風の高さ(フィルタ)を 上げてから 下げる = ヒューッ
    y_low, y_high = 0.0, 0.0
    out = []
    for i, x in enumerate(src):
        t = i / n
        cutoff = 300 + 1500 * math.sin(math.pi * t) ** 1.5
        a = 1 - math.exp(-2 * math.pi * cutoff / RATE)
        y_low += a * (x - y_low)
        b = 1 - math.exp(-2 * math.pi * (cutoff * 0.35) / RATE)
        y_high += b * (y_low - y_high)
        band = y_low - y_high
        env = math.sin(math.pi * t) ** 2
        out.append(band * env)
    return fade_edges(normalize(out, 0.8))


def make_zap(rng: random.Random) -> list[float]:
    """連打の「ビリッ」:電気が はじける短い音(高い音のノイズ + 下がっていく ブザー)"""
    seconds = 0.16
    n = int(RATE * seconds)
    hiss = highpass(noise(rng, seconds), 2500)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / RATE
        freq = 900 - 500 * (t / seconds)
        phase += 2 * math.pi * freq / RATE
        buzz = 1.0 if math.sin(phase) > 0 else -1.0   # 四角い波(ジジッ)
        env = min(1, t / 0.003) * math.exp(-t / 0.045)
        out.append((hiss[i] * 0.7 + buzz * 0.35) * env)
    return fade_edges(normalize(out, 0.8), fade_in=0.002, fade_out=0.02)


def make_storm_loop(rng: random.Random) -> list[float]:
    """雨 + 風(8秒のくり返し)。9秒作り、終わりの1秒を はじめの1秒に重ねて つなぎ目を消す"""
    loop, overlap = 8.0, 1.0
    total = loop + overlap
    n = int(RATE * total)
    # 雨:高い音のノイズ(ザーッ)+ ときどき 大きめの雨つぶ(ぱらっ)
    rain = highpass(noise(rng, total), 1500)
    rain = lowpass(rain, 6000)
    drops = [0.0] * n
    for _ in range(int(total * 45)):
        start = rng.randrange(n - 400)
        amp = rng.uniform(0.3, 1)
        for k in range(300):
            drops[start + k] += rng.uniform(-1, 1) * amp * math.exp(-k / 40)
    drops = highpass(drops, 2500)
    # 風:低いノイズを ゆっくり ゆらす(うなり)
    wind = normalize(lowpass(lowpass(noise(rng, total), 260), 260), 1)
    wobble = slow_wobble(rng, total, (0.17, 0.29, 0.41))
    rain, drops = normalize(rain, 1), normalize(drops, 1)
    mixed = [rain[i] * 0.55 + drops[i] * 0.25 + wind[i] * (0.25 + 0.5 * wobble[i]) for i in range(n)]
    n_loop, n_over = int(RATE * loop), int(RATE * overlap)
    out = mixed[:n_loop]
    for i in range(n_over):
        w = i / n_over
        out[i] = mixed[i] * w + mixed[n_loop + i] * (1 - w)
    return normalize(out, 0.7)


def write_wav(name: str, samples: list[float]) -> None:
    path = OUT_DIR / name
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(RATE)
        f.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s)) * 32767)) for s in samples))
    print(f"{path.name}: {len(samples) / RATE:.1f}秒 / {path.stat().st_size // 1024}KB")


def main() -> None:
    rng = random.Random(20261116)
    write_wav("thunder.wav", make_thunder(rng))
    write_wav("rumble.wav", make_rumble(rng))
    write_wav("gust.wav", make_gust(rng))
    write_wav("storm.wav", make_storm_loop(rng))
    # 連打の音は あとから足した(上の4つの乱数の並びを変えないよう、別の種で作る)
    write_wav("zap.wav", make_zap(random.Random(20261117)))


if __name__ == "__main__":
    main()
