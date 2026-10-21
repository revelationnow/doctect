"""Resamples timestamped screencast frames into a constant-frame-rate H.264 video.

Usage: compose.py <frames-dir> <timeline.json> <out.mp4> [--fps 30] [--crf 18]

The screencast only emits frames when the page repaints, each stamped with
wall-clock time; output frame k shows the newest capture at or before
t0 + k/fps. Zooms logged by the recorder (scale, centre, duration) are eased
in and out here with sub-pixel affine resampling, so text stays crisp.
"""
import argparse
import bisect
import json
import os
import subprocess
import sys

import cv2
import numpy as np


def ease(u):
    u = min(1.0, max(0.0, u))
    return 4 * u * u * u if u < 0.5 else 1 - pow(-2 * u + 2, 3) / 2


def zoom_track(zooms, width, height):
    """Returns f(t_abs) -> (scale, cx, cy), easing from wherever the previous move was."""
    events = sorted(zooms, key=lambda z: z["t"])
    rest = (1.0, width / 2, height / 2)

    def state(t):
        current = rest
        for i, z in enumerate(events):
            if t < z["t"]:
                break
            # each move runs until now, or until the next move takes over
            until = min(t, events[i + 1]["t"]) if i + 1 < len(events) else t
            u = ease((until - z["t"]) / max(0.05, z["duration"]))
            target = (z["scale"], z["cx"], z["cy"])
            current = tuple(a + (b - a) * u for a, b in zip(current, target))
        return current

    return state


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames")
    ap.add_argument("timeline")
    ap.add_argument("out")
    ap.add_argument("--fps", type=int, default=30)
    ap.add_argument("--crf", type=int, default=18)
    ap.add_argument("--preset", default="medium")
    args = ap.parse_args()

    tl = json.load(open(args.timeline))
    width, height = tl["video"]["width"], tl["video"]["height"]
    t0, duration = tl["t0"], tl["end"]
    frames = [json.loads(line) for line in open(os.path.join(args.frames, "frames.jsonl")) if line.strip()]
    if not frames:
        sys.exit("no frames captured")
    times = [f["t"] for f in frames]
    zoom_at = zoom_track(tl.get("zooms", []), width, height)

    ff = subprocess.Popen([
        "ffmpeg", "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", str(args.fps), "-i", "-",
        "-c:v", "libx264", "-preset", args.preset, "-crf", str(args.crf), "-pix_fmt", "yuv420p",
        "-movflags", "+faststart", args.out,
    ], stdin=subprocess.PIPE)

    total = int(round(duration * args.fps))
    cache_idx, cache_img = -1, None
    blank = np.zeros((height, width, 3), np.uint8)
    for k in range(total):
        t = t0 + k / args.fps
        idx = bisect.bisect_right(times, t) - 1
        idx = max(idx, 0)
        if idx != cache_idx:
            img = cv2.imread(os.path.join(args.frames, frames[idx]["file"]), cv2.IMREAD_COLOR)
            if img is None:
                img = cache_img if cache_img is not None else blank
            elif img.shape[1] != width or img.shape[0] != height:
                img = cv2.resize(img, (width, height), interpolation=cv2.INTER_AREA)
            cache_idx, cache_img = idx, img
        out = cache_img
        scale, cx, cy = zoom_at(t)
        if scale > 1.001:
            vw, vh = width / scale, height / scale
            x0 = min(max(cx - vw / 2, 0), width - vw)
            y0 = min(max(cy - vh / 2, 0), height - vh)
            m = np.float32([[scale, 0, -x0 * scale], [0, scale, -y0 * scale]])
            out = cv2.warpAffine(cache_img, m, (width, height), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        ff.stdin.write(out.tobytes())
        if k % (args.fps * 30) == 0:
            sys.stderr.write(f"\rcompose {k / args.fps:6.1f}s / {duration:.1f}s")
    ff.stdin.close()
    if ff.wait() != 0:
        sys.exit("ffmpeg failed")
    sys.stderr.write(f"\rcompose {duration:.1f}s / {duration:.1f}s — done\n")


if __name__ == "__main__":
    main()
