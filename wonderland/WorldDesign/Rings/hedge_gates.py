#!/usr/bin/env python3
"""DESIGNED GATES IN THE V2 HEDGE RING -- founder decision 2026-09-29: "CUT DESIGNED GATES ... ring / road / trail
continuity takes priority over keeping an uninterrupted hedge wall".

    python WorldDesign/Rings/hedge_gates.py        (writes, per window: hedge_gate_plan_<w>.json for the editor job
                                                    zc_hedge_gates, and hg<w>_hedge_gates.json, the gate furniture)

THE GATES (the ring and seam plates the V2 hedge ring refused, and Dubel's path end):
  GA  RR01  46.5-49.2 deg  ~570-600 m   9 plates            window 2B
  GB  RR02  31.5-32.0 deg  ~1,141 m     3 plates + SR030's refused end plate at 31.44 deg: ONE gate joins SR030 into
                                        the outer ring                                              window 2A
  GC  RR02  67.8-69.2 deg  ~1,105 m     6 plates            window 2B
  GD  RR02 149.9-153.0 deg ~1,050 m     8 plates            window 2B
  GE  Dubel ~116-121 deg   ~1,300 m     the stepping-stone way from DW01's main chain to its 122 deg chain (and
                                        WI122's trail stone), found by a grid search that sees every obstacle
                                        EXCEPT hedges, so it crosses nothing but hedge          window 2A
THE FOUNDER'S ORDER, per blocking hedge (a SM_hedge_mass instance whose footprint crosses a gate corridor):
  A. RELOCATE: the smallest shift (5-60 m, across and along the corridor, own side first) or turn (own yaw, or
     parallel to the corridor so the hedge becomes the gate's flank) whose new footprint clears EVERY gate corridor,
     every ring / seam / Dubel way, and every non-hedge thing standing (architecture, trunks, paving) by 1-2 m.
     It MAY overlap other hedge masses: two green masses meeting read as one, which is what a hedge ring is (the
     rule W270G used; the 2026-09-28 ring planner forbade it and found no pose for any of 11 hedges).
  C. TRIM, only where no relocation clears: the instance is sunk by SINK_UU (z - 100,000), the convention of
     courtkit / dc01 / fl04 / vw01 -- invisible, non-colliding for play, and reversible from the record.
  (B, reshaping the composition, is what the relocations do: moved hedges close up beside the opening.)
THE GATE READS AS AUTHORED: a stone gate pier with a gold ball finial on each side of every opening (SM_gate_pier +
SM_gate_finial_ball, the TW01 gate), the missing ring / seam plates re-laid in the neighbours' nation palette with
kerbs, and at GE stepping stones through the gate (the DW01 recipe). Every piece is placed only where it clears.
"""
import csv
import gzip
import json
import math
import random
import sys
from collections import deque
from pathlib import Path

HERE = Path(__file__).resolve().parent
WD = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(WD / "Wedges"))
sys.path.insert(0, str(WD / "Nations"))
import ring_roads as RR                                                   # noqa: E402
import nations                                                           # noqa: E402
from w270_rear_seam import Occupancy                                     # noqa: E402

CENSUS = WD.parent / "Tools" / "captures" / "zc" / "census" / "world_census.csv.gz"
SINK_UU = 100000.0
SHIFTS = [s * 100.0 for s in range(5, 61)]
FLAGS = ("WL_Ground_Flagstone_A", "WL_Ground_Flagstone_B", "WL_Ground_Flagstone_C")
PLATE_HALF_ALONG = RR.PLATE_Y * 0.5
GATES = {"GA": ("2B", "rr01_refused.json", (46.0, 49.5)), "GB": ("2A", None, None),
         "GC": ("2B", "rr02_refused.json", (67.5, 69.5)), "GD": ("2B", "rr02_refused.json", (149.5, 153.5)),
         "GE": ("2A", None, None)}
