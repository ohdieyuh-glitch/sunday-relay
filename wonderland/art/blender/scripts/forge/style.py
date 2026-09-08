"""Style as MEASURED AXES, so a generator can ask for a look and get one.

THE PROBLEM THIS SOLVES. A kit of ninety modules is not usable by saying "pick
towers". The world session needs to ask for a QUARTER: slender and monumental
here, low and residential there, garden rather than urban, gold-light at the
royal threshold and stone-heavy on the walls. Without something to sort on, the
only handles are the family name and the district list, and neither of those
distinguishes `WL_Tower_Mid_Ashlar` from `WL_Tower_Mid_Arcade`.

THE RULE THIS FILE OBEYS, and it is the repository's own: a number is either
MEASURED off the geometry, DECLARED by the thing that made it, or DERIVED from
a declaration by a rule written down here. It is never guessed, and when an
axis cannot be established for a module it is `null` and renders as Unknown --
never 0, which on a 0..1 axis would be a confident claim of one pole.

Every axis runs 0..1 from its first-named pole to its second:

  slender_broad          MEASURED   height against horizontal diameter
  low_monumental         MEASURED   absolute height
  open_solid             MEASURED   silhouette fill: how much of the outline
                                    the module actually fills, so an arcade you
                                    can see sky through scores open and a drum
                                    scores solid
  gold_stone             MEASURED   the share of surface AREA carried by gold,
                                    glass and emissive parts
  pristine_aged          DECLARED   the weathering recipe's own `age`/`damage`
  garden_urban           DERIVED    from the districts the module declares
  ceremonial_residential DERIVED    from the kit's own category and role

MEASURED MEANS MEASURED. `open_solid` is not a guess from the family name: the
geometry is rasterised from three bearings by ray casting, the holes ENCLOSED
by each silhouette are found by flooding the outside, and the axis is the
filled area over the filled-plus-enclosed area. `WL_Tower_Base_Arcaded` earns
its openness from the sky actually visible through it.
"""

import math

from mathutils import Vector
from mathutils.bvhtree import BVHTree

from . import kit as K

#: (name, pole at 0, pole at 1, provenance). The manifest carries this table
#: once, so a consumer never has to guess which way an axis runs.
AXES = (
    ("slender_broad", "slender", "broad", "measured"),
    ("low_monumental", "low-rise", "monumental", "measured"),
    ("open_solid", "open", "solid", "measured"),
    ("gold_stone", "gold-light", "stone-heavy", "measured"),
    ("pristine_aged", "pristine", "aged", "declared"),
    ("garden_urban", "garden", "urban", "derived"),
    ("ceremonial_residential", "ceremonial", "residential", "derived"),
)

#: Where each district sits on garden..urban. The world session owns the
#: districts; this is only a reading of them, and it is written here rather
#: than inferred so it can be argued with.
DISTRICT_URBAN = {
    "city": 1.00, "clock": 0.90, "castle": 0.85, "hamlet": 0.80,
    "plaza": 0.70, "cloister": 0.50, "tea_terrace": 0.30,
    "royal_garden": 0.15, "water_garden": 0.10, "meadow": 0.05,
    "grove": 0.00, "mushroom_grove": 0.00,
}

#: Where each (category, role) sits on ceremonial..residential. A landmark is
#: ceremonial whatever else it is; a prop on a house is residential; the
#: middle is where the kit's own words stop distinguishing and the value is
#: the average of what they do say.
CATEGORY_RESIDENTIAL = {"landmark": 0.05, "structure": 0.45, "module": 0.50,
                        "prop": 0.70}
ROLE_RESIDENTIAL = {"hero": 0.05, "threshold": 0.15, "crown": 0.35,
                    "needle": 0.30, "span": 0.40, "screen": 0.50,
                    "route": 0.55, "terrace": 0.55, "foot": 0.55,
                    "body": 0.60, "detail": 0.70}

#: The parts whose area counts as gold rather than as stone.
BRIGHT_PARTS = ("gold", "gold_aged", "glass", "glass_cool", "water_lit")


def _ramp(v, lo, hi):
    """Clamp `v` into 0..1 across `lo`..`hi`."""
    if hi == lo:
        return None
    return max(0.0, min(1.0, (float(v) - lo) / (hi - lo)))


