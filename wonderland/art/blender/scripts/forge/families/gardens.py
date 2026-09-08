"""Retaining walls, terraces, planters, overlooks: authored vertical gardens.

THE REFERENCE GAP, and it is the reason the stair family alone is not enough.
The founder image's garden is on SEVERAL LEVELS, and the levels are held by low
walls with balustrades and planting spilling over them. Wonderland's gardens are
vegetation scattered on a flat plane. Adding stairs to a flat plane gives you
stairs to nowhere; what a stair needs at its top is a HELD EDGE.

THE SYSTEM. Every module in this family retains exactly one route rung, and the
default is T2 = 3.10 m, which is:

  * ten of the kit's 0.310 m risers, so `WL_Stair_Straight_T2`,
    `WL_Stair_Quarter_Landing` and `WL_Stair_Curved` all arrive on it
  * the height of this family's coping, so a stair's top landing and a
    terrace's walking surface are the same plane

and every straight run is 8.00 m long, which is:

  * the length of `WL_Detail_Balustrade_Run`, so the kit's existing balustrade
    sits on a retaining coping with no new module and no arithmetic
  * a whole number of the 0.360 m stair going, so a terrace edge lines up with
    a flight beside it

Those two coincidences are not coincidences. They are the reason this is a
system rather than nine more meshes.

WHAT IT LETS A GENERATOR BUILD:

    LOWER GARDEN
        -> WL_Stair_Straight_T2 / _Curved / _Quarter_Landing   (10 risers)
    MID TERRACE at 3.10 m, edge held by
        -> WL_Garden_Retaining_Run x N, cornered by _Corner_In / _Corner_Out
        -> WL_Detail_Balustrade_Run on the coping
    UPPER COURT
        -> WL_Garden_Pavilion_Base, WL_Garden_Overlook

BATTER, AGAIN. Every retaining face leans back 1 in 12. A vertical retaining
wall reads as a fence holding nothing; a battered one reads as earth being
held, which is the whole point of the module.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

#: The rung this family retains, and the run length it retains it over. Both
#: are shared numbers -- see the module docstring for why each was chosen.
TERRACE_Z = K.ROUTE_LADDER["T2"]          # 3.10 m == 10 risers
RUN = 8.00                                # == WL_Detail_Balustrade_Run
THICK = 1.10
BATTER = TERRACE_Z / 12.0                 # 1 in 12


def _retaining_face(part, dark, veg, length, x0=0.0, matrix=None, coping=True):
    """One straight length of battered retaining wall with a coping.

    Shared by the run, the corners and the gate so a garden's section cannot
    disagree with itself where two modules meet -- the same discipline
    `walls._wall_section` uses, and for the same reason.
    """
    made = []
    ht = THICK * 0.5
    made += part.loft([
        [(-length * 0.5 + x0, -(ht + BATTER), 0.0), (length * 0.5 + x0, -(ht + BATTER), 0.0),
         (length * 0.5 + x0, ht, 0.0), (-length * 0.5 + x0, ht, 0.0)],
        [(-length * 0.5 + x0, -ht, TERRACE_Z - 0.34), (length * 0.5 + x0, -ht, TERRACE_Z - 0.34),
         (length * 0.5 + x0, ht, TERRACE_Z - 0.34), (-length * 0.5 + x0, ht, TERRACE_Z - 0.34)]],
        matrix=matrix, smooth=False)
    if coping:
        # the coping oversails the batter, which is what throws the shadow that
        # makes a retaining wall read as a made edge rather than as a slope
        made += part.box(length, THICK + 0.44, 0.22, at=(x0, -0.10, TERRACE_Z - 0.34),
                         matrix=matrix, chamfer=0.05, centre_z=False)
        # the coping stops 6 cm down and the wearing course fills it. Both
        # topping out at TERRACE_Z put two up-facing faces in one plane and
        # every coping in the family rendered with a black strip along it.
        made += part.box(length, THICK + 0.26, 0.06, at=(x0, -0.04, TERRACE_Z - 0.12),
                         matrix=matrix, chamfer=0.03, centre_z=False)
        dark.box(length - 0.20, THICK * 0.72, 0.08, at=(x0, ht * 0.30, TERRACE_Z - 0.08),
                 matrix=matrix, centre_z=False)
    # planting spills OVER a garden wall; the anchor sits just behind the coping
    veg.box(length - 0.30, 0.34, 0.10, at=(x0, ht - 0.24, TERRACE_Z - 0.30),
            matrix=matrix, centre_z=False)
    return made


def garden_retaining_run(f):
    """8 m of battered retaining wall holding the T2 terrace at 3.10 m.

    The family's default and the one a generator places most. Its coping is at
    3.10 m and it is 8.00 m long, so `WL_Detail_Balustrade_Run` stands on it
    exactly and `WL_Stair_Straight_T2` arrives level with it.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    v = f.part("veg_anchor")
    _retaining_face(p, d, v, RUN)
    # weep courses: three small openings a real retaining wall needs, and the
    # only thing at this scale that says the wall is holding water back
    for i in range(3):
        x = -RUN * 0.5 + RUN * (i + 0.5) / 3.0
        d.box(0.26, 0.20, 0.22, at=(x, -(THICK * 0.5 + BATTER * 0.72), 0.62),
              centre_z=False)
    return K.ModuleSpec(
        "WL_Garden_Retaining_Run", "garden", "structure", "terrace",
        f.emit("WL_Garden_Retaining_Run"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("top_route", TERRACE_Z, RUN * 0.5, "route",
                  "the retained terrace at 3.10 m (T2) is walkable to +Y"),
         K.Socket("edge", TERRACE_Z, RUN * 0.5, "edge",
                  "coping line; WL_Detail_Balustrade_Run is exactly 8.00 m and sits here"),
         K.Socket("end_a", 0.0, THICK * 0.5, "pier", "butts at x = -4.00 m"),
         K.Socket("end_b", 0.0, THICK * 0.5, "pier", "butts at x = +4.00 m")],
        districts=("royal_garden", "water_garden", "tea_terrace", "plaza", "grove"),
        note="8.00 m of 1-in-12 battered retaining wall holding T2 at 3.10 m; "
             "coping, weeps, and a planting anchor behind the coping",
        params={"length_m": RUN, "retains_m": TERRACE_Z, "rung": "T2",
                "batter": "1:12", "thickness_m": THICK,
                "balustrade": "WL_Detail_Balustrade_Run fits the coping exactly"},
        tri_budget=9000, collision=True)


