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
import csv
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
#: BEARING BANDS OTHER LANES OWN: (b0, b1, r_max_cm, owner). 2026-09-29: CORE's TW03 Icarus tower approaches take
#: 100-135 degrees inside 1,200 m. A region centred in a band is skipped; one that only overlaps it is clipped so its
#: wedge stops at the band's edge (S3I098 "clip its wedge to <= 100 degrees", CORE).
KEEP_OUT_BANDS = [(100.0, 135.0, 120000.0, "TW03")]
#: THE SIGHTLINES (CORE's INTENTIONAL VISTA class, Tools/world_audit/emptiness_classes.py): +/-25 m of the Golden
#: Arrival axis and the avenues (90 / 210 / 330 deg, 0-1,200 m) and the checkpoints' ceremonial ground. Reserved
#: wider here -- +/-30 m, on to 1,300 m (CP05 stands at 1,231-1,278 m on the 90 deg axis), both CORE's bearings and
#: the avenues' fitted ones, and each checkpoint's own paving + 30 m -- because S2I088 (window 3) planted slender
#: trees 1.5-3.2 m off the 90 deg axis 30-60 m in front of CP05: the planner kept CORE's footprints but not the views.
VISTA_BEARINGS = (90.0, 210.0, 330.0, 209.8, 329.7)
VISTA_HALF = 3000.0             # cm either side of the axis
VISTA_R = 130000.0
CEREMONY_MARGIN = 3000.0        # cm beyond a checkpoint's paving
CEREMONY_MIN = 5000.0


def nation_cfg(b):
    b %= 360.0
    if 30.0 <= b < 150.0:
        return "IC03", "I"
    if 150.0 <= b < 270.0:
        return "NC03", "N"
    return "TQ03", "T"


def _in_wedge(c, rad, b, half, r0, r1):
    """Does the keep-out disc (centre c, radius rad, cm) reach into the wedge b +/- half deg, r0-r1 cm?"""
    rc = math.hypot(c[0], c[1])
    if rc + rad < r0 or rc - rad > r1:
        return False
    bc = math.degrees(math.atan2(c[1], c[0])) % 360.0
    return abs((bc - b + 180.0) % 360.0 - 180.0) <= half + math.degrees(rad / max(1.0, rc))


def regions(audit_path=None, min_area=None, prefix="S2"):
    audit = json.load(open(audit_path or AUDIT, encoding="utf-8"))
    min_area = MIN_AREA if min_area is None else min_area
    out, skipped = [], []
    for reg in audit["regions_top"]:
        r0, r1 = reg["radius_span_m"]
        b = float(reg["bearing_deg"])
        if reg["area_m2"] < min_area:
            continue
        if r0 * 100.0 >= R_MAX:
            skipped.append((reg["bearing_deg"], r0, r1, "wild ring band"))
            continue
        r1 = min(r1 * 100.0, R_MAX)
        r0 = r0 * 100.0
        width = reg["area_m2"] / max(1.0, (r1 - r0) / 100.0)             # m
        half = max(3.0, min(14.0, math.degrees(0.6 * width / max(1.0, reg["centre_radius_m"]))))
        # A keep-out INSIDE the region's wedge is CORE's ground: the region is skipped. One that is only nearby stays
        # reserved in the occupancy (keep_out_blocks) and the region is planned round it. The first rule ("within the
        # region's half-width of its centre") skipped the largest pocket left after window 4b -- 294 deg, 1,100-1,200 m
        # -- for MG01 at 985 m, whose reserve ends at 1,047 m.
        near = [k for (c, rad, k) in KEEP_OUT if _in_wedge(c, rad, b, half, r0, r1)]
        if near:
            skipped.append((reg["bearing_deg"], r0 / 100, r1 / 100, "near " + ",".join(near)))
            continue
        clipped = None
        for (b0, b1, rmax, owner) in KEEP_OUT_BANDS:
            if r0 >= rmax:
                continue
            lo, hi = b - half, b + half
            if b0 <= b <= b1:
                clipped = "inside " + owner
                break
            if hi > b0 and lo < b0:          # overlaps the band's low edge: keep the part below it
                lo2 = lo
                b, half = (lo2 + b0) * 0.5, (b0 - lo2) * 0.5
            elif lo < b1 and hi > b1:        # overlaps the band's high edge: keep the part above it
                b, half = (b1 + hi) * 0.5, (hi - b1) * 0.5
        if clipped:
            skipped.append((reg["bearing_deg"], r0 / 100, r1 / 100, clipped))
            continue
        if half < 1.5:
            skipped.append((reg["bearing_deg"], r0 / 100, r1 / 100, "clipped to nothing"))
            continue
        cfg, letter = nation_cfg(b)
        pid = "%s%s%03d" % (prefix, letter, int(round(reg["bearing_deg"])) % 360)
        while any(o["pid"] == pid for o in out):
            pid = pid[:-3] + "%03d" % ((int(pid[-3:]) + 1) % 360)
        out.append({"pid": pid, "R": dict(nation_cfg=cfg, bearing=b, half=round(half, 1), r=(r0, r1)),
                    "area_m2": reg["area_m2"], "zone": reg["zone"]})
    return out, skipped


def keep_out_blocks(occ):
    """CORE's footprints as solid occupancy, so nothing (not even a stepping stone) lands inside them."""
    for (c, rad, k) in KEEP_OUT:
        occ.add("solid", c[0], c[1], rad, rad, 0.0, "keepout:" + k)


