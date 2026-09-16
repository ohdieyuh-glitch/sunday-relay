#!/usr/bin/env python3
"""FN01 -- the Clock Plaza fountain gets its water.

THE GAP (survey sv2, captures fn0, 2026-09-15). The fountain is the middle of the corridor's main plaza and it reads
dry: the generator's water disc (Court_FountainWater, SM_fountain_water) sits at z 96-102 inside a basin whose rim is
at 300, so from any standing view you see the basin's pale inner wall and its dark drain slots, never water. The dish
above it and the gold finial have nothing falling from them either.

WHAT THIS PASS DOES.
  TRIM  (reversible, exact before) raises the generator's own water disc from z 96-102 to 160 -- a pool standing in
        the basin, 1.4 m below its rim -- instead of hiding it at the bottom.
FN01a raised it to 240 and added a disc in the dish as well: the water mesh is wider than the bowl, so both read as
flat teal plates hovering over the stone (fn1, fn3). The layer is gone; this pass is the one trim.
MEASURED INPUTS. Census 590: basin z 0-300 r 297, water disc z 96-102 r 235, gold finial z 300-464 (so the dish's top
is 300). The plaza's own flower rings stand at r 335 and 395 (GA02/FL03), outside all of this.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "Districts"))
import courtkit as K  # noqa: E402

PASS = "FN01"
CENSUS = HERE / "fn01_fountain_census_2026-09-15.json"
CX, CY = 0.0, 5400.0
POOL_Z, DISH_Z = 160.0, 300.0
WATER = "/Game/WonderlandV2/Props/Garden/SM_fountain_water.SM_fountain_water"
KERB = "/Game/WonderlandV2/Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone"
TRIM = [("StaticMeshActor_19", None, "the fountain's water disc, hidden 2 m below the basin rim")]


if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    row = next(r for r in rows if r["name"] == "StaticMeshActor_19")
    after = list(row["transform"])
    after[2] = round(after[2] + (POOL_Z - 99.0), 3)          # the disc's own centre sits at z 99 when the actor is at 0
    trim = {"pass": PASS + "_TRIM", "title": "Clock Plaza fountain: the water disc raised into the basin (reversible)",
            "trims": [{"name": row["name"], "label": row["label"], "mesh": row["mesh"], "index": None,
                       "why": TRIM[0][2], "before": row["transform"], "after": after}]}
    K.write(HERE / "fn01_clock_fountain_trim.json", trim)
    print("%s: water raised %+d cm to z %d" % (PASS, after[2] - row["transform"][2], POOL_Z))
