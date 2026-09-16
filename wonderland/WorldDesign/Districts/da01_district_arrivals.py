#!/usr/bin/env python3
"""DA01 -- district arrivals: a palace front in view where the map lands a visitor.

THE GAP (PRIVATE_BETA_GATE.md items 11-12; beta_tour captures 2026-09-13). Fifteen of the seventeen places the
world map offers land the visitor on bare lawn or plain slabs, looking at scattered columns, urns and balustrade
fragments, often at a wall a few metres away. The Bible's districts are enclosed by architecture: palace fronts,
pavilions and domes stand around every garden (BOARD_1 "Architecture Detail References", "Plaza & Pathway").

WHAT THIS LAYER ADDS. For each destination, one palace group from the palace family (GAP 17), set across the
arrival view so it is the first thing the visitor sees, its front turned to the anchor:
  dome_court   the great dome with a wing on each side          ~94 m wide
  row3         pavilion - wing - pavilion                        ~55 m wide
  dome         the great dome                                    ~35 m wide
  row2         wing + pavilion                                   ~40 m wide
  pavilion     one pavilion                                      ~15 m wide
The widest group that fits is chosen, at 20-62 m, so that:
  * its footprint (+1 m) touches no solid piece taller than 0.6 m (small props wholly inside are swallowed) and no
    walked ground (kerbs, terrace platforms, paths, steps) -- routes stay open, nothing is stood on a path;
  * it is actually SEEN from the anchor's eye: sampled points on its front face must clear everything between;
  * the anchor keeps 18 m of open ground in front of it.
Glazing and arcade recesses take MI_V2_WindowDark (the kit's amber glass reads as flat yellow panels on a facade,
palace preview 2026-09-13). Domes alternate gold and lilac so two districts do not read as one.

HEIGHTS. Stage 1 (this script with --probe) writes the footprint points to probe in PIE; stage 2 reads the probe
and seats each group at the lowest floor under its footprint minus 15 cm, and drops a group whose floor varies
by more than 1.2 m (it would float on one side).

INPUTS (measured): district_census (tools job district_census.py, 65 m around every destination),
destinations from DefaultGame.ini's travel registry, kit_modules.json. OUTPUT: da01_district_arrivals.json.
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "DA01"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS_PATH = Path(sys.argv[sys.argv.index("--census") + 1]) if "--census" in sys.argv else HERE / "district_census_2026-09-13.json"
PROBE_PATH = HERE / "da01_probe_2026-09-13.json"
SKIP = ("arrival", "castle_approach")            # the hero corridor is authored by the GA passes
EYE_Z = 170.0
FRONT_CLEAR_UU = 1800.0
MARGIN_UU = 100.0
DARK = "MI_V2_WindowDark"

# group templates: modules at local (x along the front, y toward the anchor), all fronts facing +y.
# Footprints are the kit's measured bboxes; y_front is how far the group's front reaches toward the anchor.
TEMPLATES = [
    ("dome_court", [("WL_Palace_Dome_Grand", 0.0, 0.0), ("WL_Palace_Wing", -2980.0, 0.0), ("WL_Palace_Wing", 2980.0, 0.0)]),
    ("row3", [("WL_Palace_Pavilion", -1955.0, 0.0), ("WL_Palace_Wing", 0.0, 0.0), ("WL_Palace_Pavilion", 1955.0, 0.0)]),
    ("dome", [("WL_Palace_Dome_Grand", 0.0, 0.0)]),
    ("row2", [("WL_Palace_Wing", -730.0, 0.0), ("WL_Palace_Pavilion", 1225.0, 0.0)]),
    ("pavilion", [("WL_Palace_Pavilion", 0.0, 0.0)]),
]


def _destinations():
    ini = (HERE.parents[1] / "Config" / "DefaultGame.ini").read_text(encoding="utf-8")
    import re
    out = []
    for m in re.finditer(r'Id="([^"]+)".*?Status=(\w+).*?ArrivalYawDeg=([-0-9.]+).*?anchor at \(([-0-9]+), ([-0-9]+), ([-0-9]+)\)', ini):
        out.append({"id": m.group(1), "yaw": float(m.group(3)), "x": float(m.group(4)), "y": float(m.group(5)), "z": float(m.group(6))})
    return out


def _rects(template):
    """Local axis-aligned footprint rectangles (xmin, xmax, ymin, ymax) of a template's modules."""
    out = []
    for mid, lx, ly in template:
        lo, hi = KIT[mid]["bbox_min"], KIT[mid]["bbox_max"]
        out.append((lx + lo[0], lx + hi[0], ly + lo[1], ly + hi[1]))
    return out


