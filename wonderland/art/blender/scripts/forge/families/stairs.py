"""Stairs and ramps: the family that gives Wonderland's ground a third dimension.

THE REFERENCE GAP. The founder image is TERRACED. You stand on a paved level;
broad shallow steps drop away left and right; the garden beyond sits lower; the
city behind it sits higher. Almost none of the picture is at one elevation, and
that layering is most of why it reads as depth rather than as a painted flat.

Wonderland's quarters are flat inside. `region.py` found ground that was "full
of actors, reachable, correctly sparse for its own tier, and still nothing to
arrive at" -- and one reason a place can be all of those and still read as
nothing is that it has no level to arrive AT. The world has one stair in it,
`WL_Wall_Stair_Flight`, and it is welded to a curtain wall.

THE RULE THAT MAKES THESE MODULES RATHER THAN PROPS. Every flight climbs a
whole number of 0.310 m risers and arrives on a rung of `kit.ROUTE_LADDER`:

    T1  1.55 m    5 risers
    T2  3.10 m   10 risers
    T3  6.20 m   20 risers   -- the curtain wall's own walk height
    T4  9.30 m   30 risers

so a generator that knows only "I need to get from the lower garden to the
terrace" can pick a module by its arrival rung instead of measuring geometry.
T3 is not a new number: it is `walls.WALK_Z`, which means a garden stair, a
retaining terrace and a city wall all meet at one elevation.

WHY 0.310 x 0.360. `verify_v2_layout.py` audits step height over every surface
in the world and reports "0 violations over 914 surfaces", so a stair that
fails it becomes an obstacle and the level above becomes unreachable ground
`walkable.py` would then report as closed. 0.310 rise on 0.360 going is 40.7
degrees -- steep for an office and right for a castle, and the CEREMONIAL
flight deliberately breaks it the other way (0.155 on 0.900, 9.8 degrees)
because the reference's own foreground steps are shallow and enormous.

SOCKETS. Every module publishes `bottom_route` and `top_route` (kind `route`)
at its two elevations, `landing` where it has one, `wall_join` (kind `pier`)
where it is meant to sit against a retaining wall, and `edge` sockets where a
balustrade mounts. The world session reads elevation off the socket, never off
the mesh.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

RISER = K.RISER_M
GOING = 0.360
T1, T2, T3, T4 = (K.ROUTE_LADDER[k] for k in ("T1", "T2", "T3", "T4"))


def _routes(rise, run, width, extra=()):
    """The two route sockets every flight publishes, plus any extras."""
    return [K.Socket("bottom_route", 0.0, width * 0.5, "route",
                     "walkable ground at z = 0, entering along +X"),
            K.Socket("top_route", rise, width * 0.5, "route",
                     "arrives at %.2f m (%d risers, rung %s) at x = %.2f m"
                     % (rise, K.risers_for(rise), K.route_rung(rise), run))] + list(extra)


def stair_straight_t2(f):
    """Ten risers to 3.10 m, 3.4 m wide. The kit's default change of level.

    The plainest module in the family and the one a generator will place most:
    one terrace up, no turn, no ceremony. Cheeks and a balustrade both sides so
    it reads as built rather than as a ramp somebody stepped.
    """
    p = f.part("stone")
    W = 3.40
    _, (run, rise) = E.stair_flight(p, 10, W, going=GOING, riser=RISER)
    for sgn in (-1.0, 1.0):
        E.stair_cheek(p, run, rise, sgn * (W * 0.5 + 0.21))
        E.rake_balustrade(p, run, rise, sgn * (W * 0.5 + 0.21))
    return K.ModuleSpec(
        "WL_Stair_Straight_T2", "stair", "structure", "route",
        f.emit("WL_Stair_Straight_T2"),
        _routes(rise, run, W, [
            K.Socket("edge_l", 0.0, W * 0.5 + 0.21, "edge", "balustrade line, -Y side"),
            K.Socket("edge_r", 0.0, W * 0.5 + 0.21, "edge", "balustrade line, +Y side")]),
        districts=("royal_garden", "plaza", "city", "tea_terrace", "water_garden"),
        note="10 risers of 0.310 m to the T2 terrace at 3.10 m; 3.4 m clear "
             "width, cheeks and balusters both sides",
        params={"risers": 10, "riser_m": RISER, "going_m": GOING,
                "rise_m": rise, "run_m": run, "width_m": W, "rung": "T2",
                "pitch_deg": round(math.degrees(math.atan2(RISER, GOING)), 1)},
        tri_budget=14000, collision=True)


def stair_straight_t3(f):
    """Twenty risers to 6.20 m, free-standing. The wall-walk, off the wall.

    `WL_Wall_Stair_Flight` reaches the same elevation but has a flat back and
    only works pressed against a curtain. This one is finished on both sides,
    so it climbs a terrace, a podium or a retaining wall the kit did not
    author. Same arrival rung, so the two are interchangeable to a generator.
    """
    p = f.part("stone")
    g = f.part("gold")
    W = 3.80
    _, (run, rise) = E.stair_flight(p, 20, W, going=GOING, riser=RISER)
    for sgn in (-1.0, 1.0):
        E.stair_cheek(p, run, rise, sgn * (W * 0.5 + 0.24), thickness=0.48)
        E.rake_balustrade(p, run, rise, sgn * (W * 0.5 + 0.24), height=1.15)
        # a newel at each end of each rail, the kit's own punctuation
        for (x, z) in ((-0.05, 0.0), (run + 0.10, rise)):
            p.box(0.72, 0.72, 1.95, at=(x, sgn * (W * 0.5 + 0.24), z),
                  chamfer=0.07, centre_z=False)
            E.finial(p, (x, sgn * (W * 0.5 + 0.24), z + 1.95), 0.80,
                     radius=0.14, gold=g)
    return K.ModuleSpec(
        "WL_Stair_Straight_T3", "stair", "structure", "route",
        f.emit("WL_Stair_Straight_T3"),
        _routes(rise, run, W, [
            K.Socket("edge_l", 0.0, W * 0.5 + 0.24, "edge", "balustrade line, -Y"),
            K.Socket("edge_r", 0.0, W * 0.5 + 0.24, "edge", "balustrade line, +Y")]),
        districts=("plaza", "city", "castle", "royal_garden"),
        note="20 risers to the T3 wall-walk elevation, 6.20 m; finished both "
             "sides with newels, so it needs no wall to lean on",
        params={"risers": 20, "rise_m": rise, "run_m": run, "width_m": W,
                "rung": "T3", "interchangeable_with": "WL_Wall_Stair_Flight"},
        tri_budget=26000, collision=True)


def stair_quarter_landing(f):
    """Five up, a landing, a quarter turn, five up. T2 with a 90-degree turn.

    A straight flight is a straight line, and a garden made only of straight
    lines is a grid. The quarter turn lets a route CHANGE BEARING while it
    climbs, which is what makes a terraced garden feel discovered rather than
    laid out -- and it fits a stair into a corner a straight flight would
    overshoot by six metres.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    W = 2.90
    LAND = W + 0.60
    _, (run1, rise1) = E.stair_flight(p, 5, W, going=GOING, riser=RISER)
    lx = run1 + LAND * 0.5
    E.landing(p, LAND, LAND, at=(lx, 0.0, rise1), dark=d)
    # the second flight leaves the landing along +Y
    turn = M.xform((lx, LAND * 0.5, rise1), (0.0, 0.0, 90.0))
    _, (run2, rise2) = E.stair_flight(p, 5, W, going=GOING, riser=RISER,
                                      matrix=turn)
    for sgn in (-1.0, 1.0):
        E.stair_cheek(p, run1, rise1, sgn * (W * 0.5 + 0.20))
        E.rake_balustrade(p, run1, rise1, sgn * (W * 0.5 + 0.20))
        E.stair_cheek(p, run2, rise2, sgn * (W * 0.5 + 0.20), matrix=turn)
        E.rake_balustrade(p, run2, rise2, sgn * (W * 0.5 + 0.20), matrix=turn)
    p.box(LAND + 0.30, LAND + 0.30, 0.16, at=(lx, 0.0, rise1 - 0.58),
          chamfer=0.04, centre_z=False)
    rise = rise1 + rise2
    return K.ModuleSpec(
        "WL_Stair_Quarter_Landing", "stair", "structure", "route",
        f.emit("WL_Stair_Quarter_Landing"),
        [K.Socket("bottom_route", 0.0, W * 0.5, "route",
                  "enters along +X at z = 0"),
         K.Socket("landing", rise1, LAND * 0.5, "route",
                  "level platform at 1.55 m, x = %.2f m" % lx),
         K.Socket("top_route", rise, W * 0.5, "route",
                  "leaves along +Y at 3.10 m (T2), 90 degrees off the entry")],
        districts=("royal_garden", "tea_terrace", "grove", "water_garden"),
        note="5 + landing + 5 with a 90-degree turn; T2 in a footprint a "
             "straight flight would overshoot",
        params={"risers": 10, "rise_m": rise, "turn_deg": 90.0,
                "landing_z_m": rise1, "rung": "T2"},
        tri_budget=20000, collision=True)


