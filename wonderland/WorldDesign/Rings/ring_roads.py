#!/usr/bin/env python3
"""RR01 / RR02 -- THE RING ROADS: the march ring and the outer ring, paved along the routes the probe found.

    python WorldDesign/Rings/ring_probe.py      (first: finds the routes against the census)
    python WorldDesign/Rings/ring_roads.py      (then: writes rr01_march_ring.json, rr02_outer_ring.json)

WHY (2026-09-28, world completion, CORE C2). Three avenues run from the core to the three nations and nothing
runs between them: the only way from ICARUS to NOCTIS was back through the city. The rings join the avenues,
the seam ways the WORLD session is building (W270 at the rear, 30 and 150 to come) and the nations to each
other, and they are what the unbuilt ground between the nations will hang on.

WHAT A RING ROAD IS HERE -- the nations' own floor, not a new vocabulary, so junctions meet flush:
  PLATES        SM_terrace_platform unscaled (14.4 m across, 7.4 m along), the nation floor every band and the
                seam ways stand on, top at +12 (26 cm over the -14 ground: under the Dog's 30 cm step). One
                column wide, turned to the road's heading every 7.4 m; half-width (7.2 m) where the probe found
                only a lane passes between towers. They COLLIDE: this is floor, the same as the nations'.
  KERBS         SM_kerb_stone stretched along both edges, standing on the ground so its top is flush with the
                road (-14 + 28 = +14). The forge's rule: the kerb is what makes paving read as a made road.
  LANTERNS      WL_Object_LanternStandard every 24 m, alternating sides, in the nation's own materials -- also
                fixtures for the practical-light pass, so the ring is lit at night.
  THE NATION'S STONE. The ring passes through all three nations; each stretch is paved in the palette of the
                nation it crosses (nations.nation_at), so crossing a seam reads as crossing a border.

WHAT IT REFUSES, piece by piece, with the WORLD session's Occupancy (oriented rectangles, SAT):
  - anything that would touch a standing object in the census (a hall, a tower, a hedge, a trunk);
  - a plate over existing paving -- at an avenue or a plaza the existing floor IS the junction, and two
    coplanar plates would z-fight.
Where the probe reported a stretch blocked outright, the refusals leave the road broken there, and the report
names the stretch: those are decisions (a gate, a detour), never a road through a building.
"""
import json
import math
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
sys.path.insert(0, str(WD))
sys.path.insert(0, str(WD / "Nations"))
sys.path.insert(0, str(WD / "Wedges"))
sys.path.insert(0, str(HERE))
import nations                                                          # noqa: E402
from ring_probe import load as load_census                               # noqa: E402
from w270_rear_seam import Occupancy                                     # noqa: E402

KIT = json.loads((WD / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
PLATE_MESH = "/Game/WonderlandV2/Architecture/Stairs/SM_terrace_platform.SM_terrace_platform"
KERB_MESH = "/Game/WonderlandV2/Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone"
PLATE_X, PLATE_Y, PLATE_TOP_LOCAL = 1440.0, 740.0, 140.0
PAVING_TOP = 12.0
GROUND_Z = -14.0
KERB_LEN, KERB_W = 120.0, 36.2          # SM_kerb_stone at scale 1 (mesh_bounds: ext 60 x 18.1 x 14.1, base pivot)
LAMP_EVERY = 2400.0
PLATE_STEP = 550.0              # rows every 5.5 m: a 7.4 m plate overlaps the next by 1.9 m and covers the outer wedge on a bend
SMOOTH = 9                      # route points averaged (0.25 deg each): ~2 deg takes the Viterbi kinks out
TREE_EVERY = 2400.0              # avenue trees, both sides, staggered half a step from the lanterns
TRUNK_MESH = "/Game/WonderlandV2/Vegetation/Trees/SM_tree_slender_trunk.SM_tree_slender_trunk"
CANOPY_MESH = "/Game/WonderlandV2/Vegetation/Trees/SM_canopy_medium.SM_canopy_medium"
LAMP_OFF = 900.0
TILE = 20000.0
CULL_MID, CULL_FAR = 26000.0, 60000.0
PASSES = {"MARCH": ("RR01", "rr01_march_ring.json", "Wonderland/Authored/RR01_MarchRing"),
          "OUTER": ("RR02", "rr02_outer_ring.json", "Wonderland/Authored/RR02_OuterRing")}


def palette(nation_id):
    mod = {"ICARUS": "icarus_district", "NOCTIS": "noctis_quarter", "TARTARUS": "tartarus_quarter"}[nation_id]
    m = __import__(mod)
    mats = dict(m.PART_MATERIAL)
    return mats, getattr(m, "LUMINOUS", None)


def resample(points, step):
    """The probe's 0.25 deg route, smoothed and walked at a fixed arc length: (x, y, heading, status)."""
    pts = [(p[2], p[3], p[4]) for p in points]
    # a moving average takes the 2 m radius quantisation and the Viterbi's kinks out of the curve. The first
    # build averaged 5 points (1.25 deg) and its S-bends read as stepped plates with lawn wedges between them.
    sm = []
    n = len(pts) - 1                                    # the last point repeats the first (the loop closes)
    h = SMOOTH // 2
    for i in range(n):
        xs = [pts[(i + k) % n][0] for k in range(-h, h + 1)]
        ys = [pts[(i + k) % n][1] for k in range(-h, h + 1)]
        sm.append((sum(xs) / len(xs), sum(ys) / len(ys), max(pts[(i + k) % n][2] for k in range(-h, h + 1))))
    out, carry = [], 0.0
    for i in range(n):
        a, b = sm[i], sm[(i + 1) % n]
        seg = math.hypot(b[0] - a[0], b[1] - a[1])
        if seg <= 0.0:
            continue
        head = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
        t = carry
        while t < seg:
            f = t / seg
            out.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, head, max(a[2], b[2])))
            t += step
        carry = t - seg
    return out


