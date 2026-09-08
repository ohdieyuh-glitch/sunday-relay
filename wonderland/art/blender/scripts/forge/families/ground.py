"""The made surface: kerbs, steps, runnels, a medallion. Ground with SHAPE.

THE GAP, and it is worth stating what it is NOT. The world's ground is a
material, and for a flat surface a material is the right answer -- a paving
field modelled as 128 individual slabs would cost hundreds of triangles per
8 m tile to say something `MI_V2_PlazaCream` already says, laid hundreds of
times. This family deliberately contains no flat paving.

What a material cannot do is RELIEF. A kerb is 15 cm of shadow that separates
a walk from a road; a runnel is the line that says a surface sheds water; a
single step is where two levels meet and the only honest way to meet them; a
medallion is why a plaza has a centre. Every one of those is geometry, all of
it is cheap, and none of it exists in this kit or in `assets_v2`.

THE SHARED NUMBERS, all of them already in use elsewhere:

    RUN     8.00 m   == the retaining run, the balustrade run, the canal unit,
                        so a kerb, a terrace edge and a canal lie on one rhythm
    riser   0.310 m  every level change here is one or three of them
    PAVE    0.310 m  the walked surface sits one riser above the datum, which
                     is the same level the water family's paving sits at

MATERIALS. Four new part keys -- `paving`, `paving_warm`, `paving_shade` and
`kerb` -- mapping to `MI_V2_PlazaCream`, `MI_V2_PlazaWarm`, `MI_V2_PlazaShade`
and `MI_V2_Kerb`, all of which `materials_v2.py` already defines. Reaching for
`stone` instead would have made a plaza slab the same surface as a tower shaft,
which is the one thing the V2 palette went out of its way to separate.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

RUN = 8.00                      # the kit's module length
RISER = K.RISER_M
PAVE = K.RISER_M                # the walked surface, one riser off the datum


def _slabs(part, alt, w, d, at=(0.0, 0.0), z=0.0, cols=4, rows=2, joint=0.02,
           bed=None, rot=0.0):
    """A laid surface as a FEW large slabs, alternating tint. Cheap on purpose.

    Four by two rather than sixteen by eight: the joint pattern is the
    material's job and the geometry's job is to be a surface with an edge. Each
    slab is a plain box, no chamfer, because a 2 cm joint already draws the
    line an arris would.

    `z` is the WALKED SURFACE and the slabs hang 9 cm below it. Pass `bed` (a
    part) to fill from the ground datum up to the slabs' underside: without it
    a module's paving is a shelf floating over daylight, which is fine once
    terrain is under it and looks broken in a contact sheet.
    """
    made = []
    sw, sd = (w - joint * (cols - 1)) / cols, (d - joint * (rows - 1)) / rows
    mat = M.xform((0.0, 0.0, 0.0), (0.0, 0.0, rot))
    if bed is not None and z - 0.09 > 0.001:
        made += bed.box(w, d, z - 0.09, at=(at[0], at[1], 0.0), matrix=mat,
                        centre_z=False)
    for i in range(cols):
        for j in range(rows):
            x = at[0] - w * 0.5 + sw * 0.5 + i * (sw + joint)
            y = at[1] - d * 0.5 + sd * 0.5 + j * (sd + joint)
            p = part if (i + j) % 2 == 0 else alt
            made += p.box(sw, sd, 0.09, at=(x, y, z - 0.09), matrix=mat,
                          centre_z=False)
    return made


def ground_kerb_run(f):
    """8 m of kerb and gutter. The edge of the made surface. 0.31 m.

    THE MOST REPEATED THING IN ANY CITY and the cheapest module in this kit:
    a kerb, a dished gutter beside it, and the paving behind. It is 15 cm of
    shadow, and 15 cm of shadow is the whole difference between a street and a
    field with buildings on it.
    """
    k = f.part("kerb")
    p = f.part("paving")
    pw = f.part("paving_warm")
    d = f.part("paving_shade")
    WALK = 2.40
    k.box(RUN, 0.34, PAVE, at=(0.0, 0.0, 0.0), chamfer=0.035, centre_z=False)
    # the gutter: a dished channel, one slab wide, in the shade tint
    d.loft([[(-RUN * 0.5, -0.17, 0.0), (RUN * 0.5, -0.17, 0.0),
             (RUN * 0.5, -0.62, 0.0), (-RUN * 0.5, -0.62, 0.0)],
            [(-RUN * 0.5, -0.17, 0.10), (RUN * 0.5, -0.17, 0.10),
             (RUN * 0.5, -0.62, 0.16), (-RUN * 0.5, -0.62, 0.16)]], smooth=False)
    _slabs(p, pw, RUN, WALK, at=(0.0, 0.17 + WALK * 0.5), z=PAVE, cols=4,
           rows=2, bed=d)
    return K.ModuleSpec(
        "WL_Ground_Kerb_Run", "ground", "structure", "terrace",
        f.emit("WL_Ground_Kerb_Run"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("walk", PAVE, WALK * 0.5, "route",
                  "the paved walk at %.3f m (one riser), +Y of the kerb" % PAVE),
         K.Socket("edge", PAVE, RUN * 0.5, "edge",
                  "the kerb line; a balustrade or a bollard run follows it"),
         K.Socket("end_a", 0.0, 0.30, "pier", "butts at x = -4.00 m"),
         K.Socket("end_b", 0.0, 0.30, "pier", "butts at x = +4.00 m")],
        districts=("city", "plaza", "hamlet", "castle", "clock"),
        note="8.00 m kerb with a dished gutter and 2.40 m of laid walk behind "
             "it; the same length as the retaining and balustrade runs",
        params={"length_m": RUN, "walk_m": WALK, "kerb_m": PAVE,
                "gutter": "dished, MI_V2_PlazaShade"},
        tri_budget=1200, collision=True)


def ground_kerb_corner(f):
    """The kerb turning 90 degrees, on a swept quadrant. 0.31 m.

    A kerb that turns a corner with a mitre reads as two kerbs meeting; a kerb
    that turns on a radius reads as a kerb. The radius is 1.60 m, which is what
    a cart needs and what the eye expects.
    """
    k = f.part("kerb")
    p = f.part("paving")
    d = f.part("paving_shade")
    R = 1.60
    ARM = RUN * 0.5
    HT, WALK = 0.17, 2.40
    #: THE ARC IS CENTRED ON (R, R), NOT ON THE ORIGIN, and that is the whole
    #: geometry of a street corner: the kerb runs along y = 0, turns through a
    #: quadrant whose centre is INSIDE the walk, and leaves along x = 0. Curved
    #: about the origin instead, the kerb bulges into the road and the walk
    #: behind it overlaps both arms -- 1.42 m2 of two up-facing surfaces in one
    #: plane, four times over.
    turn = M.xform((R, R, 0.0), (0.0, 0.0, 180.0))
    for rot in (0.0, 90.0):
        # `rot=` on a box turns it about its OWN CENTRE; the rotation belongs
        # in the matrix, which is applied to the placement.
        k.box(ARM - R, HT * 2.0, PAVE, at=((R + ARM) * 0.5, 0.0, 0.0),
              matrix=M.xform((0.0, 0.0, 0.0), (0.0, 0.0, rot)),
              chamfer=0.035, centre_z=False)
    # the section CLOSES on itself, so the swept tube needs no pie back to the
    # axis -- see the `loop` guard in `mesh.lathe`
    k.lathe([(R - HT, 0.0), (R + HT, 0.0), (R + HT, PAVE), (R - HT, PAVE),
             (R - HT, 0.0)], segments=10, arc=90.0, matrix=turn, smooth=False)

    # TWO CONVEX PIECES, NOT ONE L. The walk is an L with a rounded inner
    # corner, and an L is concave at its elbow. `Part.prism` caps a polygon
    # with a single n-gon, and a concave n-gon's cap came back as a black
    # quadrant under the magenta test -- black, so two surfaces rather than a
    # hole. Split at the elbow and both halves are convex; they BUTT rather
    # than overlap, and because their faces differ in size neither is dropped
    # as a duplicate.
    ELBOW = HT + WALK
    arm_x = [(ELBOW, HT), (ARM, HT), (ARM, ELBOW), (ELBOW, ELBOW)]
    rest = [(ELBOW, HT), (ELBOW, ARM), (HT, ARM), (HT, R)]
    for i in range(9):
        a = math.pi + math.pi * 0.5 * i / 8.0
        rest.append((R + (R - HT) * math.cos(a), R + (R - HT) * math.sin(a)))
    rest.append((R, HT))
    for poly in (arm_x, rest):
        d.prism(poly, PAVE - 0.09, z0=0.0)
        p.prism(poly, 0.09, z0=PAVE - 0.09)
    return K.ModuleSpec(
        "WL_Ground_Kerb_Corner", "ground", "structure", "terrace",
        f.emit("WL_Ground_Kerb_Corner"),
        [K.Socket("bottom", 0.0, ARM + 2.20, "ground"),
         K.Socket("walk", PAVE, WALK * 0.5, "route",
                  "the %.2f m walk turns the corner behind the kerb" % WALK),
         K.Socket("end_a", 0.0, 0.30, "pier",
                  "arm along +X ends at x = +%.2f m" % ARM),
         K.Socket("end_b", 0.0, 0.30, "pier",
                  "arm along +Y ends at y = +%.2f m" % ARM)],
        districts=("city", "plaza", "hamlet", "castle"),
        note="90-degree kerb corner on a 1.60 m radius with two 4.00 m arms; "
             "butts a kerb run either way",
        params={"radius_m": R, "arm_m": ARM, "turn_deg": 90.0},
        tri_budget=1600, collision=True)


def ground_step_single(f):
    """One riser across 8 m: the joint between two paved levels. 0.31 m.

    THE MODULE THAT MAKES A PLAZA A COMPOSITION. A single step is what a
    designer uses when two areas should be distinct without being separate --
    you cross it without deciding to, and the surface reads as two rooms
    anyway. The kit has flights for climbing and nothing at all for this.
    """
    p = f.part("paving")
    pw = f.part("paving_warm")
    k = f.part("kerb")
    d = f.part("paving_shade")
    GOING = 0.44
    k.box(RUN, GOING, PAVE + RISER, at=(0.0, 0.0, 0.0), chamfer=0.03,
          centre_z=False)
    # THE NOSING STANDS PROUD. Flush with the tread it shared a plane with it,
    # and this kit's own rule is that a laid course is never flush.
    E.wear_course(d, PAVE + RISER, w=RUN - 0.06, d=0.07, thickness=0.05,
                  at=(0.0, -GOING * 0.5 + 0.05))
    _slabs(p, pw, RUN, 2.20, at=(0.0, -GOING * 0.5 - 1.10), z=PAVE, cols=4,
           rows=1, bed=d)
    _slabs(p, pw, RUN, 2.20, at=(0.0, GOING * 0.5 + 1.10), z=PAVE + RISER,
           cols=4, rows=1, bed=d)
    return K.ModuleSpec(
        "WL_Ground_Step_Single", "ground", "structure", "route",
        f.emit("WL_Ground_Step_Single"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("bottom_route", PAVE, RUN * 0.5, "route",
                  "the lower surface, one riser off the datum"),
         K.Socket("top_route", PAVE + RISER, RUN * 0.5, "route",
                  "the upper surface, two risers off the datum"),
         K.Socket("end_a", 0.0, GOING * 0.5, "pier", "butts at x = -4.00 m"),
         K.Socket("end_b", 0.0, GOING * 0.5, "pier", "butts at x = +4.00 m")],
        districts=("plaza", "city", "royal_garden", "tea_terrace", "cloister"),
        note="a single 0.310 m riser across 8.00 m with a shade-tint nosing "
             "and laid surfaces at both levels",
        params={"length_m": RUN, "risers": 1, "riser_m": RISER,
                "going_m": GOING},
        tri_budget=1400, collision=True)


def ground_steps_broad(f):
    """Three risers across 8 m, walked rather than climbed. 0.93 m.

    A change of level you barely notice you made, which is what a garden and a
    plaza want and what a flight is too steep for. The going is 0.90 m -- 19
    degrees against the 41 of a stair -- so this is a place to stand as much as
    a way up, and the reference's foreground is full of exactly that.
    """
    p = f.part("paving")
    pw = f.part("paving_warm")
    k = f.part("kerb")
    d = f.part("paving_shade")
    GOING, N = 0.90, 3
    # the flight starts at the PAVING level, not at the datum: a laid surface
    # hangs 9 cm below the walked one, so a lower route at z = 0 would put
    # slabs under the ground datum with nothing declaring an excavation
    for i in range(N):
        depth = GOING * (N - i) + 0.06
        k.box(RUN, depth, PAVE + RISER * i,
              at=(0.0, depth * 0.5 - 0.06 - GOING * i, 0.0),
              chamfer=0.03, centre_z=False)
        E.wear_course(d, PAVE + RISER * i, w=RUN - 0.06, d=0.07,
                      thickness=0.04, at=(0.0, -GOING * i - 0.02))
    _slabs(p, pw, RUN, 2.20, at=(0.0, -GOING * (N - 1) - 1.20), z=PAVE,
           cols=4, rows=1, bed=d)
    _slabs(p, pw, RUN, 2.20, at=(0.0, GOING * 1.4 + 1.10), z=PAVE + RISER * N,
           cols=4, rows=1, bed=d)
    return K.ModuleSpec(
        "WL_Ground_Steps_Broad", "ground", "structure", "route",
        f.emit("WL_Ground_Steps_Broad"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("bottom_route", PAVE, RUN * 0.5, "route",
                  "the lower surface, one riser off the datum"),
         K.Socket("top_route", PAVE + RISER * N, RUN * 0.5, "route",
                  "%.2f m up: four risers off the datum, three above the "
                  "lower surface" % (PAVE + RISER * N)),
         K.Socket("end_a", 0.0, GOING * 0.5, "pier", "butts at x = -4.00 m"),
         K.Socket("end_b", 0.0, GOING * 0.5, "pier", "butts at x = +4.00 m")],
        districts=("plaza", "royal_garden", "tea_terrace", "cloister", "city"),
        note="three 0.310 m risers on a 0.90 m going across 8.00 m: 19 degrees, "
             "a place to stand as much as a way up",
        params={"length_m": RUN, "risers": N, "riser_m": RISER,
                "going_m": GOING,
                "pitch_deg": round(math.degrees(math.atan2(RISER, GOING)), 1)},
        tri_budget=2600, collision=True)


def ground_plaza_medallion(f):
    """A 9 m inlaid disc: the reason a plaza has a centre. 0.10 m.

    A plaza without a centre is a gap between buildings. This is the cheapest
    thing that fixes that -- a moulded rim, two bands of shade-tint inlay and a
    radial figure, all within 10 cm of the ground, so it costs a shadow and
    reads from a tower.
    """
    p = f.part("paving")
    pw = f.part("paving_warm")
    d = f.part("paving_shade")
    k = f.part("kerb")
    g = f.part("gold")
    R = 4.50
    k.lathe([(R - 0.28, 0.0), (R, 0.0), (R, 0.10), (R - 0.28, 0.10)],
            segments=40, smooth=False)
    p.lathe([(0.0, 0.0), (R - 0.28, 0.0), (R - 0.28, 0.06), (0.0, 0.06)],
            segments=40, smooth=False)
    # THE BANDS STEP. Both at one height they put two up-facing discs in the
    # same plane -- `lathe` caps a closed section, so each band carries a full
    # disc, not an annulus, and the inner one lay inside the outer one's.
    for i, (r0, r1) in enumerate(((R - 1.10, R - 0.92), (R - 2.60, R - 2.42))):
        top = 0.072 + 0.006 * i
        d.lathe([(r0, 0.06), (r1, 0.06), (r1, top), (r0, top)],
                segments=40, smooth=False)
    for (x, y, a) in K.radial(16, (R - 1.76)):
        pw.box(1.30, 0.30, 0.025, at=(x, y, 0.06), rot=(0.0, 0.0, a),
               centre_z=False)
    g.lathe([(0.0, 0.06), (0.62, 0.06), (0.62, 0.095), (0.0, 0.095)],
            segments=24, smooth=False)
    return K.ModuleSpec(
        "WL_Ground_Plaza_Medallion", "ground", "prop", "detail",
        f.emit("WL_Ground_Plaza_Medallion"),
        [K.Socket("bottom", 0.0, R, "ground"),
         K.Socket("edge", 0.10, R, "edge",
                  "the moulded rim; paving butts to it at any bearing")],
        districts=("plaza", "royal_garden", "cloister", "city"),
        note="9.00 m inlaid medallion, 0.10 m proud: a moulded rim, two shade "
             "bands, a sixteen-ray figure and a gold centre",
        params={"diameter_m": R * 2.0, "rays": 16, "proud_m": 0.10},
        tri_budget=3000, collision=False)


def ground_verge_run(f):
    """8 m of planted verge between two kerbs. 0.31 m.

    The strip a street has between its walk and its wall, and the module that
    lets the world session PLANT a street rather than scatter on it. The
    planting itself is `veg_anchor` and is not modelled here, for the reason
    the whole kit gives: `assets_v2._leaf_shell` is better than anything this
    session would write.
    """
    k = f.part("kerb")
    v = f.part("veg_anchor")
    d = f.part("paving_shade")
    W = 1.80
    for sgn in (-1.0, 1.0):
        k.box(RUN, 0.28, PAVE, at=(0.0, sgn * (W * 0.5 + 0.14), 0.0),
              chamfer=0.03, centre_z=False)
    d.box(RUN, W, 0.10, at=(0.0, 0.0, 0.0), centre_z=False)
    v.box(RUN - 0.10, W - 0.16, 0.13, at=(0.0, 0.0, 0.10), centre_z=False)
    return K.ModuleSpec(
        "WL_Ground_Verge_Run", "ground", "structure", "terrace",
        f.emit("WL_Ground_Verge_Run"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("edge", PAVE, W * 0.5 + 0.28, "edge",
                  "the two kerb lines, %.2f m apart" % (W + 0.56)),
         K.Socket("end_a", 0.0, W * 0.5 + 0.28, "pier", "butts at x = -4.00 m"),
         K.Socket("end_b", 0.0, W * 0.5 + 0.28, "pier", "butts at x = +4.00 m")],
        districts=("city", "plaza", "hamlet", "royal_garden", "grove"),
        note="8.00 m planted verge between two kerbs; the surface is "
             "veg_anchor and the world session plants it",
        params={"length_m": RUN, "width_m": W,
                "planting": "veg_anchor, not modelled"},
        tri_budget=700, collision=True)


def ground_drain_channel(f):
    """8 m of runnel with grated covers. 0.31 m.

    The detail that says a surface is MADE rather than found. A plaza that does
    not shed water is a floor; a runnel down the middle of one is a decision
    somebody took, and at three metres it is the only thing in this family a
    walking camera will actually read.
    """
    p = f.part("paving")
    pw = f.part("paving_warm")
    d = f.part("paving_shade")
    m = f.part("metal")
    CH = 0.34
    d.box(CH + 0.12, RUN, PAVE - 0.16, at=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 90.0),
          centre_z=False)
    d.loft([[(-RUN * 0.5, -CH * 0.5, PAVE - 0.16),
             (RUN * 0.5, -CH * 0.5, PAVE - 0.16),
             (RUN * 0.5, CH * 0.5, PAVE - 0.16),
             (-RUN * 0.5, CH * 0.5, PAVE - 0.16)],
            [(-RUN * 0.5, -CH * 0.5 - 0.06, PAVE),
             (RUN * 0.5, -CH * 0.5 - 0.06, PAVE),
             (RUN * 0.5, CH * 0.5 + 0.06, PAVE),
             (-RUN * 0.5, CH * 0.5 + 0.06, PAVE)]], smooth=False)
    for i in range(2):
        x = -RUN * 0.25 + RUN * 0.5 * i
        for b in range(7):
            m.box(0.86, 0.028, 0.03,
                  at=(x, -CH * 0.35 + CH * 0.7 * b / 6.0, PAVE - 0.035),
                  centre_z=False)
        for sgn in (-1.0, 1.0):
            m.box(0.90, 0.05, 0.05, at=(x, sgn * (CH * 0.5 + 0.02),
                                        PAVE - 0.058), centre_z=False)
    for sgn in (-1.0, 1.0):
        _slabs(p, pw, RUN, 2.20, at=(0.0, sgn * (CH * 0.5 + 1.16)), z=PAVE,
               cols=4, rows=1, bed=d)
    return K.ModuleSpec(
        "WL_Ground_Drain_Channel", "ground", "structure", "terrace",
        f.emit("WL_Ground_Drain_Channel"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("walk", PAVE, RUN * 0.5, "route",
                  "the paved surface at %.3f m, runnel down the middle" % PAVE),
         K.Socket("end_a", 0.0, CH * 0.5, "pier", "butts at x = -4.00 m"),
         K.Socket("end_b", 0.0, CH * 0.5, "pier", "butts at x = +4.00 m")],
        districts=("city", "plaza", "cloister", "castle"),
        note="8.00 m runnel with two bronze grates and laid paving each side; "
             "the detail that says a surface sheds water",
        params={"length_m": RUN, "channel_m": CH, "grates": 2},
        tri_budget=2000, collision=True)


def ground_tree_grate(f):
    """A 2.4 m opening in the paving with a moulded surround. 0.31 m.

    Where a street tree goes. The kit models no tree -- the world has better
    ones -- so this is the HOLE and the edge of it, with `veg_anchor` in the
    middle, which is the same division of labour every planted module here
    uses.
    """
    k = f.part("kerb")
    p = f.part("paving")
    pw = f.part("paving_warm")
    v = f.part("veg_anchor")
    d = f.part("paving_shade")
    A = 2.40
    OPEN = 1.40
    for (bw, bd, bx, by) in ((A, (A - OPEN) * 0.5, 0.0, (OPEN + (A - OPEN) * 0.5) * 0.5),
                             (A, (A - OPEN) * 0.5, 0.0, -(OPEN + (A - OPEN) * 0.5) * 0.5),
                             ((A - OPEN) * 0.5, OPEN, (OPEN + (A - OPEN) * 0.5) * 0.5, 0.0),
                             ((A - OPEN) * 0.5, OPEN, -(OPEN + (A - OPEN) * 0.5) * 0.5, 0.0)):
        k.box(bw, bd, PAVE, at=(bx, by, 0.0), chamfer=0.03, centre_z=False)
    d.box(OPEN, OPEN, 0.08, at=(0.0, 0.0, 0.0), centre_z=False)
    v.box(OPEN - 0.10, OPEN - 0.10, 0.11, at=(0.0, 0.0, 0.08), centre_z=False)
    for sgn in (-1.0, 1.0):
        _slabs(p, pw, 2.20, A, at=(sgn * (A * 0.5 + 1.10), 0.0), z=PAVE,
               cols=1, rows=2, bed=d)
    return K.ModuleSpec(
        "WL_Ground_Tree_Grate", "ground", "prop", "detail",
        f.emit("WL_Ground_Tree_Grate"),
        [K.Socket("bottom", 0.0, A * 0.5 + 2.2, "ground"),
         K.Socket("walk", PAVE, A * 0.5, "route",
                  "the paving around the opening, at %.3f m" % PAVE),
         K.Socket("edge", PAVE, A * 0.5, "edge",
                  "the surround; the %.2f m opening is inside it" % OPEN)],
        districts=("city", "plaza", "hamlet", "tea_terrace", "grove"),
        note="2.40 m tree surround with a 1.40 m opening; the planting is "
             "veg_anchor and the world session grows it",
        params={"surround_m": A, "opening_m": OPEN,
                "planting": "veg_anchor, not modelled"},
        tri_budget=900, collision=True)


BUILDERS = (
    ground_kerb_run, ground_kerb_corner, ground_step_single,
    ground_steps_broad, ground_plaza_medallion, ground_verge_run,
    ground_drain_channel, ground_tree_grate,
)
