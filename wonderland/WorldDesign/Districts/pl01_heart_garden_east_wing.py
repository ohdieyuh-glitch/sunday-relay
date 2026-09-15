#!/usr/bin/env python3
"""PL01 -- a palace wing on the Heart Garden's east side.

THE GAP (corridor survey corr2, 2026-09-13; founder quality directive: "Buildings should increasingly feel like
believable constructed fantasy architecture rather than distant simplified masses"). Walking the Heart Garden to the
palace, the east side is the generator's flat castle blocks: two plain "connect" halls, an arcade and five facade
panels standing in front of them, balustrade runs laid on the roofs, all smooth off-white with small windows -- the
most blockout-looking wall on the hero corridor.

WHAT THIS PASS DOES.
  TRIM  (reversible, every instance with its exact before) the pieces inside the wing's footprint: the two connect
        halls, the arcade, five facade panels, a column and its ball, three roof balustrades, a roof garden arch, a
        hedge mass, and the SKY04 fluted tower and needle that stood on the northern hall (SKY04 re-applied would put
        them back; this pass records that).
  LAYER the forge palace wing (families/palace.py, GAP 17) -- 24 m, five bays, rusticated arcade, piano nobile between
        gilded pilasters, cornice, balustrade, lilac mansard with dormers and cresting -- at (2260, 7900), its front
        turned to the walk (12 m away). Glazing and recesses take MI_V2_WindowDark (DA01 note: amber reads as flat
        yellow panels on a facade). Stone collides.
The capped tower (3200, 6500), the octagon tower and the castle hall behind (y 95-100 m) stay: the wing stands in
front of them, so the old castle reads as the palace's upper city.
MEASURED INPUTS. Censuses 349-352 (pl01_props_census_2026-09-15.json); kit_modules.json (wing bbox 25.1 x 13.1 m).
"""
import json
from pathlib import Path

import courtkit as K

HERE = Path(__file__).resolve().parent
PASS = "PL01"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS = HERE / "pl01_props_census_2026-09-15.json"
CX, CY, YAW, GROUND = 2260.0, 7900.0, 90.0, -14.0
TRIM = [
    ("WonderlandInstancedBatch_1069", 9, "connect hall under the SKY04 tower"),
    ("WonderlandInstancedBatch_1313", 0, "SKY04 fluted tower on that hall"),
    ("WonderlandInstancedBatch_1314", 0, "its gold needle tip"),
    ("WonderlandInstancedBatch_1315", 0, "its needle roof"),
    ("WonderlandInstancedBatch_1316", 0, "its needle base"),
    ("WonderlandInstancedBatch_1069", 10, "second connect hall"),
    ("WonderlandInstancedBatch_149", 0, "arcade across the block"),
    ("WonderlandInstancedBatch_150", 0, "facade panel"),
    ("WonderlandInstancedBatch_150", 1, "facade panel"),
    ("WonderlandInstancedBatch_150", 2, "facade panel"),
    ("WonderlandInstancedBatch_1067", 16, "facade panel"),
    ("WonderlandInstancedBatch_1058", 44, "lone ornate column"),
    ("WonderlandInstancedBatch_1063", 44, "its gold ball"),
    ("WonderlandInstancedBatch_1062", 91, "roof balustrade"),
    ("WonderlandInstancedBatch_1062", 92, "roof balustrade"),
    ("WonderlandInstancedBatch_1062", 93, "roof balustrade"),
    ("WonderlandInstancedBatch_1057", 44, "roof garden arch"),
    ("WonderlandInstancedBatch_91", 18, "hedge mass inside the footprint"),
]


def build_layer():
    batches = {}
    for part in KIT["WL_Palace_Wing"]["parts"]:
        material = "MI_V2_WindowDark" if part["part"] in ("glass", "stone_dark") else part["material"]
        key = "%s_%s_%s" % (PASS, part["mesh"].split(".")[-1].replace("WL_", ""), material.replace("MI_V2_", ""))
        batches[key] = {"id": key, "mesh": part["mesh"], "material": material, "collides": part["part"] == "stone",
                        "cast_shadow": True, "affect_df": part["part"] == "stone",
                        "instances": [[CX, CY, GROUND, 0.0, YAW, 0.0, 1.0, 1.0, 1.0]]}
    return {"pass": PASS, "title": "Heart Garden east: a forge palace wing facing the walk to the palace",
            "folder": "Wonderland/Authored/PL01", "tags": ["V2_Castle"], "actors": [], "batches": list(batches.values())}


if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Heart Garden east: flat castle blocks inside the palace wing's footprint sunk (reversible)", rows, TRIM)
    K.write(HERE / "pl01_heart_garden_east_wing_trim.json", trim)
    layer = build_layer()
    K.write(HERE / "pl01_heart_garden_east_wing.json", layer)
    print("%s: %d trims; %d batches" % (PASS, len(trim["trims"]), len(layer["batches"])))
