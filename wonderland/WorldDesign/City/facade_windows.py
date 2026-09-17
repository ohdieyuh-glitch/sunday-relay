#!/usr/bin/env python3
"""FD02 -- the city's blank street walls get arched windows (2026-09-16).

THE GAP, MEASURED. Of 748 street-facing wall faces that stand at street level with no other building in front of
them, 430 had no window at all (57%): castle halls a median 8 m wide and 9 m tall, blank from the paving to the
parapet, in every district (South 65, FillNE 57, FillEMC 44, SW 42, ...). FD01 dressed the faces that HAD windows;
these had nothing to dress. At a street camera a blank 9 m ashlar wall is the loudest grey-box signal left.

WHAT. The forge's WL_Detail_Window_Arched (bdd2e947): a flat-backed clip-on -- surround panel, jambs, sill, round
voussoirs, label moulding, gold keystone, glass in the recess. 2.21 m wide, 3.27 m tall, 376 tris. Mirrored kit, as
SF01 measured: it projects toward LOCAL -Y in Unreal with its back at y = 0, so yaw = normal + 90.

WHERE. Only SM_castle_hall faces (arcades have openings of their own; gatehouses are landmarks), and only a face that
  - has no window pane on it (pane_census.py) -- FD01's faces are the others;
  - looks onto a street tile within 3..12 m, and whose bottom is at street level;
  - is wide enough for one window with EDGE margin at each end.
Windows stand in storey rows: a ground row with its opening at 0.9 m (skipped wherever a shopfront or its awning is
within SHOP_CLEAR along the wall), then rows every STOREY up while a whole window fits under the face's top.
Columns are centred at PITCH. Each window is tested where it stands: nothing of another building within FRONT_PROBE
in front of it, and no raised prop (a gold balustrade band, an arch hood) overlapping it.
Glass: most windows get MI_V2_WindowArch, a copy of the city's dark sky-reflecting MI_V2_WindowDark (WIN01) --
its own copy because the first preview (fd02a) showed WIN01's stretched normals as blotches across a 1 x 2 m light,
and the 12k generator panes it was tuned for must not move; LIT_SHARE of them, by a hash of position, keep the kit's
warm GlassAmber, so a wall reads as lived in rather than as one repeated tile.

FD03 (--upper) is the same window on the faces FD02 leaves alone because they do not start at street level: upper
storeys set on a lower block, facade panels and square towers, 3 to 19 m up. Measured: of the street-facing upper faces
nothing stands in front of, 694 were blank (castle halls 457, facade panels 175, square towers 59). Rows start just
above the face's own bottom; the in-front test is made at each window's own height.

    python facade_windows.py            (FD02: writes fd02_<prefix>.json)
    python facade_windows.py --upper    (FD03: writes fd03_<prefix>.json)
"""
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

import facade_dressing as F
import street_dressing as SD
from shopfronts import faces_of

HERE = Path(__file__).resolve().parent
KIT = F.KIT
TMP = F.TMP

