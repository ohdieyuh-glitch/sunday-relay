#!/usr/bin/env python3
"""AV01/AV02/AV03 -- THE AVENUE FROM EACH NATION'S GATE TO ITS BAND, laid where a walker can actually go.

THE RULING THIS ANSWERS (QA-8, 2026-09-27). "Every canonical gate-to-band route in every nation has at
least one DELIBERATE, VISUALLY COHERENT, physically traversable path, proven by actual movement." The
corridor search (`Tools/audit_nation_corridor.py`) has already answered the physical half: a connected path
exists in all three nations, weaving no more than 28 m off the axis between the buildings at 690-830 m. What
it found is a path a machine can prove and a player cannot see -- a route through a district that looks like
every other gap between buildings. This makes it a ROAD.

WHAT AN AVENUE IS HERE. Along the search's own route, read from `nation_routes.json` so the road cannot drift
from the path that was proven:
  A PAVED CARRIAGEWAY   three lanes of the nation's flagstones, 12 m wide, the three shapes cycled so it does
                        not read as one tile repeated (ledger row E), laid on the FLOOR THE SEARCH MEASURED
                        at each point -- so it steps down off the +12 shelf onto the -14 frontier where the
                        ground does, rather than floating across the join.
  KERBS                 a kerb run down each edge, so it reads as a road and not as paving that happens to
                        continue -- the same reasoning the seam passes used.
  LANTERN STANDARDS     every 24 m, alternating sides, glass on the nation's own accent. They are also
                        FIXTURES for the practical-light pass, so the avenue is lit at night: the founder's
                        "path lighting", on the one path that matters most in each nation.
  NOTHING THROUGH A BUILDING. Every piece is refused where a colliding structure already stands, using the
                        same occupancy test the checkpoints use; the route already threads between them, but
                        a 12 m road has edges the 2 m search cell did not.

WHAT IT DOES NOT DO. It does not move, cut, sink or re-collide any building. The ruling forbids "cutting
arbitrary holes through working architecture" and permits fixing the ROUTE; this fixes the route by making
it visible and deliberate, on ground that was already walkable.

    python WorldDesign/Nations/nation_avenues.py
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
sys.path.insert(0, str(HERE))
import nations                                                                # noqa: E402

KIT = json.loads((WD / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
INVENTORY = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")
ROUTES = json.loads((HERE / "nation_routes.json").read_text(encoding="utf-8"))
CULL_NEAR, CULL_MID, CULL_FAR = 12000.0, 26000.0, 60000.0

PASSES = {
    "AV01": dict(nation="ICARUS", module="icarus_district", out="av01_icarus_avenue.json"),
    "AV02": dict(nation="NOCTIS", module="noctis_quarter", out="av02_noctis_avenue.json"),
    "AV03": dict(nation="TARTARUS", module="tartarus_quarter", out="av03_tartarus_avenue.json"),
}
FLAG = 400.0                 # the flagstone's own square
LANES = (-400.0, 0.0, 400.0)
KERB_EVERY = 800.0
LAMP_EVERY = 2400.0
EDGE = 620.0                 # kerb line: half the carriageway plus the kerb run's own half depth
LAMP_OFF = 900.0
BLOCK_H = 200.0


class Occupancy:
    """Everything colliding and taller than 2 m, with its real footprint, so nothing is laid through it."""

    def __init__(self):
        size = {}
        if INVENTORY.exists():
            for rec in json.loads(INVENTORY.read_text(encoding="utf-8")):
                size[rec["name"]] = rec["size_cm"]
        for mod in KIT.values():
            for part in mod["parts"]:
                size.setdefault(part["mesh"].split("/")[-1].split(".")[0], mod["size"])
        mine = {cfg["out"] for cfg in PASSES.values()}
        self.items = []
        for path in sorted(WD.rglob("*.json")):
            if path.name in ("nations.json", "mesh_bounds.json", "kit_modules.json", "nation_routes.json",
                             "practical_lights.json") or path.name in mine:
                continue
            try:
                spec = json.loads(path.read_text(encoding="utf-8"))
            except Exception:                                                  # noqa: BLE001
                continue
            if not isinstance(spec, dict) or "batches" not in spec:
                continue
            for b in spec["batches"]:
                if not b.get("collides"):
                    continue
                leaf = (b.get("mesh") or "").split("/")[-1].split(".")[0]
                sz = size.get(leaf)
                if sz is None or float(sz[2]) < BLOCK_H:
                    continue
                for inst in b.get("instances") or []:
                    if len(inst) < 7 or float(inst[2]) < -1000.0:
                        continue
                    s = float(inst[6])
                    self.items.append((float(inst[0]), float(inst[1]), float(sz[0]) * s * 0.5,
                                       float(sz[1]) * s * 0.5, math.radians(float(inst[4]))))

    def inside(self, x, y, margin=60.0):
        for bx, by, hw, hd, yaw in self.items:
            dx, dy = x - bx, y - by
            if abs(dx) > hw + hd + margin or abs(dy) > hw + hd + margin:
                continue
            ca, sa = math.cos(-yaw), math.sin(-yaw)
            lx, ly = dx * ca - dy * sa, dx * sa + dy * ca
            if abs(lx) <= hw + margin and abs(ly) <= hd + margin:
                return True
        return False


def smooth(points, every=4):
    """Every fourth cell of the 2 m route, then the heading between neighbours -- a road, not a staircase."""
    keep = points[::every]
    if keep[-1] is not points[-1]:
        keep.append(points[-1])
    out = []
    for i, p in enumerate(keep):
        a = keep[max(0, i - 1)]
        b = keep[min(len(keep) - 1, i + 1)]
        heading = math.degrees(math.atan2(b["y"] - a["y"], b["x"] - a["x"]))
        out.append((p["x"], p["y"], p["floor"], heading))
    return out


def build(pass_id, cfg, occ):
    nation = cfg["nation"]
    route = ROUTES.get(nation)
    if not route:
        print("%s: no route for %s in nation_routes.json -- nothing built" % (pass_id, nation))
        return 0
    mod = __import__(cfg["module"])
    mats, accent = dict(mod.PART_MATERIAL), getattr(mod, "LUMINOUS", None)
    skip = getattr(mod, "SKIP_PARTS", ("veg_anchor",))
    rng = random.Random(pass_id)
    batches, stats = {}, Counter()

    def add(key, mesh, material, x, y, z, yaw, scale=1.0, cull=CULL_NEAR, collides=False):
        bt = batches.setdefault((key, mesh, material),
                                {"id": "%s_%s" % (pass_id, key), "mesh": mesh, "material": material,
                                 "instances": [], "collides": collides, "cast_shadow": True,
                                 "affect_df": False, "cull_distance": cull})
        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                                round(scale, 3), round(scale, 3), round(scale, 3)])
        stats[key] += 1

    def add_module(name, x, y, z, yaw, cull=CULL_NEAR, collide=True, glow=()):
        for part in KIT[name]["parts"]:
            if part["part"] in skip:
                continue
            material = accent if (accent and part["part"] in glow) else mats.get(part["part"], part["material"])
            add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], material, x, y, z, yaw,
                cull=cull, collides=collide and part["part"] not in nations.NO_COLLIDE_PARTS)

    shapes = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
    pts = smooth(route["points"])
    along = 0.0
    last_kerb, last_lamp, lamp_side = -1e9, -1e9, 1.0
    for i, (x, y, floor, heading) in enumerate(pts):
        if i > 0:
            along += math.hypot(x - pts[i - 1][0], y - pts[i - 1][1])
        h = math.radians(heading)
        lx, ly = -math.sin(h), math.cos(h)          # left of travel
        for k, off in enumerate(LANES):
            fx, fy = x + lx * off, y + ly * off
            if occ.inside(fx, fy):
                stats["refused_paving_in_building"] += 1
                continue
            # PAVING DOES NOT COLLIDE: the floor the search measured already does, and a 6 cm colliding lip
            # on the walking surface is a trip edge (the checkpoints' lesson).
            add_module(shapes[(i + k) % 3], fx, fy, floor, heading, cull=CULL_MID, collide=False)
        if along - last_kerb >= KERB_EVERY:
            last_kerb = along
            for side in (-1.0, 1.0):
                kx, ky = x + lx * side * EDGE, y + ly * side * EDGE
                if occ.inside(kx, ky):
                    stats["refused_kerb_in_building"] += 1
                    continue
                add_module("WL_Ground_Kerb_Run", kx, ky, floor, heading, cull=CULL_MID, collide=False)
        if along - last_lamp >= LAMP_EVERY:
            last_lamp = along
            lamp_side = -lamp_side
            px, py = x + lx * lamp_side * LAMP_OFF, y + ly * lamp_side * LAMP_OFF
            if occ.inside(px, py, margin=200.0):
                stats["refused_lamp_in_building"] += 1
            else:
                add_module("WL_Object_LanternStandard", px, py, floor, heading + 90.0 * lamp_side,
                           cull=CULL_MID, glow=("glass",))

    out = {
        "pass": pass_id,
        "folder": "Wonderland/Authored/%s_%sAvenue" % (pass_id, nation.title()),
        "tags": ["WL_AUTHORED", "WL_PASS_%s" % pass_id, nations.tag(nation), "WL_NATION_AVENUE"],
        "actors": [],
        "batches": list(batches.values()),
        "route_source": "nation_routes.json %s, %d points, %.0f m" % (nation, len(route["points"]), along / 100.0),
    }
    (HERE / cfg["out"]).write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in out["batches"])
    coll = sum(len(b["instances"]) for b in out["batches"] if b["collides"])
    print("%s  %-9s %5d instances / %3d batches / %3d colliding / %.0f m of road -> %s"
          % (pass_id, nation, total, len(out["batches"]), coll, along / 100.0, cfg["out"]))
    for key in sorted(stats):
        if key.startswith("refused_") or key.startswith("Object_LanternStandard"):
            print("      %-34s %d" % (key, stats[key]))
    return total


def main():
    occ = Occupancy()
    print("occupancy: %d colliding structures over 2 m" % len(occ.items))
    grand = sum(build(pid, cfg, occ) for pid, cfg in sorted(PASSES.items()))
    print("\nTHREE NATION AVENUES: %d instances. Deliberate and visible; the walk proof still has to be run." % grand)


if __name__ == "__main__":
    main()
