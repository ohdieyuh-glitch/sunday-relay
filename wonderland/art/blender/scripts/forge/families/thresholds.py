"""Arches and gatehouses: the things you walk THROUGH.

THE REFERENCE GAP. The founder image is organised around a threshold. Its
centre is a wide ivy-covered ceremonial arch with a broad arcaded structure
behind it; its left third is dominated by a huge gold lattice screen; and the
path you are standing on runs at all of it. That is not decoration, it is the
picture's composition: everything else is arranged around the fact that the
city is entered.

The current world has thresholds, and `layout_v2` places them well -- PASS 30's
South Reach is built round a `gatehouse_district` and eight arches, and it
worked. What it does not have is threshold geometry with its own IDENTITY at
monumental scale. `arch_stone` and `gatehouse_district` are 28 m and read as
competent masonry; the reference's gate reads as an EVENT.

So this family is four arches and two gatehouses, and every one of them is
built to be walked through at Wonderland's own scale: the openings are at
least 4.2 m clear, because `walkable.py --window=world` audits reachability
over the whole world and a monument the Dog cannot pass is a wall with
ornament on it.

WHAT `veg_anchor` IS FOR. The reference's arch is COVERED in ivy, and the
existing world already has excellent foliage (`assets_v2._leaf_shell`, and the
vegetation pass that replaced sphere-clusters with leaf blades). This family
does not model a single leaf. It publishes flat `veg_anchor` strips on the
faces the reference plants -- so the world session scatters ITS OWN foliage
onto a surface that was designed to carry it, instead of intersecting a plant
with a wall and hoping.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

XL, L, MD, S = K.LADDER["XL"], K.LADDER["L"], K.LADDER["M"], K.LADDER["S"]


# ==========================================================================
# ARCHES
# ==========================================================================


def arch_ceremonial(f):
    """The big one: a 13 m opening under a 24 m ogee, on paired piers.

    Wonderland's front door. Three things make it monumental rather than
    merely large: the piers are PAIRED (a column in front of a mass, so the
    face has depth instead of being a slab); there is an attic storey above
    the arch, which is what stops a triumphal arch reading as a doorway; and
    the whole thing is 24 m, which puts it above the 25 m 'built silhouette'
    bar `region.py` measures against -- so it counts as architecture in the
    world's own audit, not as a prop.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    v = f.part("veg_anchor")
    SPAN, RISE = 13.0, 8.4
    PIER, DEPTH = 4.2, 5.6
    SPRING = 11.6
    H = 24.2

    for sgn in (-1.0, 1.0):
        x = sgn * (SPAN * 0.5 + PIER * 0.5)
        p.box(PIER, DEPTH, 1.10, at=(x, 0.0, 0.0), chamfer=0.22, centre_z=False)
        p.box(PIER * 0.94, DEPTH * 0.94, SPRING - 1.7, at=(x, 0.0, 1.10),
              chamfer=0.16, centre_z=False)
        for dy in (-1.0, 1.0):
            E.column(p, (x, dy * (DEPTH * 0.47 + 0.35), 1.10),
                     SPRING - 1.9, 0.62, flutes=10)
        # a 4-segment lathe rotated 45 degrees is a square band, and its FLAT
        # sits at r*cos(45) -- so the radius has to be 1.41x the half-width it
        # is meant to wrap, or the band disappears inside the pier.
        E.string_course(p, SPRING - 0.60, PIER * 0.80,
                        run=M.CORNICE_CORBEL, segments=4,
                        matrix=M.xform((x, 0.0, 0.0), (0.0, 0.0, 45.0)))
        p.box(PIER * 1.14, DEPTH * 1.08, 0.62, at=(x, 0.0, SPRING - 0.62),
              chamfer=0.14, centre_z=False)

    E.arch_band(p, SPAN, RISE, DEPTH, 1.30, at=(0.0, 0.0, SPRING),
                kind="ogee", steps=17, keystone=True)
    ENT = SPRING + RISE + 0.9
    # the face is a WALL WITH A HOLE IN IT, up to the entablature
    E.arched_wall(p, SPAN, RISE, ENT - SPRING, SPAN * 0.5 + PIER, DEPTH * 0.88,
                  kind="ogee", steps=17, thickness=1.30,
                  at=(0.0, 0.0, SPRING))
    p.box(SPAN + PIER * 2.0 + 0.9, DEPTH * 1.12, 0.55, at=(0.0, 0.0, ENT),
          chamfer=0.12, centre_z=False)
    p.box(SPAN + PIER * 2.0 + 1.7, DEPTH * 1.22, 0.75, at=(0.0, 0.0, ENT + 0.55),
          chamfer=0.18, centre_z=False)
    # the attic: what makes it ceremonial rather than merely tall
    p.box(SPAN + PIER * 1.2, DEPTH * 0.96, 2.90, at=(0.0, 0.0, ENT + 1.30),
          chamfer=0.16, centre_z=False)
    for i in range(5):
        x = -SPAN * 0.42 + SPAN * 0.84 * i / 4.0
        for dy in (-1.0, 1.0):
            E.filigree_panel(g, 1.55, 1.90, at=(x, dy * DEPTH * 0.49, ENT + 2.75),
                             bar=0.075, cells_x=2, cells_y=2)
    p.box(SPAN + PIER * 1.9, DEPTH * 1.10, 0.60, at=(0.0, 0.0, ENT + 4.20),
          chamfer=0.16, centre_z=False)
    for sgn in (-1.0, 1.0):
        E.pinnacle(p, (sgn * (SPAN * 0.5 + PIER * 0.5), 0.0, ENT + 4.80),
                   3.60, 0.72, gold=g)
    E.finial(p, (0.0, 0.0, ENT + 4.80), 3.10, radius=0.58, gold=g)

    # ivy anchors: the faces the reference actually plants
    for sgn in (-1.0, 1.0):
        x = sgn * (SPAN * 0.5 + PIER * 0.5)
        v.box(PIER * 0.70, 0.10, SPRING - 2.6, at=(x, -DEPTH * 0.44, 1.40),
              centre_z=False)
        v.box(0.10, DEPTH * 0.70, SPRING - 2.6, at=(x + sgn * PIER * 0.44, 0.0, 1.40),
              centre_z=False)
    return K.ModuleSpec(
        "WL_Arch_Ceremonial", "arch", "structure", "threshold",
        f.emit("WL_Arch_Ceremonial"),
        [K.Socket("bottom", 0.0, SPAN * 0.5 + PIER, "ground"),
         K.Socket("passage", 0.0, SPAN * 0.5, "pier", "13.0 m clear opening, 11.6 m to the springing")],
        districts=("plaza", "city", "royal_garden", "castle"),
        note="24.2 m ceremonial ogee arch on paired piers, with attic and ivy anchors",
        params={"span_m": SPAN, "clear_height_m": SPRING + RISE, "arch": "ogee"},
        tri_budget=30000, collision=True)


