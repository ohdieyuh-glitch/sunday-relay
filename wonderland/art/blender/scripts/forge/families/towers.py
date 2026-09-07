"""The Wonderland skyline kit: feet, bodies, crowns and needles.

THE REFERENCE GAP THIS FAMILY ANSWERS, stated before any geometry.

Put `reference/marble-royal-garden-cam0-founder-reference.png` beside
`reference/renders/V2_MILESTONE26_HeroCam0_1080p.png` and the skylines are not
the same KIND of thing:

  reference   dozens of towers, tightly packed, receding through four or five
              depth planes. The dominant unit is a SLENDER SHAFT under a very
              tall thin roof -- height-to-width somewhere past 8:1, with the
              roof alone often as tall as the shaft. Galleries and balconies
              break every shaft, and you can see sky through them.
  current     about a dozen towers, each roughly 2:1, solid drums under wide
              cone or onion roofs. They read as chunky turrets. The frame's
              top belongs to vegetation, which PASS 32 measured at 69.8%.

The world session already named this: "the reference's gold is in the garden,
and its skyline is needles" (`9655bad`). Needles are not a material problem or
a placement problem. There was no needle to place.

So this family is built around three deliberate decisions:

1. **PROPORTION IS A MODULE PROPERTY, NOT A SCALE FACTOR.** The generator
   could stretch an existing tower to 8:1, and it would get a stretched
   tower: string courses a storey tall, windows the size of doors. Instead
   the bodies here are authored slender, with their detail sized for the
   radius they actually have.

2. **EVERY CROWN IS TALLER THAN IT IS WIDE.** `WL_Tower_Crown_Cone` is 15.6 m
   over a 3.0 m socket. That single ratio is most of the difference between
   the two images above.

3. **PIERCED, NOT SOLID.** Three of the seven bodies and two of the seven
   crowns have real openings (`elements.arcade_ring`). A gallery you can see
   through is what makes a 90 m tower read as architecture at 400 m.

THE STACK. Every module publishes `bottom` and `top` sockets on the radius
ladder in `kit.py`, so the Unreal generator spells towers rather than placing
them:

    Base_Arcaded (XL) -> Mid_Ashlar (XL->XL) -> Mid_Arcade (XL->L)
                      -> Mid_Balconied (L->M) -> Crown_Cone (M)
                      -> Spire_Needle

`build_assets.py` counts the legal spellings and writes the number into the
manifest, so it is a measured fact and not a sales figure.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M


# ==========================================================================
# FEET -- what a tower stands on. bottom = ground, top = XL.
# ==========================================================================

XL, L, MD, S = K.LADDER["XL"], K.LADDER["L"], K.LADDER["M"], K.LADDER["S"]

#: A `crown` socket with radius 0 means FINISHED: the module ends the stack and
#: nothing stands on it. Written once so the reason travels with every use.
#:
#: The kit tried the other grammar first -- crowns publishing a real S-rung
#: socket so a needle could stand on one -- and the geometry refused it. On
#: `WL_Tower_Crown_Cone` the height at which the cone is 1.80 m wide is 5.2 m
#: up a 12.2 m cone, so a needle placed on that socket sprouts from the side of
#: the roof. The reference does not stack a needle on a cone either: its towers
#: are a shaft with ONE tall roof. So spires became an ALTERNATIVE terminator
#: rather than an addition -- they now stand on the M rung, competing with the
#: M crowns for the top of a stack, which is both what the picture shows and
#: what the geometry allows.
TERMINAL = "terminal: the stack ends here"


def tower_base_battered(f):
    """A battered plinth: the simplest foot, and the one that reads as WEIGHT.

    Batter (an inward slope) is the whole idea. A vertical drum meeting the
    ground gives one silhouette line and no sense of load; a wall that leans
    in as it rises says the thing above it is heavy, which is what makes a
    90 m needle believable rather than pasted on.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    H = 9.2
    d.lathe([(XL * 1.34, 0.0), (XL * 1.34, 0.85)], segments=32, cap_bottom=True)
    p.lathe(M.moulding(XL * 1.34, 0.85, M.CORNICE_CAVETTO), segments=32)
    body = p.lathe([(XL * 1.26, 1.45), (XL, H - 1.1)], segments=32, smooth=False)
    p.displace(body, 0.030, 1.6, seed=11)
    E.rib_set(p, 1.45, H - 1.1, XL * 1.20, count=8, width=0.86, out=0.20)
    E.string_course(p, H - 1.1, XL, run=M.CORNICE_CORBEL)
    p.lathe([(XL, H - 0.28), (XL, H)], segments=32, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Base_Battered", "tower_base", "module", "foot",
        f.emit("WL_Tower_Base_Battered"),
        [K.Socket("bottom", 0.0, XL * 1.34, "ground"), K.top(H, XL)],
        districts=("city", "castle", "hamlet"),
        note="battered plinth, 8 corner ribs, corbelled string course",
        params={"batter": 0.26, "ribs": 8}, tri_budget=9000)


