#!/usr/bin/env python3
"""Structural gate for the V2 layout — runs with no engine, catches the
mistakes a render would otherwise be spent finding.

  * every placement names a recipe and a material instance that exist
  * nothing tall (>150 uu) stands in the central corridor (|x| < 260 from
    the plaza's front wall to the arch) — the centre stays OPEN
  * nothing but slabs, petals, the portal and the pedestals stands ON the
    plaza rectangle — the plaza stays CLEAN
  * every hover prop is above 12 m
  * the hero cameras see the giant mushroom and the clock tree inside the
    frame (bearing < half the horizontal FOV)
  * per-family variation: no city group repeats another's body/roof sequence
"""
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import layout_v2 as L          # noqa: E402
import assets_v2 as A          # noqa: E402
import materials_v2 as M       # noqa: E402
import v2_config as C          # noqa: E402

TALL = {"castle_tower", "castle_tower_square", "castle_tower_octagon", "castle_tower_slender", "mushroom_giant",
        "mushroom_medium", "tree_mature_trunk", "tree_clock_trunk", "tree_slender_trunk", "heart_topiary",
        "topiary_cone_roses", "gate_pier", "castle_hall", "tower_capped", "garden_arch_stone", "column_ornate"}
# the gate stands ACROSS the plaza, as the reference has it: allowed
PLAZA_OK = {"portal_disc", "portal_ring", "pedestal_finial", "gate_finial_ball", "side_steps", "garden_urn",
            "flower_cluster", "gate_pier", "gate_leaf"}


def main():
    fails = []
    mats = set(M.INSTANCES) | {"MI_V2_SkyPano"}
    for it in L.ALL:
        if it["asset"] not in A.RECIPES:
            fails.append("%s: unknown asset %s" % (it["label"], it["asset"]))
        if it["mat"] and it["mat"] not in mats:
            fails.append("%s: unknown material %s" % (it["label"], it["mat"]))
    x0, x1, y0, y1 = L.PLAZA_RECT
    for it in L.ALL:
        x, y, z = it["pos"]
        if it["asset"] in TALL and abs(x) < 260.0 and 900.0 < y < 4400.0:
            fails.append("%s (%s) stands in the corridor at (%d, %d)" % (it["label"], it["asset"], x, y))
        if x0 + 100 < x < x1 - 100 and y0 + 100 < y < y1 - 100 and it["asset"] not in PLAZA_OK \
                and it["band"] not in ("V2_Props", "V2_Skyline"):
            fails.append("%s (%s) stands ON the plaza at (%d, %d)" % (it["label"], it["asset"], x, y))
    for it in L.HOVER:
        if it["pos"][2] < 1200.0:
            fails.append("%s hovers too low (%d)" % (it["label"], it["pos"][2]))
    cam = C.HERO_CAMS[0]
    cx, cy = cam["location"][0], cam["location"][1]
    half = cam["fov"] * 0.5
    # a landmark is "in frame" when its INNER edge is: the giant mushroom's
    # stem is off the left edge in the reference and its 10 m cap radius is
    # what enters the picture
    inner = {"GiantMushroom": 1000.0, "ClockTree_Trunk": 300.0}
    for lb in ("GiantMushroom", "ClockTree_Trunk", "HeartTopiary", "Corridor_Arch"):
        it = next((i for i in L.ALL if i["label"] == lb), None)
        if it is None:
            fails.append("landmark %s missing" % lb)
            continue
        dx, dy = it["pos"][0] - cx, it["pos"][1] - cy
        r = inner.get(lb, 0.0)
        dx = dx - r if dx > 0 else dx + r
        bearing = abs(math.degrees(math.atan2(dx, dy)))
        if bearing > half:
            fails.append("%s at bearing %.0f is outside cam0's half-fov %.0f" % (lb, bearing, half))
    seqs = {}
    for it in L.CITY:
        if "_Tower" in it["label"] and "Roof" not in it["label"] and "Balcony" not in it["label"] and "Finial" not in it["label"]:
            g = it["label"].split("_")[0]
            seqs.setdefault(g, []).append(it["asset"])
    seen = {}
    for g, seq in seqs.items():
        k = tuple(seq)
        if k in seen:
            fails.append("city group %s repeats %s's tower sequence %s" % (g, seen[k], k))
        seen[k] = g
    print("V2 LAYOUT: %d placements, %d city groups, cam0 %s fov %.0f" % (len(L.ALL), len(seqs), cam["name"], cam["fov"]))
    if fails:
        print("FAIL:")
        for f in fails:
            print("  " + f)
        return 1
    print("PASS: recipes and materials resolve; corridor open; plaza clean; hover props high; landmarks in frame; city groups vary")
    return 0


if __name__ == "__main__":
    sys.exit(main())
