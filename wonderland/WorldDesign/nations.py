#!/usr/bin/env python3
"""Which nation is this point in? The one place world passes ask (founder canon, 2026-09-17).

Wonderland is one connected world divided into three nations -- ICARUS (white, video game development), NOCTIS
(black, content creation) and TARTARUS (red, software and application creation) -- with Golden Arrival at its centre
as the neutral arrival and crossroads. CANON/NATIONS.md is the canon; CANON/nations.json is its data; this module is
the only code that turns a world position into a nation, so a boundary is a data change, never a rewrite.

Use it to make a pass nation-aware:

    import nations
    n = nations.nation_at(x, y)                  # "ICARUS" / "NOCTIS" / "TARTARUS" / None in the neutral core
    layer["tags"].append(nations.tag(n))         # WL_NATION_ICARUS, so a nation's work can be found and removed
    palette = nations.nation("ICARUS")["materials_existing"]

A pass that builds INSIDE the neutral core (everything within 500 m of the origin, which is the whole Golden Arrival
city as built) gets None and should stay neutral: the founder's map rule is to grow nation identity outward from the
established core, not to repaint what is already accepted.
"""
import json
import math
from pathlib import Path

HERE = Path(__file__).resolve().parent
CANON = json.loads((HERE / "CANON" / "nations.json").read_text(encoding="utf-8"))
NATIONS = {n["id"]: n for n in CANON["nations"]}
NEUTRAL = CANON["neutral"]
CORE_R = float(NEUTRAL["core_radius_cm"])

#: THE KIT'S COLLISION POLICY, IN ONE PLACE.
#:
#: A kit module is authored as several co-located parts -- a stone shell plus glass, gold, roof and accent
#: sub-meshes at the SAME transform. Exactly one of them may collide, or a player is blocked by several
#: coincident bodies and the engine pays for each. These are the parts that must NOT collide.
#:
#: It lives here because it was previously copied into four generators and had already drifted: on
#: 2026-09-23 icarus_district.py was missing gold_aged, and ALL FOUR were missing stone_dark. stone_dark is
#: an accent sub-mesh -- a plinth band or arch soffit of 12 to 216 triangles nested wholly inside the stone
#: shell -- so letting it collide put 279 unreachable collision bodies into the world: 178 in the second
#: civilization band and 101 in the first. Four copies of a rule is four chances to forget one.
NO_COLLIDE_PARTS = ("glass", "gold", "roof", "roof_alt", "veg_anchor", "moss", "metal",
                    "gold_aged", "stone_dark")

MARCH_R = float(NEUTRAL["march_outer_cm"])


def nation(nation_id):
    """The canon record for a nation id."""
    return NATIONS[nation_id]


def _in_sector(deg, lo, hi):
    """Bearings wrap: a sector may run through +/-180 (NOCTIS runs 150 -> -90)."""
    span = (hi - lo) % 360.0
    return ((deg - lo) % 360.0) < span


def nation_at(x, y):
    """The nation a world point belongs to, or None inside the neutral core."""
    if math.hypot(x, y) < CORE_R:
        return None
    deg = math.degrees(math.atan2(y, x))
    for n in CANON["nations"]:
        lo, hi = n["sector_deg"]
        if _in_sector(deg, lo, hi):
            return n["id"]
    return None


def zone_at(x, y):
    """(nation or None, zone): "core" inside Golden Arrival, "march" on a nation's approach, "heartland" beyond."""
    r = math.hypot(x, y)
    if r < CORE_R:
        return None, "core"
    return nation_at(x, y), ("march" if r < MARCH_R else "heartland")


def tag(nation_id):
    """The layer tag a nation's authored work carries, so it can be found and removed as a unit."""
    return "WL_NATION_" + nation_id if nation_id else "WL_NATION_NEUTRAL"


def summary():
    rows = [("neutral core", "GOLDEN_ARRIVAL", "r < %.0f m" % (CORE_R / 100.0))]
    for n in CANON["nations"]:
        rows.append((n["colour"].lower(), n["id"], "bearing %.0f..%.0f deg" % tuple(n["sector_deg"])))
    return rows


if __name__ == "__main__":
    for row in summary():
        print("%-12s %-10s %s" % row)
    for (x, y) in ((0.0, 0.0), (0.0, 80000.0), (80000.0, 0.0), (-80000.0, -40000.0), (0.0, -80000.0)):
        print("(%8.0f, %8.0f) -> %s %s" % ((x, y) + zone_at(x, y)))
