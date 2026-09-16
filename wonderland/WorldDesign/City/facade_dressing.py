#!/usr/bin/env python3
"""FD01 -- the street walls above the shops get balconies and glazed oriel bays (2026-09-16).

THE GAP. After WIN01 the street cameras are the least Wonderland-like views in the survey, and what is left wrong in
them is the silhouette of the walls: flat ashlar boxes with a grid of windows, straight up from the shopfronts to the
roof. The Bible's streets are made of projections -- balconies on corbels, bay windows with little roofs and gold
finials -- and it is those that give a street its depth and its light and shade.

WHAT. Clip-ons the forge already built for exactly this ("the generator also needs to add those things to geometry
it did not get from this kit"), both imported and both flat-backed:
  WL_Detail_Balcony_Bracket   4.84 x 2.52 m, five corbels, a balustrade; its floor is at local z 1.52 m
  WL_Detail_Oriel_Bay         3.52 m wide, 6.4 m tall, three-sided amber glazing at local z 1.95..4.25 m

WHERE, from the city's own windows. A window is the one thing on a generator facade that says "a storey is here":
the panes (pane_census.py, 14.7k SM_glass_screen_panes actors) are placed per facade and per storey. A pane is used if
  - its material is a city window (WindowDark / PaneAmber / PaneTeal -- not a garden screen);
  - it lies ON a building box's face (building_census.py), which gives the wall's outward normal;
  - that normal looks onto a street tile within 3..12 m (street_census.py), so the feature is seen from a street;
  - its bottom is at least a storey above the street (STOREY_MIN). The first storey's windows sit at ~3.1 m, where a
    bay's corbel would hang at head height and run into SF01's awnings; the second storey's are at ~5.8 m.
A balcony stands under its window (floor at the sill); an oriel's glazing is centred on it.
Rhythm, not repetition: each wall face gets balconies, oriels or nothing by a hash of its position, and within a face
features keep a minimum spacing. Nothing is placed within SHOP_CLEAR of a shopfront below it, where another building
stands in front of the wall, or next to a feature already placed on the neighbouring face of a corner.

THE MIRRORED KIT. As SF01 measured: kit bounds are Blender space and the FBX import mirrors Y, so both modules project
toward LOCAL -Y in Unreal, with the back at y = 0. yaw = normal + 90 puts local -Y on the wall's outward normal.

    python facade_dressing.py            (writes fd01_<prefix>.json)
"""
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import street_dressing as SD
from shopfronts import faces_of

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")
KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

PASS = "FD01"
BALCONY = "WL_Detail_Balcony_Bracket"
ORIEL = "WL_Detail_Oriel_Bay"
WINDOW_MATS = ("MI_V2_WindowDark", "MI_V2_PaneAmber", "MI_V2_PaneTeal")
ON_FACE = 120.0                  # a pane centre within this of a box face lies on that wall
STREET_PROBES = (300.0, 700.0, 1200.0)
STOREY_MIN = 480.0               # pane bottom above the street top; the ~3.1 m first-storey band is excluded
STOREY_MAX = 2000.0
BALCONY_FLOOR = 152.0            # local z of the balcony's walking surface
BALCONY_TOP = 248.0              # local z of the top of its rail
ORIEL_GLASS_MID = 310.0          # local z of the middle of the oriel's glazing
INTO_WALL = 10.0                 # the back sits this far behind the pane's centre plane
BALCONY_GAP = 620.0              # along a face, between balcony centres
ORIEL_GAP = 900.0
PER_GROUP = {BALCONY: 3, ORIEL: 2}
SHOP_CLEAR = 650.0               # horizontal, from a shopfront below
CORNER_CLEAR = 520.0             # from a feature on another face
FRONT_PROBE = 280.0              # a point this far out from the wall must not be inside another building
PROPS = TMP / "city_props.json"  # SD01's prop census, with each prop's z range
PROP_CLEAR = 200.0               # beyond a raised prop's radius. fd01b put a balcony through a 3.3x gold balustrade
                                 # band the generator runs along its walls at ~7 m; a raised prop is anything above
PROP_RAISED = 150.0              # this -- a street lamp or a bench cannot reach a second-storey balcony
PROP_OVERLAP = 80.0              # and must overlap the balcony by this much in z: the arch hood over the window above
                                 # (SM_garden_arch_stone, from ~6.4 m) grazes the rail by 5 cm and is not a clash