SOFT = ("tuft", "Grass_Tuft", "Flower_", "flower", "Fringe", "mushroom_small")   # small mushrooms: collides=False (DF01 l.185)


def sat(a, b, margin=0.0):
    return Occupancy._overlap(a, b, margin)


def refused_plates(fname, lo, hi):
    return [p for p in json.loads((HERE / fname).read_text(encoding="utf-8"))
            if "hedge_mass" in p["blocker"] and lo <= p["bearing"] <= hi]


def load(rmin=40000.0, rmax=150000.0):
    hedges, others = [], Occupancy()
    with gzip.open(CENSUS, "rt", encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if r["kind"] == "OTHER":
                continue
            x, y, z = float(r["x"]), float(r["y"]), float(r["z"])
            if z < -50000.0 or z > 6000.0 or not (rmin <= math.hypot(x, y) <= rmax):
                continue
            ex, ey, ez = float(r["ex"]), float(r["ey"]), float(r["ez"])
            if max(ex, ey) > 5000.0 and ez < 300.0 or any(s in r["mesh"] for s in SOFT):
                continue
            if r["mesh"] == "SM_hedge_mass":
                hedges.append(dict(x=x, y=y, z=z, ex=ex, ey=ey, yaw=float(r["yaw"]), owner=r["owner"]))
                continue
            # a slender trunk's census box is its whole mesh bounds (~5 m square with the root flare); what a walker
            # meets is the trunk. The same 0.8 m stand-in the lanes already use for a tree's trunk under a canopy
            if "canopy" in r["mesh"].lower() or "trunk" in r["mesh"].lower():
                others.add("existing", x, y, 80.0, 80.0, 0.0, r["owner"] + ":trunk")
                continue
            layer = "paved" if any(w in r["mesh"] for w in ("Flagstone", "Kerb_Run", "Plaza", "terrace_platform",
                                                            "plaza_slab", "paving", "kerb_stone")) else "existing"
            others.add(layer, x, y, max(ex, 20.0), max(ey, 20.0), float(r["yaw"]), r["owner"] + ":" + r["mesh"])
    return hedges, others


def bfs(occ, a, b, box=15000.0, cell=100.0, half=70.0):
    cx, cy = 0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1])
    n = int(2 * box / cell) + 1
    def c_of(x, y):
        return int(round((x - cx + box) / cell)), int(round((y - cy + box) / cell))
    def w_of(i, j):
        return cx - box + i * cell, cy - box + j * cell
    memo = {}
    def free(i, j):
        if (i, j) not in memo:
            x, y = w_of(i, j)
            memo[(i, j)] = occ.hits(x, y, half, half, 0.0, 20.0, ("existing",)) is None
        return memo[(i, j)]
    s, t = c_of(*a), c_of(*b)
    prev, q = {s: None}, deque([s])
    while q:
        c = q.popleft()
        if c == t:
            break
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                nb = (c[0] + di, c[1] + dj)
                if nb in prev or not (0 <= nb[0] < n and 0 <= nb[1] < n) or (not free(*nb) and nb != t):
                    continue
                prev[nb] = c
                q.append(nb)
    if t not in prev:
        return None
    out, c = [], t
    while c is not None:
        out.append(w_of(*c))
        c = prev[c]
    return out[::-1]


def dubel_ends():
    s = json.loads((WD / "Districts" / "dw01_dubel_walk.json").read_text(encoding="utf-8"))
    pts = [(i[0], i[1]) for b in s["batches"] if "_paving_t" in b["id"] and "warm" not in b["id"]
           and "shade" not in b["id"] for i in b["instances"]]
    br = lambda p: math.degrees(math.atan2(p[1], p[0]))
    main_end = max((p for p in pts if br(p) < 116.5), key=br)
    far_start = min((p for p in pts if br(p) > 120.0), key=br)
    return main_end, far_start


