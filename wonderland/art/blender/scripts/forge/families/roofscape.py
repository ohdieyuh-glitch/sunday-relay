"""Houses and roofs: the middle distance, which is most of any city.

THE REFERENCE GAP, and it is the one a tower kit cannot answer by being better
at towers. Between the founder reference's foreground garden and its skyline of
needles there is a whole BAND of small buildings — two and three storeys,
pitched roofs, dormers, chimneys, overhanging upper floors — and they occupy
more of the picture than the spires do. They are what makes the city look
inhabited rather than ceremonial.

Wonderland has a `hamlet` district and its roof vocabulary is a cone. Every
other module in this kit, including the two heroes, is a tower or a monument.
So a generator building the middle distance today has a choice between a
40 m tower and a garden bench.

WHAT MAKES A ROOFSCAPE, in the order it matters:

1. **RIDGES, NOT POINTS.** A cone has one silhouette from every bearing. A
   ridge has two completely different ones — a long low line down its length,
   a triangle across it — so a district of ridged roofs turned at various
   angles reads as many buildings, and a district of cones reads as one shape
   repeated. `elements.roof_ridged` takes a `ridge_frac`: 1.0 is a gable, less
   is a hip, and the two ends of every town.
2. **THE JETTY.** An upper storey that overhangs its lower one is the single
   most fairytale thing a small building can do, and it costs one extra box.
   It also throws a hard shadow across the storey below, which at middle
   distance is worth more than any amount of window detail.
3. **THINGS ON THE ROOF.** Dormers and chimneys break a roof plane and give it
   scale. They are clip-ons here, not baked in, so the generator can vary the
   count and the same body reads as a different building.

ALL THREE BODIES SHARE A FOOTPRINT MODULE of 6.4 x 5.2 m and eaves at fixed
heights, so a terrace of them lines up, and a dormer authored for one fits all
three.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

XL, L, MD, S = K.LADDER["XL"], K.LADDER["L"], K.LADDER["M"], K.LADDER["S"]

#: The shared plan. A town whose houses are all different sizes cannot be
#: assembled into a terrace, and a terrace is what a street is.
BAY_X, BAY_Y = 6.40, 5.20
STOREY = 3.05


def _storey(part, glass, z, w, d, windows=3, kind="ogee", plinth=False):
    """One storey: walls, a string course, and a row of windows in the +X face."""
    made = []
    # THE WALL STANDS ON THE PLINTH, it does not pass through it. Both boxes
    # starting at z put two down-facing faces in the ground plane -- hidden on
    # flat terrain, and a flickering pair the moment a module sits on a slope.
    base = z
    if plinth:
        made += part.box(w + 0.34, d + 0.34, 0.36, at=(0.0, 0.0, z),
                         chamfer=0.08, centre_z=False)
        base = z + 0.36
    made += part.box(w, d, z + STOREY - 0.18 - base, at=(0.0, 0.0, base),
                     chamfer=0.06, centre_z=False)
    for i in range(int(windows)):
        x = -w * 0.5 + w * (i + 0.5) / windows
        for dy in (-1.0, 1.0):
            E.window_arched(part, (x, dy * d * 0.5, z + 0.62), 0.80, 1.70,
                            depth=0.22, rot=(0.0, 0.0, 90.0 if dy > 0 else 270.0),
                            kind=kind, glass_part=glass)
    made += part.box(w + 0.22, d + 0.22, 0.18, at=(0.0, 0.0, z + STOREY - 0.18),
                     chamfer=0.045, centre_z=False)
    return made


def house_gabled(f):
    """Two storeys under a gable, 9.4 m. The town's default building.

    Deliberately the plainest thing in the kit after `WL_Tower_Mid_Ashlar`, and
    for the same reason: a street of events is noise. This is the quiet
    building that the jettied one and the shopfront are read against.
    """
    p = f.part("stone")
    r = f.part("roof")
    gl = f.part("glass")
    g = f.part("gold")
    _storey(p, gl, 0.0, BAY_X, BAY_Y, windows=2, plinth=True)
    _storey(p, gl, STOREY, BAY_X, BAY_Y, windows=3)
    E.roof_ridged(r, BAY_X, BAY_Y, 3.05, at=(0.0, 0.0, 2 * STOREY),
                  overhang=0.34, ridge_frac=1.0)
    for sgn in (-1.0, 1.0):
        p.box(0.34, 0.34, 0.90, at=(sgn * (BAY_X * 0.5 + 0.20), 0.0,
                                    2 * STOREY + 3.05 - 0.10),
              chamfer=0.07, centre_z=False)
        E.finial(p, (sgn * (BAY_X * 0.5 + 0.20), 0.0, 2 * STOREY + 3.85),
                 0.62, radius=0.11, gold=g)
    return K.ModuleSpec(
        "WL_House_Gabled", "house", "structure", "body",
        f.emit("WL_House_Gabled"),
        [K.Socket("bottom", 0.0, BAY_X * 0.5, "ground"),
         K.Socket("eaves", 2 * STOREY, BAY_X * 0.5, "bridge_end",
                  "eaves at 6.10 m; dormers and chimneys mount from here"),
         K.Socket("end_a", 0.0, BAY_Y * 0.5, "pier",
                  "gable wall at x = -3.20 m; butts into a terrace"),
         K.Socket("end_b", 0.0, BAY_Y * 0.5, "pier",
                  "gable wall at x = +3.20 m; butts into a terrace")],
        districts=("hamlet", "city", "tea_terrace", "grove"),
        note="two storeys under a full gable, 6.4 x 5.2 m plan, eaves at 6.10 m; "
             "the town's default building and the one a terrace is made of",
        params={"storeys": 2, "eaves_z_m": 2 * STOREY, "ridge_frac": 1.0,
                "plan_m": [BAY_X, BAY_Y]},
        tri_budget=12000, collision=True)


def house_hipped(f):
    """Three storeys under a hipped roof, 12.6 m. The corner building.

    A hip has no gable wall, so it does not need a neighbour to look finished —
    which is exactly what a corner or a free-standing house needs, and what a
    gable cannot do. Its third storey also gives a street a height it can vary
    against without changing module.
    """
    p = f.part("stone")
    r = f.part("roof_alt")
    gl = f.part("glass")
    g = f.part("gold")
    _storey(p, gl, 0.0, BAY_X, BAY_Y, windows=2, plinth=True)
    _storey(p, gl, STOREY, BAY_X, BAY_Y, windows=3)
    _storey(p, gl, 2 * STOREY, BAY_X * 0.97, BAY_Y * 0.97, windows=3, kind="round")
    E.roof_ridged(r, BAY_X, BAY_Y, 2.55, at=(0.0, 0.0, 3 * STOREY),
                  overhang=0.36, ridge_frac=0.42)
    p.box(0.62, 0.62, 1.90, at=(BAY_X * 0.22, BAY_Y * 0.20, 3 * STOREY + 1.30),
          chamfer=0.07, centre_z=False)
    p.box(0.84, 0.84, 0.22, at=(BAY_X * 0.22, BAY_Y * 0.20, 3 * STOREY + 3.20),
          chamfer=0.05, centre_z=False)
    E.finial(p, (0.0, 0.0, 3 * STOREY + 2.45), 0.72, radius=0.12, gold=g)
    return K.ModuleSpec(
        "WL_House_Hipped", "house", "structure", "body",
        f.emit("WL_House_Hipped"),
        [K.Socket("bottom", 0.0, BAY_X * 0.5, "ground"),
         K.Socket("eaves", 3 * STOREY, BAY_X * 0.5, "bridge_end",
                  "eaves at 9.15 m; dormers and chimneys mount from here"),
         K.Socket("end_a", 0.0, BAY_Y * 0.5, "pier", "x = -3.20 m"),
         K.Socket("end_b", 0.0, BAY_Y * 0.5, "pier", "x = +3.20 m")],
        districts=("hamlet", "city", "clock", "tea_terrace"),
        note="three storeys under a hip with a chimney; finished on all four "
             "sides, so it works free-standing or on a corner",
        params={"storeys": 3, "eaves_z_m": 3 * STOREY, "ridge_frac": 0.42,
                "plan_m": [BAY_X, BAY_Y]},
        tri_budget=16000, collision=True)


def house_jettied(f):
    """Two jettied storeys leaning out over the street, 11.2 m.

    THE FAIRYTALE ONE. Each floor oversails the one below on carved brackets,
    so the building leans over the street and its own wall is in three planes.
    It is the cheapest way in this whole kit to make a street feel narrow and
    old, and the reference's middle distance is full of them.

    Its ground floor is inset, so a terrace of these has a continuous covered
    walk at pavement level without any module knowing about the others.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    r = f.part("roof")
    gl = f.part("glass")
    g = f.part("gold")

    p.box(BAY_X * 0.90, BAY_Y * 0.90, 0.34, at=(0.0, 0.0, 0.0), chamfer=0.07,
          centre_z=False)
    # likewise: the recessed ground floor stands ON the plinth
    d.box(BAY_X * 0.86, BAY_Y * 0.86, STOREY - 0.34, at=(0.0, 0.0, 0.34),
          centre_z=False)
    for sgn in (-1.0, 1.0):
        for dy in (-1.0, 1.0):
            p.box(0.52, 0.52, STOREY, at=(sgn * BAY_X * 0.43, dy * BAY_Y * 0.43, 0.0),
                  chamfer=0.09, centre_z=False)
    for i, (z, w, dp, ov) in enumerate(((STOREY, BAY_X * 0.94, BAY_Y * 0.94, 0.34),
                                        (2 * STOREY, BAY_X, BAY_Y, 0.30))):
        for (bx, by, yaw) in _bracket_ring(w, dp):
            p.box(0.30, 0.30, 0.94, at=(bx * 0.88, by * 0.88, z - 0.94),
                  rot=(0.0, 0.0, yaw), chamfer=0.06, centre_z=False)
        # the jetty's fascia is the storey's own plinth, not a separate band.
        # As a band its top face landed in the same plane as the string course
        # of the storey below -- two up-facing faces at 6.10 m.
        _storey(p, gl, z, w, dp, windows=3 if i else 2,
                kind="ogee" if i else "round", plinth=True)
    E.roof_ridged(r, BAY_X, BAY_Y, 3.30, at=(0.0, 0.0, 3 * STOREY),
                  overhang=0.42, ridge_frac=1.0)
    for sgn in (-1.0, 1.0):
        E.finial(p, (sgn * (BAY_X * 0.5 + 0.30), 0.0, 3 * STOREY + 3.10),
                 0.78, radius=0.13, gold=g)
    return K.ModuleSpec(
        "WL_House_Jettied", "house", "structure", "body",
        f.emit("WL_House_Jettied"),
        [K.Socket("bottom", 0.0, BAY_X * 0.5, "ground"),
         K.Socket("eaves", 3 * STOREY, BAY_X * 0.5, "bridge_end",
                  "eaves at 9.15 m; dormers and chimneys mount from here"),
         K.Socket("end_a", 0.0, BAY_Y * 0.5, "pier", "x = -3.20 m"),
         K.Socket("end_b", 0.0, BAY_Y * 0.5, "pier", "x = +3.20 m")],
        districts=("hamlet", "tea_terrace", "city", "clock"),
        note="two oversailing storeys on brackets over an inset ground floor; "
             "the wall is in three planes and the street reads as narrow",
        params={"storeys": 3, "jetties": 2, "eaves_z_m": 3 * STOREY,
                "plan_m": [BAY_X, BAY_Y]},
        tri_budget=22000, collision=True)


