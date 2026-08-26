#!/usr/bin/env python3
"""MEASURED comparison of a real V2 render against the reference view at the
same camera. Ranks the largest regional differences so a render becomes a
fix list. stdlib + ffmpeg (decode/scale only).

    python3 wonderland/v2/tools/diff_v2.py RENDER.png REFERENCE_VIEW.png [--grid 6x4] [--json out.json]

Per grid cell, on both images scaled to the same size:
  luma   mean luminance (0..1, sRGB-decoded to linear then back: perceptual
         enough for ranking, not a radiometric claim)
  chroma mean colourfulness (distance from grey in a YCbCr-like space)
  hue    mean hue angle of the coloured pixels (degrees), for "pink vs tan"
  edges  mean Sobel gradient magnitude (detail / clutter)
  bright fraction of pixels with sRGB mean > 150 (sky, clouds, pale stone)
  blue   fraction of blue-leaning pixels (b > r+4 and b >= g), any brightness
The five cells with the largest combined difference are printed with which
metric drives them; the whole table goes to --json for the pass record.
This measures the DIFFERENCE. It never says the render matches.
"""
import json
import math
import os
import subprocess
import sys


def load(path, w, h):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=%d:%d:flags=area" % (w, h),
                          "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], check=True, capture_output=True).stdout
    if len(raw) != w * h * 3:
        raise SystemExit("ffmpeg returned %d bytes for %s, expected %d" % (len(raw), path, w * h * 3))
    return raw


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


LIN = [_lin(i) for i in range(256)]


