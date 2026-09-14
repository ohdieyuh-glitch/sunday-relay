"""Mushrooms whose caps and stems are different things: toadstools with gills, spots and a skirt.

THE GAP (founder quality directive, 2026-09-13: "Mushrooms should have believable cap/stem material separation";
environment quality reference; GAP 20). Wonderland's medium and small mushrooms are single-slot meshes: one material
paints cap, underside and stem alike, so a rose toadstool is rose from the gills to the ground. The reference's
mushrooms are caps over pale stems, with pale gills under the cap and white spots on it.

WHAT A MUSHROOM IS HERE. Four parts, so each takes its own material:
  mush_cap   the dome, with a rolled rim -- a closed shell with an outer and an inner surface (MI_V2_MushRed)
  mush_gill  the underside: a pale disc under the cap and radial gill ribs on it (MI_V2_MushCream)
  mush_spot  raised spots laid on the dome along its surface normal (MI_V2_PetalWhite)
  mush_stem  a stalk with a bulbous base, a flare under the cap and a drooping skirt (MI_V2_MushStem)
Three silhouettes at the sizes of the world's own mushrooms: a toadstool (5.2 m cap, 6.5 m), a button (2.4 m, 3.2 m)
and a tall one (3.6 m cap on a 7.6 m stalk). Collision on the stalk only would be ideal; the kit's collision is per
module, so the toadstool and the tall one collide and the button does not.
"""

import math

from .. import kit as K
from .. import mesh as M


def _dome_points(rim_r, rim_z, top_z, steps=8, shoulder=0.88):
    """Outer dome from the rim to the pole: (r, z) from rim up."""
    pts = []
    for i in range(steps + 1):
        t = i / float(steps)
        r = rim_r * math.cos(t * math.pi * 0.5) ** shoulder
        z = rim_z + (top_z - rim_z) * math.sin(t * math.pi * 0.5)
        pts.append((max(r, 0.0), z))
    pts[-1] = (0.0, top_z)
    return pts


def _mushroom(f, asset_id, cap_r, rim_z, top_z, stem_r, base_r, skirt_z, spots, seed, gill_ribs, note, collision):
    cap, gill, spot, stem = f.part("mush_cap"), f.part("mush_gill"), f.part("mush_spot"), f.part("mush_stem")
    thick = cap_r * 0.08
    outer = _dome_points(cap_r, rim_z, top_z)
    # THE CAP: a closed shell -- up the inner surface from the underside centre, round the rolled rim, over the dome
    inner = [(0.0, rim_z + thick * 1.6), (cap_r * 0.35, rim_z + thick * 1.4), (cap_r * 0.75, rim_z + thick * 0.8),
             (cap_r * 0.95, rim_z + thick * 0.2)]
    rim = [(cap_r * 1.01, rim_z - thick * 0.25), (cap_r * 1.03, rim_z + thick * 0.4)]
    cap.lathe(inner + rim + outer[1:], segments=40, smooth=True)
    # THE GILLS: a pale disc just under the cap and radial ribs on it
    gz = rim_z + thick * 0.9
    gill.lathe([(0.0, gz), (cap_r * 0.92, rim_z + thick * 0.05), (cap_r * 0.92, rim_z - thick * 0.05), (0.0, gz - thick * 0.3)],
               segments=36, smooth=False)
    for k in range(gill_ribs):
        a = 360.0 * k / gill_ribs
        length = cap_r * 0.72
        gill.box(length, cap_r * 0.012, thick * 0.55, at=(0.0, 0.0, 0.0), centre_z=False,
                 matrix=M.xform((0.0, 0.0, rim_z - thick * 0.35), (0.0, -6.0, a)) @ M.xform((stem_r * 1.2 + length * 0.5, 0.0, 0.0)))
    # THE STEM: bulbous base, a slight waist, a flare under the cap
    h = rim_z + thick * 1.2
    stem.lathe([(0.0, 0.0), (base_r, 0.0), (base_r * 1.05, h * 0.06), (stem_r * 1.15, h * 0.16), (stem_r, h * 0.45),
                (stem_r * 0.95, h * 0.72), (stem_r * 1.35, h * 0.96), (0.0, h)], segments=24, smooth=True)
    if skirt_z:
        stem.lathe([(stem_r * 0.98, skirt_z + 0.10), (stem_r * 1.9, skirt_z - 0.18), (stem_r * 1.85, skirt_z - 0.26),
                    (stem_r * 1.02, skirt_z - 0.02)], segments=24, smooth=True)
    # THE SPOTS: raised discs on the dome, each along its surface normal
    for k in range(spots):
        u = M.rrange(0.18, 0.86, k, seed, 1)
        yaw = M.rrange(0.0, 360.0, k, seed, 2)
        i = int(u * (len(outer) - 1))
        (r0, z0), (r1, z1) = outer[i], outer[min(i + 1, len(outer) - 1)]
        w = u * (len(outer) - 1) - i
        r, z = r0 + (r1 - r0) * w, z0 + (z1 - z0) * w
        # the profile tangent (dr, dz); the outward normal is (dz, -dr) turned into a tilt from vertical
        dr, dz = (r1 - r0) or 1e-6, (z1 - z0)
        tilt = math.degrees(math.atan2(dz, -dr)) - 90.0
        size = cap_r * M.rrange(0.05, 0.11, k, seed, 3)
        ya = math.radians(yaw)
        spot.lathe([(0.0, 0.0), (size, 0.0), (size * 0.75, size * 0.18), (0.0, size * 0.24)], segments=10, smooth=True,
                   matrix=M.xform((r * math.cos(ya), r * math.sin(ya), z - size * 0.05), (0.0, -tilt, yaw)))
    return K.ModuleSpec(
        asset_id, "mushrooms", "landmark", "hero", f.emit(asset_id),
        [K.Socket("bottom", 0.0, base_r, "ground", "the stalk's bulb on the ground")],
        districts=("mushroom_grove", "royal_garden", "plaza", "tea_terrace", "grove"),
        note=note,
        params={"cap_radius_m": cap_r, "height_m": top_z, "spots": spots, "gill_ribs": gill_ribs},
        tri_budget=14000, nanite=True, collision=collision)


def mushroom_toadstool(f):
    return _mushroom(f, "WL_Mushroom_Toadstool", 2.6, 4.9, 6.5, 0.46, 0.78, 4.0, 26, 2001, 48,
                     "5.2 m toadstool: rose cap with a rolled rim, pale gills and ribs under it, white spots, a pale stalk "
                     "with a bulb and a drooping skirt -- four parts, four materials", True)


def mushroom_button(f):
    return _mushroom(f, "WL_Mushroom_Button", 1.2, 2.3, 3.2, 0.24, 0.40, 0.0, 12, 2002, 28,
                     "2.4 m button mushroom: round cap, gills, spots, pale stalk", False)


def mushroom_tall(f):
    return _mushroom(f, "WL_Mushroom_Tall", 1.8, 6.6, 7.6, 0.30, 0.55, 5.4, 16, 2003, 40,
                     "3.6 m cap on a 7.6 m stalk: a shallow cap over a tall pale stalk with a skirt", True)


BUILDERS = (mushroom_toadstool, mushroom_button, mushroom_tall)
