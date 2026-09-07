"""The water garden: Wonderland's first architecture built around still water.

THE GAP, and it is one this kit created for itself. Both heroes are dry and
vertical. `MI_V2_Water` exists in `materials_v2.py` and this library had never
touched it. The world's `water_garden` quarter has nothing singular in it --
`region.py`'s definition of ground you can stand on with nothing to walk to.

WHY STILL WATER RATHER THAN A FOUNTAIN. `assets_v2.fountain_grand` is already
excellent, 15.9 m, three tiers, and its docstring records the arithmetic slip
that produced it. Building a second fountain would be the mistake this
repository's CLAUDE.md opens with. What the world has NO example of is water
used ARCHITECTURALLY -- a sheet of it held in a made edge, at a scale you walk
along rather than stand at.

That is the one thing water does that no stone can: it doubles the sky and
whatever stands beside it. A 34 m reflecting basin in front of the Great Spire
puts a second Great Spire under it for free, and no amount of masonry buys that.

HOW WATER IS BUILT HERE, and it is the same rule `assets_v2` set:

  * water is a SEPARATE MESH in a `water` part, so it takes `MI_V2_Water` and
    the stone does not (`fountain_grand` / `fountain_grand_water` is the
    precedent, and the reason is the one-material-slot rule)
  * every basin has REAL DEPTH under its surface -- a floor 0.55 m down and
    walls between -- so a transparent material has something to be transparent
    onto rather than a flat plane pretending
  * falling water is `water_lit` (`MI_V2_GlassTeal`, emissive 560 in V2), so a
    cascade reads at night without a light actor
  * the surface is FLAT and cheap. Ripple, flow and refraction are the
    material's job, and a mesh that tried to model them would fight it

ELEVATIONS. The basins sit on the route ladder like everything else, so a
cascade stair drops T2 (3.10 m) in the same ten risers the dry stairs use and
a water court is a terrace that happens to be wet.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

T1, T2 = K.ROUTE_LADDER["T1"], K.ROUTE_LADDER["T2"]
RISER = K.RISER_M

#: Freeboard: how far the water surface sits below the coping. 0.12 m reads as
#: a full basin; level with the coping reads as a flood, and 0.4 m as a sump.
FREEBOARD = 0.12
#: Depth of real geometry under every water surface in this family.
DEPTH = 0.55


def _basin(part, dark, water, w, d, at=(0.0, 0.0, 0.0), matrix=None, kerb=0.42):
    """A rectangular basin with a real floor, real walls and a flat lid.

    Returns the water surface z. The kerb stands 0.30 m proud so the basin
    reads as HELD -- a pool flush with its paving reads as a puddle.
    """
    mat = M.xform(at)
    if matrix is not None:
        mat = matrix @ mat
    hw, hd = w * 0.5, d * 0.5
    # the four kerbs
    for (bw, bd, bx, by) in ((w + kerb * 2.0, kerb, 0.0, hd + kerb * 0.5),
                             (w + kerb * 2.0, kerb, 0.0, -(hd + kerb * 0.5)),
                             (kerb, d, hw + kerb * 0.5, 0.0),
                             (kerb, d, -(hw + kerb * 0.5), 0.0)):
        part.box(bw, bd, 0.30, at=(bx, by, 0.0), matrix=mat, chamfer=0.05,
                 centre_z=False)
    # the tank: floor and four sides, DEPTH down
    dark.box(w, d, 0.10, at=(0.0, 0.0, -DEPTH), matrix=mat, centre_z=False)
    for (bw, bd, bx, by) in ((w, 0.16, 0.0, hd - 0.08), (w, 0.16, 0.0, -(hd - 0.08)),
                             (0.16, d, hw - 0.08, 0.0), (0.16, d, -(hw - 0.08), 0.0)):
        dark.box(bw, bd, DEPTH, at=(bx, by, -DEPTH), matrix=mat, centre_z=False)
    # the surface: one flat quad, and nothing else
    zw = 0.30 - FREEBOARD
    water.box(w - 0.06, d - 0.06, 0.04, at=(0.0, 0.0, zw - 0.04), matrix=mat,
              centre_z=False)
    return zw


def water_basin_reflecting(f):
    """THE HERO. A 34 x 9 m reflecting basin in a made edge. 3.4 m tall.

    The point of it is arithmetic, not ornament: a still sheet 34 m long
    doubles whatever stands at its head. Put `WL_Hero_GreatSpire` at one end
    and the composition is 236 m tall through the camera, and the second 118 m
    cost one flat quad.

    So everything here serves the reflection. The basin is LONG and NARROW
    (3.8:1) because a reflection needs run, not area. The kerb is low so the
    water reads from a standing eye. The flanking colonnade is deliberately
    open -- a solid wall would reflect as a solid wall and close the picture,
    where columns reflect as a rhythm and keep it deep. And the head is a
    raised court on the T1 rung, so the thing being doubled stands 1.55 m
    above the sheet doing the doubling.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    w = f.part("water")
    wl = f.part("water_lit")
    g = f.part("gold")
    W, D = 34.0, 9.0
    zw = _basin(p, d, w, W, D, kerb=0.52)

    # the head: a raised court at T1, where the reflected thing stands
    HEAD = W * 0.5 + 0.52 + 3.40
    p.box(6.80, D + 5.20, T1, at=(HEAD - 3.40, 0.0, 0.0), chamfer=0.10,
          centre_z=False)
    E.string_course(p, T1 - 0.26, 3.30, run=M.CORNICE_CORBEL, segments=4,
                    matrix=M.xform((HEAD - 3.40, 0.0, 0.0), (0.0, 0.0, 45.0)))
    p.box(7.30, D + 5.70, 0.22, at=(HEAD - 3.40, 0.0, T1), chamfer=0.05,
          centre_z=False)
    d.box(6.30, D + 4.70, 0.06, at=(HEAD - 3.40, 0.0, T1 + 0.22 - 0.08),
          centre_z=False)
    # five steps down from the head to the basin walk: the way in
    for i in range(5):
        p.box(0.44, D + 3.60, RISER, at=(HEAD - 6.90 - 0.44 * i, 0.0,
                                         T1 - RISER * (i + 1)),
              chamfer=0.03, centre_z=False)
    # a spillway at the head: the only moving water in the module
    for k in (-1.0, 1.0):
        wl.box(1.10, 0.30, T1 - zw + 0.20, at=(HEAD - 6.95, k * 2.40, zw - 0.10),
               centre_z=False)
        p.box(1.50, 0.62, 0.34, at=(HEAD - 6.95, k * 2.40, T1 - 0.34),
              chamfer=0.05, centre_z=False)

    # the flanking colonnades -- OPEN, so the reflection stays deep
    for sgn in (-1.0, 1.0):
        y = sgn * (D * 0.5 + 0.52 + 1.90)
        p.box(W + 1.60, 2.20, 0.34, at=(0.0, y, 0.0), chamfer=0.06, centre_z=False)
        for i in range(9):
            x = -W * 0.5 + W * i / 8.0
            E.column(p, (x, y, 0.34), 4.20, 0.34, flutes=10)
        p.box(W + 1.20, 1.30, 0.42, at=(0.0, y, 4.54), chamfer=0.08, centre_z=False)
        p.box(W + 1.60, 1.60, 0.30, at=(0.0, y, 4.96), chamfer=0.07, centre_z=False)
        for i in range(9):
            x = -W * 0.5 + W * i / 8.0
            E.finial(p, (x, y, 5.26), 0.85, radius=0.15, gold=g)
    # the foot: a low sill so the basin has an end you can stand at
    p.box(2.20, D + 5.20, 0.62, at=(-(W * 0.5 + 0.52 + 1.10), 0.0, 0.0),
          chamfer=0.08, centre_z=False)
    return K.ModuleSpec(
        "WL_Hero_Water_Court", "water", "landmark", "hero",
        f.emit("WL_Hero_Water_Court"),
        [K.Socket("bottom", 0.0, W * 0.5 + 5.0, "ground"),
         K.Socket("water_surface", zw, W * 0.5, "edge",
                  "still sheet at %.2f m; 34.0 x 9.0 m, MI_V2_Water" % zw),
         K.Socket("head_route", T1, 3.40, "route",
                  "the raised court at 1.55 m (T1) at the +X end -- put the "
                  "thing to be reflected HERE"),
         K.Socket("foot_route", 0.62, 1.10, "route", "the sill at the -X end"),
         K.Socket("walk_l", 0.34, 1.10, "route", "colonnade walk, -Y"),
         K.Socket("walk_r", 0.34, 1.10, "route", "colonnade walk, +Y")],
        districts=("water_garden", "royal_garden", "plaza"),
        note="34 x 9 m reflecting basin with an open flanking colonnade and a "
             "T1 head court; built so that whatever stands at the head is "
             "doubled by one flat quad",
        params={"basin_m": [W, D], "aspect": round(W / D, 2),
                "water_z_m": round(zw, 3), "depth_m": DEPTH,
                "head_rung": "T1", "colonnade_bays": 8,
                "reflects": "put a hero at head_route"},
        tri_budget=90000, collision=True)