CULL = 12000.0


def hash01(*vals):
    h = 2166136261
    for v in vals:
        for ch in str(int(round(v))):
            h = ((h ^ ord(ch)) * 16777619) & 0xFFFFFFFF
    return h / 4294967295.0


# ORIELS ARE OFF. The first preview (fd01a) put 117 of them up and every one read as a blank grey box on a cone: the
# forge's WL_Detail_Oriel_Bay draws its glazing prism INSIDE its solid stone prism, so from outside there is no glass
# at all. The balconies in the same preview read as real balconies. Until the oriel module shows its windows, the faces
# that would have had one get a balcony, and a third of faces stay plain so the streets keep a rhythm.
BALCONY_SHARE = 0.65
ORIEL_SHARE = 0.0


def kind_for(fx, fy):
    u = hash01(fx, fy, 71)
    return BALCONY if u < BALCONY_SHARE else (ORIEL if u < BALCONY_SHARE + ORIEL_SHARE else None)


def grid_of(items, key, cell=3000.0):
    g = defaultdict(list)
    for i, it in enumerate(items):
        x, y = key(it)
        g[(int(x // cell), int(y // cell))].append(i)
    return g


def around(g, x, y, cell=3000.0):
    gx, gy = int(x // cell), int(y // cell)
    for ix in (gx - 1, gx, gx + 1):
        for iy in (gy - 1, gy, gy + 1):
            yield from g.get((ix, iy), ())


def inside_box(b, x, y, z, slack=0.0):
    th = math.radians(b["yaw"])
    dx, dy = x - b["x"], y - b["y"]
    lx = dx * math.cos(th) + dy * math.sin(th)
    ly = -dx * math.sin(th) + dy * math.cos(th)
    return abs(lx) <= b["hx"] + slack and abs(ly) <= b["hy"] + slack and b["zmin"] <= z <= b["zmax"]


def shop_points():
    pts = []
    for f in HERE.glob("sf01_*.json"):
        if f.name == "sf01_edges.json":
            continue
        for bt in json.loads(f.read_text(encoding="utf-8"))["batches"]:
            if bt["id"].endswith("_Shop_stone") or bt["mesh"].split(".")[-1] == "WL_House_Shopfront":
                pts += [(i[0], i[1]) for i in bt["instances"]]
    return pts


def main():
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    panes = json.loads((TMP / "pane_census.json").read_text(encoding="utf-8"))["panes"]
    shops = shop_points()
    bg = grid_of(buildings, lambda b: (b["x"], b["y"]))
    sg = grid_of(streets, lambda t: (t["x"], t["y"]))
    shg = grid_of(shops, lambda p: p)
    rows = json.loads(PROPS.read_text(encoding="utf-8"))
    raised = [r for r in (rows["rows"] if isinstance(rows, dict) else rows) if r["zmin"] > PROP_RAISED]
    rg = grid_of(raised, lambda r: (r["x"], r["y"]))
    stats = Counter()

    def street_at(x, y):
        for j in around(sg, x, y):
            if SD.inside(streets[j], x, y):
                return streets[j]
        return None

    groups = defaultdict(list)
    for p in panes:
        if p["mat"] not in WINDOW_MATS:
            stats["not_a_city_window"] += 1
            continue
        cx, cy = (p["bmin"][0] + p["bmax"][0]) * 0.5, (p["bmin"][1] + p["bmax"][1]) * 0.5
        best = None
        for bi in around(bg, cx, cy):
            b = buildings[bi]
            if not (b["zmin"] - 50.0 <= p["bmin"][2] and p["bmax"][2] <= b["zmax"] + 200.0):
                continue
            for fi, (nx, ny, fx, fy, half_t) in enumerate(faces_of(b)):
                dn = (cx - fx) * nx + (cy - fy) * ny
                dt = (cx - fx) * -ny + (cy - fy) * nx
                if abs(dn) < ON_FACE and abs(dt) <= half_t + 40.0 and (best is None or abs(dn) < abs(best[0])):
                    best = (dn, bi, fi, nx, ny, fx, fy, dt)
        if best is None:
            stats["not_on_a_building_face"] += 1
            continue
        dn, bi, fi, nx, ny, fx, fy, dt = best
        tile = next((t for t in (street_at(cx + nx * d, cy + ny * d) for d in STREET_PROBES) if t), None)
        if tile is None:
            stats["not_facing_a_street"] += 1
            continue
        h = p["bmin"][2] - tile["top"]
        if not (STOREY_MIN <= h <= STOREY_MAX):
            stats["storey_out_of_band"] += 1
            continue
        groups[(bi, fi, int(round(h / 150.0)))].append(
            {"cx": cx, "cy": cy, "dt": dt, "nx": nx, "ny": ny, "fx": fx, "fy": fy,
             "zb": p["bmin"][2], "zt": p["bmax"][2], "h": h, "prefix": tile["label"].split("_")[0]})

    placed = []                                   # (x, y, z, bi, fi)
    by_prefix = defaultdict(dict)
    for (bi, fi, band), items in sorted(groups.items()):
        first = items[0]
        kind = kind_for(first["fx"], first["fy"])
        if kind is None:
            stats["face_left_plain"] += len(items)
            continue
        gap = BALCONY_GAP if kind == BALCONY else ORIEL_GAP
        chosen = []
        # centre-out, so a face with one feature has it in the middle; a window that fails a clearance test hands its
        # turn to the next one out, instead of leaving the face bare
        for it in sorted(items, key=lambda it: abs(it["dt"])):
            if len(chosen) >= PER_GROUP[kind]:
                break
            if any(abs(it["dt"] - c["dt"]) < gap for c in chosen):
                continue
            nx, ny = it["nx"], it["ny"]
            x, y = it["cx"] - nx * INTO_WALL, it["cy"] - ny * INTO_WALL
            if kind == BALCONY:
                z = it["zb"] - BALCONY_FLOOR
            else:
                z = (it["zb"] + it["zt"]) * 0.5 - ORIEL_GLASS_MID
            if it["h"] < 900.0 and any(math.hypot(shops[s][0] - x, shops[s][1] - y) < SHOP_CLEAR for s in around(shg, x, y)):
                stats["over_a_shop"] += 1
                continue
            px, py, pz = x + nx * FRONT_PROBE, y + ny * FRONT_PROBE, z + 250.0
            if any(bj != bi and inside_box(buildings[bj], px, py, pz) for bj in around(bg, px, py)):
                stats["another_building_in_front"] += 1
                continue
            mx, my = x + nx * 120.0, y + ny * 120.0
            if any(math.hypot(raised[j]["x"] - mx, raised[j]["y"] - my) < raised[j]["radius"] + PROP_CLEAR
                   and raised[j]["zmin"] < z + BALCONY_TOP - PROP_OVERLAP and raised[j]["zmax"] > z + 40.0 for j in around(rg, mx, my)):
                stats["raised_prop_in_the_way"] += 1
                continue
            if any((q[3], q[4]) != (bi, fi) and math.hypot(q[0] - x, q[1] - y) < CORNER_CLEAR and abs(q[2] - z) < 700.0
                   for q in placed):
                stats["corner_clash"] += 1
                continue
            chosen.append(it)
            placed.append((x, y, z, bi, fi))
            yaw = (math.degrees(math.atan2(ny, nx)) + 90.0) % 360.0
            batches = by_prefix[it["prefix"]]
            for part in KIT[kind]["parts"]:
                k = "%s_%s_%s_%s" % (PASS, it["prefix"], "Balcony" if kind == BALCONY else "Oriel", part["part"])
                bt = batches.setdefault(k, {"id": k, "mesh": part["mesh"], "material": part["material"], "instances": [],
                                            "collides": False, "cast_shadow": True, "affect_df": False,
                                            "cull_distance": CULL})
                bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw, 1), 0.0, 1.0, 1.0, 1.0])
            stats["balconies" if kind == BALCONY else "oriels"] += 1
    for old in HERE.glob("fd01_*.json"):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        layer = {"pass": "%s_%s" % (PASS, prefix),
                 "title": "FD01 %s: balconies and oriel bays on street-facing upper storeys" % prefix,
                 "tags": ["FD01"], "actors": [], "batches": list(batches.values())}
        (HERE / ("fd01_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats, {p: sum(len(b["instances"]) for b in bs.values() if b["id"].endswith("_stone")) for p, bs in by_prefix.items()}


if __name__ == "__main__":
    stats, per = main()
    print(dict(stats))
    print(per)
