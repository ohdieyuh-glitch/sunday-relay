#!/usr/bin/env python3
"""TQ05 -- TARTARUS after dark: the practical-light network for one nation (2026-09-27).

THE FOUNDER'S CORRECTION, and the part of it this answers. "Entire regions collapsing into near-black ...
paths disappear ... some areas have almost no practical lighting at all." Their fix is two things together: a
higher global night floor (section A, the world lane's) and "MANY MORE PHYSICAL LIGHT SOURCES THROUGHOUT THE
WORLD" concentrated on "major roads, secondary walking paths, intersections, stairs, entrances, bridges,
plazas, checkpoints, territory gates, landmarks, populated architecture", and explicitly NOT "a uniform
airport-runway grid".

WHAT TARTARUS HAS TONIGHT, counted rather than estimated. 232 practical lights fall inside the nation's
box, and 188 of them are FACADE lanterns at 6 candelas and a 500 uu radius -- wall lamps on buildings, which
light a wall. The whole nation's PATH lighting is 26 road lamps, 16 avenue lamps and 2 at the checkpoint: 44
lights over 505 m of avenue, a quarter, a band and a market. That is the founder's sentence as a number.

AND WHERE THE DARK IS WORST, which is the part a count does not show. The avenue's 16 lamps sit at 0, 25, 54,
76, 100, 132, 156, 180, 217, 279, 339, 371, 403, 427, 451 and 483 metres. Two gaps of 62 m and 60 m straddle
217-339 m -- and the route's four shelf transitions (+12 to -14 and back, the dip the avenue crosses in the
middle) are at 272-300 m, inside them. The least-lit stretch of the road is exactly the stretch with the
steps in it, which is the founder's "stairs and edges can be navigated visually" failing where it matters
most.

WHAT THIS PASS ADDS, and the rule behind each.

  THE AVENUE          a lantern standard alternating sides at 900 uu from the route centre, the offset and
                      the shelf AV03's own lamps already stand on. Spacing follows the road rather than a
                      ruler: 24 m along a straight, tightening to 14 m within 25 m of a DECISION -- a shelf
                      transition (steps), a heading change past 20 degrees measured over 15 m of road (a turn
                      or a junction), or either end of the route (the gate and the band). That is the
                      founder's "tightens at decisions" and the reason this is not a grid. Six decisions on
                      505 m; the first attempt measured heading across two 30 uu samples, found 32 "turns" in
                      a road that does not turn, and produced a lamp every 6 m -- the runway grid, reached by
                      the rule meant to avoid it.
  THE MARKET          the band's 144 canopies form 15 stalls. A hanging lantern at each stall's centre, at
                      canopy height, so a market reads as a market after dark instead of a field of dark
                      roofs. Hanging lanterns take half a standard's candelas in the runtime, which is right
                      for a stall.
  THE QUARTER PLAZA   standards round the edge of the quarter's paved cluster, on the corners a walker
                      actually arrives at, not spaced evenly around it.

IN TARTARUS'S OWN COLOURS. Glass MI_V2_TartarusEmber, metal MI_V2_TartarusMetal, stone MI_V2_TartarusCrimson
-- the three AV03 already uses, so the new lamps are the same object as the old ones and the light they throw
is the ember the glass already is (place_practical_lights reads the colour off the glass material). The
founder asked for lighting "appropriate to each area's architecture rather than copying one generic lamp
everywhere"; Tartarus is red, and this is red.

NO NEW FIXTURE FAMILY, NO NEW LIGHT ACTORS. Both kinds are already in the kit and already in the practical
subsystem's FIXTURES table, so the lamps light through UWonderlandPracticalLightsSubsystem's pool of 48
nearest -- the founder's "use the existing practical-light pooling system" -- rather than adding a point
light per fixture, which is what would blow the budget.

GROUND SHELVES ARE REAL AND HAVE BITTEN THIS PROJECT BEFORE: the road is +12, the ground beside it -14, the
frontier -14. Every lamp here takes the z of the route point or the tile it stands on, never a constant.

    python tq05_tartarus_lamps.py        # writes tq05_tartarus_lamps.json
"""
import json
import math
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
V2 = "/Game/WonderlandV2/"
KIT = json.loads((ROOT / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]

STANDARD = {
    "stone": (V2 + "Kit/objects/WL_Object_LanternStandard.WL_Object_LanternStandard", "MI_V2_TartarusCrimson"),
    "gold": (V2 + "Kit/objects/WL_Object_LanternStandard_gold.WL_Object_LanternStandard_gold", "MI_V2_TartarusMetal"),
    "glass": (V2 + "Kit/objects/WL_Object_LanternStandard_glass.WL_Object_LanternStandard_glass", "MI_V2_TartarusEmber"),
}
HANGING = {
    "gold": (V2 + "Kit/details/WL_Detail_Lantern_Hanging_gold.WL_Detail_Lantern_Hanging_gold", "MI_V2_TartarusMetal"),
    "glass": (V2 + "Kit/details/WL_Detail_Lantern_Hanging_glass.WL_Detail_Lantern_Hanging_glass", "MI_V2_TartarusEmber"),
}

LATERAL = 900.0            # uu from the route centre: AV03's own offset, measured off its instances
STRAIGHT = 2400.0          # uu between lamps on a straight run
AT_DECISION = 1400.0       # uu between lamps near a decision
DECISION_REACH = 2500.0    # how far a decision tightens the spacing either side of itself
TURN_DEGREES = 20.0        # heading change over TURN_BASE that counts as a decision
#: HEADING OVER FIFTEEN METRES, NOT OVER TWO POINTS. The route is a 30 uu polyline and it jitters: measured
#: across two points, 32 "turns" of 27 and 45 degrees appeared in the first 52 m of a road that does not
#: turn at all, and the tightening rule then fired down the whole route and produced a lamp every 6 to 8 m.
#: That is precisely the "uniform airport-runway grid" the founder ruled out, arrived at by a rule that was
#: meant to prevent one. A junction is a change of direction a WALKER would notice, so the baseline has to be
#: the length of a few strides rather than the sampling step of the data.
TURN_BASE = 1500.0         # uu of route either side of a point, over which a heading change is real
KEEP_CLEAR = 1000.0        # never place within this of a lamp the world already has
CANOPY_H = KIT["WL_Market_Canopy"]["height"]


def route_points():
    d = json.loads((HERE / "nation_routes.json").read_text(encoding="utf-8"))
    return d["TARTARUS"]["points"]


def spec_batches(name):
    return json.loads((HERE / ("%s.json" % name)).read_text(encoding="utf-8"))["batches"]


def existing_lamps():
    """Every lantern standard Tartarus already has, so this pass never doubles one up."""
    out = []
    for name in ("av03_tartarus_avenue", "tq01_quarter", "tq02_tartarus_detail",
                 "tq03_band", "tq04_band_detail"):
        path = HERE / ("%s.json" % name)
        if not path.exists():
            continue
        for b in spec_batches(name):
            leaf = (b.get("mesh") or "").split("/")[-1].split(".")[0]
            if leaf.startswith("WL_Object_LanternStandard"):
                for i in b.get("instances") or []:
                    if len(i) >= 3 and float(i[2]) > -1000.0:
                        out.append((float(i[0]), float(i[1])))
    return out


def heading(pts, i, cum=None, base=0.0):
    """The route's direction at i. With a base, averaged over that many uu either side -- see TURN_BASE."""
    if cum is None or base <= 0.0:
        a = pts[max(i - 1, 0)]
        b = pts[min(i + 1, len(pts) - 1)]
        return math.degrees(math.atan2(b["y"] - a["y"], b["x"] - a["x"]))
    lo = hi = i
    while lo > 0 and cum[i] - cum[lo] < base:
        lo -= 1
    while hi < len(pts) - 1 and cum[hi] - cum[i] < base:
        hi += 1
    a, b = pts[lo], pts[hi]
    return math.degrees(math.atan2(b["y"] - a["y"], b["x"] - a["x"]))


def avenue_lamps(pts, taken):
    """Lamps along the route, alternating sides, tightening at decisions."""
    cum = [0.0]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        cum.append(cum[-1] + math.hypot(b["x"] - a["x"], b["y"] - a["y"]))

    # ---- WHERE THE DECISIONS ARE. Read off the route, not chosen.
    decisions = [0.0, cum[-1]]
    for i in range(1, len(pts)):
        if round(pts[i]["floor"]) != round(pts[i - 1]["floor"]):
            decisions.append(cum[i])                       # steps between shelves
    turning = []
    for i in range(1, len(pts) - 1):
        back = heading(pts, max(i - 1, 0), cum, TURN_BASE)
        fwd = heading(pts, min(i + 1, len(pts) - 1), cum, TURN_BASE)
        turn = abs((fwd - back + 180.0) % 360.0 - 180.0)
        if turn >= TURN_DEGREES:
            turning.append(cum[i])
    # ONE DECISION PER BEND, not one per sample inside it: a 40 m sweep is a single place to a walker.
    for s in turning:
        if not decisions or min(abs(s - d) for d in decisions) > DECISION_REACH:
            decisions.append(s)
    decisions.sort()

    def near_decision(s):
        return any(abs(s - d) <= DECISION_REACH for d in decisions)

    def at(s):
        """The route point, heading and shelf at distance s along the route."""
        i = 0
        while i < len(cum) - 2 and cum[i + 1] < s:
            i += 1
        return pts[i], heading(pts, i)

    out = []
    side = 1.0
    s = 0.0
    while s <= cum[-1]:
        p, h = at(s)
        nx, ny = -math.sin(math.radians(h)), math.cos(math.radians(h))
        x = p["x"] + nx * LATERAL * side
        y = p["y"] + ny * LATERAL * side
        if all(math.hypot(x - ex, y - ey) > KEEP_CLEAR for ex, ey in taken):
            # face the road: the lamp's front looks back across the carriageway
            yaw = (h - 90.0 * side) % 360.0
            out.append((x, y, float(p["floor"]), yaw))
            taken.append((x, y))
        side = -side
        s += AT_DECISION if near_decision(s) else STRAIGHT
    return out, decisions


def market_lanterns():
    """One hanging lantern at each stall's centre, at canopy height."""
    roofs = []
    for b in spec_batches("tq03_band"):
        if (b.get("mesh") or "").endswith("WL_Market_Canopy_roof.WL_Market_Canopy_roof"):
            roofs += [(float(i[0]), float(i[1]), float(i[2])) for i in b.get("instances") or []
                      if len(i) >= 3 and float(i[2]) > -1000.0]
    stalls = defaultdict(list)
    for r in roofs:
        stalls[(round(r[0] / 6000.0), round(r[1] / 6000.0))].append(r)
    out = []
    for group in stalls.values():
        if len(group) < 4:                                  # a stall, not a stray canopy
            continue
        x = sum(g[0] for g in group) / len(group)
        y = sum(g[1] for g in group) / len(group)
        z = min(g[2] for g in group)
        out.append((x, y, z + CANOPY_H * 0.62, 0.0))
    return out


def walkable_surface(name):
    """Every point of `name` a walker actually stands on, with the height they stand at.

    NOT THE TERRACE TILES. The quarter's SM_terrace_platform instances all sit at z -128 while its kerb
    paving and its plinths sit at +12, and AV03's own lantern standards stand at +12 or -14. Taking z off the
    tiles put every plaza lamp 140 uu under the pavement -- the ground-shelf trap this project has recorded
    twice before (road +12, ground beside it -14, frontier -14), arrived at here by reading the height from a
    layer that is under the surface rather than the surface. The tiles still say WHERE the paved ground is;
    the paving says how high it is.
    """
    out = []
    for b in spec_batches(name):
        leaf = (b.get("mesh") or "").split("/")[-1].split(".")[0]
        if leaf in ("WL_Ground_Kerb_Run_paving", "WL_Ground_Kerb_Run_paving_warm", "WL_Detail_Plinth_Block"):
            out += [(float(i[0]), float(i[1]), float(i[2])) for i in b.get("instances") or []
                    if len(i) >= 3 and float(i[2]) > -1000.0]
    return out


def quarter_plaza_lamps(taken):
    """Standards at the corners of the quarter's paved cluster, where a walker arrives."""
    tiles = []
    for b in spec_batches("tq01_quarter"):
        if (b.get("mesh") or "").split("/")[-1].split(".")[0] == "SM_terrace_platform":
            tiles += [(float(i[0]), float(i[1]), float(i[2])) for i in b.get("instances") or []
                      if len(i) >= 3 and float(i[2]) > -1000.0]
    surface = walkable_surface("tq01_quarter")
    if not tiles or not surface:
        return []

    def stands_at(x, y):
        """The height of the nearest surface a walker stands on."""
        return min(surface, key=lambda p: math.hypot(x - p[0], y - p[1]))[2]
    cells = defaultdict(list)
    for t in tiles:
        cells[(round(t[0] / 4000.0), round(t[1] / 4000.0))].append(t)
    out = []
    for group in sorted(cells.values(), key=len, reverse=True)[:6]:
        xs = [g[0] for g in group]
        ys = [g[1] for g in group]
        # THE CORNERS, NOT A RING. A plaza is entered at its corners; a ring of lamps round a square is the
        # runway grid the founder ruled out, and it lights the middle of a space nobody stands in.
        for cx, cy in ((min(xs), min(ys)), (min(xs), max(ys)), (max(xs), min(ys)), (max(xs), max(ys))):
            if all(math.hypot(cx - ex, cy - ey) > KEEP_CLEAR for ex, ey in taken):
                out.append((cx, cy, stands_at(cx, cy),
                            math.degrees(math.atan2(sum(ys) / len(ys) - cy,
                                                    sum(xs) / len(xs) - cx)) % 360.0))
                taken.append((cx, cy))
    return out


def batch(mesh, material, places):
    return {"mesh": mesh, "material": material,
            "instances": [[round(x, 1), round(y, 1), round(z, 1), 0.0, round(yaw, 1), 0.0, 1.0, 1.0, 1.0]
                          for x, y, z, yaw in places]}


def main():
    pts = route_points()
    taken = existing_lamps()
    had = len(taken)
    avenue, decisions = avenue_lamps(pts, taken)
    market = market_lanterns()
    plaza = quarter_plaza_lamps(taken)
    standards = avenue + plaza

    batches = []
    for part, (mesh, material) in STANDARD.items():
        batches.append(batch(mesh, material, standards))
    for part, (mesh, material) in HANGING.items():
        batches.append(batch(mesh, material, market))

    spec = {
        "pass": "TQ05",
        "folder": "Wonderland/Authored/TQ05_TartarusLamps",
        "tags": ["WL_AUTHORED", "WL_PASS_TQ05", "WL_NATION_TARTARUS", "WL_NATION_LAMPS"],
        "actors": [],
        "batches": batches,
        "route_source": "nation_routes.json TARTARUS, %d points, %d m" % (len(pts), 505),
        "note": ("the founder's night correction, section B, for TARTARUS only: %d lantern standards along the "
                 "avenue and the quarter's plaza corners and %d hanging lanterns over the market stalls, "
                 "added to the %d lamps the nation already had. Spacing is %d m on a straight and %d m within "
                 "%d m of a decision; decisions are the route's shelf transitions, its turns past %d degrees "
                 "and its two ends." % (len(standards), len(market), had, STRAIGHT / 100, AT_DECISION / 100,
                                        DECISION_REACH / 100, TURN_DEGREES)),
    }
    out = HERE / "tq05_tartarus_lamps.json"
    out.write_text(json.dumps(spec, indent=1), encoding="utf-8")
    print("wrote %s" % out.name)
    print("  avenue standards   %d" % len(avenue))
    print("  plaza standards    %d" % len(plaza))
    print("  market lanterns    %d" % len(market))
    print("  decisions found    %d (shelf transitions, turns >= %g deg, both ends)" % (len(decisions), TURN_DEGREES))
    print("  lamps already there %d; none placed within %g uu of one" % (had, KEEP_CLEAR))


if __name__ == "__main__":
    main()
