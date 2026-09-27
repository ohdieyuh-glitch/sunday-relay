"""GA08 -- the Golden Arrival after dark. A plaza is not a route, so this places by COVERAGE.

THE ARRIVAL IS THE WORST-LIT PLACE IN WONDERLAND and it is where every player begins. Measured against the
full 1,355-light set, walkable surface within 150 m of the arrival point, distance from each surface instance
to the nearest practical light:

    Golden Arrival   4,841 surfaces    64 lights   median 22.9 m   69.9% beyond 15 m
    ICARUS           1,505 surfaces    28 lights   median 12.6 m   43.3%
    DUBEL FOREST       557 surfaces    45 lights   median  8.9 m   33.6%
    TARTARUS         1,228 surfaces    83 lights   median  7.3 m   12.1%
    NOCTIS           1,218 surfaces   154 lights   median  7.5 m   10.1%

The arrival carries THREE TO FOUR TIMES the walkable area of any nation and has fewer lights than all but
Icarus, and most of the ground a player can stand on is more than fifteen metres from anything that lights
it. That is the founder's "entire regions collapsing into near-black" at the one place nobody can avoid
visiting.

TWO BASELINES, AND THEY DIFFER FOR A REASON WORTH STATING rather than quietly picking one. The cross-region
table above counts KERB EDGING as walkable and gives the arrival 69.9% beyond 15 m at a median of 22.9 m.
This tool excludes kerbs -- a kerb is a border, not somewhere a walker stands -- and over the 956 true
walking instances gives 78.3% at a median of 28.8 m. The arrival is the worst place in the world on both, and
the figures this pass reports are the kerb-free ones because those are the ground being lit.

WHY THE NATION RULE DOES NOT TRANSFER. NQ06 and IQ06 follow a route: lamps alternate along a line and tighten
at decisions. The arrival has no line. It is a hub -- a court, a promenade, a threshold, radial approaches --
and a walker crosses it rather than following it. Route spacing applied here would light a path nobody walks
and leave the open ground dark.

SO IT PLACES BY FARTHEST-POINT COVERAGE, which is the plaza answer: repeatedly find the walkable instance
furthest from any light, put a lamp near it, and repeat until no walkable ground is further than REACH from
one. That converges on the open middle first and the edges last, which is the opposite of what a route rule
does and is correct here.

WHAT IT WILL NOT DO. It will not exceed MAX_LAMPS however much ground is left uncovered -- the pool is 48
lights and the significance ranking now decides which ones are lit, so flooding the arrival with fixtures
would push the road lamps out of the pool and undo the very fix that made this measurable. If it stops on
MAX_LAMPS rather than on coverage, the report says so and the remaining gap is a founder question about
fixture budget, not something to solve by adding more.

CANON IS NOT EXTENDED. The Golden Arrival's canon is "NEUTRAL GROUND" and that is all WorldDesign/CANON says.
No territory identity is invented for it; the fixture is the kit's own lantern standard in the arrival's
existing gold and ivory, which is what the rest of the arrival is already built from.
"""
import json
import math
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DESIGN = HERE.parent
sys.path.insert(0, str(DESIGN / "Nations"))
import tq05_tartarus_lamps as TQ                                      # noqa: E402  the batch writer, not a copy

PASS_ID = "GA08"
OUT = HERE / "ga08_arrival_lamps.json"

ARRIVAL = (0.0, -1460.0)
#: How far the arrival's own ground extends. Beyond this is the city and the approaches, which are other
#: passes' business.
REGION = 15000.0
#: A walker should not be further than this from something that lights the ground. 15 m is the same figure
#: the coverage measurement above uses, so the before and after numbers are the same question.
REACH = 1500.0
#: Never place within this of a lamp the world already has -- the same rule TQ05 and NQ06 use.
KEEP_CLEAR = 1000.0
#: THE POOL IS 48 AND SIGNIFICANCE NOW DECIDES WHO IS IN IT. Past this many the arrival starts evicting the
#: road lamps that the ranking fix exists to protect, so this stops and reports rather than flooding.
MAX_LAMPS = 40

WALKABLE = ("flagstone", "paving", "terrace", "plaza")
FIXTURE_PREFIX = "WL_Object_LanternStandard"

#: The arrival's own materials, checked against Content/WonderlandV2/Materials/Instances rather than recalled.
PARTS = {"stone": "MI_V2_IvoryStone", "gold": "MI_V2_Gold", "glass": "MI_V2_GlassAmber"}


def existing_light_positions():
    """Where light ACTUALLY COMES FROM today: practical_lights.json, not the lantern-standard fixtures.

    THE FIRST VERSION OF THIS GOT IT WRONG AND WOULD HAVE OVERSTATED ITS OWN RESULT. It measured distance to
    the nearest WL_Object_LanternStandard and reported the arrival as 100% beyond 15 m with a median of
    447 m. The arrival has almost no lantern standards -- it is lit by waymarker lamps and wall lanterns,
    which are different fixtures entirely -- so that number is the distance to a fixture family that is
    barely present, not the distance to light. Measured against the real light set the arrival is 69.9%
    beyond 15 m with a median of 22.9 m: still the worst place in the world, and not 100%.

    Placing against the wrong baseline would have put lamps where light already reaches and claimed a gain
    that was mostly already there.
    """
    pl = json.loads((DESIGN / "Look" / "practical_lights.json").read_text(encoding="utf-8"))
    rows = pl if isinstance(pl, list) else (pl.get("lights") or [])
    return [(float(r["x"]), float(r["y"])) for r in rows if "x" in r]


