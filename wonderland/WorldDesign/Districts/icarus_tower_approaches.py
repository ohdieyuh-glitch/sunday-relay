#!/usr/bin/env python3
"""TW03 -- THE ICARUS TOWER APPROACHES: tower hamlets on the unintended ground of the 100-135 deg band.

    python WorldDesign/Districts/icarus_tower_approaches.py        (writes tw03_icarus_tower_approaches.json)

WHY (2026-09-29, CORE; founder: "Tower identity can propagate naturally around TW01 Tower Rise, Icarus / tower
approaches, suitable frontier silhouettes ... Do not clone the same district repeatedly"). After window 3 the
emptiness classes (Tools/world_audit/emptiness_classes.py) still call four pockets of the ICARUS march / heartland
UNINTENDED: 101 deg 424-618 m, 105 deg 658-791 m, 114 deg 827-998 m, 132 deg 744-1,054 m, plus the band's frontier
up to 1,200 m. SECOND's S3 leaves 100-135 deg inside 1,200 m to CORE.
WHAT, per unintended pocket of the band (4-connected cells of class UNINTENDED, >= 0.4 ha):
  * a HAMLET at the pocket's deepest point (the cell furthest from anything built): one KIT-STACKED tower (the
    skyline kit's own socket grammar, kitstack.py: foot -> bodies -> terminator, 18-32 m, IVORY -- Icarus is the
    white nation -- so it reads as Tower Rise's family, not its copy), two capped attendant towers with blue / lilac
    cones and gold finials, and, where the pocket is deep enough, a walled court (garden wall ring, gold-finialled
    gate piers) opening toward the nearest way;
  * GROVES of the Icarus palette (slender trunks, medium canopies in LeafMid / LeafDark / PetalWhite): clumps of 4-6
    trees round centres ~28 m apart over the rest of the pocket, so the hamlet stands in a landscape, not an orchard;
  * a WALK of stepping stones from the court's gate to the nearest existing paving (grid search on the walk
    occupancy: flowers and small mushrooms soft, trunks 0.8 m, hedges solid), so no hamlet is a cul-de-sac.
Everything is placed only where it clears what stands (forge_districts.Site), tiled to 200 m, towers and walls
colliding by the nations' NO_COLLIDE_PARTS rule (the nested-collision gate), 600 m cull on towers, 260 m on the rest.
"""
import json
import math
import random
import sys
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
ROOT = WD.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(WD / "Rings"))
sys.path.insert(0, str(WD / "Skyline"))
sys.path.insert(0, str(WD / "Nations"))
sys.path.insert(0, str(ROOT / "Tools" / "world_audit"))
import forge_districts as FD                                              # noqa: E402
import kitstack as KS                                                     # noqa: E402
import nations                                                            # noqa: E402
import ring_roads as RR                                                   # noqa: E402
import emptiness_classes as EC                                            # noqa: E402
from hedge_gates import bfs, load as walk_load                            # noqa: E402

PASS = "TW03"
B_LO, B_HI, R_LO, R_HI = 100.0, 135.0, 38000.0, 120000.0
MIN_CELLS = 160                      # 0.4 ha of 5 m cells
FLAGS = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
ROOFS = ("MI_V2_RoofBlue", "MI_V2_RoofLilac", "MI_V2_RoofNavy")
LEAVES = ("MI_V2_LeafMid", "MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_PetalWhite")