def silhouette_fill(objs, grid=72, bearings=(0.0, 55.0, 110.0)):
    """How much of its own outline the module fills, 0..1, averaged over bearings.

    Rasterised by ray casting on a grid across each bearing's projection, then
    the OUTSIDE is flooded from the border so the unfilled cells that remain
    are the holes the silhouette encloses -- the sky you can see through an
    arcade, which is the thing being measured. Returns `None` when the module
    has no geometry to measure.
    """
    verts, polys = [], []
    for obj in objs.values():
        base = len(verts)
        mw = obj.matrix_world
        verts += [mw @ v.co for v in obj.data.vertices]
        for p in obj.data.polygons:
            idx = [base + i for i in p.vertices]
            for t in range(1, len(idx) - 1):
                polys.append((idx[0], idx[t], idx[t + 1]))
    if not polys:
        return None
    tree = BVHTree.FromPolygons([tuple(v) for v in verts], polys, all_triangles=True)

    lo = Vector((min(v.x for v in verts), min(v.y for v in verts),
                 min(v.z for v in verts)))
    hi = Vector((max(v.x for v in verts), max(v.y for v in verts),
                 max(v.z for v in verts)))
    centre = (lo + hi) * 0.5
    radius = max((hi - lo).length * 0.5, 0.5)

    scores = []
    for deg in bearings:
        a = math.radians(deg)
        fwd = Vector((math.cos(a), math.sin(a), 0.0))
        right = Vector((-math.sin(a), math.cos(a), 0.0))
        up = Vector((0.0, 0.0, 1.0))
        half_r = max(abs((hi - centre).dot(right)), abs((lo - centre).dot(right)))
        half_u = (hi.z - lo.z) * 0.5
        if half_r <= 1e-6 or half_u <= 1e-6:
            continue
        mask = [[False] * grid for _ in range(grid)]
        for iu in range(grid):
            tu = (iu + 0.5) / grid * 2.0 - 1.0
            for ir in range(grid):
                tr = (ir + 0.5) / grid * 2.0 - 1.0
                origin = (centre + right * (tr * half_r) + up * (tu * half_u)
                          - fwd * (radius * 2.0))
                mask[iu][ir] = tree.ray_cast(origin, fwd, radius * 4.0)[0] is not None
        filled = sum(1 for row in mask for c in row if c)
        if not filled:
            continue
        # flood the OUTSIDE through unfilled cells; what it cannot reach is a
        # hole the silhouette encloses
        seen = [[False] * grid for _ in range(grid)]
        stack = []
        for i in range(grid):
            for (u, r) in ((0, i), (grid - 1, i), (i, 0), (i, grid - 1)):
                if not mask[u][r] and not seen[u][r]:
                    seen[u][r] = True
                    stack.append((u, r))
        while stack:
            u, r = stack.pop()
            for (du, dr) in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nu, nr = u + du, r + dr
                if 0 <= nu < grid and 0 <= nr < grid and \
                        not mask[nu][nr] and not seen[nu][nr]:
                    seen[nu][nr] = True
                    stack.append((nu, nr))
        holes = sum(1 for u in range(grid) for r in range(grid)
                    if not mask[u][r] and not seen[u][r])
        scores.append(filled / float(filled + holes))
    if not scores:
        return None
    return sum(scores) / len(scores)


def bright_share(objs):
    """The fraction of surface AREA carried by gold, glass and emissive parts.

    Area rather than triangle count, because a gold collar is a handful of
    faces and a wall is a handful of faces, and only one of them is a wall.
    """
    total = bright = 0.0
    for key, obj in objs.items():
        area = sum(p.area for p in obj.data.polygons)
        total += area
        if key in BRIGHT_PARTS:
            bright += area
    if total <= 0.0:
        return None
    return bright / total


def profile(spec, objs, size_m, height_m):
    """The seven axes for one module, each 0..1 or None.

    `size_m` is the module's (x, y, z) extent in metres and `height_m` its
    height, both already measured by the caller -- this does not re-measure
    what the manifest has measured.
    """
    out = {}

    width = max(size_m[0], size_m[1])
    if width > 1e-6 and height_m > 1e-6:
        aspect = height_m / width
        # slender at 6:1 and up, broad at 1:2 and down, on a log scale because
        # the difference between 6:1 and 8:1 matters less than 1:1 to 2:1
        out["slender_broad"] = 1.0 - _ramp(math.log(aspect),
                                           math.log(0.5), math.log(6.0))
    else:
        out["slender_broad"] = None

    out["low_monumental"] = (None if height_m <= 0.0 else
                             _ramp(math.log(max(height_m, 0.5)),
                                   math.log(2.5), math.log(60.0)))

    fill = silhouette_fill(objs)
    out["open_solid"] = fill

    share = bright_share(objs)
    out["gold_stone"] = None if share is None else 1.0 - _ramp(share, 0.0, 0.12)

    # DECLARED: only a weathering recipe knows how old a module is meant to be
    aged = max(float(spec.params.get("age") or 0.0),
               float(spec.params.get("damage") or 0.0))
    out["pristine_aged"] = aged

    urban = [DISTRICT_URBAN[d] for d in spec.districts if d in DISTRICT_URBAN]
    out["garden_urban"] = (sum(urban) / len(urban)) if urban else None

    cat = CATEGORY_RESIDENTIAL.get(spec.category)
    role = ROLE_RESIDENTIAL.get(spec.role)
    parts = [v for v in (cat, role) if v is not None]
    out["ceremonial_residential"] = (sum(parts) / len(parts)) if parts else None

    return {k: (None if v is None else round(float(v), 3))
            for k, v in out.items()}


def axis_table():
    """The manifest's one copy of what the axes mean and where they come from."""
    return [{"axis": n, "at_0": a, "at_1": b, "provenance": p,
             "unknown_is": "null, and it renders as Unknown -- never 0"}
            for (n, a, b, p) in AXES]
