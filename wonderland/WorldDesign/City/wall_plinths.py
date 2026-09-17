#!/usr/bin/env python3
"""WB01 -- the city's walls stand on a plinth course (2026-09-17).

THE GAP (founder material-realism phase, contact depth). A contact survey of street-level wall bases
(evidence 2026-09-17-WB01) found every generator wall meeting the paving on one hard line: no base course, no change
of material, no shadow line -- a box set down on a floor.

FIRST CUT, REVERTED. 4 m runs of a jointless band (WL_Detail_Plinth_Run, 8bb3097b) grounded the walls at close range
but read as a poured concrete kerb, and ran straight across the arches and gates built against the walls. (It was
tagged PL01, which an older castle pass already uses; this pass is WB01.)

WHAT. The forge's WL_Detail_Plinth_Block (5a9e5b4d): one 1 m block, 48 cm tall, 9 cm proud, chamfered top and ends,
36 tris. Each face's course is laid BLOCK BY BLOCK at 0.8-1.25 m (seeded per face, so the design reproduces), and the
master's per-object tone variation gives every block its own stone. Flat back at y = 0; the FBX import mirrors Y (as
SF01 measured), so in Unreal it projects toward local -Y and yaw = normal + 90.

WHERE. Every face of a castle hall, facade panel or square tower (building_census) that
  - is at least MIN_FACE wide,
  - fronts a street or plaza tile within 3..12 m (street_census),
  - has its base at street level (within BASE_BAND of the tile's top),
  - has no other building standing in front of it.
Each face gets one course, extended by the projection at both ends so two faces meet at an outside corner. The course
skips the span of an SF01 shopfront on that wall (the shop's own stone base stands there) and of any arch, gate, gate
pier, gatehouse or flight of steps set against the wall (city_props): a plinth does not run through a doorway.

SEATED ON THE REAL WALL AND GROUND. A census box face is not the wall: cornices, balconies and upper storeys overhang, so
at its foot a castle hall's wall stands 30-38 cm (local) inside its box and a facade panel's front 56 cm inside. The
second preview stood courses out in the street like troughs. So each face is seated on its mesh's own cross-section at
the foot (mesh_sections.py -> wall_sections.json, via wall_seat.py): the course's back goes on the true wall plane,
and its span is the true wall's length. Heights: the street tile's top, unless a ground trace at the block (wall_contact_probe.py ->
wb01_contact.json, run on this generator's own output) found the paving there lower or higher by up to 40 cm / 5 cm.

    python wall_plinths.py            (writes wb01_<prefix>.json)
"""
import json
import math
import random
from collections import Counter, defaultdict
from pathlib import Path

import facade_dressing as F
import wall_seat as WS
import street_dressing as SD
from shopfronts import SHOP_W, faces_of

HERE = Path(__file__).resolve().parent
KIT = F.KIT
TMP = F.TMP

PASS = "WB01"
PLINTH = "WL_Detail_Plinth_Block"
BLOCK = 100.0                    # the module's length
BLOCK_MIN, BLOCK_MAX = 80.0, 125.0
PROJ = 11.0
MIN_FACE = 300.0
BASE_BAND = 60.0
WALL_MESHES = ("SM_castle_hall", "SM_facade_panel", "SM_castle_tower_square")
SHOP_HALF = SHOP_W * 0.5 + 10.0
CULL = 6000.0
MATERIALS = {"stone": "MI_V2_IvoryStone"}
SEAT_LEVEL = "5.0"               # the cross-section 5 cm above the mesh's foot (wall_seat.py)
CONTACT = "wb01_contact.json"
GROUND_MESHES = ("SM_terrace_platform", "Cube")
GROUND_BAND = (-40.0, 5.0)
OPENINGS = ("SM_garden_arch_stone", "SM_gate_leaf", "SM_gate_pier", "SM_arch_stone", "SM_gatehouse_district",
            "SM_floral_arch", "SM_side_steps", "SM_path_steps")
OPENING_MARGIN = 15.0


def block_widths(length, rng):
    """Block lengths in [BLOCK_MIN, BLOCK_MAX]-ish that sum exactly to `length` (one block for a short piece)."""
    n = max(1, int(round(length / ((BLOCK_MIN + BLOCK_MAX) * 0.5))))
    w = [rng.uniform(BLOCK_MIN, BLOCK_MAX) for _ in range(n)]
    k = length / sum(w)
    return [x * k for x in w]


def spans_minus(lo, hi, holes):
    """[lo, hi] with every (a, b) hole removed: the pieces that remain, in order."""
    out = [(lo, hi)]
    for a, b in sorted(holes):
        nxt = []
        for s, e in out:
            if b <= s or a >= e:
                nxt.append((s, e))
                continue
            if a > s:
                nxt.append((s, a))
            if b < e:
                nxt.append((b, e))
        out = nxt
    return [(s, e) for s, e in out if e - s >= 40.0]