def cell_stats(px, w, h, x0, y0, x1, y1):
    n = 0
    luma = chroma = edges = bright = blue = 0.0
    hx = hy = 0.0
    for y in range(y0, y1):
        for x in range(x0, x1):
            i = (y * w + x) * 3
            r, g, b = px[i], px[i + 1], px[i + 2]
            Y = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b]
            luma += Y
            cb = (b - g) / 255.0
            cr = (r - g) / 255.0
            c = math.sqrt(cb * cb + cr * cr)
            chroma += c
            if c > 0.06:
                a = math.atan2(cb, cr)
                hx += math.cos(a)
                hy += math.sin(a)
            if (r + g + b) > 450:
                bright += 1.0
            if b > r + 4 and b >= g:
                blue += 1.0
            if 0 < x < w - 1 and 0 < y < h - 1:
                il, ir = i - 3, i + 3
                iu, idn = i - w * 3, i + w * 3
                gx = (px[ir] + px[ir + 1] + px[ir + 2]) - (px[il] + px[il + 1] + px[il + 2])
                gy = (px[idn] + px[idn + 1] + px[idn + 2]) - (px[iu] + px[iu + 1] + px[iu + 2])
                edges += math.sqrt(gx * gx + gy * gy) / 765.0
            n += 1
    n = max(1, n)
    hue = (math.degrees(math.atan2(hy, hx)) + 360.0) % 360.0 if (hx or hy) else None
    return {"luma": luma / n, "chroma": chroma / n, "hue": hue, "edges": edges / n, "bright": bright / n, "blue": blue / n}


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    grid = (6, 4)
    out_json = None
    args = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a.startswith("--grid"):
            v = a.split("=", 1)[1] if "=" in a else argv[i + 1]
            i += 0 if "=" in a else 1
            grid = tuple(int(t) for t in v.lower().split("x"))
        elif a.startswith("--json"):
            out_json = a.split("=", 1)[1] if "=" in a else argv[i + 1]
            i += 0 if "=" in a else 1
        else:
            args.append(a)
        i += 1
    render, ref = args[0], args[1]
    W, H = 480, 270
    A = load(render, W, H)
    B = load(ref, W, H)
    cols, rows = grid
    names_c = ["far-left", "left", "centre-left", "centre-right", "right", "far-right"] if cols == 6 else ["c%d" % k for k in range(cols)]
    names_r = ["sky", "skyline", "midground", "foreground"] if rows == 4 else ["r%d" % k for k in range(rows)]
    table = []
    for r in range(rows):
        for c in range(cols):
            x0, x1 = c * W // cols, (c + 1) * W // cols
            y0, y1 = r * H // rows, (r + 1) * H // rows
            sa = cell_stats(A, W, H, x0, y0, x1, y1)
            sb = cell_stats(B, W, H, x0, y0, x1, y1)
            d = {
                "luma": sa["luma"] - sb["luma"],
                "chroma": sa["chroma"] - sb["chroma"],
                "edges": sa["edges"] - sb["edges"],
                "bright": sa["bright"] - sb["bright"],
                "blue": sa["blue"] - sb["blue"],
            }
            if sa["hue"] is not None and sb["hue"] is not None:
                dh = abs(sa["hue"] - sb["hue"])
                d["hue"] = min(dh, 360.0 - dh)
            else:
                d["hue"] = 0.0
            # combined: each term normalised to a "large" difference of 1.0
            score = (abs(d["luma"]) / 0.15 + abs(d["chroma"]) / 0.06 + abs(d["edges"]) / 0.05
                     + abs(d["bright"]) / 0.35 + abs(d["blue"]) / 0.35 + d["hue"] / 60.0)
            table.append({"cell": "%s/%s" % (names_r[r], names_c[c]), "row": r, "col": c,
                          "render": sa, "reference": sb, "delta": d, "score": score})
    table.sort(key=lambda t: -t["score"])
    print("diff_v2: %s vs %s at %dx%d, grid %dx%d" % (os.path.basename(render), os.path.basename(ref), W, H, cols, rows))
    print("FIVE LARGEST DIFFERENCES (render minus reference):")
    for k, t in enumerate(table[:5]):
        d = t["delta"]
        drivers = sorted((("luma", abs(d["luma"]) / 0.15), ("chroma", abs(d["chroma"]) / 0.06), ("edges", abs(d["edges"]) / 0.05),
                          ("bright", abs(d["bright"]) / 0.35), ("blue", abs(d["blue"]) / 0.35), ("hue", d["hue"] / 60.0)),
                         key=lambda p: -p[1])
        lead = drivers[0][0]
        words = {
            "luma": "render is %s by %.2f" % ("brighter" if d["luma"] > 0 else "darker", abs(d["luma"])),
            "chroma": "render is %s (chroma %+.3f)" % ("more colourful" if d["chroma"] > 0 else "greyer", d["chroma"]),
            "edges": "render has %s detail (edges %+.3f)" % ("more" if d["edges"] > 0 else "less", d["edges"]),
            "bright": "render has %s bright area (%+.0f%% of the cell)" % ("more" if d["bright"] > 0 else "less", 100 * d["bright"]),
            "blue": "render is %s blue-leaning (%+.0f%% of the cell)" % ("more" if d["blue"] > 0 else "less", 100 * d["blue"]),
            "hue": "hue differs by %.0f deg (render %s, reference %s)" % (
                d["hue"], "%.0f" % t["render"]["hue"] if t["render"]["hue"] is not None else "-",
                "%.0f" % t["reference"]["hue"] if t["reference"]["hue"] is not None else "-"),
        }
        print("  %d. %-24s score %.2f  %s; also %s" % (k + 1, t["cell"], t["score"], words[lead], ", ".join(p[0] for p in drivers[1:3])))
    whole_a = cell_stats(A, W, H, 0, 0, W, H)
    whole_b = cell_stats(B, W, H, 0, 0, W, H)
    print("WHOLE FRAME  render luma %.3f chroma %.3f edges %.3f bright %.0f%% blue %.0f%%  |  reference luma %.3f chroma %.3f edges %.3f bright %.0f%% blue %.0f%%" % (
        whole_a["luma"], whole_a["chroma"], whole_a["edges"], 100 * whole_a["bright"], 100 * whole_a["blue"],
        whole_b["luma"], whole_b["chroma"], whole_b["edges"], 100 * whole_b["bright"], 100 * whole_b["blue"]))
    if out_json:
        with open(out_json, "w") as fh:
            json.dump({"render": render, "reference": ref, "size": [W, H], "grid": [cols, rows], "cells": table,
                       "whole": {"render": whole_a, "reference": whole_b}}, fh, indent=1)
        print("json: %s" % out_json)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
