#!/usr/bin/env python3
"""SKY02 -- needles in the skyline the visitor actually sees.

WHAT WAS THERE. Above the arrival garden the skyline is the castle city: drums under wide onion
roofs. The Marble reference's skyline is NEEDLES -- slender shafts under very tall thin roofs, packed
at several heights (forge references/GAPS.md, GAP 1, the largest single difference between the two).

WHAT THE FIRST ATTEMPT TAUGHT (2026-09-13, SKY02a, previewed and never saved). Stands of seven kit
towers on the forge recipe, placed on the clearest ground 470-560 m out, were invisible from every
camera: the castle city 110-300 m away rises 20-28 degrees above the arrival eye, so a tower there
needed 200-280 m to show -- more than the 194 m Great Spire. Clear ground is far; the visible
skyline is near.

WHAT THIS LAYER DOES. It places single kit towers (legal foot -> body* -> terminator spellings,
every storey at the measured top socket of the one below, kitstack.py) INSIDE the band the eye sees,
wherever all of these hold, measured from census_north_2026-09-13.json:
  VISIBLE   the tower rises at least SHOW_UU above everything in front of it, from the hero camera
            AND from the arrival spawn eye (occluder tops from bounds, which over-state a silhouette,
            so a tower that passes is if anything more visible than computed);
  CLEAR     its foot stands clear of every existing piece taller than 4 m and of every paving piece
            (paths, kerbs, terrace streets, stairs, bridges) by a margin -- no tower on a route;
  SPACED    feet of neighbouring new towers do not touch; no more than PER_BEARING towers within
            a BEARING_WINDOW of each other from the hero, so they spread across the view;
  AXIS      nothing within the Great Spire's bearing or the castle approach's axis.
Heights vary by storey count, never by stretching. Foot parts collide (the towers stand in reachable
districts); upper storeys do not.
"""
import json
import math
import random
from collections import defaultdict
from pathlib import Path

import kitstack as kit

HERE = Path(__file__).resolve().parent
PASS = "SKY02"
CENSUS = json.loads((HERE / "census_north_2026-09-13.json").read_text(encoding="utf-8"))
GROUND_Z = -14.0                    # V2_GroundSlab top at every traced site (2026-09-13)

EYES = {"hero": (0.0, -150.0, 262.0),          # HeroCam_V2_MarbleReference
        "arrival": (0.0, -1460.0, 180.0)}      # V2_ArrivalSpawn, eye height
SHOW_UU = 1400.0                    # a tower must clear what is in front of it by 14 m (a storey and a roof)
TALL_MARGIN_UU = 150.0              # foot to the nearest existing piece
PAVING_MARGIN_UU = 450.0            # foot to the nearest paving piece's bounds
FOOT_GAP_UU = 250.0                 # between feet of new towers
BAND_UU = (11000.0, 36000.0)        # distance from the hero
AXIS_HALF_UU = 2500.0               # the castle approach
SPIRE_BEARING_TAN = 0.16            # ~9 degrees around the Great Spire (0, 33000)
PER_BEARING, BEARING_WINDOW = 3, 4.0
MAX_TOWERS = 28
SCALES = (0.9, 1.0, 1.1, 1.2, 1.3)
BROAD_TERMINATORS = ("WL_Tower_Crown_Cap", "WL_Tower_Crown_Pavilion")


