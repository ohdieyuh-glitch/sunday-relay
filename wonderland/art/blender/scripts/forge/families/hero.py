"""The hero landmarks: one-offs with an identity of their own.

WHAT A HERO ASSET IS FOR, and why there are two rather than ten. A modular kit
gives a district COHERENCE; it cannot give it a landmark, because a landmark is
by definition the thing that is not like the others. `region.py`'s whole finding
was about this from the other direction -- a place can be full of actors,
reachable and correctly dense, and still be "nothing to arrive at". Arrival
needs something singular.

But a session that spends itself polishing one cathedral leaves a world with
one good building and nothing to build the rest from, so the balance here is
deliberate: 41 modules that recombine, and two heroes that do not.

BOTH ARE BUILT FROM THE KIT'S OWN VOCABULARY. The Great Spire's corbel tables,
arcades, balconies and needle are `elements` calls at hero scale, not a
separate art style. That is what makes it read as the CAPITAL of this city
rather than as an import -- the reference's own tallest towers are recognisably
the same architecture as the small ones behind them, only more so.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

XL, L, MD, S = K.LADDER["XL"], K.LADDER["L"], K.LADDER["M"], K.LADDER["S"]


def hero_great_spire(f):
    """THE GREAT SPIRE OF WONDERLAND. 118 m, and the tallest thing in the kit.

    Its shape is an argument about the reference. The founder image's skyline
    is needles, and the tallest needle in it is not a single cone -- it is a
    tower that OPENS near its top, showing a lit chamber, and then closes again
    into a point. That sequence (mass, then void, then mass, then needle) is
    what makes the eye read enormous height, because the void gives it two
    separate things to measure.

    So, bottom to top:

        0.0  m   an octagonal terraced base, eight walk-through portals
       14.6  m   a battered, twelve-ribbed shaft
       38.0  m   an open belfry: twelve pointed bays you see the sky through
       54.0  m   a balcony gallery, the widest thing above the base
       58.4  m   THE LANTERN CHAMBER: glazed on all sixteen sides, emissive
       70.0  m   eight flying ribs, leaning in, carrying
       78.0  m   a crown of eight pinnacles round the needle's foot
       84.0  m   the needle: 34 m, four gold collars
      118.0  m   the finial

    At 118 m it is nearly five times the world's 25 m "built silhouette" bar
    and taller than anything `skyline.py` currently measures, so it will be
    visible from every camera in the world. That is the point of it, and it is
    also the reason it is the only thing in this session authored above 30 m:
    a second one would halve the first one's meaning.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    r = f.part("roof")
    g = f.part("gold")
    ga = f.part("gold_aged")
    gl = f.part("glass")
    glc = f.part("glass_cool")

    # ---- the base: eight portals you can walk through --------------------
    for i, (rad, z, h) in enumerate(((16.4, 0.0, 1.30), (14.9, 1.30, 1.20),
                                     (13.6, 2.50, 1.10))):
        p.prism(M.ngon(8, rad, phase=math.pi / 8.0), h, z0=z)
        # set DOWN from the terrace top: a lip flush with it would lay a second
        # coplanar disc on the same plane. See `tower_base_terraced`.
        p.prism(M.ngon(8, rad * 1.02, phase=math.pi / 8.0), 0.10, z0=z + h - 0.34)
    E.arcade_ring(p, 3.60, 11.60, bays=8, height=9.10, pier=1.35, depth=2.40,
                  kind="pointed", columns=True, phase=math.pi / 8.0)
    d.lathe([(6.40, 3.60), (6.40, 12.70)], segments=24)
    E.corbel_table(p, 12.70, 11.70, count=40, depth=0.46, drop=0.72)
    p.lathe([(12.10, 13.42), (11.20, 14.20), (10.40, 14.60)], segments=32,
            smooth=False)

    # ---- the shaft: 23 m of ribbed, battered wall -------------------------
    shaft = p.lathe(M.entasis(10.40, 8.60, 14.60, 38.00, steps=8, belly=0.026),
                    segments=28, smooth=False, cap_bottom=False, cap_top=False)
    p.displace(shaft, 0.034, 1.3, seed=301)
    E.rib_set(p, 14.60, 36.60, 10.30, count=12, width=0.86, out=0.34)
    for z, rad in ((21.20, 10.00), (28.60, 9.40)):
        E.string_course(p, z, rad, run=M.CORNICE_ASTRAGAL, segments=28)
        for (x, y, a) in K.radial(8, rad * 0.995, phase=0.20):
            E.window_arched(p, (x, y, z + 0.70), 1.15, 3.40, depth=0.34,
                            rot=(0, 0, a), kind="ogee", glass_part=gl)
    E.corbel_table(p, 36.60, 8.80, count=30, depth=0.40, drop=0.60)

    # ---- the belfry: the first void ---------------------------------------
    E.arcade_ring(p, 38.00, 8.30, bays=12, height=12.20, pier=1.00, depth=1.70,
                  kind="pointed", columns=True, spandrel=False)
    for (x, y, a) in K.radial(12, 8.30):
        d.box(0.90, 1.20, 12.20, at=(x * 0.62, y * 0.62, 38.00), rot=(0, 0, a),
              chamfer=0.12, centre_z=False)
    E.corbel_table(p, 50.20, 8.40, count=30, depth=0.38, drop=0.58)
    p.lathe([(8.90, 50.78), (8.90, 52.40)], segments=28, smooth=False)

    # ---- the gallery: the widest thing above the base ---------------------
    E.balcony_ring(p, 52.40, 8.70, out=1.90, thickness=0.42, corbels=24,
                   rail=1.35, balusters=36)
    for (x, y, a) in K.radial(8, 10.30, phase=math.pi / 8.0):
        E.pinnacle(p, (x, y, 54.20), 6.40, 0.66, gold=g)

    # ---- the lantern chamber: the second void, and the light --------------
    p.lathe([(7.40, 54.60), (6.90, 56.20), (6.60, 58.40)], segments=32,
            smooth=False)
    for (x, y, a) in K.radial(16, 6.55):
        p.box(0.52, 0.72, 11.20, at=(x, y, 58.40), rot=(0, 0, a), chamfer=0.11,
              centre_z=False)
    gl.lathe([(6.30, 58.90), (6.30, 69.20)], segments=32, smooth=True,
             cap_bottom=False, cap_top=False)
    glc.lathe([(6.34, 63.60), (6.34, 65.90)], segments=32, smooth=True,
              cap_bottom=False, cap_top=False)
    E.corbel_table(p, 69.60, 6.70, count=24, depth=0.34, drop=0.52)
    p.lathe([(7.10, 70.12), (7.10, 71.40), (6.20, 72.60)], segments=32,
            smooth=False)

    # ---- eight flying ribs, leaning in ------------------------------------
    #
    # The kit's only structural diagonal used at hero scale. It is what stops
    # the top half being a second, thinner tower stacked on the first: the ribs
    # visibly CARRY the needle, so the eye reads one structure that narrows
    # rather than two objects that meet.
    for (x, y, a) in K.radial(8, 1.0):
        pts, rad = [], []
        for i in range(9):
            t = i / 8.0
            rr = 6.90 * (1.0 - t) + 2.30 * t
            pts.append((x * rr, y * rr, 71.60 + 12.20 * t ** 0.86))
            rad.append(0.52 - 0.20 * t)
        p.sweep(pts, rad, sides=5, cap=True)
        ga.sweep([(px * 1.02, py * 1.02, pz) for (px, py, pz) in pts[3:]],
                 [0.13] * (len(pts) - 3), sides=4, cap=False)

    # ---- the crown of pinnacles round the needle's foot -------------------
    p.lathe([(2.90, 83.20), (2.90, 84.60), (2.55, 85.40)], segments=20,
            smooth=False)
    E.merlon_ring(p, 84.60, 2.72, count=8, width=0.52, height=0.86)
    for (x, y, a) in K.radial(8, 3.05, phase=math.pi / 8.0):
        E.pinnacle(r, (x, y, 82.60), 8.40, 0.52, gold=g)

    # ---- the needle ------------------------------------------------------
    r.lathe(M.needle(2.45, 31.60, steps=13, concavity=0.48, z0=85.40),
            segments=20, smooth=True)
    for (x, y, a) in K.radial(6, 1.90):
        r.box(0.14, 0.14, 11.0, at=(x, y, 85.60), rot=(0, 0, a), centre_z=False)
    for t in (0.13, 0.30, 0.50, 0.72):
        z = 85.40 + 31.60 * t
        rr = 2.45 * (1.0 - t) ** 1.96
        g.lathe(M.moulding(rr * 1.03, z, ((0.28, 0.0), (0.06, 0.20),
                                          (-0.09, 0.20), (-0.25, 0.03))),
                segments=16)
    E.finial(p, (0.0, 0.0, 115.60), 2.60, radius=0.34, gold=g)

    return K.ModuleSpec(
        "WL_Hero_GreatSpire", "hero", "landmark", "hero",
        f.emit("WL_Hero_GreatSpire"),
        [K.Socket("bottom", 0.0, 16.4, "ground"),
         K.Socket("portal", 3.60, 11.60, "pier",
                  "eight walk-through portals, 5.9 m clear, on the base's octagon"),
         K.Socket("gallery", 52.40, 10.60, "bridge_end",
                  "the 52.4 m gallery is a legal skybridge landing"),
         K.Socket("top", 118.0, 0.0, "crown", "terminal")],
        districts=("city", "castle", "plaza"),
        note="118 m district capital: mass, belfry void, gallery, glazed lantern, "
             "eight flying ribs, 31.6 m needle",
        params={"height_m": 118.0, "belfry_bays": 12, "lantern_sides": 16,
                "flying_ribs": 8, "needle_h_m": 31.6},
        tri_budget=140000, collision=True)


