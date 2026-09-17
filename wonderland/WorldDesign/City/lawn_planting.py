#!/usr/bin/env python3
"""GC01 -- the bare quarters get their gardens (2026-09-17).

THE GAP, AGAINST THE BIBLE. BOARD_2's ground language is paving plus DENSE PLANTING: flower beds, shrubs, topiary,
ground cover and planted borders along every path, under the rules "everything placed with intent", "no uniform
repetition", "no cheap procedural look". There is almost no open mown lawn in the reference at all.

The world is the other way round. Counting the planting props already placed (city_props: 1,768 shrubs, hedges,
topiary and roses) within 35 m of each of the 60 gameplay cameras: the garden districts have 38-69, the MEDIAN camera
has 12, fourteen cameras have three or fewer, and five -- City_FillW52, City_FillWE53, SW_StreetGate46,
SW_TowerCluster42, WorldNorthCam19 -- have NONE. A survey of those views is exactly where the world reads as a flat
green plane. This is not a material problem and GT01's edge fringe cannot fix it: the ground there is simply empty.

WHAT. No new asset: the world's own planting meshes, placed the way the boards place them.
  - A BORDER along the paving, on the lawn side, laid ALONG the edge and never evenly spaced: the forge's flower-bed
    runs (daisies, lavender, roses -- the boards' planted border), clusters of rose bushes, and flowering shrubs.
  - TOPIARY ACCENTS further apart along the same edge, alternating ball and cone, set back from the border.
  - HEDGES against a building wall that fronts lawn, so a wall meets planting instead of bare grass.
  - GARDEN GROUPS out in the open, where a lawn is too big for a border to reach it: a topiary with a bed and two
    rose bushes set around it, one group every GROUP_STEP, never on a grid -- the boards' "placed with intent"
    rather than a scatter. This is what SW_StreetGate46's bare foreground lawn needed: its paving edge is 20 m away,
    so the border pass reached nothing there.
Sizes and materials are read from what the world already uses (city_props measurements, prop_materials.json), so a
planted border here matches a planted border in the Tea Terrace.

WHERE. Only near cameras that are under TARGET planting today, so the districts that are already gardens are left
alone. Nothing is placed on paving, inside a building, or within reach of a prop that is already there.

    python lawn_planting.py            (writes gc01_<prefix>.json)
"""
import json
import math
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

import facade_dressing as F

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import nations                                                    # noqa: E402  (WorldDesign/nations.py)

HERE = Path(__file__).resolve().parent
TMP = F.TMP
CAMS = TMP / "channel" / "done" / "a00_cams.json"

PASS = "GC01"
GRASS = ("MI_V2_Lawn", "MI_V2_Meadow", "MI_V2_Moss")
PLANT_WORDS = ("shrub", "topiary", "hedge", "flower", "rose", "lavender", "blossom")
TARGET = 20                      # planting props within RANGE of a camera before this pass leaves it alone
RANGE = 3500.0
BORDER_STEP = 700.0              # along the paving edge, between border clusters
ACCENT_EVERY = 4                 # every Nth border cluster gets a topiary accent instead
BORDER_OUT = (110.0, 210.0)      # how far onto the lawn the border stands
ACCENT_OUT = (150.0, 260.0)
HEDGE_STEP = 520.0               # along a lawn-facing wall
HEDGE_OUT = 150.0
GROUP_STEP = 2200.0              # between garden groups in open lawn
GROUP_CLEAR = 800.0              # a group stands this far from paving: nearer than that the border already plants
GROUP_SHARE = 0.65               # and not at every step, so the spacing never reads as a grid
CULL = 12000.0

