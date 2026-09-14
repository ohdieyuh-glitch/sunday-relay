#!/usr/bin/env python3
"""TR01 -- steps from the Clock Plaza up to the garden path.

THE DEFECT (walk test fl03c, 2026-09-13; probe 321). The garden path's flags end at y 44.9 m with their tops at
z 91.5-93.5; the Clock Plaza's slabs start at y 45.0 m with their tops at z -0.5. A 92 cm cliff with no step: a
visitor walking from the palace end drops onto the plaza and cannot walk back up to the garden, the arrival and the
map's first place. Private-beta gate item 3 (no dead ends, no collision traps).

WHAT THIS LAYER ADDS. A short flight laid on the plaza against the path's end, between the path's kerb walls:
three 30.8 cm risers (the kit's riser is 31 cm; the Dog climbs the V2 world's 31 cm steps), each tread 80 cm deep and
3.2 m wide, cut from chamfered stone blocks in the plaza's cream, with a gold nosing line on each tread edge. The
blocks collide; the nosings do not. Nothing on the path or the plaza is moved.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "TR01"
KERB = "/Game/WonderlandV2/Ground/Cobblestone/SM_kerb_stone.SM_kerb_stone"
PATH_TOP, PLAZA_TOP, EDGE_Y = 92.0, -0.5, 4498.0
WIDTH, GOING = 320.0, 80.0
# SM_kerb_stone at 1x: 120 x 36.2 x 28.2, footed at z 0 (mesh_bounds.json)
KX, KY, KZ = 120.0, 36.2, 28.2


def build():
    batches = {}

    def inst(key, material, x, y, z, sx, sy, sz, collides):
        b = batches.setdefault(key, {"id": key, "mesh": KERB, "material": material, "instances": [], "collides": collides,
                                     "cast_shadow": True, "affect_df": collides})
        b["instances"].append([round(x, 1), round(y, 1), round(z, 2), 0.0, 0.0, 0.0, round(sx, 4), round(sy, 4), round(sz, 4)])

    rise = (PATH_TOP - PLAZA_TOP) / 3.0
    treads = []
    for i in range(2):                       # two blocks on the plaza; the path's own end is the top tread
        top = PATH_TOP - rise * (i + 1)      # 61.2 against the path, then 30.4
        depth = GOING * (i + 1)              # each block runs back to the path's end, so no gap opens under a tread
        yc = EDGE_Y + depth * 0.5
        height = top - PLAZA_TOP + 2.0
        inst("%s_Treads" % PASS, "MI_V2_PlazaCream" if i == 0 else "MI_V2_PlazaWarm", 0.0, yc, PLAZA_TOP - 2.0,
             WIDTH / KX, depth / KY, height / KZ, True)
        # the gold nosing along the tread's front edge
        inst("%s_NosingGold" % PASS, "MI_V2_Gold", 0.0, EDGE_Y + depth - 3.0, top - 0.2, (WIDTH - 10.0) / KX, 6.0 / KY, 1.2 / KZ, False)
        treads.append({"top": round(top, 1), "front_y": round(EDGE_Y + depth, 1)})
    # a gold nosing at the path's own top edge, so all three edges read
    inst("%s_NosingGold" % PASS, "MI_V2_Gold", 0.0, EDGE_Y - 3.0, PATH_TOP - 0.2, (WIDTH - 10.0) / KX, 6.0 / KY, 1.2 / KZ, False)
    return {"pass": PASS, "title": "Steps from the Clock Plaza up to the garden path (92 cm ledge)",
            "folder": "Wonderland/Authored/TR01", "tags": ["V2_Garden"], "actors": [], "batches": list(batches.values()),
            "treads": treads, "riser_cm": round(rise, 1)}


if __name__ == "__main__":
    spec = build()
    out = HERE / "tr01_clock_plaza_steps.json"
    out.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")
    print("%s: riser %.1f cm, treads %s -> %s" % (PASS, spec["riser_cm"], spec["treads"], out.name))