def stair_half_turn(f):
    """Ten up, a landing, 180 degrees, ten up. T3 in half the length.

    The switchback. Twenty risers straight is 7.2 m of run; folded, it is 3.9 m
    and it climbs the same 6.20 m -- which is the difference between a stair
    that fits against a retaining wall and one that eats the terrace it serves.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    W = 2.60
    GAP = 0.55
    _, (run1, rise1) = E.stair_flight(p, 10, W, going=GOING, riser=RISER)
    LAND_D = W * 2.0 + GAP
    lx = run1 + 1.05
    E.landing(p, 2.10, LAND_D, at=(lx, LAND_D * 0.5 - W * 0.5, rise1), dark=d)
    p.box(2.40, LAND_D + 0.30, 0.18, at=(lx, LAND_D * 0.5 - W * 0.5, rise1 - 0.60),
          chamfer=0.04, centre_z=False)
    # the return flight sits BESIDE the first, one flight-width plus the
    # spine gap across, heading back along -X. Aiming it at the landing's
    # far edge instead put it 1.3 m adrift and it read as two stairs.
    back = M.xform((lx + 1.05, W + GAP, rise1), (0.0, 0.0, 180.0))
    _, (run2, rise2) = E.stair_flight(p, 10, W, going=GOING, riser=RISER,
                                      matrix=back)
    # the spine wall between the two flights: what a half-turn actually needs
    p.box(run1 + 1.0, 0.44, rise1 + 1.30, at=((run1 + 1.0) * 0.5 - 0.1,
                                              W * 0.5 + GAP * 0.5, 0.0),
          chamfer=0.08, centre_z=False)
    E.rake_balustrade(p, run1, rise1, -(W * 0.5 + 0.20))
    E.stair_cheek(p, run1, rise1, -(W * 0.5 + 0.20))
    E.rake_balustrade(p, run2, rise2, -(W * 0.5 + 0.20), matrix=back)
    E.stair_cheek(p, run2, rise2, -(W * 0.5 + 0.20), matrix=back)
    p.box(0.66, 0.66, 1.85, at=(-0.05, -(W * 0.5 + 0.20), 0.0), chamfer=0.07,
          centre_z=False)
    E.finial(p, (-0.05, -(W * 0.5 + 0.20), 1.85), 0.72, radius=0.13, gold=g)
    rise = rise1 + rise2
    return K.ModuleSpec(
        "WL_Stair_HalfTurn", "stair", "structure", "route",
        f.emit("WL_Stair_HalfTurn"),
        [K.Socket("bottom_route", 0.0, W * 0.5, "route", "enters along +X at z = 0"),
         K.Socket("landing", rise1, 1.05, "route",
                  "half-landing at 3.10 m (T2), x = %.2f m" % lx),
         K.Socket("top_route", rise, W * 0.5, "route",
                  "arrives at 6.20 m (T3) heading BACK along -X, offset +Y"),
         K.Socket("wall_join", 0.0, 0.22, "pier",
                  "the spine wall at y = +1.58 m takes a retaining wall")],
        districts=("castle", "city", "royal_garden", "plaza"),
        note="10 + half-landing + 10 folded 180 degrees: T3 in 3.9 m of plan "
             "instead of 7.2 m",
        params={"risers": 20, "rise_m": rise, "turn_deg": 180.0,
                "landing_z_m": rise1, "rung": "T3", "plan_run_m": run1 + 2.1},
        tri_budget=30000, collision=True)


def stair_curved(f):
    """Ten risers on a 7 m arc through 55 degrees. T2, and it bends.

    Every other flight in the kit is a straight run of boxes. A curved flight
    is the one shape that says a garden was DESIGNED rather than dropped, and
    it is cheap: the treads are wedges, the balustrade follows the same arc as
    the colonnade family's, and the whole thing is 10 risers like everything
    else at this rung.
    """
    p = f.part("stone")
    R_IN, R_OUT = 5.20, 8.60
    N = 10
    SWEEP = 55.0
    step = math.radians(SWEEP) / N
    for i in range(N):
        a0 = step * i
        seg = []
        for k in range(4):
            a = a0 + step * (k / 3.0)
            seg.append((math.cos(a) * R_IN, math.sin(a) * R_IN))
        outer = []
        for k in range(3, -1, -1):
            a = a0 + step * (k / 3.0)
            outer.append((math.cos(a) * R_OUT, math.sin(a) * R_OUT))
        # each tread runs from its own step back to the foot, as a solid wedge
        poly = []
        for k in range(4):
            a = step * (k / 3.0) * 0.0 + a0 + step * (k / 3.0)
            poly.append((math.cos(a) * R_IN, math.sin(a) * R_IN))
        full = []
        steps_back = (i + 1) * 3
        for k in range(steps_back + 1):
            a = step * (i + 1) * (k / float(steps_back))
            full.append((math.cos(a) * R_IN, math.sin(a) * R_IN))
        for k in range(steps_back, -1, -1):
            a = step * (i + 1) * (k / float(steps_back))
            full.append((math.cos(a) * R_OUT, math.sin(a) * R_OUT))
        p.prism(full, RISER, z0=RISER * i)
    rise = RISER * N
    for r, sgn in ((R_IN - 0.22, -1.0), (R_OUT + 0.22, 1.0)):
        n = 13
        for i in range(n + 1):
            t = i / float(n)
            a = math.radians(SWEEP) * t
            p.lathe([(0.0, 0.0), (0.085, 0.0), (0.070, 0.24), (0.125, 0.50),
                     (0.075, 0.86), (0.090, 1.10), (0.0, 1.22)], segments=8,
                    smooth=True,
                    matrix=M.xform((math.cos(a) * r, math.sin(a) * r,
                                    0.46 + rise * t)))
        # the raking rail, as a swept tube following the same arc
        pts = [(math.cos(math.radians(SWEEP) * (i / 20.0)) * r,
                math.sin(math.radians(SWEEP) * (i / 20.0)) * r,
                0.46 + 1.05 + rise * (i / 20.0)) for i in range(21)]
        p.sweep(pts, [0.13] * 21, sides=5, cap=True)
    return K.ModuleSpec(
        "WL_Stair_Curved", "stair", "structure", "route",
        f.emit("WL_Stair_Curved"),
        [K.Socket("bottom_route", 0.0, (R_OUT - R_IN) * 0.5, "route",
                  "enters at bearing 0 deg on a 6.90 m mean radius"),
         K.Socket("top_route", rise, (R_OUT - R_IN) * 0.5, "route",
                  "arrives at 3.10 m (T2) at bearing 55 deg"),
         K.Socket("edge_l", 0.0, R_IN - 0.22, "edge", "inner balustrade arc"),
         K.Socket("edge_r", 0.0, R_OUT + 0.22, "edge", "outer balustrade arc")],
        districts=("royal_garden", "plaza", "water_garden", "tea_terrace"),
        note="10 wedge risers on a 55-degree arc, mean radius 6.90 m; the "
             "module's origin is the ARC CENTRE, not the geometry",
        params={"risers": 10, "rise_m": rise, "sweep_deg": SWEEP,
                "r_inner_m": R_IN, "r_outer_m": R_OUT, "rung": "T2",
                "origin": "arc centre"},
        tri_budget=26000, collision=True)


def stair_ceremonial(f):
    """Ten shallow risers, 13 m wide, with flanking dies. The reference's own steps.

    THE ONE THAT BREAKS THE RISER ON PURPOSE. Every other flight here is 0.310
    on 0.360; this is 0.155 on 0.900, a 9.8-degree pitch, because the founder
    image's foreground steps are enormous and shallow and that shallowness is
    exactly what makes them read as ceremonial rather than as circulation. You
    do not hurry up these.

    It still arrives on the ladder: 10 risers of 0.155 is 1.55 m, rung T1.
    """
    p = f.part("stone")
    g = f.part("gold")
    W = 13.0
    R, G, N = 0.155, 0.900, 10
    _, (run, rise) = E.stair_flight(p, N, W, going=G, riser=R, nosing=0.06)
    for sgn in (-1.0, 1.0):
        y = sgn * (W * 0.5 + 0.55)
        # a solid die rather than a balustrade: at this width a rail would
        # read as a fence and the reference's are blocks with urns on them
        p.loft([[(-0.20, y - 0.55, 0.0), (run + 0.40, y - 0.55, 0.0),
                 (run + 0.40, y + 0.55, 0.0), (-0.20, y + 0.55, 0.0)],
                [(-0.20, y - 0.55, 0.95), (run + 0.40, y - 0.55, rise + 0.95),
                 (run + 0.40, y + 0.55, rise + 0.95), (-0.20, y + 0.55, 0.95)]],
               smooth=False)
        for (x, z) in ((0.10, 0.95), (run + 0.10, rise + 0.95)):
            p.box(1.30, 1.30, 0.34, at=(x, y, z), chamfer=0.07, centre_z=False)
            p.box(1.05, 1.05, 1.05, at=(x, y, z + 0.34), chamfer=0.09, centre_z=False)
            p.box(1.24, 1.24, 0.20, at=(x, y, z + 1.39), chamfer=0.05, centre_z=False)
            g.lathe([(0.0, z + 1.59), (0.30, z + 1.59), (0.25, z + 1.70),
                     (0.44, z + 1.84), (0.52, z + 2.06), (0.44, z + 2.28),
                     (0.26, z + 2.40), (0.31, z + 2.47), (0.16, z + 2.52),
                     (0.0, z + 2.55)], segments=18, smooth=True,
                    matrix=M.xform((x, y, 0.0)))
    return K.ModuleSpec(
        "WL_Stair_Ceremonial", "stair", "structure", "route",
        f.emit("WL_Stair_Ceremonial"),
        [K.Socket("bottom_route", 0.0, W * 0.5, "route", "13 m of open front at z = 0"),
         K.Socket("top_route", rise, W * 0.5, "route",
                  "arrives at 1.55 m (T1) across the full 13 m width"),
         K.Socket("edge_l", 0.0, W * 0.5 + 0.55, "edge", "die line, -Y"),
         K.Socket("edge_r", 0.0, W * 0.5 + 0.55, "edge", "die line, +Y")],
        districts=("plaza", "royal_garden", "city"),
        note="13 m wide, 10 risers of 0.155 m on a 0.900 m going -- 9.8 "
             "degrees, deliberately off the kit's riser; flanking dies with "
             "gold urns",
        params={"risers": N, "riser_m": R, "going_m": G, "rise_m": rise,
                "width_m": W, "rung": "T1", "pitch_deg": 9.8,
                "riser_exception": "ceremonial shallow, not the 0.310 m kit riser"},
        tri_budget=30000, collision=True)


def stair_garden(f):
    """Five risers, 2.2 m wide, planted cheeks. The informal one.

    Small, and the only flight in the kit whose cheeks are `veg_anchor` rather
    than balustrade -- because a garden step in the reference is half buried in
    planting and a rail on it would look municipal. The world session scatters
    its own foliage onto the anchors; this models none.
    """
    p = f.part("stone")
    v = f.part("veg_anchor")
    W = 2.20
    _, (run, rise) = E.stair_flight(p, 5, W, going=0.400, riser=RISER)
    for sgn in (-1.0, 1.0):
        y = sgn * (W * 0.5 + 0.28)
        p.loft([[(-0.10, y - 0.28, 0.0), (run + 0.20, y - 0.28, 0.0),
                 (run + 0.20, y + 0.28, 0.0), (-0.10, y + 0.28, 0.0)],
                [(-0.10, y - 0.28, 0.34), (run + 0.20, y - 0.28, rise + 0.34),
                 (run + 0.20, y + 0.28, rise + 0.34), (-0.10, y + 0.28, 0.34)]],
               smooth=False)
        v.box(run + 0.10, 0.34, 0.10, at=(run * 0.5, y, rise * 0.5 + 0.20),
              rot=(0.0, -math.degrees(math.atan2(rise, run)), 0.0),
              centre_z=False)
    return K.ModuleSpec(
        "WL_Stair_Garden", "stair", "structure", "route",
        f.emit("WL_Stair_Garden"),
        _routes(rise, run, W, [
            K.Socket("edge_l", 0.0, W * 0.5 + 0.28, "edge", "planted cheek, -Y"),
            K.Socket("edge_r", 0.0, W * 0.5 + 0.28, "edge", "planted cheek, +Y")]),
        districts=("royal_garden", "grove", "water_garden", "tea_terrace", "meadow"),
        note="5 risers to T1 at 1.55 m on a shallow 0.400 m going; cheeks are "
             "veg_anchor strips, not balustrades",
        params={"risers": 5, "rise_m": rise, "going_m": 0.400, "width_m": W,
                "rung": "T1", "cheeks": "veg_anchor"},
        tri_budget=8000, collision=True)


def ramp_terrace(f):
    """A 1-in-12 ramp to T1, 3.0 m wide, with kerbs. The route with no steps.

    Not an accessibility gesture -- a CART ROUTE, and the reason a terraced
    garden has service access at all. It also gives the world session something
    to place where `walkable.py` reports a stair the Dog's gait cannot take,
    which is a real failure mode for a four-legged pawn on 40-degree treads.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    W = 3.00
    rise = T1
    run = rise * 12.0
    p.loft([[(0.0, -W * 0.5, 0.0), (run, -W * 0.5, 0.0),
             (run, W * 0.5, 0.0), (0.0, W * 0.5, 0.0)],
            [(0.0, -W * 0.5, 0.30), (run, -W * 0.5, rise + 0.30),
             (run, W * 0.5, rise + 0.30), (0.0, W * 0.5, 0.30)]], smooth=False)
    d.loft([[(0.20, -W * 0.5 + 0.26, 0.26), (run - 0.20, -W * 0.5 + 0.26, rise + 0.26),
             (run - 0.20, W * 0.5 - 0.26, rise + 0.26), (0.20, W * 0.5 - 0.26, 0.26)],
            [(0.20, -W * 0.5 + 0.26, 0.31), (run - 0.20, -W * 0.5 + 0.26, rise + 0.31),
             (run - 0.20, W * 0.5 - 0.26, rise + 0.31), (0.20, W * 0.5 - 0.26, 0.31)]],
            smooth=False)
    for sgn in (-1.0, 1.0):
        y = sgn * (W * 0.5 + 0.13)
        p.loft([[(-0.10, y - 0.13, 0.0), (run + 0.20, y - 0.13, 0.0),
                 (run + 0.20, y + 0.13, 0.0), (-0.10, y + 0.13, 0.0)],
                [(-0.10, y - 0.13, 0.52), (run + 0.20, y - 0.13, rise + 0.52),
                 (run + 0.20, y + 0.13, rise + 0.52), (-0.10, y + 0.13, 0.52)]],
               smooth=False)
    return K.ModuleSpec(
        "WL_Ramp_Terrace", "stair", "structure", "route",
        f.emit("WL_Ramp_Terrace"),
        _routes(rise, run, W, [
            K.Socket("edge_l", 0.0, W * 0.5 + 0.13, "edge", "kerb line, -Y"),
            K.Socket("edge_r", 0.0, W * 0.5 + 0.13, "edge", "kerb line, +Y")]),
        districts=("royal_garden", "plaza", "water_garden", "hamlet"),
        note="1-in-12 ramp to T1 at 1.55 m over 18.6 m; kerbs both sides and a "
             "darker running surface. The step-free route.",
        params={"gradient": "1:12", "rise_m": rise, "run_m": run,
                "width_m": W, "rung": "T1", "steps": 0},
        tri_budget=6000, collision=True)


BUILDERS = (
    stair_straight_t2, stair_straight_t3, stair_quarter_landing,
    stair_half_turn, stair_curved, stair_ceremonial, stair_garden,
    ramp_terrace,
)
