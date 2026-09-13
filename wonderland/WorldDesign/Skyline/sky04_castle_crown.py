#!/usr/bin/env python3
"""SKY04 -- the castle city's crown: spires, needles, balconies and sky bridges in the 50-300 m band.

WHAT THE BIBLE SHOWS (VISUAL_AUTHORITY.md; bible_panels.json hero_b1, skyline_b4, scale_depth_b2). Behind
the garden the city fills the upper half of the frame: hundreds of slender towers under tall pink and
lavender cones, domes carrying gold needles, balconied shafts, bridges crossing between towers at height.

WHAT WAS THERE (bible-compare, 2026-09-13). From the arrival and the hero camera the castle city is a
narrow strip at the top of the frame: halls whose roofs top out around 10 m, domes at 16-57 m, and some
seventy towers, most of them without a single balcony or bridge. The city reads as a castle, not as the
enormous enchanted metropolis the boards show.

WHAT THIS LAYER ADDS, only on existing castle blocks (census_city_2026-09-13.json), so nothing stands on
a street and nothing blocks a route:
  HALL SPIRES   slender kit shafts with needle terminators rising out of castle hall roofs -- where the
                spire clears everything in front of it from the hero AND path eyes by SHOW_UU (occluders
                from census_north, as SKY02). Shaft radius stays within the hall's own depth.
  DOME NEEDLES  a kit spire on the crown of every dome in view, the gold-tipped needle the boards put
                on domes.
  BALCONIES     SM_balcony_ring at 70 percent height on round and octagonal towers taller than 25 m.
  SKY BRIDGES   WL_Bridge_Sky between tower pairs 18-40 m apart, both taller than 30 m, at 60 percent of
                the lower tower's height, scaled to the gap.
Nothing here collides except what the tower it stands on already does.
"""
import json
import math
import random
from pathlib import Path

import kitstack as kit
import sky02_needle_skyline as sky02

HERE = Path(__file__).resolve().parent
PASS = "SKY04"
CITY = json.loads((HERE / "census_city_2026-09-13.json").read_text(encoding="utf-8"))
V2 = "/Game/WonderlandV2/"
BALCONY = V2 + "Architecture/Castle/SM_balcony_ring.SM_balcony_ring"

# The occluder table (sky02) is built per eye, so the path eye joins sky02's table, not a copy of it.
sky02.EYES["path"] = (0.0, 1100.0, 175.0)      # a walker on the garden path, before the heart arch
EYES = sky02.EYES
HERO = EYES["hero"]
SHOW_UU = 800.0
CONE = (30.0, 150.0)
SPIRE_KEEPOUT_DEG = 7.0
HALL_BAND = (9000.0, 32000.0)
MAX_HALL_SPIRES = 60
OVERLAP_UU = 1500.0          # a spire may stay up to 15 m inside the silhouette in front of it: layering is density
MIN_SPIRE_GAP_UU = 1200.0
# hall mesh: extent 630 x 434 x 500 at 1x; dome radius 310.5; tower radii at 1x
HALL_HALF_DEPTH = 434.0
DOME_RADIUS = 310.5
TOWER_RADIUS = {"SM_castle_tower_slender": 134.0, "SM_castle_tower_octagon": 345.0, "SM_castle_tower": 288.0}

C = {name: i for i, name in enumerate(CITY["columns"])}
SOFT_WORDS = ("canopy", "tree", "blossom", "hedge", "leaf", "flower", "topiary", "vine", "ivy", "rose", "bloom",
              "cloud", "balloon", "shrub", "bush", "lavender", "grass", "fern", "petal")


def _solid(mesh_name):
    """Skyline visibility is judged against ARCHITECTURE. Crowns are leafy, gappy and being framed
    (vegetation trims), so a canopy 60 m from the path must not decide how tall a city 700 m out is."""
    low = mesh_name.lower()
    return not any(w in low for w in SOFT_WORDS)


def _architecture_occluders():
    """sky02's occluder table over solid pieces only (see _solid)."""
    tall = sky02.CENSUS["tall"]
    sky02.CENSUS["tall"] = [r for r in tall if _solid(r[1])]
    try:
        return sky02._occluders()
    finally:
        sky02.CENSUS["tall"] = tall


def _bearing(x, y):
    return math.degrees(math.atan2(y - HERO[1], x - HERO[0]))


def _in_view(x, y):
    b = _bearing(x, y)
    return CONE[0] <= b <= CONE[1] and abs(b - 90.0) >= SPIRE_KEEPOUT_DEG


