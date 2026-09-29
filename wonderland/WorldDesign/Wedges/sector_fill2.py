#!/usr/bin/env python3
"""SECTOR FILL 2 -- the empty ground left after window 1 (2026-09-29), filled with the proven heartland recipe.

WHY. The census after window 1 (zzW101: 222,894 rows, 0 unloaded) puts the disc at 26.3% empty, structure-only.
What is left inside 1,200 m is not one place. It is:
  * the lawn the first heartland fills left between their groups (8 ha at NOCTIS 197°, 7 ha at 253°, ...);
  * the gaps between the fill wedges (NOCTIS 220°, ICARUS 74°);
  * the frontier strips at 1,000-1,200 m (TARTARUS 356°, NOCTIS 253° / 164°, ICARUS 88°);
  * the core rim at 400-600 m (CORE's queue Q11, handed to SECOND).
The founder's rule: every large empty area is authored or has a reason. Lawn left "because the generator
stopped" is not a reason.

HOW. No new recipe: this is sector_fill.fill() -- the garden walk, quarters, rooms, a mushroom wood, groves and
meadow drifts -- run on a wedge fitted to each empty region of the post-window-1 emptiness audit, planned against
the census that already holds every fill. So it only takes ground that is still free, and its walk joins the
paving already there (earlier walks included).

A region's wedge is fitted to its own shape: the bearing and radial span from the audit, and a half-angle from its
width (area / radial span), which keeps it clear of the avenue vistas and plazas either side. The census blocks
anything already built.

EXCLUDED, by CORE's footprints: TW01 Tower Rise (centre (-17075, 44745), 40 m) and MG01 Mushroom Grove
(45084, -87535), 42 m, each kept with 20 m of margin. Also excluded: the ring band beyond 1,200 m (the wild
ring's), and anything within 20 m of the SR030 / SR150 centrelines (the census holds them as paving).

    python sector_fill2.py --plan                 list the regions it would fill, from the emptiness json
    python sector_fill2.py [--only S2N197,...]    write <id>_fill2.json + <id>_walk.json per region
"""
import argparse
import gzip
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import sector_fill as S                                                  # noqa: E402
W = S.W

AUDIT = HERE.parent.parent / "Tools" / "captures" / "zc" / "census" / "emptiness_structure_0929_win1.json"
MIN_AREA = 15000.0              # m2: smaller pockets are lawn between groups, not unfinished ground
R_MAX = 120000.0                # cm: the wild ring owns 1,200 m and beyond
KEEP_OUT = [((-17075.0, 44745.0), 4000.0 + 2000.0, "TW01"), ((45084.0, -87535.0), 4200.0 + 2000.0, "MG01")]


def nation_cfg(b):
    b %= 360.0
    if 30.0 <= b < 150.0:
        return "IC03", "I"
    if 150.0 <= b < 270.0:
        return "NC03", "N"
    return "TQ03", "T"


def regions():
    audit = json.load(open(AUDIT, encoding="utf-8"))
    out, skipped = [], []
    for reg in audit["regions_top"]:
        r0, r1 = reg["radius_span_m"]
        b = float(reg["bearing_deg"])
        if reg["area_m2"] < MIN_AREA:
            continue
        if r0 * 100.0 >= R_MAX:
            skipped.append((reg["bearing_deg"], r0, r1, "wild ring band"))
            continue
        r1 = min(r1 * 100.0, R_MAX)
        r0 = r0 * 100.0
        width = reg["area_m2"] / max(1.0, (r1 - r0) / 100.0)             # m
        half = max(3.0, min(14.0, math.degrees(0.6 * width / max(1.0, reg["centre_radius_m"]))))
        cx, cy = reg["centre_uu"]
        near = [k for (c, rad, k) in KEEP_OUT if math.hypot(cx - c[0], cy - c[1]) < rad + width * 50.0]
        if near:
            skipped.append((reg["bearing_deg"], r0 / 100, r1 / 100, "near " + ",".join(near)))
            continue
        cfg, letter = nation_cfg(b)
        pid = "S2%s%03d" % (letter, int(round(b)) % 360)
        while any(o["pid"] == pid for o in out):
            pid = pid[:-3] + "%03d" % ((int(pid[-3:]) + 1) % 360)
        out.append({"pid": pid, "R": dict(nation_cfg=cfg, bearing=b, half=round(half, 1), r=(r0, r1)),
                    "area_m2": reg["area_m2"], "zone": reg["zone"]})
    return out, skipped


