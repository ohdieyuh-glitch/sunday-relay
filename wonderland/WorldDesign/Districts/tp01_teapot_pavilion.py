#!/usr/bin/env python3
"""TP01 -- the Tea Terraces' landmark becomes a porcelain teapot (2026-09-16).

THE GAP. At TeapotCam24 the district's landmark, LMTeaTerraces_Teapot (SM_teapot_pavilion, 20 m), reads as untextured
white plaster: a low-poly, single-material mesh. Gloss on its shared material (TEA01) only exposed its facets and
tinted the hero clock's enamel, so it was rejected. The Bible's teapots are porcelain with gold rims and painted roses.

WHAT. The forge's WL_Object_TeapotPavilion (wonderland-blender-forge 5d668f30): smooth enamel body and lid, swept spout
and handle, gold foot, band, rims and knob, rose medallions, six lit portholes. 18.4 m at scale 1.

HOW, reversibly.
  - tp01_teapot_trim.json sinks the generator teapot 60 m below the datum (apply_vegetation_trim.py actor trim: the
    exact before transform is recorded, REVERT puts it back).
  - tp01_teapot.json places the new teapot, one StaticMeshActor per material part, at the old one's position.
Scale 0.88 (16.2 m): the district's five rose topiary cones ring the landmark 7.86 m out and 2.9 m tall; the new
body is 6.5-7.1 m in radius below 3 m at this scale, so they still stand clear around its foot.
Yaw 24: the kit's front (+X, portholes, no spout or handle) faces TeapotCam24 and the district's approach, so the
spout and handle stand either side -- the teapot silhouette. The mirrored FBX puts the spout at world -66 degrees
and the handle at 114, clear of the cup and saucer at 30 degrees, 12.6 m out.

    python tp01_teapot_pavilion.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

OLD = {"name": "StaticMeshActor_226", "label": "LMTeaTerraces_Teapot", "mesh": "SM_teapot_pavilion",
       "transform": [-14202.8, -8200.0, 0.0, 0.0, -65.0, 0.0, 0.42, 0.42, 0.42]}
SINK = -6000.0
SCALE = 0.88
YAW = 24.0
MODULE = "WL_Object_TeapotPavilion"
SOLID = ("enamel", "gold")        # the parts the pawn collides with; roses, leaves and glass ride on them


def main():
    before = OLD["transform"]
    after = list(before)
    after[2] = SINK
    trim = {"pass": "TP01_TRIM", "title": "Tea Terraces: the plaster teapot sunk below the datum (reversible)",
            "trims": [{"name": OLD["name"], "label": OLD["label"], "mesh": OLD["mesh"], "index": None,
                       "why": "replaced by the porcelain WL_Object_TeapotPavilion at the same position (TP01)",
                       "before": before, "after": after}]}
    (HERE / "tp01_teapot_trim.json").write_text(json.dumps(trim, indent=1) + "\n", encoding="utf-8", newline="\n")
    actors = []
    for part in KIT[MODULE]["parts"]:
        actors.append({"id": "Teapot_" + part["part"], "mesh": part["mesh"], "materials": [part["material"]],
                       "loc": [before[0], before[1], 0.0], "rot": [0.0, YAW, 0.0], "scale": [SCALE, SCALE, SCALE],
                       "collision": "block" if part["part"] in SOLID else "none", "cast_shadow": True, "affect_df": False})
    layer = {"pass": "TP01", "title": "Tea Terraces: the porcelain teapot pavilion", "tags": ["TP01"],
             "actors": actors, "batches": []}
    (HERE / "tp01_teapot.json").write_text(json.dumps(layer, indent=1) + "\n", encoding="utf-8", newline="\n")
    return len(actors)


if __name__ == "__main__":
    print("actors", main())