def corridors():
    """gate -> list of oriented rectangles (x, y, hx, hy, yaw) the opening must keep clear, plus what fills it."""
    out = {}
    for g, (_w, fname, rng) in GATES.items():
        if fname:
            plates = refused_plates(fname, *rng)
            out[g] = {"rects": [(p["x"], p["y"], p["half_x"] + 150.0, PLATE_HALF_ALONG + 60.0, p["yaw"]) for p in plates],
                      "plates": plates, "kind": "road"}
    return out


def sr030_ends():
    """GB is not the refused plates: RR02's own plates at 31.5-32 deg and SR030's last one stand in a SKY05 tower
    base (RR02's documented tower-cluster break). The join is a WALK from SR030's last laid plate round that tower
    to RR02's nearest laid plate at 32.1 deg (55 m, found with hedges ignored), gated where it crosses the hedge."""
    sr = [(i[0], i[1]) for bt in json.loads((HERE / "sr030_seam_way.json").read_text(encoding="utf-8"))["batches"]
          if "_Plate_" in bt["id"] for i in bt["instances"]]
    end = max(sr, key=lambda p: math.hypot(*p))
    rr = [(i[0], i[1]) for bt in json.loads((HERE / "rr02_outer_ring.json").read_text(encoding="utf-8"))["batches"]
          if "_Plate_" in bt["id"] for i in bt["instances"]]
    return end, min(rr, key=lambda p: math.hypot(p[0] - end[0], p[1] - end[1]))


def plan_moves(gate, rects, hedges, others, all_rects, ways):
    blocking = [h for h in hedges if any(sat((h["x"], h["y"], h["ex"], h["ey"], h["yaw"]), r) for r in rects)]
    gx = sum(r[0] for r in rects) / len(rects)
    gy = sum(r[1] for r in rects) / len(rects)
    head = sum(r[4] for r in rects) / len(rects)          # plate yaw = ACROSS the way; the way runs at yaw - 90
    moving = {(round(h["x"]), round(h["y"])) for h in blocking}
    moves, sinks = [], []
    for h in blocking:
        across = math.radians(head)
        along = math.radians(head - 90.0)
        side = 1.0 if (h["x"] - gx) * math.cos(across) + (h["y"] - gy) * math.sin(across) >= 0 else -1.0
        best = None
        for d in SHIFTS:
            for (ux, uy, sgn) in ((math.cos(across), math.sin(across), side), (math.cos(across), math.sin(across), -side),
                                  (math.cos(along), math.sin(along), 1.0), (math.cos(along), math.sin(along), -1.0)):
                for yaw in (h["yaw"], head - 90.0, head + 90.0):
                    nx, ny = h["x"] + ux * d * sgn, h["y"] + uy * d * sgn
                    me = (nx, ny, h["ex"], h["ey"], yaw)
                    if any(sat(me, r, 200.0) for r in all_rects):
                        continue
                    if any(sat(me, w, 150.0) for w in ways if abs(w[0] - nx) < 20000 and abs(w[1] - ny) < 20000):
                        continue
                    if others.hits(nx, ny, h["ex"], h["ey"], yaw, 100.0, ("existing", "paved")):
                        continue
                    best = (d * sgn, yaw, nx, ny)
                    break
                if best:
                    break
            if best:
                break
        rec = {"which": "%s %s at (%d, %d)" % (gate, h["owner"][-28:], h["x"], h["y"]), "batch_owner": h["owner"],
               "old_approx": {"x": round(h["x"]), "y": round(h["y"]), "z": round(h["z"]), "yaw": round(h["yaw"], 1)},
               "half_extent_m": [round(h["ex"] / 100.0, 1), round(h["ey"] / 100.0, 1)]}
        if best:
            moved, yaw, nx, ny = best
            rec.update({"new": {"x": round(nx), "y": round(ny), "z": round(h["z"]), "yaw": round(yaw % 360.0, 1)},
                        "moved_m": round(abs(moved) / 100.0, 1),
                        "turned_deg": round(((yaw - h["yaw"]) + 180.0) % 360.0 - 180.0, 1), "action": "relocate"})
            moves.append(rec)
        else:
            rec.update({"new": {"x": round(h["x"]), "y": round(h["y"]), "z": round(h["z"] - SINK_UU),
                                "yaw": round(h["yaw"], 1)}, "turned_deg": 0.0, "action": "trim (SINK_UU)"})
            sinks.append(rec)
    return blocking, moves + sinks, (gx, gy, head)


