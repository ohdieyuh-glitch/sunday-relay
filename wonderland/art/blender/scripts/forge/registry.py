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

from .families import (civic, details, hero, roofscape, stairs,
                       thresholds, towers, walls)

#: (group name, module). Group name reaches the manifest as `family_group` and
#: names the contact sheet, the Unreal destination folder and the proof pack.
FAMILIES = (
    ("towers", towers),
    ("thresholds", thresholds),
    ("civic", civic),
    ("walls", walls),
    ("roofscape", roofscape),
    ("stairs", stairs),
    ("details", details),
    ("hero", hero),
)

#: Groups deliberately excluded from validation. EMPTY, and it should stay
#: empty: the rule is that every exportable asset in the manifest is
#: discovered, validated and reported. If something is ever added here it needs
#: a technical reason written beside it, not a convenience.
EXEMPT_GROUPS = ()


def builders():
    """Every (group, builder) pair, in build order."""
    out = []
    for group, module in FAMILIES:
        for builder in module.BUILDERS:
            out.append((group, builder))
    return out


def group_names():
    return tuple(g for g, _ in FAMILIES)
