#!/usr/bin/env python3
"""Is Wonderland soft because of the RENDERER, or because of the STREAM?

    python3 compare-native-stream.py native.png streamed.png

THE REASON THIS EXISTS

"Too blurry" has two causes that need opposite fixes:

  A. the RENDERER — TSR history, screen percentage, texture mips, fog, DOF,
     the Marble mesh's own texture resolution;
  B. the STREAM — H264 quantisation, the bitrate ceiling, encoder preset.

Every sharpness measurement this project has taken came off a Pixel Streaming
capture, which cannot separate them. A session has already gone into sweeping
sharpen values against a frame that had been through H264 — work that could not
have succeeded whatever the values were.

THE METRIC AND ITS ONE TRAP

Acutance — mean absolute luma gradient. It is SCALE DEPENDENT: the same image
measured at 1920 wide and 1280 wide gives different numbers, and a comparison
across different sizes measures the resampler. Both frames are therefore
decoded at one fixed width, and a size mismatch in the SOURCES is reported
rather than silently normalised, because a native 4K frame against a streamed
1080p one is not a like-for-like test however carefully it is scaled.

Needs ffmpeg. No PIL, no engine, no GPU.
"""
import argparse
import os
import subprocess
import sys

WIDTH = 1280           # one size for both, so the number means one thing
HEIGHT = 720


def probe_size(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", path],
        capture_output=True, text=True)
    txt = (out.stdout or "").strip()
    if "x" in txt:
        w, _, h = txt.partition("x")
        try:
            return int(w), int(h)
        except ValueError:
            pass
    return None, None


def luma(path):
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path,
         "-vf", "scale=%d:%d,format=gray" % (WIDTH, HEIGHT),
         "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        raise SystemExit("compare-native-stream: could not decode %s\n%s"
                         % (path, proc.stderr.decode("utf8", "replace")[:300]))
    return proc.stdout


def acutance(buf):
    """Mean |gradient| over the frame. Higher is crisper."""
    total, n = 0, 0
    for y in range(0, HEIGHT):
        row = y * WIDTH
        for x in range(0, WIDTH - 1, 2):        # every other pixel: same answer, half the time
            total += abs(buf[row + x + 1] - buf[row + x])
            n += 1
    for y in range(0, HEIGHT - 1, 2):
        row, nxt = y * WIDTH, (y + 1) * WIDTH
        for x in range(0, WIDTH, 2):
            total += abs(buf[nxt + x] - buf[row + x])
            n += 1
    return total / float(n or 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("native")
    ap.add_argument("streamed")
    ap.add_argument("--tolerance", type=float, default=0.06,
                    help="relative difference below which the two are called equal")
    args = ap.parse_args()

    for p in (args.native, args.streamed):
        if not os.path.isfile(p):
            raise SystemExit("compare-native-stream: no such file: %s" % p)

    nw, nh = probe_size(args.native)
    sw, sh = probe_size(args.streamed)
    print("native   %s  %sx%s" % (os.path.basename(args.native), nw, nh))
    print("streamed %s  %sx%s" % (os.path.basename(args.streamed), sw, sh))
    if None not in (nw, sw) and (nw, nh) != (sw, sh):
        # NOT normalised away. A native 4K frame against a streamed 1080p one is
        # not a like-for-like test however carefully it is scaled, and calling it
        # one is how "4K does not help" got recorded as a finding once already.
        print("\n  ! THE SOURCES ARE DIFFERENT SIZES (%sx%s vs %sx%s)." % (nw, nh, sw, sh))
        print("    Any difference below includes the resampler. Re-capture both")
        print("    at the same resolution before drawing a conclusion.")

    na = acutance(luma(args.native))
    sa = acutance(luma(args.streamed))
    rel = (na - sa) / na if na else 0.0

    print("\n  native   acutance %6.3f" % na)
    print("  streamed acutance %6.3f" % sa)
    print("  the stream costs %+.1f%% of the rendered detail" % (rel * 100.0))

    print()
    if rel > args.tolerance:
        print("  VERDICT: THE STREAM IS THE SOFT LINK.")
        print("    The renderer is producing detail the encoder is not delivering.")
        print("    Look at bitrate, quantisation range, encoder preset and codec")
        print("    BEFORE touching TSR, screen percentage or sharpening — those")
        print("    can only add detail the encoder is already discarding.")
    elif rel < -args.tolerance:
        print("  VERDICT: THE STREAMED FRAME IS CRISPER THAN THE NATIVE ONE.")
        print("    That is not a sharpness win — it is a sign the two frames are")
        print("    not the same shot: different camera, different settle, or")
        print("    encoder sharpening. Do not read a renderer conclusion from it.")
    else:
        print("  VERDICT: THE RENDERER IS THE SOFT LINK.")
        print("    The encoder is delivering essentially what it was given, so")
        print("    the softness is upstream: TSR history, screen percentage,")
        print("    texture mips and resolution, fog, DOF, or the source asset.")


if __name__ == "__main__":
    main()