def pockets():
    g = EC.classify()
    n, x0, C, cls = g["n"], g["x0"], g["C"], g["cls"]
    def xy(k):
        j, i = divmod(k, n)
        return x0 + (i + 0.5) * C, x0 + (j + 0.5) * C
    inband = bytearray(n * n)
    for k in range(n * n):
        if cls[k] == 1:
            x, y = xy(k)
            b = math.degrees(math.atan2(y, x)) % 360.0
            if B_LO <= b <= B_HI and R_LO <= math.hypot(x, y) <= R_HI:
                inband[k] = 1
    seen = bytearray(n * n)
    out = []
    for s in range(n * n):
        if not inband[s] or seen[s]:
            continue
        q, cells = deque([s]), []
        seen[s] = 1
        while q:
            k = q.popleft()
            cells.append(k)
            j, i = divmod(k, n)
            for dj, di in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                jj, ii = j + dj, i + di
                kk = jj * n + ii
                if 0 <= jj < n and 0 <= ii < n and inband[kk] and not seen[kk]:
                    seen[kk] = 1
                    q.append(kk)
        if len(cells) < MIN_CELLS:
            continue
        # depth: BFS from the pocket's boundary cells inward
        cset = set(cells)
        depth, q = {}, deque()
        for k in cells:
            j, i = divmod(k, n)
            if any((jj * n + ii) not in cset for jj, ii in ((j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1))):
                depth[k] = 0
                q.append(k)
        while q:
            k = q.popleft()
            j, i = divmod(k, n)
            for jj, ii in ((j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1)):
                kk = jj * n + ii
                if kk in cset and kk not in depth:
                    depth[kk] = depth[k] + 1
                    q.append(kk)
        core = max(cells, key=lambda k: depth[k])
        out.append({"cells": [xy(k) for k in cells], "centre": xy(core), "depth_m": depth[core] * C / 100.0,
                    "area_m2": len(cells) * (C / 100.0) ** 2})
    return sorted(out, key=lambda p: -p["area_m2"])


def add_part(spec, key, mesh, material, x, y, z, yaw, s, collides, cull):
    tkey = "%s_t%d_%d" % (key, math.floor(x / FD.TILE), math.floor(y / FD.TILE))
    bt = spec.batches.setdefault((tkey, material), {
        "id": "%s_%s_%s" % (spec.id, tkey, material.replace("MI_V2_", "")), "mesh": mesh, "material": material,
        "instances": [], "collides": collides, "cast_shadow": True, "affect_df": collides, "cull_distance": cull})
    bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0,
                            round(s, 3), round(s, 3), round(s, 3)])


def kit_tower(spec, site, x, y, room, rng):
    """The tallest-but-not-skyline stack that fits: 18-32 m, footprint inside `room`."""
    options = [(st, h) for st, h in KS.spellings(max_bodies=2)
               if 1800.0 <= h <= 3200.0 and KS.footprint(st) * 1.1 <= room]
    if not options:
        return None
    stack, height = options[rng.randrange(len(options))]
    foot = KS.footprint(stack)
    spot = site.find(x, y, foot + 60.0, over=foot + 80.0, margin=120.0, reach=600.0)
    if not spot:
        return None
    px, py = spot
    z0 = site.ground(px, py)
    yaw = rng.uniform(0.0, 360.0)
    for name, z in KS.storeys(stack):
        for part in KS.MODULES[name]["parts"]:
            if part["part"] == "veg_anchor":
                continue
            add_part(spec, "Kit_%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], part["material"],
                     px, py, z0 + z, yaw, 1.0, part["part"] not in nations.NO_COLLIDE_PARTS, 60000.0)
    site.occ.add("existing", px, py, foot, foot, 0.0, "TW03:kit")
    site.occ.add("solid", px, py, foot + 60.0, foot + 60.0, 0.0, "TW03:kit")
    spec.stats["kit_tower"] += 1
    spec.stats["kit_tower_height_m_total"] += int(height / 100)
    return px, py, foot


def capped(spec, site, x, y, h, roof, rng):
    spot = site.find(x, y, 190.0 * h + 60.0, over=210.0 * h, margin=120.0, reach=600.0)
    if not spot:
        spec.stats["attendant_no_room"] += 1
        return None
    px, py = spot
    z = site.ground(px, py)
    yaw = rng.uniform(0.0, 360.0)
    spec.add("Tower", "SM_tower_capped", "MI_V2_IvoryStone", px, py, z, yaw, h, collides=True, cull=60000.0)
    spec.add("TowerCap", "SM_roof_cone_steep", roof, px, py, z + 1100.0 * h, yaw, h, cull=60000.0)
    spec.add("TowerSpire", "SM_finial_spire", "MI_V2_Gold", px, py, z + 1560.0 * h, yaw, 0.7 * h, cull=60000.0)
    site.occ.add("existing", px, py, 190.0 * h, 190.0 * h, 0.0, "TW03:tower")
    site.occ.add("solid", px, py, 210.0 * h, 210.0 * h, 0.0, "TW03:tower")
    spec.stats["attendant"] += 1
    return px, py


