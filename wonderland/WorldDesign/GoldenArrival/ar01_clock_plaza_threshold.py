#!/usr/bin/env python3
"""AR01 -- the threshold arch between the garden path and the Clock Plaza.

THE GAP (captures arch0 / mq05c, 2026-09-15). Where the level garden path meets TR01's steps down to the Clock Plaza,
the generator stands SM_garden_arch_stone at 1x over the axis, (0, 4500): its rustic voussoirs fan out like a
crumpled ring from the plaza and from the path, and its feet sit at z 220 -- 1.3 m above the path's flags and 2.2 m
above the lawn beside them, over nothing. Two SM_ivy_drape hang on its piers as columns of bright green balls, and a
single rose bloom sits on its crown. It is the frame of the corridor's middle view both ways.

WHAT THIS PASS DOES.
  TRIM  (reversible, exact befores from census 393) the arch, both ivy drapes and the crown bloom.
  LAYER the forge's twin-tiered arch (WL_Arch_Twin_Tiered, families/thresholds.py) at 0.8x -- 11.9 m wide, 16.8 m to
        its arcaded crown, a 7.2 m opening -- standing on the lawn either side of the raised path over the path's end
        and the top of TR01's flight; stone collides. Previewed against the 7 m trefoil screen (ar01 sheet): the
        tiered arch reads as the plaza's gateway from the Clock Plaza, the trefoil as a lintel on posts.
MEASURED INPUTS. Census 392 (threshold box): path flags top z 92 to y 4498, kerbs at x +/-163, lawn z -2, TR01 treads
from y 4498, GA02 gold inlays at z 3, FL04 beds at x +/-591..628, hedges at (+/-420, 4190). kit_modules.json.

    python ar01_clock_plaza_threshold.py [trefoil|tiered]
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "Districts"))
import courtkit as K  # noqa: E402

PASS = "AR01"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS = HERE / "ar01_threshold_census_2026-09-15.json"
VARIANTS = {"trefoil": ("WL_Arch_Trefoil_Screen", 1.15), "tiered": ("WL_Arch_Twin_Tiered", 0.8)}
CX, CY, GROUND = 0.0, 4450.0, -2.0
TRIM = [
    ("WonderlandInstancedBatch_104", 0, "crumpled stone garden arch floating 1.3-2.2 m over the path's end"),
    ("WonderlandInstancedBatch_105", 0, "ivy drape on its east pier (a column of green balls)"),
    ("WonderlandInstancedBatch_106", 0, "ivy drape on its west pier"),
    ("WonderlandInstancedBatch_101", 9, "rose bloom on its crown"),
]


def build_layer(variant):
    module, scale = VARIANTS[variant]
    batches = []
    for part in KIT[module]["parts"]:
        if part["part"] == "veg_anchor":
            continue
        # the tiered arch's stone_dark is its lintel frieze and soffits: in MI_V2_WindowDark a black band across the
        # opening from the path, in gold a broad flat face that shows the gold's smudges (ar01, pvg); limestone it is
        material = "MI_V2_Stone" if part["part"] == "stone_dark" else part["material"]
        key = "%s_%s_%s" % (PASS, part["part"], material.replace("MI_V2_", ""))
        batches.append({"id": key, "mesh": part["mesh"], "material": material, "collides": part["part"] == "stone",
                        "cast_shadow": True, "affect_df": part["part"] == "stone",
                        "instances": [[CX, CY, GROUND, 0.0, 0.0, 0.0, scale, scale, scale]]})
    return {"pass": PASS, "title": "Clock Plaza threshold: %s over the garden path's end" % module,
            "folder": "Wonderland/Authored/AR01", "tags": ["V2_Garden"], "actors": [], "batches": batches,
            "variant": variant}


if __name__ == "__main__":
    variant = sys.argv[1] if len(sys.argv) > 1 else "tiered"
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Clock Plaza threshold: the floating crumpled arch, its ivy drapes and crown bloom sunk (reversible)", rows, TRIM)
    K.write(HERE / "ar01_clock_plaza_threshold_trim.json", trim)
    layer = build_layer(variant)
    K.write(HERE / "ar01_clock_plaza_threshold.json", layer)
    print("%s (%s): %d trims; %d batches" % (PASS, variant, len(trim["trims"]), len(layer["batches"])))