def build():
    rng = random.Random(20260913 + 104)
    occ = _architecture_occluders()
    hovers_none, actors = [], []
    batches = kit.Batches(PASS)
    blocks = CITY["blocks"]

    # ---------------------------------------------------------------- hall spires
    shaft_spellings = [
        ["WL_Tower_Mid_Fluted", "WL_Spire_Needle"],
        ["WL_Tower_Mid_Lantern", "WL_Tower_Mid_Fluted", "WL_Spire_Twisted"],
        ["WL_Tower_Mid_Fluted", "WL_Spire_Ringed"],
        ["WL_Tower_Mid_Lantern", "WL_Spire_Barbed"],
        ["WL_Tower_Mid_Fluted", "WL_Tower_Mid_Lantern", "WL_Spire_Cluster"],
        ["WL_Tower_Mid_Lantern", "WL_Tower_Mid_Fluted", "WL_Spire_Needle"],
    ]
    halls = [r for r in blocks if r[C["mesh"]] == "SM_castle_hall" and HALL_BAND[0] <= r[C["dist"]] <= HALL_BAND[1]
             and _in_view(r[C["x"]], r[C["y"]])]
    candidates = []
    for r in halls:
        x, y, top, hs = r[C["x"]], r[C["y"]], r[C["zmax"]], r[C["scale"]]
        need = max(sky02._need(occ, name, x, y) for name in EYES)
        candidates.append((need - top, r))
    candidates.sort(key=lambda c: c[0])
    spires = []
    for gap, r in candidates:
        if len(spires) >= MAX_HALL_SPIRES:
            break
        x, y, top, hs = r[C["x"]], r[C["y"]], r[C["zmax"]], r[C["scale"]]
        if any(math.hypot(x - sx, y - sy) < MIN_SPIRE_GAP_UU for sx, sy, _ in spires):
            continue
        max_scale = (HALL_HALF_DEPTH + 630.0) * 0.5 * hs * 1.6 / 330.0    # a shaft may be a little wider than its hall
        best = None
        for stack in shaft_spellings:
            height = sum(kit.MODULES[n]["sockets"]["top"]["z"] for n in stack)
            for s in (0.55, 0.65, 0.75, 0.85, 1.0, 1.15, 1.3):
                if s > max_scale:
                    break
                if height * s >= gap - OVERLAP_UU:
                    best = (stack, s, height)
                    break
            if best:
                break
        if best is None:
            continue
        stack, s, height = best
        z0 = top - 150.0 * s                       # the shaft starts inside the roof
        yaw = r[C["yaw"]] + rng.choice((0.0, 90.0, 180.0, 270.0))
        batches.add_stack(stack, x, y, z0, yaw, s)
        spires.append((x, y, {"at": [x, y], "hall_top_z": top, "scale": s, "stack": stack, "top_z": round(z0 + height * s)}))

    # ---------------------------------------------------------------- dome needles
    needles = ["WL_Spire_Needle", "WL_Spire_Ringed", "WL_Spire_Twisted", "WL_Spire_Barbed"]
    domes = [r for r in blocks if r[C["mesh"]] == "SM_castle_dome" and r[C["dist"]] <= 40000 and _in_view(r[C["x"]], r[C["y"]])]
    for k, r in enumerate(domes):
        s = max(0.5, DOME_RADIUS * r[C["scale"]] * 0.32 / 300.0)
        batches.add_module(needles[k % len(needles)], r[C["x"]], r[C["y"]], r[C["zmax"]] - 40.0 * s, rng.uniform(0, 360), s)

    # ---------------------------------------------------------------- balconies
    towers = [r for r in blocks if r[C["mesh"]] in TOWER_RADIUS and r[C["dist"]] <= 40000 and _in_view(r[C["x"]], r[C["y"]])]
    balconies = 0
    for r in towers:
        h = r[C["zmax"]] - r[C["zmin"]]
        if h < 2500.0:
            continue
        radius = TOWER_RADIUS[r[C["mesh"]]] * r[C["scale"]]
        ring = radius * 1.18 / 330.0
        z = r[C["zmin"]] + 0.70 * h
        actors.append({"id": "Balcony_%d_%d" % (r[C["x"]], r[C["y"]]), "mesh": BALCONY, "loc": [r[C["x"]], r[C["y"]], round(z, 1)],
                       "rot": [0.0, round(r[C["yaw"]], 1), 0.0], "scale": [round(ring, 3), round(ring, 3), round(max(ring, 0.6), 3)],
                       "materials": ["MI_V2_IvoryStone"], "collision": "none"})
        balconies += 1

    # ---------------------------------------------------------------- sky bridges
    tall = [r for r in towers if r[C["zmax"]] >= 3000.0]
    pairs = []
    for i, a in enumerate(tall):
        for b in tall[i + 1:]:
            d = math.hypot(a[C["x"]] - b[C["x"]], a[C["y"]] - b[C["y"]])
            if 1800.0 <= d <= 4000.0:
                pairs.append((d, a, b))
    pairs.sort(key=lambda p: p[0])
    used, bridges = set(), []
    for d, a, b in pairs:
        ka, kb = (a[C["x"]], a[C["y"]]), (b[C["x"]], b[C["y"]])
        if ka in used or kb in used or len(bridges) >= 8:
            continue
        ra = TOWER_RADIUS[a[C["mesh"]]] * a[C["scale"]]
        rb = TOWER_RADIUS[b[C["mesh"]]] * b[C["scale"]]
        span = d - ra - rb + 200.0
        s = span / (3236.0 - 340.0)
        if not 0.4 <= s <= 1.4:
            continue
        mx, my = (a[C["x"]] + b[C["x"]]) / 2.0, (a[C["y"]] + b[C["y"]]) / 2.0
        yaw = math.degrees(math.atan2(b[C["y"]] - a[C["y"]], b[C["x"]] - a[C["x"]]))
        z = min(a[C["zmax"]], b[C["zmax"]]) * 0.60 - 402.0 * s
        batches.add_module("WL_Bridge_Sky", mx, my, z, yaw, s)
        used.update((ka, kb))
        bridges.append({"between": [ka, kb], "scale": round(s, 3), "z": round(z)})

    return {"pass": PASS, "title": "Castle crown: hall spires, dome needles, balconies and sky bridges in the 50-300 m band",
            "folder": "Wonderland/Authored/SKY04", "tags": ["V2_Castle"], "actors": actors, "batches": batches.as_list(),
            "summary": {"hall_spires": len(spires), "dome_needles": len(domes), "balconies": balconies, "bridges": len(bridges),
                        "halls_considered": len(halls)},
            "spires": [s[2] for s in spires], "bridges": bridges}


if __name__ == "__main__":
    spec = build()
    out = HERE / "sky04_castle_crown.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %s, %d batches, %d instances, %d actors -> %s" % (PASS, spec["summary"], len(spec["batches"]),
          sum(len(b["instances"]) for b in spec["batches"]), len(spec["actors"]), out.name))
