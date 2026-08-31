#!/usr/bin/env python3
"""What does each camera actually SEE -- and what is standing in front of it?

    python3 wonderland/v2/tools/occlusion.py [--cams=0,1,2] [--json out.json]
                                             [--grid=240] [--reveal=20]

The founder's second priority is that foliage hides too much of the city. That
is a claim about pixels, and until now nothing here could count them without a
GPU: `gap_v2.py` measures a RENDER, and a render costs a build, a Studio and a
capture round. This measures the same question from the layout, offline.

HOW. Each placement becomes a vertical cylinder -- measured half-width and
measured top from the recipe's bounding box, exactly as `skyline.py` reads
them -- projected through a real pinhole camera built from the suite's own
yaw, pitch and horizontal fov. The scene is painted near to far into a coarse
frame buffer, so what lands in a cell is what the camera would see there.

WHAT IT REPORTS, per camera:

  1. THE SPLIT -- share of the frame that is vegetation, architecture,
     ground, prop and sky. "Garden + architecture + fantasy landmark" is a
     statement about these five numbers.
  2. OCCLUSION -- for every architectural piece, how much of its own
     projected area survives what stands in front of it. A tower at 4%
     visible is a tower nobody knows is there.
  3. THE BLOCKERS -- the individual vegetation placements that cost the most
     architecture, ranked by the area they take. This is the actionable list:
     thinning is a decision about THESE pieces, not about the world's trees.

Deliberately approximate: cylinders, not meshes, and a coarse grid. It is a
targeting tool for a thinning pass and a regression check between passes --
never a substitute for a render, which is the only acceptance in this project.
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
V2 = os.path.dirname(HERE)
sys.path.insert(0, V2)
sys.path.insert(0, HERE)
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")

import layout_v2 as LAYOUT     # noqa: E402
import v2_config as CFG        # noqa: E402
import skyline as SKY          # noqa: E402

VEG = ("tree_", "canopy_", "topiary_", "hedge_", "shrub_", "rose_", "blossom_",
       "flower_", "lavender_", "ivy_", "vine_", "grass_", "fern_")
GROUND = ("garden_lawn", "terrace_platform", "ground_flowers", "ground_blooms",
          "flagstone", "kerb_stone", "path_", "cobble", "stone_ring_base",
          "side_steps", "path_steps")
ARCH = ("tower_", "castle_", "spire_", "garden_wall", "retaining_wall",
        "gate_", "facade_panel", "roof_", "balcony_ring", "balustrade",
        "floral_arch", "arch_stone", "fountain_", "bridge_", "column_",
        "stairs_", "pavilion", "obelisk", "clock_", "monument")
SKY_A = ("sky_dome", "cloud_")


def klass(a):
    if any(a.startswith(p) for p in SKY_A):
        return "sky"
    if any(a == p or a.startswith(p) for p in GROUND):
        return "ground"
    if any(a.startswith(p) for p in VEG):
        return "veg"
    if any(a.startswith(p) for p in ARCH):
        return "arch"
    return "prop"


def basis(yaw_deg, pitch_deg):
    """Forward / right / up for a UE camera.

    WRITTEN WRONG THE FIRST TIME, in both axes, which is worth recording
    because this project has paid for it before: `right` was (sin, -cos),
    a HORIZONTAL MIRROR -- the same defect as the pass where five framing
    elements turned out to be on the wrong side of the frame -- and `up` came
    out as f x r with the mirrored right, which is DOWN. Every share the tool
    reported was measured from a scene projected below the frame.

    UE is left-handed with X forward at yaw 0 and Y to its right, so
    right = (-sin yaw, cos yaw, 0) -- which is exactly the convention the
    camera notes state as "screen-right is -X at yaw 90" -- and up = f x r,
    checked at yaw 0 pitch 0 where it must be (0, 0, 1) and is.
    """
    y, p = math.radians(yaw_deg), math.radians(pitch_deg)
    f = (math.cos(y) * math.cos(p), math.sin(y) * math.cos(p), math.sin(p))
    r = (-math.sin(y), math.cos(y), 0.0)
    u = (f[1] * r[2] - f[2] * r[1], f[2] * r[0] - f[0] * r[2], f[0] * r[1] - f[1] * r[0])
    return f, r, u


def paint(cam, grid_w, aspect=16.0 / 9.0, near=60.0):
    """Near-to-far painter's projection of the whole layout into a frame."""
    gw = grid_w
    gh = max(1, int(round(gw / aspect)))
    cx, cy, cz = cam["location"]
    f, r, u = basis(cam["rotation"][1], cam["rotation"][0])
    fx = 1.0 / math.tan(math.radians(cam["fov"] / 2.0))     # focal, in half-widths
    bb = SKY.bboxes()

    # GROUND AND SKY ARE NOT PROJECTED. Both break the cylinder approximation
    # in opposite directions: a lawn slab is 60 m across and 20 cm tall, so as
    # a cylinder it is a thin wide sliver that reports 4% of a frame it fills
    # the bottom half of, and the sky dome is a 1 km cylinder around the
    # camera that would paint over everything. The question here is what
    # STANDS in the world and what hides it, so the shares below are shares of
    # the frame occupied by standing things, and "open" is sky plus ground.
    items = []
    for p in LAYOUT.ALL:
        a = p["asset"]
        b = bb.get(a)
        if b is None:
            continue
        if klass(a) in ("ground", "sky"):
            continue
        x, y, z = p["pos"]
        sx, sy, sz = (abs(p["scale"][0]), abs(p["scale"][1]), abs(p["scale"][2]))
        dx, dy, dz = x - cx, y - cy, z - cz
        d = dx * f[0] + dy * f[1] + dz * f[2]
        if d <= near:
            continue
        h = dx * r[0] + dy * r[1] + dz * r[2]
        base = dx * u[0] + dy * u[1]
        sxc = fx * h / d
        prof = b.get("prof") or [max(b["rx"], b["ry"])] * SKY.PROFILE_BINS
        nb = len(prof)
        span = (b["ztop"] - b["zlo"]) * sz
        rxy = max(sx, sy)
        # SLABS, NOT ONE CYLINDER. A mushroom is a thin stem and a wide cap
        # and the difference is the whole answer to "what is hiding the city".
        boxes = []
        for k in range(nb):
            rad = prof[k] * rxy
            if rad <= 0.0:
                continue
            zk0 = dz + (b["zlo"] * sz) + span * k / nb
            zk1 = dz + (b["zlo"] * sz) + span * (k + 1) / nb
            v_lo = base + zk0 * u[2]
            v_hi = base + zk1 * u[2]
            if v_hi < v_lo:
                v_lo, v_hi = v_hi, v_lo
            srad = fx * rad / d
            sy_lo = fx * v_lo / d * aspect
            sy_hi = fx * v_hi / d * aspect
            bx0 = int((sxc - srad + 1.0) * 0.5 * gw)
            bx1 = int(math.ceil((sxc + srad + 1.0) * 0.5 * gw))
            by0 = int((1.0 - min(sy_hi, 8.0)) * 0.5 * gh)
            by1 = int(math.ceil((1.0 - max(sy_lo, -8.0)) * 0.5 * gh))
            bx0, bx1 = max(0, bx0), min(gw, bx1)
            by0, by1 = max(0, by0), min(gh, by1)
            if bx1 > bx0 and by1 > by0:
                boxes.append((bx0, bx1, by0, by1))
        if not boxes:
            continue
        x0 = min(bb0[0] for bb0 in boxes)
        x1 = max(bb0[1] for bb0 in boxes)
        y0 = min(bb0[2] for bb0 in boxes)
        y1 = max(bb0[3] for bb0 in boxes)
        items.append((d, x0, x1, y0, y1, klass(a), a, p.get("label") or "",
                      max(prof) * rxy, boxes))
    items.sort(key=lambda t: t[0])

    buf = [None] * (gw * gh)
    own, got = {}, {}
    for i, it in enumerate(items):
        cells = set()
        for (bx0, bx1, by0, by1) in it[9]:
            for gy in range(by0, by1):
                row = gy * gw
                for gx in range(bx0, bx1):
                    cells.add(row + gx)
        if not cells:
            continue
        own[i] = len(cells)
        hit = 0
        for c in cells:
            if buf[c] is None:
                buf[c] = i
                hit += 1
        got[i] = hit
    return items, buf, own, got, gw, gh


