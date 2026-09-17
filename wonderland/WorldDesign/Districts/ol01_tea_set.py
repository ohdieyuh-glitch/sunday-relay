#!/usr/bin/env python3
"""OL01 -- the world's tea things become porcelain to match the teapot (2026-09-16).

THE GAP. After TP01 the Tea Terraces' teapot is porcelain with gold rims and roses, and the cup and saucer standing
in front of it -- and every other generator tea cup, small cup, saucer and pot in the world (tea_census.py) -- are
still the old faceted plaster, one material, the same grey-box read the teapot had.

WHAT. The forge's Wonderland object language (wonderland-blender-forge 20983a25 / 4ea003a4):
  WL_Object_TeaCup       2.62 m, open thin wall, gold rim and foot, handle, roses
  WL_Object_TeaSaucer    7.24 m across, well, gold well line and edge
  WL_Object_TeapotPavilion (small pots) -- the TP01 teapot, scaled down
HOW, reversibly, like TP01: each generator actor is sunk 60 m by a recorded actor trim (ol01_tea_trim.json), and its
replacement stands at the same position and yaw, one StaticMeshActor per material part (ol01_tea_set.json), SCALED TO
THE OLD ONE'S SIZE -- a cup and a pot by height, a saucer by width -- so nothing the generator arranged around it moves.
A cup that stands at its saucer's origin is raised onto the saucer's well (0.26 m at the saucer's scale).

    python ol01_tea_set.py            (reads tea_census.json)
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

SINK = -6000.0
WELL_Z = 26.0
REPLACE = {  # old mesh -> (kit module, "height" | "width")
    "SM_tea_cup": ("WL_Object_TeaCup", "height"),
    "SM_tea_cup_small": ("WL_Object_TeaCup", "height"),
    "SM_tea_saucer": ("WL_Object_TeaSaucer", "width"),
    "SM_tea_pot": ("WL_Object_TeapotPavilion", "height"),
}
SOLID = ("enamel", "gold")


def kit_size(module):
    m = KIT[module]
    return {"height": m["bbox_max"][2] - m["bbox_min"][2],
            "width": max(m["bbox_max"][0] - m["bbox_min"][0], m["bbox_max"][1] - m["bbox_min"][1])}


def main():
    rows = json.loads((TMP / "tea_census.json").read_text(encoding="utf-8"))
    saucers = [r for r in rows if r["mesh"] == "SM_tea_saucer"]
    trims, actors = [], []
    seen = set()
    for r in rows:
        module, by = REPLACE[r["mesh"]]
        t = r["transform"]
        old = {"height": r["bmax"][2] - r["bmin"][2],
               "width": max(r["bmax"][0] - r["bmin"][0], r["bmax"][1] - r["bmin"][1])}
        scale = round(old[by] / kit_size(module)[by], 4)
        # THE BOUNDS' BOTTOM, NOT THE PIVOT: the generator's pots have their pivots 0.9-2.9 m up (z 86..289), and a
        # replacement placed at the pivot floats
        z = r["bmin"][2]
        if r["mesh"] != "SM_tea_saucer":
            for sc in saucers:
                st = sc["transform"]
                if abs(st[0] - t[0]) < 5.0 and abs(st[1] - t[1]) < 5.0:
                    sw = max(sc["bmax"][0] - sc["bmin"][0], sc["bmax"][1] - sc["bmin"][1])
                    z = st[2] + WELL_Z * sw / kit_size("WL_Object_TeaSaucer")["width"]
                    break
        after = list(t)
        after[2] = SINK
        # the generator stacks duplicates (S15_tea_Saucer0 and Saucer4 at one spot, two yaws): every old piece is
        # sunk, but a smooth replacement drawn twice in one place z-fights, so each stack is replaced once
        key = (module, round(t[0] / 15.0), round(t[1] / 15.0))
        duplicate = key in seen
        seen.add(key)
        trims.append({"name": r["name"], "label": r["label"], "mesh": r["mesh"], "index": None,
                      "why": "replaced by %s at the same place and size (OL01)" % module, "before": t, "after": after})
        if duplicate:
            continue
        for part in KIT[module]["parts"]:
            actors.append({"id": "%s_%s" % (r["label"], part["part"]), "mesh": part["mesh"], "materials": [part["material"]],
                           "loc": [t[0], t[1], round(z, 1)], "rot": [0.0, t[4], 0.0], "scale": [scale, scale, scale],
                           "collision": "block" if part["part"] in SOLID else "none", "cast_shadow": True, "affect_df": False})
    (HERE / "ol01_tea_trim.json").write_text(json.dumps({"pass": "OL01_TRIM", "title": "Tea things: the plaster set sunk below the datum (reversible)",
                                                          "trims": trims}, indent=1) + "\n", encoding="utf-8", newline="\n")
    (HERE / "ol01_tea_set.json").write_text(json.dumps({"pass": "OL01", "title": "Tea things: porcelain cups, saucers and pots",
                                                         "tags": ["OL01"], "actors": actors, "batches": []}, indent=1) + "\n",
                                            encoding="utf-8", newline="\n")
    return len(trims), len(actors)


if __name__ == "__main__":
    print("trims %d, actors %d" % main())