def checkpoints(census_path):
    """(cx, cy, reach, id) of every checkpoint the census holds (CP01-CP05): centroid and farthest paving row."""
    pts = {}
    with gzip.open(census_path, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            pre = r["owner"].split("_")[0]
            if len(pre) == 4 and pre.startswith("CP") and pre[2:].isdigit():
                pts.setdefault(pre, []).append((float(r["x"]), float(r["y"])))
    out = []
    for k, v in sorted(pts.items()):
        cx = sum(p[0] for p in v) / len(v)
        cy = sum(p[1] for p in v) / len(v)
        out.append((cx, cy, max(math.hypot(x - cx, y - cy) for (x, y) in v), k))
    return out


def vista_blocks(occ, cps):
    """The sightlines and the checkpoints' ceremonial ground as solid occupancy: no plant, room or stone lands in a
    view. Axis corridors are 100 m oriented rectangles laid end to end along each bearing."""
    for b in VISTA_BEARINGS:
        t = math.radians(b)
        for d in range(0, int(VISTA_R), 10000):
            c = d + 5000.0
            occ.add("solid", c * math.cos(t), c * math.sin(t), 5000.0, VISTA_HALF, b, "vista:%g" % b)
    for (cx, cy, reach, k) in cps:
        half = max(CEREMONY_MIN, reach + CEREMONY_MARGIN)
        occ.add("solid", cx, cy, half, half, 0.0, "ceremony:" + k)


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
    ap.add_argument("--audit", default=None, help="emptiness json to fit wedges to (default: the post-window-1 audit)")
    ap.add_argument("--min-ha", type=float, default=None)
    ap.add_argument("--prefix", default="S2", help="pass-id prefix; S3 for the next round")
    ap.add_argument("--census", default=None, help="plan against this census (e.g. a projected one) instead of the live export")
    a = ap.parse_args()
    if a.census:
        W.CENSUS = a.census
    regs, skipped = regions(a.audit, None if a.min_ha is None else a.min_ha * 1e4, a.prefix)
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
        vista_blocks(occ, cps)
        return n
    cps = checkpoints(W.CENSUS)
    print("sightlines reserved: +/-%.0f m of %s deg to %.0f m; ceremonial ground round %s" % (
        VISTA_HALF / 100, "/".join("%g" % b for b in VISTA_BEARINGS), VISTA_R / 100,
        ", ".join("%s (%.0f m)" % (k, max(CEREMONY_MIN, r + CEREMONY_MARGIN) / 100) for (_, _, r, k) in cps)))
    W.load_census = load_with_keepouts
    rows_out = []
    for g in regs:
        pid, R = g["pid"], g["R"]
        if want and pid not in want:
            continue
        if ("," + pid + "_") in text:
            raise SystemExit("REFUSED: the census already contains %s" % pid)
        p, n_census, free0, free1, groups, walk_uv = S.fill(pid, R)
        spec = p.spec()
        spec["tags"] = spec["tags"] + ["WL_SECTOR_FILL" + a.prefix[1:]]
        # NO PATHS TO NOWHERE (founder directive P2). A walk that joins no paving at either end and has no garden
        # quarter on it is a stepping-stone line from lawn to lawn: a cul-de-sac. Its stones are dropped; the
        # groves and drifts stay. A walk joined at ONE end is a spur to its wood/grove and stays.
        st = p.stats
        if walk_uv and st["joined"] == 0 and st["quarter"] == 0:
            spec["batches"] = [b for b in spec["batches"] if "Flagstone" not in b["mesh"]]
            walk_uv = []
            st["walk_dropped_as_cul_de_sac"] += 1
        (HERE / ("%s_fill%s.json" % (pid.lower(), a.prefix[1:]))).write_text(json.dumps(spec, indent=1), encoding="utf-8")
        (HERE / ("%s_walk.json" % pid.lower())).write_text(json.dumps(sidecar(pid, R, groups, walk_uv), indent=1),
                                                           encoding="utf-8")
        planned.extend((r[1], r[2], r[4], r[5], "%s:planned" % pid) for r in p.new_rows)
        rows_out.extend((r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], pid) for r in p.new_rows)
        total = sum(len(b["instances"]) for b in spec["batches"])
        st = p.stats
        print("%-7s free %.1f -> %.1f ha  batches %d  inst %d  quarter %d room %d grove %d drift %d wood %d walk_m %d "
              "joined %d not_joined %d blocked_offline %d" % (
                  pid, free0 / 1e4, free1 / 1e4, len(spec["batches"]), total, st["quarter"], st["room_single"],
                  st["grove"], st["meadow_drift"], st["wood"], st["walk_m"], st["joined"], st["not_joined"],
                  st["walk_blocked_offline"]))
    write_rows(rows_out, a.prefix)


def write_rows(rows_out, prefix):
    """Census-format rows of what was planned, so emptiness.py can project the fill before it exists."""
    with gzip.open(HERE / ("sector_fill%s_new_placements.csv.gz" % prefix[1:]), "wt", encoding="utf-8", newline="") as f:
        f.write("kind,x,y,z,ex,ey,ez,yaw,mesh,owner\n")
        for (k, x, y, z, ex, ey, ez, mesh, owner) in rows_out:
            f.write("%s,%.0f,%.0f,%.0f,%.0f,%.0f,%.0f,0,%s,%s\n" % (k, x, y, z, ex, ey, ez, mesh, owner))


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
    # MG01's entry (S2M297) is APPLIED (CORE's window 2A, fa018857) and was planned on the pre-2A census. Re-planning
    # it now would read its own stones back and write a different spec over the applied one. Only on request.
    if "--mg01-entry" in sys.argv:
        mg01_entry()
    else:
        main()