def blockers(items):
    """For every occluded architectural cell, who took it.

    The exact answer is a second projection with the vegetation removed; this
    is the cheap one -- for each arch piece, the NEARER soft pieces whose
    rectangles overlap it -- and it is enough to RANK, which is all a thinning
    list needs.
    """
    cost = {}
    for i, it in enumerate(items):
        if it[5] != "arch":
            continue
        x0, x1, y0, y1 = it[1], it[2], it[3], it[4]
        for j in range(i):
            jt = items[j]
            if jt[5] not in ("veg", "prop"):
                continue
            ox = min(x1, jt[2]) - max(x0, jt[1])
            oy = min(y1, jt[4]) - max(y0, jt[3])
            if ox > 0 and oy > 0:
                cost[j] = cost.get(j, 0) + ox * oy
    return cost


def run(cam_idx, grid_w=240, reveal=20):
    cam = CFG.HERO_CAMS[cam_idx]
    tag = [t for t in cam["tags"] if t.startswith("HeroCam") and t[7:].isdigit()]
    name = cam["name"]
    items, buf, own, got, gw, gh = paint(cam, grid_w)
    total = gw * gh
    share = {"veg": 0, "arch": 0, "prop": 0, "open": 0}
    for c in buf:
        if c is None:
            share["open"] += 1
        else:
            share[items[c][5]] += 1

    hidden = []
    floor = max(4, total // 6000)
    for i, it in enumerate(items):
        if it[5] != "arch" or own.get(i, 0) < floor:
            continue
        vis = got.get(i, 0) / float(own[i])
        if vis < 0.35:
            hidden.append({"label": it[7], "asset": it[6], "dist_m": it[0] / 100.0,
                           "own_cells": own[i], "visible": vis})
    hidden.sort(key=lambda h: (h["visible"], -h["own_cells"]))

    cost = blockers(items)
    rank = sorted(cost.items(), key=lambda kv: -kv[1])[:reveal]
    blk = [{"label": items[j][7], "asset": items[j][6],
            "dist_m": items[j][0] / 100.0, "cost_cells": c,
            "cost_pct": 100.0 * c / total} for j, c in rank]

    return {"cam": (tag or [name])[0], "name": name,
            "share": {k: 100.0 * v / total for k, v in share.items()},
            "hidden": hidden, "blockers": blk,
            "n_arch": sum(1 for it in items if it[5] == "arch")}


# ---------------------------------------------------------------------------
# CANOPY COVER -- the plan-view number behind "foliage hides the city"
# ---------------------------------------------------------------------------
#
# The occlusion projection answers "what does THIS camera see". Cover answers
# the question underneath it: how much of the ground has a crown over it. The
# first render of SkylineCam06 read as a forest with tower tops in it, and the
# reason was one number -- 62 canopies per hectare in the 80-130 m band, each
# about 14 m across, which is a CLOSED canopy. No amount of camera work sees
# through that, and thinning it evenly would only make a thinner forest: the
# fix is clearings, so this reports cover AND the size of the largest gap.


def cover(bands=((0, 4000), (4000, 8000), (8000, 13000), (13000, 20000),
                 (20000, 34000)), cell=400.0):
    """Fraction of ground under a crown, per radial band, on a `cell` grid."""
    bb = SKY.bboxes()
    crowns = []
    for p in LAYOUT.ALL:
        a = p["asset"]
        if not (a.startswith("canopy_") or a.startswith("hedge_mass")):
            continue
        b = bb.get(a)
        if b is None:
            continue
        sxy = max(abs(p["scale"][0]), abs(p["scale"][1]))
        crowns.append((p["pos"][0], p["pos"][1], max(b["prof"]) * sxy))
    rows = []
    for lo, hi in bands:
        n = m = 0
        gaps = 0
        step = cell
        g = int(hi / step)
        for gy in range(-g, g + 1):
            for gx in range(-g, g + 1):
                x, y = gx * step, gy * step
                r = math.hypot(x, y)
                if not (lo <= r < hi):
                    continue
                n += 1
                for (cx, cy, cr) in crowns:
                    if abs(cx - x) < cr and abs(cy - y) < cr and \
                            math.hypot(cx - x, cy - y) < cr:
                        m += 1
                        break
                else:
                    gaps += 1
        rows.append({"lo_m": lo / 100.0, "hi_m": hi / 100.0, "samples": n,
                     "cover": (m / float(n)) if n else 0.0, "open": gaps})
    return rows


def main():
    args = sys.argv[1:]
    cams = list(range(len(CFG.HERO_CAMS)))
    grid_w, reveal, out_json = 240, 14, None
    for i, a in enumerate(args):
        if a.startswith("--cams="):
            cams = [int(v) for v in a.split("=", 1)[1].split(",")]
        elif a.startswith("--grid="):
            grid_w = int(a.split("=", 1)[1])
        elif a.startswith("--reveal="):
            reveal = int(a.split("=", 1)[1])
        elif a == "--json" and i + 1 < len(args):
            out_json = args[i + 1]
    if "--cover" in args:
        print("CANOPY COVER -- share of ground with a crown over it")
        for r in cover():
            print("  %5.0f-%5.0f m   %5.1f%% covered   (%d samples)"
                  % (r["lo_m"], r["hi_m"], 100.0 * r["cover"], r["samples"]))
        return 0
    reps = []
    for ci in cams:
        rep = run(ci, grid_w, reveal)
        reps.append(rep)
        s = rep["share"]
        print("\n%-14s %-24s  arch pieces in frame %d" % (rep["cam"], rep["name"], rep["n_arch"]))
        print("   FRAME  veg %5.1f%%  arch %5.1f%%  prop %5.1f%%   open (sky+ground) %5.1f%%   veg:arch %.2f"
              % (s["veg"], s["arch"], s["prop"], s["open"],
                 (s["veg"] / s["arch"]) if s["arch"] else 0.0))
        if rep["hidden"]:
            print("   HIDDEN architecture (own area >= %d cells, under 35%% visible):" % max(4, (grid_w * int(grid_w / (16.0 / 9.0))) // 6000))
            for h in rep["hidden"][:8]:
                print("     %-30s %-20s %6.1f m  %4.0f%% visible"
                      % (h["label"][:30], h["asset"][:20], h["dist_m"], 100.0 * h["visible"]))
            if len(rep["hidden"]) > 8:
                print("     ... and %d more" % (len(rep["hidden"]) - 8))
        if rep["blockers"]:
            print("   BLOCKERS costing the most architecture:")
            for b in rep["blockers"][:8]:
                print("     %-30s %-20s %6.1f m  %5.2f%% of frame"
                      % (b["label"][:30], b["asset"][:20], b["dist_m"], b["cost_pct"]))
    if out_json:
        with open(out_json, "w") as fh:
            json.dump(reps, fh, indent=1)
        print("\njson -> %s" % out_json)
    return 0


if __name__ == "__main__":
    sys.exit(main())