def garden_retaining_corner_in(f):
    """The 90-degree corner that turns INTO the retained bank. 5 m arms.

    A terrace has both kinds of corner and they are not the same shape: an
    inside corner has its batter on the concave side and the coping mitres
    around the outside of the turn. Getting one and using it for both is what
    makes a modular garden look like a modular garden.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    v = f.part("veg_anchor")
    ARM = 5.00
    ht = THICK * 0.5
    _retaining_face(p, d, v, ARM, x0=ARM * 0.5 + ht)
    _retaining_face(p, d, v, ARM, x0=ARM * 0.5 + ht,
                    matrix=M.xform((0, 0, 0), (0, 0, 90.0)))
    # the quoin block that fills the mitre, so the two arms meet in a corner
    # rather than in an overlap -- the postern's z-fight, avoided by design
    p.loft([[(-ht - BATTER, -ht - BATTER, 0.0), (ht, -ht - BATTER, 0.0),
             (ht, ht, 0.0), (-ht - BATTER, ht, 0.0)],
            [(-ht, -ht, TERRACE_Z - 0.34), (ht, -ht, TERRACE_Z - 0.34),
             (ht, ht, TERRACE_Z - 0.34), (-ht, ht, TERRACE_Z - 0.34)]], smooth=False)
    p.box(THICK + 0.44, THICK + 0.44, 0.22, at=(-0.10, -0.10, TERRACE_Z - 0.34),
          chamfer=0.05, centre_z=False)
    p.box(THICK + 0.26, THICK + 0.26, 0.06, at=(-0.04, -0.04, TERRACE_Z - 0.12),
          chamfer=0.03, centre_z=False)
    return K.ModuleSpec(
        "WL_Garden_Retaining_Corner_In", "garden", "structure", "terrace",
        f.emit("WL_Garden_Retaining_Corner_In"),
        [K.Socket("bottom", 0.0, ARM + THICK, "ground"),
         K.Socket("top_route", TERRACE_Z, ARM, "route", "T2 terrace at 3.10 m"),
         K.Socket("edge", TERRACE_Z, ARM, "edge", "coping turns the corner at 3.10 m"),
         # THE NUMBER IS COMPUTED, NOT TYPED. Its twin below said -5.55 on an
         # arm that runs the other way, and nothing compared a socket note
         # against the geometry it describes until the grammar check did.
         K.Socket("end_a", 0.0, THICK * 0.5, "pier",
                  "arm along +X ends at x = +%.2f m" % (ARM + ht)),
         K.Socket("end_b", 0.0, THICK * 0.5, "pier",
                  "arm along +Y ends at y = +%.2f m" % (ARM + ht))],
        districts=("royal_garden", "water_garden", "tea_terrace", "plaza"),
        note="90-degree inside corner with a mitred quoin; two 5.00 m arms on "
             "the same section as the run",
        params={"arm_m": ARM, "turn_deg": 90.0, "retains_m": TERRACE_Z,
                "rung": "T2", "corner": "inside"},
        tri_budget=9000, collision=True)


def garden_retaining_corner_out(f):
    """The 90-degree corner that turns OUT of the bank -- a projecting bay.

    The convex twin. A garden terrace that only ever turns inward is a box;
    the outward corner is what lets a terrace push a bay out over the level
    below, which is where a bench, an urn or an overlook goes.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    v = f.part("veg_anchor")
    g = f.part("gold")
    ARM = 5.00
    ht = THICK * 0.5
    _retaining_face(p, d, v, ARM, x0=-(ARM * 0.5 + ht))
    _retaining_face(p, d, v, ARM, x0=-(ARM * 0.5 + ht),
                    matrix=M.xform((0, 0, 0), (0, 0, -90.0)))
    p.loft([[(-ht, -ht, 0.0), (ht + BATTER, -ht, 0.0),
             (ht + BATTER, ht + BATTER, 0.0), (-ht, ht + BATTER, 0.0)],
            [(-ht, -ht, TERRACE_Z - 0.34), (ht, -ht, TERRACE_Z - 0.34),
             (ht, ht, TERRACE_Z - 0.34), (-ht, ht, TERRACE_Z - 0.34)]], smooth=False)
    p.box(THICK + 0.44, THICK + 0.44, 0.22, at=(0.10, 0.10, TERRACE_Z - 0.34),
          chamfer=0.05, centre_z=False)
    p.box(THICK + 0.26, THICK + 0.26, 0.06, at=(0.04, 0.04, TERRACE_Z - 0.12),
          chamfer=0.03, centre_z=False)
    # the outward corner is the one that gets an urn, because it is the one
    # the level below can see
    p.box(0.98, 0.98, 0.30, at=(0.10, 0.10, TERRACE_Z), chamfer=0.06, centre_z=False)
    g.lathe([(0.0, TERRACE_Z + 0.30), (0.26, TERRACE_Z + 0.30), (0.22, TERRACE_Z + 0.40),
             (0.38, TERRACE_Z + 0.52), (0.45, TERRACE_Z + 0.72), (0.38, TERRACE_Z + 0.92),
             (0.22, TERRACE_Z + 1.03), (0.27, TERRACE_Z + 1.10), (0.13, TERRACE_Z + 1.15),
             (0.0, TERRACE_Z + 1.18)], segments=18, smooth=True,
            matrix=M.xform((0.10, 0.10, 0.0)))
    return K.ModuleSpec(
        "WL_Garden_Retaining_Corner_Out", "garden", "structure", "terrace",
        f.emit("WL_Garden_Retaining_Corner_Out"),
        [K.Socket("bottom", 0.0, ARM + THICK, "ground"),
         K.Socket("top_route", TERRACE_Z, ARM, "route", "T2 terrace at 3.10 m"),
         K.Socket("edge", TERRACE_Z, ARM, "edge", "coping turns the corner at 3.10 m"),
         K.Socket("end_a", 0.0, THICK * 0.5, "pier",
                  "arm along -X ends at x = %+.2f m" % (-(ARM + ht))),
         K.Socket("end_b", 0.0, THICK * 0.5, "pier",
                  "arm along +Y ends at y = %+.2f m" % (ARM + ht))],
        districts=("royal_garden", "water_garden", "tea_terrace", "plaza"),
        note="90-degree outside corner with a gold urn on the quoin; the "
             "projecting bay a terrace pushes over the level below",
        params={"arm_m": ARM, "turn_deg": 90.0, "retains_m": TERRACE_Z,
                "rung": "T2", "corner": "outside", "urn": "gold"},
        tri_budget=10000, collision=True)


