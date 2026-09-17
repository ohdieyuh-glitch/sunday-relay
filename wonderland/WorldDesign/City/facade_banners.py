#!/usr/bin/env python3
"""FD04 -- banners hang off the street walls (2026-09-16).

THE GAP. After FD01-FD03 the walls have windows, balconies and bays, but a street seen along its length still shows
walls edge-on: pale, and all the same colour. The Bible's streets hang colour off their walls (BOARD_2 "Signs &
Banners") on brackets that project into the street, so the colour is seen down the street's length.

WHAT. The forge's WL_Detail_Banner_Blade (wonderland-blender-forge 46224bb3): a gold wall rosette and rod, a scrolled
brace, a swallowtail blade with a top stripe and a gold emblem. 3.71 m tall, projecting 1.57 m. Mirrored kit, as SF01
measured: it projects toward LOCAL -Y in Unreal with the rosette at y = 0, so yaw = normal + 90.

WHERE. On building faces (building_census) whose bottom is at street level and that look onto a street tile, a face at
least MIN_FACE wide gets at most one banner, near one of its ends (chosen by a hash of the face), so a banner reads as
marking a corner or a doorway rather than standing in the middle of a wall. Every banner is tested where it stands:
  - its blade clears the head: the rod at ROD_ABOVE over the street top, the blade's tail ~2.3 m up;
  - no shopfront within SHOP_CLEAR along the wall (the awning reaches ~4.7 m and projects 2.6 m);
  - no FD01 balcony or oriel, and no FD02/FD03 window, within FEATURE_CLEAR (read from their layer files);
  - no other building within the blade's projection, and no raised prop overlapping it;
  - no other banner within SPACING, so a street gets a rhythm and not a fence.
Colour: the blade and its stripe take one of PALETTE by a hash of position -- the Bible's pastel rose, lavender and
blue, with a contrasting stripe.

    python facade_banners.py            (writes fd04_<prefix>.json)
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

PASS = "FD04"
BANNER = "WL_Detail_Banner_Blade"
ROD_LOCAL = 300.0               # the module's rod height
ROD_ABOVE = 530.0               # the rod above the street top: blade tail at ~2.3 m, clear of heads and the Dog
MIN_FACE = 600.0
END_INSET = 25.0                # the rosette's centre from the face's end (its own radius is 22)
SHOP_CLEAR = 520.0
FEATURE_CLEAR = {"Balcony": 40.0, "Oriel": 40.0, "Window": 35.0}   # beyond a feature's half-width, along the wall.
# The first run used 170 for everything and placed 37 banners (308 refused): a blade is a thin plane projecting
# straight out, so beside a window it only needs to clear the surround, which stands 37 cm off the wall.
SPACING = 850.0                 # fd04a: one banner per face end, 1400 apart -- too sparse to see from a street camera
ALONG_STEP = 900.0              # candidate positions along a wall, from each end inward
PROJECT = 160.0
SHARE = 0.85                    # of eligible faces
PALETTE = (                     # (blade, stripe). fd04a used the flower petal instances: foliage materials that
    ("MI_V2_BannerRose", "MI_V2_Gold"),       # washed out near-white at a street's distance and added no colour.
    ("MI_V2_BannerLavender", "MI_V2_Gold"),   # The banner instances are flat copies of MI_V2_Ceramic, saturated.
    ("MI_V2_BannerBlue", "MI_V2_Gold"),
    ("MI_V2_BannerTeal", "MI_V2_Ceramic"),
)
CULL = 9000.0
FEATURE_LAYERS = ("fd01_*.json", "fd02_*.json", "fd03_*.json")
FEATURE_HALF = {"Balcony": 242.0, "Oriel": 176.0, "Window": 110.5}


def features():
    """Every FD01-FD03 feature as (x, y, zlow, zhigh, half-width along its wall plus its clearance)."""
    out = []
    for pattern in FEATURE_LAYERS:
        for f in HERE.glob(pattern):
            for bt in json.loads(f.read_text(encoding="utf-8"))["batches"]:
                kind = next((k for k in FEATURE_HALF if "_%s_" % k in bt["id"]), None)
                if kind is None or not (bt["id"].endswith("_stone")):
                    continue
                for i in bt["instances"]:
                    out.append((i[0], i[1], i[2], i[2] + 700.0, FEATURE_HALF[kind] + FEATURE_CLEAR[kind]))
    return out


def main():
    streets = json.loads((TMP / "street_census.json").read_text(encoding="utf-8"))
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    shops = F.shop_points()
    feats = features()
    rows = json.loads(F.PROPS.read_text(encoding="utf-8"))
    raised = [r for r in (rows["rows"] if isinstance(rows, dict) else rows) if r["zmin"] > F.PROP_RAISED]
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    sg = F.grid_of(streets, lambda t: (t["x"], t["y"]))
    shg = F.grid_of(shops, lambda p: p)
    fg = F.grid_of(feats, lambda q: (q[0], q[1]))
    rg = F.grid_of(raised, lambda r: (r["x"], r["y"]))
    stats = Counter()
    placed = []
    by_prefix = defaultdict(dict)

    def street_at(x, y):
        for j in F.around(sg, x, y):
            if SD.inside(streets[j], x, y):
                return streets[j]
        return None

    for bi, b in enumerate(buildings):
        for fi, (nx, ny, fx, fy, half_t) in enumerate(faces_of(b)):
            if 2.0 * half_t < MIN_FACE:
                continue
            tile = next((t for t in (street_at(fx + nx * d, fy + ny * d) for d in F.STREET_PROBES) if t), None)
            if tile is None:
                continue
            top = tile["top"]
            if b["zmin"] - top > 150.0 or b["zmax"] - top < ROD_ABOVE + 120.0:
                stats["face_not_a_street_wall"] += 1
                continue
            if F.hash01(fx, fy, 29) >= SHARE:
                stats["face_left_plain"] += 1
                continue
            tx, ty = -ny, nx
            end = 1.0 if F.hash01(fx, fy, 31) < 0.5 else -1.0
            offsets = []
            o = half_t - END_INSET
            while o > -(half_t - END_INSET) - 1.0:
                offsets.append(end * o)
                o -= ALONG_STEP
            for off in offsets:
                x, y = fx + tx * off, fy + ty * off
                rod_z = top + ROD_ABOVE
                oz = rod_z - ROD_LOCAL
                if any(math.hypot(shops[s][0] - x, shops[s][1] - y) < SHOP_CLEAR for s in F.around(shg, x, y)):
                    stats["near_a_shop"] += 1
                    continue
                clash = False
                for j in F.around(fg, x, y):
                    q = feats[j]
                    along = abs((q[0] - x) * tx + (q[1] - y) * ty)
                    normal = abs((q[0] - x) * nx + (q[1] - y) * ny)
                    if normal < 300.0 and along < q[4] and q[2] < oz + 371.0 and q[3] > oz:
                        clash = True
                        break
                if clash:
                    stats["next_to_a_window_or_balcony"] += 1
                    continue
                px, py = x + nx * PROJECT, y + ny * PROJECT
                if any(bj != bi and F.inside_box(buildings[bj], px, py, rod_z - 100.0) for bj in F.around(bg, px, py)):
                    stats["another_building_in_front"] += 1
                    continue
                mx, my = x + nx * 80.0, y + ny * 80.0
                if any(math.hypot(raised[j]["x"] - mx, raised[j]["y"] - my) < raised[j]["radius"] + 60.0
                       and raised[j]["zmin"] < oz + 371.0 - F.PROP_OVERLAP and raised[j]["zmax"] > oz + 40.0
                       for j in F.around(rg, mx, my)):
                    stats["raised_prop_in_the_way"] += 1
                    continue
                if any(math.hypot(q[0] - x, q[1] - y) < SPACING for q in placed):
                    stats["too_close_to_another_banner"] += 1
                    continue
                placed.append((x, y))
                yaw = (math.degrees(math.atan2(ny, nx)) + 90.0) % 360.0
                blade, stripe = PALETTE[int(F.hash01(x, y, 37) * len(PALETTE)) % len(PALETTE)]
                prefix = tile["label"].split("_")[0]
                for part in KIT[BANNER]["parts"]:
                    material = {"roof_alt": blade, "roof": stripe}.get(part["part"], part["material"])
                    k = "%s_%s_Banner_%s_%s" % (PASS, prefix, part["part"], material.replace("MI_V2_", ""))
                    bt = by_prefix[prefix].setdefault(k, {"id": k, "mesh": part["mesh"], "material": material, "instances": [],
                                                          "collides": False, "cast_shadow": True, "affect_df": False,
                                                          "cull_distance": CULL})
                    bt["instances"].append([round(x, 1), round(y, 1), round(oz, 1), 0.0, round(yaw, 1), 0.0, 1.0, 1.0, 1.0])
                stats["banners"] += 1
    for old in HERE.glob("fd04_*.json"):
        old.unlink()
    for prefix, batches in sorted(by_prefix.items()):
        layer = {"pass": "%s_%s" % (PASS, prefix), "title": "FD04 %s: blade banners on street walls" % prefix,
                 "tags": [PASS], "actors": [], "batches": list(batches.values())}
        (HERE / ("fd04_%s.json" % prefix.lower())).write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
