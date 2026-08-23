#!/usr/bin/env python3
"""What colours are actually IN a rendered frame, against the target bands.

WHY THIS, WHEN THE PREVIEW ALREADY MEASURES A PALETTE

verify-hero-composition.py measures the OFFLINE preview — a CPU rasterisation
of the placed world. That answers "did we build a colourful world". It cannot
answer "does the streamed frame look colourful", because everything between the
two is the renderer: exposure, the colour grade, the vignette, bloom, and the
stream's own encoder.

The gap turns out to be most of the story. On the frame captured 2026-08-23 the
preview's numbers and the live render's were not close:

                   preview   live
    green_foliage   25.2%     0.0%
    cream_white      8.3%     0.4%
    pink_rose_red    7.7%     2.1%
    gold_amber      13.6%     5.0%
    dark               --    45.7%

The founder's note asks for more colour. The palette is already there; nearly
half the delivered frame is below the classifier's shadow threshold, and colour
that has been crushed to black is not a palette problem.

    python3 measure-palette.py frame.png [more.png ...]
    python3 measure-palette.py --json frame.png

Uses the SAME classifier as the preview and as measure-reference.py, so the
three numbers are comparable. Needs ffmpeg to decode; no PIL, no engine, no GPU.
"""
import argparse
import importlib.util
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def _palette():
    spec = importlib.util.spec_from_file_location("palette", os.path.join(HERE, "palette.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decode(path, width=480):
    """RGB24 bytes via ffmpeg. Downscaled: this measures a DISTRIBUTION, and
    480x270 is ~130k samples — far past the point where more changes an answer
    quoted to a tenth of a percent, and it keeps the whole thing under a second
    on a two-core laptop."""
    height = int(round(width * 9 / 16))
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", path,
         "-vf", "scale=%d:%d" % (width, height), "-f", "rawvideo",
         "-pix_fmt", "rgb24", "-"],
        capture_output=True)
    if proc.returncode != 0 or not proc.stdout:
        raise SystemExit("measure-palette: ffmpeg could not decode %s\n%s"
                         % (path, proc.stderr.decode("utf8", "replace")[:400]))
    return proc.stdout


def measure(path, pal):
    buf = decode(path)
    counts = {}
    n = len(buf) // 3
    for i in range(n):
        fam = pal.classify(buf[i * 3], buf[i * 3 + 1], buf[i * 3 + 2])
        counts[fam] = counts.get(fam, 0) + 1
    return pal.percentages(counts, n), n


def target_bands():
    """The bands visual-target.json already states, so this tool does not
    invent a second opinion about what the world should look like."""
    path = os.path.join(HERE, "..", "WorldDesign", "visual-target.json")
    try:
        doc = json.load(open(os.path.normpath(path)))
    except Exception:
        return {}
    out = {}
    for name, crit in (doc.get("criteria") or {}).items():
        metric = crit.get("metric", "")
        if not metric.startswith("palette_pct."):
            continue
        fam = metric.split(".", 1)[1]
        lo, hi = crit.get("min"), crit.get("max")
        if lo is not None or hi is not None:
            out[fam] = (lo, hi)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("frames", nargs="+")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    pal = _palette()
    bands = target_bands()
    results = {}
    for path in args.frames:
        pct, n = measure(path, pal)
        results[path] = pct
        if args.json:
            continue
        print("%s  (%d samples)" % (os.path.basename(path), n))
        for fam in pal.FAMILIES:
            v = pct.get(fam, 0.0)
            lo, hi = bands.get(fam, (None, None))
            mark = "   "
            if lo is not None and v < lo:
                mark = "LOW"
            elif hi is not None and v > hi:
                mark = "HI "
            band = ""
            if lo is not None or hi is not None:
                band = "  target %s-%s" % ("%.1f" % lo if lo is not None else "",
                                           "%.1f" % hi if hi is not None else "")
            print("   %-19s %5.1f%%  %s %-26s%s"
                  % (fam, v, mark, "#" * int(v / 2), band))
        # DARK IS NOT A FAMILY, IT IS THE CEILING ON ALL THE OTHERS. Every
        # point of it is a pixel with no colour left to classify, so a frame
        # cannot gain colour anywhere else without this coming down.
        print("   %-19s %5.1f%%  of the frame has no colour left to classify"
              % ("(dark)", pct.get("dark", 0.0)))
        print()

    if args.json:
        json.dump(results, sys.stdout, indent=2)
        sys.stdout.write("\n")


if __name__ == "__main__":
    main()