def garden_retaining_curved(f):
    """A 45-degree arc of retaining wall on an 11 m radius. Eight close a circle.

    The reference's garden edges are not straight. Eight of these make an exact
    circle 22 m across -- a round sunken garden, a bowl for a basin, or the
    apron of an overlook -- and the module's origin is the ARC CENTRE so a
    generator turns it rather than placing it.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    v = f.part("veg_anchor")
    R = 11.00
    ARC = 45.0
    SEG = 16
    ht = THICK * 0.5
    turn = M.xform((0, 0, 0), (0, 0, -ARC * 0.5))

    # ONE CLOSED SECTION, revolved. The first version stacked a battered
    # frustum and two coping rings as separate partial lathes with different
    # arc padding; where their end caps failed to line up the module rendered
    # with a black wedge out of it. A section that closes on itself has exactly
    # two end caps and they are the section.
    section = [
        (R - ht - 0.10, 0.0),                       # inner foot (inside the bank)
        (R + ht + BATTER, 0.0),                     # outer foot
        (R + ht, TERRACE_Z - 0.34),                 # top of the battered face
        (R + ht + 0.34, TERRACE_Z - 0.34),          # coping oversail
        (R + ht + 0.34, TERRACE_Z - 0.12),
        (R + ht + 0.16, TERRACE_Z - 0.12),
        (R + ht + 0.16, TERRACE_Z - 0.06),
        (R - ht - 0.10, TERRACE_Z - 0.06),          # back to the bank at coping level
        (R - ht - 0.10, 0.0),
    ]
    p.lathe(section, segments=SEG, arc=ARC, matrix=turn, smooth=False)
    # the wearing course BEDS 2 cm into the coping rather than sitting exactly
    # on it. Coincident faces are depth-sorted fine in an engine but Cycles
    # shows a hairline of background along the seam at a grazing angle, and a
    # hairline in a contact sheet is indistinguishable from a real gap.
    d.lathe([(R - ht - 0.06, TERRACE_Z - 0.08), (R + ht + 0.10, TERRACE_Z - 0.08),
             (R + ht + 0.10, TERRACE_Z), (R - ht - 0.06, TERRACE_Z),
             (R - ht - 0.06, TERRACE_Z - 0.08)],
            segments=SEG, arc=ARC - 0.4,
            matrix=M.xform((0, 0, 0), (0, 0, -(ARC - 0.4) * 0.5)), smooth=False)
    v.lathe([(R - ht + 0.06, TERRACE_Z - 0.30), (R - ht + 0.34, TERRACE_Z - 0.30),
             (R - ht + 0.34, TERRACE_Z - 0.20), (R - ht + 0.06, TERRACE_Z - 0.20)],
            segments=SEG, arc=ARC - 2.0,
            matrix=M.xform((0, 0, 0), (0, 0, -(ARC - 2.0) * 0.5)), smooth=False)
    return K.ModuleSpec(
        "WL_Garden_Retaining_Curved", "garden", "structure", "terrace",
        f.emit("WL_Garden_Retaining_Curved"),
        [K.Socket("bottom", 0.0, R + ht + BATTER, "ground"),
         K.Socket("top_route", TERRACE_Z, R, "route", "T2 terrace at 3.10 m, inside the arc"),
         K.Socket("edge", TERRACE_Z, R + ht, "edge", "coping follows the 11 m arc"),
         K.Socket("end_a", 0.0, THICK * 0.5, "pier",
                  "the -%.1f-degree end; 45 degrees of an 11 m circle, eight "
                  "close it" % (ARC * 0.5)),
         K.Socket("end_b", 0.0, THICK * 0.5, "pier",
                  "the +%.1f-degree end; the next arc starts here" % (ARC * 0.5))],
        districts=("royal_garden", "water_garden", "plaza"),
        note="45-degree retaining arc on an 11.00 m radius; origin is the ARC "
             "CENTRE, eight make a 22 m circle",
        params={"radius_m": R, "arc_deg": ARC, "retains_m": TERRACE_Z,
                "rung": "T2", "origin": "arc centre", "closes_circle_with": 8},
        tri_budget=9000, collision=True)


def garden_planter_wall(f):
    """A 6 m raised planting bed, 0.93 m high. Three risers, and you sit on it.

    The smallest thing in the family and the one that does most per triangle.
    0.93 m is three of the kit's risers, so it is a legal step up onto the
    terrace as well as a bed -- and its top is `veg_anchor`, so the world
    session's own planting fills it rather than this kit modelling a leaf.
    """
    p = f.part("stone")
    v = f.part("veg_anchor")
    d = f.part("stone_dark")
    LEN, W = 6.00, 1.60
    H = K.RISER_M * 3
    p.box(LEN + 0.24, W + 0.24, 0.18, at=(0.0, 0.0, 0.0), chamfer=0.04, centre_z=False)
    p.box(LEN, W, H - 0.36, at=(0.0, 0.0, 0.18), chamfer=0.05, centre_z=False)
    # THE COPING IS A RIM, NOT A LID. It was one solid slab across the whole
    # top, so the soil pan and the planting under it were sealed inside the
    # module -- a planter with no opening, and 6.45 m2 of pan lying in the same
    # plane as the wall head it was buried in. Four runs leave the bed open.
    COPE = 0.42
    for (bw, bd, bx, by) in (
            (LEN + 0.30, COPE, 0.0, (W + 0.30 - COPE) * 0.5),
            (LEN + 0.30, COPE, 0.0, -(W + 0.30 - COPE) * 0.5),
            (COPE, W + 0.30 - COPE * 2.0, (LEN + 0.30 - COPE) * 0.5, 0.0),
            (COPE, W + 0.30 - COPE * 2.0, -(LEN + 0.30 - COPE) * 0.5, 0.0)):
        p.box(bw, bd, 0.18, at=(bx, by, H - 0.18), chamfer=0.045, centre_z=False)
    for sgn in (-1.0, 1.0):
        p.box(0.34, W + 0.34, H + 0.10, at=(sgn * LEN * 0.5, 0.0, 0.0),
              chamfer=0.05, centre_z=False)
    # soil, then the planting surface standing on it: each sits ON the last,
    # never level with it
    d.box(LEN - 0.44, W - 0.44, 0.06, at=(0.0, 0.0, H - 0.18), centre_z=False)
    v.box(LEN - 0.50, W - 0.50, 0.07, at=(0.0, 0.0, H - 0.12), centre_z=False)
    return K.ModuleSpec(
        "WL_Garden_Planter_Wall", "garden", "prop", "detail",
        f.emit("WL_Garden_Planter_Wall"),
        [K.Socket("bottom", 0.0, LEN * 0.5, "ground"),
         K.Socket("top_route", H, LEN * 0.5, "route",
                  "0.93 m = 3 risers; a legal step up as well as a bed"),
         K.Socket("end_a", 0.0, W * 0.5, "pier", "butts at x = -3.00 m"),
         K.Socket("end_b", 0.0, W * 0.5, "pier", "butts at x = +3.00 m")],
        districts=("royal_garden", "tea_terrace", "water_garden", "plaza", "grove"),
        note="6.00 m raised bed at 0.93 m (three risers); end piers, a sunk "
             "soil pan and a veg_anchor surface the world session plants",
        params={"length_m": LEN, "height_m": H, "risers_equivalent": 3,
                "planting": "veg_anchor, not modelled"},
        tri_budget=4000, collision=True)


def garden_overlook(f):
    """A semicircular belvedere pushed out over the level below. 8 m across.

    What a terrace is FOR. `region.py`'s finding was that a place can be full,
    reachable and correctly sparse and still be nothing to arrive at; an
    overlook is the cheapest possible answer -- a floor, a rail, and a reason
    to walk to the edge. It sits on the T2 coping line, so it replaces one
    `WL_Garden_Retaining_Run` in a terrace edge.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    R = 4.00
    SEG = 22
    # THE BOWL REACHES THE GROUND. It first stopped 0.80 m short, on the
    # reasoning that an overlook projects over the level below -- but that left
    # a module whose lowest geometry was at +0.80 m with nothing at z = 0, which
    # is a floating asset, not a cantilever. The validator's origin rule caught
    # it. A corbelled bowl rising from the lower level is also the more honest
    # structure: something has to carry 8 m of projecting floor.
    p.lathe([(0.0, 0.0), (R * 0.30, 0.55), (R * 0.42, TERRACE_Z - 1.90),
             (R * 0.78, TERRACE_Z - 1.05), (R * 0.96, TERRACE_Z - 0.50),
             (R, TERRACE_Z - 0.34)], segments=SEG, arc=180.0,
            matrix=M.xform((0, 0, 0), (0, 0, -90.0)), smooth=True)
    p.lathe([(0.0, TERRACE_Z - 0.34), (R + 0.30, TERRACE_Z - 0.34),
             (R + 0.30, TERRACE_Z - 0.12), (0.0, TERRACE_Z - 0.12)],
            segments=SEG, arc=180.0, matrix=M.xform((0, 0, 0), (0, 0, -90.0)),
            smooth=False)
    p.lathe([(0.0, TERRACE_Z - 0.12), (R + 0.16, TERRACE_Z - 0.12),
             (R + 0.16, TERRACE_Z), (0.0, TERRACE_Z)],
            segments=SEG, arc=180.0, matrix=M.xform((0, 0, 0), (0, 0, -90.0)),
            smooth=False)
    d.lathe([(0.0, TERRACE_Z), (R - 0.34, TERRACE_Z),
             (R - 0.34, TERRACE_Z + 0.05), (0.0, TERRACE_Z + 0.05)],
            segments=SEG, arc=180.0, matrix=M.xform((0, 0, 0), (0, 0, -90.0)),
            smooth=False)
    # the rail: the kit's own baluster on the arc
    n = 15
    for i in range(n + 1):
        a = math.radians(-90.0 + 180.0 * i / n)
        p.lathe([(0.0, 0.0), (0.10, 0.0), (0.085, 0.28), (0.16, 0.58),
                 (0.09, 1.05), (0.11, 1.42), (0.0, 1.60)], segments=8,
                smooth=True,
                matrix=M.xform((math.cos(a) * (R - 0.10), math.sin(a) * (R - 0.10),
                                TERRACE_Z)))
    p.lathe([(R - 0.32, TERRACE_Z + 1.60), (R + 0.12, TERRACE_Z + 1.60),
             (R + 0.12, TERRACE_Z + 1.86), (R - 0.32, TERRACE_Z + 1.86)],
            segments=SEG, arc=182.0, matrix=M.xform((0, 0, 0), (0, 0, -91.0)),
            smooth=False)
    for sgn in (-1.0, 1.0):
        p.box(0.86, 0.86, 2.30, at=(0.0, sgn * (R - 0.10), TERRACE_Z),
              chamfer=0.08, centre_z=False)
        E.finial(p, (0.0, sgn * (R - 0.10), TERRACE_Z + 2.30), 0.92,
                 radius=0.16, gold=g)
    return K.ModuleSpec(
        "WL_Garden_Overlook", "garden", "structure", "terrace",
        f.emit("WL_Garden_Overlook"),
        [K.Socket("bottom", 0.0, R + 0.30, "ground",
                  "the bowl reaches down to 0.80 m; the ground below is open"),
         K.Socket("top_route", TERRACE_Z, R - 0.34, "route",
                  "8 m semicircular floor at 3.10 m (T2), open on the -X side"),
         K.Socket("edge", TERRACE_Z, R, "edge", "the rail arc"),
         # THE PLANES ARE NAMED, because a generator laying a terrace edge has
         # to know that this module occupies exactly one 8.00 m run's worth of
         # it even though its bowl is 8.66 m across.
         K.Socket("end_a", 0.0, THICK * 0.5, "pier",
                  "the -Y end at y = %+.2f m; replaces one 8.00 m retaining "
                  "run in a terrace edge" % (-RUN * 0.5)),
         K.Socket("end_b", 0.0, THICK * 0.5, "pier",
                  "the +Y end at y = %+.2f m; the terrace edge carries on "
                  "from here" % (RUN * 0.5))],
        districts=("royal_garden", "water_garden", "plaza", "tea_terrace"),
        note="semicircular belvedere on a corbelled bowl, 8 m across, floor at "
             "T2; drops into a terrace edge in place of a retaining run",
        params={"radius_m": R, "floor_z_m": TERRACE_Z, "rung": "T2",
                "replaces": "WL_Garden_Retaining_Run"},
        tri_budget=20000, collision=True)