def walkable_and_lights():
    """Every walkable instance near the arrival, and every lantern FIXTURE (for KEEP_CLEAR only)."""
    surf, lamps = [], []
    mine = OUT.name
    for fp in sorted(DESIGN.rglob("*.json")):
        if fp.name == mine:
            continue                                                  # never count my own output as world
        try:
            d = json.loads(fp.read_text(encoding="utf-8"))
        except Exception:                                             # noqa: BLE001
            continue
        if not isinstance(d, dict):
            continue
        for b in (d.get("batches") or []):
            leaf = str(b.get("mesh") or "").split("/")[-1].split(".")[0]
            low = leaf.lower()
            is_walk = any(k in low for k in WALKABLE)
            is_lamp = leaf.startswith(FIXTURE_PREFIX)
            if not (is_walk or is_lamp):
                continue
            for i in (b.get("instances") or []):
                if len(i) < 3 or float(i[2]) <= -1000.0:
                    continue
                x, y, z = float(i[0]), float(i[1]), float(i[2])
                if is_lamp:
                    lamps.append((x, y))
                elif math.hypot(x - ARRIVAL[0], y - ARRIVAL[1]) <= REGION:
                    surf.append((x, y, z))
    # a lantern is three co-located parts; collapse them
    uniq = []
    for x, y in lamps:
        if all(abs(x - a) > 1.0 or abs(y - b) > 1.0 for a, b in uniq):
            uniq.append((x, y))
    return surf, uniq


def farthest_first(surf, lit, fixtures):
    """Put a lamp at the walkable point furthest from any light, repeatedly.

    The plaza answer. A route rule spaces along a line; this converges on the open middle first and the
    edges last, which is what an open court needs and what a line rule cannot do.
    """
    placed = []
    lit = list(lit)
    # distance from every surface point to the nearest light, maintained incrementally
    dist = [min((math.hypot(p[0] - lx, p[1] - ly) for lx, ly in lit), default=9e9) for p in surf]
    stopped_on = "coverage"
    while True:
        j = max(range(len(surf)), key=lambda k: dist[k])
        if dist[j] <= REACH:
            break
        if len(placed) >= MAX_LAMPS:
            stopped_on = "MAX_LAMPS"
            break
        px, py, pz = surf[j]
        # do not stand a new lamp on an existing FIXTURE; light positions are not obstacles
        if all(math.hypot(px - fx, py - fy) > KEEP_CLEAR for fx, fy in fixtures):
            placed.append((px, py, pz, 0.0))
            lit.append((px, py))
        for k, p in enumerate(surf):
            d = math.hypot(p[0] - px, p[1] - py)
            if d < dist[k]:
                dist[k] = d
    return placed, dist, stopped_on


def main():
    surf, fixtures = walkable_and_lights()
    # COVERAGE IS MEASURED AGAINST LIGHT, placement avoids FIXTURES. Two different sets and conflating them
    # is what made the first run claim 100% -> 0%.
    lit = existing_light_positions()
    before = [min((math.hypot(p[0] - lx, p[1] - ly) for lx, ly in lit), default=9e9) for p in surf]
    placed, after, stopped_on = farthest_first(surf, lit, fixtures)

    def pct(ds):
        return round(100.0 * sum(1 for d in ds if d > REACH) / max(len(ds), 1), 1)

    def med(ds):
        s = sorted(ds)
        return round(s[len(s) // 2] / 100.0, 1) if s else None

    spec = {
        "pass": PASS_ID,
        "tags": ["WL_AUTHORED", "WL_PASS_%s" % PASS_ID, "WL_DISTRICT_GOLDEN_ARRIVAL", "WL_ARRIVAL_LAMPS"],
        "folder": "Wonderland/GoldenArrival/Lamps",
        "note": ("the founder's night correction, section B, for the GOLDEN ARRIVAL: %d lantern standards "
                 "placed by farthest-point coverage rather than by route spacing, because a hub is crossed "
                 "and not followed. Measured against the real light set rather than against lantern "
                 "fixtures: walkable ground further than %.0f m from any LIGHT goes %.1f%% -> %.1f%%, "
                 "median distance %.1f m -> %.1f m. Stopped on %s."
                 % (len(placed), REACH / 100, pct(before), pct(after), med(before), med(after), stopped_on)),
        "materials": PARTS,
        "batches": [TQ.batch("%s_Object_LanternStandard_%s" % (PASS_ID, part),
                             TQ.STANDARD[part][0], mat, placed, part == "stone")
                    for part, mat in PARTS.items()],
    }
    OUT.write_text(json.dumps(spec, indent=1) + "\n", encoding="utf-8", newline="\n")

    print(json.dumps({
        "placed": len(placed), "stopped_on": stopped_on, "max_lamps": MAX_LAMPS,
        "walkable_instances": len(surf), "existing_lights_world": len(lit),
        "existing_fixtures_world": len(fixtures),
        "beyond_%dm_pct" % int(REACH / 100): [pct(before), pct(after)],
        "median_m": [med(before), med(after)],
        "out": OUT.name,
    }, indent=1))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
