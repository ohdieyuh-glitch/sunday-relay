#!/usr/bin/env python3
"""AR03 -- the side arches around the Golden Arrival rebuilt on the ground.

THE GAP (survey sv1, 2026-09-15). After AR01 the corridor's own arches are forge arches, but six more of the
generator's SM_garden_arch_stone stand where the hero view and the Clock Plaza look: the arrival garden's two side
gates onto the flank walks (x +/-2650, y 4 m), the Clock Plaza's east and west gates under the giant mushrooms
(x +/-2300, y 54 m), a gate on the south-west terrace (-2804, -1710) and one at the palace forecourt's east edge
(1225, 9321). Every one reads as a crumpled ring of rustic blocks, and four of them stand at z 220 -- the PIE probe
(443) finds the ground under their piers at z -14 (lawn) or 19 (flank walk paving): they float 2 m up.

WHAT THIS PASS DOES.
  TRIM  (reversible, exact befores from census 444) the six arches. Nothing hangs on them (444: no drapes or blooms).
  LAYER the forge's trefoil arch (WL_Arch_Trefoil_Screen, families/thresholds.py -- "the district-scale arch": fluted
        columns on plinths, a cusped trefoil head with a gold filigree tympanum, pinnacles) at 1x in each place, with
        the generator arch's own yaw, standing on the probed ground. 7 m wide, 9 m tall, a 4.6 m opening. Stone collides.
The corridor's arches are gold (GA01c, GA04b) and the Clock Plaza's gateway is the tiered arch (AR01); the side gates
are stone with gold only in their tympana, so they frame the corridor without competing with it.
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "Districts"))
import courtkit as K  # noqa: E402

PASS = "AR03"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS = HERE / "ar03_side_arches_census_2026-09-15.json"
MODULE, SCALE = "WL_Arch_Trefoil_Screen", 1.0
# (batch object, index, ground z from probe 443, why)
ARCHES = [
    ("WonderlandInstancedBatch_104", 1, -14.0, "Clock Plaza east gate under the giant mushroom"),
    ("WonderlandInstancedBatch_104", 2, -14.0, "Clock Plaza west gate under the giant mushroom"),
    ("WonderlandInstancedBatch_104", 3, 19.0, "arrival garden east side gate, floating 2 m over the flank walk apron"),
    ("WonderlandInstancedBatch_104", 4, 19.0, "arrival garden west side gate, floating 2 m over the flank walk apron"),
    ("WonderlandInstancedBatch_301", 5, -14.0, "south-west terrace gate, floating 2.3 m over the lawn"),
    ("WonderlandInstancedBatch_301", 9, -14.0, "palace forecourt east gate, floating 2.3 m over the lawn"),
]


def build_layer(rows):
    by = {(r["name"], r["index"]): r for r in rows}
    batches = {}
    placed = []
    for name, index, ground, why in ARCHES:
        tr = by[(name, index)]["transform"]
        for part in KIT[MODULE]["parts"]:
            key = "%s_%s_%s" % (PASS, part["part"], part["material"].replace("MI_V2_", ""))
            b = batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": part["material"], "instances": [],
                                         "collides": part["part"] == "stone", "cast_shadow": True,
                                         "affect_df": part["part"] == "stone"})
            b["instances"].append([tr[0], tr[1], ground, 0.0, tr[4], 0.0, SCALE, SCALE, SCALE])
        placed.append([round(tr[0]), round(tr[1]), ground, round(tr[4], 1)])
    return {"pass": PASS, "title": "Side arches around the Golden Arrival: forge trefoil arches on the ground",
            "folder": "Wonderland/Authored/AR03", "tags": ["V2_Garden"], "actors": [], "batches": list(batches.values()),
            "placed": placed}


if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Side arches: six crumpled generator garden arches (four floating) sunk (reversible)", rows,
                       [(n, i, why) for (n, i, _g, why) in ARCHES])
    K.write(HERE / "ar03_side_arches_trim.json", trim)
    layer = build_layer(rows)
    K.write(HERE / "ar03_side_arches.json", layer)
    print("%s: %d trims; %d arches, %d batches" % (PASS, len(trim["trims"]), len(layer["placed"]), len(layer["batches"])))