def garden_gate_threshold(f):
    """A pedestrian gate THROUGH a retaining wall. 8 m, same section as the run.

    A terrace you can only reach by going round it is a wall. This is a
    drop-in replacement for `WL_Garden_Retaining_Run` -- identical length,
    identical ends, identical coping height -- with a 2.4 m ogee opening and a
    short tunnel through the bank.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    v = f.part("veg_anchor")
    g = f.part("gold")
    SPAN, RISE, SPRING = 2.40, 1.05, 1.55
    ht = THICK * 0.5
    GATE_HALF = SPAN * 0.5 + 1.10
    for sgn in (-1.0, 1.0):
        seg = RUN * 0.5 - GATE_HALF
        _retaining_face(p, d, v, seg, x0=sgn * (GATE_HALF + seg * 0.5))
    for sgn in (-1.0, 1.0):
        p.box(1.10, THICK + BATTER, SPRING, at=(sgn * (SPAN * 0.5 + 0.55), -BATTER * 0.5, 0.0),
              chamfer=0.09, centre_z=False)
    E.arch_band(p, SPAN, RISE, THICK + BATTER, 0.42,
                at=(0.0, -BATTER * 0.5, SPRING), kind="ogee", steps=13, keystone=True)
    E.arched_wall(p, SPAN, RISE, TERRACE_Z - 0.34 - SPRING, GATE_HALF,
                  THICK + BATTER, kind="ogee", steps=13, thickness=0.42,
                  at=(0.0, -BATTER * 0.5, SPRING))
    d.box(SPAN - 0.10, THICK * 0.5, SPRING + RISE - 0.20,
          at=(0.0, ht * 0.4, 0.0), centre_z=False)
    p.box(SPAN + 2.20, THICK + 0.44, 0.22, at=(0.0, -0.10, TERRACE_Z - 0.34),
          chamfer=0.05, centre_z=False)
    p.box(SPAN + 2.20, THICK + 0.26, 0.06, at=(0.0, -0.04, TERRACE_Z - 0.12),
          chamfer=0.03, centre_z=False)
    d.box(SPAN + 2.00, THICK * 0.72, 0.06, at=(0.0, THICK * 0.15, TERRACE_Z - 0.06),
          centre_z=False)
    for sgn in (-1.0, 1.0):
        E.pinnacle(p, (sgn * (SPAN * 0.5 + 0.55), -0.10, TERRACE_Z), 1.60, 0.24, gold=g)
    return K.ModuleSpec(
        "WL_Garden_Gate_Threshold", "garden", "structure", "threshold",
        f.emit("WL_Garden_Gate_Threshold"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("passage", 0.0, SPAN * 0.5, "pier",
                  "2.40 m clear, 1.55 m to the springing, 2.60 m to the crown"),
         K.Socket("top_route", TERRACE_Z, RUN * 0.5, "route", "T2 terrace carries over"),
         K.Socket("edge", TERRACE_Z, RUN * 0.5, "edge", "coping at 3.10 m"),
         K.Socket("end_a", 0.0, THICK * 0.5, "pier", "x = -4.00 m, same section as the run"),
         K.Socket("end_b", 0.0, THICK * 0.5, "pier", "x = +4.00 m, same section as the run")],
        districts=("royal_garden", "water_garden", "tea_terrace", "grove"),
        note="drop-in replacement for a retaining run with a 2.40 m ogee "
             "pedestrian gate through the bank; identical length, ends and coping",
        params={"length_m": RUN, "opening_m": SPAN, "retains_m": TERRACE_Z,
                "rung": "T2", "arch": "ogee"},
        tri_budget=14000, collision=True)


def garden_pavilion_base(f):
    """An octagonal raised platform, 9 m across, floor at T2. The upper court.

    The top of the sequence. A pavilion, a tea house or a small belvedere
    stands on this, and the module publishes a `tower` socket on the XL rung
    at its floor -- so anything from the TOWER family can stand on a garden
    terrace, which is the join that lets the two kits meet.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    R = 4.50
    p.prism(M.ngon(8, R + 0.42, phase=math.pi / 8.0), 0.34, z0=0.0)
    p.prism(M.ngon(8, R + 0.22, phase=math.pi / 8.0), TERRACE_Z - 0.34 - 0.34,
            z0=0.34)
    E.string_course(p, TERRACE_Z - 0.34, (R + 0.30) * 0.9239,
                    run=M.CORNICE_CORBEL, segments=8)
    p.prism(M.ngon(8, R + 0.34, phase=math.pi / 8.0), 0.16, z0=TERRACE_Z - 0.22)
    p.prism(M.ngon(8, R, phase=math.pi / 8.0), 0.06, z0=TERRACE_Z - 0.06)
    E.wear_course(d, TERRACE_Z, poly=M.ngon(8, R - 0.30, phase=math.pi / 8.0),
                  thickness=0.05)
    for i, (x, y, a) in enumerate(K.radial(8, R - 0.16, phase=math.pi / 8.0)):
        if i == 0:
            continue                    # the way in
        p.box(0.62, 0.62, 0.94, at=(x, y, TERRACE_Z), rot=(0, 0, a),
              chamfer=0.07, centre_z=False)
    return K.ModuleSpec(
        "WL_Garden_Pavilion_Base", "garden", "structure", "terrace",
        f.emit("WL_Garden_Pavilion_Base"),
        [K.Socket("bottom", 0.0, R + 0.42, "ground"),
         K.Socket("top_route", TERRACE_Z, R, "route",
                  "9 m octagonal floor at 3.10 m (T2); the +X face is open"),
         K.Socket("top", TERRACE_Z, K.LADDER["XL"], "tower",
                  "an XL-rung tower foot may stand here -- the join between "
                  "the garden kit and the tower kit"),
         K.Socket("edge", TERRACE_Z, R, "edge", "seven kerb blocks; the eighth bay is the entry")],
        districts=("royal_garden", "tea_terrace", "water_garden", "plaza"),
        note="octagonal raised court, 9 m across, floor at T2, with an XL "
             "tower socket -- a pavilion or a small tower stands on it",
        params={"radius_m": R, "sides": 8, "floor_z_m": TERRACE_Z,
                "rung": "T2", "carries": "XL tower foot"},
        tri_budget=12000, collision=True)


BUILDERS = (
    garden_retaining_run, garden_retaining_corner_in,
    garden_retaining_corner_out, garden_retaining_curved,
    garden_planter_wall, garden_overlook, garden_gate_threshold,
    garden_pavilion_base,
)
