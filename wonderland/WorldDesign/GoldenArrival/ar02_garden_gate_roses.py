#!/usr/bin/env python3
"""AR02 -- the golden garden gate climbed by roses; the bulb arch behind it removed.

THE GAP (captures pvg3 / ar01final, 2026-09-15). Four metres behind GA01c's gold garden arch, the generator's
SM_floral_arch (Corridor_FloralArch, (0, 3600)) hangs pink blossom clusters on a rope-like frame: at walking distance
each cluster reads as a speckled bulb, and from the path it crowds the gold arch and the Clock Plaza gateway beyond
into three overlapping frames. The gold arch itself is the kit's rose garden arch -- "built to be buried in roses"
(families/thresholds.py) -- standing bare.

WHAT THIS PASS DOES.
  TRIM  (reversible, exact before from census 435; apply_vegetation_trim.py now moves plain actors) the floral arch.
  LAYER forge rose runs (GAP 19) climbing the gold arch on both faces: up each column from its base to the springing,
        and along the ogee band to the crown, each run turned along the stone with its blooms facing out of the face.
        Pink and red roses alternate, leaves dark and mid. No collision.
GEOMETRY. WL_Arch_Garden_Rose (thresholds.py): span 5.4 m, springing 4.9 m, rise 3.3 m, column radius 0.30 m, band
0.72 m deep; GA01c places it at (0, 3200) z -14 at 1.2x. The ogee band is followed as a two-centred arc through the
springing and the crown (radius 3.37 m, centres 0.67 m past the axis). Rotations: pitch turns a run's length up
from horizontal; roll -90 puts its stems to -Y (the south face) at yaw 0 (probe 434).
"""
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "Districts"))
import courtkit as K  # noqa: E402
import rose_arch  # noqa: E402

PASS = "AR02"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS = HERE / "ar02_floral_arch_census_2026-09-15.json"
ARCH_X, ARCH_Y, GROUND, S = 0.0, 3200.0, -14.0, 1.2          # GA01c's gold rose arch
COLUMN_FACE, BAND_FACE = 34.0, 44.0                          # cm from the arch plane to the face the roses sit on
RUN_S = 1.1                                                  # a rose run is 1.25 m long at 1x
TRIM = [("StaticMeshActor_7", None, "floral arch of speckled blossom bulbs 4 m behind the gold garden arch")]


def build_layer():
    batches = {}
    run_len = 125.0 * RUN_S
    k = [0]

    def run(x, y, z, pitch, yaw, roll, scale=RUN_S):
        petal = "MI_V2_RoseRed" if k[0] % 3 == 1 else "MI_V2_RosePink"
        leaf = "MI_V2_LeafDark" if k[0] % 2 else "MI_V2_LeafMid"
        k[0] += 1
        for part in KIT["WL_Flower_Rose_Run"]["parts"]:
            material = petal if part["part"] == "petal" else leaf
            key = "%s_%s_%s" % (PASS, part["part"], material.replace("MI_V2_", ""))
            b = batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material, "instances": [],
                                         "collides": False, "cast_shadow": True, "affect_df": False})
            b["instances"].append([round(x, 1), round(y, 1), round(z, 1), round(pitch, 1), round(yaw, 1), round(roll, 1),
                                   scale, scale, scale])

    # two staggered rows per face (ar02a: one row read as a thin chain), the geometry shared with GA02 (rose_arch.py)
    for (x, y, z, pitch, yaw, roll, scale) in rose_arch.climbing_runs(ARCH_X, ARCH_Y, GROUND, S, 0.0, run_s=RUN_S,
                                                                     column_face=COLUMN_FACE, band_face=BAND_FACE):
        run(x, y, z, pitch, yaw, roll, scale)
    return {"pass": PASS, "title": "Golden garden gate climbed by forge roses on both faces",
            "folder": "Wonderland/Authored/AR02", "tags": ["V2_Garden"], "actors": [], "batches": list(batches.values()),
            "runs": k[0]}


if __name__ == "__main__":
    rows = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    trim = K.trim_spec(PASS, "Garden gate: the generator's blossom-bulb floral arch behind the gold arch sunk (reversible)", rows, TRIM)
    K.write(HERE / "ar02_garden_gate_roses_trim.json", trim)
    layer = build_layer()
    K.write(HERE / "ar02_garden_gate_roses.json", layer)
    print("%s: %d trims; %d runs, %d batches" % (PASS, len(trim["trims"]), layer["runs"], len(layer["batches"])))
