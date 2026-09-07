#!/usr/bin/env python3
"""Does Wonderland have a HIERARCHY, or is it one density tiled outward?

    python3 wonderland/v2/tools/hierarchy.py [--json out.json] [--bins 8]

The reference boards read as a dense architectural core, a looser midground
of landmark clusters separated by landscape, and an atmospheric distance of
larger, sparser masses. A world built from one quarter recipe repeated at one
spacing reads as a tiled field however good the recipe is -- and that is not
something a camera reports, because every camera stands in the core.

So this measures the three things a hierarchy actually is:

  1. RADIAL PROFILE -- placements per hectare by class, in annuli out from
     the origin. A hierarchy falls monotonically; a tiling is flat.
  2. QUARTERS -- every outer-world quarter's size, structure count, footprint
     radius, tallest silhouette and distance to its nearest neighbour. A
     hierarchy spreads these; a tiling makes them equal.
  3. VARIANCE -- the coefficient of variation of quarter size and of quarter
     spacing, plus the core:mid:far density ratios. Uniformity has a number.

The classes matter: paving and lawn are SURFACE (they are the ground, not
things standing on it) and are excluded from density, which is why a road
does not make an empty quarter look full.
"""
import json
import math
import os
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "..", "infra", "build", "hd"))
os.environ.setdefault("WLV2_PASS02", "1")
os.environ.setdefault("WLV2_PASS03", "1")

import layout_v2 as LAYOUT     # noqa: E402

#: THE HIERARCHY GOVERNS THE OUTER WORLD, NOT GOLDEN ARRIVAL. The district is
#: authored, approved composition -- its own falloff (plaza, approach, flank,
#: outskirt) and the castle focal plane at 95-140 m are decisions, not tiling.
#: Measuring them together makes the castle massing read as a ring and hides
#: whether the QUARTERS have a hierarchy, which is the question. `--only=outer`
#: keeps the quarters, their roads and the far tier; the default keeps
#: everything, because the world a walker sees is the sum.
OUTER_PREFIXES = ("Q", "S", "D", "C", "RingRoad", "Country")

#: Ground you walk ON rather than things standing on it. Counting these as
#: density makes a paved road read as a populated place.
SURFACE = ("garden_lawn", "terrace_platform", "stone_ring_base", "path_steps",
           "side_steps", "kerb_stone", "ground_flowers", "ground_blooms",
           "flagstone")
SKY = ("sky_dome", "cloud_", "sea_", "horizon_")
#: Built mass: walls, towers, castles, arches, roofs -- the architecture.
ARCH = ("tower_capped", "castle_", "garden_wall", "retaining_wall", "gate_pier",
        "gate_leaf", "garden_arch_stone", "facade_panel", "roof_", "balcony_ring",
        "balustrade", "floral_arch", "gate_arch_gold", "fountain_",
        # the signature skyline -- absent here, the pass that built the
        # world's tallest architecture would have registered as zero
        # architecture, which is the same fail-open shape as a missing FOOT
        # entry and would have been just as quiet.
        "spire_great", "spire_signature", "spire_halo_ring", "tower_district",
        # AND THE SAME THING HAPPENED AGAIN, one pass later. The note above
        # was written for the signature skyline; PASS 29 then authored a whole
        # architectural vocabulary -- fourteen district landmarks and seven
        # depth recipes -- and none of it was added here. Every one of these
        # was classed `prop`, beside the garden benches and the finial balls:
        #
        #   floating_stair 124.6 m   key_colossal 84.0   clock_grand 54.4
        #   glass_pavilion  54.0     teapot_pavilion 48.2  gear_monument 31.0
        #   gatehouse_district 28.4  orrery_gold 26.4    glass_screen 23.9
        #   lantern_strange 21.8     cloister_square 20.2  tower_clock 11.9
        #
        # Measured, from `skyline.bboxes()`. A world whose fourteen district
        # landmarks are props reports its districts as having no architecture,
        # which is exactly what it did: eleven meadows and three groves at
        # arch=0 with a 54 m rotunda standing in one of them.
        "arch_stone", "column_ornate", "gatehouse_", "cloister_square",
        "glass_screen", "glass_pavilion", "teapot_pavilion", "bridge_arc",
        "clock_grand", "tower_clock", "floating_stair", "stairs_broad",
        "gear_monument", "orrery_gold", "lantern_strange", "key_colossal",
        # `flower_colossal` is three 20 m blooms in metal and glass and it is
        # the Royal Gardens' district landmark. VEG matches "flower_", so
        # until now it was VEGETATION -- a landmark counted as scrub. ARCH is
        # tested before VEG in `klass`, so naming it here is the whole fix.
        "flower_colossal")
