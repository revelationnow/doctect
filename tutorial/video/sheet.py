"""Contact sheets for visual QA: frames sampled from a finished video, labelled.

Usage: sheet.py <video.mp4> <samples.json> <out-prefix>
samples.json: [{"t": seconds, "label": "beat 3 · 00:41"}]. Writes
<out-prefix>-01.jpg, -02.jpg, … as 3×3 grids of 640×360 tiles.
"""
import json
import subprocess
import sys

import cv2
import numpy as np

TILE_W, TILE_H, COLS, ROWS = 640, 360, 3, 3


def frame_at(video, t):
    """Frame-accurate grab: ffmpeg decodes from the previous keyframe (OpenCV's
    millisecond seek lands mid-GOP and returns half-decoded frames)."""
    out = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-ss", f"{t:.3f}", "-i", video, "-frames:v", "1",
         "-vf", f"scale={TILE_W}:{TILE_H}:flags=area", "-f", "image2pipe", "-vcodec", "bmp", "-"],
        capture_output=True, check=False).stdout
    return cv2.imdecode(np.frombuffer(out, np.uint8), cv2.IMREAD_COLOR) if out else None


def main():
    video, samples_file, prefix = sys.argv[1:4]
    samples = json.load(open(samples_file))
    tiles = []
    for s in samples:
        frame = frame_at(video, s["t"])
        tile = frame if frame is not None else np.zeros((TILE_H, TILE_W, 3), np.uint8)
        cv2.rectangle(tile, (0, 0), (TILE_W, 26), (20, 20, 20), -1)
        cv2.putText(tile, s["label"][:70], (8, 18), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1, cv2.LINE_AA)
        tiles.append(tile)
    per = COLS * ROWS
    for n in range(0, len(tiles), per):
        page = tiles[n:n + per]
        page += [np.zeros((TILE_H, TILE_W, 3), np.uint8)] * (per - len(page))
        rows = [np.hstack(page[r * COLS:(r + 1) * COLS]) for r in range(ROWS)]
        cv2.imwrite(f"{prefix}-{n // per + 1:02d}.jpg", np.vstack(rows), [cv2.IMWRITE_JPEG_QUALITY, 88])
    print(f"{len(tiles)} samples → {(len(tiles) + per - 1) // per} sheets")


if __name__ == "__main__":
    main()
