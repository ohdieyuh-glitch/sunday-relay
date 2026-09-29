#!/usr/bin/env python3
"""HEARTLAND DISTANCE DELTA (Q4, 2026-09-29): the five applied heartland fills, made to read from a distance.

WHY. The after-frames of HN238 / HI057 / HT308 (zzW60) showed the garden rooms as bare pale slabs from the aerial
and distant cameras. The specs carry three cull tiers: floors (SM_terrace_platform) 600 m, trees / topiary /
mushrooms 260 m, hedges / roses / shrubs / benches 120 m. Past 120 m a room was a floor with nothing on it. Every
batch was resident in play, so this is not streaming. Core's look call (queue Q4): hedges and trees at least 260 m,
plus one tall marker per quarter.

WHAT. A DELTA on the specs as applied. Nothing is re-planned: sector_fill.py plans against the census, and the
census now holds these fills, so a regen would lay out different gardens.
  1. Cull tiers: hedges / roses / flowering shrubs / benches 120 -> 260 m. Trees, canopies, topiary and mushrooms
     260 -> 600 m. Flower runs, stepping stones and tree grates stay at 120 m.
  2. One MARKER per garden quarter: a landmark mushroom (the ring's and Dubel's landmark language) in the nation's
     cap colour, scale 1.3 (~17.5 m wide, ~23.5 m tall), cull 600 m. It goes on one outer diagonal corner of the
     quarter, never on its crossing lanes, in the first corner whose 11.5 m disc is clear of everything in the
     census and in the spec. Ground plates, lawn, grass and sunk trims don't count. The outermost corner (largest
     world radius) is tried first, so the markers face the frontier.
Instances already in a spec are not moved. Re-running is idempotent: existing marker batches are replaced.

    python heartland_distance_delta.py [--dry]
"""
import argparse
import csv
import gzip
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
CENSUS = HERE.parent.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
FILLS = {"HT356": ("ht356_tartarus_heartland.json", "ht356_walk.json", "MI_V2_MushRed"),
         "HN181": ("hn181_noctis_heartland.json", "hn181_walk.json", "MI_V2_MushPurple"),
         "HN238": ("hn238_noctis_heartland.json", "hn238_walk.json", "MI_V2_MushPurple"),
         "HI057": ("hi057_icarus_heartland.json", "hi057_walk.json", "MI_V2_MushCream"),
         "HT308": ("ht308_tartarus_heartland.json", "ht308_walk.json", "MI_V2_MushRed")}
TO_MID = ("SM_hedge_block", "SM_rose_bush", "SM_shrub_flowering", "SM_garden_bench")
TO_FAR = ("SM_canopy_", "SM_tree_", "SM_topiary_", "WL_Mushroom_")
MID, FAR = 26000.0, 60000.0
MARKER_MESH = "/Game/WonderlandV2/Mushrooms/Landmark/SM_mushroom_landmark.SM_mushroom_landmark"
MARKER_SCALE = 1.3
MARKER_CLEAR = 1150.0          # cm: the marker's half-width (~876) plus a walking margin
MARKER_SPACING = 6000.0        # cm: two quarters' markers never read as one cluster
CORNER_OUT = 900.0             # cm beyond the room's outer corner, along the diagonal
IGNORE = ("lawn", "grass", "tuft", "moss", "clover", "Flower_")


def blockers():
    """Census footprints a marker must not overlap: (x, y, half-extent). Ground plates (>50 m), lawn/grass cover,
    flower runs and sunk trims are not obstacles."""
    out = []
    with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "OTHER" or float(r["z"]) < -50000.0 or float(r["z"]) > 6000.0:
                continue
            if any(w in r["mesh"] for w in IGNORE):
                continue
            ex, ey = float(r["ex"]), float(r["ey"])
            if max(ex, ey) > 5000.0:
                continue
            out.append((float(r["x"]), float(r["y"]), max(ex, ey)))
    return out