#: The silhouette pieces -- what reads at distance and gives a place a name.
LANDMARK = ("finial_spire", "mushroom_landmark", "mushroom_giant", "castle_tower",
            "castle_dome", "tower_capped", "clock_ornate", "heart_topiary",
            "spire_great", "spire_signature", "tower_district",
            # the fourteen district landmarks, which are the things this
            # world's outer districts are actually named for
            "clock_grand", "gear_monument", "floating_stair", "lantern_strange",
            "teapot_pavilion", "glass_pavilion", "key_colossal",
            "flower_colossal")
#: Glazing, gills and water that RIDE a frame which is itself the landmark.
#: `is_landmark` matches by prefix, so `mushroom_giant` has always also matched
#: its own gills, spots and rim -- every giant mushroom in Wonderland has been
#: counted four times, and adding the district landmarks by prefix would have
#: doubled each of those too. One piece, one landmark.
LANDMARK_RIDERS = ("mushroom_giant_gills", "mushroom_giant_spots",
                   "mushroom_giant_rim", "glass_pavilion_lights",
                   "flower_colossal_bloom", "lantern_strange_glass",
                   "glass_screen_panes", "gatehouse_glass",
                   "fountain_grand_water")
#: Everything green.
VEG = ("tree_", "canopy_", "topiary_", "hedge_", "shrub_", "rose_", "blossom_",
       "flower_", "lavender_", "mushroom_", "ivy_", "vine_")


def klass(asset):
    if any(asset.startswith(p) for p in SKY):
        return "sky"
    if any(asset == p or asset.startswith(p) for p in SURFACE):
        return "surface"
    if any(asset.startswith(p) for p in ARCH):
        return "arch"
    if any(asset.startswith(p) for p in VEG):
        return "veg"
    return "prop"


def is_landmark(asset):
    if asset in LANDMARK_RIDERS:
        return False
    return any(asset.startswith(p) for p in LANDMARK)


def _stats(xs):
    if not xs:
        return (0.0, 0.0, 0.0)
    m = sum(xs) / len(xs)
    v = sum((x - m) ** 2 for x in xs) / len(xs)
    return (m, math.sqrt(v), (math.sqrt(v) / m if m else 0.0))


def collect():
    """Group the outer world by quarter tag, and everything by radius."""
    pts = []
    for p in LAYOUT.ALL:
        a = p["asset"]
        k = klass(a)
        if k == "sky":
            continue
        x, y = p["pos"][0], p["pos"][1]
        lab = p.get("label") or ""
        # a quarter tag is the label's first field: Q07_towers_Wall3 -> Q07_towers
        tag = None
        parts = lab.split("_")
        if len(parts) >= 2 and (parts[0][:1] in ("Q", "S", "D", "C")) and parts[0][1:].isdigit():
            tag = parts[0] + "_" + parts[1]
        pts.append({"asset": a, "k": k, "x": x, "y": y, "r": math.hypot(x, y),
                    "tag": tag, "landmark": is_landmark(a),
                    "top": p["pos"][2] + 0.0, "label": lab})
    return pts


def radial(pts, bins, rmax):
    """Density per hectare in annuli out from the origin."""
    step = rmax / bins
    rows = []
    for b in range(bins):
        r0, r1 = b * step, (b + 1) * step
        area_ha = math.pi * (r1 ** 2 - r0 ** 2) / 1e4 / 1e4   # uu^2 -> m^2 -> ha
        sel = [p for p in pts if r0 <= p["r"] < r1]
        solid = [p for p in sel if p["k"] != "surface"]
        rows.append({
            "r0_m": r0 / 100.0, "r1_m": r1 / 100.0, "area_ha": area_ha,
            "n": len(solid),
            "per_ha": len(solid) / area_ha if area_ha else 0.0,
            "arch_per_ha": sum(1 for p in solid if p["k"] == "arch") / area_ha if area_ha else 0.0,
            "veg_per_ha": sum(1 for p in solid if p["k"] == "veg") / area_ha if area_ha else 0.0,
            "prop_per_ha": sum(1 for p in solid if p["k"] == "prop") / area_ha if area_ha else 0.0,
            "landmarks": sum(1 for p in solid if p["landmark"]),
        })
    return rows


