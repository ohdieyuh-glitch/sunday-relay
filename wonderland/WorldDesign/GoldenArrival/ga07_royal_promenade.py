#!/usr/bin/env python3
"""GA07 -- the royal promenade: ornament laid into the arrival plaza and the garden path.

WHAT THE BIBLE SHOWS (VISUAL_AUTHORITY.md; bible_panels.json paths_b4, paths_b5, hero_b1). The walks are pale
stone laid with intent: border courses, inlaid bands, circular medallions at the places a walk pauses. The
ground reads as an expensive royal promenade, not as tiles.

WHAT WAS THERE (founder, 2026-09-13: "the foreground paving still reads too much like a clean modular tile
grid"). The arrival plaza is a grid of 1.3 m cream, warm and grey slabs (tops z 12.0-12.6, PIE probe
2026-09-13); the garden path is pale flags (tops z 6.9-10.7) between low retaining walls at x +/-250.

WHAT THIS LAYER ADDS, all flush and without collision so walking is untouched:
  GOLD BORDERS   a continuous gold inlay course 18 cm wide along both edges of the plaza's central lane
                 (x +/-372) and along both edges of the garden path (x +/-222), 2 cm proud of the stone.
  ROSE BANDS     rose-stone cross-bands, 64 cm wide, across the central lane every 4.8 m, each framed
                 by two thin gold lines -- the rhythm a walker reads underfoot and the camera reads in depth.
  MEDALLIONS     laid in courses of short stones: a gold outer ring, a rose-stone band, a gold inner ring and a gold
                 compass cross -- 6 m on the plaza where the lane meets the garden (y 700), and 3.8 m twice on the
                 garden path
                 at its pauses (y 1650 past the heart arch, y 2050 before the gold screens), where the flags are level.
The portal ring and the arrival spawn (y -150..0) stay bare; the GA05 planters and the pocket clock are not
crossed.

MEASURED INPUTS. Probe 186 (89 points): plaza slab tops 12.0-12.6 -> plaza ornament base z 12.8; path flag
tops 6.9-10.7 -> path pieces follow the probed top per segment + 0.3. Mesh sizes: SM_kerb_stone extent
60 x 18.1 x 14.1 (1x); medallion 900 x 900 x 10 (kit_modules.json).
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "GA07"
V2 = "/Game/WonderlandV2/"
KERB = V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone"
# The medallion's parts and their V2 materials, read from the kit snapshot (a part's mesh is named by its part,
# so they are not guessed from the asset id).
_KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
MEDALLION = [(part["part"], part["mesh"], part["material"]) for part in _KIT["WL_Ground_Plaza_Medallion"]["parts"]]

# MQ02 (2026-09-13) laid the plaza in flagstone fields 5.0-5.9 cm proud on a 12.3 datum: the plaza ornament is
# re-laid on the stone tops (was 12.8 on the V2 slabs).
PLAZA_BASE = 18.3
LANE_EDGE = 372.0
LANE_Y = (-1320.0, 820.0)
BAND_YS = [-1120.0 + 480.0 * k for k in range(5)]     # -1120 .. 800, every 4.8 m
BARE_Y = (-420.0, 260.0)                              # the spawn and the portal ring stay bare
PATH_EDGE = 222.0
# garden path flag tops by segment (probe 186, x = 0)
PATH_TOPS = [(1000.0, 9.2), (1300.0, 9.2), (1600.0, 9.1), (1900.0, 9.1), (2200.0, 8.7), (2500.0, 6.9), (2800.0, 10.7)]
PATH_Y = (1040.0, 2980.0)


def _path_top(y):
    best = min(PATH_TOPS, key=lambda t: abs(t[0] - y))
    return best[1]


def build():
    batches = {}

    def inst(key, mesh, material, x, y, z, yaw, sx, sy, sz):
        b = batches.setdefault(key, {"id": key, "mesh": mesh, "material": material, "instances": [], "collides": False,
                                     "cast_shadow": False, "affect_df": False})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, round(yaw, 1), 0.0, round(sx, 3), round(sy, 3), round(sz, 3)])

    # A kerb stone at scale (sx, sy, sz) is 120*sx long (local X), 36.2*sy wide, 28.2*sz tall from z 0.
    def strip_along_y(key, material, x, y0, y1, width, z_of, height=2.0):
        n = max(1, int(round((y1 - y0) / 118.0)))
        step = (y1 - y0) / n
        for i in range(n):
            y = y0 + step * (i + 0.5)
            inst(key, KERB, material, x, y, z_of(y), 90.0, step / 120.0 * 1.01, width / 36.2, height / 28.2)

    def strip_along_x(key, material, y, x0, x1, width, z, height=2.0):
        n = max(1, int(round((x1 - x0) / 118.0)))
        step = (x1 - x0) / n
        for i in range(n):
            inst(key, KERB, material, x0 + step * (i + 0.5), y, z, 0.0, step / 120.0 * 1.01, width / 36.2, height / 28.2)

    plaza_z = lambda y: PLAZA_BASE
    # ---- plaza: gold borders along the lane, broken where the spawn and portal stand
    for side in (1.0, -1.0):
        for (y0, y1) in ((LANE_Y[0], BARE_Y[0]), (BARE_Y[1], LANE_Y[1])):
            strip_along_y("LaneBorderGold", "MI_V2_Gold", side * LANE_EDGE, y0, y1, 18.0, plaza_z)
    # ---- plaza: blush cross-bands framed in gold
    for y in BAND_YS:
        if BARE_Y[0] - 60.0 <= y <= BARE_Y[1] + 60.0:
            continue
        # MarbleBlush matched the cream slabs too closely to read (capture ga07); the rose stone of the roofs does.
        strip_along_x("LaneBandRose", "MI_V2_RoofRose", y, -LANE_EDGE + 9.0, LANE_EDGE - 9.0, 64.0, PLAZA_BASE, 1.6)
        for dy in (-38.0, 38.0):
            strip_along_x("LaneBandGold", "MI_V2_Gold", y + dy, -LANE_EDGE + 9.0, LANE_EDGE - 9.0, 6.0, PLAZA_BASE, 2.0)

    # ---- garden path: gold borders following the flags
    for side in (1.0, -1.0):
        strip_along_y("PathBorderGold", "MI_V2_Gold", side * PATH_EDGE, PATH_Y[0], PATH_Y[1], 14.0, lambda y: _path_top(y) - 0.5)

    # ---- medallions, laid in courses. The forge medallion flattened to 2.5 cm showed only its cream top and read
    # as a blank pale disc on the path (capture ga07), so each medallion is built from rings of short kerb stones:
    # a gold outer ring, a rose-stone band, a gold inner ring and a gold compass cross, flush on the stone.
    def ring(key, material, cx, cy, z, radius, width, height=2.0, seg_len=38.0):
        n = max(12, int(round(2.0 * math.pi * radius / seg_len)))
        for i in range(n):
            a = 2.0 * math.pi * (i + 0.5) / n
            chord = 2.0 * radius * math.sin(math.pi / n) * 1.04
            inst(key, KERB, material, cx + radius * math.cos(a), cy + radius * math.sin(a), z,
                 math.degrees(a) + 90.0, chord / 120.0, width / 36.2, height / 28.2)

    medallions = [(0.0, 570.0, PLAZA_BASE, 250.0),       # inside MQ02's top stone patch (y 300..840)
                  (0.0, 1650.0, 15.2, 190.0),        # on MQ02's garden-path stones (datum 9.0, tops up to 14.9)
                  (0.0, 2050.0, 15.2, 190.0)]
    for (cx, cy, z, R) in medallions:
        ring("MedallionGold", "MI_V2_Gold", cx, cy, z, R, 16.0, 2.2)
        for rr in (R - 26.0, R - 44.0, R - 62.0):
            ring("MedallionRose", "MI_V2_RoofRose", cx, cy, z, rr, 19.0, 1.8)
        ring("MedallionGold", "MI_V2_Gold", cx, cy, z, R * 0.55, 12.0, 2.2)
        ring("MedallionGold", "MI_V2_Gold", cx, cy, z, R * 0.16, 10.0, 2.4, seg_len=20.0)
        for k in range(4):
            a = math.radians(90.0 * k)
            mid = R * 0.35
            inst("MedallionGold", KERB, "MI_V2_Gold", cx + mid * math.cos(a), cy + mid * math.sin(a), z, math.degrees(a),
                 (R * 0.38) / 120.0, 8.0 / 36.2, 2.4 / 28.2)

    return {"pass": PASS, "title": "Royal promenade: gold borders, blush bands and medallions on the arrival walk",
            "folder": "Wonderland/Authored/GA07", "tags": ["V2_Arrival"], "actors": [], "batches": list(batches.values())}


if __name__ == "__main__":
    spec = build()
    out = HERE / "ga07_royal_promenade.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d batches, %d instances -> %s" % (PASS, len(spec["batches"]), sum(len(b["instances"]) for b in spec["batches"]), out.name))
