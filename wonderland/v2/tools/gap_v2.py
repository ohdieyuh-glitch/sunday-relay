#!/usr/bin/env python3
"""MEASURE the gap between a Wonderland V2 render and the founder's reference.

    python3 wonderland/v2/tools/gap_v2.py RENDER.png [REFERENCE.png] [--json out.json]

Impressions drift; pixel populations do not. This reports, for a render and
(optionally) the reference beside it, the six things that decide whether a
frame reads as the reference world:

  bands       luma / chroma / edge density in four horizontal bands
              (sky, skyline, midground, foreground) -- "the sky is empty",
              "the plaza is 1.3x too bright" are band claims and this is
              where they are settled.
  palette     the fraction of the frame in each Wonderland colour family
              (rose, gold, cream, green, sky-blue, dark). The reference is a
              CONTROLLED palette; a render that has lost its rose has lost
              the world, and a mean colour cannot see that (memory:
              removing-a-cast-can-remove-the-colour).
  cloud       fraction of the sky band that is cloud rather than gradient.
  variation   piece-to-piece colour variation of the ground: the mean
              spread of 16x16 tile means inside the foreground band. A
              repeated prototype slab scores near zero however detailed one
              slab is.
  gridness    fraction of edge energy lying within 12 deg of the two
              dominant edge orientations. A modular grid concentrates;
              authored stonework spreads.
  detail      overall edge density -- richness, not sharpness.

Every number is measured from the pixels. None of them says a render is
good; they say where two frames differ and by how much.
stdlib + ffmpeg (decode/scale only).
"""
import json
import math
import subprocess
import sys

W, H = 640, 360


def load(path, w=W, h=H):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf",
         "scale=%d:%d:flags=area" % (w, h), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        check=True, capture_output=True).stdout
    if len(raw) != w * h * 3:
        raise SystemExit("ffmpeg gave %d bytes for %s, expected %d" % (len(raw), path, w * h * 3))
    return raw


def _lin(c):
    c /= 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


LIN = [_lin(i) for i in range(256)]

# Colour families, as hue arcs plus saturation/value gates. The arcs come
# from the founder's palette strip (rose/gold/cream/green/sky) and the gates
# keep an unsaturated pale stone out of "rose".
FAMILIES = (
    #  name      hue_lo hue_hi  sat_min  val_min  val_max
    ("rose",     280.0,  25.0,    0.13,    0.18,   1.01),   # wraps through 0
    ("gold",      26.0,  62.0,    0.22,    0.25,   1.01),
    ("green",     62.0, 175.0,    0.10,    0.05,   1.01),
    ("sky",      175.0, 260.0,    0.08,    0.25,   1.01),
    ("cream",      0.0, 360.0,    0.00,    0.55,   1.01),   # low-sat + bright
    ("dark",       0.0, 360.0,    0.00,    0.00,   0.18),
)


def hsv(r, g, b):
    mx, mn = max(r, g, b), min(r, g, b)
    v = mx / 255.0
    d = mx - mn
    s = 0.0 if mx == 0 else d / mx
    if d == 0:
        h = 0.0
    elif mx == r:
        h = 60.0 * (((g - b) / d) % 6.0)
    elif mx == g:
        h = 60.0 * (((b - r) / d) + 2.0)
    else:
        h = 60.0 * (((r - g) / d) + 4.0)
    return h, s, v


def in_arc(h, lo, hi):
    return (lo <= h <= hi) if lo <= hi else (h >= lo or h <= hi)


def classify(r, g, b):
    h, s, v = hsv(r, g, b)
    if v <= 0.18:
        return "dark"
    if s < 0.13 and v >= 0.55:
        return "cream"
    for name, lo, hi, smin, vmin, vmax in FAMILIES:
        if name in ("cream", "dark"):
            continue
        if s >= smin and vmin <= v < vmax and in_arc(h, lo, hi):
            return name
    return "other"