def quarters(pts):
    by = defaultdict(list)
    for p in pts:
        if p["tag"]:
            by[p["tag"]].append(p)
    rows = []
    for tag, ps in sorted(by.items()):
        solid = [p for p in ps if p["k"] != "surface"]
        if not solid:
            continue
        cx = sum(p["x"] for p in solid) / len(solid)
        cy = sum(p["y"] for p in solid) / len(solid)
        d = sorted(math.hypot(p["x"] - cx, p["y"] - cy) for p in solid)
        r90 = d[int(0.90 * (len(d) - 1))]
        # r50 is the MASS. r90 is the reach, and for a kind whose content is
        # deliberately spread -- a meadow's drifts and hedgerows -- the two are
        # very different numbers. "Is one quarter standing inside another" is a
        # question about mass; "do their edges meet" is a question about reach.
        r50 = d[int(0.50 * (len(d) - 1))]
        rows.append({
            "tag": tag, "kind": tag.split("_")[1], "cx": cx, "cy": cy,
            "r_from_origin_m": math.hypot(cx, cy) / 100.0,
            "n": len(solid),
            "arch": sum(1 for p in solid if p["k"] == "arch"),
            "veg": sum(1 for p in solid if p["k"] == "veg"),
            "prop": sum(1 for p in solid if p["k"] == "prop"),
            "landmarks": sum(1 for p in solid if p["landmark"]),
            "r90_m": r90 / 100.0, "r50_m": r50 / 100.0,
            "density_per_ha": len(solid) / (math.pi * (r90 / 100.0) ** 2 / 1e4) if r90 else 0.0,
        })
    # nearest-neighbour spacing between quarter centres
    for a in rows:
        best = 1e18
        for b in rows:
            if b is a:
                continue
            best = min(best, math.hypot(a["cx"] - b["cx"], a["cy"] - b["cy"]))
        a["nn_m"] = best / 100.0
    return rows


def _is_outer(label):
    parts = (label or "").split("_")
    if not parts:
        return False
    if parts[0].startswith("RingRoad") or parts[0].startswith("Country"):
        return True
    return (parts[0][:1] in ("Q", "S", "D", "C")) and parts[0][1:].isdigit()