def _frame(dest, depth, lateral, template):
    """World placement of a template whose front is `depth` uu ahead of the anchor, shifted `lateral` uu."""
    th = math.radians(dest["yaw"])
    f = (math.cos(th), math.sin(th))
    l = (-math.sin(th), math.cos(th))
    y_front = max(r[3] for r in _rects(template))
    # local +y points back at the anchor, so the group centre sits (depth + y_front) ahead
    cx = dest["x"] + f[0] * (depth + y_front) + l[0] * lateral
    cy = dest["y"] + f[1] * (depth + y_front) + l[1] * lateral
    yaw = dest["yaw"] + 90.0

    def to_world(px, py):
        # local x -> l, local y -> -f
        return (cx + px * l[0] - py * f[0], cy + px * l[1] - py * f[1])

    return to_world, yaw


def _to_local(to_world_origin, dest, depth, lateral, template):
    th = math.radians(dest["yaw"])
    f = (math.cos(th), math.sin(th))
    l = (-math.sin(th), math.cos(th))
    y_front = max(r[3] for r in _rects(template))
    cx = dest["x"] + f[0] * (depth + y_front) + l[0] * lateral
    cy = dest["y"] + f[1] * (depth + y_front) + l[1] * lateral

    def local(wx, wy):
        dx, dy = wx - cx, wy - cy
        return (dx * l[0] + dy * l[1], -(dx * f[0] + dy * f[1]))

    return local


def _circle_rect(px, py, r, rect):
    x0, x1, y0, y1 = rect
    nx = min(max(px, x0), x1)
    ny = min(max(py, y0), y1)
    return math.hypot(px - nx, py - ny) <= r


def _fits(dest, census, depth, lateral, template):
    rects = [(a - MARGIN_UU, b + MARGIN_UU, c - MARGIN_UU, d + MARGIN_UU) for (a, b, c, d) in _rects(template)]
    local = _to_local(None, dest, depth, lateral, template)
    for label, mesh, x, y, r, zmin, zmax in census["solids"]:
        if zmax - zmin < 60.0 or zmin > 5000.0:
            continue
        lx, ly = local(x, y)
        for rect in rects:
            if _circle_rect(lx, ly, r, rect):
                inside = rect[0] + r <= lx <= rect[1] - r and rect[2] + r <= ly <= rect[3] - r
                if inside and r <= 150.0 and zmax - zmin <= 600.0:
                    continue                      # a small prop wholly inside is swallowed by the building
                return False
    for mesh, x, y, r, ztop in census["ground"]:
        lx, ly = local(x, y)
        for rect in rects:
            if _circle_rect(lx, ly, r, rect):
                return False
    return True


def _visible_fraction(dest, census, depth, lateral, template):
    """Share of sample points on the group's front face (3 heights x 9 across) with a clear sight line from the eye."""
    to_world, _ = _frame(dest, depth, lateral, template)
    rects = _rects(template)
    xmin, xmax = min(r[0] for r in rects), max(r[1] for r in rects)
    y_front = max(r[3] for r in rects)
    ex, ey, ez = dest["x"], dest["y"], dest["z"] + EYE_Z
    blockers = [(x, y, r, zmax) for (label, mesh, x, y, r, zmin, zmax) in census["solids"] if zmax - zmin >= 150.0 and zmin < 1500.0]
    seen = total = 0
    for i in range(9):
        px = xmin + (xmax - xmin) * (i + 0.5) / 9.0
        wx, wy = to_world(px, y_front)
        d = math.hypot(wx - ex, wy - ey)
        for h in (500.0, 1000.0, 1500.0):
            total += 1
            tz = dest["z"] + h
            blocked = False
            for bx, by, br, bz in blockers:
                # nearest point of the sight line to the blocker, in plan
                t = ((bx - ex) * (wx - ex) + (by - ey) * (wy - ey)) / max(d * d, 1.0)
                if t <= 0.02 or t >= 0.97:
                    continue
                qx, qy = ex + t * (wx - ex), ey + t * (wy - ey)
                if math.hypot(bx - qx, by - qy) <= br * 0.8 and bz > ez + t * (tz - ez):
                    blocked = True
                    break
            seen += 0 if blocked else 1
    return seen / float(total)


def choose(dest, census):
    best = None
    for ti, (name, template) in enumerate(TEMPLATES):
        rects = _rects(template)
        width = max(r[1] for r in rects) - min(r[0] for r in rects)
        for depth in [2000.0 + 300.0 * k for k in range(15)]:
            for lateral in (0.0, -500.0, 500.0, -1000.0, 1000.0, -1500.0, 1500.0):
                if not _fits(dest, census, depth, lateral, template):
                    continue
                v = _visible_fraction(dest, census, depth, lateral, template)
                if v < 0.45:
                    continue
                angular = 2.0 * math.degrees(math.atan2(width * 0.5, depth + 300.0))
                score = angular * v - abs(lateral) / 400.0
                if best is None or score > best["score"]:
                    best = {"template": name, "depth": depth, "lateral": lateral, "visible": round(v, 2),
                            "angular_deg": round(angular, 1), "score": round(score, 2)}
        if best is not None and best["angular_deg"] >= 40.0:
            break                                   # a wide group already fills the view; smaller ones cannot beat it
    return best


