"""Detail modules: the pieces that attach to something else and change it.

WHY A DETAIL FAMILY EXISTS AT ALL. The towers family already carries balconies,
corbel tables and pinnacles INSIDE its modules, because a body with a balcony
is a different body. But the generator also needs to add those things to
geometry it did not get from this kit -- the existing `assets_v2` towers, the
castle kit, a wall -- and it needs them at ground level, in runs, along a path.

The reference makes the case better than an argument does. Its FOREGROUND, the
part nearest the camera and therefore the part most responsible for how the
image reads, is: a balustrade with newel posts carrying gold urns, running out
of both edges of frame. Not a landmark. Not architecture. A repeated detail at
eye height, and it is doing more work in that picture than any single tower.

Every module here is a RUN or a CLIP-ON:

  a run      butts end to end into any length (`end_a`/`end_b` pier sockets at
             the same z, the same section, no taper)
  a clip-on  publishes a `bridge_end` socket naming the face it attaches to,
             so the generator can put it on a shaft it did not author
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

XL, L, MD, S = K.LADDER["XL"], K.LADDER["L"], K.LADDER["M"], K.LADDER["S"]


def detail_balustrade_run(f):
    """8 m of balustrade with a newel at each end. The reference's foreground.

    Twenty-one turned balusters, a moulded coping, a plinth, and a newel post
    at each end carrying a gold urn -- which is precisely what stands either
    side of the path in the founder image, and what the eye actually reads the
    scene's scale against.

    It is a RUN: both ends are square, both newels are half-newels, and the
    section is identical at each end, so two of these butt into 16 m and
    sixteen into 128 m with no seam.
    """
    p = f.part("stone")
    g = f.part("gold")
    LEN, H = 8.0, 1.32
    p.box(LEN, 0.62, 0.22, at=(0.0, 0.0, 0.0), chamfer=0.05, centre_z=False)
    p.box(LEN, 0.50, 0.16, at=(0.0, 0.0, 0.22), chamfer=0.04, centre_z=False)
    for i in range(21):
        x = -LEN * 0.5 + 0.30 + (LEN - 0.60) * i / 20.0
        p.lathe([(0.0, 0.0), (0.098, 0.0), (0.082, 0.10), (0.070, 0.18),
                 (0.128, 0.34), (0.106, 0.46), (0.062, 0.62), (0.074, 0.74),
                 (0.052, 0.82), (0.0, 0.86)], segments=9, smooth=True,
                matrix=M.xform((x, 0.0, 0.38)))
    p.box(LEN, 0.44, 0.13, at=(0.0, 0.0, 1.24), chamfer=0.035, centre_z=False)
    p.box(LEN, 0.52, 0.09, at=(0.0, 0.0, 1.15), chamfer=0.028, centre_z=False)
    for sgn in (-1.0, 1.0):
        x = sgn * LEN * 0.5
        p.box(0.30, 0.72, 1.37, at=(x, 0.0, 0.0), chamfer=0.05, centre_z=False)
    return K.ModuleSpec(
        "WL_Detail_Balustrade_Run", "balustrade", "prop", "detail",
        f.emit("WL_Detail_Balustrade_Run"),
        [K.Socket("bottom", 0.0, LEN * 0.5, "ground"),
         K.Socket("end_a", 0.0, 0.36, "pier", "square section at x = -4.0 m; butts to another run"),
         K.Socket("end_b", 0.0, 0.36, "pier", "square section at x = +4.0 m; butts to another run")],
        districts=("royal_garden", "plaza", "tea_terrace", "water_garden", "city"),
        note="8 m run, 21 turned balusters, square butt ends; the reference's foreground rail",
        params={"length_m": LEN, "balusters": 21, "rail_z_m": H},
        tri_budget=9000, collision=True)


def detail_newel_urn(f):
    """A newel post carrying a gold urn. 2.9 m. The full stop on a run.

    In the founder image these punctuate the balustrade at every change of
    direction and at the head of every flight of steps, and their gold catches
    more light than anything else at that depth. Separate from the run because
    the run needs one only where it ENDS -- putting one every 8 m would read
    as a fence.
    """
    p = f.part("stone")
    g = f.part("gold")
    H = 2.92
    p.box(1.05, 1.05, 0.24, at=(0.0, 0.0, 0.0), chamfer=0.055, centre_z=False)
    p.box(0.92, 0.92, 0.18, at=(0.0, 0.0, 0.24), chamfer=0.04, centre_z=False)
    p.box(0.80, 0.80, 1.34, at=(0.0, 0.0, 0.42), chamfer=0.05, centre_z=False)
    for sgn in (-1.0, 1.0):
        for axis in (0, 1):
            at = (sgn * 0.385, 0.0, 0.62) if axis == 0 else (0.0, sgn * 0.385, 0.62)
            p.box(0.40 if axis else 0.06, 0.06 if axis else 0.40, 0.94,
                  at=at, chamfer=0.014, centre_z=False)
    p.lathe(M.moulding(0.44, 1.76, ((0.10, 0.0), (0.03, 0.09), (-0.04, 0.09),
                                    (-0.05, 0.05))), segments=14)
    p.box(0.94, 0.94, 0.16, at=(0.0, 0.0, 1.99), chamfer=0.035, centre_z=False)
    g.lathe([(0.0, 2.15), (0.24, 2.15), (0.20, 2.24), (0.34, 2.34), (0.42, 2.52),
             (0.36, 2.70), (0.22, 2.80), (0.26, 2.86), (0.14, 2.90), (0.0, 2.92)],
            segments=18, smooth=True)
    for (x, y, a) in K.radial(2, 0.40, phase=0.0):
        g.sweep([(x * 0.92, y * 0.92, 2.56), (x * 1.36, y * 1.36, 2.66),
                 (x * 1.30, y * 1.30, 2.80), (x * 0.86, y * 0.86, 2.78)],
                [0.045] * 4, sides=4, cap=False)
    return K.ModuleSpec(
        "WL_Detail_Newel_Urn", "balustrade", "prop", "detail",
        f.emit("WL_Detail_Newel_Urn"),
        [K.Socket("bottom", 0.0, 0.53, "ground"),
         K.Socket("end_a", 0.0, 0.40, "pier", "a balustrade run butts on any face")],
        districts=("royal_garden", "plaza", "tea_terrace", "water_garden"),
        note="panelled newel with a two-handled gold urn; the punctuation on a balustrade",
        params={"urn": "gold, two handles"}, tri_budget=4000, collision=True)


def detail_screen_filigree(f):
    """A free-standing gold screen: 5.2 m of lattice between stone posts.

    The run version of `WL_Gatehouse_Screen`'s leaves. The reference's gold
    lattice does not stop at the gate -- it runs along the garden's edge, and
    that run is what makes the gold read as a BOUNDARY rather than an object.
    Butt ends, so any length.
    """
    p = f.part("stone")
    g = f.part("gold")
    ga = f.part("gold_aged")
    v = f.part("veg_anchor")
    LEN, PANEL_H = 5.20, 4.40
    H = 6.30
    for sgn in (-1.0, 1.0):
        x = sgn * LEN * 0.5
        p.box(0.86, 0.86, 0.30, at=(x, 0.0, 0.0), chamfer=0.07, centre_z=False)
        p.box(0.70, 0.70, 5.05, at=(x, 0.0, 0.30), chamfer=0.06, centre_z=False)
        p.box(0.90, 0.90, 0.20, at=(x, 0.0, 5.35), chamfer=0.045, centre_z=False)
        E.pinnacle(p, (x, 0.0, 5.55), 0.75, 0.16, gold=g)
        v.box(0.48, 0.09, 4.30, at=(x, -0.31, 0.42), centre_z=False)
    E.filigree_panel(g, LEN - 0.80, PANEL_H, at=(0.0, 0.0, 0.55 + PANEL_H * 0.5),
                     bar=0.085, cells_x=3, cells_y=3)
    ga.box(LEN - 0.72, 0.24, 0.24, at=(0.0, 0.0, 0.55 + PANEL_H),
           chamfer=0.05, centre_z=False)
    E.arch_band(g, LEN - 0.90, 0.80, 0.26, 0.20, at=(0.0, 0.0, 0.55 + PANEL_H + 0.24),
                kind="ogee", steps=13)
    return K.ModuleSpec(
        "WL_Detail_Screen_Filigree", "screen", "structure", "screen",
        f.emit("WL_Detail_Screen_Filigree"),
        [K.Socket("bottom", 0.0, LEN * 0.5, "ground"),
         K.Socket("end_a", 0.0, 0.45, "pier", "post centre at x = -2.6 m; butts to another bay"),
         K.Socket("end_b", 0.0, 0.45, "pier", "post centre at x = +2.6 m; butts to another bay")],
        districts=("royal_garden", "plaza", "tea_terrace"),
        note="5.2 m gold lattice bay between posts, ogee head, ivy anchors; runs to any length",
        params={"length_m": LEN, "panel_h_m": PANEL_H}, tri_budget=42000,
        collision=True)


def detail_balcony_bracket(f):
    """A balcony that clips onto a flat wall face: 4.6 m wide, 2.4 m deep.

    The clip-on. `elements.balcony_ring` wraps a drum and is built into three
    tower bodies; this is the version for a WALL -- a gatehouse flank, a
    colonnade, one of the existing world's castle blocks. Its back face is
    flat and at y = 0, so the generator butts it to a surface and the corbels
    do the rest.
    """
    p = f.part("stone")
    W, D = 4.60, 2.40
    H = 3.35
    for i in range(5):
        x = -W * 0.5 + 0.55 + (W - 1.10) * i / 4.0
        p.prism([(-0.20, 0.0), (0.20, 0.0), (0.20, D * 0.72), (-0.20, D * 0.72)],
                0.42, z0=0.72, matrix=M.xform((x, 0.0, 0.0)))
        p.loft([[(x - 0.20, 0.0, 0.0), (x + 0.20, 0.0, 0.0),
                 (x + 0.20, 0.10, 0.0), (x - 0.20, 0.10, 0.0)],
                [(x - 0.20, 0.0, 0.72), (x + 0.20, 0.0, 0.72),
                 (x + 0.20, D * 0.72, 0.72), (x - 0.20, D * 0.72, 0.72)]],
               smooth=False)
    p.box(W, D, 0.26, at=(0.0, D * 0.5, 1.14), chamfer=0.05, centre_z=False)
    p.box(W + 0.24, D + 0.12, 0.12, at=(0.0, D * 0.5 - 0.06, 1.40),
          chamfer=0.03, centre_z=False)
    edge = ([(-W * 0.5 + 0.16 + (W - 0.32) * i / 12.0, D - 0.16) for i in range(13)]
            + [(W * 0.5 - 0.16, D - 0.16 - (D - 0.32) * i / 5.0) for i in range(1, 6)]
            + [(-W * 0.5 + 0.16, D - 0.16 - (D - 0.32) * i / 5.0) for i in range(1, 6)])
    for (bx, by) in edge:
        p.lathe([(0.0, 0.0), (0.075, 0.0), (0.062, 0.14), (0.105, 0.30),
                 (0.058, 0.56), (0.070, 0.72), (0.0, 0.82)], segments=8,
                smooth=True, matrix=M.xform((bx, by, 1.52)))
    p.box(W - 0.16, 0.20, 0.14, at=(0.0, D - 0.16, 2.34), chamfer=0.035,
          centre_z=False)
    for sgn in (-1.0, 1.0):
        p.box(0.20, D - 0.32, 0.14, at=(sgn * (W * 0.5 - 0.16), D * 0.5 - 0.08, 2.34),
              chamfer=0.035, centre_z=False)
    return K.ModuleSpec(
        "WL_Detail_Balcony_Bracket", "balcony", "prop", "detail",
        f.emit("WL_Detail_Balcony_Bracket"),
        [K.Socket("back", 0.0, W * 0.5, "bridge_end",
                  "the back face is flat at y = 0; butt it to any wall")],
        districts=("city", "hamlet", "tea_terrace", "castle"),
        note="wall-mounted balcony on five corbels, 4.6 x 2.4 m, flat back at y = 0",
        params={"width_m": W, "depth_m": D}, tri_budget=14000, collision=True)


def detail_pinnacle_grand(f):
    """A 9.4 m free-standing pinnacle on a stepped plinth.

    A parapet accent at landmark scale, and the cheapest vertical in the kit.
    Four of these on the corners of a wide roof do what a spire does for a
    tower: they give a flat top a set of points, and points are what the eye
    reads a skyline by.
    """
    p = f.part("stone")
    r = f.part("roof")
    g = f.part("gold")
    H = 9.4
    for (w, z, h) in ((2.40, 0.00, 0.34), (2.10, 0.34, 0.30), (1.82, 0.64, 0.28)):
        p.box(w, w, h, at=(0.0, 0.0, z), chamfer=w * 0.045, centre_z=False)
    p.box(1.58, 1.58, 2.35, at=(0.0, 0.0, 0.92), chamfer=0.09, centre_z=False)
    for sgn in (-1.0, 1.0):
        for axis in (0, 1):
            at = (sgn * 0.76, 0.0, 1.20) if axis == 0 else (0.0, sgn * 0.76, 1.20)
            E.arch_band(p, 0.90, 0.52, 0.14, 0.14, at=at,
                        rot=(0.0, 0.0, 0.0 if axis == 0 else 90.0),
                        kind="ogee", steps=9)
    E.string_course(p, 3.27, 0.90, run=M.CORNICE_CORBEL, segments=4,
                    matrix=M.xform((0, 0, 0), (0, 0, 45.0)))
    p.box(1.90, 1.90, 0.22, at=(0.0, 0.0, 3.85), chamfer=0.05, centre_z=False)
    for (x, y, a) in K.radial(4, 0.78, phase=math.pi / 4.0):
        E.pinnacle(p, (x, y, 4.07), 2.30, 0.20, gold=g)
    r.lathe(M.needle(0.92, 4.10, steps=7, concavity=0.40, z0=4.07), segments=8,
            smooth=True)
    for (x, y, a) in K.radial(4, 0.60):
        r.box(0.07, 0.07, 2.40, at=(x, y, 4.20), rot=(0, 0, a), centre_z=False)
    E.finial(p, (0.0, 0.0, 8.05), 1.35, radius=0.20, gold=g)
    return K.ModuleSpec(
        "WL_Detail_Pinnacle_Grand", "pinnacle", "structure", "detail",
        f.emit("WL_Detail_Pinnacle_Grand"),
        [K.Socket("bottom", 0.0, 1.20, "ground")],
        districts=("castle", "city", "cloister", "plaza"),
        note="9.4 m free-standing pinnacle, four subordinate pinnacles, ogee blind arches",
        params={"subordinates": 4}, tri_budget=9000, collision=True)


def detail_oriel_bay(f):
    """A three-sided glazed oriel on a corbel, for a flat wall. 6.1 m.

    The clip-on version of `WL_Tower_Mid_Oriel`'s bays. It projects, it is
    glazed with the emissive amber, and it has a small conical roof -- so one
    of these turns a blank wall into a facade with a front door's worth of
    incident, at a tenth of a tower's cost.
    """
    p = f.part("stone")
    r = f.part("roof_alt")
    g = f.part("gold")
    gl = f.part("glass")
    W, D = 3.20, 1.85
    H = 6.10
    p.lathe([(0.0, 0.00), (0.75, 0.42), (1.15, 0.95), (1.28, 1.55)],
            segments=12, arc=200.0, matrix=M.xform((0.0, 0.0, 0.0), (0.0, 0.0, -100.0)),
            smooth=True)
    plan = [(-W * 0.5, 0.0), (-W * 0.30, D), (W * 0.30, D), (W * 0.5, 0.0)]
    p.prism(plan, 3.05, z0=1.55)
    gplan = [(-W * 0.5 + 0.20, 0.06), (-W * 0.30 + 0.12, D - 0.14),
             (W * 0.30 - 0.12, D - 0.14), (W * 0.5 - 0.20, 0.06)]
    gl.prism(gplan, 2.30, z0=1.95)
    p.box(0.16, D * 0.9, 2.45, at=(0.0, D * 0.55, 1.90), chamfer=0.035,
          centre_z=False)
    p.box(W + 0.30, 0.20, 0.22, at=(0.0, 0.0, 4.60), chamfer=0.05, centre_z=False)
    p.prism([(-W * 0.5 - 0.16, -0.04), (-W * 0.30 - 0.14, D + 0.16),
             (W * 0.30 + 0.14, D + 0.16), (W * 0.5 + 0.16, -0.04)],
            0.22, z0=4.60)
    r.loft([[(-W * 0.5 - 0.16, -0.04, 4.82), (-W * 0.30 - 0.14, D + 0.16, 4.82),
             (W * 0.30 + 0.14, D + 0.16, 4.82), (W * 0.5 + 0.16, -0.04, 4.82)],
            [(-0.22, 0.10, 5.90), (-0.16, D * 0.55, 5.90),
             (0.16, D * 0.55, 5.90), (0.22, 0.10, 5.90)]], smooth=False)
    E.finial(p, (0.0, D * 0.34, 5.85), 0.55, radius=0.10, gold=g)
    return K.ModuleSpec(
        "WL_Detail_Oriel_Bay", "oriel", "prop", "detail",
        f.emit("WL_Detail_Oriel_Bay"),
        [K.Socket("back", 0.0, W * 0.5, "bridge_end",
                  "the back face is flat at y = 0; butt it to any wall")],
        districts=("hamlet", "city", "tea_terrace", "clock"),
        note="three-sided glazed oriel on a half-round corbel, conical roof, flat back",
        params={"width_m": W, "projection_m": D}, tri_budget=6000, collision=True)


BUILDERS = (
    detail_balustrade_run, detail_newel_urn, detail_screen_filigree,
    detail_balcony_bracket, detail_pinnacle_grand, detail_oriel_bay,
)