def water_cascade_stair(f):
    """Water falling down ten risers beside a dry flight. T2, wet.

    The module that makes a terraced garden a WATER garden. It is the dry
    stair's exact twin -- ten 0.310 m risers to T2 at 3.10 m, so it drops into
    a garden edge wherever `WL_Stair_Straight_T2` would -- with a 1.6 m
    cascade channel down its middle and a catch basin at the foot.

    The falling faces are `water_lit`, which is `MI_V2_GlassTeal` at emissive
    560 in the V2 table, so the cascade reads at night without a light actor.
    The still pools between them are `water`. That split is the whole trick:
    moving water glows, standing water reflects.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    w = f.part("water")
    wl = f.part("water_lit")
    CH = 1.60
    W = 5.60
    N = 10
    GOING = 0.360
    for i in range(N):
        depth = GOING * (N - i) + 0.03
        p.box(depth, W, RISER, at=(GOING * i + depth * 0.5 - 0.03, 0.0, RISER * i),
              chamfer=0.03, centre_z=False)
    run = GOING * N
    rise = RISER * N
    # the channel: cut as a pair of cheeks rather than a boolean
    for sgn in (-1.0, 1.0):
        p.box(run + 0.30, (W - CH) * 0.5, rise + 0.34,
              at=(run * 0.5 - 0.03, sgn * (CH + (W - CH) * 0.5) * 0.5, 0.0),
              chamfer=0.05, centre_z=False)
    # the water: a still pool on each tread, a lit sheet down each riser
    for i in range(N):
        x0 = GOING * i - 0.03
        w.box(GOING - 0.02, CH - 0.06, 0.05,
              at=(x0 + GOING * 0.5, 0.0, RISER * (i + 1) - 0.05), centre_z=False)
        wl.box(0.07, CH - 0.06, RISER * 0.92,
               at=(x0 + 0.01, 0.0, RISER * i + RISER * 0.04), centre_z=False)
    # the catch basin at the foot
    zw = _basin(p, d, w, 3.20, W, at=(-2.30, 0.0, 0.0), kerb=0.36)
    for sgn in (-1.0, 1.0):
        E.rake_balustrade(p, run, rise, sgn * (W * 0.5 + 0.22), height=1.00)
        E.stair_cheek(p, run, rise, sgn * (W * 0.5 + 0.22), thickness=0.44)
    return K.ModuleSpec(
        "WL_Water_Cascade_Stair", "water", "structure", "route",
        f.emit("WL_Water_Cascade_Stair"),
        [K.Socket("bottom_route", 0.0, W * 0.5, "route", "walkable ground at z = 0"),
         K.Socket("top_route", rise, W * 0.5, "route",
                  "arrives at 3.10 m (T2), the same rung as the dry stairs"),
         K.Socket("water_surface", zw, 1.60, "edge", "the catch basin at the foot"),
         K.Socket("edge_l", 0.0, W * 0.5 + 0.22, "edge", "balustrade line, -Y"),
         K.Socket("edge_r", 0.0, W * 0.5 + 0.22, "edge", "balustrade line, +Y")],
        districts=("water_garden", "royal_garden", "tea_terrace"),
        note="10 risers to T2 with a 1.60 m cascade channel and a catch basin; "
             "drops in wherever WL_Stair_Straight_T2 would",
        params={"risers": N, "rise_m": rise, "rung": "T2", "channel_m": CH,
                "still": "MI_V2_Water", "falling": "MI_V2_GlassTeal (emissive)"},
        tri_budget=22000, collision=True)


def water_canal_run(f):
    """8 m of canal with a walk each side. The system's repeating unit.

    8.00 m because that is `WL_Garden_Retaining_Run` and
    `WL_Detail_Balustrade_Run`, so a canal, a terrace edge and a balustrade all
    share one module length and a generator can lay them in the same rhythm.
    Butt ends, so any length.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    w = f.part("water")
    RUN, CH = 8.00, 3.20
    WALK = 2.10
    zw = _basin(p, d, w, RUN, CH, kerb=0.40)
    for sgn in (-1.0, 1.0):
        y = sgn * (CH * 0.5 + 0.40 + WALK * 0.5)
        p.box(RUN, WALK, 0.30, at=(0.0, y, 0.0), chamfer=0.05, centre_z=False)
        d.box(RUN - 0.10, WALK - 0.44, 0.07, at=(0.0, y, 0.30 - 0.07), centre_z=False)
    return K.ModuleSpec(
        "WL_Water_Canal_Run", "water", "structure", "terrace",
        f.emit("WL_Water_Canal_Run"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("water_surface", zw, RUN * 0.5, "edge",
                  "3.20 m of still water, %.2f m below the walk" % (0.30 - zw)),
         K.Socket("walk_l", 0.30, WALK * 0.5, "route", "walk at 0.30 m, -Y"),
         K.Socket("walk_r", 0.30, WALK * 0.5, "route", "walk at 0.30 m, +Y"),
         K.Socket("end_a", 0.0, CH * 0.5, "pier", "butts at x = -4.00 m"),
         K.Socket("end_b", 0.0, CH * 0.5, "pier", "butts at x = +4.00 m")],
        districts=("water_garden", "royal_garden", "plaza", "tea_terrace"),
        note="8.00 m canal unit with a 2.10 m walk each side; the same length "
             "as the retaining run and the balustrade run",
        params={"length_m": RUN, "channel_m": CH, "walk_m": WALK,
                "water_z_m": round(zw, 3), "depth_m": DEPTH},
        tri_budget=6000, collision=True)


