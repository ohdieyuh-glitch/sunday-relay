#!/usr/bin/env python3
"""SKY06 -- the floating islands get hanging gardens and falls.

THE GAP (founder 2026-09-15: "improve islands"; captures isl0). SKY03's five islands read from the ground as green-
fringed white discs on a cone. Close up (ISL_near, ISL_side) the rim's planting is the kit's own veg_anchor points --
small inverted cones in flat leaf green, a ring of green teeth -- and the underside is bare rock with nothing falling
from it. The Bible's islands are gardens in the sky with water falling off them.

WHAT THIS LAYER ADDS, per island, hovering with that island's own motion (amp, period, phase read from
sky03_floating_islands.json, so nothing drifts off its island as it bobs):
  GARDENS  canopies hung under the lip all round, in three greens at two depths, big enough to read at 200-380 m.
  FALLS    on every island but the smallest, a fall of water off the rim: a tapering column in the world's water
           material, and a cumulus puff where it ends, so the fall goes into cloud instead of stopping in the air.
SKY06a hung lantern heads along the lip as well; without their posts they read as yellow eggs floating round the rim
(isl1), so they are gone -- the islands' light is the amber glass in their own towers.
Nothing is placed on the lawn: the islands' tops stay clear for the teleport anchors the founder wants room for.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "SKY06"
SKY03 = json.loads((HERE / "sky03_floating_islands.json").read_text(encoding="utf-8"))
V2 = "/Game/WonderlandV2/"
MESH = {
    "canopy": V2 + "Vegetation/Trees/SM_canopy_medium.SM_canopy_medium",
    "canopy_big": V2 + "Vegetation/Trees/SM_canopy_large.SM_canopy_large",
    "water": V2 + "Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone",     # a kerb block is the world's plain box
    "cloud": V2 + "Sky/SM_cloud_cumulus_b.SM_cloud_cumulus_b",
}
# island top radius and underside depth at 1x, by size (sky03 SIZES x GROUP_SCALE)
TOP_R = {"small": 460.0 * 2.0, "medium": 800.0 * 2.0, "large": 1300.0 * 3.0, "landmark": 1300.0 * 3.0}
DEPTH = {"small": 750.0 * 2.0, "medium": 1200.0 * 2.0, "large": 1800.0 * 3.0, "landmark": 1800.0 * 3.0}
GREENS = ("MI_V2_LeafMid", "MI_V2_LeafDark", "MI_V2_LeafLight")


def build():
    hovers = []
    for island in SKY03["islands"]:
        iid, size = island["id"], island["size"]
        x, y = island["at"]
        top_z = island["top_z"]
        motion = island["motion"]
        top_r, depth = TOP_R[size], DEPTH[size]
        g = top_r / 2600.0                                   # one "island scale": the landmark island is 1.0

        def hover(hid, mesh, material, loc, scale, yaw=0.0):
            hovers.append(dict({"id": "%s_%s_%s" % (PASS, iid, hid), "mesh": MESH[mesh], "material": material,
                                "loc": [round(v, 1) for v in loc], "rot": [0.0, round(yaw % 360.0, 1), 0.0],
                                "scale": [round(scale, 3)] * 3}, **motion))

        # hanging gardens: two rings of canopies under the lip, the lower ring further out and darker
        for ring, (r_mul, drop, scale_mul, mesh) in enumerate(((0.92, 150.0, 1.5, "canopy"), (1.02, 420.0, 1.1, "canopy_big"))):
            count = max(6, int(round(2.0 * math.pi * top_r * r_mul / (900.0 * g))))
            for k in range(count):
                ang = 360.0 * (k + 0.5 * ring) / count
                hover("Garden%d_%d" % (ring, k), mesh, GREENS[(k + ring) % 3],
                      (x + top_r * r_mul * math.cos(math.radians(ang)), y + top_r * r_mul * math.sin(math.radians(ang)),
                       top_z - drop * g), scale_mul * g, ang)

        # the fall: a tapering column of water off the rim, into a cumulus puff
        if size != "small":
            fall_ang = island["bearing"] + 150.0                       # off the side the hero sees, not the middle
            fx = x + top_r * 0.80 * math.cos(math.radians(fall_ang))
            fy = y + top_r * 0.80 * math.sin(math.radians(fall_ang))
            length = (depth + 2600.0) * 1.15
            for seg, (w, h_frac, z_frac) in enumerate(((1.0, 0.45, 0.0), (0.72, 0.4, 0.42), (0.5, 0.3, 0.76))):
                seg_len = length * h_frac
                z_top = top_z - 60.0 * g - length * z_frac
                # SM_kerb_stone at 1x is 120 x 36.2 x 28.2, footed at z 0: scaled into a thin sheet of water
                hovers.append(dict({"id": "%s_%s_Fall%d" % (PASS, iid, seg), "mesh": MESH["water"], "material": "MI_V2_Water",
                                    "loc": [round(fx, 1), round(fy, 1), round(z_top - seg_len, 1)],
                                    "rot": [0.0, round(fall_ang % 360.0, 1), 0.0],
                                    "scale": [round(360.0 * g * w / 120.0, 3), round(120.0 * g * w / 36.2, 3), round(seg_len / 28.2, 3)]},
                                   **motion))
            hover("FallCloud", "cloud", "MI_V2_Cloud", (fx, fy, top_z - 60.0 * g - length - 400.0 * g), 0.55 * g, fall_ang)

    return {"pass": PASS, "title": "Floating islands: hanging gardens under the lip, falls into cloud, lantern rims",
            "folder": "Wonderland/Authored/SKY06", "tags": ["V2_Skyline"], "actors": [], "batches": [], "hovers": hovers}


if __name__ == "__main__":
    spec = build()
    out = HERE / "sky06_island_gardens.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d hovers -> %s" % (PASS, len(spec["hovers"]), out.name))
