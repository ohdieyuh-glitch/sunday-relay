#!/usr/bin/env python3
"""AP01 -- the three arrival approaches: connect Golden Arrival to the nations it is the arrival for.

THE BLOCKER THIS CLOSES. Measured 2026-09-23 over all 270 layer specs: each nation is internally continuous
(ICARUS runs IC01 500->639 m, IC02 637->824 m, IC03 819->1158 m with no break, and NOCTIS and TARTARUS chain
the same way), but every one of them BEGINS at 500-508 m while Golden Arrival's built edge is about 400 m. An
identical 100-108 m unbuilt ring surrounds the entire arrival city.

The causeways make it worse rather than better. They are the actual roads -- SM_terrace_platform, collision on,
the surface a player walks -- and they run 504->634 m, starting AT the nation boundary and heading outward. Not
one of them reaches back toward the city it is supposed to arrive from. So the first journey any beta player
takes, out of Golden Arrival toward any nation, crosses ~100 m of open ground with no road, no kerb and no
edge to follow. It was blocker 1 in WORLD_BETA_LEDGER.md and it is the one gap every single player meets.

WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT. It extends each existing causeway INWARD to the arrival
city's edge, in the same mesh, the same material, the same step, the same z and the same collision as the
causeway it continues. That is the whole change. It is a road completed, not a road redesigned:

  ICARUS    from (0, 50370) inward along -Y                  PlazaCream, step 740 cm, 1 file
  NOCTIS    from (-43608, -26008) inward on bearing 210      PlazaGrey,  step 1440 cm, 2 files
  TARTARUS  from (43608, -26008) inward on bearing 330       PlazaShade, step 1440 cm, 2 files

Each is read from its own band spec at generation time rather than hard-coded, so if a causeway moves or is
re-tuned, the approach that continues it moves with it. The kerb courses that edge the existing causeways are
continued the same way, because a road without an edge is what the founder means by a procedural sheet.

NOT A DISTRICT. This pass adds no buildings, no planting and no decoration. The ring between the city and the
nations may well deserve a built threshold, a green approach, or a district of its own -- that is a founder
decision recorded as open in the ledger. What it must not remain is untraversable, and that is a defect rather
than a design question.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
PASS = "AP01"
GA_EDGE = 40000.0            # cm: Golden Arrival's measured built edge, ~400 m
OVERLAP = 1600.0             # cm the approach reaches INSIDE that edge, so the two surfaces meet rather than abut

#: (spec, causeway batch id, kerb batch ids that edge it)
ROADS = [
    ("ic01_march.json", "IC01_Causeway", ["IC01_Kerb"]),
    ("nc01_quarter.json", "NC01_Causeway", ["NC01_Ground_Kerb_Run_kerb"]),
    ("tq01_quarter.json", "TQ01_Causeway", ["TQ01_Ground_Kerb_Run_kerb"]),
]


def radial(x, y):
    r = math.hypot(x, y)
    return (x / r, y / r, r)


def extend(batch, label):
    """Continue a batch's innermost run inward to the arrival city, keeping its own spacing and offsets.

    A causeway may be several files wide (NOCTIS and TARTARUS lay two), so the instances at the innermost
    radius are taken as a CROSS SECTION and the whole section is stepped inward together. Stepping a single
    file would build half a road.
    """
    ins = batch["instances"]
    if not ins:
        return []
    radii = [math.hypot(i[0], i[1]) for i in ins]
    r_min = min(radii)
    section = [i for i, r in zip(ins, radii) if r - r_min < 60.0]     # the innermost cross section
    # spacing: the gap between the innermost section and the next one out, along the radius
    outer = sorted({round(r, 1) for r in radii})
    step = (outer[1] - outer[0]) if len(outer) > 1 else 740.0
    #: STEP ALONG THE ROAD'S AXIS, NOT ONE INSTANCE'S RADIAL. Using section[0]'s radial tilts the whole
    #: extension by that instance's own bearing, and for a KERB -- whose first element sits 720 cm off the
    #: centreline -- that tilt converges the two kerb lines as they run inward. Measured in the first apply:
    #: the Icarus kerbs drifted from x = -720 to x = -596 over 120 m, a road quietly tapering by 1.24 m.
    #: The section is symmetric about the carriageway, so its CENTROID lies on the axis and its radial is
    #: the road's true direction. Every instance then steps by the same vector and the road stays parallel.
    cx = sum(i[0] for i in section) / len(section)
    cy = sum(i[1] for i in section) / len(section)
    ux, uy, _ = radial(cx, cy)
    n = int((r_min - (GA_EDGE - OVERLAP)) // step)
    out = []
    for k in range(1, n + 1):
        d = step * k
        for s in section:
            out.append([round(s[0] - ux * d, 1), round(s[1] - uy * d, 1), s[2],
                        s[3], s[4], s[5], s[6], s[7], s[8]])
    return out


def main():
    batches = {}
    report = []
    for spec_name, causeway_id, kerb_ids in ROADS:
        spec = json.loads((HERE / spec_name).read_text(encoding="utf-8"))
        by_id = {b["id"]: b for b in spec["batches"]}
        for bid in [causeway_id] + kerb_ids:
            src = by_id.get(bid)
            if src is None:
                continue
            new = extend(src, bid)
            if not new:
                continue
            #: KEY BY THE WHOLE SOURCE ID, NOT THE STRIPPED ONE. Stripping the nation prefix merged
            #: IC01_Causeway (PlazaCream) with NC01_Causeway (PlazaGrey) and TQ01_Causeway (PlazaShade) into
            #: one batch that kept whichever material arrived first -- three nations' roads rendering as one
            #: colour. That is the identical defect this lane found in courtkit.inst_world today: a batch is
            #: one mesh AND one material, and any key coarser than that silently discards the difference.
            key = "%s_%s" % (PASS, bid)
            b = batches.setdefault(key, {"id": key, "mesh": src["mesh"], "material": src["material"],
                                         "instances": [], "collides": src.get("collides", False),
                                         "cast_shadow": src.get("cast_shadow", True), "affect_df": False,
                                         "cull_distance": src.get("cull_distance", 40000.0)})
            b["instances"].extend(new)
            report.append((bid, len(new), src.get("collides")))

    inst = sum(len(b["instances"]) for b in batches.values())
    spec = {"pass": PASS,
            "title": "AP01: the three arrival approaches -- Golden Arrival joined to the nations",
            "tags": ["AP01", "WL_APPROACH", "WL_ARRIVAL"],
            "folder": "Wonderland/Authored/AP01_ArrivalApproaches",
            "actors": [], "batches": list(batches.values())}
    (HERE / "ap01_arrival_approaches.json").write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print("%s -> ap01_arrival_approaches.json" % PASS)
    print("  reaching inward to r %.0f m (Golden Arrival edge %.0f m, overlap %.0f m)"
          % ((GA_EDGE - OVERLAP) / 100, GA_EDGE / 100, OVERLAP / 100))
    print("  batches %d, instances %d" % (len(batches), inst))
    for bid, n, coll in report:
        print("    continued %-34s %4d instances  collides=%s" % (bid, n, coll))
    return spec


if __name__ == "__main__":
    main()
