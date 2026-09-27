#!/usr/bin/env python3
"""IS THERE ANY WALKABLE ROUTE FROM EACH NATION'S GATE TO ITS BAND? Asked as a search, not as nine lines.

THE FOUNDER'S RULING (QA-8, relayed 2026-09-27). `zc_nation_routes` R_ALL measures **clean_lanes 0 of 9 in
ICARUS, NOCTIS and TARTARUS**: a player cannot walk gate-to-band in any nation. Acceptance is that every
canonical gate-to-band route has at least one deliberate, visually coherent, physically traversable path,
proven by actual movement. Forbidden: raising the Dog's step height to climb 2-4 m architecture, disabling
collision, or cutting arbitrary holes through working buildings. Where a lane was never meant to be
traversable, the ROUTE DEFINITION is what is wrong, not the world.

WHY THAT RULING NEEDS THIS TOOL FIRST. `zc_nation_routes` sweeps NINE PARALLEL STRAIGHT LANES at 16 m
spacing. A district full of buildings blocks most straight lines -- that is what a district is -- so "no
clean straight lane" and "no walkable route" are different claims, and only the first has been measured. A
person walking a city goes round things. Before any geometry is changed, the question has to be asked the way
a walker asks it: **is there a connected path at all, allowed to weave?**

So this builds the corridor as an occupancy grid from the specs and runs a search across it:

  THE FLOOR per cell is the highest colliding surface within 250 cm of the ground shelf -- a terrace, plate
  or yard band you could be standing on -- else the shelf itself (z=12 inside 850 m, -14 beyond, both traced
  in PIE).
  AN OBSTACLE is a colliding instance covering the cell whose top rises more than the Dog's real
  max_step_height (30 uu, read off the character, not the 45 that gets quoted) above that floor, and whose
  bottom is low enough to be in the body's way at all.
  A MOVE between neighbouring cells is allowed only if both are unobstructed AND their floors differ by no
  more than the step height -- so a search cannot stroll up a 221 uu terrace the way a straight-line sweep
  cannot.

WHAT THE ANSWER MEANS, EITHER WAY. If a weaving path exists, the world is traversable and zc_nation_routes is
measuring the wrong thing -- the route definition should follow the path the district was designed around, and
that is a fix to the ROUTE, exactly as the ruling allows. If no path exists, the corridor is genuinely sealed
and this names the structures that seal it, which is where a deliberate opening -- steps, a ramp, an arch,
a realigned avenue -- has to go.

    python Tools/audit_nation_corridor.py                # all three nations
    python Tools/audit_nation_corridor.py --map ICARUS    # and print the corridor
"""
import argparse
import collections
import heapq
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WD = ROOT / "WorldDesign"
KIT = json.loads((WD / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
INVENTORY = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/mesh_inventory.json")
SKIP_FILES = ("nations.json", "mesh_bounds.json", "kit_modules.json")

NATIONS = (("ICARUS", 90.0), ("NOCTIS", 210.0), ("TARTARUS", 330.0))
FROM_UU, TO_UU = 60000.0, 106000.0     # the gate and the band's near edge, as zc_nation_routes defines them
HALF_V = 9000.0                        # +/-90 m across, a little wider than the proof's +/-64
CELL = 200.0                           # 2 m, comfortably finer than the Dog's 0.72 m capsule
STEP = 30.0                            # the Dog's real max_step_height, read from the character in PIE
BODY = 174.0                           # capsule full height: what an obstacle has to be in the way of
PLATE_TOL = 250.0                      # how far above the shelf a surface can be and still be a floor
SUNK_BELOW = -1000.0


def shelf(x, y):
    return 12.0 if math.hypot(x, y) < 85000.0 else -14.0


def sizes():
    out = {}
    if INVENTORY.exists():
        for rec in json.loads(INVENTORY.read_text(encoding="utf-8")):
            out[rec["name"]] = rec["size_cm"]
    for mod in KIT.values():
        for part in mod["parts"]:
            out.setdefault(part["mesh"].split("/")[-1].split(".")[0], mod["size"])
    return out


def colliding():
    """Every colliding instance on disk, as (x, y, z, top, hw, hd, yaw_rad, pass, batch, mesh)."""
    size = sizes()
    out = []
    for path in sorted(WD.rglob("*.json")):
        if path.name in SKIP_FILES:
            continue
        try:
            spec = json.loads(path.read_text(encoding="utf-8"))
        except Exception:                                                     # noqa: BLE001
            continue
        if not isinstance(spec, dict) or "batches" not in spec:
            continue
        pid = spec.get("pass", path.stem)
        for b in spec["batches"]:
            if not b.get("collides"):
                continue
            mesh = (b.get("mesh") or "").split("/")[-1].split(".")[0]
            sz = size.get(mesh)
            if sz is None:
                continue
            for inst in b.get("instances") or []:
                if len(inst) < 7 or float(inst[2]) <= SUNK_BELOW:
                    continue
                s = float(inst[6])
                out.append((float(inst[0]), float(inst[1]), float(inst[2]),
                            float(inst[2]) + float(sz[2]) * s,
                            float(sz[0]) * s * 0.5, float(sz[1]) * s * 0.5,
                            math.radians(float(inst[4])), pid, b.get("id", "?"), mesh))
    return out


def build(nation, bearing, boxes):
    rad = math.radians(bearing)
    fwd = (math.cos(rad), math.sin(rad))
    left = (-math.sin(rad), math.cos(rad))
    nu = int((TO_UU - FROM_UU) / CELL) + 1
    nv = int(2 * HALF_V / CELL) + 1

    # Bin the boxes by world cell so each grid point tests only its neighbourhood.
    BIN = 2000.0
    bins = collections.defaultdict(list)
    for box in boxes:
        x, y = box[0], box[1]
        reach = math.hypot(box[4], box[5])
        for gx in range(int((x - reach) // BIN), int((x + reach) // BIN) + 1):
            for gy in range(int((y - reach) // BIN), int((y + reach) // BIN) + 1):
                bins[(gx, gy)].append(box)

    floor = [[0.0] * nv for _ in range(nu)]
    blocked = [[None] * nv for _ in range(nu)]
    for iu in range(nu):
        u = FROM_UU + iu * CELL
        for iv in range(nv):
            v = -HALF_V + iv * CELL
            x = fwd[0] * u + left[0] * v
            y = fwd[1] * u + left[1] * v
            g = shelf(x, y)
            here = []
            for box in bins.get((int(x // BIN), int(y // BIN)), ()):
                bx, by, bz, btop, hw, hd, yaw, pid, bid, mesh = box
                dx, dy = x - bx, y - by
                ca, sa = math.cos(-yaw), math.sin(-yaw)
                lx, ly = dx * ca - dy * sa, dx * sa + dy * ca
                if abs(lx) <= hw and abs(ly) <= hd:
                    here.append(box)
            # the surface you would be standing on
            f = g
            for box in here:
                if g - PLATE_TOL <= box[3] <= g + PLATE_TOL and box[3] > f:
                    f = box[3]
            floor[iu][iv] = f
            for box in here:
                if box[3] > f + STEP and box[2] < f + BODY:
                    blocked[iu][iv] = "%s_%s" % (box[7], box[9])
                    break
    return floor, blocked, nu, nv


def search(floor, blocked, nu, nv):
    """Cheapest weaving path from any cell at u=FROM to any cell at u=TO, obeying the step rule."""
    INF = float("inf")
    dist = [[INF] * nv for _ in range(nu)]
    prev = {}
    heap = []
    for iv in range(nv):
        if blocked[0][iv] is None:
            dist[0][iv] = 0.0
            heapq.heappush(heap, (0.0, 0, iv))
    while heap:
        d, iu, iv = heapq.heappop(heap)
        if d > dist[iu][iv]:
            continue
        if iu == nu - 1:
            path = [(iu, iv)]
            while (iu, iv) in prev:
                iu, iv = prev[(iu, iv)]
                path.append((iu, iv))
            return d, list(reversed(path))
        for du, dv in ((1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 0), (-1, 1), (-1, -1)):
            ju, jv = iu + du, iv + dv
            if not (0 <= ju < nu and 0 <= jv < nv) or blocked[ju][jv] is not None:
                continue
            if abs(floor[ju][jv] - floor[iu][iv]) > STEP:
                continue
            # prefer going outward and staying near the axis, so the route found is a plausible one
            cost = d + (1.0 if du > 0 else (1.6 if du == 0 else 3.0)) + abs(jv - (nv // 2)) * 0.004
            if cost < dist[ju][jv]:
                dist[ju][jv] = cost
                prev[(ju, jv)] = (iu, iv)
                heapq.heappush(heap, (cost, ju, jv))
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", metavar="NATION")
    args = ap.parse_args()
    boxes = colliding()
    print("colliding instances on disk: %d" % len(boxes))
    print("corridor %.0f-%.0f m, +/-%.0f m across, %.0f cm cells, step %.0f uu, body %.0f uu\n"
          % (FROM_UU / 100, TO_UU / 100, HALF_V / 100, CELL, STEP, BODY))
    verdicts = {}
    for nation, bearing in NATIONS:
        floor, blocked, nu, nv = build(nation, bearing, boxes)
        total = nu * nv
        nblocked = sum(1 for r in blocked for c in r if c is not None)
        cost, path = search(floor, blocked, nu, nv)
        culprits = collections.Counter(c for r in blocked for c in r if c is not None)
        print("=" * 96)
        print("%s  bearing %.0f   corridor cells %d, blocked %d (%.1f%%)"
              % (nation, bearing, total, nblocked, 100.0 * nblocked / total))
        print("  what occupies it: %s"
              % ", ".join("%s x%d" % kv for kv in culprits.most_common(6)))
        if path is None:
            verdicts[nation] = "SEALED"
            # Where does the frontier of reachability stop?
            reach = 0
            for iu in range(nu):
                if any(blocked[iu][iv] is None for iv in range(nv)):
                    reach = iu
            print("  NO WALKABLE PATH even allowing a weave across %.0f m. Deepest row with any free cell:"
                  % (2 * HALF_V / 100))
            print("    u = %.0f m" % ((FROM_UU + reach * CELL) / 100))
        else:
            offs = [(iv - nv // 2) * CELL / 100.0 for _, iv in path]
            verdicts[nation] = "WALKABLE BY WEAVING"
            print("  A WALKABLE PATH EXISTS, weaving between %.0f m and %.0f m off the axis (%d cells)."
                  % (min(offs), max(offs), len(path)))
            marks = [(FROM_UU + iu * CELL) / 100.0 for iu, _ in path]
            samples = [(round(marks[i]), round(offs[i], 1)) for i in range(0, len(path), max(1, len(path) // 10))]
            print("    route (radius m, offset m): %s"
                  % ", ".join("%d@%+.0f" % s for s in samples))
            print("    floors along it: %.0f..%.0f uu"
                  % (min(floor[iu][iv] for iu, iv in path), max(floor[iu][iv] for iu, iv in path)))
        if args.map and args.map.upper() == nation:
            print("\n  corridor map -- '.' walkable, '#' blocked, '+' the route; axis marked |")
            onpath = set(path or ())
            for iu in range(nu - 1, -1, -4):
                row = "".join("+" if (iu, iv) in onpath else ("#" if blocked[iu][iv] else ".")
                              for iv in range(nv))
                print("   %6.0fm %s" % ((FROM_UU + iu * CELL) / 100, row))
        print()
    print("=" * 96)
    for nation, v in verdicts.items():
        print("  %-9s %s" % (nation, v))
    print()
    print("A 'WALKABLE BY WEAVING' verdict does NOT close the founder's item on its own: it says the world is")
    print("connected and the nine-straight-lane gate is measuring something the world was never built to")
    print("satisfy. It still has to be proven by ACTUAL MOVEMENT along the route the search found, which is")
    print("what the ruling asks for and what a grid cannot supply.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
