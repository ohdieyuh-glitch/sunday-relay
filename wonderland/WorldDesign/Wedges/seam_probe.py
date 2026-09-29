#!/usr/bin/env python3
"""What stands on a seam? The facts a seam layout has to be built around, for any bearing.

    python seam_probe.py 150        (or 30, or 270)

For the seam radial at BEARING it reports, from the census (canopies excluded -- only trunks are solid):
  * where a 28.8 m way centred on the seam line is blocked, and by what;
  * which radii admit a clear 57.6 x 59 m crossing plaza (a ring crossing);
  * the tall existing pieces (>15 m) within 120 m of the line -- landmarks to design around, not over;
  * whether the V2 hedge ring crosses the line, and over what radii.
It exists because the 270 seam's first layout was drawn before any of this was known, and the census then
moved every place on it: the march plaza, the exchange, and a detour that a hedge ring made impossible.
"""
import csv
import gzip
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
CENSUS = HERE.parent.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
sys.path.insert(0, str(HERE))
from w270_rear_seam import Occupancy                                  # noqa: E402  the same SAT test

BEARING = float(sys.argv[1]) if len(sys.argv) > 1 else 150.0
R = math.radians(BEARING)
DIR, LEFT = (math.cos(R), math.sin(R)), (-math.sin(R), math.cos(R))


def world(u, v):
    return DIR[0] * u + LEFT[0] * v, DIR[1] * u + LEFT[1] * v


def frame(x, y):
    return x * DIR[0] + y * DIR[1], x * LEFT[0] + y * LEFT[1]


occ = Occupancy()
tall, hedges = [], []
with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        if r["kind"] == "OTHER" or "Grass_Tuft" in r["mesh"] or "canopy" in r["mesh"].lower():
            continue
        x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
        if z < -50000.0 or z > 6000.0:
            continue
        u, v = frame(x, y)
        if not (40000.0 <= u <= 125000.0 and abs(v) <= 60000.0):
            continue
        ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
        if max(ex, ey) > 5000.0 and ez < 300.0:
            continue
        occ.add("existing", x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["mesh"])
        if abs(v) < 12000.0 and ez * 2 > 1500.0:
            tall.append((round(u / 100), round(v / 100, 1), round(ez * 2 / 100, 1), r["mesh"]))
        if r["mesh"] == "SM_hedge_mass" and abs(v) < 15000.0:
            hedges.append((round(u / 100), round(v / 100, 1), round(max(ex, ey) / 100, 1)))

print("SEAM %.0f deg" % BEARING)
blocked, last = [], None
for j in range(0, 900):
    u = 50000.0 + 74.0 * j * 1.0
    if u > 120000.0:
        break
    x, y = world(u, 0.0)
    hit = occ.hits(x, y, 370.0, 1440.0, BEARING, 60.0, ("existing",))
    if hit:
        m = hit.split(":", 1)[1]
        if last and last[2] == m and u - last[1] <= 800.0:
            last[1] = u
        else:
            last = [u, u, m]
            blocked.append(last)
print("  way (28.8 m) blocked at:", [(round(a / 100), round(b / 100), m) for a, b, m in blocked] or "nowhere")
ok = []
for rr in range(52000, 118001, 1000):
    bad = 0
    for jj in range(8):
        for c in range(-2, 2):
            x, y = world(rr + 740.0 * (jj - 3.5), (c + 0.5) * 1440.0)
            if occ.hits(x, y, 370.0, 720.0, BEARING, 60.0, ("existing",)):
                bad += 1
    if bad == 0:
        ok.append(rr // 100)
print("  clear 57.6 x 59 m plazas centred at radii (m):", ok)
print("  tall pieces within 120 m of the line:", sorted(tall)[:30])
print("  hedge masses within 150 m of the line (u m, v m, half m):", sorted(hedges)[:30])