class _Grid:
    def __init__(self, rows, cell=2000.0):
        self.cell = cell
        self.cells = defaultdict(list)
        for r in rows:
            self.cells[(int(r[0] // cell), int(r[1] // cell))].append(r)

    def clearance(self, x, y, reach=6000.0):
        best = reach
        n = int(reach // self.cell) + 1
        gx, gy = int(x // self.cell), int(y // self.cell)
        for i in range(gx - n, gx + n + 1):
            for j in range(gy - n, gy + n + 1):
                for r in self.cells.get((i, j), ()):
                    best = min(best, math.hypot(r[0] - x, r[1] - y) - r[2])
        return best


def _occluders():
    """Per eye, per whole degree of bearing: (distance, elevation deg) of every piece's top."""
    table = {}
    for name, (ex, ey, ez) in EYES.items():
        by_deg = defaultdict(list)
        for label, mesh, x, y, r, zmin, zmax in CENSUS["tall"]:
            dist = math.hypot(x - ex, y - ey)
            if dist < 500.0:
                continue
            az = math.degrees(math.atan2(y - ey, x - ex))
            half = math.degrees(math.asin(min(1.0, r / dist)))
            elev = math.degrees(math.atan2(zmax - ez, dist))
            for a in range(int(math.floor(az - half)), int(math.ceil(az + half)) + 1):
                by_deg[a % 360].append((dist, elev))
        table[name] = by_deg
    return table


def _need(occ, name, x, y):
    ex, ey, ez = EYES[name]
    dist = math.hypot(x - ex, y - ey)
    az = int(round(math.degrees(math.atan2(y - ey, x - ex)))) % 360
    elev = max([e for d, e in occ[name][az] if d < dist - 800.0] + [-89.0])
    return ez + math.tan(math.radians(elev)) * dist


def build():
    rng = random.Random(20260913 + 102)
    tall = _Grid([(r[2], r[3], r[4]) for r in CENSUS["tall"]])
    paving = _Grid([(r[1], r[2], r[3]) for r in CENSUS["paving"]])
    occ = _occluders()
    spellings = [(s, h) for s, h in kit.spellings(3) if s[-1] not in BROAD_TERMINATORS]
    hx, hy, _ = EYES["hero"]

    candidates = []
    for y in range(9000, 36001, 250):
        for x in range(-20000, 20001, 250):
            dist = math.hypot(x - hx, y - hy)
            if not BAND_UU[0] <= dist <= BAND_UU[1] or abs(x) < AXIS_HALF_UU or abs(x) < SPIRE_BEARING_TAN * y:
                continue
            room = min(tall.clearance(x, y) - TALL_MARGIN_UU, paving.clearance(x, y) - PAVING_MARGIN_UU)
            if room < 800.0:
                continue
            need = max(_need(occ, n, x, y) for n in EYES) - GROUND_Z
            candidates.append((need, room, x, y))
    candidates.sort()

    placed, towers, batches = [], [], kit.Batches(PASS)
    used_recent = []
    for need, room, x, y in candidates:
        if len(towers) >= MAX_TOWERS:
            break
        bearing = math.degrees(math.atan2(y - hy, x - hx))
        if sum(1 for t in towers if abs(t["bearing"] - bearing) < BEARING_WINDOW / 2.0) >= PER_BEARING:
            continue
        options = []
        for stack, height in spellings:
            foot = kit.footprint(stack)
            for s in SCALES:
                if foot * s > room or height * s < need + SHOW_UU:
                    continue
                if any(math.hypot(x - px, y - py) < foot * s + pf + FOOT_GAP_UU for px, py, pf in placed):
                    continue
                # Prefer needles, then terminators not used lately, then the shortest tower that shows.
                role_rank = 0 if kit.MODULES[stack[-1]]["role"] == "needle" else 1
                options.append((role_rank + 0.6 * used_recent.count(stack[-1]), height * s - need, s, stack, height))
        if not options:
            continue
        options.sort(key=lambda o: (o[0], o[1]))
        _, margin, s, stack, height = options[rng.randrange(min(3, len(options)))]
        yaw = math.degrees(math.atan2(hy - y, hx - x)) + rng.choice((0.0, 90.0, 180.0, 270.0))
        top = batches.add_stack(stack, x, y, GROUND_Z - 30.0 * s, yaw, s)
        placed.append((x, y, kit.footprint(stack) * s))
        used_recent = (used_recent + [stack[-1]])[-6:]
        towers.append({"at": [x, y], "bearing": round(bearing, 1), "distance_m": round(math.hypot(x - hx, y - hy) / 100.0),
                       "stack": stack, "scale": s, "height_uu": round(height * s), "need_uu": round(need),
                       "shows_uu": round(height * s - need), "room_uu": round(room), "top_z": round(top)})

    # Foot parts collide: these towers stand in reachable districts.
    feet = {part["mesh"] for m in kit.MODULES.values() if m["role"] == "foot" for part in m["parts"]}
    batch_list = batches.as_list()
    for b in batch_list:
        if b["mesh"] in feet:
            b["collides"] = True
            b["affect_df"] = True
    return {"pass": PASS, "title": "Needle skyline: kit towers where the arrival eye sees the skyline",
            "folder": "Wonderland/Authored/SKY02", "tags": ["V2_Skyline"], "actors": [], "batches": batch_list,
            "towers": towers, "rules": {"show_uu": SHOW_UU, "tall_margin_uu": TALL_MARGIN_UU, "paving_margin_uu": PAVING_MARGIN_UU,
                                         "band_uu": BAND_UU, "eyes": EYES, "candidates": len(candidates)}}


if __name__ == "__main__":
    spec = build()
    out = HERE / "sky02_needle_skyline.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d towers from %d candidate points, %d batches, %d instances -> %s" % (
        PASS, len(spec["towers"]), spec["rules"]["candidates"], len(spec["batches"]),
        sum(len(b["instances"]) for b in spec["batches"]), out.name))