def arch_garden_rose(f):
    """A light garden arch: 5.4 m span, 8.2 m tall, built to be buried in roses.

    The reference's foreground has one of these over the path and it is almost
    entirely plant -- what you see of the structure is two slim piers and a
    thin ogee band. So this is deliberately the LEAST detailed thing in the
    kit: any moulding here would be hidden, and every triangle saved is one
    the foliage can spend.
    """
    p = f.part("stone")
    v = f.part("veg_anchor")
    g = f.part("gold")
    SPAN, RISE, SPRING = 5.4, 3.3, 4.9
    H = SPRING + RISE
    for sgn in (-1.0, 1.0):
        x = sgn * SPAN * 0.5
        p.box(0.78, 0.78, 0.34, at=(x, 0.0, 0.0), chamfer=0.09, centre_z=False)
        E.column(p, (x, 0.0, 0.34), SPRING - 0.44, 0.30, flutes=8)
    E.arch_band(p, SPAN, RISE, 0.72, 0.34, at=(0.0, 0.0, SPRING),
                kind="ogee", steps=15, keystone=False)
    for sgn in (-1.0, 1.0):
        v.box(0.34, 0.12, SPRING - 0.9, at=(sgn * SPAN * 0.5, 0.0, 0.60),
              centre_z=False)
    v_curve = E.arch_curve(SPAN * 0.98, RISE * 1.02, steps=13, kind="ogee")
    v.sweep([(x, 0.0, SPRING + z) for (x, z) in v_curve],
            [0.20] * len(v_curve), sides=4, cap=False)
    E.finial(p, (0.0, 0.0, H - 0.15), 0.95, radius=0.16, gold=g)
    return K.ModuleSpec(
        "WL_Arch_Garden_Rose", "arch", "structure", "threshold",
        f.emit("WL_Arch_Garden_Rose"),
        [K.Socket("bottom", 0.0, SPAN * 0.5 + 0.4, "ground"),
         K.Socket("passage", 0.0, SPAN * 0.5, "pier", "5.4 m clear, 4.9 m to the springing")],
        districts=("royal_garden", "grove", "tea_terrace", "water_garden"),
        note="slim ogee garden arch with a full-length vine anchor along the band",
        params={"span_m": SPAN, "arch": "ogee"}, tri_budget=4000, collision=True)


