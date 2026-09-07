#!/usr/bin/env python3
"""What FILLS a camera's frame, offline, before a GPU minute is spent.

    python3 wonderland/v2/tools/frame.py [--cam HeroCam0] [--cols 240]
                                         [--bands 8] [--ascii] [--png out.png]
                                         [--drop veg] [--json out.json]

The founder's authority is a picture, and until now the only way to compare a
picture with this world was to render one. `skyline.py --cam` ranks the
biggest SITES in a frame, which answers "what is the subject"; it cannot
answer "what is this frame MADE of", and that is the question the reference
actually poses:

    reference HeroCam0   a garden foreground, and behind it a CITY filling
                         the horizon band -- hundreds of slender spires,
                         four ranks deep, with cloud between and above them
    render  MILESTONE26  a garden, a shallow row of about twenty towers, and
                         a third of the frame empty blue

So this rasterises the world into the camera's frame -- every placement
projected as its measured silhouette, painted back to front -- and reports
the share of the picture each CLASS holds, plus where in the frame it sits.

    architecture   built mass: the city, the castle, the landmarks
    vegetation     trees, hedges, blooms, the mushroom family
    cloud          the cumulus and veil bands `build_v2` places
    ground         below the horizon and not covered by anything
    sky            above the horizon and not covered by anything

## What it is and is not

It is a SILHOUETTE model, drawn from the TWELVE-SLAB RADIUS PROFILE
`skyline.py` measures off each built mesh -- not from one bounding cylinder.
That distinction is already paid for in this project: a giant mushroom's cap
is 20 m across and 13 m up, and treating it as a column from the ground made
the occlusion tool report 556 buildings hidden behind one fungus. The first
version of this file made the same mistake at frame scale and put HeroCam0 at
4.7% sky against a render that is visibly a third sky.

It is still a silhouette: it knows mass and arrangement, and it knows nothing
about lighting, material, exposure or colour. `gap_v2.py` on a real render is
the only thing that answers those, and this file does not compete with it.

AND IT OVER-FILLS. Every piece is painted at its profile radius with no gaps,
so a castle group is one solid block where the render shows sky between its
towers, and a stand of canopies is one green wall. Measured: adding 411 far
city towers moved HeroCam0's bands by exactly nothing, because the model had
already painted those bands 100% full. **Its absolute shares are therefore
NOT comparable with a colour classification of a real render, and this file
does not claim they are.** What it is good for is (a) where a class sits in
a frame, (b) before-and-after on the SAME camera with the SAME model, and
(c) `--drop`.

`--drop veg` removes a class from the paint entirely. The near-field framing
foliage occludes the whole band the far city occupies, so "did the city
arrive" is unanswerable with the foliage in the way -- and it is a different
question from "does the foliage overwhelm the frame", which is answered on a
real render. Drop the class, ask the question, put it back.

It exists because a whole class of failure is decidable without a GPU: a
horizon band that is 8% architecture cannot read as a city whatever the light
does to it, and finding that out after a capture costs the capture.

## Clouds are not in `layout_v2.ALL`

They are placed by `build_v2.place_clouds` from `v2_config` -- count, ring,
altitude and scale -- and reproduced here from the same numbers with the same
deterministic sequence. A tool that reads only the layout will report a sky
this world does not have; the first version of this one did, and said
Wonderland had no clouds at all.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
sys.path.insert(0, HERE)
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")

import layout_v2 as LAYOUT     # noqa: E402
import v2_config as CFG        # noqa: E402
import hierarchy as HIER_TOOL  # noqa: E402
import skyline as SKY          # noqa: E402

KM = 100000.0                  #: uu per km, as build_v2 uses it

#: What each class is painted as, in the ascii view.
GLYPH = {"arch": "#", "veg": "%", "cloud": ".", "ground": "_", "sky": " "}
ORDER = ("arch", "veg", "cloud", "ground", "sky")
#: ...and in the png. Chosen to read as the reference reads -- warm stone for
#: built mass, deep green for planting, white cloud, pale paving, blue sky --
#: so a glance at the model and a glance at the founder's picture are
#: comparing the same thing. It is a MASS DIAGRAM and never a render.
RGB = {"arch": (214, 197, 176), "veg": (58, 104, 62), "cloud": (243, 243, 248),
       "ground": (196, 188, 176), "sky": (126, 174, 224)}


def write_png(path, grid, scale=4):
    """A PNG with no dependency but zlib -- the repo has no image library."""
    import struct
    import zlib
    h, w = len(grid), len(grid[0])
    raw = bytearray()
    for row in grid:
        for _ in range(scale):
            raw.append(0)                       # filter type 0
            for v in row:
                r, g, b = RGB[v]
                raw += bytes((r, g, b)) * scale
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w * scale, h * scale, 8, 2, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(bytes(raw), 6))
           + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)
    return (w * scale, h * scale)


def clouds():
    """The cloud actors `build_v2.place_clouds` will make, from `v2_config`.

    Reproduced rather than imported: `build_v2` needs `unreal`. The azimuth
    jitter, sqrt radius draw, altitude, scale and asset choice are the same
    expressions with the same seeds, so this is the sky that will be built.
    """
    import layout_tools as LT
    L = CFG.LOOK
    out = []

    def band(kind, count, ring, alt, scale, assets, seed0):
        r0, r1 = ring
        a0, a1 = alt
        s0, s1 = scale
        n = int(count)
        for i in range(n):
            share = 360.0 / max(1, n)
            az = math.radians(share * (i + 0.5) + (LT.mk.rnd(i, 1, seed0) - 0.5) * share * 0.66)
            rad = (r0 + (r1 - r0) * math.sqrt(LT.mk.rnd(i, 2, seed0))) * KM
            z = (a0 + (a1 - a0) * LT.mk.rnd(i, 3, seed0)) * KM
            sc = s0 + (s1 - s0) * LT.mk.rnd(i, 4, seed0)
            key = assets[int(LT.mk.rnd(i, 5, seed0) * len(assets)) % len(assets)]
            out.append({"asset": key,
                        "pos": (math.cos(az) * rad, math.sin(az) * rad, z),
                        "rot": (0.0, LT.mk.rnd(i, 6, seed0) * 360.0, 0.0),
                        "scale": (sc * (0.86 + 0.30 * LT.mk.rnd(i, 7, seed0)), sc,
                                  sc * (0.62 + 0.34 * LT.mk.rnd(i, 8, seed0))),
                        "label": "V2_Cloud_%s_%02d" % (kind, i)})

    band("cumulus", L.get("cloudCount", 0), L["cloudRingKm"], L["cloudAltKm"],
         L["cloudScale"], ("cloud_cumulus_a", "cloud_cumulus_b", "cloud_cumulus_c"), 8801)
    band("veil", L.get("cloudVeilCount", 0), L["cloudVeilRingKm"], L["cloudVeilAltKm"],
         L["cloudVeilScale"], ("cloud_veil",), 8807)
    return out


def klass(asset):
    if asset.startswith("cloud_"):
        return "cloud"
    if asset == "sky_dome":
        return None
    k = HIER_TOOL.klass(asset)
    if k == "veg":
        return "veg"
    if k == "surface":
        return None            # the ground plane is handled by the horizon
    if k == "sky":
        return None
    return "arch"              # arch and prop are both BUILT


def pieces(drop=()):
    """Every placement that can occupy a frame, with its silhouette box."""
    bb = SKY.bboxes()
    out = []
    for p in list(LAYOUT.ALL) + clouds():
        a = p["asset"]
        k = klass(a)
        if k is None or k in drop:
            continue
        b = bb.get(a)
        if b is None:
            continue
        sc = p["scale"]
        sx, sy, sz = abs(sc[0]), abs(sc[1]), abs(sc[2])
        x, y, z = p["pos"]
        sxy = max(sx, sy)
        out.append({"k": k, "x": x, "y": y,
                    "top": z + b["ztop"] * sz, "base": z + b["zlo"] * sz,
                    "r": max(b["rx"] * sx, b["ry"] * sy),
                    "prof": [v * sxy for v in b["prof"]], "asset": a})
    return out


def raster(cam, cols=240, aspect=16.0 / 9.0, drop=()):
    """Paint the frame, far to near. Returns rows of class labels."""
    rows = max(1, int(round(cols / aspect)))
    cx, cy, cz = cam["loc"]
    hfov = cam["fov"]
    vfov = math.degrees(2.0 * math.atan(math.tan(math.radians(hfov / 2.0)) / aspect))
    hh, hv = hfov / 2.0, vfov / 2.0

    # the horizon: elevation 0 in world terms, minus the camera's own pitch
    grid = [[None] * cols for _ in range(rows)]
    ps = pieces(drop)
    for p in ps:
        p["d"] = math.hypot(p["x"] - cx, p["y"] - cy)
    ps.sort(key=lambda p: -p["d"])
    for p in ps:
        d = p["d"]
        if d < 1.0:
            continue
        off = (math.degrees(math.atan2(p["y"] - cy, p["x"] - cx)) - cam["yaw"] + 180.0) % 360.0 - 180.0
        wr = math.degrees(math.atan(p["r"] / d))
        if off + wr < -hh or off - wr > hh:
            continue
        el_t = math.degrees(math.atan2(p["top"] - cz, d)) - cam["pitch"]
        el_b = math.degrees(math.atan2(p["base"] - cz, d)) - cam["pitch"]
        if el_t < -hv or el_b > hv:
            continue
        # rows count DOWN from the top of the frame
        r0 = max(0, int((hv - el_t) / vfov * rows))
        r1 = min(rows - 1, int((hv - el_b) / vfov * rows))
        span = el_t - el_b
        prof, nb = p["prof"], len(p["prof"])
        for rr in range(r0, r1 + 1):
            # THE WIDTH AT THIS HEIGHT, not the widest width the piece has.
            # A cone painted at its base radius is a tower; a canopy painted
            # at its widest is a wall. This is the whole reason the profile
            # is measured.
            el = hv - (rr + 0.5) / rows * vfov
            t = 0.0 if span <= 1e-9 else (el - el_b) / span
            k = int(t * nb)
            k = 0 if k < 0 else (nb - 1 if k >= nb else k)
            w = math.degrees(math.atan(prof[k] / d))
            c0 = max(0, int((off - w + hh) / hfov * cols))
            c1 = min(cols - 1, int((off + w + hh) / hfov * cols))
            row = grid[rr]
            for cc in range(c0, c1 + 1):
                row[cc] = p["k"]
    # whatever is still bare is ground below the horizon and sky above it
    for rr in range(rows):
        el = hv - (rr + 0.5) / rows * vfov          # frame elevation of this row
        world_el = el + cam["pitch"]                # true elevation from the eye
        fill = "ground" if world_el < 0.0 else "sky"
        row = grid[rr]
        for cc in range(cols):
            if row[cc] is None:
                row[cc] = fill
    return grid


def report(cam, cols, bands, want_ascii, png=None, drop=()):
    grid = raster(cam, cols=cols, drop=drop)
    rows = len(grid)
    total = rows * cols
    share = dict((k, 0) for k in ORDER)
    for row in grid:
        for v in row:
            share[v] += 1
    hfov = cam["fov"]
    vfov = math.degrees(2.0 * math.atan(math.tan(math.radians(hfov / 2.0)) / (16.0 / 9.0)))

    print("FRAME COMPOSITION -- %s  (fov %.0f x %.1f, eye %.2f m, pitch %+.0f)%s"
          % (cam["name"], hfov, vfov, cam["loc"][2] / 100.0, cam["pitch"],
             ("   [%s DROPPED]" % ",".join(sorted(drop))) if drop else ""))
    print("  %-14s %7s" % ("class", "share"))
    for k in ORDER:
        print("  %-14s %6.1f%%" % (k, 100.0 * share[k] / total))

    print("\n  BY BAND, top of frame down (%d rows each)" % (rows // bands))
    print("  %-18s %7s %7s %7s %7s %7s" % ("band", "arch", "veg", "cloud", "ground", "sky"))
    per = max(1, rows // bands)
    for b in range(bands):
        r0, r1 = b * per, min(rows, (b + 1) * per)
        if r0 >= rows:
            break
        sub = dict((k, 0) for k in ORDER)
        n = 0
        for rr in range(r0, r1):
            for v in grid[rr]:
                sub[v] += 1
                n += 1
        el_hi = vfov / 2.0 - r0 / float(rows) * vfov
        el_lo = vfov / 2.0 - r1 / float(rows) * vfov
        print("  %+6.1f..%+6.1f deg %6.1f%% %6.1f%% %6.1f%% %6.1f%% %6.1f%%"
              % (el_lo, el_hi, 100.0 * sub["arch"] / n, 100.0 * sub["veg"] / n,
                 100.0 * sub["cloud"] / n, 100.0 * sub["ground"] / n,
                 100.0 * sub["sky"] / n))

    if want_ascii:
        print("\n  " + "-" * 96)
        step_r = max(1, rows // 34)
        step_c = max(1, cols // 96)
        for rr in range(0, rows, step_r):
            print("  " + "".join(GLYPH[grid[rr][cc]] for cc in range(0, cols, step_c)))
        print("  " + "-" * 96)
        print("  # architecture   %% vegetation   . cloud   _ ground   (blank) sky")
    if png:
        size = write_png(png, grid)
        print("\n  png %dx%d -> %s" % (size[0], size[1], png))
    return {"share": dict((k, share[k] / float(total)) for k in ORDER),
            "cols": cols, "rows": rows, "cam": cam["name"]}


def main():
    args = sys.argv[1:]

    def opt(name, d):
        for a in args:
            if a.startswith("--%s=" % name):
                return a.split("=", 1)[1]
        return d

    cols = int(opt("cols", "240"))
    bands = int(opt("bands", "8"))
    want_ascii = "--ascii" in args
    out_json = opt("json", None)
    png = opt("png", None)
    drop = tuple(x for x in opt("drop", "").split(",") if x)
    which = opt("cam", "HeroCam0")

    cams = {}
    for c in SKY.cameras():
        cams[c["tag"]] = c
        cams[c["name"]] = c
    names = [w for w in which.split(",")]
    got = []
    for n in names:
        cam = cams.get(n)
        if cam is None:
            print("no camera %r -- have %s"
                  % (n, ", ".join(sorted(set(c["tag"] for c in SKY.cameras())))))
            return 1
        one = png
        if png and len(names) > 1:
            base, ext = os.path.splitext(png)
            one = "%s_%s%s" % (base, cam["tag"], ext)
        got.append(report(cam, cols, bands, want_ascii, png=one, drop=drop))
        print()
    if out_json:
        with open(out_json, "w") as fh:
            json.dump(got, fh, indent=1)
        print("json -> %s" % out_json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
