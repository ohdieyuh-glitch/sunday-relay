#!/usr/bin/env python3
"""LL01 -- the Lantern Hamlets' and Mushroom Grove's strange lanterns become gold lantern standards (2026-09-16).

THE GAP. LanternLaneCam27: the district's landmark lanterns are SM_lantern_strange -- bronze bent posts holding beige
barrel lanterns whose streaked texture reads as rust -- 10-15 m tall, 11 in each of LMLanternHamlets and
LMMushroomGrove (+3 more), each paired with an SM_lantern_strange_glass at the same transform. The Bible's lantern is
gold and glazed.

WHAT. The forge's WL_Object_LanternStandard (wonderland-blender-forge 292df7ae): stone plinth, fluted gold shaft, two
scrolled arms, two glazed gold lanterns, finial. 12.2 m.

HOW, reversibly, like TP01 / OL01: each generator lantern and its glass are sunk 60 m by a recorded actor trim
(ll01_lantern_trim.json); a standard stands at the same x, y and yaw, on the old bounds' bottom, scaled to the old
lantern's height (so what the generator arranged around it keeps its clearances). Source: lantern_census.json
(zzJ04, read-only).

    python ll01_lantern_standards.py
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

SINK = -6000.0
MODULE = "WL_Object_LanternStandard"
BODY = "SM_lantern_strange"
GLASS = "SM_lantern_strange_glass"
SOLID = ("stone", "gold")


def main():
    rows = json.loads((TMP / "lantern_census.json").read_text(encoding="utf-8"))
    bodies = [r for r in rows if r["mesh"] == BODY and r["kind"] == "actor"]
    glass = [r for r in rows if r["mesh"] == GLASS and r["kind"] == "actor"]
    kit_h = KIT[MODULE]["bbox_max"][2] - KIT[MODULE]["bbox_min"][2]
    trims, actors = [], []
    for b in bodies:
        t = b["transform"]
        partner = [g for g in glass if abs(g["transform"][0] - t[0]) < 5.0 and abs(g["transform"][1] - t[1]) < 5.0]
        for r in [b] + partner:
            after = list(r["transform"])
            after[2] = SINK
            trims.append({"name": r["name"], "label": r["label"], "mesh": r["mesh"], "index": None,
                          "why": "replaced by %s at the same place and height (LL01)" % MODULE,
                          "before": r["transform"], "after": after})
        scale = round((b["bmax"][2] - b["bmin"][2]) / kit_h, 4)
        for part in KIT[MODULE]["parts"]:
            actors.append({"id": "%s_%s" % (b["label"], part["part"]), "mesh": part["mesh"], "materials": [part["material"]],
                           "loc": [t[0], t[1], b["bmin"][2]], "rot": [0.0, t[4], 0.0], "scale": [scale, scale, scale],
                           "collision": "block" if part["part"] in SOLID else "none", "cast_shadow": True, "affect_df": False})
    (HERE / "ll01_lantern_trim.json").write_text(json.dumps({"pass": "LL01_TRIM", "title": "Strange lanterns sunk below the datum (reversible)",
                                                              "trims": trims}, indent=1) + "\n", encoding="utf-8", newline="\n")
    (HERE / "ll01_lantern_standards.json").write_text(json.dumps({"pass": "LL01", "title": "Gold lantern standards for the strange lanterns",
                                                                   "tags": ["LL01"], "actors": actors, "batches": []}, indent=1) + "\n",
                                                       encoding="utf-8", newline="\n")
    return len(bodies), len(trims), len(actors)


if __name__ == "__main__":
    print("lanterns %d, trims %d, actors %d" % main())
