#!/usr/bin/env python3
"""SF01 -- the city's ground floors become shopfronts under pastel awnings (2026-09-16).

THE GAP. After SC01 warmed the streets and SD01 planted them, the largest grey-box signal left at street level is the
buildings themselves: flat boxes with grids of window slots, and a blank wall at a visitor's eye height. The Bible's
streets have shops -- glass, gold trim, awnings -- at exactly that height.

WHAT. The forge's WL_House_Shopfront (7 m wide, 1.45 m deep, 3.4 m tall, made to stand against a wall) with a
WL_Market_Awning above it, on ground-floor walls that front a street.

WHERE, computed, not guessed. The walls are generator castle halls and facade panels -- batch instances with no editor
collision, so no trace can find them. building_census.py gives every one as an oriented box, and a box's vertical
faces ARE its walls. For each real street edge (street_dressing.py's definition: a tile edge with no tile beyond it):
  - only GROUND-FLOOR boxes, whose base sits at street level (upper storeys start at 3 m and would put a shop in the air);
  - only a face that FACES THE STREET, its normal within FACE_ANGLE of pointing back across the edge;
  - only a face at the edge or set back from it by no more than SETBACK, so the shop stands on the wall, not in the road;
  - only a face at least a shopfront wide;
  - one shopfront per face, centred on the edge's projection and clamped inside the face.
The chosen edges are written to sf01_edges.json, and street_dressing.py leaves those edges without planters, so a
planter never stands in front of a shop window.

    python shopfronts.py [--front +1|-1]      (writes sf01_<prefix>.json, sf01_edges.json)
"""
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import street_dressing as SD

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")
KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

SHOP = "WL_House_Shopfront"
AWNING = "WL_Market_Awning"
SHOP_W = 695.1
SHOP_D = 144.72
SHOP_H = 342.0
AWNING_D = 258.0
FACE_ANGLE = 20.0
SETBACK = (-450.0, 1200.0)      # from the street edge to the wall; see the diagnosis note in main()
# MEASURED, NOT ASSUMED. The first run allowed -30..300 and found 9 facades in 619 edges. The diagnosis: walls are
# rarely on the edge. Buildings often OVERLAP the street tile by up to ~3.6 m, or stand behind a green strip as far
# as ~17 m back (setback deciles -3496 / -2592 / -361 / 350 / 1686 uu). A shop on a wall across a short strip of
# lawn still fronts the street; one 30 m away does not.
GROUND_BAND = (-60.0, 80.0)        # a ground-floor box's base, relative to the street top
MIN_FACE = SHOP_W + 60.0
PASS = "SF01"
# THE KIT'S WALL-MODULE CONVENTION -- MEASURED IN UNREAL, NOT READ FROM THE MANIFEST. kit_modules.json says a
# shopfront spans local Y -12..+133 and the forge source says "flat back at y = 0; clips to a body's +Y face". Both
# are BLENDER space. Blender is right-handed and Unreal left-handed, so the import mirrors Y: the imported
# WL_House_Shopfront_glass actually sits at Y -94..-86 and WL_Market_Awning_roof reaches Y -256 (kitbounds, measured
# in the editor 2026-09-16). So the wall face is local Y = 0 and the SHOP FACES LOCAL -Y. Three previews to learn it:
# sf01a had the facing right but stood 72 cm off the wall; sf01b "corrected" to the manifest and turned every glazed
# front into the wall, leaving its grey back to the street; sf01c showed the glass only from cameras BEHIND a shop.
FRONT = -1.0
AWNING_Z0 = 192.46                 # the awning canopy's underside, local z


def faces_of(b):
    """The four vertical faces of an oriented box: (normal x, normal y, face centre x, y, half-width along the face)."""
    th = math.radians(b["yaw"])
    fx, fy, rx, ry = math.cos(th), math.sin(th), -math.sin(th), math.cos(th)
    out = []
    for (nx, ny, h_n, h_t) in ((fx, fy, b["hx"], b["hy"]), (-fx, -fy, b["hx"], b["hy"]),
                               (rx, ry, b["hy"], b["hx"]), (-rx, -ry, b["hy"], b["hx"])):
        out.append((nx, ny, b["x"] + nx * h_n, b["y"] + ny * h_n, h_t))
    return out


