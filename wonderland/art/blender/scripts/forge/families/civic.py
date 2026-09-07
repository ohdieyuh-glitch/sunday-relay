"""Colonnades and bridges: the horizontals.

THE REFERENCE GAP, and it is a different one from the towers'. Look at what
the founder image does with HORIZONTAL structure. Its foreground is a
balustraded terrace running out of both sides of frame. Its middle distance
has a long arcaded wall. Its city has walkways and bridges crossing between
towers at height, so the skyline is not a set of separate objects but a
CONNECTED thing.

`WORLD_LEDGER.md`'s PASS 38 entry names the same problem from the other end:
`bridge_arc` exists and was classed as a `prop` beside the garden benches
until the classifier was repaired. One bridge is a prop. A bridge FAMILY is a
transport system, and it is what turns a district of towers into a city.

Two rules this family is built to:

1. **A SPAN IS A MODULE WITH TWO ENDS.** Every bridge here publishes
   `bridge_end` sockets at both ends at a stated deck height, so the generator
   can look for two towers roughly that far apart at roughly that height and
   join them. A bridge that only works where it was hand-placed is scenery.

2. **YOU CAN WALK ON IT.** Decks are at least 3.2 m clear and the rails are
   1.05 m, because `walkable.py` and `route.py` audit the world's traversal
   and a bridge that fails them adds nothing a painted backdrop would not.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

XL, L, MD, S = K.LADDER["XL"], K.LADDER["L"], K.LADDER["M"], K.LADDER["S"]


# ==========================================================================
# COLONNADES
# ==========================================================================


def colonnade_straight(f):
    """Seven bays of trabeated colonnade, 21.6 m long, 7.4 m tall.

    The plainest module in the whole kit and one of the most useful. PASS 30's
    South Reach ends on nineteen columns on an arc "so the world's southern
    edge is a made line rather than a fade" -- that instinct is right and it
    had to be assembled from single columns. This is the run, authored once.
    """
    p = f.part("stone")
    BAYS, BAY = 7, 3.00
    LEN = BAYS * BAY
    H = 7.4
    p.box(LEN + 1.2, 3.30, 0.42, at=(0.0, 0.0, 0.0), chamfer=0.10, centre_z=False)
    p.box(LEN + 0.7, 2.95, 0.34, at=(0.0, 0.0, 0.42), chamfer=0.08, centre_z=False)
    for i in range(BAYS + 1):
        x = -LEN * 0.5 + BAY * i
        E.column(p, (x, 0.0, 0.76), 5.35, 0.42, flutes=12)
    p.box(LEN + 1.0, 2.10, 0.52, at=(0.0, 0.0, 6.11), chamfer=0.10, centre_z=False)
    for i in range(BAYS * 3 + 2):
        x = -LEN * 0.5 - 0.3 + (LEN + 0.6) * i / float(BAYS * 3 + 1)
        p.box(0.34, 2.36, 0.30, at=(x, 0.0, 6.63), chamfer=0.06, centre_z=False)
    p.box(LEN + 1.5, 2.52, 0.44, at=(0.0, 0.0, 6.93), chamfer=0.11, centre_z=False)
    p.box(LEN + 1.1, 2.20, 0.42, at=(0.0, 0.0, 7.37), chamfer=0.09, centre_z=False)
    return K.ModuleSpec(
        "WL_Colonnade_Straight", "colonnade", "structure", "screen",
        f.emit("WL_Colonnade_Straight"),
        [K.Socket("bottom", 0.0, LEN * 0.5, "ground"),
         K.Socket("end_a", 0.0, 1.65, "pier", "butts against the next run at x = -10.8 m"),
         K.Socket("end_b", 0.0, 1.65, "pier", "butts against the next run at x = +10.8 m")],
        districts=("plaza", "cloister", "royal_garden", "city"),
        note="seven-bay trabeated run with dentils; butts end to end into any length",
        params={"bays": BAYS, "bay_m": BAY, "length_m": LEN}, tri_budget=22000,
        collision=True)


def colonnade_arcade(f):
    """Six arched bays under a balustraded walkway, 21.6 m long, 10.6 m tall.

    The two-storey version, and the one that answers the reference's middle
    distance: arcade below, terrace above, so the wall has a line you can
    stand on. Because the top is walkable it is also a legitimate landing for
    `WL_Bridge_Sky`.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    BAYS, BAY = 6, 3.60
    LEN = BAYS * BAY
    SPRING, RISE = 5.10, 1.55
    DECK = 8.05
    H = 10.6
    p.box(LEN + 1.4, 3.80, 0.55, at=(0.0, 0.0, 0.0), chamfer=0.12, centre_z=False)
    for i in range(BAYS + 1):
        x = -LEN * 0.5 + BAY * i
        p.box(1.05, 3.30, SPRING - 0.55, at=(x, 0.0, 0.55), chamfer=0.12,
              centre_z=False)
        E.column(p, (x, -1.20, 0.55), SPRING - 0.75, 0.34, flutes=8)
    for i in range(BAYS):
        x = -LEN * 0.5 + BAY * (i + 0.5)
        E.arch_band(p, BAY - 1.05, RISE, 3.30, 0.55, at=(x, 0.0, SPRING),
                    kind="round", steps=11, keystone=True)
        d.box(BAY - 1.10, 1.10, 0.60, at=(x, 0.0, SPRING - 0.05), centre_z=False)
        E.arched_wall(p, BAY - 1.05, RISE, DECK - SPRING - 0.55, BAY * 0.5,
                      3.10, kind="round", steps=11, thickness=0.55,
                      at=(x, 0.0, SPRING))
    p.box(LEN + 1.2, 4.20, 0.46, at=(0.0, 0.0, DECK - 0.46), chamfer=0.10,
          centre_z=False)
    for sgn in (-1.0, 1.0):
        for i in range(BAYS * 4 + 1):
            x = -LEN * 0.5 + LEN * i / float(BAYS * 4)
            p.lathe([(0.0, 0.0), (0.10, 0.0), (0.085, 0.28), (0.16, 0.58),
                     (0.09, 1.05), (0.11, 1.42), (0.0, 1.60)], segments=8,
                    smooth=True, matrix=M.xform((x, sgn * 1.86, DECK)))
        p.box(LEN + 0.8, 0.42, 0.28, at=(0.0, sgn * 1.86, DECK + 1.60),
              chamfer=0.06, centre_z=False)
    return K.ModuleSpec(
        "WL_Colonnade_Arcade", "colonnade", "structure", "screen",
        f.emit("WL_Colonnade_Arcade"),
        [K.Socket("bottom", 0.0, LEN * 0.5, "ground"),
         K.Socket("deck", DECK, LEN * 0.5, "bridge_end",
                  "walkable terrace at 8.05 m; a legal landing for a skybridge"),
         K.Socket("end_a", 0.0, 1.90, "pier", "butts at x = -10.8 m"),
         K.Socket("end_b", 0.0, 1.90, "pier", "butts at x = +10.8 m")],
        districts=("city", "plaza", "cloister", "water_garden"),
        note="six round bays under a balustraded walkway; the wall you can stand on",
        params={"bays": BAYS, "bay_m": BAY, "deck_z_m": DECK}, tri_budget=48000,
        collision=True)


