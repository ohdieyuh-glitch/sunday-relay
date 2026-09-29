#!/usr/bin/env python3
"""Hedge gates for the ring roads: move the V2 hedge-mass pieces that stand across a ring, delete nothing.

    python WorldDesign/Rings/ring_roads.py          (writes rr0*_refused.json: the plates a standing piece refused)
    python WorldDesign/Rings/ring_hedge_gates.py    (writes ring_hedge_gate_plan.json for zc_ring_hedge_gate)

WHY (2026-09-28, CORE C2). Three stretches of the ring roads are broken by nothing but the V2 hedge ring: RR01 at
46.7-49.2 deg (~600 m), RR02 at 68.1-69.1 deg (~1,102 m) and 149.8-153.1 deg (~1,055 m). The rear seam met the same
wall and opened a gate by relocating two hedge instances (Core approval, 2026-09-28: relocate, delete nothing,
guard on the exact current transform, record old and new, clearance at the new pose, checkpoint, prove the
passage). This plans the same thing for the rings.

HOW. A hedge is a candidate when its oriented footprint overlaps a refused plate. For each one, the smallest move
is searched -- shifted across the road (radially) by up to 60 m, either keeping its yaw or turned to run
ALONGSIDE the road -- whose new footprint clears the whole ring corridor (both rings, +/-11 m), every other
standing piece in the census, and existing paving. Smallest first, so the hedge ring keeps its shape and the
road passes through a gap that looks cut on purpose. A hedge with no clear pose within 60 m is reported, not
moved.
"""
import csv
import gzip
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
CENSUS = WD.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
sys.path.insert(0, str(WD / "Wedges"))
from w270_rear_seam import Occupancy                                   # noqa: E402

CORRIDOR_HALF = 1100.0
SHIFTS = [s * 100.0 for s in range(5, 61, 1)]          # 5..60 m
MARGIN = 150.0


def sat(a, b, margin=0.0):
    return Occupancy._overlap(a, b, margin)


def main():
    refused = []
    for name in ("rr01_refused.json", "rr02_refused.json"):
        refused += json.loads((HERE / name).read_text(encoding="utf-8"))
    routes = json.loads((HERE / "ring_routes.json").read_text(encoding="utf-8"))
    corridor = []                                        # oriented segments along both rings
    for ring in routes.values():
        pts = ring["points"]
        for k in range(1, len(pts)):
            x0, y0, x1, y1 = pts[k - 1][2], pts[k - 1][3], pts[k][2], pts[k][3]
            L = math.hypot(x1 - x0, y1 - y0)
            if L <= 0.0:
                continue
            corridor.append(((x0 + x1) * 0.5, (y0 + y1) * 0.5, L * 0.5 + 100.0, CORRIDOR_HALF,
                             math.degrees(math.atan2(y1 - y0, x1 - x0))))
    hedges, others = [], Occupancy()
    with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "OTHER":
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            if z < -50000.0 or z > 6000.0 or not (40000.0 <= math.hypot(x, y) <= 130000.0):
                continue
            ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
            if max(ex, ey) > 5000.0 and ez < 300.0 or "tuft" in r["mesh"].lower():
                continue
            rec = (x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"])
            if r["mesh"] == "SM_hedge_mass":
                hedges.append(dict(x=x, y=y, z=z, ex=ex, ey=ey, yaw=float(r["yaw"]), owner=r["owner"]))
            layer = "paved" if any(w in r["mesh"] for w in ("Flagstone", "Kerb_Run", "Plaza", "terrace_platform")) \
                else "existing"
            if "canopy" in r["mesh"].lower():
                rec = (x, y, 80.0, 80.0, 0.0, r["owner"])
            others.add(layer, *rec)
    # which hedges stand on a refused plate
    blocking = []
    for h in hedges:
        me = (h["x"], h["y"], h["ex"], h["ey"], h["yaw"])
        for p in refused:
            if "hedge_mass" not in p["blocker"]:
                continue
            plate = (p["x"], p["y"], p["half_x"], 370.0, p["yaw"])
            if sat(me, plate):
                blocking.append(h)
                break
    print("hedges standing on refused ring plates: %d" % len(blocking))
    moves, stuck = [], []
    moving = {(round(h["x"]), round(h["y"])) for h in blocking}
    for h in blocking:
        r = math.hypot(h["x"], h["y"])
        ux, uy = h["x"] / r, h["y"] / r                   # radial: across the ring road
        tangent = math.degrees(math.atan2(ux, -uy))       # along the ring
        best = None
        for shift in SHIFTS:
            for sign in (1.0, -1.0):
                for yaw in (h["yaw"], tangent, tangent + 180.0):
                    nx, ny = h["x"] + ux * shift * sign, h["y"] + uy * shift * sign
                    me = (nx, ny, h["ex"], h["ey"], yaw)
                    if any(sat(me, c) for c in corridor if abs(c[0] - nx) < 20000 and abs(c[1] - ny) < 20000):
                        continue
                    hit = None
                    for layer in ("existing", "paved"):
                        for k in others._keys(nx, ny, math.hypot(h["ex"], h["ey"]) + MARGIN + 4000.0):
                            for rec in others.layers[layer].get(k, ()):
                                if (round(rec[0]), round(rec[1])) in moving and "hedge_mass" in rec[5]:
                                    continue          # itself, or another hedge that is moving too
                                if sat(me, rec[:5], MARGIN):
                                    hit = rec[5]
                                    break
                            if hit:
                                break
                        if hit:
                            break
                    if hit is None:
                        best = (shift * sign, yaw, nx, ny)
                        break
                if best:
                    break
            if best:
                break
        if best is None:
            stuck.append(h)
            continue
        moved, yaw, nx, ny = best
        moves.append({"which": "%s at %.0f deg, %.0f m" % (h["owner"][-24:], math.degrees(math.atan2(h["y"], h["x"])) % 360.0, r / 100.0),
                      "batch_owner": h["owner"],
                      "old_approx": {"x": round(h["x"]), "y": round(h["y"]), "z": round(h["z"]), "yaw": round(h["yaw"], 1)},
                      "half_extent_m": [round(h["ex"] / 100.0, 1), round(h["ey"] / 100.0, 1)],
                      "new": {"x": round(nx), "y": round(ny), "z": round(h["z"]), "yaw": round(yaw % 360.0, 1)},
                      "moved_radially_m": round(moved / 100.0, 1),
                      "turned_deg": round(((yaw - h["yaw"]) + 180.0) % 360.0 - 180.0, 1)})
    plan = {"reason": "open the ring roads through the V2 hedge ring (Core, 2026-09-28): relocate, delete nothing",
            "moves": moves,
            "stuck": [{"owner": h["owner"], "x": round(h["x"]), "y": round(h["y"])} for h in stuck]}
    (HERE / "ring_hedge_gate_plan.json").write_text(json.dumps(plan, indent=1), encoding="utf-8")
    for m in moves:
        print("  MOVE %-52s radially %+6.1f m, turned %+6.1f deg -> (%d, %d)" % (
            m["which"], m["moved_radially_m"], m["turned_deg"], m["new"]["x"], m["new"]["y"]))
    for h in stuck:
        print("  STUCK %s at (%.0f, %.0f): no clear pose within 60 m" % (h["owner"], h["x"], h["y"]))


if __name__ == "__main__":
    main()
