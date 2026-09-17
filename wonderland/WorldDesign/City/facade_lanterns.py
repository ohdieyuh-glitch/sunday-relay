#!/usr/bin/env python3
"""FD05 -- gold wall lanterns at the shop doors and between the ground-floor windows (2026-09-16).

THE GAP. The streets' only lights are SD01's stone waymarker lamps at the kerb. The Bible's street light is a glazed
gold lantern held off the wall at door height (BOARD_2 "Lanterns & Lights"): the warm point at eye level that says a
building is lived in, and the gold accent a pale wall needs close to the eye.

WHAT. The forge's WL_Detail_Wall_Lantern (wonderland-blender-forge b0451f26): back plate, arm with a scroll above it,
a hexagonal lit amber body in a gold cage, a domed cap and a drop finial. 1.74 m, projecting 0.92 m, arm at local
z 1.24. Mirrored kit, as SF01 measured: the arm projects toward LOCAL -Y in Unreal, so yaw = normal + 90.

WHERE.
  - Beside SF01's shopfronts: one lantern each side of the shop, just outside its frame, where the wall continues.
  - Between FD02's ground-floor arched windows: on a face with two or more ground windows, one lantern in the gap
    between the two nearest the middle (the surrounds leave 69 cm; the lantern is 52 cm across) -- on LIT_SHARE of
    such faces, so walls differ.
The arm stands at ARM_ABOVE over the street top: the lantern's bottom clears heads and the Dog. Nothing is placed
within BANNER_CLEAR of an FD04 banner, or where a raised prop overlaps it.

    python facade_lanterns.py            (writes fd05_<prefix>.json)
"""
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import facade_dressing as F
import street_dressing as SD
from shopfronts import SHOP_W, faces_of

HERE = Path(__file__).resolve().parent
KIT = F.KIT
TMP = F.TMP

PASS = "FD05"
LANTERN = "WL_Detail_Wall_Lantern"
ARM_LOCAL = 124.0
ARM_ABOVE = 320.0               # arm over the street top; the drop finial at ~2.0 m
SHOP_SIDE = SHOP_W * 0.5 + 38.0
WALL_MARGIN = 30.0              # a lantern's plate inside its face's end
BANNER_CLEAR = 150.0
LIT_SHARE = 0.55
CULL = 8000.0


def layer_instances(pattern, suffix):
    out = []
    for f in sorted(HERE.glob(pattern)):
        layer = json.loads(f.read_text(encoding="utf-8"))
        if not isinstance(layer, dict):
            continue                                                  # sf01_edges.json is a list, not a layer
        prefix = layer["pass"].split("_", 1)[1]
        for bt in layer["batches"]:
            if bt["id"].endswith(suffix):
                out += [(prefix, i) for i in bt["instances"]]
    return out


