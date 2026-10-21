"""Kokoro-82M narration synthesizer (local, CPU, no network at synthesis time).

Reads a job from argv[1] (JSON):
    {"voice": "af_heart", "speed": 0.94, "g2p": "misaki", "cacheDir": "...",
     "items": [{"id": "s0", "text": "spoken text"}]}
Writes one 24 kHz mono 16-bit WAV per unique (text, voice, speed, g2p) into
cacheDir, trims leading/trailing silence, and prints a JSON list on stdout:
    [{"id": "s0", "wav": "/abs/path.wav", "duration": 2.31, "cached": false}]

Model files live in tutorial/build/models (see tutorial/README.md for the
download commands). Cache keys include ENGINE_VERSION so changing trimming or G2P
behaviour here invalidates old clips.
"""
import hashlib
import json
import os
import sys

import numpy as np
import soundfile as sf

ENGINE_VERSION = "kokoro-v1.0/trim-2"
HERE = os.path.dirname(os.path.abspath(__file__))
MODELS = os.path.join(HERE, "..", "build", "models")
SAMPLE_RATE = 24000


def trim_silence(samples, sr, threshold_db=-48.0, keep_ms=40):
    """Cut leading/trailing near-silence, keeping a short natural tail."""
    if samples.size == 0:
        return samples
    frame = int(sr * 0.01)
    padded = np.pad(samples, (0, (-len(samples)) % frame))
    rms = np.sqrt(np.mean(padded.reshape(-1, frame) ** 2, axis=1) + 1e-12)
    loud = np.where(20 * np.log10(rms) > threshold_db)[0]
    if loud.size == 0:
        return samples[:0]
    keep = int(sr * keep_ms / 1000)
    start = max(0, loud[0] * frame - keep)
    end = min(len(samples), (loud[-1] + 1) * frame + keep * 2)
    out = samples[start:end].copy()
    # 8 ms fades so the cut points never click
    fade = min(int(sr * 0.008), len(out) // 2)
    if fade:
        ramp = np.linspace(0.0, 1.0, fade, dtype=out.dtype)
        out[:fade] *= ramp
        out[-fade:] *= ramp[::-1]
    return out


def make_g2p(kind):
    if kind == "espeak":
        return None  # kokoro-onnx phonemizes internally with espeak-ng
    from misaki import en, espeak

    fallback = espeak.EspeakFallback(british=False)
    return en.G2P(trf=False, british=False, fallback=fallback)


def main():
    job = json.load(open(sys.argv[1]))
    voice = job.get("voice", "af_heart")
    speed = float(job.get("speed", 1.0))
    g2p_kind = job.get("g2p", "misaki")
    cache_dir = job["cacheDir"]
    os.makedirs(cache_dir, exist_ok=True)

    kokoro = None
    g2p = None
    results = []
    for item in job["items"]:
        text = item["text"].strip()
        key = hashlib.sha256(
            json.dumps([ENGINE_VERSION, voice, speed, g2p_kind, text]).encode()
        ).hexdigest()[:20]
        wav = os.path.join(cache_dir, f"{key}.wav")
        cached = os.path.exists(wav)
        if not cached:
            if kokoro is None:
                from kokoro_onnx import Kokoro

                kokoro = Kokoro(
                    os.path.join(MODELS, "kokoro-v1.0.onnx"),
                    os.path.join(MODELS, "voices-v1.0.bin"),
                )
                g2p = make_g2p(g2p_kind)
            if g2p is not None:
                phonemes, _ = g2p(text)
                samples, sr = kokoro.create(phonemes, voice=voice, speed=speed, is_phonemes=True)
            else:
                samples, sr = kokoro.create(text, voice=voice, speed=speed, lang="en-us")
            samples = trim_silence(np.asarray(samples, dtype=np.float32), sr)
            sf.write(wav + ".tmp.wav", samples, sr, subtype="PCM_16")
            os.replace(wav + ".tmp.wav", wav)
        info = sf.info(wav)
        results.append({"id": item["id"], "wav": wav, "duration": info.frames / info.samplerate, "cached": cached})
        sys.stderr.write(f"{'cached' if cached else 'synth '} {results[-1]['duration']:5.2f}s  {text[:70]}\n")
    json.dump(results, sys.stdout)


if __name__ == "__main__":
    main()