def colonnade_curved(f):
    """A 60-degree arc of colonnade on a 24 m radius: six of these close a circle.

    Straight runs make squares. The reference's plazas are ROUND, and PASS 30
    built its South Ring from eight arches on a circle by hand. Six of these
    are an exact circle, which means a generator can make a colonnaded plaza
    from one module and a rotation.
    """
    p = f.part("stone")
    R = 24.0
    ARC, BAYS = 60.0, 7
    H = 7.8
    step = math.radians(ARC) / BAYS
    a0 = -math.radians(ARC) * 0.5
    p.lathe([(R - 1.75, 0.0), (R + 1.75, 0.0), (R + 1.75, 0.46), (R - 1.75, 0.46)],
            segments=BAYS * 4, arc=ARC + 4.0,
            matrix=M.xform((0, 0, 0), (0, 0, -ARC * 0.5 - 2.0)), smooth=False)
    for i in range(BAYS + 1):
        a = a0 + step * i
        E.column(p, (math.cos(a) * R, math.sin(a) * R, 0.46), 5.60, 0.42, flutes=12)
    for (r_in, r_out, z, h) in ((R - 1.05, R + 1.05, 6.06, 0.50),
                                (R - 1.30, R + 1.30, 6.56, 0.42),
                                (R - 1.10, R + 1.10, 6.98, 0.40)):
        p.lathe([(r_in, z), (r_out, z), (r_out, z + h), (r_in, z + h)],
                segments=BAYS * 5, arc=ARC + 3.0,
                matrix=M.xform((0, 0, 0), (0, 0, -ARC * 0.5 - 1.5)), smooth=False)
    for i in range(BAYS * 3 + 1):
        a = a0 + math.radians(ARC) * i / float(BAYS * 3)
        p.box(0.32, 2.30, 0.30, at=(math.cos(a) * R, math.sin(a) * R, 6.56),
              rot=(0, 0, math.degrees(a) + 90.0), chamfer=0.06, centre_z=False)
    return K.ModuleSpec(
        "WL_Colonnade_Curved", "colonnade", "structure", "screen",
        f.emit("WL_Colonnade_Curved"),
        [K.Socket("bottom", 0.0, R + 1.9, "ground"),
         K.Socket("end_a", 0.0, 1.9, "pier", "60 degrees of a 24 m circle; six close it")],
        districts=("plaza", "royal_garden", "cloister"),
        note="60-degree colonnade segment on a 24 m radius; six make a round plaza",
        params={"radius_m": R, "arc_deg": ARC, "bays": BAYS}, tri_budget=26000,
        collision=True)