def main():
    bins = int(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--bins=")), 8))
    rmax = float(next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--rmax=")), 20000))
    only = next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--only=")), "all")
    pts = collect()
    if only == "outer":
        pts = [p for p in pts if _is_outer(p["label"])]
    print("SCOPE: %s (%d placements)\n" % (only, len(pts)))
    prof = radial(pts, bins, rmax)
    qs = quarters(pts)

    print("RADIAL DENSITY PROFILE (solid placements per hectare, surface excluded)")
    print("%-14s %8s %7s %8s %8s %8s %8s %6s" %
          ("annulus m", "area ha", "n", "per ha", "arch/ha", "veg/ha", "prop/ha", "lmk"))
    print("-" * 78)
    for r in prof:
        print("%6.0f..%-7.0f %8.2f %7d %8.1f %8.1f %8.1f %8.1f %6d" %
              (r["r0_m"], r["r1_m"], r["area_ha"], r["n"], r["per_ha"],
               r["arch_per_ha"], r["veg_per_ha"], r["prop_per_ha"], r["landmarks"]))

    print("\nQUARTERS (%d)" % len(qs))
    print("%-14s %8s %6s %5s %5s %5s %4s %7s %9s %7s" %
          ("tag", "r orig m", "n", "arch", "veg", "prop", "lmk", "r90 m", "dens/ha", "nn m"))
    print("-" * 88)
    for q in sorted(qs, key=lambda q: q["r_from_origin_m"]):
        print("%-14s %8.1f %6d %5d %5d %5d %4d %7.1f %9.1f %7.1f" %
              (q["tag"], q["r_from_origin_m"], q["n"], q["arch"], q["veg"], q["prop"],
               q["landmarks"], q["r90_m"], q["density_per_ha"], q["nn_m"]))

    n_m, n_sd, n_cv = _stats([q["n"] for q in qs])
    s_m, s_sd, s_cv = _stats([q["nn_m"] for q in qs])
    r_m, r_sd, r_cv = _stats([q["r90_m"] for q in qs])
    d_m, d_sd, d_cv = _stats([q["density_per_ha"] for q in qs])

    # tier ratios: split the quarters by distance into thirds by count
    byr = sorted(qs, key=lambda q: q["r_from_origin_m"])
    third = max(1, len(byr) // 3)
    tiers = (byr[:third], byr[third:2 * third], byr[2 * third:])
    print("\nUNIFORMITY (a hierarchy has SPREAD; a tiling has none)")
    print("  quarter size      mean %6.1f  sd %6.1f  CV %.3f" % (n_m, n_sd, n_cv))
    print("  quarter footprint mean %6.1f  sd %6.1f  CV %.3f  (r90, m)" % (r_m, r_sd, r_cv))
    print("  quarter spacing   mean %6.1f  sd %6.1f  CV %.3f  (nearest neighbour, m)" % (s_m, s_sd, s_cv))
    print("  quarter density   mean %6.1f  sd %6.1f  CV %.3f  (per ha)" % (d_m, d_sd, d_cv))
    labels = ("core-most", "middle", "outer-most")
    print("\nTIERS BY DISTANCE (thirds of the quarter list)")
    print("%-12s %6s %9s %9s %9s %9s" % ("tier", "n_q", "mean n", "mean r90", "mean dens", "mean lmk"))
    means = []
    for lab, t in zip(labels, tiers):
        if not t:
            continue
        mn = sum(q["n"] for q in t) / len(t)
        mr = sum(q["r90_m"] for q in t) / len(t)
        md = sum(q["density_per_ha"] for q in t) / len(t)
        ml = sum(q["landmarks"] for q in t) / len(t)
        means.append(md)
        print("%-12s %6d %9.1f %9.1f %9.1f %9.2f" % (lab, len(t), mn, mr, md, ml))
    if len(means) == 3 and means[2]:
        print("\n  quarter-intrinsic core:far %.2fx  -- how much simpler a far"
              " quarter is than a core one" % (means[0] / means[2]))

    # THE RATIO THAT ANSWERS THE QUESTION. The one above compares the density
    # INSIDE quarters, and a far wood is meant to be internally dense -- a wood
    # is dense; there are simply fewer of them, further apart. What the brief
    # is about is what a walker crosses: placements per hectare of GROUND.
    live = [r for r in prof if r["per_ha"] > 0]
    if live:
        pk = max(live, key=lambda r: r["per_ha"])
        outer = live[-1]
        print("  GROUND core:far %.2fx   (%.0f per ha at %.0f-%.0f m -> %.0f at %.0f-%.0f)"
              % (pk["per_ha"] / outer["per_ha"] if outer["per_ha"] else 0.0,
                 pk["per_ha"], pk["r0_m"], pk["r1_m"],
                 outer["per_ha"], outer["r0_m"], outer["r1_m"]))
        print("           a tiling is 1.0; the reference boards read past 2.5")

    # MONOTONICITY. A hierarchy falls outward. Anywhere the profile RISES
    # with distance is a ring: a band of ground thinner than what surrounds
    # it on both sides, which is the shape the first outer world had at
    # 50-75 m and the single most legible way a generated world reads as
    # generated.
    # The profile RAMPS UP into its peak -- Golden Arrival's own falloff, or
    # the radius where the outer world begins -- and only what happens after
    # the peak is the hierarchy. Rises before it are the world starting.
    peak = max(range(len(prof)), key=lambda i: prof[i]["per_ha"]) if prof else 0
    print("\nMONOTONICITY (each annulus against the one inside it, from the peak out)")
    bad = 0
    for a, b in zip(prof[peak:], prof[peak + 1:]):
        if a["per_ha"] <= 0 and b["per_ha"] <= 0:
            continue
        mark = ""
        if b["per_ha"] > a["per_ha"] * 1.02:
            mark = "  <-- RISES outward"
            bad += 1
        print("  %5.0f..%-5.0f %8.1f  ->  %5.0f..%-5.0f %8.1f%s"
              % (a["r0_m"], a["r1_m"], a["per_ha"], b["r0_m"], b["r1_m"], b["per_ha"], mark))
    print("  peak at %.0f..%.0f m; %d band(s) beyond it denser than the band inside them"
          % (prof[peak]["r0_m"], prof[peak]["r1_m"], bad))

    # OVERLAP. Two quarters 9.7 m apart with 21 m footprints put a tower
    # inside a parterre, and nothing reported it because every piece resolved.
    # TWO THRESHOLDS, because they are two different facts. Quarters whose
    # 90%-footprints overlap are ADJACENT -- in the core that is the dense
    # packing the brief asks for, and reporting it as a fault would push the
    # world back toward the uniform ring it started as. Quarters whose centres
    # are inside 0.3 of the two footprints are NESTED: one is standing in the
    # other, which is the defect that put a tower in a parterre.
    # KIND-AWARE, the same way the layout's own `_want_gap` is. Landscape
    # systems merge on purpose -- a meadow running into a wood is country, and
    # `_BODY["meadow"]` is 0.30 precisely so they can. Reporting those as
    # nested would push the world back toward the uniform ring this whole
    # phase removed. Two meadows 30 m apart with 55 m footprints is the
    # feature; a CLOCKYARD 30 m inside a court is the defect.
    SOFT_KINDS = ("meadow", "wood", "grove")
    over, nested = [], []
    for i, a in enumerate(qs):
        for b in qs[i + 1:]:
            d = math.hypot(a["cx"] - b["cx"], a["cy"] - b["cy"]) / 100.0
            span = a["r90_m"] + b["r90_m"]
            # r50 was tried here and is the wrong instrument: a meadow's
            # content is spread EVENLY, so its half-mass is 0.75 of its reach,
            # not a fraction of it, and the test got worse. The rule that
            # works is the layout's own: `_BODY["meadow"]` is 0.30 because
            # open country is meant to lap against whatever is beside it, so
            # any pair involving a meadow is adjacency and not nesting.
            soft = ("meadow" in (a["kind"], b["kind"])
                    or (a["kind"] in SOFT_KINDS and b["kind"] in SOFT_KINDS))
            if d < span * 0.30 and not soft:
                nested.append((d, a, b))
            elif d < span * 0.5:
                over.append((d, a, b))
    print("\nNESTED QUARTERS (centres inside 0.3 of the two footprints -- a defect)")
    if not nested:
        print("  none")
    for d, a, b in sorted(nested)[:12]:
        print("  %-14s %-14s  %5.1f m apart, footprints %.1f + %.1f"
              % (a["tag"], b["tag"], d, a["r90_m"], b["r90_m"]))
    print("\nADJACENT QUARTERS (footprints overlap -- dense packing, not a fault)")
    if not over:
        print("  none")
    for d, a, b in sorted(over)[:8]:
        print("  %-14s %-14s  %5.1f m apart, footprints %.1f + %.1f  (score %.2f)"
              % (a["tag"], b["tag"], d, a["r90_m"], b["r90_m"],
                 LAYOUT.HIER(a["cx"], a["cy"])["score"]))

    # EMBEDDED LANDMARKS. walkable.py once found a landmark standing INSIDE a
    # tower, and it found it by accident -- the route to it had no route. This
    # asks directly: is any landmark's centre inside another piece's footprint?
    # A landmark is the thing a place is named for; one buried in a wall is
    # both a wasted draw and a lie about where the player is being sent.
    FOOT = {"hedge_mass": (320, 320), "garden_wall": (255, 50), "gate_pier": (95, 95),
            "tower_capped": (400, 400), "castle_tower": (400, 400),
            "castle_hall": (600, 600), "castle_arcade": (420, 200),
            "tree_mature_trunk": (105, 105), "hedge_block": (176, 75),
            "retaining_wall": (255, 50), "fountain_basin": (300, 300)}
    #: BURIED IS A 3D QUESTION. This test was plan-only, so it reported a clock
    #: ornament hanging 5.6 m up a tree as "inside" the 2.6 m hedge beneath it
    #: -- a standing false finding on the founder-approved arrival composition,
    #: which is exactly the kind of noise that gets a real one ignored. Tops
    #: are measured from the recipes in assets_v2. An asset with no entry keeps
    #: the old plan-only behaviour, so the test fails CLOSED on anything new.
    TOP = {"hedge_mass": 154.0,        # spheres to z=120 r=78, z-scaled 0.78
           "hedge_block": 127.0,       # 353 x 150 x 127
           "garden_wall": 420.0, "retaining_wall": 300.0, "gate_pier": 700.0,
           "fountain_basin": 190.0, "tree_mature_trunk": 900.0}
    bodies = []
    for p in LAYOUT.ALL:
        hw = FOOT.get(p["asset"])
        if not hw:
            continue
        sc = p["scale"]
        sx, sy = (abs(sc[0]), abs(sc[1])) if isinstance(sc, (list, tuple)) else (abs(sc), abs(sc))
        sz = abs(sc[2]) if isinstance(sc, (list, tuple)) and len(sc) > 2 else sx
        top = TOP.get(p["asset"])
        bodies.append((p["pos"][0], p["pos"][1], hw[0] * sx, hw[1] * sy,
                       math.radians(p["rot"][1]), p.get("label") or "", p["asset"],
                       None if top is None else p["pos"][2] + top * sz))
    buried = []
    for p in LAYOUT.ALL:
        if not is_landmark(p["asset"]):
            continue
        lx, ly, lab = p["pos"][0], p["pos"][1], (p.get("label") or "")
        group = lab.split("_")[0]
        for (ox, oy, hx, hy, yaw, olab, oasset, otop) in bodies:
            # A finial stands on its own tower and a dome on its own hall.
            # Pieces of one composition sharing ground is the composition;
            # what this is looking for is a landmark inside SOMEONE ELSE'S
            # geometry, so anything with the same group prefix is skipped.
            if olab == lab or olab.split("_")[0] == group:
                continue
            # Standing ABOVE a piece is not standing inside it.
            if otop is not None and p["pos"][2] >= otop:
                continue
            dx, dy = lx - ox, ly - oy
            if dx * dx + dy * dy > (hx + hy) ** 2:
                continue
            c, s = math.cos(yaw), math.sin(yaw)
            if abs(dx * c + dy * s) <= hx and abs(-dx * s + dy * c) <= hy:
                buried.append((lab, p["asset"], olab, oasset))
                break
    print("\nEMBEDDED LANDMARKS (a landmark's centre inside another piece)")
    if not buried:
        print("  none")
    for (lab, a, olab, oa) in buried[:12]:
        print("  %-28s %-18s inside %-28s %s" % (lab, a, olab, oa))
    if len(buried) > 12:
        print("  ... and %d more" % (len(buried) - 12))

    # ROADS THROUGH PLACES THEY DO NOT SERVE. The road tree joins each quarter
    # to its nearest neighbour closer in, in a straight line, and a straight
    # line between two quarters can cross a third. A road ARRIVING at a
    # quarter is inside it on purpose -- 45% of segments are, and every one of
    # those is a road entering the place it was built for -- so the question
    # has to be asked about the quarters a road does NOT terminate in.
    roads = {}
    for p in LAYOUT.ALL:
        lab = p.get("label") or ""
        # ANY road, by the one thing they all share. This matched "_Road" and
        # "RingRoad" only, so the north way and the district lanes -- 32 roads
        # between them -- were never audited for crossings at all. Every road
        # this layout lays comes out of `_road`, and `_road` names its pieces
        # "<tag>_Seg<n>".
        if p["asset"] != "terrace_platform" or "_Seg" not in lab:
            continue
        roads.setdefault(lab.rsplit("_Seg", 1)[0], []).append(p["pos"])
    crossing, segs = [], 0
    for key, pl in roads.items():
        pl = sorted(pl)
        a, b = pl[0], pl[-1]
        ends = set()
        for s in LAYOUT.SITES:
            H = LAYOUT._squeezed(LAYOUT.HIER(s["x"], s["y"]), s.get("squeeze", 1.0))
            rr = LAYOUT._reach(s["kind"], H) * 1.15
            if (math.hypot(a[0] - s["x"], a[1] - s["y"]) < rr
                    or math.hypot(b[0] - s["x"], b[1] - s["y"]) < rr):
                ends.add(s["tag"])
        for q in pl:
            segs += 1
            for s in LAYOUT.SITES:
                if s["tag"] in ends:
                    continue
                H = LAYOUT._squeezed(LAYOUT.HIER(s["x"], s["y"]), s.get("squeeze", 1.0))
                if math.hypot(q[0] - s["x"], q[1] - s["y"]) < LAYOUT._body(s["kind"], H) * 0.8:
                    crossing.append((key, s["tag"]))
                    break
    print("\nROADS (%d segments in %d roads)" % (segs, len(roads)))
    print("  crossing a quarter the road does not serve: %d" % len(crossing))
    for k, t in crossing[:8]:
        print("    %-26s through %s" % (k, t))

    # WAYFINDING. A road is not only a surface to walk on; it is the thing
    # that tells a player where they are and where to go next. The founder's
    # word for this is that the world must be READABLE, and the failure it
    # names is standing somewhere with nothing to walk toward.
    #
    # The measure is deliberately blunt and honest: from every road segment,
    # how far is the nearest LANDMARK -- the tall, named things a place is
    # known by. It cannot see occlusion and does not claim to; what it finds
    # is stretches of road with no beacon within sight at all, which is a
    # different and much more common failure than a beacon behind a tree.
    marks = [(p["pos"][0], p["pos"][1]) for p in LAYOUT.ALL if is_landmark(p["asset"])]
    SIGHT = 12000.0          # 120 m: the far arc is 340 m, quarters ~50 m
    per_road, blind = {}, []
    for key, pl in roads.items():
        ds = []
        for q in pl:
            d = min(math.hypot(q[0] - mx, q[1] - my) for (mx, my) in marks)
            ds.append(d)
            if d > SIGHT:
                blind.append((d, key, q[0], q[1]))
        per_road[key] = (min(ds), sum(ds) / len(ds), max(ds), len(ds))
    alld = sorted(d for key, pl in roads.items() for d in
                  [min(math.hypot(q[0] - mx, q[1] - my) for (mx, my) in marks) for q in pl])
    def pct(f):
        return alld[min(len(alld) - 1, int(len(alld) * f))] / 100.0 if alld else 0.0
    print("\nWAYFINDING (distance from a road to the nearest landmark)")
    print("  %d landmarks; road median %.0f m, p90 %.0f m, worst %.0f m"
          % (len(marks), pct(0.5), pct(0.9), alld[-1] / 100.0 if alld else 0.0))
    print("  segments with NO landmark within %.0f m: %d of %d (%.1f%%)"
          % (SIGHT / 100.0, len(blind), len(alld), 100.0 * len(blind) / max(1, len(alld))))
    # A ROAD IS BLIND ALONG ITS WHOLE LENGTH OR IT IS NOT BLIND. One segment
    # past the threshold on a road that is otherwise well served is a corner,
    # not a wayfinding hole; a road whose CLOSEST point is past it is a
    # stretch a player walks with nothing to aim at.
    whole = sorted(((v[0], k, v[3]) for k, v in per_road.items() if v[0] > SIGHT), reverse=True)
    print("  roads whose every segment is beyond it: %d of %d" % (len(whole), len(roads)))
    for (d, k, n) in whole[:8]:
        print("    %-26s %2d segments, nearest landmark %.0f m" % (k, n, d / 100.0))

    solid = [p for p in pts if p["k"] != "surface"]
    print("\nWORLD: %d solid placements, %d surface, %d landmarks, %d quarters"
          % (len(solid), len(pts) - len(solid),
             sum(1 for p in solid if p["landmark"]), len(qs)))

    out = next((a.split("=")[1] for a in sys.argv[1:] if a.startswith("--json=")), None)
    if out:
        with open(out, "w") as fh:
            json.dump({"radial": prof, "quarters": qs,
                       "cv": {"size": n_cv, "spacing": s_cv, "footprint": r_cv,
                              "density": d_cv}}, fh, indent=1)
        print("wrote %s" % out)


if __name__ == "__main__":
    main()
