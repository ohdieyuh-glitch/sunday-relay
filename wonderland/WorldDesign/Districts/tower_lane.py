#!/usr/bin/env python3
"""TW02 -- THE TOWER LANE: Tower Rise's identity carried through its pocket, and a way to it.

    python WorldDesign/Districts/tower_lane.py        (writes tw02_tower_lane.json)

WHY (2026-09-29, CORE, founder: "Tower identity can propagate naturally around TW01 Tower Rise ... Do not clone the
same district repeatedly"). TW01 stands at 111 deg 478 m in a 3.25 ha pocket that the emptiness classes still call
UNINTENDED (298-618 m), and nothing leads to it: its gate faces the city across lawn.
WHAT (additive; nothing through anything standing -- forge_districts.Site over the post-window-1 census):
  THE LANE   stepping stones (the heartland recipe) on a grid-searched way from the core's paving near 300 m on
             this bearing to TW01's gate, and from the gate round TW01's wall to the march ring's nearest plate --
             so the tower court is reachable from the city and from the ring. A pair of clipped cones marks it
             every ~18 m where both sides are clear.
  THE GROUPS up to three small tower groups in the rest of the pocket, each a falling trio of capped towers in its
             own roof palette (so the lane reads as a neighbourhood that grew, not TW01 copied), with a ring of
             topiary at its feet. At least 50 m from TW01 and 45 m from each other, 12 m clear of the lane.
"""
import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(WD / "Rings"))
import forge_districts as FD                                              # noqa: E402
import ring_roads as RR                                                   # noqa: E402
from hedge_gates import bfs, load as walk_load                           # noqa: E402

PASS = "TW02"
BEARING, INNER_M, OUTER_M = 111.0, 300.0, 620.0
TW01_C = (-17075.0, 44745.0)
TW01_WALL = 3400.0
FLAGS = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
PALETTES = (("MI_V2_RoofBlue", "MI_V2_RoofLilac", "MI_V2_RoofNavy"),
            ("MI_V2_RoofRose", "MI_V2_RoofPink", "MI_V2_RoofRose"),
            ("MI_V2_RoofNavy", "MI_V2_RoofBlue", "MI_V2_RoofLilac"))


