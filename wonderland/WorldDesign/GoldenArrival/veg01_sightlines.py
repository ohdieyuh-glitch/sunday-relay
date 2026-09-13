#!/usr/bin/env python3
"""VEG01 -- vegetation that frames the architecture instead of erasing it (a reversible trim).

WHAT WAS WRONG (founder, 2026-09-13; captures city_before/city_after). SKY04 and SKY05 add dozens of spires
and a distant metropolis, and from the arrival, the hero camera and a walker on the garden path almost none
of it shows: the sky window above the path is filled by blossom and leaf crowns 16-23 m tall standing
10-25 m from the path. The Bible (hero_b1, hero_b3) keeps its trees at the frame edges and low planting in
front of the city.

WHAT THIS DOES. The trees whose crowns cover most of the architecture window (bearing 45-135, elevation
6-40 degrees) from the arrival, hero, path, garden-gate and clock-plaza eyes -- ranked from the census of
2026-09-13 (vegetation_census_2026-09-13.json) -- are scaled down AS WHOLE TREES about the ground, crown and
trunk by the same factor, so a crown tops out at CROWN_TOP_NEAR beside the path and CROWN_TOP_FAR further
out. Nothing is deleted; the garden keeps every tree, its colours and its framing. Topiary and the heart
arches are architecture here and are not touched.

REVERSIBLE. Each change records the exact before transform; apply_vegetation_trim.py refuses to apply over
anything else and REVERT = True restores it.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "VEG01"
GROUND = -14.0
CROWN_TOP_NEAR, CROWN_TOP_FAR = 1350.0, 1600.0
NEAR_PATH_UU = 1700.0
EYES = {"arrival": (0, -1460, 180), "hero": (0, -150, 262), "path": (0, 1100, 175), "gate": (0, 3300, 175), "plaza": (0, 5000, 175)}
TREE_WORDS = ("canopy", "tree_mature_trunk", "tree_slender_trunk")
MIN_SCORE = 150.0


def _overlap(r, eye):
    ex, ey, ez = eye
    dx, dy = r["x"] - ex, r["y"] - ey
    dist = math.hypot(dx, dy)
    if dist < 300 or dy < 0:
        return 0.0
    az = math.degrees(math.atan2(dy, dx))
    half = math.degrees(math.atan2(r["radius"], dist))
    lo_az, hi_az = max(az - half, 45.0), min(az + half, 135.0)
    e_lo = math.degrees(math.atan2(max(r["zmin"], 250) - ez, dist))
    e_hi = math.degrees(math.atan2(r["zmax"] - ez, dist))
    lo_e, hi_e = max(e_lo, 6.0), min(e_hi, 40.0)
    return max(0.0, hi_az - lo_az) * max(0.0, hi_e - lo_e)


def build():
    rows = json.loads((HERE / "vegetation_census_2026-09-13.json").read_text(encoding="utf-8"))["rows"]
    rows = [r for r in rows if r["kind"] == "instance" and any(w in r["mesh"] for w in TREE_WORDS)]
    crowns = [r for r in rows if "canopy" in r["mesh"]]
    trims, factors = [], {}
    for r in crowns:
        score = sum(_overlap(r, e) for e in EYES.values())
        if score < MIN_SCORE:
            continue
        target = CROWN_TOP_NEAR if abs(r["x"]) < NEAR_PATH_UU else CROWN_TOP_FAR
        k = (target - GROUND) / (r["zmax"] - GROUND)
        if k >= 0.97:
            continue
        factors[(r["x"], r["y"])] = (round(k, 3), round(score))
    for r in rows:
        key = next((xy for xy in factors if math.hypot(xy[0] - r["x"], xy[1] - r["y"]) < 200.0), None)
        if key is None:
            continue
        k, score = factors[key]
        t = r["transform"]
        after = list(t)
        after[2] = round(GROUND + (t[2] - GROUND) * k, 3)          # the instance's own z, pulled toward the ground
        after[6], after[7], after[8] = round(t[6] * k, 4), round(t[7] * k, 4), round(t[8] * k, 4)
        trims.append({"name": r["name"], "label": r["label"], "batch": r["batch"], "mesh": r["mesh"], "index": r["index"], "at": [r["x"], r["y"]],
                      "factor": k, "score": score, "top_before": r["zmax"], "before": t, "after": after})
    return {"pass": PASS, "title": "Sightline trim: path-side tree crowns lowered so the city reads through the garden",
            "trims": trims, "summary": {"trees": len(factors), "instances": len(trims)}}


if __name__ == "__main__":
    spec = build()
    out = HERE / "veg01_sightlines.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %s -> %s" % (PASS, spec["summary"], out.name))
    for t in spec["trims"]:
        print("  %-10s %-24s %s k %.2f score %d top %d" % (t["mesh"].replace("SM_", ""), t["batch"][:24], t["at"], t["factor"], t["score"], t["top_before"]))
