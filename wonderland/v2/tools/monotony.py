#!/usr/bin/env python3
"""Does the SAME thing roof frame after frame? Monotony across the suite.

    python3 wonderland/v2/tools/monotony.py [--top N] [--min-share 20]

`framescape.py` reports, per frame, the one piece holding the most of its
ceiling. That catches a frame roofed by one thing, and it is the right question
asked thirty-three times. It cannot catch the other half of the same complaint
-- the world handoff's mismatch #4, "the same great spire or the same swag
roofing frame after frame" -- because that defect lives ACROSS frames and every
per-frame number for it can be small. A piece holding 13% of eight different
frames is invisible to a per-frame measure and is exactly the monotony the
handoff is describing.

A SITE, NOT A LABEL. Pieces are grouped by where they STAND, rounded to
`SITE_UU`, rather than by parsing their names. `GreatSpire_Body`,
`GreatSpire_TowerCap2` and `GreatSpire_WayTree4_1_Canopy0` share a label prefix
and are a tower, its cap and a tree beside it; `KitDepth05_2` and
`KitDepth05_4_roof` are two rungs of one stand. Name-stripping got both wrong in
the first version of this tool. Ground position does not.

AND IT SAYS WHETHER ANYTHING COULD BE DONE. `framescape.census` clips every
elevation to its frame's top edge and awards a column on a strict `>`, so a
column whose holder already reads the edge can never change hands, whatever is
placed. A monotony made of pinned columns is not a placement problem and the
`pinned` share is printed so nobody spends a pass discovering that again.
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")
import framescape as FS       # noqa: E402
import layout_v2 as L         # noqa: E402
import skyline as SKY         # noqa: E402

#: uu. Two pieces standing within this of each other are one THING -- a tower
#: and its cap, a stand and its rungs, a gatehouse and its glass. 12 m is wider
#: than any single module's footprint in either kit and narrower than the gap
#: between two placed pieces anywhere in the world.
SITE_UU = 1200.0


def sites(cam, bb):
    """Who holds each column, as a site, and whether the column is pinned."""
    ex, ey, ez = cam["loc"]
    half = cam["fov"] / 2.0
    hv = math.degrees(math.atan(math.tan(math.radians(half)) / (16.0 / 9.0)))
    n = FS.COLS
    top = [-90.0] * n
    who = [None] * n
    pin = [False] * n
    for p in L.ALL:
        a = p["asset"]
        if a.startswith(FS.SKIP):
            continue
        b = bb.get(a)
        if b is None:
            continue
        sc = p["scale"]
        sx, sy = abs(sc[0]), abs(sc[1])
        sz = abs(sc[2]) if len(sc) > 2 else sx
        x, y, z = p["pos"]
        dx, dy = x - ex, y - ey
        r = math.hypot(dx, dy)
        if r < 1.0:
            continue
        th = math.degrees(math.atan2(dx, dy)) - (cam["yaw"] - 90.0)
        th = (th + 180.0) % 360.0 - 180.0
        hw = math.degrees(math.atan2(max(b["rx"] * sx, b["ry"] * sy), r))
        if abs(th) > half + hw:
            continue
        raw = math.degrees(math.atan2(z + b["ztop"] * sz - ez, r)) - cam["pitch"]
        e0 = math.degrees(math.atan2(z + b["zlo"] * sz - ez, r)) - cam["pitch"]
        if e0 > hv or raw < -hv:
            continue
        el = min(raw, hv)
        i0 = int((th - hw + half) / (2 * half) * n)
        i1 = int((th + hw + half) / (2 * half) * n)
        key = (round(x / SITE_UU), round(y / SITE_UU))
        for i in range(max(0, i0), min(n - 1, i1) + 1):
            if el > top[i]:
                top[i] = el
                who[i] = (key, p.get("label") or a)
                pin[i] = raw >= hv - 1e-6
    return who, pin


def main():
    top_n = int(next((a.split("=")[1] for a in sys.argv[1:]
                      if a.startswith("--top=")), 16))
    min_share = float(next((a.split("=")[1] for a in sys.argv[1:]
                            if a.startswith("--min-share=")), 20.0))
    bb = SKY.bboxes()
    n = FS.COLS
    by = {}
    names = {}
    for cam in FS.cams():
        who, pin = sites(cam, bb)
        seen = {}
        for i in range(n):
            if who[i] is None:
                continue
            key, lab = who[i]
            names.setdefault(key, lab)
            s = seen.setdefault(key, [0, 0])
            s[0] += 1
            if pin[i]:
                s[1] += 1
        for key, (cols, pinned) in seen.items():
            by.setdefault(key, []).append((cam["name"], cols, pinned))

    rows = []
    for key, lst in by.items():
        cols = sum(c for _n, c, _p in lst)
        pinned = sum(p for _n, _c, p in lst)
        big = [(nm, c) for nm, c, _p in lst if 100.0 * c / n >= min_share]
        rows.append((len(lst), cols, pinned, key, big))
    rows.sort(reverse=True)

    print("CEILING MONOTONY -- how many of the %d frames does ONE site roof?\n"
          % len(FS.cams()))
    print("A site holding many frames is not automatically a defect: a landmark")
    print("is meant to be seen from everywhere. It is a defect when it holds a")
    print("LARGE SHARE of several -- and it is not fixable by placing anything")
    print("when its columns are pinned to the frame edge.\n")
    print("%-34s %6s %7s %7s  %s"
          % ("site", "frames", "columns", "pinned", "frames it holds %.0f%%+ of" % min_share))
    print("-" * 118)
    for nf, cols, pinned, key, big in rows[:top_n]:
        print("%-34s %6d %7d %6.0f%%  %s"
              % (names[key][:34], nf, cols, 100.0 * pinned / max(cols, 1),
                 ", ".join("%s %d%%" % (b.replace("Cam", ""), 100 * c // n)
                           for b, c in big[:4]) or "-"))
    worst = [r for r in rows if len(r[4]) >= 3]
    print()
    if worst:
        print("%d site(s) hold %.0f%%+ of THREE OR MORE frames:" % (len(worst), min_share))
        for nf, cols, pinned, key, big in worst:
            print("   %-30s %d frames, %.0f%% of its columns pinned"
                  % (names[key][:30], len(big), 100.0 * pinned / max(cols, 1)))
    else:
        print("no site holds %.0f%%+ of three or more frames." % min_share)
    return 0


if __name__ == "__main__":
    sys.exit(main())
