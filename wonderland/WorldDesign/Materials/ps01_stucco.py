#!/usr/bin/env python3
"""PS01 -- some of the city's walls are plastered, not built of ashlar (2026-09-17).

THE GAP (founder material-realism phase, "plaster"; the Bible's material palette). Every wall in Wonderland wears the
same surface: the visible-material census lists MI_V2_AshlarMarblePale (9,267 m2 in view), Blush (2,835), Ceramic
(2,739), Cool (2,534) and Shade (2,323) -- five tints of ONE material, coursed ashlar, on every facade in every
district. BOARD_2's palette names CREAM STUCCO alongside pale stone, and a street where every building is cut from
the same block reads as a kit, however good that block is.

WHAT. `make_stucco_materials.py` builds MI_V2_StuccoCream / StuccoBlush / StuccoShade on M_V2_SurfaceHD from the new
stucco texture family, each taking its tint from the ashlar instance it stands beside in the palette. This design
picks which walls get them.

THE UNIT IS A BATCH. A WonderlandInstancedBatch draws all its instances with one material, so the swap can only work
batch by batch -- but that is fine here: 178 building batches, a median of 5 buildings each, so a third of them
plastered reads as building-to-building variety down a street, not as a repainted district.

WHICH. Only facade panels and castle halls (arcades have their own order; towers and gatehouses are landmarks), only
batches whose current material is one of the ashlar tints, and a deterministic SHARE of them by a hash of the batch's
name, so the choice reproduces and neighbouring batches differ. The stucco tint follows the ashlar tint it replaces,
so a blush building stays blush.

    python ps01_stucco.py        (reads batch_census.json; writes ps01_stucco_swaps.json)
"""
import hashlib
import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(r"C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp")

PASS = "PS01"
MESHES = ("SM_facade_panel", "SM_castle_hall")
SHARE = 0.34
TINT = {"MI_V2_AshlarMarblePale": "MI_V2_StuccoCream", "MI_V2_AshlarCeramic": "MI_V2_StuccoCream",
        "MI_V2_AshlarMarbleCool": "MI_V2_StuccoCream", "MI_V2_AshlarMarbleBlush": "MI_V2_StuccoBlush",
        "MI_V2_AshlarMarbleShade": "MI_V2_StuccoShade"}


def pick(name):
    """A stable 0..1 from the batch's own name: the same batches are chosen on every run."""
    return int(hashlib.sha1(name.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF


def main():
    rows = json.loads((TMP / "batch_census.json").read_text(encoding="utf-8"))
    stats = Counter()
    swaps = []
    for r in rows:
        if r["mesh"] not in MESHES:
            continue
        stats["candidate_batches"] += 1
        after = TINT.get(r["material"])
        if after is None:
            stats["material_not_ashlar_" + str(r["material"])] += 1
            continue
        if pick(r["name"]) >= SHARE:
            stats["left_in_stone"] += 1
            continue
        swaps.append({"name": r["name"], "label": r["label"], "before": r["material"], "after": after,
                      "instances": r["instances"]})
        stats["plastered_batches"] += 1
        stats["plastered_buildings"] += r["instances"]
        stats[after] += 1
    spec = {"pass": PASS, "title": "PS01: a third of the city's walls are plastered, not ashlar", "swaps": swaps}
    (HERE / "ps01_stucco_swaps.json").write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    return stats


if __name__ == "__main__":
    print(dict(main()))