def arch_trefoil_screen(f):
    """A trefoil arch with a filigree tympanum. Ornament at head height.

    Three lobes and a gold-filled head. The reference's mid-ground is full of
    small ornate openings like this and the current world's smallest arch is a
    plain round one, so the district-scale vocabulary jumps straight from
    'plain' to 'landmark' with nothing between.
    """
    p = f.part("stone")
    g = f.part("gold")
    SPAN, RISE, SPRING = 4.6, 3.5, 3.4
    H = SPRING + RISE + 1.5
    for sgn in (-1.0, 1.0):
        x = sgn * (SPAN * 0.5 + 0.55)
        p.box(1.10, 1.30, 0.40, at=(x, 0.0, 0.0), chamfer=0.10, centre_z=False)
        p.box(0.98, 1.16, SPRING - 0.40, at=(x, 0.0, 0.40), chamfer=0.09,
              centre_z=False)
        E.column(p, (x - sgn * 0.30, 0.0, 0.40), SPRING - 0.52, 0.24, flutes=6)
    E.arch_band(p, SPAN, RISE, 1.16, 0.42, at=(0.0, 0.0, SPRING),
                kind="trefoil", steps=18, keystone=True)
    E.filigree_panel(g, SPAN * 0.68, RISE * 0.52,
                     at=(0.0, 0.0, SPRING + RISE * 0.60), bar=0.055,
                     cells_x=3, cells_y=2)
    p.box(SPAN + 2.4, 1.34, 0.42, at=(0.0, 0.0, SPRING + RISE + 0.20),
          chamfer=0.10, centre_z=False)
    for sgn in (-1.0, 1.0):
        E.pinnacle(p, (sgn * (SPAN * 0.5 + 0.55), 0.0, SPRING + RISE + 0.62),
                   1.35, 0.26, gold=g)
    return K.ModuleSpec(
        "WL_Arch_Trefoil_Screen", "arch", "structure", "threshold",
        f.emit("WL_Arch_Trefoil_Screen"),
        [K.Socket("bottom", 0.0, SPAN * 0.5 + 1.1, "ground"),
         K.Socket("passage", 0.0, SPAN * 0.5, "pier", "4.6 m clear, 3.4 m to the springing")],
        districts=("cloister", "clock", "tea_terrace", "royal_garden"),
        note="cusped trefoil head with a gold filigree tympanum; the district-scale arch",
        params={"span_m": SPAN, "arch": "trefoil"}, tri_budget=11000, collision=True)


