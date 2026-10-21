"""Whisper (small.en, via sherpa-onnx) round-trip transcriber for narration QA.

Usage: asr.py <list.json>   where list.json is [{"id": ..., "wav": ...}]
Prints [{"id": ..., "heard": "..."}] on stdout. A clip whose transcript drifts
from the script usually means a mispronounced word worth a lexicon entry.
"""
import json
import os
import sys

import numpy as np
import sherpa_onnx
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
MODEL = os.path.join(HERE, "..", "build", "models", "sherpa-onnx-whisper-small.en")


def main():
    items = json.load(open(sys.argv[1]))
    recognizer = sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=os.path.join(MODEL, "small.en-encoder.int8.onnx"),
        decoder=os.path.join(MODEL, "small.en-decoder.int8.onnx"),
        tokens=os.path.join(MODEL, "small.en-tokens.txt"),
        language="en",
        task="transcribe",
        num_threads=4,
    )
    out = []
    for item in items:
        samples, sr = sf.read(item["wav"], dtype="float32")
        if samples.ndim > 1:
            samples = samples.mean(axis=1)
        # pad: whisper clips the last word of very tight clips otherwise
        samples = np.concatenate([np.zeros(int(sr * 0.2), np.float32), samples, np.zeros(int(sr * 0.4), np.float32)])
        stream = recognizer.create_stream()
        stream.accept_waveform(sr, samples)
        recognizer.decode_stream(stream)
        out.append({"id": item["id"], "heard": stream.result.text.strip()})
    json.dump(out, sys.stdout)


if __name__ == "__main__":
    main()