def probe_points(dest, pick):
    template = dict(TEMPLATES)[pick["template"]]
    to_world, _ = _frame(dest, pick["depth"], pick["lateral"], template)
    pts = []
    for k, (x0, x1, y0, y1) in enumerate(_rects(template)):
        for (px, py) in ((x0, y0), (x1, y0), (x0, y1), (x1, y1), ((x0 + x1) / 2, (y0 + y1) / 2)):
            wx, wy = to_world(px, py)
            pts.append(["%s_%d_%d_%d" % (dest["id"], k, round(px), round(py)), round(wx, 1), round(wy, 1)])
    return pts


def build(census, probe):
    batches = {}
    placed, dropped = [], []
    domes = 0
    for dest in _destinations():
        if dest["id"] in SKIP or dest["id"] not in census:
            continue
        pick = choose(dest, census[dest["id"]])
        if pick is None:
            dropped.append({"id": dest["id"], "why": "no palace group fits and shows"})
            continue
        template = dict(TEMPLATES)[pick["template"]]
        floors = []
        for pid, wx, wy in probe_points(dest, pick):
            hit = (probe or {}).get(pid)
            if hit is not None:
                floors.append(hit)
        if probe is not None and len(floors) < 3:
            dropped.append({"id": dest["id"], "why": "no floor under the footprint", "pick": pick})
            continue
        if floors and max(floors) - min(floors) > 120.0:
            dropped.append({"id": dest["id"], "why": "floor varies %.0f cm under the footprint" % (max(floors) - min(floors)), "pick": pick})
            continue
        z = (min(floors) if floors else dest["z"]) - 15.0
        to_world, yaw = _frame(dest, pick["depth"], pick["lateral"], template)
        uses_dome = any(mid == "WL_Palace_Dome_Grand" for mid, _, _ in template)
        shell = ("MI_V2_GoldAged" if domes % 2 == 0 else "MI_V2_RoofLilac") if uses_dome else None
        domes += 1 if uses_dome else 0
        for mid, lx, ly in template:
            wx, wy = to_world(lx, ly)
            for part in KIT[mid]["parts"]:
                material = part["material"]
                if part["part"] in ("glass", "stone_dark"):
                    material = DARK
                elif part["part"] == "roof_alt" and mid == "WL_Palace_Dome_Grand":
                    material = shell
                mesh_name = part["mesh"].split(".")[-1]
                key = "%s_%s_%s" % (PASS, mesh_name.replace("WL_", ""), material.replace("MI_V2_", ""))
                b = batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material, "instances": [],
                                             "collides": part["part"] == "stone", "cast_shadow": True, "affect_df": False})
                b["instances"].append([round(wx, 1), round(wy, 1), round(z, 1), 0.0, round(yaw % 360.0, 1), 0.0, 1.0, 1.0, 1.0])
        placed.append(dict(pick, id=dest["id"], z=round(z, 1), floor_range_cm=round(max(floors) - min(floors), 1) if floors else None,
                           dome_shell=shell))
    return {"pass": PASS, "title": "District arrivals: a palace group across the view at every offered destination",
            "folder": "Wonderland/Authored/DA01", "tags": ["V2_Districts"], "actors": [], "batches": list(batches.values()),
            "placed": placed, "dropped": dropped}


if __name__ == "__main__":
    census = json.loads(CENSUS_PATH.read_text(encoding="utf-8"))["destinations"]
    if "--probe" in sys.argv:
        pts = []
        picks = {}
        for dest in _destinations():
            if dest["id"] in SKIP or dest["id"] not in census:
                continue
            pick = choose(dest, census[dest["id"]])
            picks[dest["id"]] = pick
            if pick:
                pts += probe_points(dest, pick)
        out = Path(sys.argv[sys.argv.index("--probe") + 1])
        out.write_text(json.dumps({"points": pts}), encoding="utf-8")
        for k, v in picks.items():
            print(k, v)
        print("%d probe points -> %s" % (len(pts), out))
    else:
        probe = json.loads(PROBE_PATH.read_text(encoding="utf-8")) if PROBE_PATH.exists() else None
        spec = build(census, probe)
        out = HERE / "da01_district_arrivals.json"
        out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
        print("%s: %d placed, %d dropped, %d batches, %d instances -> %s" % (PASS, len(spec["placed"]), len(spec["dropped"]),
              len(spec["batches"]), sum(len(b["instances"]) for b in spec["batches"]), out.name))
        for p in spec["placed"]:
            print("  placed", p)
        for d in spec["dropped"]:
            print("  dropped", d)