def keep_out_blocks(occ):
    """CORE's footprints as solid occupancy, so nothing (not even a stepping stone) lands inside them."""
    for (c, rad, k) in KEEP_OUT:
        occ.add("solid", c[0], c[1], rad, rad, 0.0, "keepout:" + k)


def sidecar(pid, R, groups, walk_uv):
    """The in-play proof's sidecar, exactly as sector_fill.main writes it."""
    H = S.H
    side = {"pass": pid, "bearing": R["bearing"], "walk": [[round(c, 1) for c in W.world(u, v)] for (u, v) in walk_uv],
            "groups": []}
    off = H + 600.0
    for (kind, u, v) in groups:
        if kind == "quarter":
            for (su, sv) in ((-1, -1), (-1, 1), (1, -1), (1, 1)):
                ru, rv = u + su * off, v + sv * off
                side["groups"].append({"kind": "quarter_room", "centre": [round(c, 1) for c in W.world(ru, rv)],
                                       "doors": [[round(c, 1) for c in W.world(ru + d * (H + 250.0), rv)] for d in (-1, 1)]})
            side["groups"].append({"kind": "quarter", "centre": [round(c, 1) for c in W.world(u, v)]})
        elif kind in ("room", "room_v"):
            doors = [(u + d * (H + 250.0), v) for d in (-1, 1)] if kind == "room" else [(u, v + d * (H + 250.0)) for d in (-1, 1)]
            side["groups"].append({"kind": "room", "centre": [round(c, 1) for c in W.world(u, v)],
                                   "doors": [[round(c, 1) for c in W.world(a, b)] for (a, b) in doors]})
        else:
            side["groups"].append({"kind": kind, "centre": [round(c, 1) for c in W.world(u, v)]})
    return side


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--plan", action="store_true")
    ap.add_argument("--only", default="")
    a = ap.parse_args()
    regs, skipped = regions()
    if a.plan:
        for g in regs:
            print("%-7s %-18s bearing %5.1f ±%4.1f  r %4.0f-%4.0f m  %6.0f m2" % (
                g["pid"], g["zone"], g["R"]["bearing"], g["R"]["half"], g["R"]["r"][0] / 100, g["R"]["r"][1] / 100, g["area_m2"]))
        for s in skipped:
            print("skipped", s)
        return
    want = set(x for x in a.only.split(",") if x)
    with gzip.open(W.CENSUS, "rt", encoding="utf-8") as f:
        text = f.read()
    # the keep-outs must be in every region's occupancy: wrap load_census once
    orig = W.load_census
    planned = []                 # footprints of every region planned so far in this run (largest first)

    def load_with_keepouts(occ):
        n = orig(occ)
        keep_out_blocks(occ)
        # OVERLAPPING WEDGES: 169/170/164, 253/254 and 356/6/7 share ground, and the census holds none of them.
        # Each region is planned against the ones before it, so no two fills claim the same ground.
        for (x, y, hw, hd, tag) in planned:
            occ.add("existing", x, y, hw, hd, 0.0, tag)
        return n
    W.load_census = load_with_keepouts
    for g in regs:
        pid, R = g["pid"], g["R"]
        if want and pid not in want:
            continue
        if ("," + pid + "_") in text:
            raise SystemExit("REFUSED: the census already contains %s" % pid)
        p, n_census, free0, free1, groups, walk_uv = S.fill(pid, R)
        spec = p.spec()
        spec["tags"] = spec["tags"] + ["WL_SECTOR_FILL2"]
        # NO PATHS TO NOWHERE (founder directive P2). A walk that joins no paving at either end and has no garden
        # quarter on it is a stepping-stone line from lawn to lawn: a cul-de-sac. Its stones are dropped; the
        # groves and drifts stay. A walk joined at ONE end is a spur to its wood/grove and stays.
        st = p.stats
        if walk_uv and st["joined"] == 0 and st["quarter"] == 0:
            spec["batches"] = [b for b in spec["batches"] if "Flagstone" not in b["mesh"]]
            walk_uv = []
            st["walk_dropped_as_cul_de_sac"] += 1
        (HERE / ("%s_fill2.json" % pid.lower())).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        (HERE / ("%s_walk.json" % pid.lower())).write_text(json.dumps(sidecar(pid, R, groups, walk_uv), indent=1),
                                                           encoding="utf-8")
        planned.extend((r[1], r[2], r[4], r[5], "%s:planned" % pid) for r in p.new_rows)
        total = sum(len(b["instances"]) for b in spec["batches"])
        st = p.stats
        print("%-7s free %.1f -> %.1f ha  batches %d  inst %d  quarter %d room %d grove %d drift %d wood %d walk_m %d "
              "joined %d not_joined %d blocked_offline %d" % (
                  pid, free0 / 1e4, free1 / 1e4, len(spec["batches"]), total, st["quarter"], st["room_single"],
                  st["grove"], st["meadow_drift"], st["wood"], st["walk_m"], st["joined"], st["not_joined"],
                  st["walk_blocked_offline"]))