class Spec:
    def __init__(self, pass_id, folder):
        self.id, self.folder = pass_id, folder
        self.batches, self.stats = {}, Counter()
        self.refused = []
        self.tree_why = Counter()

    def add(self, key, mesh, material, x, y, z, yaw, sx=1.0, sy=1.0, sz=1.0, collides=False, cull=CULL_MID):
        tkey = "%s_t%d_%d" % (key, math.floor(x / TILE), math.floor(y / TILE))
        bt = self.batches.setdefault((tkey, material), {
            "id": "%s_%s_%s" % (self.id, tkey, material.replace("MI_V2_", "")), "mesh": mesh,
            "material": material, "instances": [], "collides": collides, "cast_shadow": True,
            "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 2), 0.0,
                                round(sx, 4), round(sy, 4), round(sz, 4)])

    def module(self, name, x, y, z, yaw, mats, luminous=None, glow=(), cull=CULL_MID):
        for part in KIT[name]["parts"]:
            if part["part"] == "veg_anchor":
                continue
            material = luminous if (luminous and part["part"] in glow) else mats.get(part["part"], part["material"])
            self.add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], material, x, y, z, yaw,
                     collides=part["part"] not in nations.NO_COLLIDE_PARTS, cull=cull)

    def out(self, tags):
        return {"pass": self.id, "folder": self.folder, "tags": tags, "actors": [],
                "batches": list(self.batches.values())}