def main():
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    rows = json.loads(F.PROPS.read_text(encoding="utf-8"))
    raised = [r for r in (rows["rows"] if isinstance(rows, dict) else rows) if r["zmin"] > F.PROP_RAISED]
    rg = F.grid_of(raised, lambda r: (r["x"], r["y"]))
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))

    def street_top_at(x, y, nx, ny):
        for d in F.STREET_PROBES:
            for j in F.around(sg, x + nx * d, y + ny * d):
                if SD.inside(streets[j], x + nx * d, y + ny * d):
                    return streets[j]["top"]
        return None
    banners = [i for (_, i) in layer_instances("fd04_*.json", "_gold")]
    shops = layer_instances("sf01_*.json", "_Shop_stone")
    windows = layer_instances("fd02_*.json", "_Window_stone")
    stats = Counter()
    candidates = []            # (prefix, x, y, street_top, yaw)

    def on_face(x, y, yaw):
        """The building face a wall-mounted instance at (x, y, yaw) stands on: (half-width, along-offset) or None."""
        nyaw = math.radians(yaw - 90.0)
        nx, ny = math.cos(nyaw), math.sin(nyaw)
        best = None
        for bi in F.around(bg, x, y):
            for (fnx, fny, fx, fy, half_t) in faces_of(buildings[bi]):
                if fnx * nx + fny * ny < 0.95:
                    continue
                dn = (x - fx) * fnx + (y - fy) * fny
                if abs(dn) > 120.0:
                    continue
                along = (x - fx) * -fny + (y - fy) * fnx
                if abs(along) <= half_t + 40.0 and (best is None or abs(dn) < best[0]):
                    best = (abs(dn), half_t, along, fnx, fny)
        return best

    # beside the shops: the shop's instance z is the street top
    for prefix, i in shops:
        x, y, top, yaw = i[0], i[1], i[2], i[4]
        face = on_face(x, y, yaw)
        if face is None:
            stats["shop_face_not_found"] += 1
            continue
        _, half_t, along, fnx, fny = face
        tx, ty = -fny, fnx
        for side in (-1.0, 1.0):
            a = along + side * SHOP_SIDE
            if abs(a) > half_t - WALL_MARGIN:
                stats["shop_side_off_the_wall"] += 1
                continue
            candidates.append((prefix, x + tx * side * SHOP_SIDE, y + ty * side * SHOP_SIDE, top, yaw))
    # between the ground windows: FD02 windows grouped by wall (same yaw, same offset along the normal); only the
    # LOWEST row on each wall is the ground row -- the upper rows would hang a door lantern 7 m up
    walls = defaultdict(list)
    for prefix, i in windows:
        yaw = i[4]
        normal = (math.cos(math.radians(yaw - 90.0)), math.sin(math.radians(yaw - 90.0)))
        walls[(prefix, round(yaw), round((i[0] * normal[0] + i[1] * normal[1]) / 50.0))].append(i)
    for (prefix, _, _), items in walls.items():
        yaw = items[0][4]
        tangent = (math.cos(math.radians(yaw)), math.sin(math.radians(yaw)))
        low = min(i[2] for i in items)
        line = sorted((i for i in items if abs(i[2] - low) < 1.0), key=lambda i: i[0] * tangent[0] + i[1] * tangent[1])
        if len(line) < 2:
            continue
        mid = len(line) // 2
        a_, b_ = line[mid - 1], line[mid]
        if math.hypot(a_[0] - b_[0], a_[1] - b_[1]) > 320.0:
            continue                                                  # not neighbours in one row
        cx, cy = (a_[0] + b_[0]) * 0.5, (a_[1] + b_[1]) * 0.5
        if F.hash01(cx, cy, 43) >= LIT_SHARE:
            stats["window_pair_left_plain"] += 1
            continue
        nyaw = math.radians(yaw - 90.0)
        street_top = street_top_at(cx, cy, math.cos(nyaw), math.sin(nyaw))
        # FD02's ground row stands at street top + 60 (opening at + 90, origin 30 lower); where shops took the whole
        # ground row, the lowest row left is the second storey, and a door lantern does not belong up there
        if street_top is None or abs(low - (street_top + 60.0)) > 40.0:
            stats["lowest_row_is_not_the_ground_row"] += 1
            continue
        candidates.append((prefix, cx, cy, street_top, yaw))

    placed = []
    by_prefix = defaultdict(dict)
    for (prefix, x, y, top, yaw) in candidates:
        oz = top + ARM_ABOVE - ARM_LOCAL
        if any(math.hypot(b[0] - x, b[1] - y) < BANNER_CLEAR for b in banners):
            stats["next_to_a_banner"] += 1
            continue
        nyaw = math.radians(yaw - 90.0)
        mx, my = x + math.cos(nyaw) * 60.0, y + math.sin(nyaw) * 60.0
        if any(math.hypot(raised[j]["x"] - mx, raised[j]["y"] - my) < raised[j]["radius"] + 40.0
               and raised[j]["zmin"] < oz + 174.0 - F.PROP_OVERLAP and raised[j]["zmax"] > oz + 20.0
               for j in F.around(rg, mx, my)):
            stats["raised_prop_in_the_way"] += 1
            continue
        if any(math.hypot(p[0] - x, p[1] - y) < 100.0 for p in placed):
            stats["duplicate"] += 1
            continue
        placed.append((x, y))
        for part in KIT[LANTERN]["parts"]:
            k = "%s_%s_Lantern_%s" % (PASS, prefix, part["part"])
            bt = by_prefix[prefix].setdefault(k, {"id": k, "mesh": part["mesh"], "material": part["material"], "instances": [],
                                                  "collides": False, "cast_shadow": True, "affect_df": False,
                                                  "cull_distance": CULL})
            bt["instances"].append([round(x, 1), round(y, 1), round(oz, 1), 0.0, round(yaw, 1), 0.0, 1.0, 1.0, 1.0])
        stats["lanterns"] += 1
    for old in HERE.glob("fd05_*.json"):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "FD05 %s: gold wall lanterns at shops and ground windows" % prefix,
                 "tags": [PASS], "actors": [], "batches": list(batches.values())}
        (HERE / ("fd05_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