def arch_twin_tiered(f):
    """An arch over an arch: 9 m span below, an open gallery above. 19.6 m.

    The reference's gate is not a single opening, it is a STOREYED wall -- you
    see through it twice, at two heights. That double read is what makes a
    threshold feel like the edge of somewhere rather than a hoop.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    SPAN, RISE, SPRING, PIER, DEPTH = 9.0, 4.9, 8.2, 2.6, 3.8
    H = 19.6
    for sgn in (-1.0, 1.0):
        x = sgn * (SPAN * 0.5 + PIER * 0.5)
        p.box(PIER * 1.16, DEPTH * 1.10, 0.72, at=(x, 0.0, 0.0), chamfer=0.16,
              centre_z=False)
        p.box(PIER, DEPTH, SPRING - 0.72, at=(x, 0.0, 0.72), chamfer=0.13,
              centre_z=False)
        for dy in (-1.0, 1.0):
            E.column(p, (x, dy * (DEPTH * 0.50 + 0.22), 0.72), SPRING - 0.92,
                     0.40, flutes=8)
    E.arch_band(p, SPAN, RISE, DEPTH, 0.90, at=(0.0, 0.0, SPRING), kind="pointed",
                steps=13, keystone=True)
    d.box(SPAN * 0.96, DEPTH * 0.50, 0.60, at=(0.0, 0.0, SPRING - 0.05), centre_z=False)
    DECK = SPRING + RISE + 0.55
    E.arched_wall(p, SPAN, RISE, DECK - SPRING - 0.55, SPAN * 0.5 + PIER * 0.5,
                  DEPTH * 0.88, kind="pointed", steps=13, thickness=0.90,
                  at=(0.0, 0.0, SPRING))
    p.box(SPAN + PIER * 2.0 + 0.7, DEPTH * 1.14, 0.55, at=(0.0, 0.0, DECK - 0.55),
          chamfer=0.13, centre_z=False)
    # the upper gallery: three small pointed openings, open to the sky behind
    for i in range(3):
        x = -SPAN * 0.32 + SPAN * 0.32 * i
        E.column(p, (x - 1.35, 0.0, DECK), 2.55, 0.28, flutes=6)
        E.arch_band(p, 2.30, 1.30, DEPTH * 0.70, 0.30, at=(x, 0.0, DECK + 2.60),
                    kind="pointed", steps=9)
    E.column(p, (SPAN * 0.32 + 1.35, 0.0, DECK), 2.55, 0.28, flutes=6)
    p.box(SPAN + PIER * 1.5, DEPTH * 1.06, 0.50, at=(0.0, 0.0, DECK + 4.00),
          chamfer=0.12, centre_z=False)
    for i in range(7):
        x = -(SPAN * 0.5 + PIER * 0.4) + (SPAN + PIER * 0.8) * i / 6.0
        p.box(0.52, DEPTH * 0.72, 0.86, at=(x, 0.0, DECK + 4.50), chamfer=0.10,
              centre_z=False)
    for sgn in (-1.0, 1.0):
        E.pinnacle(p, (sgn * (SPAN * 0.5 + PIER * 0.5), 0.0, DECK + 4.50),
                   2.60, 0.42, gold=g)
    return K.ModuleSpec(
        "WL_Arch_Twin_Tiered", "arch", "structure", "threshold",
        f.emit("WL_Arch_Twin_Tiered"),
        [K.Socket("bottom", 0.0, SPAN * 0.5 + PIER, "ground"),
         K.Socket("passage", 0.0, SPAN * 0.5, "pier", "9.0 m clear, 8.2 m to the springing")],
        districts=("city", "castle", "plaza", "cloister"),
        note="storeyed threshold: a pointed arch below, a three-bay open gallery above",
        params={"span_m": SPAN, "tiers": 2, "arch": "pointed"},
        tri_budget=26000, collision=True)


# ==========================================================================
# GATEHOUSES
# ==========================================================================


def gatehouse_twin(f):
    """Two flanking towers with a machicolated bridge between them. 26 m.

    The full ceremonial entrance. It is deliberately built from THIS KIT'S own
    vocabulary -- the flanking drums take the same corbel table, merlons and
    pinnacles as the tower crowns -- so a gatehouse and the towers behind it
    read as one city rather than as two art passes.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    g = f.part("gold")
    gl = f.part("glass")
    GAP, DEPTH = 9.4, 6.2
    RT = 4.30
    H = 26.0
    for sgn in (-1.0, 1.0):
        cx = sgn * (GAP * 0.5 + RT)
        m = M.xform((cx, 0.0, 0.0))
        p.lathe([(RT * 1.20, 0.0), (RT * 1.20, 1.05), (RT * 1.06, 1.75)],
                segments=24, matrix=m, smooth=False)
        body = p.lathe(M.entasis(RT * 1.02, RT * 0.96, 1.75, 15.6, steps=6),
                       segments=24, matrix=m, smooth=False, cap_bottom=False)
        p.displace(body, 0.028, 1.5, seed=int(sgn * 5) + 9)
        for (x, y, a) in K.radial(5, RT * 0.99, phase=0.4):
            E.window_arched(p, (cx + x, y, 4.10), 0.86, 2.35, depth=0.26,
                            rot=(0, 0, a), kind="ogee", glass_part=gl)
        E.string_course(p, 8.40, RT * 0.99, run=M.CORNICE_STRING,
                        matrix=m, segments=24)
        E.balcony_ring(p, 11.90, RT * 0.96, out=0.80, thickness=0.28, corbels=14,
                       rail=1.05, balusters=20, matrix=m)
        E.corbel_table(p, 15.60, RT * 0.96, count=18, depth=0.34, drop=0.50,
                       matrix=m)
        p.lathe([(RT * 1.04, 16.20), (RT * 1.04, 18.40)], segments=24,
                matrix=m, smooth=False)
        E.merlon_ring(p, 18.40, RT * 1.00, count=12, width=0.56, height=0.92,
                      matrix=m)
        p.lathe([(RT * 0.98, 18.40), (MD * 0.92, 19.30)], segments=24,
                matrix=m, smooth=False)
        f.part("roof").lathe(M.needle(MD * 0.92, 5.60, steps=7, concavity=0.38,
                                      z0=19.30), segments=20, matrix=m, smooth=True)
        E.finial(p, (cx, 0.0, 24.60), 1.45, radius=0.26, gold=g)

    # the passage: a pointed gate arch through a wall block
    p.box(GAP + 1.2, DEPTH, 1.0, at=(0.0, 0.0, 0.0), chamfer=0.20, centre_z=False)
    for sgn in (-1.0, 1.0):
        p.box(1.30, DEPTH * 0.98, 7.2, at=(sgn * (GAP * 0.5 - 0.15), 0.0, 1.0),
              chamfer=0.14, centre_z=False)
    E.arch_band(p, GAP - 1.4, 4.0, DEPTH * 0.98, 0.95, at=(0.0, 0.0, 8.2),
                kind="pointed", steps=13, keystone=True)
    d.box((GAP - 1.5), DEPTH * 0.44, 0.70, at=(0.0, 0.0, 8.15), centre_z=False)
    p.box(GAP + 1.0, DEPTH * 0.90, 2.20, at=(0.0, 0.0, 12.30), chamfer=0.14,
          centre_z=False)
    for i in range(9):
        x = -GAP * 0.5 + GAP * i / 8.0
        p.box(0.60, DEPTH * 1.06, 0.62, at=(x, 0.0, 14.50), chamfer=0.10,
              centre_z=False)
    p.box(GAP + 1.6, DEPTH * 1.10, 0.48, at=(0.0, 0.0, 15.12), chamfer=0.12,
          centre_z=False)
    for i in range(7):
        x = -GAP * 0.44 + GAP * 0.88 * i / 6.0
        p.box(0.52, DEPTH * 0.86, 1.10, at=(x, 0.0, 15.60), chamfer=0.10,
              centre_z=False)
    E.filigree_panel(g, GAP * 0.62, 1.55, at=(0.0, -DEPTH * 0.47, 13.40),
                     bar=0.075, cells_x=4, cells_y=2)
    return K.ModuleSpec(
        "WL_Gatehouse_Twin", "gatehouse", "structure", "threshold",
        f.emit("WL_Gatehouse_Twin"),
        [K.Socket("bottom", 0.0, GAP * 0.5 + RT * 2.2, "ground"),
         K.Socket("passage", 0.0, (GAP - 1.4) * 0.5, "pier",
                  "8.0 m clear opening, 8.2 m to the springing")],
        districts=("city", "castle", "plaza"),
        note="twin flanking towers, machicolated bridge, pointed gate; the kit's full entrance",
        params={"opening_m": GAP - 1.4, "towers": 2}, tri_budget=60000,
        collision=True)


