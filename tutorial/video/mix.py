"""Builds an episode's soundtrack before loudness normalization.

Usage: mix.py <narration.json> <timeline.json> <out.wav> [--no-foley] [--no-room]

- Narration: each sentence clip at its recorded time (beat narration start +
  the sentence's offset inside the beat).
- Room tone: pink noise around -62 dBFS, so the gaps between sentences sound
  like a quiet room rather than digital silence.
- Foley: soft mouse clicks and key taps at the moments the recorder logged
  real input, far below the voice.
"""
import argparse
import json

import numpy as np
import soundfile as sf

SR = 24000


def db(x):
    return 10 ** (x / 20)


def pink_noise(n, rng):
    white = rng.standard_normal(n)
    spectrum = np.fft.rfft(white)
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = f[1]
    spectrum /= np.sqrt(f)
    spectrum[f < 60] *= 0.2  # no rumble
    out = np.fft.irfft(spectrum, n)
    return out / (np.sqrt(np.mean(out ** 2)) + 1e-12)


def click_sound(rng, bright=1.0, length=0.03):
    n = int(SR * length)
    t = np.arange(n) / SR
    noise = rng.standard_normal(n)
    # crude band-pass: subtract a smoothed copy (high-pass), then smooth lightly
    smooth = np.convolve(noise, np.ones(9) / 9, mode="same")
    band = np.convolve(noise - smooth, np.ones(3) / 3, mode="same")
    env = np.exp(-t / (0.0045 * bright))
    body = 0.35 * np.sin(2 * np.pi * 1500 * t) * np.exp(-t / 0.006)
    s = (band * 0.8 + body) * env
    return s / (np.max(np.abs(s)) + 1e-12)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("narration")
    ap.add_argument("timeline")
    ap.add_argument("out")
    ap.add_argument("--no-foley", action="store_true")
    ap.add_argument("--no-room", action="store_true")
    args = ap.parse_args()

    narration = json.load(open(args.narration))
    tl = json.load(open(args.timeline))
    n = int(np.ceil(tl["end"] * SR)) + SR
    track = np.zeros(n, np.float32)
    rng = np.random.default_rng(7)

    starts = {b["beat"]: b["narrationStart"] for b in tl["beats"]}
    for beat in narration["beats"]:
        if beat["beat"] not in starts:
            continue
        for s in beat["sentences"]:
            clip, sr = sf.read(s["wav"], dtype="float32")
            if sr != SR:
                raise SystemExit(f"unexpected sample rate {sr} in {s['wav']}")
            at = int(round((starts[beat["beat"]] + s["start"]) * SR))
            end = min(n, at + len(clip))
            track[at:end] += clip[: end - at]

    if not args.no_room:
        track += (pink_noise(n, rng) * db(-62)).astype(np.float32)

    if not args.no_foley:
        clicks = [click_sound(rng, 1.0) for _ in range(6)]
        keys = [click_sound(rng, 0.55, 0.02) for _ in range(8)]
        for e in tl.get("events", []):
            at = int(round((e["t"] - tl["t0"]) * SR))
            if at < 0 or at >= n:
                continue
            if e["type"] == "click":
                s, level = clicks[rng.integers(len(clicks))], db(-35)
            else:
                s, level = keys[rng.integers(len(keys))], db(-41)
            end = min(n, at + len(s))
            track[at:end] += (s[: end - at] * level * rng.uniform(0.8, 1.1)).astype(np.float32)

    sf.write(args.out, track, SR, subtype="FLOAT")


if __name__ == "__main__":
    main()
