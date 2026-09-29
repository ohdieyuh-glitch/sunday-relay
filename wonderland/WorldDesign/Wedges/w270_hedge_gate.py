#!/usr/bin/env python3
"""THE HEDGE GATE: where to move the two V2 hedge masses that close the 270 seam, so a way can pass.

    python w270_hedge_gate.py        (writes w270_hedge_gate_plan.json; changes nothing in the map)

Core approved the gate on 2026-09-28 with five conditions. This file answers condition 3 -- clearance at the
NEW positions -- before anything is moved; the editor job that moves them (zc_w270_hedge_gate) answers 1, 2
and 5, and checkpoint_map.sh answers 4.

WHAT IS MOVED. Two SM_hedge_mass instances of the V2 world's hedge ring lie across the seam line: A at u 882.6 m
(v -60..+21) and B at u 938.0 m (v -21..+66). Together with their neighbours they wall the rear sector from
v -520 to +344 m between 850 and 1,040 m. Nothing is deleted: each is RELOCATED to the nearest pose that
leaves the gate corridor clear, preferring its own side of the line so the pair become the gate's flanks.

WHAT A NEW POSE MUST NOT TOUCH (oriented rectangles, separating axes, the census taken after W270S/N/T):
  * the gate corridor -- W270G's floor, v -15.9..+15.9 m for u 830-1,040 m (plates plus 1.5 m);
  * any tower, hall, house, arch, roof or other architecture (a hedge through a tower is the failure the
    first "shift 36 m / 45 m" guess would have made: the castle tower at 896-914 m and the hall and tower at
    959-978 m sit exactly where those shifts land);
  * everything W270S/N/T placed (courts, lanes, gardens, groves), and FR02/03/04's planted patches.
It MAY overlap other hedge masses: two green masses meeting read as one, and that is what a hedge ring is.
Canopies are not solid (only trunks are), as everywhere else in this lane.
"""
import csv
import gzip
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from w270_rear_seam import Occupancy, CENSUS, GATE_HEDGES           # noqa: E402

CORRIDOR = (83000.0, 104000.0, 1590.0)       # u from, u to, half-width (cm) of the gate's floor + 1.5 m
SOFT = ("Grass_Tuft", "Flower_", "canopy", "Fringe", "Kerb_Run", "kerb_stone", "Verge_Run", "Plinth_Block")


def main():
    occ = Occupancy()
    targets = {i: None for i in range(len(GATE_HEDGES))}
    with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "OTHER":
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            if z < -50000.0 or z > 6000.0 or not (-60000.0 <= x <= 60000.0 and -125000.0 <= y <= -70000.0):
                continue
            ex, ey, ez, yaw = float(r["ex"]), float(r["ey"]), float(r["ez"]), float(r["yaw"])
            if r["mesh"] == "SM_hedge_mass":
                for i, (tx, ty) in enumerate(GATE_HEDGES):
                    d = math.hypot(x - tx, y - ty)
                    if d < 300.0 and (targets[i] is None or d < targets[i]["d"]):
                        targets[i] = {"d": d, "x": x, "y": y, "z": z, "ex": ex, "ey": ey, "ez": ez, "yaw": yaw,
                                      "owner": r["owner"]}
                continue                                       # hedges never block a hedge
            if any(s in r["mesh"] for s in SOFT) or max(ex, ey) > 5000.0 and ez < 300.0:
                continue
            occ.add("existing", x, y, max(ex, 20.0), max(ey, 20.0), yaw, r["mesh"] + "|" + r["owner"])
    # the corridor itself, as a rectangle along the seam (u = -y)
    u0, u1, half = CORRIDOR
    occ.add("existing", 0.0, -(u0 + u1) * 0.5, half, (u1 - u0) * 0.5, 0.0, "GATE_CORRIDOR|W270G")

    plan = []
    for i, t in targets.items():
        if t is None:
            raise SystemExit("hedge %d not found near %s -- the world is not what this plan was built on" % (i, GATE_HEDGES[i]))
        side = -1.0 if t["x"] < 0 else 1.0                     # A is west of the line, B east
        best = None
        for turn in (0.0, 90.0):
            yaw = (t["yaw"] + turn) % 360.0
            for dv in range(0, 14001, 200):                     # outward from the line first
                for du in (0, 200, -200, 400, -400, 800, -800, 1200, -1200, 1600, -1600, 2400, -2400):
                    nx, ny = t["x"] + side * dv, t["y"] - du
                    hit = occ.hits(nx, ny, t["ex"], t["ey"], yaw, 150.0, ("existing",))
                    if hit:
                        continue
                    cost = dv + abs(du) + (2000.0 if turn else 0.0)
                    if best is None or cost < best["cost"]:
                        best = {"cost": cost, "x": nx, "y": ny, "yaw": yaw, "dv_m": side * dv / 100.0,
                                "du_m": du / 100.0, "turned": turn}
                    break
                if best is not None and best["cost"] <= dv:
                    break
        if best is None:
            raise SystemExit("no clear pose for hedge %d within 140 m -- report, do not force" % i)
        plan.append({"which": "A (west)" if side < 0 else "B (east)", "batch_owner": t["owner"],
                     "old_approx": {"x": round(t["x"]), "y": round(t["y"]), "z": round(t["z"]), "yaw": round(t["yaw"], 1)},
                     "half_extent_m": [round(t["ex"] / 100, 1), round(t["ey"] / 100, 1)],
                     "new": {"x": round(best["x"]), "y": round(best["y"]), "z": round(t["z"]), "yaw": round(best["yaw"], 1)},
                     "moved_across_m": best["dv_m"], "moved_along_m": best["du_m"], "turned_deg": best["turned"]})
    out = {"reason": "open a hedge gate through the V2 hedge ring on the 270 seam (Core approval 2026-09-28): "
                     "relocate, delete nothing", "corridor_cm": CORRIDOR, "moves": plan}
    (HERE / "w270_hedge_gate_plan.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