# ==========================================================================
# BRIDGES
# ==========================================================================


def bridge_arc(f):
    """A single 18 m segmental span with balustrades. The ground-level crossing.

    Segmental rather than semicircular on purpose: an 18 m semicircular arch
    would put its crown 9 m up and its deck with it, and the Dog would be
    climbing a hill to cross a stream. A 3.6 m rise crosses the same gap with a
    deck the walkable audit accepts.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    SPAN, RISE, W = 18.0, 3.6, 5.2
    DECK = 5.30
    for sgn in (-1.0, 1.0):
        p.box(3.60, W + 1.6, 2.30, at=(sgn * (SPAN * 0.5 + 1.5), 0.0, 0.0),
              chamfer=0.24, centre_z=False)
    E.arch_band(p, SPAN, RISE, W, 1.15, at=(0.0, 0.0, 1.70), kind="round", steps=17,
                keystone=True)
    d.box(SPAN * 0.94, W * 0.42, 0.70, at=(0.0, 0.0, 1.66), centre_z=False)
    E.arched_wall(p, SPAN, RISE, DECK - 1.70, SPAN * 0.5 + 3.0, W * 0.86,
                  kind="round", steps=17, thickness=1.15, at=(0.0, 0.0, 1.70))
    p.box(SPAN + 7.0, W + 0.9, 0.46, at=(0.0, 0.0, DECK - 0.46), chamfer=0.10,
          centre_z=False)
    for sgn in (-1.0, 1.0):
        for i in range(23):
            x = -(SPAN * 0.5 + 2.9) + (SPAN + 5.8) * i / 22.0
            p.lathe([(0.0, 0.0), (0.115, 0.0), (0.095, 0.30), (0.175, 0.62),
                     (0.10, 1.10), (0.12, 1.48), (0.0, 1.66)], segments=8,
                    smooth=True, matrix=M.xform((x, sgn * (W * 0.5 + 0.18), DECK)))
        p.box(SPAN + 6.4, 0.46, 0.30, at=(0.0, sgn * (W * 0.5 + 0.18), DECK + 1.66),
              chamfer=0.07, centre_z=False)
        p.box(0.86, 0.86, 2.35, at=(-(SPAN * 0.5 + 2.9), sgn * (W * 0.5 + 0.18), DECK),
              chamfer=0.10, centre_z=False)
        p.box(0.86, 0.86, 2.35, at=(SPAN * 0.5 + 2.9, sgn * (W * 0.5 + 0.18), DECK),
              chamfer=0.10, centre_z=False)
    return K.ModuleSpec(
        "WL_Bridge_Arc", "bridge", "structure", "span",
        f.emit("WL_Bridge_Arc"),
        [K.Socket("bottom", 0.0, SPAN * 0.5 + 3.5, "ground"),
         K.Socket("end_a", DECK, W * 0.5, "bridge_end", "deck lands at x = -12.5 m, z = 5.30 m"),
         K.Socket("end_b", DECK, W * 0.5, "bridge_end", "deck lands at x = +12.5 m, z = 5.30 m")],
        districts=("water_garden", "royal_garden", "city", "grove"),
        note="18 m segmental span, 5.2 m deck, balustraded, newels at both ends",
        params={"span_m": SPAN, "rise_m": RISE, "deck_z_m": DECK},
        tri_budget=40000, collision=True)


def bridge_sky(f):
    """A 32 m skybridge with a mid-pier lantern, deck at 26 m. Tower to tower.

    The module the current world has no equivalent of at all, and the one that
    changes a skyline most per triangle. Two towers side by side are two
    objects; two towers with a bridge between them are a CITY, and the reading
    costs one slender module.

    Its ends are `bridge_end` sockets 4.02 m above the module's own soffit,
    and the module -- like every other module in the kit -- sits with its
    lowest geometry at z = 0. It was first authored at its intended 26 m and
    that was wrong: 26 m is a fact about the TOWERS it joins, not about the
    bridge, and baking it in gave the kit one asset whose origin meant
    something different from all the others.
    """
    p = f.part("stone")
    g = f.part("gold")
    gl = f.part("glass")
    SPAN, W, DECK = 32.0, 3.40, 4.02
    SAG = 2.6
    n = 15
    soffit = []
    for i in range(n + 1):
        t = -1.0 + 2.0 * i / n
        soffit.append((t * SPAN * 0.5, 0.0, DECK - 0.80 - SAG * (1.0 - t * t)))
    p.sweep(soffit, [0.62] * (n + 1), sides=6, cap=True)
    for sgn in (-1.0, 1.0):
        p.sweep([(x, sgn * W * 0.42, z) for (x, _, z) in soffit],
                [0.30] * (n + 1), sides=5, cap=True)
    for i in range(1, n):
        x, _, z = soffit[i]
        p.box(0.30, W * 0.94, DECK - 0.46 - z, at=(x, 0.0, z), chamfer=0.06,
              centre_z=False)
    p.box(SPAN, W + 0.5, 0.46, at=(0.0, 0.0, DECK - 0.46), chamfer=0.09,
          centre_z=False)
    for sgn in (-1.0, 1.0):
        for i in range(27):
            x = -SPAN * 0.48 + SPAN * 0.96 * i / 26.0
            p.box(0.15, 0.15, 1.05, at=(x, sgn * (W * 0.5 + 0.12), DECK),
                  chamfer=0.03, centre_z=False)
        p.box(SPAN * 0.98, 0.30, 0.20, at=(0.0, sgn * (W * 0.5 + 0.12), DECK + 1.05),
              chamfer=0.05, centre_z=False)
        p.box(SPAN * 0.98, 0.20, 0.14, at=(0.0, sgn * (W * 0.5 + 0.12), DECK + 0.52),
              chamfer=0.03, centre_z=False)
    # the mid-pier lantern: a bridge this long needs an event at its centre
    p.box(2.90, W + 1.5, 0.50, at=(0.0, 0.0, DECK), chamfer=0.10, centre_z=False)
    for (x, y, a) in K.radial(6, 1.15):
        p.box(0.26, 0.26, 3.10, at=(x, y, DECK + 0.50), rot=(0, 0, a),
              chamfer=0.05, centre_z=False)
    gl.lathe([(1.00, DECK + 0.60), (1.00, DECK + 3.40)], segments=14, smooth=True,
             cap_bottom=False, cap_top=False)
    f.part("roof").lathe(M.needle(1.42, 3.60, steps=6, concavity=0.34,
                                  z0=DECK + 3.60), segments=14, smooth=True)
    E.finial(p, (0.0, 0.0, DECK + 6.90), 1.10, radius=0.20, gold=g)
    return K.ModuleSpec(
        "WL_Bridge_Sky", "bridge", "structure", "span",
        f.emit("WL_Bridge_Sky"),
        [K.Socket("end_a", DECK, W * 0.5, "bridge_end",
                  "deck at 4.02 m local; lands on a shaft face at x = -16 m"),
         K.Socket("end_b", DECK, W * 0.5, "bridge_end",
                  "deck at 4.02 m local; lands on a shaft face at x = +16 m"),
         K.Socket("lantern", DECK + 6.9, 0.0, "crown", "the mid-span lantern's apex")],
        districts=("city", "plaza", "castle", "clock"),
        note="32 m tower-to-tower span with a glazed mid-span lantern; deck 4.02 m above its own soffit",
        params={"span_m": SPAN, "deck_z_local_m": DECK, "sag_m": SAG,
                "place_at": "set the module origin at (tower deck z - 4.02 m)"},
        tri_budget=34000, collision=True)


def bridge_flying(f):
    """A flying buttress: a 12 m raking half-arch with a pinnacled pier.

    Not a walkway -- a brace. It leans against a tower and puts a diagonal in
    a skyline made almost entirely of verticals and horizontals, which is the
    cheapest way to stop a district reading as a bar chart. Two or three
    against one tall tower is the reference's own cathedral-quarter look.
    """
    p = f.part("stone")
    g = f.part("gold")
    REACH, TOP, FOOT = 12.0, 17.5, 4.0
    p.box(3.10, 3.10, 1.05, at=(REACH, 0.0, 0.0), chamfer=0.22, centre_z=False)
    p.box(2.70, 2.70, FOOT - 1.05, at=(REACH, 0.0, 1.05), chamfer=0.16,
          centre_z=False)
    E.string_course(p, FOOT - 0.34, 1.72, run=M.CORNICE_CORBEL, segments=4,
                    matrix=M.xform((REACH, 0.0, 0.0), (0.0, 0.0, 45.0)))
    p.box(2.95, 2.95, 0.40, at=(REACH, 0.0, FOOT), chamfer=0.12, centre_z=False)
    E.pinnacle(p, (REACH, 0.0, FOOT + 0.40), 7.20, 0.90, gold=g)
    n = 13
    upper, lower = [], []
    for i in range(n + 1):
        t = i / float(n)
        x = REACH * (1.0 - t)
        z = FOOT + 0.90 + (TOP - FOOT - 0.90) * (1.0 - (1.0 - t) ** 1.75)
        upper.append((x, 0.0, z))
        lower.append((x, 0.0, z - 1.35 - 0.9 * math.sin(math.pi * t) ** 0.7))
    p.sweep(upper, [0.46] * (n + 1), sides=5, cap=True)
    p.sweep(lower, [0.34] * (n + 1), sides=5, cap=True)
    for i in range(1, n, 2):
        ux, _, uz = upper[i]
        lx, _, lz = lower[i]
        p.box(0.34, 0.90, uz - lz, at=(ux, 0.0, lz), chamfer=0.06, centre_z=False)
    p.box(1.90, 2.10, 2.30, at=(0.30, 0.0, TOP - 1.5), chamfer=0.14, centre_z=False)
    return K.ModuleSpec(
        "WL_Bridge_Flying", "bridge", "structure", "span",
        f.emit("WL_Bridge_Flying"),
        [K.Socket("bottom", 0.0, 1.6, "ground", "the outer pier stands at x = +12 m"),
         K.Socket("end_a", 0.0, 1.05, "bridge_end",
                  "the head bears on a shaft face at x = 0, z = 16.0-17.5 m")],
        districts=("castle", "city", "cloister"),
        note="raking half-arch brace with a pinnacled outer pier; the kit's only diagonal",
        params={"reach_m": REACH, "bearing_z_m": TOP}, tri_budget=18000,
        collision=True)


BUILDERS = (
    colonnade_straight, colonnade_arcade, colonnade_curved,
    bridge_arc, bridge_sky, bridge_flying,
)