def grid(pts, cell=5000.0):
    g = {}
    for p in pts:
        g.setdefault((int(p[0] // cell), int(p[1] // cell)), []).append(p)
    return g, cell


def clear(g, x, y, r):
    idx, cell = g
    cx, cy = int(x // cell), int(y // cell)
    for i in range(cx - 1, cx + 2):
        for j in range(cy - 1, cy + 2):
            for (px, py, e) in idx.get((i, j), ()):
                if math.hypot(px - x, py - y) < r + e:
                    return False
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    g = grid(blockers())
    report = {}
    for pid, (spec_f, walk_f, mat) in FILLS.items():
        spec = json.load(open(HERE / spec_f, encoding="utf-8"))
        side = json.load(open(HERE / walk_f, encoding="utf-8"))
        changed = {"to_260m": 0, "to_600m": 0}
        spec["batches"] = [b for b in spec["batches"] if "_Marker_" not in b["id"]]
        for b in spec["batches"]:
            name = b["mesh"].split("/")[-1].split(".")[0]
            if name in TO_MID and b["cull_distance"] < MID:
                b["cull_distance"] = MID
                changed["to_260m"] += 1
            elif name.startswith(TO_FAR) and b["cull_distance"] < FAR:
                b["cull_distance"] = FAR
                changed["to_600m"] += 1
        rooms = [gr for gr in side["groups"] if gr["kind"] == "quarter_room"]
        quarters = [gr for gr in side["groups"] if gr["kind"] == "quarter"]
        markers = []
        for qi, q in enumerate(quarters):
            qx, qy = q["centre"][:2]
            mine = sorted(rooms, key=lambda rm: math.hypot(rm["centre"][0] - qx, rm["centre"][1] - qy))[:4]
            cands = []
            for rm in mine:
                dx, dy = rm["centre"][0] - qx, rm["centre"][1] - qy
                n = math.hypot(dx, dy) or 1.0
                # the room's outer corner along the diagonal is ~H*sqrt(2) past the room centre (H = 1,620)
                d0 = n + 1620.0 * math.sqrt(2.0) + CORNER_OUT + MARKER_CLEAR
                for ring, extra in enumerate((0.0, 1500.0, 3000.0)):
                    d = d0 + extra
                    cands.append((ring, qx + dx / n * d, qy + dy / n * d))
            # nearest ring first (the marker belongs to the quarter), then the outermost corner (it faces the frontier)
            cands = [(x, y) for (_, x, y) in sorted(cands, key=lambda c: (c[0], -math.hypot(c[1], c[2])))]
            placed = [m["at"] for m in markers if m.get("placed")]
            spot = next((c for c in cands if clear(g, c[0], c[1], MARKER_CLEAR)
                         and all(math.hypot(c[0] - px, c[1] - py) >= MARKER_SPACING for (px, py) in placed)), None)
            if spot is None:
                markers.append({"quarter": qi, "placed": False})
                continue
            yaw = (math.degrees(math.atan2(spot[1], spot[0])) + 180.0) % 360.0
            spec["batches"].append({"id": "%s_Marker_Landmark_q%d" % (pid, qi), "mesh": MARKER_MESH, "material": mat,
                                    "instances": [[round(spot[0], 1), round(spot[1], 1), -19.0, 0.0, round(yaw, 1), 0.0,
                                                   MARKER_SCALE, MARKER_SCALE, MARKER_SCALE]],
                                    "collides": True, "cast_shadow": True, "affect_df": False, "cull_distance": FAR})
            g[0].setdefault((int(spot[0] // g[1]), int(spot[1] // g[1])), []).append((spot[0], spot[1], MARKER_CLEAR))
            markers.append({"quarter": qi, "placed": True, "at": [round(spot[0]), round(spot[1])],
                            "radius_m": round(math.hypot(*spot) / 100), "bearing": round(math.degrees(math.atan2(spot[1], spot[0])) % 360, 1)})
        report[pid] = {"cull": changed, "markers": markers, "batches": len(spec["batches"]),
                       "instances": sum(len(b["instances"]) for b in spec["batches"])}
        if not a.dry:
            (HERE / spec_f).write_bytes((json.dumps(spec, indent=1)).encode("utf-8").replace(b"\n", b"\r\n")
                                        if b"\r\n" in (HERE / spec_f).read_bytes()[:4000] else
                                        json.dumps(spec, indent=1).encode("utf-8"))
    print(json.dumps(report, indent=1))


if __name__ == "__main__":
    main()