def _bracket_ring(w, d):
    """Bracket positions round a rectangular plan, with their facing yaw."""
    out = []
    for i in range(3):
        x = -w * 0.5 + w * (i + 0.5) / 3.0
        out.append((x, -d * 0.5, 0.0))
        out.append((x, d * 0.5, 0.0))
    for j in range(2):
        y = -d * 0.5 + d * (j + 0.5) / 2.0
        out.append((-w * 0.5, y, 90.0))
        out.append((w * 0.5, y, 90.0))
    return out


def roof_dormer(f):
    """A gabled dormer that sits on a roof slope. 2.9 m.

    A clip-on, and the module that makes one house body read as five. Its foot
    is cut to a 45-degree slope, which is the pitch of every roof in this
    family (`roof_ridged` at height = half the span gives 45 degrees), so it
    beds into any of them without a gap.
    """
    p = f.part("stone")
    r = f.part("roof")
    gl = f.part("glass")
    W, D = 1.55, 1.70
    # the raking foot: a wedge whose top face is the 45-degree roof plane
    p.loft([[(-W * 0.5, -D * 0.5, 0.0), (W * 0.5, -D * 0.5, 0.0),
             (W * 0.5, D * 0.5, D), (-W * 0.5, D * 0.5, D)],
            [(-W * 0.5, -D * 0.5, 0.30), (W * 0.5, -D * 0.5, 0.30),
             (W * 0.5, D * 0.5, D + 0.30), (-W * 0.5, D * 0.5, D + 0.30)]],
           smooth=False)
    p.box(W, D * 0.92, 1.42, at=(0.0, -D * 0.04, 0.30), chamfer=0.05,
          centre_z=False)
    E.window_arched(p, (0.0, -D * 0.50, 0.52), 0.86, 1.05, depth=0.16,
                    rot=(0.0, 0.0, 270.0), kind="ogee", glass_part=gl)
    E.roof_ridged(r, D * 0.92, W, 0.86, at=(0.0, -D * 0.04, 1.72),
                  rot=(0.0, 0.0, 90.0), overhang=0.16, ridge_frac=1.0)
    return K.ModuleSpec(
        "WL_Roof_Dormer", "roof", "prop", "detail",
        f.emit("WL_Roof_Dormer"),
        [K.Socket("back", 0.0, W * 0.5, "bridge_end",
                  "the foot is cut to a 45-degree slope; beds into any roof in "
                  "this family, ridge across X")],
        districts=("hamlet", "city", "tea_terrace", "clock"),
        note="gabled dormer with an ogee light, foot cut to the family's 45-degree pitch",
        params={"pitch_deg": 45.0, "width_m": W}, tri_budget=4000)


