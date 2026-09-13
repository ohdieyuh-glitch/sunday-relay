"""Sky modules: the floating islands the Wonderland Bible puts over the city.

WHY A SKY FAMILY. Every one of the founder-approved Wonderland Bible boards (the visual authority
since 2026-09-13, wonderland/v2/reference/boards BOARD_1-6) puts FLOATING ISLANDS in the sky above
the skyline: a disc of lawn held in a stone lip, a rock underside that tapers to hanging points, and
a small castle standing on top. The world had balloons, clouds, keys and teacups in the air and no
island, and nothing in assets_v2 or this kit can be scaled into one -- a tower foot with a cone under
it is a tower with a cone under it.

WHAT AN ISLAND IS, IN THE KIT'S TERMS.
  * Its DATUM (z = 0) is the island's own ground: the lawn a castle foot stands on. Everything below
    is the underside, declared through `excavates` so the validator checks the measured depth.
  * It is a `terrace`: a level platform with a retained edge (the stone lip). A kit tower foot
    stands on its datum exactly as it stands on the world's ground, so no new join was invented.
  * The underside is not one cone. A single lathe reads as a spinning top; a main mass with a ring
    of smaller hanging masses at different depths reads as rock. No vertex noise is used, so the
    build stays deterministic and the tip depth stays exactly what the module declares.

Three sizes, because the Bible's sky has islands at several depths, and a sky of one island size
reads as a pattern.
"""

import math

from .. import kit as K
from .. import mesh as M


def _island(f, asset_id, top_r, depth, lobes, seed, note):
    rock = f.part("stone_dark")
    lawn = f.part("lawn")
    lip = f.part("stone")

    # THE LAWN: a shallow drum whose top is the datum. Its walls sit inside the lip.
    lawn.lathe([(0.0, -0.30), (top_r, -0.30), (top_r, 0.0), (0.0, 0.0)], segments=28, smooth=True)

    # THE LIP: a low stone kerb around the lawn, the retained edge of the terrace.
    lip.lathe([(top_r - 0.02, -0.75), (top_r + 0.38, -0.75), (top_r + 0.46, -0.40),
               (top_r + 0.38, 0.32), (top_r + 0.10, 0.40), (top_r - 0.02, 0.40)],
              segments=28, smooth=False, cap_bottom=False, cap_top=False)

    # THE MAIN MASS: tapers from just under the lip to the deepest point, with two ledges.
    prof = [(0.0, -depth)]
    steps = 8
    for i in range(1, steps + 1):
        t = i / float(steps)                      # 0 at the tip, 1 at the top
        r = top_r * 1.02 * (t ** 1.35)
        if i in (3, 6):
            r *= 1.10                             # a ledge
        prof.append((r, -depth + t * (depth - 0.55)))
    rock.lathe(prof, segments=16, smooth=False, cap_top=False)

    # HANGING MASSES: smaller points in a ring, each at its own bearing, reach and depth, all
    # shallower than the main tip so the declared depth stays the measured one.
    for k in range(lobes):
        ang = 2.0 * math.pi * (k + 0.5 * M.rnd(k, seed)) / lobes
        reach = top_r * M.rrange(0.38, 0.62, k, seed, 1)
        lobe_r = top_r * M.rrange(0.22, 0.34, k, seed, 2)
        lobe_d = depth * M.rrange(0.38, 0.72, k, seed, 3)
        cx, cy = reach * math.cos(ang), reach * math.sin(ang)
        lprof = [(0.0, -lobe_d)]
        for i in range(1, 6):
            t = i / 5.0
            lprof.append((lobe_r * (t ** 1.2), -lobe_d + t * (lobe_d - 0.9)))
        rock.lathe(lprof, segments=10, smooth=False, cap_top=False,
                   matrix=M.xform((cx, cy, 0.0), rot=(0.0, 0.0, math.degrees(ang))))

    return K.ModuleSpec(
        asset_id, "sky_island", "landmark", "terrace",
        f.emit(asset_id),
        [K.Socket("bottom", 0.0, top_r, "ground", "the island's own lawn: a kit foot stands here as on the world's ground"),
         K.Socket("edge", 0.40, top_r + 0.46, "edge", "the stone lip")],
        districts=("sky",),
        note=note,
        params={"top_radius_m": top_r, "underside_depth_m": depth, "hanging_masses": lobes},
        tri_budget=6000, nanite=False, collision=False, excavates=depth)


def sky_island_small(f):
    """A 9 m island: room for one slender tower and a tree. The far, high islands."""
    return _island(f, "WL_Sky_Island_Small", 4.6, 7.5, 4, 101,
                   "9 m lawn in a stone lip over a hanging rock underside; one tower's footing")


def sky_island_medium(f):
    """A 16 m island: a small castle -- a foot, a body, a crown -- and a garden edge."""
    return _island(f, "WL_Sky_Island_Medium", 8.0, 12.0, 5, 202,
                   "16 m lawn over a 12 m rock underside; a small castle's footing")


def sky_island_large(f):
    """A 26 m island: a castle group. The one the eye goes to."""
    return _island(f, "WL_Sky_Island_Large", 13.0, 18.0, 7, 303,
                   "26 m lawn over an 18 m rock underside; a castle group's footing")


BUILDERS = (sky_island_small, sky_island_medium, sky_island_large)