PASS = "FD02"
WINDOW = "WL_Detail_Window_Arched"
WALL_MESHES = ("SM_castle_hall",)
UPPER_MESHES = ("SM_castle_hall", "SM_facade_panel", "SM_castle_tower_square")
UPPER_MAX = 2500.0              # an upper face's bottom above the street top; higher than this is skyline, not street
UPPER_OPENING = 90.0            # an upper row's opening above the face's own bottom
# FD03 IS A SET, NOT ONE TILE. 2,992 identical arched windows over the upper storeys would read as repetition. Each
# upper face takes its body window by a hash of the face -- the arched window or a pair of pointed lancets -- and its
# TOP row, and any face with room for only one column, takes a round oculus (forge 6729007f).
LANCET = "WL_Detail_Window_LancetPair"
OCULUS = "WL_Detail_Window_Oculus"
OCULUS_LIFT = 70.0              # the oculus's centre (0.96 m local) level with the arched window's middle
MODULE_TAG = {WINDOW: "Arched", LANCET: "Lancet", OCULUS: "Oculus"}
HALF_W = 110.5                  # half the module's width
TOP = 327.0                     # its height
OPENING_Z = 30.0                # local z of the opening's bottom
GROUND_OPENING = 90.0           # the ground row's opening above the street top
STOREY = 370.0
PITCH = 290.0
EDGE = 60.0                     # from a face's end to a window's surround
ROOF_CLEAR = 40.0               # a window's top below the face's top
PANE_ON_FACE = 150.0
SHOP_CLEAR = 520.0              # along the wall, shop centre to window centre (shop half-width 347 + surround 110 + gap)
SHOP_TOP = 480.0                # a shopfront's awning reaches ~4.7 m; a window below this over a shop is skipped
FRONT_PROBE = 200.0
LIT_SHARE = 0.25
GLASS_DARK = "MI_V2_WindowArch"   # its own copy of WindowDark: at 1 x 2 m the shared tune's stretched normals read as blotches
CULL = 9000.0


