#!/usr/bin/env python3
"""QK01 -- QUARTER KINDS: give the forge's tower and grove quarters the towers and mushrooms their kind names.

    python WorldDesign/Districts/quarter_kinds.py        (writes qk01_quarter_kinds.json)

WHY (2026-09-29, CORE Q10). The forge's core has 24 quarters: the ring of 12 (`_QUARTERS`) and the first round
of 12 audit-placed `_QUARTER_SITES` (wonderland-blender-forge/wonderland/v2/layout_v2.py). Each has a kind:
garden, towers or grove. The census (05:05, within 25 m of each centre) finds every one of them built on,
74-1,378 pieces. Garden quarters read as gardens. But not one of the 7 tower quarters has a tower in it,
and 1 of the 7 grove quarters has a mushroom. The kinds exist in the plan and not in the world.
WHAT. Additive, nothing through anything standing (forge_districts.Site: the shared oriented-rectangle
Occupancy over the census, spiral search to 9 m, a slot with no room is left out and counted):
  TOWERS  up to 3 capped towers (tower_capped + steep cone roof + gold finial), the forge's
          `_quarter_towers` falling heights, one balcony ring on the tallest.
  GROVE   one giant mushroom on a stone ring (the four-part SM_mushroom_giant), then medium and small ones
          gathered at its feet.
Garden quarters are left alone. 260 m cull on the small pieces, 600 m on towers and giants.
RESULT (05:05 census, hidden MarbleWorld scaffold excluded): room for 3 of 21 towers (Q05 x2, S05 x1) and 0 of 7
giant mushrooms. The core is planted wall to wall (ground flowers, beds, hedges), so the kinds cannot be added
without REPLACING accepted core planting -- a founder decision under the grow-outward rule. The tower and grove
identities go outward instead: TW01 Tower Rise (111 deg 478 m), MG01 Mushroom Grove (297 deg 984 m), and the
heartland mushroom woods. No QK01 spec is kept, so nothing here can be applied by accident.
"""
import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import forge_districts as FD                                              # noqa: E402

PASS = "QK01"
# layout_v2.py: _QUARTERS (bearing deg, radius uu, kind) and the first twelve _QUARTER_SITES (x, y, kind)
QUARTERS = [(200.0, 11000, "garden"), (232.0, 13500, "towers"), (263.0, 10200, "grove"), (295.0, 14000, "garden"),
            (326.0, 11200, "towers"), (356.0, 13000, "grove"), (25.0, 11500, "garden"), (56.0, 13800, "towers"),
            (128.0, 12500, "grove"), (152.0, 10800, "garden"), (176.0, 14200, "towers"), (108.0, 15500, "garden")]
SITES = [(7751, -5529, "garden"), (-7826, -5083, "towers"), (10316, 11105, "grove"), (-10535, 11443, "garden"),
         (1708, 13010, "towers"), (-4210, 8887, "grove"), (4296, 8776, "garden"), (9600, -9800, "grove"),
         (-9400, -9500, "garden"), (11200, 2600, "towers"), (-11400, 2200, "grove"), (0, -10600, "garden")]
ROOFS = ("MI_V2_RoofPink", "MI_V2_RoofLilac", "MI_V2_RoofBlue", "MI_V2_RoofRose", "MI_V2_RoofNavy")
CAPS = (("MI_V2_MushRed", "MI_V2_MushCream"), ("MI_V2_MushCream", "MI_V2_MushRed"),
        ("MI_V2_MushTerracotta", "MI_V2_MushCream"))


