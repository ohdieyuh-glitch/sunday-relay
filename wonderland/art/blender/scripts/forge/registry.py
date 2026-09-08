"""The ONE list of asset families. Both scripts import it; neither owns it.

WHY THIS FILE EXISTS, and it is worth being precise because the bug it closes
never actually fired.

`build_assets.py` and `validate_assets.py` each carried their own hand-written
`FAMILIES` tuple. They happened to agree, and the handoff's claim of "44 assets
checked" against a manifest of 55 turned out to be a stale sentence in a
document rather than a real coverage hole -- the report said `checked 55,
failures 0` all along.

But two hand-maintained lists of the same thing are one edit away from the
failure the stale sentence DESCRIBED: add a family to the builder and forget
the validator, and the kit grows by six assets that are exported, manifested,
shipped to the world session, and never checked. Nothing would have said so.

So the list moved here, and `validate_assets.py` additionally asserts that the
set of assets it discovered is exactly the set the manifest contains. Drift now
has to get past a shared import AND a set comparison, and the second one fails
loudly with the names of the assets that differ.

ADDING A FAMILY: write `families/<name>.py` with a `BUILDERS` tuple, import it
below, and add one line to `FAMILIES`. That is the whole ceremony, and it is
now impossible to do it for the builder and not for the validator.
"""

from . import weathering as WX
from .families import (civic, details, gardens, ground, hero, market,
                       roofscape, stairs, thresholds, towers, walls, water)

#: (group name, module). Group name reaches the manifest as `family_group` and
#: names the contact sheet, the Unreal destination folder and the proof pack.
FAMILIES = (
    ("towers", towers),
    ("thresholds", thresholds),
    ("civic", civic),
    ("walls", walls),
    ("roofscape", roofscape),
    ("stairs", stairs),
    ("gardens", gardens),
    ("ground", ground),
    ("water", water),
    ("market", market),
    ("details", details),
    ("hero", hero),
)

#: The weathered variants, and the ONE list of them.
#:
#: Each line names a base builder and a recipe, and each is here because the
#: variant adds a FORM the kit does not otherwise have -- not to make the asset
#: count larger. A second aged curtain run at a different seed would be a
#: larger number and no more architecture, so there is not one.
#:
#: `weathering.py` explains the three dimensions and the socket rule. The short
#: version: `age` and `overgrowth` cannot move a join, `damage` can only DROP a
#: socket it destroyed, and the validator checks both against the base.
VARIANTS = (
    ("walls", walls.wall_curtain_run(),
     WX.Weather("aged", age=0.60, overgrowth=0.35, seed=3,
                note="weathered: the run a city has the most of, and has had "
                     "the longest")),
    ("walls", walls.wall_mural_tower,
     WX.Weather("ruined", age=0.70, damage=0.65, overgrowth=0.45, seed=11,
                break_at=0.58,
                note="broken off above the gallery; the silhouette that says a "
                     "wall was fought over")),
    ("towers", towers.tower_base_buttressed,
     WX.Weather("aged", age=0.55, overgrowth=0.28, seed=17,
                note="weathered: the oldest thing in a district is its footing")),
    ("thresholds", thresholds.gatehouse_twin,
     WX.Weather("aged", age=0.50, overgrowth=0.40, seed=23,
                note="weathered and grown over, so a gate can be the old gate")),
    ("civic", civic.colonnade_arcade,
     WX.Weather("ruined", age=0.65, damage=0.55, overgrowth=0.50, seed=29,
                break_at=0.66,
                note="a broken colonnade: arcade standing, terrace gone")),
    ("civic", civic.bridge_arc,
     WX.Weather("aged", age=0.45, overgrowth=0.42, seed=31,
                note="weathered with growth in the spandrels, where water sits")),
    ("roofscape", roofscape.house_jettied,
     WX.Weather("overgrown", age=0.30, overgrowth=0.65, seed=37,
                note="a house nobody has swept in a while")),
    ("gardens", gardens.garden_retaining_run,
     WX.Weather("overgrown", age=0.35, overgrowth=0.80, seed=41,
                note="a retaining wall is the thing plants actually grow out of")),
    ("details", details.detail_balustrade_run,
     WX.Weather("broken", age=0.55, damage=0.45, seed=43, break_at=0.55,
                note="a balustrade with its rail gone; the run that makes an "
                     "intact one read as intact")),
)

#: Groups deliberately excluded from validation. EMPTY, and it should stay
#: empty: the rule is that every exportable asset in the manifest is
#: discovered, validated and reported. If something is ever added here it needs
#: a technical reason written beside it, not a convenience.
EXEMPT_GROUPS = ()


def _variant_builder(base, w):
    """Wrap a base builder so it builds, then weathers, in one call."""

    def build(f):
        return WX.weather(base(f), w)

    build.__name__ = "%s__%s" % (base.__name__, w.suffix)
    build.__doc__ = "%s, weathered: %s" % (base.__name__, w.name)
    return build


#: Ready-made variant builders, in the same shape as a family's `BUILDERS`.
VARIANT_BUILDERS = tuple(_variant_builder(b, w) for (_g, b, w) in VARIANTS)


def groups():
    """[(group name, [builder, ...])], INCLUDING the variants group.

    Everything that walks the kit walks this: the builder, the validator, the
    contact sheets and the coverage check. That is the whole point of the file
    -- there is one list, and a variant that is built is a variant that is
    checked.
    """
    out = [(g, list(m.BUILDERS)) for g, m in FAMILIES]
    if VARIANT_BUILDERS:
        out.append(("variants", list(VARIANT_BUILDERS)))
    return out


def builders():
    """Every (group, builder) pair, in build order."""
    out = []
    for group, bs in groups():
        for builder in bs:
            out.append((group, builder))
    return out


def group_names():
    return tuple(g for g, _ in groups())