def main(front):
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    grid = defaultdict(list)
    for i, b in enumerate(buildings):
        grid[(int(b["x"] // 3000), int(b["y"] // 3000))].append(i)

    by_prefix = defaultdict(dict)
    chosen_edges = []
    used_faces = set()
    stats = defaultdict(int)
    for (t, (cx, cy), along, outward, length) in SD.real_edges(streets):
        stats["edges"] += 1
        top = t["top"]
        best = None
        gx, gy = int(cx // 3000), int(cy // 3000)
        for ix in (gx - 1, gx, gx + 1):
            for iy in (gy - 1, gy, gy + 1):
                for bi in grid.get((ix, iy), ()):
                    b = buildings[bi]
                    if not (GROUND_BAND[0] <= b["zmin"] - top <= GROUND_BAND[1]):
                        continue
                    for fi, (nx, ny, px, py, half_t) in enumerate(faces_of(b)):
                        # the face must look back across the edge, at the street
                        if nx * -outward[0] + ny * -outward[1] < math.cos(math.radians(FACE_ANGLE)):
                            continue
                        setback = (px - cx) * outward[0] + (py - cy) * outward[1]
                        if not (SETBACK[0] <= setback <= SETBACK[1]):
                            continue
                        if 2.0 * half_t < MIN_FACE:
                            continue
                        # the edge centre projected onto the face, clamped so the shop stays inside it
                        tx, ty = -ny, nx
                        along_face = (cx - px) * tx + (cy - py) * ty
                        room = half_t - SHOP_W * 0.5 - 20.0
                        if abs(along_face) > half_t:
                            continue
                        along_face = max(-room, min(room, along_face))
                        key = (bi, fi)
                        if best is None or abs(setback) < abs(best[0]):
                            best = (setback, key, px + tx * along_face, py + ty * along_face, nx, ny, b)
        if best is None:
            continue
        stats["facade_edges"] += 1
        setback, key, sx, sy, nx, ny, b = best
        if key in used_faces:
            stats["face_already_used"] += 1
            continue
        used_faces.add(key)
        prefix = t["label"].split("_")[0]
        batches = by_prefix[prefix]
        # the shop's own frame: its long side along the wall, its window toward the street (the face normal)
        yaw = math.degrees(math.atan2(ny, nx)) - 90.0 * front
        shop_x, shop_y = sx, sy
        for part in KIT[SHOP]["parts"]:
            k = "%s_%s_Shop_%s" % (PASS, prefix, part["part"])
            # the glass gets a rough, warm, lit material: the kit's GlassAmber mirrors grey walls at eye level
            material = "MI_V2_ShopGlow" if part["part"] == "glass" else part["material"]
            bt = batches.setdefault(k, {"id": k, "mesh": part["mesh"], "material": material, "instances": [],
                                        "collides": False, "cast_shadow": True, "affect_df": False})
            bt["instances"].append([round(shop_x, 1), round(shop_y, 1), round(top, 1), 0.0, round(yaw % 360, 1), 0.0, 1.0, 1.0, 1.0])
        aw_x, aw_y = sx, sy
        for part in KIT[AWNING]["parts"]:
            k = "%s_%s_Awning_%s" % (PASS, prefix, part["part"])
            bt = batches.setdefault(k, {"id": k, "mesh": part["mesh"], "material": part["material"], "instances": [],
                                        "collides": False, "cast_shadow": True, "affect_df": False})
            # canopy underside 20 cm above the shop's top
            bt["instances"].append([round(aw_x, 1), round(aw_y, 1), round(top + SHOP_H + 20.0 - AWNING_Z0, 1), 0.0,
                                    round(yaw % 360, 1), 0.0, 1.0, 1.0, 1.0])
        chosen_edges.append([t["label"], round(cx, 1), round(cy, 1)])
        stats["shops"] += 1
    for prefix, batches in by_prefix.items():
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "SF01 %s: shopfronts and awnings on street-facing ground floors" % prefix,
                 "tags": ["SF01"], "actors": [], "batches": list(batches.values())}
        (HERE / ("sf01_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    (HERE / "sf01_edges.json").write_text(json.dumps(chosen_edges), encoding="utf-8", newline="\n")
    return stats, {p: sum(len(b["instances"]) for b in bs.values()) for p, bs in by_prefix.items()}


if __name__ == "__main__":
    front = float(sys.argv[sys.argv.index("--front") + 1]) if "--front" in sys.argv else FRONT
    stats, per = main(front)
    print(dict(stats))
    print(per)