def water_canal_crossing(f):
    """A flat bridge over the canal, on the same 8 m module. 5.4 m of deck.

    A canal you cannot cross cuts a garden in half. This is the canal run with
    a segmental arch and a deck over it -- same length, same channel, same
    walks -- so it substitutes into a canal anywhere without re-planning.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    w = f.part("water")
    g = f.part("gold")
    RUN, CH = 8.00, 3.20
    WALK = 2.10
    zw = _basin(p, d, w, RUN, CH, kerb=0.40)
    DECK_W = 5.40
    E.arch_band(p, CH + 0.80, 0.95, DECK_W, 0.42, at=(0.0, 0.0, 0.42),
                rot=(0.0, 0.0, 90.0), kind="round", steps=13, keystone=True)
    E.arched_wall(p, CH + 0.80, 0.95, 1.62, CH * 0.5 + 1.30, DECK_W * 0.92,
                  kind="round", steps=13, thickness=0.42, rot=(0.0, 0.0, 90.0),
                  at=(0.0, 0.0, 0.42))
    p.box(DECK_W + 0.40, CH + 3.40, 0.26, at=(0.0, 0.0, 1.78), chamfer=0.05,
          centre_z=False)
    d.box(DECK_W - 0.50, CH + 3.00, 0.06, at=(0.0, 0.0, 2.04 - 0.08), centre_z=False)
    for sgn in (-1.0, 1.0):
        y = sgn * (CH * 0.5 + 0.40 + WALK * 0.5)
        p.box(RUN, WALK, 0.30, at=(0.0, y, 0.0), chamfer=0.05, centre_z=False)
        # steps up onto the deck from each walk
        for i in range(5):
            p.box(DECK_W, 0.34, K.RISER_M,
                  at=(0.0, sgn * (CH * 0.5 + 1.50 - 0.34 * i), 0.30 + K.RISER_M * i),
                  chamfer=0.03, centre_z=False)
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            p.box(0.62, 0.62, 1.15, at=(sx * DECK_W * 0.5, sy * (CH * 0.5 + 1.60), 2.04),
                  chamfer=0.07, centre_z=False)
            E.finial(p, (sx * DECK_W * 0.5, sy * (CH * 0.5 + 1.60), 3.19), 0.70,
                     radius=0.12, gold=g)
        for i in range(7):
            y = -(CH * 0.5 + 1.50) + (CH + 3.0) * i / 6.0
            p.lathe([(0.0, 0.0), (0.085, 0.0), (0.070, 0.24), (0.125, 0.50),
                     (0.075, 0.86), (0.090, 1.10), (0.0, 1.22)], segments=8,
                    smooth=True, matrix=M.xform((sx * DECK_W * 0.5, y, 2.04)))
        p.box(0.42, CH + 3.0, 0.20, at=(sx * DECK_W * 0.5, 0.0, 3.26),
              chamfer=0.04, centre_z=False)
    return K.ModuleSpec(
        "WL_Water_Canal_Crossing", "water", "structure", "span",
        f.emit("WL_Water_Canal_Crossing"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("water_surface", zw, RUN * 0.5, "edge", "the canal carries through"),
         K.Socket("deck_route", 2.04, DECK_W * 0.5, "route",
                  "5.40 m deck at 2.04 m, crossing in Y"),
         K.Socket("walk_l", 0.30, WALK * 0.5, "route", "walk at 0.30 m, -Y"),
         K.Socket("walk_r", 0.30, WALK * 0.5, "route", "walk at 0.30 m, +Y"),
         K.Socket("end_a", 0.0, CH * 0.5, "pier", "butts into a canal run at x = -4.00 m"),
         K.Socket("end_b", 0.0, CH * 0.5, "pier", "butts into a canal run at x = +4.00 m")],
        districts=("water_garden", "royal_garden", "plaza"),
        note="drop-in replacement for a canal run carrying a 5.40 m deck over "
             "a segmental arch; steps up from both walks",
        params={"length_m": RUN, "deck_w_m": DECK_W, "deck_z_m": 2.04,
                "arch": "round segmental"},
        tri_budget=26000, collision=True)


def water_pavilion(f):
    """An open pavilion standing IN the water, on eight piers. 11.6 m.

    The thing at the end of a canal. Its floor is 0.95 m above the sheet, so
    it appears to float; its piers go down into real basin depth, so it does
    not. Eight ogee arches, a ribbed roof and a lantern, all spelled from the
    tower family's own elements -- because a water pavilion and the city behind
    it should be recognisably the same architecture.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    r = f.part("roof")
    g = f.part("gold")
    gl = f.part("glass")
    w = f.part("water")
    R = 3.90
    FLOOR = 1.25
    # the piers, standing in water
    for (x, y, a) in K.radial(8, R * 0.94, phase=math.pi / 8.0):
        d.box(0.86, 0.86, FLOOR - 0.30, at=(x, y, -DEPTH), rot=(0, 0, a),
              chamfer=0.06, centre_z=False)
    p.lathe([(R + 0.34, FLOOR - 0.44), (R + 0.34, FLOOR - 0.22)], segments=24,
            smooth=False)
    p.prism(M.ngon(8, R + 0.30, phase=math.pi / 8.0), 0.22, z0=FLOOR - 0.22)
    d.prism(M.ngon(8, R - 0.10, phase=math.pi / 8.0), 0.06, z0=FLOOR - 0.06)
    E.arcade_ring(p, FLOOR, R * 0.86, bays=8, height=4.30, pier=0.52, depth=0.80,
                  kind="ogee", columns=True, spandrel=False, phase=math.pi / 8.0)
    E.corbel_table(p, FLOOR + 4.30, R * 0.90, count=16, depth=0.26, drop=0.38)
    p.lathe([(R * 0.96, FLOOR + 4.86), (R * 0.96, FLOOR + 5.40)], segments=24,
            smooth=False)
    dome = []
    for i in range(11):
        t = i / 10.0
        dome.append((R * 0.98 * math.cos(t * math.pi * 0.5),
                     FLOOR + 5.40 + 3.10 * math.sin(t * math.pi * 0.5)))
    r.lathe(dome, segments=24, smooth=True)
    for (x, y, a) in K.radial(8, 1.0):
        pts = []
        for i in range(9):
            t = i / 8.0
            rr = R * 0.98 * math.cos(t * math.pi * 0.5) + 0.09
            pts.append((x * rr, y * rr, FLOOR + 5.40 + 3.10 * math.sin(t * math.pi * 0.5)))
        p.sweep(pts, [0.11] * 9, sides=4, cap=False)
    gl.lathe([(0.52, FLOOR + 8.50), (0.52, FLOOR + 9.40)], segments=14,
             smooth=True, cap_bottom=False, cap_top=False)
    p.lathe([(0.72, FLOOR + 9.40), (0.72, FLOOR + 9.62)], segments=14, smooth=False)
    E.finial(p, (0.0, 0.0, FLOOR + 9.62), 1.35, radius=0.24, gold=g)
    # the sheet the pavilion stands in, held by its own kerb
    _basin(p, d, w, (R + 3.4) * 2.0, (R + 3.4) * 2.0, kerb=0.46)
    return K.ModuleSpec(
        "WL_Water_Pavilion", "water", "landmark", "hero",
        f.emit("WL_Water_Pavilion"),
        [K.Socket("bottom", 0.0, R + 3.86, "ground"),
         K.Socket("water_surface", 0.30 - FREEBOARD, R + 3.4, "edge",
                  "the sheet the pavilion stands in"),
         K.Socket("floor_route", FLOOR, R * 0.80, "route",
                  "the pavilion floor at 1.25 m, reached from a crossing or a jetty"),
         K.Socket("top", FLOOR + 9.62 + 1.35, 0.0, "crown", "terminal")],
        districts=("water_garden", "royal_garden", "tea_terrace"),
        note="open octagonal pavilion on eight piers standing in a 14.6 m "
             "sheet; ogee arcade, ribbed dome, glazed lantern",
        params={"radius_m": R, "floor_z_m": FLOOR, "bays": 8,
                "stands_in_water": True},
        tri_budget=60000, collision=True)


