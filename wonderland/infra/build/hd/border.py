"""The path-border planting system — Phase T, as controlled bands not scatter.

The PCG plugin is not enabled in this project and PCG graphs are editor-authored
assets that Python cannot build, so this is the "or equivalent": the same
inputs the brief lists (path spline, exclusion width, inner band, outer band,
density, family, scale variance, rotation variance, seed), producing
deterministic placements the generator hands to its kits.

THREE BANDS, NOT ONE FIELD. The founder's reference banks its planting: low
flowers and moss right at the stone, then a mid storey of shrubs, blooms and
mushrooms, then the tall things — topiary and trees — furthest out. One uniform
scatter is what the brief calls "random procedural clutter", and it has been
the signature of every field this world grew until now.

Every placement is keyed to (band, slot, seed) through meshkit.rnd, so a
rebuild grows the identical border and the offline trace measures the world
the founder will get.
"""

import math

try:
    from . import meshkit as mk
except ImportError:
    import meshkit as mk


#: family -> (min scale, max scale, yaw jitter deg, tilt jitter deg)
FAMILIES = {
    "flower":   (0.30, 0.55, 360.0, 6.0),
    "moss":     (0.40, 0.90, 360.0, 0.0),
    "petal":    (0.25, 0.40, 360.0, 0.0),
    "bloom":    (0.45, 0.80, 360.0, 4.0),
    "shrub":    (0.55, 0.95, 360.0, 0.0),
    "mushroom": (0.35, 0.75, 360.0, 8.0),
    "topiary":  (0.70, 1.00, 40.0, 0.0),
    "tree":     (0.55, 0.85, 360.0, 0.0),
    "rose":     (0.40, 0.70, 360.0, 10.0),
}

#: The bands: (inner offset from path edge, outer offset, families with
#: relative weights, placements per 1000 uu of path per side)
BANDS = (
    ("edge",   0.0,   120.0, (("flower", 5), ("moss", 3), ("petal", 2)),             9.0),
    ("mid",  120.0,   300.0, (("flower", 2), ("bloom", 3), ("shrub", 3), ("mushroom", 2), ("rose", 1)), 5.0),
    ("outer", 300.0,  520.0, (("shrub", 2), ("topiary", 1), ("tree", 2), ("mushroom", 1)), 1.6),
)


def _pick(weights, r):
    tot = float(sum(w for _, w in weights))
    acc = 0.0
    for fam, w in weights:
        acc += w / tot
        if r <= acc:
            return fam
    return weights[-1][0]


def plan_border(spline, half_width, seed=0, density=1.0, sides=(-1, 1),
                bands=BANDS, keep_out=None, min_gap=None):
    """Placements along `spline`: [{band, family, x, y, z, yaw, tilt, scale, side}].

    `half_width` is the path's half-width — nothing lands inside it, which is
    the exclusion the brief asks for. `keep_out(x, y) -> bool` lets the caller
    refuse the plaza, the arcane circle, and anything already standing.
    `min_gap` (uu) rejects a placement closer than that to an earlier one of
    the same band, so a dense band is dense, not stacked.
    """
    out = []
    L = spline.length
    for bi, (name, inner, outer, fams, per_km) in enumerate(bands):
        n = max(0, int(L / 1000.0 * per_km * density))
        gap = min_gap if min_gap is not None else (outer - inner) * 0.35
        for side in sides:
            placed = []
            for k in range(n):
                r0 = mk.rnd(bi, k, seed, side)
                d = r0 * L
                lat = inner + (outer - inner) * mk.rnd(bi, k, seed + 11, side)
                x, y, z = spline.offset_xy(d, side * (half_width + lat))
                if keep_out is not None and keep_out(x, y):
                    continue
                if any(math.hypot(x - px, y - py) < gap for (px, py) in placed):
                    continue
                fam = _pick(fams, mk.rnd(bi, k, seed + 23, side))
                lo, hi, yawj, tiltj = FAMILIES[fam]
                sc = lo + (hi - lo) * mk.rnd(bi, k, seed + 31, side)
                placed.append((x, y))
                out.append({"band": name, "family": fam, "x": x, "y": y, "z": z,
                            "yaw": (mk.rnd(bi, k, seed + 41, side) - 0.5) * yawj,
                            "tilt": (mk.rnd(bi, k, seed + 43, side) - 0.5) * tiltj,
                            "scale": sc, "side": side, "d": d})
    return out


def summarise(plan):
    """Counts by band and family, for a log line."""
    by = {}
    for p in plan:
        k = (p["band"], p["family"])
        by[k] = by.get(k, 0) + 1
    bands = {}
    for (b, f), n in sorted(by.items()):
        bands.setdefault(b, []).append("%s x%d" % (f, n))
    return "; ".join("%s: %s" % (b, ", ".join(v)) for b, v in bands.items())