# mesh -> (radius cm, how many per cluster, scale range). Radii are the medians measured from the world's own
# instances (city_props), so spacing here means the same thing it means everywhere else.
ROSE = ("SM_rose_bush", 93.0, (2, 3), (0.85, 1.25))
SHRUB = ("SM_shrub_flowering", 184.0, (1, 1), (0.80, 1.15))
TOPIARY = [("SM_topiary_ball", 81.0, (1, 1), (0.85, 1.20)), ("SM_topiary_cone_plain", 129.0, (1, 1), (0.85, 1.10))]
HEDGE = ("SM_hedge_block", 248.0, (1, 1), (0.90, 1.20))
BEDS = ("WL_Flower_Daisy_Run", "WL_Flower_Lavender_Run", "WL_Flower_Rose_Run")
BED_RADIUS = 75.0
BED_CULL = 8000.0
MESH_PATH = "/Game/WonderlandV2/Vegetation/%s/%s.%s"
MESH_DIR = {"SM_rose_bush": "Roses", "SM_shrub_flowering": "Shrubs", "SM_topiary_ball": "Topiary",
            "SM_topiary_cone_plain": "Topiary", "SM_hedge_block": "Shrubs"}


def mesh_path(name):
    return MESH_PATH % (MESH_DIR[name], name, name)