def water_spillway_wall(f):
    """A 8 m weir: a sheet of water falling the full width of a retaining run.

    The loudest thing water does, and the cheapest. It is the garden retaining
    run's exact twin -- 8.00 m, T2, same coping and same ends -- with the bank
    face replaced by a lit sheet and a catch basin at its foot. Substitute it
    into a terrace edge and the terrace starts pouring.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    w = f.part("water")
    wl = f.part("water_lit")
    RUN = 8.00
    Z = K.ROUTE_LADDER["T2"]
    THICK = 1.10
    ht = THICK * 0.5
    p.loft([[(-RUN * 0.5, -(ht + 0.22), 0.0), (RUN * 0.5, -(ht + 0.22), 0.0),
             (RUN * 0.5, ht, 0.0), (-RUN * 0.5, ht, 0.0)],
            [(-RUN * 0.5, -ht, Z - 0.40), (RUN * 0.5, -ht, Z - 0.40),
             (RUN * 0.5, ht, Z - 0.40), (-RUN * 0.5, ht, Z - 0.40)]], smooth=False)
    # the weir lip: the water leaves over a rolled edge, not a square one
    p.lathe([(0.0, 0.0), (0.20, 0.0), (0.22, 0.10), (0.14, 0.22), (0.0, 0.26)],
            segments=10, arc=180.0,
            matrix=M.xform((0.0, -ht, Z - 0.40), (90.0, 0.0, 90.0)))
    p.box(RUN, 0.44, 0.24, at=(0.0, -ht + 0.10, Z - 0.40), chamfer=0.04,
          centre_z=False)
    p.box(RUN, THICK + 0.20, 0.10, at=(0.0, 0.0, Z - 0.16), chamfer=0.03,
          centre_z=False)
    d.box(RUN - 0.20, THICK * 0.70, 0.08, at=(0.0, ht * 0.30, Z - 0.08),
          centre_z=False)
    # the falling sheet, and the still water above and below it
    wl.box(RUN - 0.30, 0.09, Z - 0.62, at=(0.0, -ht - 0.02, 0.24), centre_z=False)
    w.box(RUN - 0.30, 1.30, 0.05, at=(0.0, ht + 0.55, Z - 0.28), centre_z=False)
    zw = _basin(p, d, w, RUN + 1.20, 3.60, at=(0.0, -(ht + 2.30), 0.0), kerb=0.38)
    return K.ModuleSpec(
        "WL_Water_Spillway_Wall", "water", "structure", "terrace",
        f.emit("WL_Water_Spillway_Wall"),
        [K.Socket("bottom", 0.0, RUN * 0.5, "ground"),
         K.Socket("top_route", Z, RUN * 0.5, "route",
                  "the T2 terrace at 3.10 m carries over the weir"),
         K.Socket("edge", Z, RUN * 0.5, "edge", "coping line, as the retaining run"),
         K.Socket("water_surface", zw, RUN * 0.5, "edge", "the catch basin below"),
         K.Socket("end_a", 0.0, ht, "pier", "x = -4.00 m, same section as WL_Garden_Retaining_Run"),
         K.Socket("end_b", 0.0, ht, "pier", "x = +4.00 m, same section as WL_Garden_Retaining_Run")],
        districts=("water_garden", "royal_garden", "grove"),
        note="8.00 m weir: a lit sheet falling the full width of a retaining "
             "run into a catch basin; substitutes for WL_Garden_Retaining_Run",
        params={"length_m": RUN, "retains_m": Z, "rung": "T2",
                "substitutes_for": "WL_Garden_Retaining_Run",
                "falling": "MI_V2_GlassTeal (emissive)"},
        tri_budget=10000, collision=True)


def water_sunken_pool(f):
    """A round sunken pool, 11 m across, reached by four flights. T1 down.

    The inverse of every other module in this kit: you go DOWN to it. A sunken
    garden is the one shape that makes flat ground read as designed, because
    the only way to know a plane is flat is to cut into it -- and it uses the
    route ladder in the negative direction, which nothing else here does.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    w = f.part("water")
    R = 5.50
    DROP = T1
    SEG = 28
    # the retaining bowl, five risers down
    for i in range(5):
        rr = R + 1.30 + 0.36 * i
        p.lathe([(rr, -RISER * (i + 1)), (rr + 0.40, -RISER * (i + 1)),
                 (rr + 0.40, -RISER * i), (rr, -RISER * i), (rr, -RISER * (i + 1))],
                segments=SEG, smooth=False)
    p.lathe([(R, -DROP), (R + 1.30, -DROP), (R + 1.30, -DROP + 0.30),
             (R, -DROP + 0.30), (R, -DROP)], segments=SEG, smooth=False)
    d.lathe([(0.0, -DROP - 0.10), (R, -DROP - 0.10), (R, -DROP + 0.02),
             (0.0, -DROP + 0.02), (0.0, -DROP - 0.10)], segments=SEG, smooth=False)
    w.lathe([(0.0, -DROP + 0.14), (R - 0.08, -DROP + 0.14),
             (R - 0.08, -DROP + 0.18), (0.0, -DROP + 0.18), (0.0, -DROP + 0.14)],
            segments=SEG, smooth=False)
    # four flights down, on the cardinal bearings
    for k in range(4):
        m = M.xform((0, 0, 0), (0, 0, 90.0 * k))
        for i in range(5):
            rr = R + 1.30 + 0.36 * i
            p.box(0.44, 2.20, RISER, at=(rr + 0.20, 0.0, -RISER * (i + 1)),
                  matrix=m, chamfer=0.03, centre_z=False)
    return K.ModuleSpec(
        "WL_Water_Sunken_Pool", "water", "structure", "terrace",
        f.emit("WL_Water_Sunken_Pool"),
        [K.Socket("bottom", 0.0, R + 3.20, "ground",
                  "the rim is at z = 0; the module goes DOWN from it"),
         K.Socket("floor_route", -DROP + 0.30, R + 1.0, "route",
                  "the pool walk at -1.55 m (T1 below grade)"),
         K.Socket("water_surface", -DROP + 0.18, R, "edge", "11 m sheet at -1.37 m"),
         K.Socket("edge", 0.0, R + 3.10, "edge", "the rim; a balustrade may run it")],
        districts=("water_garden", "royal_garden", "tea_terrace"),
        note="11 m round sunken pool, five risers down on four bearings; the "
             "only module in the kit that uses the route ladder downward",
        params={"radius_m": R, "drop_m": DROP, "rung": "T1 (below grade)",
                "flights": 4, "direction": "down"},
        tri_budget=16000, collision=True)


BUILDERS = (
    water_basin_reflecting, water_cascade_stair, water_canal_run,
    water_canal_crossing, water_pavilion, water_spillway_wall,
    water_sunken_pool,
)