def main():
    # NOTE: window 2A was applied from hg2a_hedge_gates.json as committed at 0d29db29. Later edits to this file
    # change the random yaws of 2A's stones; never re-apply HG2A from a regenerated spec without re-checking.
    rng = random.Random(29)
    hedges, others = load()
    print("census: %d hedge masses, others %s" % (len(hedges), {k: sum(len(v) for v in d.values()) for k, d in others.layers.items()}))
    cors = corridors()
    # GB and GE: WALKS found through everything but hedges (0.9 m walker, a 150 m search box); a way longer than
    # 3x the straight line is a detour, not a join, and is refused
    for g, (a, b) in (("GB", sr030_ends()), ("GE", dubel_ends())):
        way = bfs(others, a, b, half=45.0)
        L = sum(math.hypot(way[i][0] - way[i - 1][0], way[i][1] - way[i - 1][1]) for i in range(1, len(way))) if way else 0
        if not way or L > 3.0 * math.hypot(b[0] - a[0], b[1] - a[1]) + 2000.0:
            print("%s: no short way even with hedges ignored (%s) -- not a hedge problem" % (g, way and round(L / 100)))
            cors[g] = {"rects": [], "plates": [], "kind": "walk", "way": []}
            continue
        print("%s: way %.0f m (straight %.0f m)" % (g, L / 100.0, math.hypot(b[0] - a[0], b[1] - a[1]) / 100.0))
        rects = []
        for k in range(0, len(way) - 1, 3):
            (x0, y0), (x1, y1) = way[k], way[min(k + 3, len(way) - 1)]
            seg = max(math.hypot(x1 - x0, y1 - y0), 100.0)
            rects.append(((x0 + x1) / 2, (y0 + y1) / 2, 250.0, seg / 2 + 60.0,
                          math.degrees(math.atan2(y1 - y0, x1 - x0)) + 90.0))
        cors[g] = {"rects": rects, "plates": [], "kind": "walk", "way": way}
    all_rects = [r for c in cors.values() for r in c["rects"]]
    # every way a moved hedge must stay off: ring + seam plates, and the Dubel walk's stones
    ways = []
    for fn in ("rr01_march_ring.json", "rr02_outer_ring.json", "sr030_seam_way.json", "sr150_seam_way.json"):
        for bt in json.loads((HERE / fn).read_text(encoding="utf-8"))["batches"]:
            if "_Plate_" in bt["id"]:
                ways += [(i[0], i[1], RR.PLATE_X * 0.5 * i[6], PLATE_HALF_ALONG, i[4]) for i in bt["instances"]]
    for bt in json.loads((WD / "Districts" / "dw01_dubel_walk.json").read_text(encoding="utf-8"))["batches"]:
        if "_paving_t" in bt["id"] and "warm" not in bt["id"] and "shade" not in bt["id"]:
            ways += [(i[0], i[1], 120.0, 120.0, 0.0) for i in bt["instances"]]
    per_window = {"2A": {"moves": [], "spec": RR.Spec("HG2A", "Wonderland/Authored/HG2A_HedgeGates")},
                  "2B": {"moves": [], "spec": RR.Spec("HG2B", "Wonderland/Authored/HG2B_HedgeGates")}}
    report = {}
    for g in ("GA", "GB", "GC", "GD", "GE"):
        c = cors[g]
        if not c["rects"]:
            report[g] = "no corridor"
            continue
        w = GATES[g][0]
        spec = per_window[w]["spec"]
        blocking, acts, (gx, gy, head) = plan_moves(g, c["rects"], hedges, others, all_rects, ways)
        per_window[w]["moves"] += acts
        # the opening, now clear of those hedges: what fills it
        if c["kind"] == "road":
            for p in c["plates"]:
                nation = nations.nation_at(p["x"], p["y"]) or "ICARUS"
                mats, _lum = RR.palette(nation)
                if others.hits(p["x"], p["y"], p["half_x"], PLATE_HALF_ALONG, p["yaw"], 0.0, ("existing",)):
                    spec.stats["%s_plate_still_blocked" % g] += 1
                    continue
                spec.add("Plate", RR.PLATE_MESH, mats.get("paving", "MI_V2_GroundFlag_PlazaCream"), p["x"], p["y"],
                         RR.PAVING_TOP - RR.PLATE_TOP_LOCAL, p["yaw"], collides=True, cull=RR.CULL_FAR)
                spec.stats["%s_plate" % g] += 1
                h = math.radians(p["yaw"] - 90.0)
                lx, ly = -math.sin(h), math.cos(h)
                for sd in (-1.0, 1.0):
                    kx, ky = p["x"] + lx * sd * (p["half_x"] + RR.KERB_W * 0.5), p["y"] + ly * sd * (p["half_x"] + RR.KERB_W * 0.5)
                    if not others.hits(kx, ky, RR.PLATE_STEP * 0.5, RR.KERB_W * 0.5, p["yaw"] - 90.0, 0.0, ("existing",)):
                        spec.add("Kerb", RR.KERB_MESH, mats.get("kerb", "MI_V2_Kerb"), kx, ky, RR.GROUND_Z, p["yaw"] - 90.0,
                                 sx=(RR.PLATE_STEP + 60.0) / RR.KERB_LEN, collides=False)
            # A PLATE THAT STILL CANNOT GO DOWN (GD: two stand in a SKY05 tower base once the hedges are gone) leaves
            # a hole in the ring. Walk round it, as SX01 walks round SR030's tower: stepping stones on the way a grid
            # search finds between the laid plates either side (hedges ignored -- they are the ones being moved).
            stuck = [p for p in c["plates"]
                     if others.hits(p["x"], p["y"], p["half_x"], PLATE_HALF_ALONG, p["yaw"], 0.0, ("existing",))]
            if stuck:
                sx_, sy_ = sum(p["x"] for p in stuck) / len(stuck), sum(p["y"] for p in stuck) / len(stuck)
                laid = [(i[0], i[1]) for bt in json.loads((HERE / "rr02_outer_ring.json").read_text(encoding="utf-8"))["batches"]
                        if "_Plate_" in bt["id"] for i in bt["instances"]]
                laid += [(p["x"], p["y"]) for p in c["plates"] if p not in stuck]
                near = sorted(laid, key=lambda q: math.hypot(q[0] - sx_, q[1] - sy_))
                a = near[0]
                b = next((q for q in near[1:] if ((q[0] - sx_) * (a[0] - sx_) + (q[1] - sy_) * (a[1] - sy_)) < 0), None)
                way = bfs(others, a, b, half=45.0) if b else None
                if way:
                    last = None
                    for (x, y) in way:
                        if last is None or math.hypot(x - last[0], y - last[1]) >= 450.0:
                            name = FLAGS[spec.stats["%s_bypass_stone" % g] % 3]
                            for part in RR.KIT[name]["parts"]:
                                if part["part"] != "veg_anchor":
                                    spec.add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"],
                                             part["material"], x, y, -13.0, rng.uniform(0.0, 360.0), 0.55, 0.55, 0.55,
                                             collides=False, cull=26000.0)
                            spec.stats["%s_bypass_stone" % g] += 1
                            last = (x, y)
                else:
                    spec.stats["%s_bypass_none" % g] += 1
            half_open = max(p["half_x"] for p in c["plates"]) + 250.0
        else:
            last = None
            for k, (x, y) in enumerate(c["way"]):
                if last is None or math.hypot(x - last[0], y - last[1]) >= 450.0:
                    name = FLAGS[len(c.get("stones", [])) % 3]
                    for part in RR.KIT[name]["parts"]:
                        if part["part"] != "veg_anchor":
                            spec.add("%s_%s" % (name.replace("WL_", ""), part["part"]), part["mesh"], part["material"],
                                     x, y, -13.0, rng.uniform(0.0, 360.0), 0.55, 0.55, 0.55, collides=False, cull=26000.0)
                    c.setdefault("stones", []).append((x, y))
                    last = (x, y)
            spec.stats["%s_stone" % g] += len(c.get("stones", []))
            half_open = 400.0
        # the gate's frame: a pier and a gold finial each side, where the opening crosses the hedge line
        for hb in blocking[:1]:
            cxg, cyg = hb["x"], hb["y"]
            if c["kind"] == "road":
                nearest = min(c["plates"], key=lambda p: math.hypot(p["x"] - cxg, p["y"] - cyg))
                cxg, cyg, yaw_across = nearest["x"], nearest["y"], nearest["yaw"]
            else:
                nearest = min(c["way"], key=lambda q: math.hypot(q[0] - cxg, q[1] - cyg))
                k = c["way"].index(nearest)
                q0, q1 = c["way"][max(0, k - 3)], c["way"][min(len(c["way"]) - 1, k + 3)]
                cxg, cyg = nearest
                yaw_across = math.degrees(math.atan2(q1[1] - q0[1], q1[0] - q0[0])) + 90.0
            t = math.radians(yaw_across)
            for sd in (-1.0, 1.0):
                px, py = cxg + math.cos(t) * sd * half_open, cyg + math.sin(t) * sd * half_open
                if others.hits(px, py, 95.0, 95.0, 0.0, 40.0, ("existing",)):
                    spec.stats["%s_pier_refused" % g] += 1
                    continue
                spec.add("GatePier", _mesh("SM_gate_pier"), "MI_V2_IvoryStone", px, py, RR.GROUND_Z, yaw_across, collides=True, cull=RR.CULL_FAR)
                spec.add("GateFinial", _mesh("SM_gate_finial_ball"), "MI_V2_Gold", px, py, RR.GROUND_Z + 650.0, 0.0,
                         cull=RR.CULL_FAR)
                spec.stats["%s_pier" % g] += 1
        report[g] = {"window": w, "blocking_hedges": len(blocking),
                     "relocated": sum(1 for x in acts if x["action"] == "relocate"),
                     "trimmed": sum(1 for x in acts if x["action"] != "relocate")}
    for w, d in per_window.items():
        plan = {"reason": "founder decision 2026-09-29: designed gates in the V2 hedge ring (relocate first, trim "
                          "by SINK_UU only where relocation cannot clear); window %s" % w, "moves": d["moves"]}
        (HERE / ("hedge_gate_plan_%s.json" % w.lower())).write_text(json.dumps(plan, indent=1), encoding="utf-8")
        out = d["spec"].out(["WL_AUTHORED", "WL_PASS_%s" % d["spec"].id, "WL_HEDGE_GATE"])
        (HERE / ("hg%s_hedge_gates.json" % w.lower())).write_text(json.dumps(out, indent=1), encoding="utf-8")
        print("window %s: %d hedge actions, furniture %d instances in %d batches; %s" % (
            w, len(d["moves"]), sum(len(b["instances"]) for b in out["batches"]), len(out["batches"]),
            dict(d["spec"].stats)))
    for g, r in report.items():
        print("  %s %s" % (g, r))


MB = json.loads((WD / "mesh_bounds.json").read_text(encoding="utf-8"))["meshes"]


def _mesh(name):
    return MB[name]["path"] + "." + name


if __name__ == "__main__":
    main()