def main():
    rng = random.Random(2002)
    cx, cy = FD.polar(BEARING, 460.0)
    site = FD.Site(cx, cy, 22000.0)
    spec = FD.Spec(PASS, "Wonderland/Authored/TW02_TowerLane", ["WL_DISTRICT", "WL_DISTRICT_TOWER_RISE"])
    # --- the lane's three anchors
    ix, iy = FD.polar(BEARING, INNER_M)
    # the core's paving nearest 300 m on this bearing; the nearest few are tried in turn below, since the very
    # nearest can sit inside a hedged court with no way out toward the tower
    inners = sorted(((s[0], s[1]) for s in site.surf if 24000.0 <= math.hypot(s[0], s[1]) <= 36000.0),
                    key=lambda p: math.hypot(p[0] - ix, p[1] - iy))
    inner = inners[0]
    toward = math.atan2(-TW01_C[1], -TW01_C[0])
    gate_out = (TW01_C[0] + math.cos(toward) * (TW01_WALL + 600.0), TW01_C[1] + math.sin(toward) * (TW01_WALL + 600.0))
    gate_in = (TW01_C[0] + math.cos(toward) * (TW01_WALL - 900.0), TW01_C[1] + math.sin(toward) * (TW01_WALL - 900.0))
    rr01 = [(i[0], i[1]) for bt in json.loads((WD / "Rings" / "rr01_march_ring.json").read_text(encoding="utf-8"))["batches"]
            if "_Plate_" in bt["id"] for i in bt["instances"]]
    ox, oy = FD.polar(BEARING, OUTER_M)
    ring = min(rr01, key=lambda p: math.hypot(p[0] - ox, p[1] - oy))
    legs = [("core->gate", inner, gate_out), ("gate->court", gate_out, gate_in), ("gate->ring", gate_out, ring)]
    # THE WALK OCCUPANCY, not the placement one: Site counts every flower bed and a trunk's whole 5 m mesh box as
    # standing (right for where a tower may go, wrong for where a walker can); hedge_gates.load treats flowers and
    # small mushrooms as soft and trunks at 0.8 m -- with its hedges put back, since here they are walls
    hedges, walk_occ = walk_load(15000.0, 80000.0)
    for h in hedges:
        walk_occ.add("existing", h["x"], h["y"], h["ex"], h["ey"], h["yaw"], h["owner"])
    for bt in json.loads((HERE / "tw01_tower_rise.json").read_text(encoding="utf-8"))["batches"]:
        if bt["collides"]:
            for i in bt["instances"]:
                walk_occ.add("existing", i[0], i[1], 280.0 * i[6], 280.0 * i[6], i[4], "TW01")
    lane = []
    for name, a, b in legs:
        way = bfs(walk_occ, a, b, box=20000.0, half=60.0)
        if not way and name == "core->gate":
            for cand in inners[1:40:3]:
                way = bfs(walk_occ, cand, b, box=20000.0, half=60.0)
                if way:
                    spec.stats["inner_candidate_used"] = inners.index(cand)
                    break
        if not way:
            spec.stats["leg_no_way_" + name] += 1
            print("   leg %s: NO WAY" % name)
            continue
        L = sum(math.hypot(way[i][0] - way[i - 1][0], way[i][1] - way[i - 1][1]) for i in range(1, len(way))) / 100.0
        print("   leg %s: %.0f m" % (name, L))
        lane.append(way)
    k = 0
    for way in lane:
        last, last_pair, along = None, None, 0.0
        for q, (x, y) in enumerate(way):
            if last is not None:
                along += math.hypot(x - last[0], y - last[1])
            if last is None or math.hypot(x - last_st[0], y - last_st[1]) >= 450.0:
                name = FLAGS[k % 3]
                for part in RR.KIT[name]["parts"]:
                    if part["part"] != "veg_anchor":
                        _add_path(spec, name, part, x, y, rng)
                last_st = (x, y)
                k += 1
                spec.stats["stone"] += 1
            # the lane's cones, a pair every ~18 m where both sides stand clear
            if q + 2 < len(way) and (last_pair is None or along - last_pair >= 1800.0):
                (x1, y1) = way[q + 2]
                h = math.atan2(y1 - y, x1 - x)
                lx, ly = -math.sin(h), math.cos(h)
                spots = [(x + lx * s * 260.0, y + ly * s * 260.0) for s in (-1.0, 1.0)]
                if all(not site.occ.hits(px, py, 90.0, 90.0, 0.0, 30.0, ("existing",)) for px, py in spots):
                    for (px, py) in spots:
                        spec.add("LaneCone", "SM_topiary_cone_plain", "MI_V2_LeafDark", px, py, site.ground(px, py),
                                 0.0, 0.8, collides=False, cull=26000.0)
                        site.occ.add("existing", px, py, 90.0, 90.0, 0.0, "TW02:cone")
                    spec.stats["cone_pair"] += 1
                    last_pair = along
            last = (x, y)
    lane_pts = [p for way in lane for p in way[::5]]
    # --- the groups
    groups = []
    for r_m in range(310, 615, 10):
        for db in [d * 0.5 for d in range(-14, 15)]:
            gx, gy = FD.polar(BEARING + db, float(r_m))
            if math.hypot(gx - TW01_C[0], gy - TW01_C[1]) < 5000.0:
                continue
            if any(math.hypot(gx - a, gy - b) < 4500.0 for a, b in groups):
                continue
            if any(math.hypot(gx - a, gy - b) < 1200.0 for a, b in lane_pts):
                continue
            # OPEN LAWN ONLY, with room: a group on a paved court would stand in someone's way (the first cut put
            # two of three on the rim's courts); 15 m clear of anything standing or paved
            if site.ground(gx, gy) > FD.LAWN + 1.0:
                continue
            if site.occ.hits(gx, gy, 1500.0, 1500.0, 0.0, 0.0, ("existing", "paved")):
                continue
            groups.append((gx, gy))
            if len(groups) == 3:
                break
        if len(groups) == 3:
            break
    for gi, (gx, gy) in enumerate(groups):
        pal = PALETTES[gi % len(PALETTES)]
        plan = ((0, 0, 1.0), (620, 380, 0.78), (-540, 460, 0.86))
        t = math.atan2(gy, gx)
        c, s = math.cos(t), math.sin(t)
        placed = 0
        for ti, (dx, dy, hh) in enumerate(plan):
            px, py = gx + dx * c - dy * s, gy + dx * s + dy * c
            spot = site.find(px, py, 190.0 * hh + 60.0, over=210.0 * hh, margin=120.0, reach=300.0)
            if not spot:
                spec.stats["tower_no_room"] += 1
                continue
            x, y = spot
            z = site.ground(x, y)
            yaw = rng.uniform(0.0, 360.0)
            spec.add("Tower", "SM_tower_capped", "MI_V2_IvoryStone", x, y, z, yaw, hh, collides=True, cull=60000.0)
            spec.add("TowerCap", "SM_roof_cone_steep", pal[ti], x, y, z + 1100.0 * hh, yaw, hh, cull=60000.0)
            spec.add("TowerSpire", "SM_finial_spire", "MI_V2_Gold", x, y, z + 1560.0 * hh, yaw, 0.7 * hh, cull=60000.0)
            site.occ.add("existing", x, y, 190.0 * hh, 190.0 * hh, 0.0, "TW02:tower")
            site.occ.add("solid", x, y, 210.0 * hh, 210.0 * hh, 0.0, "TW02:tower")
            placed += 1
            spec.stats["tower"] += 1
        for j in range(6):
            a = 2 * math.pi * j / 6 + 0.3
            spot = site.find(gx + math.cos(a) * 900.0, gy + math.sin(a) * 900.0, 120.0, margin=50.0, reach=250.0)
            if spot:
                mesh, mat = (("SM_topiary_ball", "MI_V2_LeafMid"), ("SM_topiary_spiral", "MI_V2_LeafDark"))[j % 2]
                spec.add("GroupTopiary", mesh, mat, spot[0], spot[1], site.ground(*spot), 30.0 * j, 0.85, cull=26000.0)
                site.occ.add("existing", spot[0], spot[1], 120.0, 120.0, 0.0, "TW02:topiary")
                spec.stats["topiary"] += 1
        spec.stats["group"] += 1 if placed else 0
    out = spec.out("Tower Lane: a way from the core through Tower Rise's gate to the march ring, and three small tower groups")
    (HERE / "tw02_tower_lane.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("%s: %d instances in %d batches; %s" % (PASS, sum(len(b["instances"]) for b in out["batches"]),
                                                 len(out["batches"]), dict(spec.stats)))


def _add_path(spec, name, part, x, y, rng):
    """kit parts carry full asset paths; FD.Spec.add wants a mesh_bounds name, so add the batch directly"""
    tkey = "%s_%s_t%d_%d" % (name.replace("WL_", ""), part["part"], math.floor(x / FD.TILE), math.floor(y / FD.TILE))
    bt = spec.batches.setdefault((tkey, part["material"]), {
        "id": "%s_%s_%s" % (spec.id, tkey, part["material"].replace("MI_V2_", "")), "mesh": part["mesh"],
        "material": part["material"], "instances": [], "collides": False, "cast_shadow": True, "affect_df": False,
        "cull_distance": 26000.0})
    bt["instances"].append([round(x, 1), round(y, 1), -13.0, 0.0, round(rng.uniform(0.0, 360.0), 1), 0.0, 0.55, 0.55, 0.55])


if __name__ == "__main__":
    main()