def build(name, ring, occ):
    pass_id, fname, folder = PASSES[name]
    spec = Spec(pass_id, folder)
    samples = resample(ring["points"], PLATE_STEP)
    lamp_at, lamp_side, along = 0.0, 1.0, 0.0
    tree_at = -TREE_EVERY * 0.5
    rng = random.Random(pass_id)
    placed_runs, current = [], 0
    for k, (x, y, head, status) in enumerate(samples):
        if k:
            along += math.hypot(x - samples[k - 1][0], y - samples[k - 1][1])
        nation = nations.nation_at(x, y) or "ICARUS"
        mats, luminous = palette(nation)
        # The plate's own clearance test decides the width, not the probe's mark: smoothing smears a "narrow" point
        # over its neighbours, and trusting it narrowed 308 rows of the outer ring that fit at full width.
        narrow = False
        half_x = PLATE_X * 0.5
        yaw = head + 90.0                                  # the plate's X runs ACROSS the road
        h = math.radians(head)
        lx, ly = -math.sin(h), math.cos(h)
        # --- the plate: refused inside anything standing, skipped over existing floor (the junction). Before
        #     refusing, the road does what a road does at a pinch: it narrows, and it shifts up to 4 m sideways.
        #     The first build refused 111 plates outright, most of them grazing a trunk or a hedge's corner.
        if occ.hits(x, y, half_x, PLATE_Y * 0.5, yaw, 0.0, ("existing",)):
            fit = None
            for try_narrow in ((False, True) if not narrow else (True,)):
                hx = PLATE_X * (0.25 if try_narrow else 0.5)
                for shift in (0.0, 200.0, -200.0, 400.0, -400.0):
                    sx_, sy_ = x + lx * shift, y + ly * shift
                    if not occ.hits(sx_, sy_, hx, PLATE_Y * 0.5, yaw, 0.0, ("existing",)):
                        fit = (sx_, sy_, try_narrow, hx)
                        break
                if fit:
                    break
            if fit is None:
                spec.stats["plate_refused_in_standing"] += 1
                spec.refused.append((round(math.degrees(math.atan2(y, x)) % 360.0, 2),
                                     round(math.hypot(x, y) / 100.0),
                                     (occ.hits(x, y, half_x, PLATE_Y * 0.5, yaw, 0.0, ("existing",)) or "?")[:70],
                                     round(x, 1), round(y, 1), round(yaw, 2), half_x))
                current = 0
                continue
            x, y, narrow, half_x = fit
            spec.stats["plate_fitted_by_narrowing_or_shift"] += 1
        if occ.hits(x, y, half_x - 150.0, PLATE_Y * 0.5 - 150.0, yaw, 0.0, ("paved",)):
            spec.stats["plate_skipped_existing_floor"] += 1
            current = 0
            continue
        # Alternate rows stand 6 mm apart in height: on a bend the inside corners of neighbouring rows overlap,
        # and two top faces at exactly +12 would z-fight there. 6 mm is invisible and far under the Dog's step.
        lift = 0.6 if (spec.stats["plate"] + spec.stats["plate_narrow"]) % 2 else 0.0
        spec.add("Plate", PLATE_MESH, mats.get("paving", "MI_V2_GroundFlag_PlazaCream"), x, y,
                 PAVING_TOP - PLATE_TOP_LOCAL + lift, yaw, sx=(0.5 if narrow else 1.0), collides=True, cull=CULL_FAR)
        spec.stats["plate_narrow" if narrow else "plate"] += 1
        current += 1
        if current == 1:
            placed_runs.append(0)
        placed_runs[-1] += 1
        # --- kerbs on the ground at both edges, stretched along the row
        for side in (-1.0, 1.0):
            kx, ky = x + lx * side * (half_x + KERB_W * 0.5), y + ly * side * (half_x + KERB_W * 0.5)
            if occ.hits(kx, ky, PLATE_STEP * 0.5, KERB_W * 0.5, head, 0.0, ("existing",)):
                spec.stats["kerb_refused"] += 1
                continue
            spec.add("Kerb", KERB_MESH, mats.get("kerb", "MI_V2_Kerb"), kx, ky, GROUND_Z, head,
                     sx=(PLATE_STEP + 60.0) / KERB_LEN, collides=False)
            spec.stats["kerb"] += 1
        # --- a lantern every 24 m, alternating sides, not on the narrow stretches
        lamp_here = False
        if along - lamp_at >= LAMP_EVERY and not narrow:
            lamp_here = True
            lamp_at = along
            lamp_side = -lamp_side
            off = half_x + LAMP_OFF - PLATE_X * 0.5 + 150.0
            px, py = x + lx * lamp_side * off, y + ly * lamp_side * off
            if occ.hits(px, py, 350.0, 120.0, head, 100.0, ("existing",)):
                spec.stats["lantern_refused"] += 1
            else:
                spec.module("WL_Object_LanternStandard", px, py, GROUND_Z, head + 90.0 * lamp_side, mats,
                            luminous=luminous, glow=("glass",))
                spec.stats["lantern"] += 1
                occ.add("existing", px, py, 350.0, 120.0, head, "%s:lantern" % pass_id)
        # Trees draw to CULL_FAR (600 m): at 260 m more than half of what the 512 m streaming radius loads was never
        # drawn (SECOND's cull A/B zzW432/433, CORE decision 2026-09-29).
        # --- AVENUE TREES, the IC02 recipe (slender trunk, medium canopy 7.6 m up), both sides, on the ground
        #     just outside the kerbs. A ring through open lawn reads as a boulevard only with trees; a tree is
        #     refused where its trunk or its canopy would stand in anything already there.
        # never on the lantern's own plate: both keep a 24 m step on 7.4 m plates, and after any break in the road
        # they fell into step -- the first build refused 292 trees against the ring's own lanterns
        if along - tree_at >= TREE_EVERY and not narrow and not lamp_here:
            tree_at = along
            for side in (-1.0, 1.0):
                off = half_x + KERB_W + 330.0
                tx, ty = x + lx * side * off, y + ly * side * off
                why = occ.hits(tx, ty, 150.0, 150.0, head, 50.0, ("existing",)) or                     occ.hits(tx, ty, 420.0, 420.0, head, 0.0, ("solid",))
                if why:
                    spec.stats["tree_refused"] += 1
                    spec.tree_why[why.split(":")[0] + ":" + why.split(":")[-1][:28]] += 1
                    continue
                spec.add("AvenueTree", TRUNK_MESH, "MI_V2_Bark", tx, ty, GROUND_Z, rng.uniform(0.0, 360.0),
                         *([rng.uniform(0.9, 1.1)] * 3), collides=True, cull=CULL_FAR)
                spec.add("AvenueCanopy", CANOPY_MESH, "MI_V2_LeafMid", tx, ty, GROUND_Z + 760.0,
                         rng.uniform(0.0, 360.0), *([rng.uniform(0.9, 1.15)] * 3), collides=False, cull=CULL_FAR)
                occ.add("existing", tx, ty, 150.0, 150.0, head, "%s:tree" % pass_id)
                occ.add("solid", tx, ty, 420.0, 420.0, head, "%s:canopy" % pass_id)
                spec.stats["tree"] += 1
    tags = ["WL_AUTHORED", "WL_PASS_%s" % pass_id, "WL_RING_ROAD"]
    out = spec.out(tags)
    out["route_source"] = "ring_routes.json %s: %d m, clear %.1f%%, narrow %.1f%%" % (
        name, ring["length_m"], 100.0 * ring["clear_fraction"], 100.0 * ring.get("narrow_fraction", 0.0))
    (HERE / fname).write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in out["batches"])
    spans = [max(max(r[0] for r in b["instances"]) - min(r[0] for r in b["instances"]),
                 max(r[1] for r in b["instances"]) - min(r[1] for r in b["instances"])) for b in out["batches"]]
    print("%s %s: %d instances in %d batches (widest %.0f m) -> %s" % (
        pass_id, name, total, len(out["batches"]), max(spans) / 100.0, fname))
    print("    %s" % ", ".join("%s %d" % kv for kv in sorted(spec.stats.items())))
    print("    trees refused by: %s" % ", ".join("%s %d" % kv for kv in spec.tree_why.most_common(6)))
    print("    paved runs: %d, longest %d plates (%.0f m); plates laid %.0f m of %.0f m" % (
        len(placed_runs), max(placed_runs) if placed_runs else 0,
        (max(placed_runs) if placed_runs else 0) * PLATE_Y / 100.0,
        (spec.stats["plate"] + spec.stats["plate_narrow"]) * PLATE_Y / 100.0, along / 100.0))
    # the refusals, grouped into the stretches where the road is actually broken
    groups = []
    (HERE / ("%s_refused.json" % pass_id.lower())).write_text(json.dumps(
        [{"bearing": b, "r_m": r, "blocker": why, "x": x, "y": y, "yaw": yw, "half_x": hx}
         for b, r, why, x, y, yw, hx in sorted(spec.refused)], indent=1), encoding="utf-8")
    for b, r, why, _x, _y, _yw, _hx in sorted(spec.refused):
        if groups and b - groups[-1]["to"] <= 1.0:
            groups[-1]["to"] = b
            groups[-1]["n"] += 1
            groups[-1]["by"][why.split(":", 1)[-1][:40]] += 1
        else:
            groups.append({"from": b, "to": b, "r": r, "n": 1, "by": Counter({why.split(":", 1)[-1][:40]: 1})})
    for g in groups:
        print("    BROKEN %6.2f-%6.2f deg at ~%d m: %d plate(s) -- %s" % (
            g["from"], g["to"], g["r"], g["n"], ", ".join("%s x%d" % kv for kv in g["by"].most_common(2))))
    return out


def main():
    rings = json.loads((HERE / "ring_routes.json").read_text(encoding="utf-8"))
    occ = Occupancy()
    print("census: %s" % dict(load_census(occ)))
    for name in ("MARCH", "OUTER"):
        build(name, rings[name], occ)


if __name__ == "__main__":
    main()