def main():
    rng = random.Random(3003)
    pk = pockets()
    print("pockets in %g-%g deg, %d-%d m: %s" % (B_LO, B_HI, R_LO / 100, R_HI / 100,
          [(round(p["area_m2"]), round(p["depth_m"]), round(math.degrees(math.atan2(p["centre"][1], p["centre"][0])) % 360),
            round(math.hypot(*p["centre"]) / 100)) for p in pk]))
    cx, cy = FD.polar(117.0, 800.0)
    site = FD.Site(cx, cy, 45000.0)
    hedges, walk_occ = walk_load(30000.0, 125000.0)
    for h in hedges:
        walk_occ.add("existing", h["x"], h["y"], h["ex"], h["ey"], h["yaw"], h["owner"])
    spec = FD.Spec(PASS, "Wonderland/Authored/TW03_IcarusTowerApproaches",
                   ["WL_DISTRICT", "WL_DISTRICT_TOWER_RISE", "WL_NATION_ICARUS"])
    ways = [(s_[0], s_[1]) for s_ in site.surf]
    for pi, p in enumerate(pk):
        hx, hy = p["centre"]
        depth = p["depth_m"] * 100.0
        toward = min(ways, key=lambda w: math.hypot(w[0] - hx, w[1] - hy)) if ways else (0.0, 0.0)
        face = math.atan2(toward[1] - hy, toward[0] - hx)
        # the court, where the pocket is deep enough for one
        court_r = min(depth - 500.0, 2400.0)
        gate = None
        if court_r >= 1300.0:
            nwall = int(2 * math.pi * court_r / 520.0)
            ring = []                      # added to the occupancy only when the ring is done: segment k+1 overlaps
            for i in range(nwall):         # segment k by design, and the first cut refused every other one (97 / 191)
                a = 2 * math.pi * i / nwall
                if abs(((a - face) + math.pi) % (2 * math.pi) - math.pi) < math.radians(20.0):
                    continue
                wx, wy = hx + court_r * math.cos(a), hy + court_r * math.sin(a)
                yaw = math.degrees(a) + 90.0
                if site.occ.hits(wx, wy, 265.0, 60.0, yaw, 40.0, ("existing",)):
                    spec.stats["wall_refused"] += 1
                    continue
                spec.add("Wall", "SM_garden_wall", "MI_V2_IvoryStone", wx, wy, site.ground(wx, wy), yaw, 1.0,
                         collides=True, cull=26000.0)
                ring.append((wx, wy, yaw))
                spec.stats["wall"] += 1
            for (wx, wy, yaw) in ring:
                site.occ.add("existing", wx, wy, 265.0, 60.0, yaw, "TW03:wall")
                walk_occ.add("existing", wx, wy, 265.0, 60.0, yaw, "TW03:wall")
            for sd in (-1.0, 1.0):
                a = face + sd * math.radians(16.0)          # just inside the 20-degree opening, clear of the walls
                px, py = hx + court_r * math.cos(a), hy + court_r * math.sin(a)
                if not site.occ.hits(px, py, 95.0, 95.0, 0.0, 40.0, ("existing",)):
                    z = site.ground(px, py)
                    spec.add("GatePier", "SM_gate_pier", "MI_V2_IvoryStone", px, py, z, math.degrees(face), 1.0,
                             collides=True, cull=26000.0)
                    spec.add("GateFinial", "SM_gate_finial_ball", "MI_V2_Gold", px, py, z + 650.0, 0.0, 1.0, cull=26000.0)
                    site.occ.add("existing", px, py, 95.0, 95.0, 0.0, "TW03:pier")
                    walk_occ.add("existing", px, py, 95.0, 95.0, 0.0, "TW03:pier")
            gate = (hx + (court_r + 400.0) * math.cos(face), hy + (court_r + 400.0) * math.sin(face))
            spec.stats["court"] += 1
        # the towers: one kit stack at the heart, two capped attendants behind it (away from the gate)
        room = max(900.0, min(court_r if court_r > 0 else depth, 2000.0) * 0.6)
        kt = kit_tower(spec, site, hx - 300.0 * math.cos(face), hy - 300.0 * math.sin(face), room, rng)
        for k, (off, h) in enumerate(((50.0, 0.9), (-50.0, 0.78))):
            a = face + math.pi + math.radians(off)
            ring_r = 1500.0 if court_r >= 1300.0 else 1200.0    # clear of the kit tower's foot, inside the court wall
            capped(spec, site, hx + ring_r * math.cos(a), hy + ring_r * math.sin(a), h, ROOFS[(pi + k) % 3], rng)
        # GROVES, not a lattice: grove centres ~28 m apart over the rest of the pocket, 4-6 trees gathered round
        # each (the first cut spaced single trees 12 m apart and the plan read as an orchard grid)
        taken, centres = [], []
        cells = p["cells"][:]
        rng.shuffle(cells)
        keep_out = (court_r if court_r > 0 else 1200.0) + 900.0
        for (x, y) in cells:
            if math.hypot(x - hx, y - hy) < keep_out or any(math.hypot(x - a, y - b) < 2800.0 for a, b in centres):
                continue
            centres.append((x, y))
            for t in range(rng.randint(4, 6)):
                a, d = rng.uniform(0.0, 2 * math.pi), rng.uniform(250.0, 950.0)
                spot = site.find(x + d * math.cos(a), y + d * math.sin(a), 150.0, over=380.0, margin=40.0, reach=250.0)
                if not spot:
                    continue
                tx, ty = spot
                s_ = rng.uniform(0.85, 1.15)
                spec.add("Trunk", "SM_tree_slender_trunk", "MI_V2_Bark", tx, ty, site.ground(tx, ty), rng.uniform(0, 360),
                         s_, collides=True, cull=60000.0)
                spec.add("Canopy", "SM_canopy_medium", LEAVES[(len(centres) + t) % len(LEAVES)], tx, ty,
                         site.ground(tx, ty) + 760.0 * s_, rng.uniform(0, 360), s_ * rng.uniform(0.95, 1.15), cull=60000.0)
                site.occ.add("existing", tx, ty, 150.0, 150.0, 0.0, "TW03:trunk")
                site.occ.add("solid", tx, ty, 380.0, 380.0, 0.0, "TW03:canopy")
                walk_occ.add("existing", tx, ty, 80.0, 80.0, 0.0, "TW03:trunk")
                taken.append((tx, ty))
                spec.stats["tree"] += 1
        spec.stats["grove"] += len(centres)
        # the walk: gate (or hamlet edge) -> nearest paving that the walk occupancy reaches
        start = gate or (hx + 1500.0 * math.cos(face), hy + 1500.0 * math.sin(face))
        near = sorted(ways, key=lambda w: math.hypot(w[0] - start[0], w[1] - start[1]))
        way = None
        for w in near[:12:2]:
            if math.hypot(w[0] - start[0], w[1] - start[1]) > 18000.0:
                break
            way = bfs(walk_occ, start, w, box=20000.0, half=60.0)
            if way:
                break
        if way:
            last = None
            for (x, y) in way:
                if last is None or math.hypot(x - last[0], y - last[1]) >= 450.0:
                    name = FLAGS[spec.stats["stone"] % 3]
                    for part in RR.KIT[name]["parts"]:
                        if part["part"] != "veg_anchor":
                            add_part(spec, "%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"],
                                     part["material"], x, y, -13.0, rng.uniform(0.0, 360.0), 0.55, False, 26000.0)
                    spec.stats["stone"] += 1
                    last = (x, y)
            spec.stats["walk_joined"] += 1
        else:
            spec.stats["walk_not_joined"] += 1
        print("  pocket %d: %.0f m2, depth %.0f m, court r %.0f m, kit tower %s, trees %d, walk %s" % (
            pi, p["area_m2"], p["depth_m"], max(court_r, 0) / 100.0, "yes" if kt else "NO", len(taken),
            "joined" if way else "NOT joined"))
    out = spec.out("Icarus tower approaches: tower hamlets with courts, groves and walks on the band's unintended ground")
    (HERE / "tw03_icarus_tower_approaches.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print("%s: %d instances in %d batches; %s" % (PASS, sum(len(b["instances"]) for b in out["batches"]),
                                                 len(out["batches"]), dict(spec.stats)))


if __name__ == "__main__":
    main()
