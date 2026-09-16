"""A short walk on from an arrival court, toward what that district has (2026-09-16).

THE GAP (PRIVATE_BETA_GATE item 12, after the twelve courts). Every offered place now arrives on an authored court,
and every court ends at its rose arch with nothing on the other side: the visitor steps through onto generator lawn.
This lays the next twenty metres -- the piece that turns an arrival into somewhere to walk.

WHAT A WALK IS. In the arrival frame of courtkit.Court, straight ahead from the court's arch:
  PAVING   a 4 m band of plaza slabs in courses, with a warm kerb either side, so it reads as a laid walk rather
           than slabs dropped on grass;
  BORDERS  beds of forge flower runs down both edges, alternating rose, lavender and daisy;
  LAMPS    a lamp pair at the halfway mark and another at the end;
  OVERLOOK a small round court where it stops (r 3.5 m), with a gold rim line, so the walk arrives somewhere rather
           than fraying out.
HOW LONG. Not a guess: the walk runs until the first thing in the district census stands within half a walk-width of
the axis, minus a stopping margin, and never further than MAX_LEN. A district whose first obstacle is close gets a
short walk and still gets its overlook.

HOW HIGH -- the second pass (2026-09-16, after probe_ground_editor.py measured the ground under all twelve).
The first version laid every walk at its court's top. That was wrong in both directions: over the lawn (-14) a court
top of 12.5 or 19.5 left the paving hanging 13-20 cm in the air, and where a walk crossed a city platform (12.0) or a
filler block's floor plate (14.8) the paving was BURIED under it -- the East Quarter lost 8 m of its walk that way and
South Meadows the first 6 m. So a walk is now laid to a MEASURED ground profile, in the courts' own convention:

    over lawn        top = ground + 14.0     (the slab sits on the grass)
    over hard paving  top = ground + 0.5     (the slab replaces it, flush)

The walk is cut into runs of constant top; where two runs differ it gets a kerb step across the full width, and the
side kerbs are skirted down to the lowest ground beside them, so a raised run shows a stone edge and never a gap.
"""
import json
import math
from pathlib import Path

import courtkit as K

HERE = Path(__file__).resolve().parent
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
RUNS = {"daisy": "WL_Flower_Daisy_Run", "lavender": "WL_Flower_Lavender_Run", "rose": "WL_Flower_Rose_Run"}
BED_KINDS = (("rose", "MI_V2_RosePink"), ("lavender", "MI_V2_PetalViolet"), ("daisy", "MI_V2_PetalWhite"))
HALF_WIDTH = 200.0
MAX_LEN = 2400.0
STOP_MARGIN = 420.0                       # the overlook's own radius plus a little air
LAWN_LABEL = "V2_GroundSlab"
STEP_MIN = 2.0                            # below this a level change is not worth a step


def top_for(ground_z, label):
    """The courts' convention: sit on grass, lie flush in paving."""
    return round(ground_z + (14.0 if label == LAWN_LABEL else 0.5), 1)


def clear_length(solids, ax, ay, yaw, start, max_len=MAX_LEN):
    """How far the walk can run before something stands in it. `solids`: [(x, y, radius, zmax), ...]."""
    th = math.radians(yaw)
    fx, fy = math.cos(th), math.sin(th)
    limit = max_len
    for (x, y, r, zmax) in solids:
        if zmax < 60.0:
            continue                       # flat things are walked over, not round
        dx, dy = x - ax, y - ay
        along = dx * fx + dy * fy
        lat = abs(-dx * fy + dy * fx)
        if along <= start:
            continue
        if lat < HALF_WIDTH + r * 0.72:
            limit = min(limit, along - r * 0.72 - STOP_MARGIN)
    return max(0.0, round(limit, 1))


def runs_from(profile, start, end):
    """Group measured samples [[d, top, low_ground], ...] into runs [(d0, d1, top, low), ...] of constant top."""
    pts = [p for p in sorted(profile) if start - 300.0 <= p[0] <= end + 400.0]
    if not pts:
        return [(start, end, 0.0, -14.0)]
    out = []
    i = 0
    while i < len(pts):
        j = i
        while j + 1 < len(pts) and abs(pts[j + 1][1] - pts[i][1]) < STEP_MIN:
            j += 1
        d0 = start if i == 0 else 0.5 * (pts[i - 1][0] + pts[i][0])
        d1 = end if j == len(pts) - 1 else 0.5 * (pts[j][0] + pts[j + 1][0])
        low = min(p[2] for p in pts[i:j + 1])
        out.append((round(max(d0, start), 1), round(min(d1, end), 1), pts[i][1], low))
        i = j + 1
    return [r for r in out if r[1] - r[0] > 40.0]


