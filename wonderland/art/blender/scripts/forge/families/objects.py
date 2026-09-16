"""Wonderland object language: the timepieces, keys and tea things the Bible scatters through the world.

WHY. The Wonderland Bible boards (the visual authority since 2026-09-13) give the world its own object
vocabulary -- "Clocks & Timepieces", "Keys & Locks", "Teapot & Tea Sets" (BOARD_1 "Wonderland Object
Language", BOARD_4 panel 06, BOARD_5 panel 10, BOARD_6 "Props & Wonderland Object Language") -- and the
hero panels stand a big gold POCKET CLOCK beside the path. The world's only clock mesh (assets_v2
`clock_ornate`) is one material slot, so its dial is as gold as its case; near the eye it reads as a gold
disc rather than a clock.

A pocket clock here is a gold case, bezel, crown and bow around an ENAMEL dial with gold hour marks and
hands, so the dial reads as a face at any distance. It is modelled flat (dial normal +Z) and turned so the
dial faces +X, the kit's module front, standing on its edge with the case's lowest point on the datum.
"""

import math

from .. import kit as K
from .. import mesh as M


def object_pocket_clock(f):
    """A 3 m gold pocket clock standing on its edge: the Bible's clock beside the hero path."""
    gold = f.part("gold")
    dial = f.part("enamel")

    R = 1.50                                   # case radius, m
    H = R * 1.02                               # the case's outer lip touches the datum
    to_world = M.xform((0.0, 0.0, H), rot=(0.0, 90.0, 0.0))    # clock +Z (dial normal) -> world +X

    def m(at=(0.0, 0.0, 0.0), rot=(0.0, 0.0, 0.0)):
        return to_world @ M.xform(at, rot)

    # CASE: a closed ring section swept about the dial axis (a tube, so no caps and no coplanar faces).
    case = [(R * 0.90, -0.22), (R * 0.93, -0.27), (R * 1.00, -0.19), (R * 1.02, 0.0),
            (R * 1.00, 0.17), (R * 0.95, 0.25), (R * 0.90, 0.21), (R * 0.90, -0.22)]
    gold.lathe(case, segments=48, smooth=True, matrix=to_world)
    # BACK: a shallow gold dome closing the case behind the dial.
    gold.lathe([(0.0, -0.33), (R * 0.45, -0.31), (R * 0.80, -0.27), (R * 0.905, -0.225)],
               segments=48, smooth=True, cap_top=False, matrix=to_world)

    # DIAL: a thin enamel disc just inside the case.
    dial.lathe([(0.0, 0.08), (R * 0.895, 0.08), (R * 0.895, 0.13), (0.0, 0.13)], segments=48, smooth=False,
               matrix=to_world)

    # BEZEL: a gold ring standing proud of the dial.
    gold.lathe([(R * 0.84, 0.145), (R * 0.905, 0.145), (R * 0.93, 0.235), (R * 0.84, 0.215), (R * 0.84, 0.145)],
               segments=48, smooth=True, matrix=to_world)

    # HOUR MARKS: twelve gold bars, the quarters doubled. Clock "12" is clock -X, which the turn makes world up.
    for k in range(12):
        phi = math.radians(30.0 * k)
        ang = math.degrees(math.atan2(math.sin(phi), -math.cos(phi)))
        cx, cy = -math.cos(phi) * R * 0.70, math.sin(phi) * R * 0.70
        long_bar = k % 3 == 0
        for off in ((-0.045, 0.045) if long_bar else (0.0,)):
            ox, oy = -math.sin(phi) * off, -math.cos(phi) * off
            gold.box(0.30 if long_bar else 0.20, 0.055, 0.04, at=(cx + ox, cy + oy, 0.155), rot=(0.0, 0.0, ang),
                     matrix=to_world)

    # HANDS at ten past ten, and a boss over their pivot.
    for (phi_deg, length, width) in ((305.0, 0.62, 0.10), (60.0, 0.98, 0.07)):
        phi = math.radians(phi_deg)
        ang = math.degrees(math.atan2(math.sin(phi), -math.cos(phi)))
        cx, cy = -math.cos(phi) * length * 0.5, math.sin(phi) * length * 0.5
        gold.box(length, width, 0.035, at=(cx, cy, 0.19), rot=(0.0, 0.0, ang), matrix=to_world)
    gold.lathe([(0.0, 0.17), (0.09, 0.17), (0.09, 0.23), (0.0, 0.26)], segments=16, smooth=True, matrix=to_world)

    # CROWN and BOW on top (clock -X): a fluted stem with a ring through it, in the dial plane.
    gold.lathe([(0.12, 0.0), (0.12, 0.10), (0.16, 0.12), (0.16, 0.30), (0.10, 0.34), (0.0, 0.35)],
               segments=16, smooth=False, cap_bottom=False, matrix=m(at=(-R * 0.99, 0.0, 0.0), rot=(0.0, -90.0, 0.0)))
    bow = [(0.30, -0.05), (0.40, -0.05), (0.40, 0.05), (0.30, 0.05), (0.30, -0.05)]
    gold.lathe(bow, segments=28, smooth=True, matrix=m(at=(-R * 0.99 - 0.35 - 0.36, 0.0, 0.0)))

    return K.ModuleSpec(
        "WL_Object_PocketClock", "pocket_clock", "landmark", "hero",
        f.emit("WL_Object_PocketClock"),
        [K.Socket("bottom", 0.0, 0.30, "ground", "stands on its case edge; a pedestal or the ground carries it")],
        districts=("plaza", "royal_garden", "clock"),
        note="3 m gold pocket clock on its edge: gold case, bezel, crown and bow, enamel dial with gold marks and hands",
        params={"case_radius_m": R, "time": "10:10"},
        tri_budget=9000, nanite=False, collision=True)


