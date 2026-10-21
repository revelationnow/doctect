"""Contact sheets for visual QA: frames sampled from a finished video, labelled.

Usage: sheet.py <video.mp4> <samples.json> <out-prefix>
samples.json: [{"t": seconds, "label": "beat 3 · 00:41"}]. Writes
<out-prefix>-01.jpg, -02.jpg, … as 3×3 grids of 640×360 tiles.
"""
import json
import sys

import cv2
import numpy as np

TILE_W, TILE_H, COLS, ROWS = 640, 360, 3, 3


def main():
    video, samples_file, prefix = sys.argv[1:4]
    samples = json.load(open(samples_file))
    cap = cv2.VideoCapture(video)
    tiles = []
    for s in samples:
        cap.set(cv2.CAP_PROP_POS_MSEC, s["t"] * 1000)
        ok, frame = cap.read()
        tile = cv2.resize(frame, (TILE_W, TILE_H), interpolation=cv2.INTER_AREA) if ok else np.zeros((TILE_H, TILE_W, 3), np.uint8)
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
