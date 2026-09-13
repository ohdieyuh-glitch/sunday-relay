#!/usr/bin/env python3
"""DC02 -- Tea Terraces: a tea walk to the giant teacup.

THE GAP (PRIVATE_BETA_GATE.md item 11; recon 2026-09-13). The map lands a visitor on lawn at (-11796, -2943), facing
yaw 20. The district has the Bible's Wonderland object language at landmark scale -- a giant teacup on its saucer
15 m ahead on the left, a grand fountain with teal columns behind on the right, a teapot, a floating island in the
sky -- and the first things in view are a lamp post planted 6 m ahead, three low garden-wall stubs (two stacked on
one spot) and a blocky stone bench, all standing loose on the grass.

WHAT THIS PASS DOES.
  TRIM  the three wall stubs (four instances), the bench, and the lamp post with its lamp: sunk, each with its exact
        before transform (REVERT restores).
  LAYER a TEA WALK: a 3.8 m paved walk of plaza slabs from the visitor's feet to a round TEA COURT 8 m ahead, laid in
        the Golden Arrival's courses -- gold border lines, a gold-and-rose medallion at the court's heart, a gold ring
        at its rim. Four small teacups stand at the court's corners as planters, full of blossom; flower beds and
        lavender line the walk; a pair of pink mushrooms frames the view on to the giant teacup and the fountain;
        a pair of lamps stands at the court's far edge. The walk stops short of the saucer, which is walkable.

MEASURED INPUTS. Probe 225: lawn z -14 flat from 0 to 9 m ahead, lateral -6..+6 m; the saucer rises from 12 m ahead
on the left. Props census 2261; district census 2270 (nothing else within the court). mesh_bounds.json.
"""
import json
from pathlib import Path

import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "DC02"
AX, AY, YAW, FLOOR = -11796.0, -2943.0, 20.0, -14.0
CENSUS = HERE / "dc02_props_census_2026-09-13.json"
TRIM = [
    ("WonderlandInstancedBatch_304", 83, "garden-wall stub 3.5 m left of the visitor"),
    ("WonderlandInstancedBatch_304", 82, "garden-wall stub 5 m ahead, left"),
    ("WonderlandInstancedBatch_304", 89, "its duplicate on the same spot"),
    ("WonderlandInstancedBatch_304", 88, "garden-wall stub 11 m left"),
    ("WonderlandInstancedBatch_294", 19, "blocky stone bench 6 m ahead, left"),
    ("WonderlandInstancedBatch_397", 171, "lamp post planted 6 m ahead, right of centre"),
    ("WonderlandInstancedBatch_400", 44, "its lamp"),
]
COURT_D, COURT_R = 800.0, 330.0
WALK_HALF = 192.0


def build():
    c = K.Court(PASS, AX, AY, YAW, FLOOR, 20260913 + 102)
    c.mesh.update({
        "tea_cup_small": K.V2 + "Props/Tea/SM_tea_cup_small.SM_tea_cup_small",
        "mushroom_small": K.V2 + "Mushrooms/Small/SM_mushroom_small.SM_mushroom_small",
    })
    top = FLOOR + 13.0                       # slab top: slabs sit 0.5 above the lawn and are 13 cm thick

    # the walk and the court
    c.pave_rect("WalkSlabs", 40.0, COURT_D - COURT_R + 40.0, -WALK_HALF, WALK_HALF, FLOOR)
    c.pave_disc("CourtSlabs", COURT_D, 0.0, -64.0, COURT_R + 40.0, FLOOR)
    for side in (1.0, -1.0):
        c.strip_along("WalkGold", "MI_V2_Gold", side * (WALK_HALF - 14.0), 60.0, COURT_D - COURT_R - 10.0, 12.0, top)
    c.ring("CourtRimGold", "MI_V2_Gold", COURT_D, 0.0, COURT_R + 20.0, 18.0, top, 3.0)
    c.medallion(COURT_D, 0.0, 200.0, top)

    # teacup planters at the court's four corners (small cup 310 x 260 x 219 uu at 1x)
    for k, (dd, lat) in enumerate(((COURT_D - 250.0, 310.0), (COURT_D - 250.0, -310.0), (COURT_D + 260.0, 330.0), (COURT_D + 260.0, -330.0))):
        c.actor("TeacupPlanter%d" % k, "tea_cup_small", dd, lat, FLOOR, ["MI_V2_Ceramic"], 0.5, yaw_local=45.0 + 90.0 * k)
        for j in range(3):
            c.inst("TeacupBlossom_%d" % (k % 2), "blossom", ["MI_V2_PetalPink", "MI_V2_PetalViolet"][k % 2], dd + c.rng.uniform(-18, 18),
                   lat + c.rng.uniform(-18, 18), FLOOR + 80.0, c.rng.uniform(0, 360), 0.42, shadow=True)

    # flower beds and lavender along the walk
    for k, dd in enumerate((150.0, 330.0)):
        for side in (1.0, -1.0):
            c.flower_bed("WalkBed", dd, side * (WALK_HALF + 110.0), FLOOR, ["MI_V2_PetalViolet", "MI_V2_PetalPink"][(k + (side > 0)) % 2])
            c.inst("WalkLavender", "lavender", "MI_V2_Lavender", dd + 70.0, side * (WALK_HALF + 215.0), FLOOR, c.rng.uniform(0, 360),
                   c.rng.uniform(1.0, 1.25), shadow=True)

    # a pair of pink mushrooms framing the view on to the teacup and the fountain; lamps at the court's far edge
    for side, tag in ((1.0, "R"), (-1.0, "L")):
        c.actor("Mushroom%s" % tag, "mushroom_small", COURT_D + 480.0, side * 470.0, FLOOR, ["MI_V2_MushRed"], 1.1,
                yaw_local=side * 30.0)
    c.lamp_pair("Court", COURT_D + 120.0, COURT_R + 150.0, FLOOR)
    return c.layer("Tea Terraces: a paved tea walk to a round tea court with teacup planters, facing the giant teacup")


if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Tea Terraces: loose walls, bench and lamp post sunk out of the arrival view (reversible)", rows, TRIM)
    K.write(HERE / "dc02_tea_terraces_trim.json", trim)
    layer = build()
    K.write(HERE / "dc02_tea_terraces.json", layer)
    print("%s: %d trims; %d actors, %d batches, %d instances" % (PASS, len(trim["trims"]), len(layer["actors"]), len(layer["batches"]),
          sum(len(b["instances"]) for b in layer["batches"])))
