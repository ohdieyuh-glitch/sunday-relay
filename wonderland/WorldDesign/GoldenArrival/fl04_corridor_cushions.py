#!/usr/bin/env python3
"""FL04 -- the corridor's last flower cushions become flower beds.

THE GAP (corridor survey corr2, 2026-09-13; founder: "Flowers should not read as flat color clusters"). After FL01-FL03
the authored beds are real flowers, but the generator still lays SM_ground_blooms and SM_ground_flowers along the
corridor: 77 instances at 42 spots from the rear gate to the palace (census 328), each a rounded pink, lilac or green
cushion on the lawn -- and 114 SM_flower_cluster / SM_blossom_cluster / SM_lavender_heads (census 334), the big pink
and lilac "pillows" at the Clock Plaza's north edge.

WHAT THIS PASS DOES.
  TRIM  every one sunk 1 km in two reversible trims (77: fl04_corridor_cushions_trim.json; 114:
        fl04b_corridor_clusters_trim.json), each with its exact before; REVERT restores.
  LAYER at each spot a bed of two forge flower runs (GAP 19) side by side, turned to the cushion's own yaw and scaled
        to its size, the petal colour following the cushion's (violet stays violet, pink stays pink, rose becomes
        roses, green leaf cushions become lavender), seated where the cushion sat.
MEASURED INPUTS. Census 328 (object names, indices, transforms, bounds). kit_modules.json.
"""
import json
import math
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "FL04"
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
CENSUS = HERE / "fl04_cushion_census_2026-09-13.json"          # ground blooms / ground flowers (census 328)
CENSUS_B = HERE / "fl04b_cluster_census_2026-09-13.json"       # flower / blossom clusters, lavender heads (census 334)
SINK_UU = 100000.0
# where a generator cluster stood ON PAVING, it is sunk and not replanted -- a bed on the stone reads as dropped
# there (hg4: two beds on the arrival plaza, one on its medallion). The arrival plaza has GA05's planters.
NO_BEDS = [(-660.0, 660.0, -1600.0, 900.0)]
RUNS = {"daisy": "WL_Flower_Daisy_Run", "lavender": "WL_Flower_Lavender_Run", "rose": "WL_Flower_Rose_Run"}


def _colour(label):
    """The cushion's petal material -> (kind, petal) of the runs that replace it."""
    m = label.split("MI_V2_")[-1] if "MI_V2_" in label else ""
    return {"PetalViolet": [("daisy", "MI_V2_PetalViolet"), ("lavender", "MI_V2_PetalViolet")],
            "PetalBlue": [("daisy", "MI_V2_PetalBlue"), ("lavender", "MI_V2_PetalViolet")],
            "PetalPink": [("daisy", "MI_V2_PetalPink"), ("rose", "MI_V2_RosePink")],
            "RosePink": [("rose", "MI_V2_RosePink"), ("daisy", "MI_V2_PetalPink")],
            "PetalRose": [("rose", "MI_V2_RoseRed"), ("rose", "MI_V2_RosePink")],
            "PetalWhite": [("daisy", "MI_V2_PetalWhite"), ("lavender", "MI_V2_PetalViolet")],
            "LeafMid": [("lavender", "MI_V2_PetalViolet"), ("daisy", "MI_V2_PetalWhite")]}.get(m, [("daisy", "MI_V2_PetalPink"), ("lavender", "MI_V2_PetalViolet")])


def _trim(pass_id, title, rows):
    trims = []
    for r in rows:
        after = list(r["transform"])
        after[2] = round(after[2] - SINK_UU, 3)
        trims.append({"name": r["name"], "label": r["label"], "mesh": r["mesh"], "index": r["index"],
                      "why": "cushion flower mesh replaced by FL04 flower runs", "before": r["transform"], "after": after})
    return {"pass": pass_id, "title": title, "trims": trims}


def build():
    rows_a = json.loads(CENSUS.read_text(encoding="utf-8"))["rows"]
    rows_b = json.loads(CENSUS_B.read_text(encoding="utf-8"))["rows"]
    rows = rows_a + rows_b
    trim = _trim(PASS + "_TRIM", "Corridor ground-bloom cushions sunk (reversible)", rows_a)
    trim_b = _trim(PASS + "B_TRIM", "Corridor flower clusters and lavender heads sunk (reversible)", rows_b)

    spots = defaultdict(list)
    for r in rows:
        spots[(round(r["x"] / 60.0), round(r["y"] / 60.0))].append(r)
    batches = {}

    def inst(kind, part, material, x, y, z, yaw, s):
        key = "%s_%s_%s_%s" % (PASS, kind, part["part"], material.split("_")[-1])
        b = batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material, "instances": [], "collides": False,
                                     "cast_shadow": True, "affect_df": False})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, round(yaw % 360.0, 1), 0.0, round(s, 3), round(s, 3), round(s, 3)])

    beds = []
    for k, group in enumerate(spots.values()):
        blooms = [g for g in group if g["mesh"] == "SM_ground_blooms"]
        lead = blooms[0] if blooms else group[0]
        tr = lead["transform"]
        x, y, yaw = tr[0], tr[1], tr[4]
        if any(x0 <= x <= x1 and y0 <= y <= y1 for (x0, x1, y0, y1) in NO_BEDS):
            continue                                  # sunk, not replanted: it stood on paving (hg4)
        base = tr[2] - 1.0 if blooms else lead["zmin"] + 6.0
        size = max(g["radius"] for g in group)
        s = max(0.8, min(1.3, size / 100.0))
        th = math.radians(yaw)
        for j, (kind, petal) in enumerate(_colour(lead["label"])):
            off = (j - 0.5) * 48.0 * s
            px, py = x - math.sin(th) * off, y + math.cos(th) * off
            for part in KIT[RUNS[kind]]["parts"]:
                material = petal if part["part"] == "petal" else ("MI_V2_LeafDark" if part["part"] == "leaf" and (k + j) % 2 else part["material"])
                inst(kind, part, material, px, py, base, yaw, s)
        beds.append([round(x), round(y), round(base, 1), lead["label"].split("MI_V2_")[-1]])
    layer = {"pass": PASS, "title": "Corridor flower cushions replaced by beds of forge flower runs",
             "folder": "Wonderland/Authored/FL04", "tags": ["V2_Garden"], "actors": [], "batches": list(batches.values()),
             "beds": beds}
    return trim, trim_b, layer


if __name__ == "__main__":
    trim, trim_b, layer = build()
    (HERE / "fl04_corridor_cushions_trim.json").write_text(json.dumps(trim, indent=1) + "\n", encoding="utf-8", newline="\n")
    (HERE / "fl04b_corridor_clusters_trim.json").write_text(json.dumps(trim_b, indent=1) + "\n", encoding="utf-8", newline="\n")
    (HERE / "fl04_corridor_cushions.json").write_text(json.dumps(layer, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: %d + %d trims; %d beds, %d batches, %d instances" % (PASS, len(trim["trims"]), len(trim_b["trims"]), len(layer["beds"]), len(layer["batches"]),
          sum(len(b["instances"]) for b in layer["batches"])))
