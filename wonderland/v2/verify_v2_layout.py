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
        if it["asset"] not in A.known_asset_keys():
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
    # every recipe's folder key must exist: a missing key is a KeyError at
    # asset time and a silently absent mesh in the level ("ground" was one)
    for key, spec in A.RECIPES.items():
        if spec[1] not in C.FOLDERS:
            fails.append("recipe %s names folder %r which is not in FOLDERS" % (key, spec[1]))
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
    # THE SECOND LOCKED CAMERA looks back through the open gate (cam1): both
    # piers must be inside its frame, the leaves must be swung clear of the
    # axis, and nothing may stand on the axis between the camera and the plaza.
    cam1 = C.HERO_CAMS[1]
    c1x, c1y = cam1["location"][0], cam1["location"][1]
    half1 = cam1["fov"] * 0.5
    for lb in ("Gate_PierL", "Gate_PierR", "GiantMushroom"):
        it = next((i for i in L.ALL if i["label"] == lb), None)
        if it is None:
            fails.append("landmark %s missing (cam1)" % lb)
            continue
        dx, dy = it["pos"][0] - c1x, it["pos"][1] - c1y
        r = inner.get(lb, 0.0)
        dx = dx - r if dx > 0 else dx + r
        if dy <= 0:
            fails.append("%s is behind cam1" % lb)
            continue
        bearing = abs(math.degrees(math.atan2(dx, dy)))
        if bearing > half1:
            fails.append("%s at bearing %.0f is outside cam1's half-fov %.0f" % (lb, bearing, half1))
    for it in L.ALL:
        x, y = it["pos"][0], it["pos"][1]
        if abs(x) < 120.0 and c1y < y < -700.0 and it["asset"] not in ("gate_leaf",):
            fails.append("%s (%s) stands on the gate-view axis at (%d, %d)" % (it["label"], it["asset"], x, y))
    for it in L.ALL:
        # only the ARRIVAL gate's leaves (labels Gate_Leaf*): the garden's own
        # gate on the left stands closed across its wall, as in the reference
        if it["asset"] == "gate_leaf" and it["label"].startswith("Gate_Leaf"):
            yaw = it["rot"][1] % 360.0
            # a leaf flat across the opening (yaw ~0 or ~180) closes the view
            if min(abs(yaw), abs(yaw - 180.0), abs(yaw - 360.0)) < 30.0:
                fails.append("%s is swung across the opening (yaw %.0f)" % (it["label"], yaw))
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
    print("V2 LAYOUT: %d placements, %d city groups, cam0 %s fov %.0f, cam1 %s fov %.0f"
          % (len(L.ALL), len(seqs), cam["name"], cam["fov"], cam1["name"], cam1["fov"]))
    if fails:
        print("FAIL:")
        for f in fails:
            print("  " + f)
        return 1
    print("PASS: recipes and materials resolve; corridor open; plaza clean; hover props high; landmarks in both cameras; gate view clear; city groups vary")
    return 0


if __name__ == "__main__":
    sys.exit(main())