def build(pass_id, ax, ay, yaw, court_top, seed, start, length, title, profile):
    """A walk from `start` (uu ahead of the anchor) running `length` uu to an overlook, laid to a measured profile."""
    c = K.Court(pass_id, ax, ay, yaw, court_top - 13.5, seed)
    end = start + length
    legs = runs_from(profile, start, end)

    def step(d, low_top, high_top, width_half):
        """A kerb riser across the walk, from the lower course's underside to the higher course's top."""
        z = low_top - 13.5
        c.strip_across("WalkStep", "MI_V2_PlazaWarm", d, -width_half, width_half, 74.0, z, max(4.0, high_top + 0.6 - z))

    for (d0, d1, top, low) in legs:
        floor = top - 13.5
        c.pave_rect("WalkSlabs", d0, d1, -HALF_WIDTH, HALF_WIDTH, floor)
        skirt = min(low, floor) - 1.0
        for side in (1.0, -1.0):
            c.strip_along("WalkEdge", "MI_V2_PlazaWarm", side * (HALF_WIDTH + 34.0), d0, d1, 62.0, skirt,
                          max(6.0, top + 0.6 - skirt))
            c.strip_along("WalkGold", "MI_V2_Gold", side * (HALF_WIDTH - 16.0), d0, d1, 9.0, top + 0.4, 1.4)

    # steps: from the court onto the first run, then between runs
    if abs(legs[0][2] - court_top) >= STEP_MIN:
        step(legs[0][0], min(legs[0][2], court_top), max(legs[0][2], court_top), HALF_WIDTH + 66.0)
    for a, b in zip(legs, legs[1:]):
        step(b[0], min(a[2], b[2]), max(a[2], b[2]), HALF_WIDTH + 66.0)

    def top_at(d):
        for (d0, d1, top, low) in legs:
            if d0 - 1.0 <= d <= d1 + 1.0:
                return top, low
        return legs[-1][2], legs[-1][3]

    ov_d = end + 200.0
    ov_top, ov_low = top_at(ov_d)
    c.pave_disc("OverlookSlabs", ov_d, 0.0, -64.0, 350.0, ov_top - 13.5)
    c.ring("OverlookRim", "MI_V2_Gold", ov_d, 0.0, 330.0, 10.0, ov_top + 0.4, 1.4)
    c.ring("OverlookKerb", "MI_V2_PlazaWarm", ov_d, 0.0, 358.0, 56.0, min(ov_low, ov_top - 13.5) - 1.0,
           max(6.0, ov_top + 0.6 - (min(ov_low, ov_top - 13.5) - 1.0)))
    mid_top, _ = top_at(start + length * 0.5)
    c.lamp_pair("WalkMid", start + length * 0.5, HALF_WIDTH + 120.0, mid_top)
    c.lamp_pair("WalkEnd", ov_d, 300.0, ov_top)

    k = 0
    d = start + 140.0
    while d < end - 60.0:
        bed_top, _ = top_at(d)
        for side in (1.0, -1.0):
            kind, petal = BED_KINDS[k % len(BED_KINDS)]
            k += 1
            x, y = c.at(d, side * (HALF_WIDTH + 104.0))
            for part in KIT[RUNS[kind]]["parts"]:
                material = petal if part["part"] == "petal" else ("MI_V2_LeafDark" if part["part"] == "leaf" and k % 2 else part["material"])
                key = "%s_Bed_%s_%s" % (pass_id, part["part"], material.replace("MI_V2_", ""))
                b = c.batches.setdefault(key, {"id": key, "mesh": part["mesh"], "material": material, "instances": [],
                                               "collides": False, "cast_shadow": True, "affect_df": False})
                b["instances"].append([round(x, 1), round(y, 1), bed_top, 0.0, round((yaw + 90.0) % 360.0, 1), 0.0, 1.0, 1.0, 1.0])
        d += 260.0
    layer = c.layer(title)
    layer["walk"] = {"start": start, "length": length, "overlook_at": [round(v, 1) for v in c.at(ov_d, 0.0)],
                     "legs": [[r[0], r[1], r[2]] for r in legs]}
    return layer