def main(upper=False):
    pass_id = "FD03" if upper else PASS
    meshes = UPPER_MESHES if upper else WALL_MESHES
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    panes = json.loads((TMP / "pane_census.json").read_text(encoding="utf-8"))["panes"]
    shops = F.shop_points()
    rows = json.loads(F.PROPS.read_text(encoding="utf-8"))
    raised = [r for r in (rows["rows"] if isinstance(rows, dict) else rows) if r["zmin"] > F.PROP_RAISED]
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))
    pg = F.grid_of(panes, lambda p: ((p["bmin"][0] + p["bmax"][0]) * 0.5, (p["bmin"][1] + p["bmax"][1]) * 0.5))
    shg = F.grid_of(shops, lambda p: p)
    rg = F.grid_of(raised, lambda r: (r["x"], r["y"]))
    stats = Counter()

    def street_at(x, y):
        for j in F.around(sg, x, y):
            if SD.inside(streets[j], x, y):
                return streets[j]
        return None

    by_prefix = defaultdict(dict)
    for bi, b in enumerate(buildings):
        if b["mesh"] not in meshes:
            continue
        for fi, (nx, ny, fx, fy, half_t) in enumerate(faces_of(b)):
            tile = next((t for t in (street_at(fx + nx * d, fy + ny * d) for d in F.STREET_PROBES) if t), None)
            if tile is None:
                continue
            top = tile["top"]
            rise = b["zmin"] - top
            if not upper and rise > 150.0:
                stats["face_not_at_street_level"] += 1
                continue
            if upper and not (150.0 < rise <= UPPER_MAX):
                stats["face_at_street_level_or_skyline"] += 1
                continue
            has_pane = False
            for j in F.around(pg, fx, fy):
                p = panes[j]
                cx, cy = (p["bmin"][0] + p["bmax"][0]) * 0.5, (p["bmin"][1] + p["bmax"][1]) * 0.5
                if (abs((cx - fx) * nx + (cy - fy) * ny) < PANE_ON_FACE and abs((cx - fx) * -ny + (cy - fy) * nx) <= half_t + 40.0
                        and b["zmin"] - 50.0 <= p["bmin"][2] <= b["zmax"]):
                    has_pane = True
                    break
            if has_pane:
                stats["face_has_windows"] += 1
                continue
            usable = 2.0 * half_t - 2.0 * (EDGE + HALF_W)
            if usable < 0.0:
                stats["face_too_narrow"] += 1
                continue
            cols = int(usable // PITCH) + 1
            tx, ty = -ny, nx
            offsets = [(i - (cols - 1) * 0.5) * PITCH for i in range(cols)]
            # shops on this wall: their positions along it
            shop_along = [(shops[s][0] - fx) * tx + (shops[s][1] - fy) * ty for s in F.around(shg, fx, fy)
                          if abs((shops[s][0] - fx) * nx + (shops[s][1] - fy) * ny) < 250.0]
            origins = [(b["zmin"] + UPPER_OPENING if upper else top + GROUND_OPENING) - OPENING_Z]
            z = origins[0] + STOREY + 20.0
            if upper and origins[0] + TOP + ROOF_CLEAR > b["zmax"]:   # FD02's ground row was applied without this
                stats["face_too_short"] += 1
                continue
            while z + TOP + ROOF_CLEAR <= b["zmax"]:
                origins.append(z)
                z += STOREY
            stats["faces"] += 1
            prefix = tile["label"].split("_")[0]
            body_module = WINDOW if (not upper or F.hash01(fx, fy, 53) < 0.5) else LANCET
            for row, oz in enumerate(origins):
                if not upper:
                    module = WINDOW
                elif cols == 1 or (len(origins) >= 3 and row == len(origins) - 1):   # 2-row faces: an oculus on half the wall was not an accent
                    module = OCULUS
                else:
                    module = body_module
                for off in offsets:
                    x, y = fx + tx * off, fy + ty * off
                    if oz - top < SHOP_TOP and any(abs(a - off) < SHOP_CLEAR for a in shop_along):
                        stats["over_a_shop"] += 1
                        continue
                    px, py = x + nx * FRONT_PROBE, y + ny * FRONT_PROBE
                    if any(bj != bi and F.inside_box(buildings[bj], px, py, oz + TOP * 0.5, slack=0.0)
                           for bj in F.around(bg, px, py)):
                        stats["another_building_in_front"] += 1
                        continue
                    if any(math.hypot(raised[j]["x"] - x, raised[j]["y"] - y) < raised[j]["radius"] + 60.0
                           and raised[j]["zmin"] < oz + TOP - F.PROP_OVERLAP and raised[j]["zmax"] > oz + 40.0
                           for j in F.around(rg, x, y)):
                        stats["raised_prop_in_the_way"] += 1
                        continue
                    yaw = (math.degrees(math.atan2(ny, nx)) + 90.0) % 360.0
                    lit = F.hash01(x, y, oz, 13) < LIT_SHARE
                    wz = oz + (OCULUS_LIFT if module == OCULUS else 0.0)
                    for part in KIT[module]["parts"]:
                        material = part["material"]
                        key = part["part"]
                        if key == "glass":
                            material = part["material"] if lit else GLASS_DARK
                            key = "glass_lit" if lit else "glass"
                        # FD02 keeps its original batch ids (its layers are saved in the map by id)
                        k = ("%s_%s_Window_%s" % (pass_id, prefix, key) if not upper
                             else "%s_%s_%s_%s" % (pass_id, prefix, MODULE_TAG[module], key))
                        bt = by_prefix[prefix].setdefault(k, {"id": k, "mesh": part["mesh"], "material": material,
                                                              "instances": [], "collides": False, "cast_shadow": True,
                                                              "affect_df": False, "cull_distance": CULL})
                        bt["instances"].append([round(x, 1), round(y, 1), round(wz, 1), 0.0, round(yaw, 1), 0.0, 1.0, 1.0, 1.0])
                    stats["windows"] += 1
                    stats[MODULE_TAG[module]] += 1
                    stats["lit" if lit else "dark"] += 1
    stem = pass_id.lower()
    for old in HERE.glob("%s_*.json" % stem):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        layer = {"pass": "%s_%s" % (pass_id, prefix),
                 "title": "%s %s: arched windows on blank street-facing %s walls" % (pass_id, prefix, "upper-storey" if upper else "castle-hall"),
                 "tags": [pass_id], "actors": [], "batches": list(batches.values())}
        (HERE / ("%s_%s.json" % (stem, prefix.lower()))).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats, {p: sum(len(b["instances"]) for b in bs.values() if b["id"].endswith("_stone")) for p, bs in by_prefix.items()}


if __name__ == "__main__":
    import sys
    stats, per = main(upper="--upper" in sys.argv)
    print(dict(stats))
    print(per)
