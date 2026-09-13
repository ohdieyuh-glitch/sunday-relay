#!/usr/bin/env python3
"""DC03 -- Gatekeeper Fields: a golden gate across the walk.

THE GAP (PRIVATE_BETA_GATE.md item 11; recon 2026-09-13). The map lands a visitor at (13402, -5217), facing yaw
160.7, at the head of a 7 m paved walk (terrace platforms, z 19, from the visitor's left to just right of centre;
lawn at z -14 beyond). A place called Gatekeeper Fields has no gate on its walk: what is in view is a signpost,
two pedestal-and-ball sets stacked on one spot at the walk's edge, a 1.8 m garden-wall block beside the visitor
and another behind, stone arches and lone finial posts out on the lawn.

WHAT THIS PASS DOES.
  TRIM  the two wall blocks, the signpost, and the stacked pedestal-and-ball sets (four instances): sunk with their
        exact before transforms (REVERT restores).
  LAYER THE GATE: the kit's gold filigree gatehouse screen (WL_Gatehouse_Screen, 12.2 m wide, 14.6 m tall, a 4.3 m
        passage) standing across the walk 12.5 m ahead, its passage on the walk's centre line -- the Bible's golden
        gate, and the district's name made literal. The walk is laid in the Golden Arrival's courses up to it: gold
        border lines, a gold-and-rose medallion 6.5 m ahead. Flower beds and lavender line the lawn edge; a pair of
        lamps stands before the gate.
The gate foots on the lawn (z -14) and is sunk 33 cm into the walk's platform on its left, so neither pier floats.

MEASURED INPUTS. Probe 242 (41 points): walk top z 19 from 3 to 18 m ahead at lateral -6..0 m, lawn z -14 at +3 m
and beyond. Props census 2433; district census 244 (nothing solid in the gate's footprint once the stacked
pedestals are gone; the clock tower on the left stands 4 m clear of its left pier). kit_modules.json.
"""
import json
from pathlib import Path

import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "DC03"
AX, AY, YAW, FLOOR, LAWN = 13402.0, -5217.0, 160.7, 19.0, -14.0
CENSUS = HERE / "dc03_props_census_2026-09-13.json"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
TRIM = [
    ("WonderlandInstancedBatch_304", 124, "1.8 m garden-wall block beside the visitor, right"),
    ("WonderlandInstancedBatch_304", 125, "garden-wall block behind, left"),
    ("WonderlandInstancedBatch_293", 51, "signpost 7 m ahead at the walk's edge"),
    ("WonderlandInstancedBatch_279", 42, "pedestal stacked at the walk's edge, 11 m ahead"),
    ("WonderlandInstancedBatch_279", 122, "a second pedestal on the same spot"),
    ("WonderlandInstancedBatch_184", 71, "its ball"),
    ("WonderlandInstancedBatch_184", 185, "the second ball"),
]
WALK_LAT = -300.0          # the walk's centre line: platform spans lateral -6..+0.5 m
GATE_D = 1250.0


def build():
    c = K.Court(PASS, AX, AY, YAW, FLOOR, 20260913 + 103)
    top = FLOOR + 0.5

    # the gate: every part of WL_Gatehouse_Screen, width across the walk (local x -> lateral: yaw_local 90)
    for part in KIT["WL_Gatehouse_Screen"]["parts"]:
        key = "gate_" + part["part"]
        c.mesh[key] = part["mesh"]
        c.actor("Gate_%s" % part["part"], key, GATE_D, WALK_LAT, LAWN, [part["material"]], 1.0, yaw_local=90.0,
                collision="block" if part["part"] == "stone" else "none")

    # the walk's courses
    for lat in (WALK_LAT - 310.0, WALK_LAT + 290.0):
        c.strip_along("WalkGold", "MI_V2_Gold", lat, 120.0, GATE_D - 160.0, 14.0, top)
    for d in (250.0, 1050.0):
        c.strip_across("WalkBandRose", "MI_V2_RoofRose", d, WALK_LAT - 290.0, WALK_LAT + 270.0, 56.0, top, 1.6)
        for dd in (-32.0, 32.0):
            c.strip_across("WalkBandGold", "MI_V2_Gold", d + dd, WALK_LAT - 290.0, WALK_LAT + 270.0, 6.0, top)
    c.medallion(650.0, WALK_LAT, 220.0, top)

    # beds and lavender along the lawn edge, lamps before the gate
    for k, d in enumerate((200.0, 470.0, 740.0, 1010.0)):
        c.flower_bed("EdgeBed", d, 150.0 + 110.0, LAWN, ["MI_V2_PetalViolet", "MI_V2_PetalPink", "MI_V2_RoseRed"][k % 3])
        c.inst("EdgeLavender", "lavender", "MI_V2_Lavender", d + 120.0, 380.0, LAWN, c.rng.uniform(0, 360), c.rng.uniform(1.0, 1.3), shadow=True)
    for side, tag, lat in ((1.0, "R", WALK_LAT + 520.0), (-1.0, "L", WALK_LAT - 520.0)):
        z = LAWN if lat > 50.0 else FLOOR
        c.actor("LampPost%s" % tag, "waymarker", GATE_D - 240.0, lat, z, ["MI_V2_IvoryStone"], 0.42)
        c.actor("Lamp%s" % tag, "waymarker_lamp", GATE_D - 240.0, lat, z, ["MI_V2_GlassAmber"], 0.42, collision="none")
    return c.layer("Gatekeeper Fields: a gold filigree gate across the walk, the walk laid in gold and rose courses")


if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Gatekeeper Fields: wall blocks, signpost and stacked pedestals sunk (reversible)", rows, TRIM)
    K.write(HERE / "dc03_gatekeeper_fields_trim.json", trim)
    layer = build()
    K.write(HERE / "dc03_gatekeeper_fields.json", layer)
    print("%s: %d trims; %d actors, %d batches, %d instances" % (PASS, len(trim["trims"]), len(layer["actors"]), len(layer["batches"]),
          sum(len(b["instances"]) for b in layer["batches"])))