def hero_gate_royal(f):
    """THE ROYAL GATE. 34 m, and the widest single thing in the kit.

    The second hero, and it answers a different question. The Great Spire is
    what you see from across the world; this is what you stand in front of. It
    is the founder reference's actual centre -- a monumental ceremonial
    entrance with a gold screen in it, flanked by turrets, ivy over everything
    -- built once at a scale that makes it the destination of a road rather
    than a thing beside one.

    22 m of clear opening: wide enough that `walkable.py` will route the Dog
    through it, and wide enough that it frames the city behind rather than
    hiding it, which is the mistake `6738435` recorded when fourteen landmarks
    were hidden by the avenues planted to dress them.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    r = f.part("roof")
    g = f.part("gold")
    gl = f.part("glass")
    v = f.part("veg_anchor")

    SPAN, RISE, SPRING = 22.0, 13.2, 15.0
    PIER, DEPTH = 6.4, 8.2
    OUT = SPAN * 0.5 + PIER

    for sgn in (-1.0, 1.0):
        x = sgn * (SPAN * 0.5 + PIER * 0.5)
        p.box(PIER * 1.14, DEPTH * 1.10, 1.60, at=(x, 0.0, 0.0), chamfer=0.32,
              centre_z=False)
        p.box(PIER, DEPTH, SPRING - 2.6, at=(x, 0.0, 1.60), chamfer=0.22,
              centre_z=False)
        for dy in (-1.0, 1.0):
            E.column(p, (x, dy * (DEPTH * 0.50 + 0.48), 1.60),
                     SPRING - 3.0, 0.86, flutes=12)
        E.window_arched(p, (x, -DEPTH * 0.50, 4.60), 1.90, 5.20, depth=0.42,
                        kind="ogee", glass_part=gl)
        p.box(PIER * 1.16, DEPTH * 1.08, 1.00, at=(x, 0.0, SPRING - 1.0),
              chamfer=0.20, centre_z=False)
        v.box(PIER * 0.62, 0.12, SPRING - 4.4, at=(x, -DEPTH * 0.45, 2.20),
              centre_z=False)
        v.box(0.12, DEPTH * 0.62, SPRING - 4.4, at=(x + sgn * PIER * 0.45, 0.0, 2.20),
              centre_z=False)

    E.arch_band(p, SPAN, RISE, DEPTH, 2.10, at=(0.0, 0.0, SPRING), kind="ogee",
                steps=21, keystone=True)
    d.box(SPAN * 0.98, DEPTH * 0.52, 1.10, at=(0.0, 0.0, SPRING - 0.14),
          centre_z=False)
    ENT = SPRING + RISE + 1.4
    E.arched_wall(p, SPAN, RISE, ENT - SPRING, OUT, DEPTH * 0.86, kind="ogee",
                  steps=21, thickness=2.10, at=(0.0, 0.0, SPRING))

    # the gold screen hung in the opening: the reference's own centrepiece
    for sgn in (-1.0, 1.0):
        E.filigree_panel(g, SPAN * 0.46, 12.4,
                         at=(sgn * SPAN * 0.245, 0.0, 6.42), bar=0.15,
                         cells_x=3, cells_y=6)
    E.arch_band(g, SPAN * 0.96, RISE * 0.42, 0.52, 0.40, at=(0.0, 0.0, 12.55),
                kind="ogee", steps=19)
    E.filigree_panel(g, SPAN * 0.80, RISE * 0.36, at=(0.0, 0.0, 14.90),
                     bar=0.11, cells_x=6, cells_y=2)

    p.box(SPAN + PIER * 2.0 + 1.4, DEPTH * 1.14, 0.90, at=(0.0, 0.0, ENT),
          chamfer=0.20, centre_z=False)
    p.box(SPAN + PIER * 2.0 + 2.4, DEPTH * 1.24, 1.15, at=(0.0, 0.0, ENT + 0.90),
          chamfer=0.26, centre_z=False)
    for i in range(13):
        x = -(OUT - 0.9) + (OUT - 0.9) * 2.0 * i / 12.0
        p.box(0.78, DEPTH * 0.96, 1.55, at=(x, 0.0, ENT + 2.05), chamfer=0.14,
              centre_z=False)
    # the flanking turrets, spelled from the tower family's own vocabulary
    for sgn in (-1.0, 1.0):
        cx = sgn * (SPAN * 0.5 + PIER * 0.5)
        m = M.xform((cx, 0.0, 0.0))
        p.lathe([(3.40, ENT + 2.05), (3.40, ENT + 6.40)], segments=20, matrix=m,
                smooth=False)
        for (x, y, a) in K.radial(6, 3.36):
            E.window_arched(p, (cx + x, y, ENT + 2.60), 0.90, 2.40, depth=0.26,
                            rot=(0, 0, a), kind="ogee", glass_part=gl)
        E.corbel_table(p, ENT + 6.40, 3.40, count=16, depth=0.34, drop=0.50,
                       matrix=m)
        p.lathe([(3.60, ENT + 6.98), (3.60, ENT + 8.20)], segments=20, matrix=m,
                smooth=False)
        E.merlon_ring(p, ENT + 8.20, 3.52, count=10, width=0.60, height=0.90,
                      matrix=m)
        r.lathe(M.needle(3.30, 9.40, steps=8, concavity=0.42, z0=ENT + 8.20),
                segments=20, matrix=m, smooth=True)
        E.finial(p, (cx, 0.0, ENT + 17.20), 2.10, radius=0.36, gold=g)
    E.finial(p, (0.0, 0.0, ENT + 3.60), 3.40, radius=0.56, gold=g)
    H = ENT + 18.6
    return K.ModuleSpec(
        "WL_Hero_Gate_Royal", "hero", "landmark", "hero",
        f.emit("WL_Hero_Gate_Royal"),
        [K.Socket("bottom", 0.0, OUT, "ground"),
         K.Socket("passage", 0.0, SPAN * 0.5, "pier",
                  "22.0 m clear opening, 15.0 m to the springing"),
         K.Socket("top", H, 0.0, "crown", "terminal")],
        districts=("royal_garden", "plaza", "city"),
        note="34 m ceremonial gate: 22 m ogee opening, hung gold screen, "
             "flanking needle turrets, ivy anchors",
        params={"span_m": SPAN, "clear_height_m": SPRING + RISE,
                "screen": "gold filigree, two leaves plus tympanum"},
        tri_budget=160000, collision=True)


BUILDERS = (hero_great_spire, hero_gate_royal)