def tower_base_arcaded(f):
    """An OPEN undercroft: ten piers, ten round arches, sky between them.

    The most valuable foot in the kit. A tower standing on an arcade has a
    horizon line UNDER it, which does two things nothing else does: it makes
    the tower look tall by putting a measurable gap beneath it, and it lets a
    district's light through so a row of towers does not become a wall.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    H = 12.4
    r_arc = XL * 1.22
    d.lathe([(r_arc * 1.12, 0.0), (r_arc * 1.12, 0.70)], segments=36)
    p.lathe(M.moulding(r_arc * 1.12, 0.70, M.CORNICE_STRING), segments=36)
    E.arcade_ring(p, 1.10, r_arc, bays=10, height=H - 3.0, pier=0.78,
                  depth=1.30, kind="round", columns=True)
    d.lathe([(r_arc * 0.52, 1.10), (r_arc * 0.52, H - 1.9)], segments=20)
    E.corbel_table(p, H - 1.9, r_arc, count=30, depth=0.38, drop=0.56)
    p.lathe([(r_arc * 1.02, H - 1.30), (XL * 1.06, H - 0.45), (XL, H)],
            segments=36, smooth=False)
    return K.ModuleSpec(
        "WL_Tower_Base_Arcaded", "tower_base", "module", "foot",
        f.emit("WL_Tower_Base_Arcaded"),
        [K.Socket("bottom", 0.0, r_arc * 1.12, "ground"), K.top(H, XL)],
        districts=("city", "plaza", "castle"),
        note="open ten-bay round arcade with a core pier; you see sky under the tower",
        params={"bays": 10, "arch": "round"}, tri_budget=26000)


def tower_base_buttressed(f):
    """Six spur buttresses with sloped weatherings. The cathedral foot.

    Buttresses are the cheapest way to make a footprint irregular. A round
    plinth has one silhouette from every angle; six spurs give a different
    outline every 30 degrees, so a row of these does not look like a row of
    one thing.
    """
    p = f.part("stone")
    d = f.part("stone_dark")
    H = 10.8
    d.lathe([(XL * 1.10, 0.0), (XL * 1.10, 0.62)], segments=30)
    core = p.lathe([(XL * 1.06, 0.62), (XL, H - 1.2)], segments=30, smooth=False)
    p.displace(core, 0.028, 1.9, seed=23)
    # Each spur is a STEPPED buttress: three stages, each shorter and shallower
    # than the one below, with a sloped weathering over each offset. Stepped
    # rather than smoothly tapered because the offsets catch light as three
    # separate horizontals, which is what makes a buttress read at distance --
    # a smooth ramp reads as one grey triangle.
    for (x, y, a) in K.radial(6, XL * 0.86):
        m = M.xform((x, y, 0.0), (0.0, 0.0, a))
        for (reach, half, z0, z1) in ((3.30, 1.16, 0.62, 3.60),
                                      (2.35, 0.98, 3.60, 6.70),
                                      (1.45, 0.82, 6.70, H - 1.2)):
            p.prism([(0.0, -half), (reach, -half * 0.72), (reach, half * 0.72),
                     (0.0, half)], z1 - z0, z0=z0, matrix=m)
            # the weathering: a wedge shedding water off the offset
            p.loft([[(reach, -half * 0.72, z1), (reach, half * 0.72, z1),
                     (0.0, half, z1), (0.0, -half, z1)],
                    [(reach * 0.30, -half * 0.60, z1 + 0.62),
                     (reach * 0.30, half * 0.60, z1 + 0.62),
                     (0.0, half * 0.86, z1 + 0.86),
                     (0.0, -half * 0.86, z1 + 0.86)]],
                   matrix=m, smooth=False)
    E.string_course(p, H - 1.2, XL, run=M.CORNICE_CORBEL)
    p.lathe([(XL, H - 0.30), (XL, H)], segments=30, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Base_Buttressed", "tower_base", "module", "foot",
        f.emit("WL_Tower_Base_Buttressed"),
        [K.Socket("bottom", 0.0, XL * 1.10 + 3.4, "ground"), K.top(H, XL)],
        districts=("castle", "city", "cloister"),
        note="six spur buttresses with weatherings; an irregular plan from every bearing",
        params={"spurs": 6}, tri_budget=14000)



def tower_base_terraced(f):
    """Three stepped octagonal terraces with a balustrade. The ceremonial foot.

    For the tower a district is arranged around. The steps are walkable at
    Wonderland's own scale (0.32 m risers in three flights), which matters
    because `walkable.py` audits step height over every surface in the world
    and a decorative stair that fails it becomes a wall.
    """
    p = f.part("stone")
    H = 7.6
    for i, (r, z, h) in enumerate(((XL * 1.92, 0.0, 1.30),
                                   (XL * 1.56, 1.30, 1.30),
                                   (XL * 1.24, 2.60, 1.40))):
        p.prism(M.ngon(8, r, phase=math.pi / 8.0), h, z0=z)
        E.string_course(p, z + h - 0.24, r * 0.9239, run=M.CORNICE_STRING, segments=8)
        # THE TREADS STOP ONE SHORT OF THE TOP, and that is not a detail.
        # `prism` caps the WHOLE polygon, so a "lip" ring is really a full
        # disc. A tread whose top landed at z + h therefore laid a second disc
        # exactly on the terrace's own top face -- two coincident coplanar
        # faces, which rendered as solid black across every terrace. Three
        # treads per terrace, the fourth being the terrace top itself.
        for k in range(3):
            zz = z + h * (k + 1) / 4.0
            p.prism(M.ngon(8, r * 1.03, phase=math.pi / 8.0), 0.06, z0=zz - 0.06)
    E.balcony_ring(p, 4.00, XL * 1.15, out=0.42, thickness=0.24, corbels=16,
                   rail=1.05, balusters=24)
    p.lathe([(XL * 1.16, 5.30), (XL * 1.04, H - 0.55)], segments=30, smooth=False)
    E.string_course(p, H - 0.55, XL, run=M.CORNICE_STRING)
    p.lathe([(XL, H - 0.20), (XL, H)], segments=30, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Base_Terraced", "tower_base", "module", "foot",
        f.emit("WL_Tower_Base_Terraced"),
        [K.Socket("bottom", 0.0, XL * 1.92, "ground"), K.top(H, XL)],
        districts=("plaza", "royal_garden", "castle"),
        note="three walkable octagonal terraces and a balustrade; the ceremonial foot",
        params={"terraces": 3, "riser_m": 0.325}, tri_budget=18000)


# ==========================================================================
# BODIES -- the repeatable middle.
# ==========================================================================


def tower_mid_ashlar(f):
    """XL -> XL. The plain storey, and the one the kit needs most.

    Every other body here is an event. A stack of nothing but events is
    noise, and the reference's towers are mostly quiet wall with two or three
    incidents up them. This is the quiet wall: entasis, two string courses,
    three bands of slit windows, and a 3 cm displacement that stops the
    cylinder reading as extrusion.
    """
    p = f.part("stone")
    H = 14.6
    body = p.lathe(M.entasis(XL, XL * 0.985, 0.0, H, steps=7, belly=0.028),
                   segments=30, smooth=False, cap_bottom=False, cap_top=False)
    p.displace(body, 0.032, 1.4, seed=41)
    for z in (4.30, 9.60):
        E.string_course(p, z, XL * 0.99, run=M.CORNICE_STRING)
    for i, z in enumerate((1.55, 6.05, 11.10)):
        E.slit_ring(p, z, XL * 0.995, count=8, width=0.34, height=2.35,
                    depth=0.26, phase=0.22 * i)
    p.lathe([(XL, H - 0.30), (XL, H)], segments=30, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Mid_Ashlar", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Ashlar"),
        [K.bottom(XL), K.top(H, XL)],
        districts=("city", "castle", "hamlet", "cloister"),
        note="the quiet storey: entasis, two string courses, three slit bands",
        params={"storeys": 3, "entasis": 0.028}, tri_budget=11000)


def tower_mid_arcade(f):
    """XL -> L. An open gallery storey that also does the taper.

    Two jobs in one module, on purpose. A kit that separates 'pierced storey'
    from 'taper storey' needs both in every stack and gets tall towers with a
    lot of middle; combining them means the moment a tower narrows is also the
    moment you can see through it, which is exactly the reading the reference
    has at its third and fourth storeys.
    """
    p = f.part("stone")
    g = f.part("glass")
    H = 13.2
    E.corbel_table(p, 0.0, XL, count=28, depth=0.34, drop=0.48)
    E.arcade_ring(p, 0.62, XL * 0.97, bays=12, height=8.2, pier=0.62,
                  depth=1.02, kind="pointed", columns=True, glass_part=g)
    p.lathe([(XL * 0.52, 0.62), (XL * 0.52, 8.5)], segments=20)
    E.corbel_table(p, 8.82, XL * 0.99, count=28, depth=0.32, drop=0.46)
    p.lathe([(XL * 0.99, 9.40), (L * 1.06, H - 0.55)], segments=28, smooth=False)
    E.string_course(p, H - 0.55, L, run=M.CORNICE_STRING)
    p.lathe([(L, H - 0.20), (L, H)], segments=28, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Mid_Arcade", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Arcade"),
        [K.bottom(XL), K.top(H, L)],
        districts=("city", "plaza", "castle"),
        note="twelve-bay pointed gallery, glazed, tapering XL to L in one storey",
        params={"bays": 12, "arch": "pointed"}, tri_budget=34000)


def tower_mid_ribbed(f):
    """L -> L. Ten ribs the full height. The vertical accelerator.

    Verticals are how a shaft reads as tall. The ribs are only 22 cm proud and
    they change the silhouette more than doubling the height would: at
    distance the eye reads the rib shadows as a fluted line and the tower
    stops having a measurable width.
    """
    p = f.part("stone")
    H = 16.4
    body = p.lathe(M.entasis(L, L * 0.96, 0.0, H, steps=6, belly=0.022),
                   segments=26, smooth=False, cap_bottom=False, cap_top=False)
    p.displace(body, 0.026, 1.7, seed=57)
    E.rib_set(p, 0.30, H - 1.30, L * 0.99, count=10, width=0.42, out=0.22)
    E.string_course(p, 5.20, L * 0.99, run=M.CORNICE_ASTRAGAL)
    E.string_course(p, 10.80, L * 0.98, run=M.CORNICE_ASTRAGAL)
    E.corbel_table(p, H - 1.30, L * 0.97, count=20, depth=0.30, drop=0.44)
    p.lathe([(L, H - 0.30), (L, H)], segments=26, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Mid_Ribbed", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Ribbed"),
        [K.bottom(L), K.top(H, L)],
        districts=("city", "castle", "clock"),
        note="ten full-height ribs; the module that makes a shaft read tall",
        params={"ribs": 10}, tri_budget=15000)


def tower_mid_balconied(f):
    """L -> M. A shaft with a projecting gallery and ogee windows.

    The balcony is the module's whole purpose. `elements.balcony_ring` is the
    kit's strongest single detail: it breaks the vertical, throws a hard
    horizontal shadow, and says somebody lives there. The reference has one on
    almost every tower; the current world has none on any.
    """
    p = f.part("stone")
    g = f.part("glass")
    H = 12.8
    body = p.lathe(M.entasis(L, MD * 1.06, 0.0, H, steps=6, belly=0.024),
                   segments=24, smooth=False, cap_bottom=False, cap_top=False)
    p.displace(body, 0.024, 1.8, seed=73)
    for (x, y, a) in K.radial(6, L * 0.995, phase=0.26):
        E.window_arched(p, (x, y, 1.70), 1.02, 2.85, depth=0.30, rot=(0, 0, a),
                        kind="ogee", glass_part=g)
    E.balcony_ring(p, 6.40, L * 0.965, out=0.98, thickness=0.30, corbels=18,
                   rail=1.15, balusters=26)
    for (x, y, a) in K.radial(5, MD * 1.14, phase=0.60):
        E.window_arched(p, (x, y, 8.60), 0.86, 2.30, depth=0.26, rot=(0, 0, a),
                        kind="ogee", glass_part=g)
    E.string_course(p, H - 0.62, MD * 1.04, run=M.CORNICE_STRING)
    p.lathe([(MD, H - 0.24), (MD, H)], segments=24, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Mid_Balconied", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Balconied"),
        [K.bottom(L), K.top(H, MD)],
        districts=("city", "hamlet", "royal_garden", "tea_terrace"),
        note="projecting balcony gallery and two bands of ogee windows; L to M",
        params={"balcony_z_m": 6.40, "windows": 11}, tri_budget=27000)


def tower_mid_lantern(f):
    """M -> M. A glazed storey. The kit's only light source.

    `materials_v2.py` gives `MI_V2_GlassAmber` an emissive of 620, so this
    module glows in the world without a light actor. One of these two-thirds
    of the way up a needle is what makes a night skyline, and it is the reason
    the kit bothers to have a `glass` part at all.
    """
    p = f.part("stone")
    g = f.part("glass")
    H = 9.0
    p.lathe([(MD * 1.10, 0.0), (MD * 1.10, 0.55), (MD * 1.02, 0.90)],
            segments=22, smooth=False)
    for (x, y, a) in K.radial(8, MD * 1.00):
        p.box(0.40, 0.52, 6.35, at=(x, y, 0.90), rot=(0, 0, a), chamfer=0.09,
              centre_z=False)
    g.lathe([(MD * 0.96, 1.05), (MD * 0.96, 7.10)], segments=22, smooth=True,
            cap_bottom=False, cap_top=False)
    E.corbel_table(p, 7.25, MD * 1.02, count=16, depth=0.28, drop=0.40)
    p.lathe([(MD * 1.04, 7.90), (MD, H - 0.22), (MD, H)], segments=22,
            smooth=False, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Mid_Lantern", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Lantern"),
        [K.bottom(MD), K.top(H, MD)],
        districts=("city", "clock", "tea_terrace", "plaza"),
        note="eight-mullion glazed storey; emissive glass, so the tower lights itself",
        params={"mullions": 8, "glass_h_m": 6.05}, tri_budget=7000)


def tower_mid_fluted(f):
    """M -> M. A slender fluted shaft: the needle's actual body.

    16.8 m over a 3.0 m radius is 2.8:1 for one module, and two of them
    stacked put the crown at 8:1 over the shaft that carries it. This is the
    module that makes the reference's proportion reachable.
    """
    p = f.part("stone")
    H = 16.8
    plan = M.lobed_ngon(12, MD * 0.94, MD * 0.075, segments_per_lobe=3)
    sections = []
    for i in range(8):
        t = i / 7.0
        r = (1.0 - 0.10 * t) * (1.0 + 0.020 * math.sin(math.pi * t ** 0.85))
        sections.append([(px * r, py * r, H * t) for (px, py) in plan])
    p.loft(sections, smooth=True)
    p.lathe([(MD * 1.08, 0.0), (MD * 1.08, 0.42), (MD * 0.98, 0.70)],
            segments=24, smooth=False)
    for z in (5.60, 11.20):
        E.string_course(p, z, MD * 0.90, run=M.CORNICE_ASTRAGAL, segments=24)
    E.corbel_table(p, H - 1.05, MD * 0.88, count=14, depth=0.26, drop=0.38)
    p.lathe([(MD, H - 0.24), (MD, H)], segments=24, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Mid_Fluted", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Fluted"),
        [K.bottom(MD), K.top(H, MD)],
        districts=("city", "clock", "cloister", "plaza"),
        note="twelve-lobe fluted slender shaft, 2.8:1 in one module",
        params={"flutes": 12, "aspect": 2.8}, tri_budget=9000)


def tower_mid_oriel(f):
    """L -> L. Three projecting bay windows on corbels.

    Asymmetry, deliberately. Every other body in the kit is rotationally
    regular, and a district built only from regular modules looks turned on a
    lathe. Three oriels at 120 degrees give a tower a FRONT, so the generator
    can face it at a street.
    """
    p = f.part("stone")
    g = f.part("glass")
    H = 13.4
    body = p.lathe(M.entasis(L, L * 0.94, 0.0, H, steps=6, belly=0.022),
                   segments=24, smooth=False, cap_bottom=False, cap_top=False)
    p.displace(body, 0.026, 1.6, seed=91)
    for (x, y, a) in K.radial(3, L * 0.92, phase=0.35):
        m = M.xform((x, y, 0.0), (0, 0, a))
        p.lathe([(0.0, 3.10), (1.05, 3.55), (1.28, 4.10), (1.20, 4.55)],
                segments=10, arc=190.0, matrix=m, smooth=False)
        plan = [(0.30, -1.22), (1.55, -0.86), (1.55, 0.86), (0.30, 1.22)]
        p.prism(plan, 4.60, z0=4.40, matrix=m)
        g.prism([(0.36, -1.06), (1.42, -0.74), (1.42, 0.74), (0.36, 1.06)],
                3.55, z0=4.85, matrix=m)
        p.lathe([(1.62, 9.00), (1.30, 9.42), (0.0, 10.05)], segments=10,
                arc=190.0, matrix=m, smooth=True)
    E.string_course(p, 10.60, L * 0.95, run=M.CORNICE_STRING)
    E.corbel_table(p, H - 1.20, L * 0.95, count=20, depth=0.30, drop=0.44)
    p.lathe([(L, H - 0.26), (L, H)], segments=24, cap_top=True)
    return K.ModuleSpec(
        "WL_Tower_Mid_Oriel", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Oriel"),
        [K.bottom(L), K.top(H, L)],
        districts=("hamlet", "city", "tea_terrace"),
        note="three corbelled oriel bays at 120 degrees; gives a tower a front",
        params={"oriels": 3}, tri_budget=19000)


# ==========================================================================
# CROWNS -- how a stack ends. top socket is `crown` at S.
# ==========================================================================


def tower_crown_cone(f):
    """M. THE crown. A parapet, then a 12.2 m hollow-sided cone on a 3 m socket.

    If only one module from this session reaches the world, it should be this
    one. The founder reference's skyline is made of this shape repeated at
    four depths; the current world's nearest equivalent is a wide low cone
    whose height is about its own diameter. The profile is
    `mesh.needle(concavity=0.42)`: it leaves the eaves almost vertically and
    only turns in over the last third, which is what makes a cone look like a
    spire instead of a hat.
    """
    p = f.part("stone")
    r = f.part("roof")
    g = f.part("gold")
    H = 15.6
    E.corbel_table(p, 0.0, MD, count=16, depth=0.30, drop=0.44)
    p.lathe([(MD * 1.06, 0.50), (MD * 1.06, 1.90)], segments=22, smooth=False)
    E.merlon_ring(p, 1.90, MD * 1.02, count=12, width=0.46, height=0.72)
    r.lathe(M.needle(MD * 1.02, 12.20, steps=9, concavity=0.42, z0=2.10),
            segments=22, smooth=True)
    for (x, y, a) in K.radial(8, MD * 0.86):
        r.box(0.16, 0.16, 4.6, at=(x * 0.9, y * 0.9, 2.30), rot=(0, 0, a),
              chamfer=0.04, centre_z=False)
    E.finial(p, (0.0, 0.0, 14.05), 1.55, radius=0.30, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Crown_Cone", "tower_crown", "module", "crown",
        f.emit("WL_Tower_Crown_Cone"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "castle", "hamlet", "clock", "plaza"),
        note="the reference's dominant crown: parapet plus a 12.2 m concave cone, 4:1",
        params={"cone_h_m": 12.20, "concavity": 0.42, "aspect": 4.07},
        tri_budget=6000)


def tower_crown_tiered(f):
    """M. Three diminishing conical tiers with gold collars between.

    The second-commonest crown in the reference and a different rhythm from
    the plain cone: it steps, so it catches light three times up its height
    and reads at a distance where a single cone has gone to a silhouette.
    """
    p = f.part("stone")
    r = f.part("roof_alt")
    g = f.part("gold")
    H = 13.4
    E.corbel_table(p, 0.0, MD, count=16, depth=0.28, drop=0.40)
    z = 0.46
    radius = MD * 1.04
    for i, (h, shrink) in enumerate(((4.30, 0.70), (3.55, 0.66), (2.70, 0.0))):
        if shrink:
            r.lathe(M.bell(radius, h, steps=8, flare=0.16, z0=z), segments=20,
                    smooth=True)
            g.lathe(M.moulding(radius * shrink * 1.10, z + h * 0.86, (
                (0.14, 0.0), (0.03, 0.12), (-0.05, 0.12), (-0.12, 0.02))),
                segments=18)
            radius *= shrink
            z += h * 0.86
        else:
            r.lathe(M.needle(radius, h, steps=6, concavity=0.36, z0=z),
                    segments=16, smooth=True)
            z += h
    E.finial(p, (0.0, 0.0, z - 0.20), 1.35, radius=0.26, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Crown_Tiered", "tower_crown", "module", "crown",
        f.emit("WL_Tower_Crown_Tiered"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "hamlet", "tea_terrace", "clock"),
        note="three flared tiers with gold collars; lilac roof, the second colour",
        params={"tiers": 3}, tri_budget=6500)


def tower_crown_onion(f):
    """L. A bulb dome on a windowed drum, with eight gold ribs.

    The current world already has onion domes and they are the one crown it
    gets right; this is the same idea authored to the kit's socket so it can
    be spelled onto any L stack, with ribs and a lantern the existing one
    lacks.
    """
    p = f.part("stone")
    r = f.part("roof")
    g = f.part("gold")
    gl = f.part("glass")
    H = 14.2
    E.corbel_table(p, 0.0, L, count=20, depth=0.30, drop=0.44)
    p.lathe([(L * 1.02, 0.50), (L * 1.02, 3.90)], segments=26, smooth=False)
    for (x, y, a) in K.radial(8, L * 1.015):
        E.window_arched(p, (x, y, 0.90), 0.78, 2.30, depth=0.26, rot=(0, 0, a),
                        kind="round", glass_part=gl)
    E.string_course(p, 3.90, L * 1.02, run=M.CORNICE_CAVETTO)
    r.lathe(M.onion(L * 1.06, 7.10, steps=16, z0=4.35), segments=26, smooth=True)
    for (x, y, a) in K.radial(8, 1.0):
        pts = []
        for i in range(9):
            t = i / 8.0
            rr = L * 1.06 * (1.16 * math.sin(math.pi * (0.12 + 0.80 * t)) ** 0.85) * (1.0 - t ** 3.2)
            pts.append((x * (rr + 0.09), y * (rr + 0.09), 4.35 + 7.10 * t))
        g.sweep(pts, [0.115] * 9, sides=4, cap=False)
    g.lathe([(0.0, 11.30), (0.46, 11.42), (0.40, 11.95), (0.0, 12.10)],
            segments=12, smooth=True)
    E.finial(p, (0.0, 0.0, 12.05), 2.15, radius=0.36, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Crown_Onion", "tower_crown", "module", "crown",
        f.emit("WL_Tower_Crown_Onion"),
        [K.bottom(L), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "royal_garden", "plaza", "castle"),
        note="windowed drum, ribbed onion dome, gold ribs and finial",
        params={"ribs": 8, "drum_windows": 8}, tri_budget=17000)


def tower_crown_belvedere(f):
    """L. An open lantern: eight columns, eight arches, sky straight through.

    A crown you can see through, which no crown in the current world is. Put
    one on the tallest tower in a district and the whole district reads as
    lighter, because its highest point stops being a solid block against sky.
    """
    p = f.part("stone")
    r = f.part("roof")
    g = f.part("gold")
    H = 15.0
    E.corbel_table(p, 0.0, L, count=20, depth=0.30, drop=0.44)
    p.lathe([(L * 1.04, 0.50), (L * 1.04, 1.35)], segments=26, smooth=False)
    E.balcony_ring(p, 1.35, L * 1.00, out=0.66, thickness=0.24, corbels=16,
                   rail=1.00, balusters=22)
    E.arcade_ring(p, 2.80, L * 0.82, bays=8, height=6.40, pier=0.56, depth=0.86,
                  kind="ogee", columns=True, spandrel=False)
    E.corbel_table(p, 9.30, L * 0.86, count=16, depth=0.26, drop=0.38)
    r.lathe(M.needle(L * 0.90, 4.40, steps=7, concavity=0.34, z0=9.80),
            segments=20, smooth=True)
    E.finial(p, (0.0, 0.0, 13.90), 1.20, radius=0.24, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Crown_Belvedere", "tower_crown", "module", "crown",
        f.emit("WL_Tower_Crown_Belvedere"),
        [K.bottom(L), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "plaza", "royal_garden", "tea_terrace"),
        note="open eight-bay ogee lantern; the only crown you can see sky through",
        params={"bays": 8, "arch": "ogee"}, tri_budget=24000)


def tower_mid_machicolated(f):
    """XL -> M. A battlemented belfry stage: the kit's big taper in one module.

    Written first as a crown and changed, which is worth recording. As a crown
    it was the only one on the XL rung, so it terminated a tower at about 20 m
    and nothing could follow it. As a STAGE it does more: it takes the widest
    rung straight down to the narrowest, so `Base + Machicolated + Spire` is a
    legal three-module tower, and every M crown and every spire can stand on
    it. The corbelled parapet and the crenellations are unchanged; what it
    grew was a flat leaded deck and a drum, which is what a real belfry has
    under its spire anyway.
    """
    p = f.part("stone")
    r = f.part("roof")
    g = f.part("gold")
    H = 9.4
    E.corbel_table(p, 0.0, XL, count=34, depth=0.42, drop=0.70)
    p.lathe([(XL * 1.10, 0.78), (XL * 1.10, 2.60)], segments=32, smooth=False)
    E.merlon_ring(p, 2.60, XL * 1.06, count=18, width=0.72, height=1.20)
    # the leaded deck inside the parapet, then the drum the next module sits on
    r.lathe([(XL * 1.02, 2.60), (XL * 0.30, 3.05), (0.0, 3.20)], segments=32,
            smooth=False)
    p.lathe([(MD * 1.18, 3.05), (MD * 1.18, 5.10)], segments=24, smooth=False)
    for (x, y, a) in K.radial(8, MD * 1.16):
        E.window_arched(p, (x, y, 3.25), 0.66, 1.85, depth=0.22, rot=(0, 0, a),
                        kind="pointed", sill=False)
    E.corbel_table(p, 5.10, MD * 1.14, count=16, depth=0.28, drop=0.40)
    p.lathe([(MD * 1.12, 5.70), (MD, H - 0.24), (MD, H)], segments=24,
            smooth=False, cap_top=True)
    for (x, y, a) in K.radial(4, XL * 1.02, phase=0.39):
        E.pinnacle(p, (x, y, 3.10), 4.20, 0.34, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Mid_Machicolated", "tower_mid", "module", "body",
        f.emit("WL_Tower_Mid_Machicolated"),
        [K.bottom(XL), K.top(H, MD)],
        districts=("castle", "city", "hamlet"),
        note="machicolated parapet, leaded deck, four corner pinnacles; XL to M in one stage",
        params={"merlons": 18, "corner_pinnacles": 4}, tri_budget=17000)


def tower_crown_cap(f):
    """M. A mushroom cap, with a rolled rim, gills and spots.

    Wonderland, not generic fantasy. `WONDERLAND_ART_DIRECTION.md` lists
    'giant red-and-white spotted mushrooms ... at several scales' from the
    founder reference, and the reference image has mushroom-roofed buildings
    in the mid-distance on both sides. Making one a CROWN rather than a prop
    means the generator can put the motif in the skyline instead of only on
    the ground.
    """
    p = f.part("stone")
    r = f.part("roof")
    g = f.part("gold")
    H = 11.2
    E.corbel_table(p, 0.0, MD, count=16, depth=0.28, drop=0.40)
    p.lathe([(MD * 1.02, 0.46), (MD * 0.92, 2.40)], segments=22, smooth=False)
    for (x, y, a) in K.radial(6, MD * 0.96):
        E.window_arched(p, (x, y, 0.70), 0.62, 1.55, depth=0.22, rot=(0, 0, a),
                        kind="round", sill=False)
    cap = [(0.0, 2.40), (MD * 1.30, 3.10), (MD * 1.86, 4.35), (MD * 1.98, 5.30),
           (MD * 1.72, 6.30), (MD * 1.05, 7.60), (0.0, 8.35)]
    r.lathe(cap, segments=30, smooth=True)
    r.lathe([(MD * 1.98, 5.30), (MD * 2.06, 4.95), (MD * 1.92, 4.62),
             (MD * 1.74, 4.72)], segments=30, smooth=True)
    for k in range(28):
        a = math.pi * 2.0 * k / 28.0
        rr = MD * (1.10 + 0.62 * M.rnd(k, 3))
        p.lathe([(0.0, 0.0), (0.30, 0.05), (0.26, 0.16), (0.0, 0.20)],
                 segments=8, smooth=True,
                 matrix=M.xform((math.cos(a) * rr, math.sin(a) * rr,
                                 4.35 + 1.65 * (1.0 - rr / (MD * 1.9)))))
    for k in range(26):
        a = math.pi * 2.0 * k / 26.0
        r.box(0.10, MD * 0.74, 0.42, at=(math.cos(a) * MD * 1.35,
                                         math.sin(a) * MD * 1.35, 4.05),
              rot=(0, 0, math.degrees(a)), centre_z=False)
    E.finial(p, (0.0, 0.0, 8.10), 1.45, radius=0.28, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Crown_Cap", "tower_crown", "module", "crown",
        f.emit("WL_Tower_Crown_Cap"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("mushroom_grove", "hamlet", "grove", "tea_terrace"),
        note="mushroom-cap crown with rolled rim, gills and spots; the motif, in the skyline",
        params={"gills": 26, "spots": 28}, tri_budget=16000)


def tower_crown_ribbed(f):
    """L. A ribbed melon dome on a low drum. The calm crown.

    Twelve ribs over a hemisphere. It is the least dramatic crown in the kit,
    which is why it is here: the reference's skyline is mostly needles, but
    the calm domes between them are what let the needles read as spikes.
    """
    p = f.part("stone")
    r = f.part("roof_alt")
    g = f.part("gold")
    H = 11.6
    E.corbel_table(p, 0.0, L, count=20, depth=0.28, drop=0.42)
    p.lathe([(L * 1.02, 0.48), (L * 1.02, 2.05)], segments=26, smooth=False)
    E.string_course(p, 2.05, L * 1.02, run=M.CORNICE_STRING)
    dome = []
    for i in range(11):
        t = i / 10.0
        dome.append((L * 1.04 * math.cos(t * math.pi * 0.5),
                     2.45 + 5.90 * math.sin(t * math.pi * 0.5)))
    r.lathe(dome, segments=26, smooth=True)
    for (x, y, a) in K.radial(12, 1.0):
        pts = []
        for i in range(9):
            t = i / 8.0
            rr = L * 1.04 * math.cos(t * math.pi * 0.5) + 0.10
            pts.append((x * rr, y * rr, 2.45 + 5.90 * math.sin(t * math.pi * 0.5)))
        p.sweep(pts, [0.13] * 9, sides=4, cap=False)
    g.lathe([(0.0, 8.30), (0.62, 8.44), (0.54, 9.05), (0.0, 9.25)],
            segments=14, smooth=True)
    E.finial(p, (0.0, 0.0, 9.15), 2.20, radius=0.34, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Crown_Ribbed", "tower_crown", "module", "crown",
        f.emit("WL_Tower_Crown_Ribbed"),
        [K.bottom(L), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("cloister", "plaza", "city", "water_garden"),
        note="twelve-rib melon dome; the calm crown that makes the needles read as spikes",
        params={"ribs": 12}, tri_budget=13000)


def tower_crown_pavilion(f):
    """XL. A broad flared roof with eight dormers. The kit's widest terminator.

    ADDED AFTER A STRUCTURAL HOLE, and the hole is worth recording because the
    kit's own rule found it rather than a person. Making `Machicolated` a body
    left the XL rung with bodies but no crown, so `Foot + Mid_Ashlar` was a
    legal stack that could never be finished -- the first spelling test drew
    exactly that: a tower with an open top. `validate_assets.py` now asserts
    that EVERY rung a body can leave you on has at least one terminator, and
    this module is what makes the XL rung satisfy it.

    It earns its place independently: the reference's middle distance is full
    of wide, low, flare-roofed buildings sitting under the needles, and a
    skyline of nothing but spires has no floor.
    """
    p = f.part("stone")
    r = f.part("roof")
    g = f.part("gold")
    gl = f.part("glass")
    H = 13.8
    E.corbel_table(p, 0.0, XL, count=34, depth=0.40, drop=0.62)
    p.lathe([(XL * 1.14, 0.70), (XL * 1.14, 2.30)], segments=32, smooth=False)
    for (x, y, a) in K.radial(10, XL * 1.13):
        E.window_arched(p, (x, y, 0.95), 0.80, 1.15, depth=0.24, rot=(0, 0, a),
                        kind="round", sill=False, glass_part=gl)
    E.string_course(p, 2.30, XL * 1.14, run=M.CORNICE_CAVETTO, segments=32)
    r.lathe(M.bell(XL * 1.26, 8.60, steps=11, flare=0.20, z0=2.75),
            segments=32, smooth=True)
    # dormers: the detail that gives a broad roof a scale to be read against
    for i, (x, y, a) in enumerate(K.radial(8, XL * 0.98, phase=0.20)):
        m = M.xform((x, y, 0.0), (0.0, 0.0, a))
        r.prism([(-0.05, -0.72), (1.05, -0.72), (1.05, 0.72), (-0.05, 0.72)],
                1.55, z0=3.90, matrix=m)
        r.lathe(M.needle(1.02, 1.70, steps=5, concavity=0.24, z0=5.45),
                segments=8, matrix=m, smooth=True)
        gl.box(0.86, 0.10, 1.05, at=(0.98, 0.0, 4.15), matrix=m, centre_z=False)
    g.lathe([(0.0, 11.10), (0.72, 11.28), (0.60, 11.95), (0.0, 12.20)],
            segments=16, smooth=True)
    E.finial(p, (0.0, 0.0, 12.05), 1.75, radius=0.32, gold=g)
    return K.ModuleSpec(
        "WL_Tower_Crown_Pavilion", "tower_crown", "module", "crown",
        f.emit("WL_Tower_Crown_Pavilion"),
        [K.bottom(XL), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("hamlet", "city", "plaza", "tea_terrace", "mushroom_grove"),
        note="broad flared roof with eight dormers; the XL rung's terminator",
        params={"dormers": 8, "flare": 0.20}, tri_budget=22000)


# ==========================================================================
# NEEDLES -- an alternative terminator, on the M rung. See TERMINAL above.
# ==========================================================================


def spire_needle(f):
    """S. 24.6 m on a 1.80 m socket: 13.7:1, and the tallest thin thing in the kit.

    The single asset the phrase "its skyline is needles" is asking for. It has
    almost no detail on purpose -- at the height this sits, detail is invisible
    and only the outline survives, so every triangle goes into the outline
    being a slightly hollow curve rather than a straight cone.
    """
    p = f.part("roof")
    st = f.part("stone")
    g = f.part("gold")
    H = 24.6
    st.lathe([(MD, 0.0), (MD, 0.42), (MD * 0.96, 0.70), (S * 1.02, 0.90)],
             segments=18, smooth=False)
    p.lathe(M.needle(S * 1.02, 22.4, steps=11, concavity=0.46, z0=0.90),
            segments=16, smooth=True)
    for (x, y, a) in K.radial(4, S * 0.80):
        p.box(0.11, 0.11, 8.2, at=(x, y, 1.10), rot=(0, 0, a), centre_z=False)
    E.finial(st, (0.0, 0.0, 22.90), 1.70, radius=0.22, gold=g)
    return K.ModuleSpec(
        "WL_Spire_Needle", "spire", "module", "needle",
        f.emit("WL_Spire_Needle"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "castle", "clock", "plaza", "hamlet"),
        note="13.7:1 hollow-sided needle; the shape the reference skyline is made of",
        params={"aspect": 13.67, "concavity": 0.46}, tri_budget=2000)


def spire_barbed(f):
    """S. A needle with four flying pinnacles round its foot.

    One silhouette becomes five. This is how the reference's towers get a
    barbed outline without any single element being complicated, and it is
    much cheaper than modelling five towers.
    """
    p = f.part("roof")
    st = f.part("stone")
    g = f.part("gold")
    H = 21.0
    st.lathe([(MD * 1.06, 0.0), (MD * 1.06, 0.52), (MD, 0.82), (S * 1.06, 1.15)],
             segments=18, smooth=False)
    for (x, y, a) in K.radial(4, S * 1.24, phase=math.pi / 4.0):
        E.pinnacle(p, (x, y, 0.70), 7.4, 0.40, gold=g)
        st.box(0.34, 0.34, 1.35, at=(x * 0.72, y * 0.72, 0.70), rot=(0, 0, a),
               chamfer=0.07, centre_z=False)
    p.lathe(M.needle(S * 1.00, 18.9, steps=10, concavity=0.44, z0=1.15),
            segments=16, smooth=True)
    E.finial(st, (0.0, 0.0, 19.60), 1.50, radius=0.22, gold=g)
    return K.ModuleSpec(
        "WL_Spire_Barbed", "spire", "module", "needle",
        f.emit("WL_Spire_Barbed"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "castle", "clock"),
        note="needle plus four flying pinnacles; one silhouette becomes five",
        params={"pinnacles": 4}, tri_budget=5000)


def spire_twisted(f):
    """S. A needle with a 140-degree twist up its length.

    Wonderland is meant to be UNFAMILIAR. A twisted spire is the cheapest
    unfamiliar thing in architecture: the profile is a needle, but the eight
    arris lines spiral, so the shape changes as the camera moves past it and
    no two frames of a fly-through show the same tower.
    """
    p = f.part("roof")
    st = f.part("stone")
    g = f.part("gold")
    H = 22.8
    st.lathe([(MD, 0.0), (MD, 0.44), (MD * 0.94, 0.72), (S * 1.04, 0.95)],
             segments=18, smooth=False)
    sections = []
    steps = 16
    for i in range(steps + 1):
        t = i / float(steps)
        rr = S * 1.02 * (1.0 - t) ** 1.88
        twist = math.radians(140.0 * t)
        ring = []
        for k in range(8):
            a = twist + math.pi * 2.0 * k / 8.0
            lobe = 1.0 + 0.16 * (1.0 - t)
            ring.append((math.cos(a) * rr * lobe, math.sin(a) * rr * lobe,
                         0.95 + 20.9 * t))
        sections.append(ring)
    p.loft(sections, smooth=True, cap_ends=True)
    E.finial(st, (0.0, 0.0, 21.30), 1.55, radius=0.20, gold=g)
    return K.ModuleSpec(
        "WL_Spire_Twisted", "spire", "module", "needle",
        f.emit("WL_Spire_Twisted"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "clock", "mushroom_grove"),
        note="140-degree helical twist; the outline changes as the camera moves",
        params={"twist_deg": 140.0}, tri_budget=3000)


def spire_ringed(f):
    """S. A needle wearing four gold collars.

    Gold at height. `9655bad` found the reference's gold is in the GARDEN and
    moved the world's gold down; that was right, and it left the skyline with
    none. Four small collars are enough to catch sun at 400 m without turning
    the roofline yellow, and they measure the spire's height for the eye.
    """
    p = f.part("roof_alt")
    st = f.part("stone")
    g = f.part("gold")
    H = 20.2
    st.lathe([(MD, 0.0), (MD, 0.46), (MD * 0.94, 0.74), (S * 1.04, 1.00)],
             segments=18, smooth=False)
    p.lathe(M.needle(S * 1.02, 18.1, steps=10, concavity=0.40, z0=1.00),
            segments=16, smooth=True)
    for i, t in enumerate((0.16, 0.36, 0.58, 0.79)):
        z = 1.00 + 18.1 * t
        rr = S * 1.02 * (1.0 - t) ** 1.80
        g.lathe(M.moulding(rr * 1.02, z, ((0.20, 0.0), (0.05, 0.16),
                                          (-0.07, 0.16), (-0.18, 0.02))),
                segments=14)
    E.finial(st, (0.0, 0.0, 18.70), 1.50, radius=0.20, gold=g)
    return K.ModuleSpec(
        "WL_Spire_Ringed", "spire", "module", "needle",
        f.emit("WL_Spire_Ringed"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "royal_garden", "plaza", "clock"),
        note="four gold collars up a lilac needle; gold at height, without a yellow roofline",
        params={"collars": 4}, tri_budget=3500)


def spire_cluster(f):
    """S. A central needle surrounded by five shorter ones on a shared base.

    The reference's densest passages are not single spires, they are BUNCHES:
    a tall one with subordinates crowding it, so the outline has five points
    at three heights. One of these does more for a skyline than three separate
    towers, and it costs less than one.
    """
    p = f.part("roof")
    st = f.part("stone")
    g = f.part("gold")
    H = 18.4
    st.lathe([(MD * 1.12, 0.0), (MD * 1.12, 0.62), (MD * 1.02, 0.95), (S * 1.20, 1.25)],
             segments=20, smooth=False)
    E.merlon_ring(st, 1.25, S * 1.28, count=8, width=0.28, height=0.42)
    for i, (x, y, a) in enumerate(K.radial(5, S * 1.10, phase=0.31)):
        h = 8.6 + 2.4 * M.rnd(i, 7)
        E.pinnacle(p, (x, y, 1.20), h, 0.46, gold=g)
    p.lathe(M.needle(S * 0.78, 16.2, steps=9, concavity=0.42, z0=1.25),
            segments=14, smooth=True)
    E.finial(st, (0.0, 0.0, 16.90), 1.45, radius=0.20, gold=g)
    return K.ModuleSpec(
        "WL_Spire_Cluster", "spire", "module", "needle",
        f.emit("WL_Spire_Cluster"),
        [K.bottom(MD), K.Socket("top", H, 0.0, "crown", TERMINAL)],
        districts=("city", "castle", "clock", "plaza"),
        note="one tall needle and five subordinates; five points at three heights",
        params={"subordinates": 5}, tri_budget=8000)


#: Build order. `build_assets.py` walks this; nothing else enumerates them.
BUILDERS = (
    tower_base_battered, tower_base_arcaded, tower_base_buttressed,
    tower_base_terraced,
    tower_mid_ashlar, tower_mid_arcade, tower_mid_ribbed, tower_mid_balconied,
    tower_mid_lantern, tower_mid_fluted, tower_mid_oriel,
    tower_mid_machicolated,
    tower_crown_cone, tower_crown_tiered, tower_crown_onion,
    tower_crown_belvedere, tower_crown_cap, tower_crown_pavilion,
    tower_crown_ribbed,
    spire_needle, spire_barbed, spire_twisted, spire_ringed, spire_cluster,
)