def towers(site, spec, qid, cx, cy, rng):
    plan = ((0, 0, 1.1), (900, 600, 0.85), (-800, 700, 0.95))
    n = 0
    for i, (dx, dy, h) in enumerate(plan):
        spot = site.find(cx + dx, cy + dy, 190.0 * h + 60.0, over=210.0 * h, margin=120.0)
        if spot is None:
            spec.stats["tower_no_room"] += 1
            continue
        x, y = spot
        z = site.ground(x, y)
        yaw = rng.uniform(0.0, 360.0)
        roof = ROOFS[(len(qid) + i + int(cx) // 1000) % len(ROOFS)]
        spec.add("Tower", "SM_tower_capped", "MI_V2_IvoryStone", x, y, z, yaw, h, collides=True, cull=60000.0)
        spec.add("TowerCap", "SM_roof_cone_steep", roof, x, y, z + 1100.0 * h, yaw, h, cull=60000.0)
        spec.add("TowerSpire", "SM_finial_spire", "MI_V2_Gold", x, y, z + 1560.0 * h, yaw, 0.7 * h, cull=60000.0)
        if i == 0:
            spec.add("TowerBalcony", "SM_balcony_ring", "MI_V2_GoldAged", x, y, z + 585.0 * h, yaw, 0.65 * h)
        site.occ.add("existing", x, y, 190.0 * h, 190.0 * h, 0.0, "QK01:tower")
        site.occ.add("solid", x, y, 210.0 * h, 210.0 * h, 0.0, "QK01:tower")
        spec.stats["tower"] += 1
        n += 1
    return n


def grove(site, spec, qid, cx, cy, rng):
    s = 0.75
    cap, spots = CAPS[len(qid) % len(CAPS)]
    spot = site.find(cx, cy, 330.0 * s + 80.0, over=1000.0 * s, margin=120.0)
    if spot is None:
        spec.stats["giant_no_room"] += 1
        return 0
    x, y = spot
    z = site.ground(x, y)
    yaw = rng.uniform(0.0, 360.0)
    spec.add("Giant", "SM_mushroom_giant", cap, x, y, z, yaw, s, collides=True, cull=60000.0)
    spec.add("GiantGills", "SM_mushroom_giant_gills", "MI_V2_MushCream", x, y, z, yaw, s, cull=60000.0)
    spec.add("GiantRim", "SM_mushroom_giant_rim", "MI_V2_Gold", x, y, z, yaw, s, cull=60000.0)
    spec.add("GiantSpots", "SM_mushroom_giant_spots", spots, x, y, z, yaw, s, cull=60000.0)
    spec.add("RingBase", "SM_stone_ring_base", "MI_V2_Stone", x, y, z, yaw, 1.2 * s, collides=True)
    site.occ.add("existing", x, y, 330.0 * s, 330.0 * s, 0.0, "QK01:stem")
    site.occ.add("solid", x, y, 1000.0 * s, 1000.0 * s, 0.0, "QK01:cap")
    spec.stats["giant"] += 1
    for k in range(5):
        a, d = rng.uniform(0.0, 2 * math.pi), rng.uniform(450.0, 900.0)
        p = site.find(x + d * math.cos(a), y + d * math.sin(a), 150.0, margin=40.0, reach=300.0)
        if p:
            spec.add("Medium", "SM_mushroom_medium", ("MI_V2_MushRed", "MI_V2_MushCream")[k % 2], p[0], p[1],
                     site.ground(*p), rng.uniform(0, 360), rng.uniform(0.7, 1.1), cull=26000.0)
            site.occ.add("existing", p[0], p[1], 150.0, 150.0, 0.0, "QK01:medium")
            spec.stats["medium"] += 1
    for k in range(8):
        a, d = rng.uniform(0.0, 2 * math.pi), rng.uniform(350.0, 1200.0)
        p = site.find(x + d * math.cos(a), y + d * math.sin(a), 70.0, margin=20.0, reach=200.0)
        if p:
            spec.add("Small", "SM_mushroom_small", ("MI_V2_MushPurple", "MI_V2_MushRed")[k % 2], p[0], p[1],
                     site.ground(*p), rng.uniform(0, 360), rng.uniform(0.6, 1.2), cull=26000.0)
            site.occ.add("existing", p[0], p[1], 70.0, 70.0, 0.0, "QK01:small")
            spec.stats["small"] += 1
    return 1


def main():
    rng = random.Random(1010)
    site = FD.Site(0.0, 0.0, 17000.0)          # one Occupancy for the whole core, so quarters see each other's pieces
    spec = FD.Spec(PASS, "Wonderland/Authored/QK01_QuarterKinds", ["WL_DISTRICT", "WL_QUARTER_KINDS"])
    report = []
    quarters = [("Q%02d" % (i + 1), r * math.cos(math.radians(b)), r * math.sin(math.radians(b)), k)
                for i, (b, r, k) in enumerate(QUARTERS)]
    quarters += [("S%02d" % (i + 1), float(x), float(y), k) for i, (x, y, k) in enumerate(SITES)]
    for qid, cx, cy, kind in quarters:
        if kind == "towers":
            report.append((qid, kind, towers(site, spec, qid, cx, cy, rng)))
        elif kind == "grove":
            report.append((qid, kind, grove(site, spec, qid, cx, cy, rng)))
    out = spec.out("Quarter kinds: towers for the forge's tower quarters, a giant mushroom grove for its groves")
    (HERE / "qk01_quarter_kinds.json").write_text(json.dumps(out, indent=1), encoding="utf-8")
    total = sum(len(b["instances"]) for b in out["batches"])
    print("%s: %d instances in %d batches; %s" % (PASS, total, len(out["batches"]), dict(spec.stats)))
    for qid, kind, n in report:
        print("   %s %-6s %s" % (qid, kind, n))


if __name__ == "__main__":
    main()