def mg01_entry():
    """MG01'S ENTRY (CORE: "lay the entry ... AROUND the landmark ... between the landmark and the nearest giant").
    MG01 was relocated without a way in: its landmark stands on the city axis (116 degrees from the grove's centre;
    the city lies at 117), and the straight line in hits it (zzW104). The entry comes in at 131 degrees, between
    the landmark (116) and the giant at 147: stones from the rim (30 m) to 14 m from the centre, short of the
    central giant. From the rim a raster path runs over free ground to the nearest paving."""
    cx, cy = 45084.0, -87535.0
    b_world = math.degrees(math.atan2(cy, cx)) % 360.0
    S.set_frame(b_world, 8.0)
    occ = W.Occupancy()
    W.load_census(occ)
    g = S.Ground(occ, 80000.0, 106000.0)
    import random
    rng = random.Random("sector-fill2-mg01-entry")
    p = W.Pass("S2M297", ["WL_SECTOR_FILL2", "WL_NATION_TARTARUS", "WL_DISTRICT_MUSHROOM_GROVE"],
               "Wonderland/Authored/S2M297_MushroomGroveEntry", dict(W.NB.NATIONS["TQ03"]["materials"]), occ, "S2M297")
    to_uv = lambda x, y: (x * W.DIR[0] + y * W.DIR[1], x * W.LEFT[0] + y * W.LEFT[1])  # noqa: E731
    a = math.radians(131.0)
    inner = [(cx + math.cos(a) * d, cy + math.sin(a) * d) for d in (1400.0, 1850.0, 2300.0, 2750.0)]
    rim = (cx + math.cos(a) * 3200.0, cy + math.sin(a) * 3200.0)
    # the grove's own mushrooms: a flag lies flat under a cap, so the canopy footprints (which refused 4 of 5
    # stones in the first run) are not obstacles -- only the stems are, kept 3 m clear
    mg = json.load(open(HERE.parent / "Districts" / "mg01_mushroom_grove.json", encoding="utf-8"))
    stems = [(t[0], t[1]) for b in mg["batches"] if "ushroom" in b["mesh"] for t in b["instances"]]
    k = 0
    for (x, y) in inner + [rim]:
        if any(math.hypot(x - sx, y - sy) < 300.0 for (sx, sy) in stems):
            p.stats["entry_stone_at_stem"] += 1
            continue
        u, v = to_uv(x, y)
        if p.add_module(S.FLAGS[k % 3], u, v, W.GROUND_Z + 1.0, rng.uniform(-8.0, 8.0), scale=0.55, cull=W.CULL_NEAR,
                        collide=False, margin=10.0, layer="paved", check=False):
            k += 1
    ru, rv = to_uv(*rim)
    c = g.nearest_free(ru, rv, 8)
    joined = False
    walk = [to_uv(x, y) for (x, y) in reversed(inner + [rim])]
    if c is not None:
        cells = g.path_to_paving(g.u(c[0]), g.v(c[1]))
        if cells:
            S.stepping(p, cells, g, rng)
            lu, lv = g.u(cells[-1][0]), g.v(cells[-1][1])
            S.finish_to_edge(p, occ, *W.world(lu, lv), rng)
            walk = [(g.u(i), g.v(j)) for (i, j) in reversed(cells)] + walk
            joined = True
    spec = p.spec()
    (HERE / "s2m297_fill2.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")
    side = {"pass": "S2M297", "bearing": b_world, "walk": [[round(c_, 1) for c_ in W.world(u, v)] for (u, v) in walk],
            "groups": []}
    (HERE / "s2m297_walk.json").write_text(json.dumps(side, indent=1), encoding="utf-8")
    print("S2M297  MG01 entry  inner stones %d  joined %s  batches %d  inst %d  path stones %d" % (
        k, joined, len(spec["batches"]), sum(len(b["instances"]) for b in spec["batches"]), p.stats["stepping_stones"]))


if __name__ == "__main__":
    main()
    if not sys.argv[1:] or "--only" not in " ".join(sys.argv[1:]):
        if "--plan" not in sys.argv:
            mg01_entry()
