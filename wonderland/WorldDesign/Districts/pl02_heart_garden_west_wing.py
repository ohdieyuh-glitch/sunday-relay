#!/usr/bin/env python3
"""PL02 -- the matching palace wing on the Heart Garden's west side.

THE GAP. PL01 put a forge palace wing on the Heart Garden's east side. The west side has no building at all between
the Clock Plaza and the castle arcade at y 97 m: open lawn with a mature tree, hedge masses and a shrub, so the garden
reads as half a court. The Bible's gardens are courts framed by palace fronts.

WHAT THIS PASS DOES.
  TRIM  (reversible, exact befores) what stands inside the wing's footprint: the mature tree and its canopy, three
        hedge masses and a flowering shrub.
  LAYER the forge palace wing (GAP 17) at (-2600, 7900), front turned east to the walk (~20 m), mirroring PL01 across
        the garden; glazing and recesses in MI_V2_WindowDark; stone collides.
MEASURED INPUTS. Census 358 (pl02_props_census_2026-09-15.json); kit_modules.json.
"""
import json
from pathlib import Path

import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "PL02"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS = HERE / "pl02_props_census_2026-09-15.json"
CX, CY, YAW, GROUND = -2600.0, 7900.0, 270.0, -14.0
TRIM = [
    ("WonderlandInstancedBatch_122", 5, "mature tree trunk inside the footprint"),
    ("WonderlandInstancedBatch_117", 3, "its canopy"),
    ("WonderlandInstancedBatch_91", 19, "hedge mass"),
    ("WonderlandInstancedBatch_92", 16, "hedge mass"),
    ("WonderlandInstancedBatch_91", 20, "hedge mass"),
    ("WonderlandInstancedBatch_269", 35, "flowering shrub"),
]


def build_layer():
    batches = {}
    for part in KIT["WL_Palace_Wing"]["parts"]:
        material = "MI_V2_WindowDark" if part["part"] in ("glass", "stone_dark") else part["material"]
        key = "%s_%s_%s" % (PASS, part["mesh"].split(".")[-1].replace("WL_", ""), material.replace("MI_V2_", ""))
        batches[key] = {"id": key, "mesh": part["mesh"], "material": material, "collides": part["part"] == "stone",
                        "cast_shadow": True, "affect_df": part["part"] == "stone",
                        "instances": [[CX, CY, GROUND, 0.0, YAW, 0.0, 1.0, 1.0, 1.0]]}
    return {"pass": PASS, "title": "Heart Garden west: the matching forge palace wing facing the walk",
            "folder": "Wonderland/Authored/PL02", "tags": ["V2_Castle"], "actors": [], "batches": list(batches.values())}


if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Heart Garden west: tree, hedges and shrub inside the palace wing's footprint sunk (reversible)", rows, TRIM)
    K.write(HERE / "pl02_heart_garden_west_wing_trim.json", trim)
    layer = build_layer()
    K.write(HERE / "pl02_heart_garden_west_wing.json", layer)
    print("%s: %d trims; %d batches" % (PASS, len(trim["trims"]), len(layer["batches"])))