def main():
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    shops = F.shop_points()
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))
    shg = F.grid_of(shops, lambda p: p)
    props = json.loads((TMP / "city_props.json").read_text(encoding="utf-8"))
    props = props["rows"] if isinstance(props, dict) else props
    openings = [q for q in props if q["mesh"] in OPENINGS]
    og = F.grid_of(openings, lambda q: (q["x"], q["y"]))
    contact_path = TMP / CONTACT
    contact = json.loads(contact_path.read_text(encoding="utf-8")) if contact_path.exists() else {}
    stats = Counter()
    by_prefix = defaultdict(dict)

    def street_at(x, y):
        for j in F.around(sg, x, y):
            if SD.inside(streets[j], x, y):
                return streets[j]
        return None

    for bi, b in enumerate(buildings):
        if b["mesh"] not in WALL_MESHES:
            continue
        seats = WS.seats(b, SEAT_LEVEL)
        for fi, (nx, ny, fx, fy, half_t) in enumerate(faces_of(b)):
            depth, t_lo, t_hi = seats[fi]
            if t_hi - t_lo < MIN_FACE:
                continue
            tile = next((t for t in (street_at(fx + nx * d, fy + ny * d) for d in F.STREET_PROBES) if t), None)
            if tile is None:
                continue
            top = tile["top"]
            if abs(b["zmin"] - top) > BASE_BAND:
                stats["base_not_at_street_level"] += 1
                continue
            px, py = fx + nx * 150.0, fy + ny * 150.0
            if any(bj != bi and F.inside_box(buildings[bj], px, py, top + 100.0) for bj in F.around(bg, px, py)):
                stats["building_in_front"] += 1
                continue
            tx, ty = -ny, nx
            holes = []
            for s in F.around(shg, fx, fy):
                sx, sy = shops[s]
                if abs((sx - fx) * nx + (sy - fy) * ny) < 250.0:
                    a = (sx - fx) * tx + (sy - fy) * ty
                    holes.append((a - SHOP_HALF, a + SHOP_HALF))
            for o in F.around(og, fx, fy):
                q = openings[o]
                r = q["radius"]
                d = (q["x"] - fx) * nx + (q["y"] - fy) * ny
                if -r <= d <= r + 60.0 and q["zmin"] < top + 150.0:
                    a = (q["x"] - fx) * tx + (q["y"] - fy) * ty
                    if abs(a) <= half_t + r:
                        holes.append((a - r - OPENING_MARGIN, a + r + OPENING_MARGIN))
                        stats["opening_holes"] += 1
            fx, fy = fx - nx * depth, fy - ny * depth
            stats["seated_depth_cm_x10"] += int(round(depth * 10))
            pieces = spans_minus(t_lo - PROJ, t_hi + PROJ, holes)
            if not pieces:
                stats["face_all_shop"] += 1
                continue
            stats["faces"] += 1
            yaw = (math.degrees(math.atan2(ny, nx)) + 90.0) % 360.0
            prefix = tile["label"].split("_")[0]
            rng = random.Random("%s:%d:%d" % (PASS, bi, fi))
            for (s0, s1) in pieces:
                c0 = s0
                for seg in block_widths(s1 - s0, rng):
                    c = c0 + seg * 0.5
                    c0 += seg
                    x, y = fx + tx * c, fy + ty * c
                    z = top
                    g = contact.get("%.1f,%.1f" % (round(x, 1), round(y, 1)))
                    if g and g.get("ground_mesh") in GROUND_MESHES and GROUND_BAND[0] <= g["ground"] - top <= GROUND_BAND[1]:
                        z = g["ground"]
                        stats["ground_from_trace"] += 1
                    for part in KIT[PLINTH]["parts"]:
                        k_id = "%s_%s_Plinth_%s" % (PASS, prefix, part["part"])
                        bt = by_prefix[prefix].setdefault(k_id, {"id": k_id, "mesh": part["mesh"], "material": MATERIALS[part["part"]],
                                                                 "instances": [], "collides": False, "cast_shadow": True,
                                                                 "affect_df": False, "cull_distance": CULL})
                        bt["instances"].append([round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw, 1), 0.0,
                                                round(seg / BLOCK, 4), 1.0, 1.0])
                    stats["blocks"] += 1
    for old in list(HERE.glob("pl01_*.json")) + list(HERE.glob("wb01_*.json")):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "WB01 %s: plinth courses at the foot of street walls" % prefix,
                 "tags": [PASS], "actors": [], "batches": list(batches.values())}
        (HERE / ("wb01_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
