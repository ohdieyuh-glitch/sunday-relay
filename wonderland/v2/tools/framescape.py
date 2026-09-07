#!/usr/bin/env python3
"""What holds up each of the thirty-three frames? A silhouette census, not one camera.

    python3 wonderland/v2/tools/framescape.py [--cam NAME] [--sort col]

EVERY COMPOSITION NUMBER THIS PROJECT HAS EVER QUOTED CAME FROM HeroCam0.
Passes 31, 32 and 33 measured the founder's benchmark frame per degree, found
real defects in it and fixed them -- and could not have told you whether the
same defect stood in the other thirty-two. The camera suite was built (founder,
2026-08-28) with the note "do not move a camera to make a pass look better --
fix the world", and a world that is only measured from one lens is a world that
gets fixed at one lens.

So: for every camera, walk the horizontal arc in columns, find the highest
silhouette in each, and report WHO holds it.

  built   the ceiling is architecture or a prop -- a made thing
  veg     the ceiling is a canopy, hedge, topiary, giant mushroom or bloom
  sky     nothing in the world reaches that column at all

The founder's reference was classified the same way, from its own pixels:
BUILT 71.5% of its ceiling, vegetation 28.5%, sky 0%. That is the target for a
camera looking at the city. It is NOT the target for a camera standing inside
a grove, and this tool does not pretend otherwise -- it prints the number and
the reading is a judgement.

WHY A CEILING AND NOT A COVERAGE FRACTION. A frame's character is set by what
its top edge cuts against: sky, leaf or roof. Coverage counts pixels and a big
near hedge outscores a city; the ceiling asks the compositional question -- is
there a world standing up behind this, or does the frame stop at a bush?

Elevations are relative to the camera's own axis, so a pitched camera is judged
by what it actually frames. Clouds, balloons and sky props are excluded: they
move, they are not structure, and counting them would say the world is built
when it is overcast.
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
import layout_v2 as LAYOUT      # noqa: E402
import v2_config as CFG         # noqa: E402
import skyline as SKY           # noqa: E402

#: Anything whose top edge reads as foliage. `mushroom_` and `flower_colossal`
#: are here for the reason `hierarchy.py` records finding the hard way: they
#: are landmarks by intent and PLANTS by silhouette, and a frame roofed by a
#: giant mushroom cap is not a frame with a city in it.
VEG = ("tree_", "topiary_", "hedge_", "flower_", "bush_", "shrub_",
       "mushroom_", "canopy_", "ground_", "vine_", "blossom_", "rose_")
#: Weather is not structure.
SKIP = ("cloud_", "balloon_", "sky_")
COLS = 120


def cams():
    out = []
    for c in CFG.HERO_CAMS:
        out.append({"name": c["name"], "loc": tuple(c["location"]),
                    "pitch": c["rotation"][0], "yaw": c["rotation"][1],
                    "fov": c["fov"]})
    return out


def census(cam, bb):
    """Ceiling ownership and height over one camera's horizontal arc."""
    ex, ey, ez = cam["loc"]
    half = cam["fov"] / 2.0
    # A CAMERA IS A RECTANGLE. A piece whose top is high does not hold a column
    # unless it is IN the picture: the vertical field of a 90 deg fov at 16:9
    # is 58 deg, so its top edge is +29, and a canopy topping at +50 whose
    # underside starts at +45 is above the frame entirely. This test cost the
    # first version of `crowding` a whole wrong finding; the census had the
    # same hole and this is it closed.
    hv = math.degrees(math.atan(math.tan(math.radians(half)) / (16.0 / 9.0)))
    top = [-90.0] * COLS
    veg = [0] * COLS
    who = [""] * COLS
    for p in LAYOUT.ALL:
        a = p["asset"]
        if a.startswith(SKIP):
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
        # bearing relative to the camera's own forward, wrapped to +/-180
        th = math.degrees(math.atan2(dx, dy)) - (cam["yaw"] - 90.0)
        th = (th + 180.0) % 360.0 - 180.0
        hw = math.degrees(math.atan2(max(b["rx"] * sx, b["ry"] * sy), r))
        if abs(th) > half + hw:
            continue
        el = math.degrees(math.atan2(z + b["ztop"] * sz - ez, r)) - cam["pitch"]
        e0 = math.degrees(math.atan2(z + b["zlo"] * sz - ez, r)) - cam["pitch"]
        if e0 > hv or el < -hv:
            continue                       # entirely above or below the picture
        el = min(el, hv)                   # what it holds is the frame's edge
        i0 = int((th - hw + half) / (2 * half) * COLS)
        i1 = int((th + hw + half) / (2 * half) * COLS)
        isv = a.startswith(VEG)
        for i in range(max(0, i0), min(COLS - 1, i1) + 1):
            if el > top[i]:
                top[i] = el
                veg[i] = 1 if isv else 0
                who[i] = p.get("label") or a
    held = [t for t in top if t > -90.0]
    nb = sum(1 for i in range(COLS) if top[i] > -90.0 and not veg[i])
    nv = sum(1 for i in range(COLS) if top[i] > -90.0 and veg[i])
    ns = COLS - nb - nv
    med = sorted(held)[len(held) // 2] if held else float("nan")
    # the single piece holding the most columns: a frame roofed by ONE thing
    tally = {}
    for i in range(COLS):
        if who[i]:
            tally[who[i]] = tally.get(who[i], 0) + 1
    boss, bossn = ("-", 0)
    if tally:
        boss, bossn = max(tally.items(), key=lambda kv: kv[1])
    return {"built": 100.0 * nb / COLS, "veg": 100.0 * nv / COLS,
            "sky": 100.0 * ns / COLS, "med": med,
            "boss": boss, "bossn": 100.0 * bossn / COLS}


#: uu. Near enough that a piece stops being IN the view and starts being ON
#: it. At 12 m a `canopy_large` spans 40 deg of arc; at 40 m, 12.
CROWD_R = 4000.0
#: The share of the FRAME'S OWN AREA one piece may take before it is the shot
#: rather than in it.
CROWD_FRAC = 0.14
#: 16:9. The vertical field follows from the horizontal one and the aspect,
#: and it is the whole point of this measure -- see `crowding`.
ASPECT = 16.0 / 9.0


def crowding(cam, bb):
    """How much of a frame does ONE nearby piece take? Frame area, not arc.

    `verify_v2_layout`'s camera-standpoint check asks whether a piece reaches
    into the lens and passes all 33. It is the wrong question by a few metres:
    nothing is inside a camera, and a camera can still be inside a tree.

    THIS MEASURE WAS WRONG TWICE BEFORE IT WAS RIGHT, and both errors are worth
    keeping because both flattered a real defect into a fake one.

    First it reported a piece's own angular width clamped to the field of view,
    and called an avenue tree 2.2 m from TeaTerraceCam16 "90 degrees wide" --
    but that tree stands 73 deg OFF AXIS, outside a 45 deg half-fov, and clips
    twelve degrees of the frame's edge. Clamping a width to the fov answers
    "is this thing big"; the question is "is this thing in the shot".

    Then it filtered on elevation above +40 deg. A 90 deg horizontal fov at
    16:9 has a VERTICAL field of 58 deg, so the top edge of the frame is +29 --
    every piece that filter kept was above the picture entirely. A camera is a
    rectangle and half of it is vertical; measuring the horizontal half only is
    how you come to "fix" things nobody can see.

    So: intersect the piece's angular box with the frame's, and report the
    fraction of frame AREA it covers. A bounding box over-states a canopy, and
    that is the honest direction for this test -- it flags a candidate for a
    human to look at, it does not convict one.
    """
    ex, ey, ez = cam["loc"]
    hh = cam["fov"] / 2.0
    hv = math.degrees(math.atan(math.tan(math.radians(hh)) / ASPECT))
    area = (2 * hh) * (2 * hv)
    out = []
    for p in LAYOUT.ALL:
        a = p["asset"]
        if a.startswith(SKIP):
            continue
        b = bb.get(a)
        if b is None:
            continue
        x, y, z = p["pos"]
        r = math.hypot(x - ex, y - ey)
        if r > CROWD_R or r < 1.0:
            continue
        th = math.degrees(math.atan2(x - ex, y - ey)) - (cam["yaw"] - 90.0)
        th = (th + 180.0) % 360.0 - 180.0
        sc = p["scale"]
        sx, sy = abs(sc[0]), abs(sc[1])
        sz = abs(sc[2]) if len(sc) > 2 else sx
        hw = math.degrees(math.atan2(max(b["rx"] * sx, b["ry"] * sy), r))
        e0 = math.degrees(math.atan2(z + b["zlo"] * sz - ez, r)) - cam["pitch"]
        e1 = math.degrees(math.atan2(z + b["ztop"] * sz - ez, r)) - cam["pitch"]
        w = max(0.0, min(th + hw, hh) - max(th - hw, -hh))
        h = max(0.0, min(e1, hv) - max(e0, -hv))
        if w <= 0.0 or h <= 0.0:
            continue
        frac = (w * h) / area
        if frac < CROWD_FRAC:
            continue
        out.append((frac, r / 100.0, th, e1, p.get("label") or a, a))
    out.sort(key=lambda t: -t[0])
    return out


def main():
    only = next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--cam=")), None)
    if "--crowd" in sys.argv[1:]:
        bb = SKY.bboxes()
        print("LENS CROWDING -- one piece inside %.0f m taking over %.0f%% of a frame's AREA\n"
              % (CROWD_R / 100.0, 100.0 * CROWD_FRAC))
        print("%-26s %5s %8s %7s %8s %7s  %-26s %s"
              % ("camera", "n", "of frame", "dist m", "bearing", "top", "the piece taking most", "asset"))
        print("-" * 116)
        tot = 0
        for c in cams():
            if only and only.lower() not in c["name"].lower():
                continue
            rs = crowding(c, bb)
            if not rs:
                continue
            tot += len(rs)
            frac, r, th, e1, lab, a = rs[0]
            print("%-26s %5d %7.1f%% %6.1f %+8.1f %+6.1f  %-26s %s"
                  % (c["name"], len(rs), 100.0 * frac, r, th, e1, lab[:26], a))
        print("\n%d pieces over the suite take more than %.0f%% of a frame from inside %.0f m."
              % (tot, 100.0 * CROWD_FRAC, CROWD_R / 100.0))
        return 0
    bb = SKY.bboxes()
    rows = []
    for c in cams():
        if only and only.lower() not in c["name"].lower():
            continue
        rows.append((c["name"], census(c, bb)))
    print("FRAMESCAPE -- what holds the top of each frame, over %d columns of its own fov" % COLS)
    print("the founder's reference, classified from its own pixels: built 71.5%, veg 28.5%, sky 0.0%\n")
    print("%-26s %7s %7s %7s %9s   %s" % ("camera", "built", "veg", "sky", "med top", "one piece holding the most"))
    print("-" * 108)
    for name, s in rows:
        print("%-26s %6.1f%% %6.1f%% %6.1f%% %+8.1f   %-30s %4.0f%%"
              % (name, s["built"], s["veg"], s["sky"], s["med"], s["boss"][:30], s["bossn"]))
    if not only:
        w = [r for r in rows if r[1]["sky"] > 25.0]
        v = [r for r in rows if r[1]["veg"] > 55.0]
        b = [r for r in rows if r[1]["bossn"] > 33.0]
        print("\n%d of %d frames are more than a quarter open sky:" % (len(w), len(rows)))
        for n, s in sorted(w, key=lambda r: -r[1]["sky"]):
            print("   %-26s sky %5.1f%%   median top %+5.1f" % (n, s["sky"], s["med"]))
        print("\n%d of %d frames are more than half roofed by vegetation:" % (len(v), len(rows)))
        for n, s in sorted(v, key=lambda r: -r[1]["veg"]):
            print("   %-26s veg %5.1f%%   built %5.1f%%" % (n, s["veg"], s["built"]))
        print("\n%d of %d frames have ONE piece holding a third of the ceiling:" % (len(b), len(rows)))
        for n, s in sorted(b, key=lambda r: -r[1]["bossn"]):
            print("   %-26s %-30s %4.0f%%" % (n, s["boss"][:30], s["bossn"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