def analyse(raw, w=W, h=H):
    px = lambda x, y: (raw[(y * w + x) * 3], raw[(y * w + x) * 3 + 1], raw[(y * w + x) * 3 + 2])

    # ---- luminance plane, and Sobel with orientation ---------------------
    lum = [0.0] * (w * h)
    for i in range(w * h):
        r, g, b = raw[i * 3], raw[i * 3 + 1], raw[i * 3 + 2]
        lum[i] = 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b]

    ORI_BINS = 18                       # 10 deg each, 0..180 (edges are undirected)
    ori = [0.0] * ORI_BINS
    grad = [0.0] * (w * h)
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            i = y * w + x
            gx = (lum[i - w + 1] + 2 * lum[i + 1] + lum[i + w + 1]
                  - lum[i - w - 1] - 2 * lum[i - 1] - lum[i + w - 1])
            gy = (lum[i + w - 1] + 2 * lum[i + w] + lum[i + w + 1]
                  - lum[i - w - 1] - 2 * lum[i - w] - lum[i - w + 1])
            m = math.hypot(gx, gy)
            grad[i] = m
            if m > 0.02:
                a = math.degrees(math.atan2(gy, gx)) % 180.0
                ori[int(a / 180.0 * ORI_BINS) % ORI_BINS] += m

    # ---- bands -----------------------------------------------------------
    names = ("sky", "skyline", "midground", "foreground")
    bands = {}
    for bi, name in enumerate(names):
        y0, y1 = bi * h // 4, (bi + 1) * h // 4
        n = 0
        sl = sc = se = 0.0
        for y in range(y0, y1):
            for x in range(w):
                r, g, b = px(x, y)
                sl += lum[y * w + x]
                mx, mn = max(r, g, b), min(r, g, b)
                sc += (mx - mn) / 255.0
                se += grad[y * w + x]
                n += 1
        bands[name] = {"luma": sl / n, "chroma": sc / n, "edges": se / n}

    # ---- palette ---------------------------------------------------------
    counts = {}
    for y in range(h):
        for x in range(w):
            r, g, b = px(x, y)
            k = classify(r, g, b)
            counts[k] = counts.get(k, 0) + 1
    total = float(w * h)
    palette = {k: counts.get(k, 0) / total for k in
               ("rose", "gold", "green", "sky", "cream", "dark", "other")}

    # ---- cloud fraction of the sky band ---------------------------------
    # A cloud is bright and markedly LESS blue-saturated than the gradient
    # around it. Measured against the band's own blue, so it survives any
    # exposure.
    y0, y1 = 0, h // 4
    sky_px = [px(x, y) for y in range(y0, y1) for x in range(w)]
    blues = [b - r for (r, g, b) in sky_px]
    blues.sort()
    strong_blue = blues[int(len(blues) * 0.85)] if blues else 0
    cloud = 0
    for (r, g, b) in sky_px:
        if (r + g + b) / 3.0 > 140 and (b - r) < strong_blue * 0.55:
            cloud += 1
    cloud_frac = cloud / float(len(sky_px)) if sky_px else 0.0

    # ---- ground variation: spread of 16x16 tile means in the bottom band --
    tiles = []
    for ty in range(3 * h // 4, h - 15, 16):
        for tx in range(0, w - 15, 16):
            sr = sg = sb = 0
            for y in range(ty, ty + 16):
                for x in range(tx, tx + 16):
                    r, g, b = px(x, y)
                    sr += r; sg += g; sb += b
            tiles.append((sr / 256.0, sg / 256.0, sb / 256.0))
    if tiles:
        mr = sum(t[0] for t in tiles) / len(tiles)
        mg = sum(t[1] for t in tiles) / len(tiles)
        mb = sum(t[2] for t in tiles) / len(tiles)
        variation = sum(math.dist(t, (mr, mg, mb)) for t in tiles) / len(tiles)
    else:
        variation = 0.0

    # ---- gridness --------------------------------------------------------
    tot_ori = sum(ori)
    if tot_ori > 0:
        top = sorted(range(ORI_BINS), key=lambda i: ori[i], reverse=True)[:2]
        near = 0.0
        for i in range(ORI_BINS):
            for t in top:
                d = min(abs(i - t), ORI_BINS - abs(i - t))
                if d <= 1:
                    near += ori[i]
                    break
        gridness = near / tot_ori
    else:
        gridness = 0.0

    detail = sum(grad) / float(w * h)
    return {"bands": bands, "palette": palette, "cloud_fraction": cloud_frac,
            "ground_variation": variation, "gridness": gridness, "detail": detail}


def fmt(label, a, b=None):
    if b is None:
        return "%-22s %8.4f" % (label, a)
    ratio = (a / b) if b else float("inf")
    return "%-22s %8.4f   %8.4f   %6.2fx" % (label, a, b, ratio)


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    out = None
    for a in sys.argv[1:]:
        if a.startswith("--json="):
            out = a.split("=", 1)[1]
    if not args:
        raise SystemExit(__doc__)
    render = analyse(load(args[0]))
    ref = analyse(load(args[1])) if len(args) > 1 else None

    hdr = "%-22s %8s   %8s   %6s" % ("metric", "render", "ref", "r/ref") if ref else \
          "%-22s %8s" % ("metric", "render")
    print(hdr)
    print("-" * len(hdr))
    for band in ("sky", "skyline", "midground", "foreground"):
        for m in ("luma", "chroma", "edges"):
            print(fmt("%s.%s" % (band, m), render["bands"][band][m],
                      ref["bands"][band][m] if ref else None))
    for k in ("rose", "gold", "green", "sky", "cream", "dark"):
        print(fmt("palette.%s" % k, render["palette"][k],
                  ref["palette"][k] if ref else None))
    for k in ("cloud_fraction", "ground_variation", "gridness", "detail"):
        print(fmt(k, render[k], ref[k] if ref else None))

    if out:
        with open(out, "w") as fh:
            json.dump({"render": {"path": args[0], **render},
                       "reference": ({"path": args[1], **ref} if ref else None)}, fh, indent=2)
        print("\nwrote %s" % out)


if __name__ == "__main__":
    main()
