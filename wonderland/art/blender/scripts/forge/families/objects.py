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


BUILDERS = (object_pocket_clock,)