def gatehouse_screen(f):
    """A low wall gate whose whole face is gold filigree. 14.4 m.

    THE REFERENCE'S LOUDEST SINGLE ELEMENT, and the one with no equivalent
    anywhere in the current world at any scale: the left third of the founder
    image is a huge ornate gold lattice, ivy-grown, standing between the
    garden and the city. `9655bad` moved Wonderland's gold into the garden,
    which was the right call and left the garden with gold OBJECTS rather than
    a gold WALL. This is the wall.

    The lattice is `elements.filigree_panel` at four times the size it is used
    at anywhere else, in three leaves, with the middle leaf standing open.
    """
    p = f.part("stone")
    g = f.part("gold")
    ga = f.part("gold_aged")
    v = f.part("veg_anchor")
    LEAF_W, LEAF_H = 4.30, 8.60
    H = 14.4
    for i, sgn in enumerate((-1.0, 0.0, 1.0)):
        if sgn == 0.0:
            continue
        x = sgn * (LEAF_W + 0.85)
        p.box(1.55, 1.55, 0.62, at=(x, 0.0, 0.0), chamfer=0.16, centre_z=False)
        p.box(1.34, 1.34, 9.80, at=(x, 0.0, 0.62), chamfer=0.13, centre_z=False)
        E.string_course(p, 9.10, 0.95, run=M.CORNICE_CORBEL, segments=4,
                        matrix=M.xform((x, 0.0, 0.0), (0.0, 0.0, 45.0)))
        p.box(1.62, 1.62, 0.42, at=(x, 0.0, 10.42), chamfer=0.11, centre_z=False)
        E.pinnacle(p, (x, 0.0, 10.84), 3.40, 0.62, gold=g)
        v.box(0.72, 0.12, 8.40, at=(x, -0.60, 0.70), centre_z=False)

    for k, (cx, yaw) in enumerate(((-(LEAF_W * 0.5 + 0.42), 0.0),
                                   (LEAF_W * 0.5 + 0.42, 0.0))):
        E.filigree_panel(g, LEAF_W, LEAF_H, at=(cx, 0.0, 1.05 + LEAF_H * 0.5),
                         rot=(0.0, 0.0, yaw), bar=0.11, cells_x=3, cells_y=5)
        ga.box(LEAF_W + 0.24, 0.30, 0.34, at=(cx, 0.0, 1.05 + LEAF_H + 0.10),
               chamfer=0.07, centre_z=False)
        # the heart finials the art direction names, in round bar
        for j in range(3):
            hx = cx - LEAF_W * 0.32 + LEAF_W * 0.32 * j
            pts = [(hx + math.sin(t * 0.2618) ** 3 * 0.42, 0.0,
                    1.05 + LEAF_H + 0.90 + (13.0 * math.cos(t * 0.2618)
                                            - 5.0 * math.cos(2 * t * 0.2618)
                                            - 2.0 * math.cos(3 * t * 0.2618)
                                            - math.cos(4 * t * 0.2618)) * 0.034)
                   for t in range(25)]
            g.sweep(pts, [0.055] * len(pts), sides=4, cap=False)

    # the arch over the middle: the leaf that stands open
    E.arch_band(g, LEAF_W * 2.0 + 0.9, 2.60, 0.34, 0.26,
                at=(0.0, 0.0, 1.05 + LEAF_H + 0.55), kind="ogee", steps=17)
    E.filigree_panel(g, LEAF_W * 1.5, 2.10, at=(0.0, 0.0, 1.05 + LEAF_H + 1.60),
                     bar=0.075, cells_x=5, cells_y=2)
    return K.ModuleSpec(
        "WL_Gatehouse_Screen", "gatehouse", "structure", "threshold",
        f.emit("WL_Gatehouse_Screen"),
        [K.Socket("bottom", 0.0, LEAF_W + 1.7, "ground"),
         K.Socket("passage", 0.0, LEAF_W * 0.5, "pier",
                  "the centre leaf stands open: 4.3 m clear")],
        districts=("royal_garden", "plaza", "tea_terrace", "city"),
        note="the reference's gold lattice: two 4.3x8.6 m filigree leaves, heart finials, ivy anchors",
        params={"leaves": 2, "leaf_w_m": LEAF_W, "leaf_h_m": LEAF_H},
        tri_budget=90000, collision=True)


BUILDERS = (
    arch_ceremonial, arch_garden_rose, arch_trefoil_screen, arch_twin_tiered,
    gatehouse_twin, gatehouse_screen,
)