def roof_chimney(f):
    """A four-flue chimney stack with a corbelled cap. 4.4 m.

    Chimneys are the reason a roofscape has verticals in it at all. Four flues
    rather than one because a single shaft reads as a post; a stack reads as a
    building that is lived in, and it is the same silhouette trick as
    `WL_Spire_Cluster` at a fiftieth of the size.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    W = 1.30
    p.loft([[(-W * 0.62, -W * 0.52, 0.0), (W * 0.62, -W * 0.52, 0.0),
             (W * 0.62, W * 0.52, 0.90), (-W * 0.62, W * 0.52, 0.90)],
            [(-W * 0.55, -W * 0.45, 1.05), (W * 0.55, -W * 0.45, 1.05),
             (W * 0.55, W * 0.45, 1.05), (-W * 0.55, W * 0.45, 1.05)]],
           smooth=False)
    p.box(W * 1.10, W * 0.90, 1.75, at=(0.0, 0.0, 1.05), chamfer=0.06,
          centre_z=False)
    for z in (1.60, 2.35):
        p.box(W * 1.18, W * 0.98, 0.12, at=(0.0, 0.0, z), chamfer=0.03,
              centre_z=False)
    E.string_course(p, 2.80, W * 0.86, run=M.CORNICE_CORBEL, segments=4,
                    matrix=M.xform((0, 0, 0), (0, 0, 45.0)))
    p.box(W * 1.34, W * 1.12, 0.24, at=(0.0, 0.0, 3.28), chamfer=0.05,
          centre_z=False)
    for (sx, sy) in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
        p.lathe([(0.20, 3.52), (0.20, 4.16), (0.24, 4.24), (0.18, 4.36)],
                segments=10, matrix=M.xform((sx * W * 0.38, sy * W * 0.28, 0.0)),
                smooth=False)
        d.lathe([(0.0, 4.26), (0.13, 4.26), (0.13, 4.34), (0.0, 4.34)],
                segments=8, matrix=M.xform((sx * W * 0.38, sy * W * 0.28, 0.0)))
    return K.ModuleSpec(
        "WL_Roof_Chimney", "roof", "prop", "detail",
        f.emit("WL_Roof_Chimney"),
        [K.Socket("back", 0.0, W * 0.62, "bridge_end",
                  "the foot rakes to the family's 45-degree pitch across Y")],
        districts=("hamlet", "city", "tea_terrace", "clock", "grove"),
        note="four-flue stack with a corbelled cap and open pots; raking foot",
        params={"flues": 4, "pitch_deg": 45.0}, tri_budget=6000)


def house_shopfront(f):
    """A ground-floor arcade that clips onto any house body. 3.4 m.

    A street of blank ground floors is a corridor. Three round-arched bays on
    columns, a fascia over them and a stall board below turn the same body into
    a shop — and because it is a clip-on rather than a variant body, the
    generator can put it on a gabled house, a hipped one, or every third house
    on a street.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    gl = f.part("glass")
    W, D = BAY_X, 1.05
    BAYS = 3
    p.box(W + 0.30, D + 0.24, 0.34, at=(0.0, D * 0.5, 0.0), chamfer=0.07,
          centre_z=False)
    for i in range(BAYS + 1):
        x = -W * 0.5 + W * i / BAYS
        E.column(p, (x, D * 0.62, 0.34), 1.95, 0.19, flutes=8)
    for i in range(BAYS):
        x = -W * 0.5 + W * (i + 0.5) / BAYS
        span = W / BAYS - 0.44
        E.arch_band(p, span, span * 0.5, D * 1.15, 0.24,
                    at=(x, D * 0.62, 2.29), kind="round", steps=9, keystone=True)
        d.box(span, D * 0.40, 1.95, at=(x, D * 0.30, 0.34), centre_z=False)
        gl.box(span * 0.90, 0.08, 1.30, at=(x, D * 0.86, 0.72), centre_z=False)
        p.box(span + 0.18, D * 0.62, 0.20, at=(x, D * 0.88, 0.62), chamfer=0.04,
              centre_z=False)
    p.box(W + 0.34, D * 1.30, 0.30, at=(0.0, D * 0.58, 2.96), chamfer=0.06,
          centre_z=False)
    p.box(W + 0.20, D * 1.10, 0.16, at=(0.0, D * 0.58, 3.26), chamfer=0.04,
          centre_z=False)
    for i in range(BAYS):
        x = -W * 0.5 + W * (i + 0.5) / BAYS
        E.filigree_panel(g, W / BAYS - 0.60, 0.34, at=(x, D * 1.16, 3.10),
                         bar=0.035, cells_x=2, cells_y=1, scroll=False)
    return K.ModuleSpec(
        "WL_House_Shopfront", "house", "structure", "detail",
        f.emit("WL_House_Shopfront"),
        [K.Socket("back", 0.0, W * 0.5, "bridge_end",
                  "flat back at y = 0; clips to any house body's +Y face")],
        districts=("hamlet", "city", "tea_terrace", "plaza"),
        note="three round-arched shop bays on columns with glazed stalls and a "
             "fascia; clips to any body in this family",
        params={"bays": BAYS, "width_m": W, "projection_m": D},
        tri_budget=16000, collision=True)


BUILDERS = (
    house_gabled, house_hipped, house_jettied,
    roof_dormer, roof_chimney, house_shopfront,
)
