"""Secondary dressing — the PCG-equivalent, run AFTER the authored layout.

What it may place: ground flowers, small mushrooms, moss tufts (hedge masses
at ground scale), topiary balls, rose bushes — in the GARDEN ZONES only.
What it may never touch: the plaza, the corridor, the landmarks' positions.
Everything is deterministic (hash-keyed) and respects a keep-out around every
authored placement, so the dressing thickens the bands without stacking on
them or drifting into the open centre. Densities are modest on purpose —
the reference is lush but organised.
"""

import math

import layout_v2 as L

#: garden zones as axis-aligned boxes (x0, x1, y0, y1, terrace z) — the raised
#: beds beside the plaza, the front beds, the left and right gardens
ZONES = (
    ("bed_L", 900.0, 1400.0, -900.0, 800.0, 60.0),
    ("bed_R", -1400.0, -900.0, -900.0, 800.0, 60.0),
    ("front_L", 450.0, 1800.0, 950.0, 1400.0, 60.0),
    ("front_R", -1800.0, -450.0, 950.0, 1400.0, 60.0),
    ("garden_L", 700.0, 3200.0, 1500.0, 4200.0, 0.0),
    ("garden_R", -3400.0, -700.0, 1500.0, 4200.0, 0.0),
    ("verge_L", 330.0, 700.0, 1700.0, 4300.0, 60.0),
    ("verge_R", -700.0, -330.0, 1700.0, 4300.0, 60.0),
)
#: (asset, weight, min scale, max scale, material choices, per 100 m²)
FAMILIES = (
    ("ground_flowers", 5, 0.7, 1.1, ("MI_V2_PetalPink", "MI_V2_PetalViolet", "MI_V2_PetalBlue", "MI_V2_RosePink"), 9.0),
    ("mushroom_small", 2, 0.5, 0.9, ("MI_V2_MushRed", "MI_V2_MushPurple", "MI_V2_MushCream"), 1.6),
    ("hedge_mass", 2, 0.5, 0.8, ("MI_V2_LeafMid", "MI_V2_LeafDark"), 2.2),
    ("rose_bush", 1, 0.7, 1.0, ("MI_V2_LeafMid",), 1.4),
    ("topiary_ball", 1, 0.7, 1.0, ("MI_V2_LeafMid", "MI_V2_LeafDark"), 0.8),
)


def _in_exclusion(x, y):
    x0, x1, y0, y1 = L.PLAZA_RECT
    if x0 - 50 < x < x1 + 50 and y0 - 50 < y < y1 + 50:
        return True
    if abs(x) < 320.0 and 780.0 < y < 4700.0:      # the corridor + its kerbs
        return True
    return False


def plan(seed=7, density=1.0, keep_out=110.0):
    authored = [(it["pos"][0], it["pos"][1]) for it in L.ALL if it["band"] in ("V2_Arrival", "V2_Garden")]
    out = []
    for zi, (name, x0, x1, y0, y1, z) in enumerate(ZONES):
        area_m2 = (x1 - x0) * (y1 - y0) / 10000.0
        for fi, (asset, w, s0, s1, mats, per100) in enumerate(FAMILIES):
            n = int(area_m2 / 100.0 * per100 * density)
            placed = []
            for k in range(n * 3):
                if len(placed) >= n:
                    break
                x = x0 + (x1 - x0) * L._rnd(seed, zi, fi, k, 1)
                y = y0 + (y1 - y0) * L._rnd(seed, zi, fi, k, 2)
                if _in_exclusion(x, y):
                    continue
                if any(math.hypot(x - ax, y - ay) < keep_out for (ax, ay) in authored):
                    continue
                if any(math.hypot(x - px, y - py) < keep_out * 0.6 for (px, py) in placed):
                    continue
                sc = s0 + (s1 - s0) * L._rnd(seed, zi, fi, k, 3)
                out.append({"asset": asset, "pos": (x, y, z), "rot": (0.0, 360.0 * L._rnd(seed, zi, fi, k, 4), 0.0),
                            "scale": (sc, sc, sc), "mat": mats[int(L._rnd(seed, zi, fi, k, 5) * len(mats)) % len(mats)],
                            "label": "Dress_%s_%s%d" % (name, asset, k), "band": "V2_Vegetation"})
                placed.append((x, y))
    return out


def summary(items):
    by = {}
    for it in items:
        by[it["asset"]] = by.get(it["asset"], 0) + 1
    return ", ".join("%s x%d" % kv for kv in sorted(by.items()))