def main():
    materials = json.loads((TMP / "prop_materials.json").read_text(encoding="utf-8"))

    def material_of(mesh):
        slots = materials.get(mesh)
        if not slots:
            raise SystemExit("no material recorded for %s: run prop_materials.py first" % mesh)
        return max(slots["0"].items(), key=lambda kv: kv[1])[0]

    ground = json.loads((TMP / "ground_boxes.json").read_text(encoding="utf-8"))
    lawns = [b for b in ground if b["mat"] in GRASS and b["mesh"] in ("SM_garden_lawn", "Cube")]
    small = [b for b in lawns if b["hx"] < 50000.0]
    floor = [b for b in lawns if b["hx"] >= 50000.0]
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    terraces = json.loads((TMP / "terrace_boxes.json").read_text(encoding="utf-8"))
    paving = [{"x": t["x"], "y": t["y"], "yaw": t["yaw"], "hx": t["len_x"] * 0.5, "hy": t["len_y"] * 0.5,
               "top": t["top"], "label": t["label"]} for t in streets]
    paving += [{"x": b["x"], "y": b["y"], "yaw": b["yaw"], "hx": b["hx"], "hy": b["hy"],
                "top": b["zmax"], "label": b["label"]} for b in terraces]
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    props = json.loads(F.PROPS.read_text(encoding="utf-8"))
    props = props["rows"] if isinstance(props, dict) else props
    plants = [p for p in props if any(w in p["mesh"] for w in PLANT_WORDS)]
    cams = [(c[0], c[1], c[2]) for c in json.loads(CAMS.read_text(encoding="utf-8"))["cams"]]
    bare = [(n, x, y) for (n, x, y) in cams
            if sum(1 for p in plants if (p["x"] - x) ** 2 + (p["y"] - y) ** 2 < RANGE * RANGE) < TARGET]
    lg = F.grid_of(small, lambda b: (b["x"], b["y"]))
    pg = F.grid_of(paving, lambda t: (t["x"], t["y"]))
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    rg = F.grid_of(props, lambda r: (r["x"], r["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))
    stats = Counter()
    stats["bare_cameras"] = len(bare)
    by_prefix = defaultdict(dict)
    placed = []                   # (x, y, radius) of everything this pass puts down

    def _in(b, x, y):
        th = math.radians(b["yaw"])
        dx, dy = x - b["x"], y - b["y"]
        lx = dx * math.cos(th) + dy * math.sin(th)
        ly = -dx * math.sin(th) + dy * math.cos(th)
        return abs(lx) <= b["hx"] and abs(ly) <= b["hy"]

    def lawn_at(x, y):
        for j in F.around(lg, x, y):
            if _in(small[j], x, y):
                return small[j]
        for b in floor:
            if _in(b, x, y):
                return b
        return None

    def near_bare_camera(x, y):
        return any((x - cx) ** 2 + (y - cy) ** 2 < RANGE * RANGE for (_, cx, cy) in bare)

    def prefix_at(x, y):
        best, bd = None, 1e18
        for j in F.around(sg, x, y):
            t = streets[j]
            d = (t["x"] - x) ** 2 + (t["y"] - y) ** 2
            if d < bd:
                best, bd = t["label"].split("_")[0], d
        return best or "Garden"

    def free(x, y, radius, ground_top):
        if any(_in(paving[k], x, y) and paving[k]["top"] > ground_top + 5.0 for k in F.around(pg, x, y)):
            stats["blocked_paving"] += 1
            return False
        if any(F.inside_box(buildings[k], x, y, ground_top + 40.0, slack=60.0) for k in F.around(bg, x, y)):
            stats["blocked_building"] += 1
            return False
        for k in F.around(rg, x, y):
            q = props[k]
            if math.hypot(q["x"] - x, q["y"] - y) < q["radius"] + radius and q["zmin"] < ground_top + 400.0:
                stats["blocked_prop_" + q["mesh"]] += 1
                return False
        if not all(math.hypot(px - x, py - y) >= pr + radius for (px, py, pr) in placed):
            stats["blocked_own"] += 1
            return False
        return True

    def put_bed(module, x, y, yaw, rng):
        """A forge flower-bed run, laid along the edge. Its own parts carry its own materials."""
        b = lawn_at(x, y)
        if b is None or not free(x, y, BED_RADIUS, b["zmax"]) or not near_bare_camera(x, y):
            stats["bed_no_room"] += 1
            return
        placed.append((x, y, BED_RADIUS))
        prefix = prefix_at(x, y)
        sc = round(rng.uniform(0.9, 1.25), 3)
        for part in F.KIT[module]["parts"]:
            k_id = "%s_%s_%s_%s" % (PASS, prefix, module.replace("WL_Flower_", "").replace("_Run", ""), part["part"])
            bt = by_prefix[prefix].setdefault(k_id, {"id": k_id, "mesh": part["mesh"], "material": part["material"],
                                                     "instances": [], "collides": False, "cast_shadow": True,
                                                     "affect_df": False, "cull_distance": BED_CULL})
            bt["instances"].append([round(x, 1), round(y, 1), round(b["zmax"], 1), 0.0, round(yaw, 1), 0.0, sc, sc, sc])
        stats[module] += 1

    def put(spec, x, y, rng):
        name, radius, count, scale = spec
        b = lawn_at(x, y)
        if b is None:
            stats["not_lawn"] += 1
            return 0
        n = rng.randint(*count)
        done = 0
        for k in range(n):
            px, py = (x, y) if k == 0 else (x + rng.uniform(-radius * 1.6, radius * 1.6),
                                            y + rng.uniform(-radius * 1.6, radius * 1.6))
            if not free(px, py, radius, b["zmax"]):
                stats["no_room"] += 1
                continue
            if not near_bare_camera(px, py):
                stats["not_near_a_bare_camera"] += 1
                continue
            placed.append((px, py, radius))
            prefix = prefix_at(px, py)
            sc = round(rng.uniform(*scale), 3)
            k_id = "%s_%s_%s" % (PASS, prefix, name.replace("SM_", ""))
            bt = by_prefix[prefix].setdefault(k_id, {"id": k_id, "mesh": mesh_path(name), "material": material_of(name),
                                                     "instances": [], "collides": False, "cast_shadow": True,
                                                     "affect_df": False, "cull_distance": CULL})
            bt["instances"].append([round(px, 1), round(py, 1), round(b["zmax"], 1), 0.0,
                                    round(rng.uniform(0.0, 360.0), 1), 0.0, sc, sc, sc])
            stats[name] += 1
            done += 1
        return done

    # 1. a border along the paving, and topiary accents set back from it
    for ti, t in enumerate(paving):
        th = math.radians(t["yaw"])
        c, s = math.cos(th), math.sin(th)
        hx, hy = t["hx"], t["hy"]
        rng = random.Random("%s:border:%d" % (PASS, ti))
        for (ax, ay, bx, by, ox, oy) in ((-hx, -hy, hx, -hy, 0.0, -1.0), (hx, -hy, hx, hy, 1.0, 0.0),
                                         (hx, hy, -hx, hy, 0.0, 1.0), (-hx, hy, -hx, -hy, -1.0, 0.0)):
            length = math.hypot(bx - ax, by - ay)
            n = int(length // BORDER_STEP)
            for i in range(n):
                u = (i + 0.5) / n + rng.uniform(-0.3, 0.3) / max(n, 1)
                accent = (i % ACCENT_EVERY) == ACCENT_EVERY - 1
                lo, hi = ACCENT_OUT if accent else BORDER_OUT
                out = rng.uniform(lo, hi)
                lx, ly = ax + (bx - ax) * u + ox * out, ay + (by - ay) * u + oy * out
                x, y = t["x"] + lx * c - ly * s, t["y"] + lx * s + ly * c
                if not near_bare_camera(x, y):
                    continue
                if accent:
                    put(TOPIARY[i // ACCENT_EVERY % len(TOPIARY)], x, y, rng)
                    continue
                roll = rng.random()
                if roll < 0.45:
                    # the bed runs along the edge: the kit is mirrored in Y, so yaw = the edge's normal + 90
                    yaw = (math.degrees(math.atan2(oy * s + ox * 0.0, 1.0)) if False else
                           (math.degrees(math.atan2(ox * s + oy * c, ox * c - oy * s)) + 90.0) % 360.0)
                    put_bed(BEDS[i % len(BEDS)], x, y, yaw, rng)
                elif roll < 0.8:
                    put(ROSE, x, y, rng)
                else:
                    put(SHRUB, x, y, rng)
                if rng.random() < 0.35:
                    a = rng.uniform(0.0, math.tau)
                    put(SHRUB, x + math.cos(a) * 300.0, y + math.sin(a) * 300.0, rng)

    # 2. hedges against the walls that front lawn
    from shopfronts import faces_of
    for bi, b in enumerate(buildings):
        rng = random.Random("%s:hedge:%d" % (PASS, bi))
        for (nx, ny, fx, fy, half_t) in faces_of(b):
            probe = lawn_at(fx + nx * 260.0, fy + ny * 260.0)
            if probe is None or not near_bare_camera(fx, fy):
                continue
            tx, ty = -ny, nx
            n = int((2.0 * half_t) // HEDGE_STEP)
            for i in range(n):
                a = -half_t + HEDGE_STEP * (i + 0.5)
                x = fx + tx * a + nx * HEDGE_OUT
                y = fy + ty * a + ny * HEDGE_OUT
                put(HEDGE, x, y, rng)

    # 3. garden groups in open lawn the border cannot reach
    for (name, cx, cy) in bare:
        rng = random.Random("%s:group:%s" % (PASS, name))
        n = int(RANGE // GROUP_STEP)
        for i in range(-n, n + 1):
            for j in range(-n, n + 1):
                if rng.random() > GROUP_SHARE:
                    continue
                x = cx + i * GROUP_STEP + rng.uniform(-GROUP_STEP * 0.4, GROUP_STEP * 0.4)
                y = cy + j * GROUP_STEP + rng.uniform(-GROUP_STEP * 0.4, GROUP_STEP * 0.4)
                if (x - cx) ** 2 + (y - cy) ** 2 > RANGE * RANGE:
                    continue
                b = lawn_at(x, y)
                if b is None:
                    stats["group_not_lawn"] += 1
                    continue
                if any(_in(paving[k], x, y) or (abs(paving[k]["x"] - x) < paving[k]["hx"] + GROUP_CLEAR
                                                and abs(paving[k]["y"] - y) < paving[k]["hy"] + GROUP_CLEAR)
                       for k in F.around(pg, x, y)):
                    stats["group_near_paving"] += 1
                    continue
                if not put(TOPIARY[(i + j) % len(TOPIARY)], x, y, rng):
                    continue
                a0 = rng.uniform(0.0, math.tau)
                put_bed(BEDS[(i + j) % len(BEDS)], x + math.cos(a0) * 320.0, y + math.sin(a0) * 320.0,
                        round(math.degrees(a0) + 90.0, 1), rng)
                for k in (1, 2):
                    a = a0 + math.tau * k / 3.0
                    put(ROSE, x + math.cos(a) * 300.0, y + math.sin(a) * 300.0, rng)
                stats["garden_groups"] += 1

    for old in HERE.glob("gc01_*.json"):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        inst = next(iter(batches.values()))["instances"][0]
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "GC01 %s: planted borders, topiary and hedges" % prefix,
                 "tags": [PASS, nations.tag(nations.nation_at(inst[0], inst[1]))],
                 "actors": [], "batches": list(batches.values())}
        (HERE / ("gc01_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