def _bez3(p0, p1, p2, p3, steps):
    out = []
    for i in range(steps + 1):
        t = i / float(steps)
        u = 1.0 - t
        out.append(tuple(u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d
                         for a, b, c, d in zip(p0, p1, p2, p3)))
    return out


def _body_radius(z, profile):
    """The body's radius at height z, read off its lathe profile (for things that sit ON the surface)."""
    for (r0, z0), (r1, z1) in zip(profile[:-1], profile[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return r0 + (r1 - r0) * (z - z0) / (z1 - z0)
    return profile[-1][0]


def _surface_tilt(z, profile):
    """Degrees the body's outward normal at height z tilts UP from horizontal (negative: down)."""
    for (r0, z0), (r1, z1) in zip(profile[:-1], profile[1:]):
        if z0 <= z <= z1 and z1 > z0:
            return math.degrees(math.atan2(-(r1 - r0), (z1 - z0)))
    return 0.0


def object_teapot_pavilion(f):
    """A 19 m porcelain teapot: the Tea Terraces' landmark, as the Bible draws a teapot.

    WHY (2026-09-16, TeapotCam24): the world's teapot pavilion is a low-poly single-material mesh; it reads as white
    plaster, and gloss on its material (TEA01) only exposed its facets. The Bible's teapots are porcelain with gold
    rims and painted roses. This one is SMOOTH (64-segment revolves, swept spout and handle), white enamel, with a
    gold foot, belly band, shoulder rim, lid rim and knob, a ring of rose medallions above the band, and porthole
    windows lit from inside -- it is a pavilion.

    Spout toward +Y, handle toward -Y, so the classic silhouette is seen from +X / -X, the kit's front and back.
    """
    en = f.part("enamel")
    g = f.part("gold")
    rose = f.part("roof")
    leaf = f.part("veg_anchor")
    gl = f.part("glass")
    SEG = 64
    body = [(5.30, 0.30), (5.70, 0.60), (6.60, 1.30), (7.50, 2.40), (8.20, 3.80), (8.60, 5.40), (8.70, 6.60),
            (8.50, 8.10), (7.90, 9.60), (6.90, 10.90), (5.80, 11.90), (5.10, 12.40)]
    en.lathe([(0.0, 0.30)] + body, segments=SEG, smooth=True, cap_bottom=False, cap_top=True)
    # foot ring
    g.lathe([(5.05, 0.0), (6.05, 0.0), (6.20, 0.18), (6.00, 0.42), (5.60, 0.64), (5.05, 0.64)], segments=SEG,
            smooth=True)
    # belly band: follows the body's widest girth
    g.lathe([(8.62, 6.10), (8.86, 6.22), (8.92, 6.60), (8.86, 6.98), (8.62, 7.10)], segments=SEG, smooth=True,
            cap_bottom=False, cap_top=False)
    # shoulder rim and lid
    g.lathe([(4.85, 12.30), (5.55, 12.30), (5.75, 12.55), (5.55, 12.85), (4.85, 12.85)], segments=SEG, smooth=True)
    en.lathe([(5.30, 12.85), (4.70, 13.60), (3.60, 14.60), (2.10, 15.30), (0.90, 15.55), (0.0, 15.60)],
             segments=SEG, smooth=True, cap_bottom=False)
    g.lathe([(0.0, 15.50), (0.80, 15.55), (1.05, 15.95), (0.70, 16.35), (0.55, 16.55), (1.00, 17.10),
             (0.85, 17.75), (0.45, 18.15), (0.0, 18.40)], segments=24, smooth=True, cap_bottom=False)
    # spout: rises from the belly toward +Y and turns up
    spout = _bez3((0.0, 7.6, 4.2), (0.0, 11.5, 4.6), (0.0, 12.6, 9.0), (0.0, 14.8, 12.9), 18)
    radii = [2.10 - 1.35 * (i / 18.0) ** 0.8 for i in range(19)]
    en.sweep(spout, radii, sides=24, smooth=True, cap=True)
    tip = _bez3(spout[-2], spout[-2], spout[-1], (0.0, 15.05, 13.25), 3)
    g.sweep(tip, [0.84, 0.86, 0.88, 0.86], sides=24, smooth=True, cap=True)
    # handle: a loop on -Y, thickest at its middle
    handle = _bez3((0.0, -8.2, 10.0), (0.0, -13.8, 11.4), (0.0, -14.2, 3.4), (0.0, -8.4, 3.6), 22)
    en.sweep(handle, [0.70 + 0.22 * math.sin(math.pi * i / 22.0) for i in range(23)], sides=20, smooth=True, cap=True)
    for (y, z) in ((-8.15, 10.0), (-8.35, 3.6)):
        g.lathe([(0.0, -0.18), (1.05, -0.18), (1.10, 0.18), (0.0, 0.18)], segments=24, smooth=True,
                matrix=M.xform((0.0, y, z), (90.0, 0.0, 0.0)))
    # rose medallions above the band, clear of the spout and handle roots. Each sits on the surface along the body's
    # own normal there (the shoulder leans in, so the normal tilts up), and is a rose at a street's distance: a
    # 2 m cushion of three petal tiers, a pair of leaves.
    ZR = 8.70
    rr = _body_radius(ZR, body)
    tilt = _surface_tilt(ZR, body)
    for k in range(10):
        th = 2.0 * math.pi * (k + 0.5) / 10.0
        deg = math.degrees(th)
        if min(abs((deg - 90.0 + 180.0) % 360.0 - 180.0), abs((deg - 270.0 + 180.0) % 360.0 - 180.0)) < 24.0:
            continue
        x, y = math.cos(th) * (rr - 0.18), math.sin(th) * (rr - 0.18)
        mat = M.xform((x, y, ZR), (0.0, 90.0 - tilt, deg))
        rose.lathe([(1.00, 0.0), (1.02, 0.16), (0.86, 0.34), (0.70, 0.36), (0.72, 0.50), (0.52, 0.66), (0.38, 0.66),
                    (0.36, 0.78), (0.16, 0.90), (0.0, 0.88)], segments=20, smooth=True, cap_bottom=False, matrix=mat)
        for sgn in (-1.0, 1.0):
            leaf.lathe([(0.0, -0.45), (0.28, -0.20), (0.30, 0.20), (0.0, 0.50)], segments=8, smooth=True,
                       matrix=mat @ M.xform((0.10, sgn * 1.15, 0.0), (0.0, 90.0, sgn * 70.0)))
    # porthole windows, lit, in gold rings, round the lower belly -- set along the body's normal there, which tilts
    # DOWN (the belly still widens), so the whole disc stands proud of the enamel instead of half sinking into it
    ZW = 4.20
    rw = _body_radius(ZW, body)
    tilt = _surface_tilt(ZW, body)
    for deg in (0.0, 38.0, 142.0, 180.0, 218.0, 322.0):
        th = math.radians(deg)
        x, y = math.cos(th) * (rw - 0.10), math.sin(th) * (rw - 0.10)
        mat = M.xform((x, y, ZW), (0.0, 90.0 - tilt, deg))
        gl.lathe([(0.0, 0.00), (0.80, 0.00), (0.80, 0.16), (0.0, 0.22)], segments=24, smooth=False, matrix=mat)
        g.lathe([(0.80, 0.0), (1.06, 0.0), (1.10, 0.26), (0.88, 0.32), (0.80, 0.24)], segments=24, smooth=True,
                cap_bottom=False, cap_top=False, matrix=mat)
    return K.ModuleSpec(
        "WL_Object_TeapotPavilion", "teapot", "landmark", "hero",
        f.emit("WL_Object_TeapotPavilion"),
        [K.Socket("bottom", 0.0, 6.0, "ground", "stands on its gold foot")],
        districts=("tea_terrace",),
        note="19 m porcelain teapot pavilion: smooth enamel body, swept spout and handle, gold foot, band, rims and knob, rose medallions, lit portholes",
        params={"height_m": 18.4, "belly_radius_m": 8.7},
        tri_budget=40000, nanite=False, collision=True)


BUILDERS = (object_pocket_clock, object_teapot_pavilion)
