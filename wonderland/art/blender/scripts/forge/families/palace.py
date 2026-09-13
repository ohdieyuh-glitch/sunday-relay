"""Palaces and domes: the layered palace city of the Wonderland Bible.

THE REFERENCE GAP (VISUAL_AUTHORITY.md; BOARD_1 "Architecture Detail References" and "Depth & Scale
References", BOARD_2 landmarks). Between the garden and the needles, the Bible's city is PALACES: long
ivory fronts of two and three tall storeys -- an arcaded ground floor, a piano nobile of round-headed
windows between pilasters, a cornice and a balustrade -- under steep lavender and rose mansard roofs with
dormers and gold cresting, broken by taller corner pavilions, and over them a great ribbed DOME on a
columned drum. The founder's private-beta list names it directly: "more domes", "layered palace/city
architecture".

The kit could not spell any of it. Its buildings are 6 m houses and towers; its only dome is the onion
crown on the L rung. A palace front built from houses reads as a terrace, and a tower cannot be scaled
into a drum without its windows becoming doors (towers.py, decision 1).

THREE MODULES, ONE ORDER. They share storey heights so they join without a step:

    ground storey   0.00 - 5.20 m   rusticated, arcaded
    piano nobile    5.40 - 11.40 m  tall round-headed windows between pilasters with gold capitals
    entablature    11.40 - 12.40 m  a projecting cornice, then a balustrade

  WL_Palace_Wing        24 x 12 m, five bays, a mansard roof. Ends are plain butt walls (end_a/end_b),
                        so wings run in a row and a pavilion closes them.
  WL_Palace_Pavilion    14 x 14 m, three bays a face and one more storey, under a tall pavilion roof and a
                        lantern: the vertical accent a long front needs.
  WL_Palace_Dome_Grand  a 34 m podium with a portico, a columned drum and a ribbed dome with a lantern:
                        the landmark. Its shell is a `roof_alt` part, so a layer may lay it in lilac, rose,
                        blue or gold (the Bible's great dome is gold) by choosing that batch's material.

Facade detail is built in a FACE FRAME (local x along the wall, local +y out of it, z up), so one window
routine serves all four faces and the drum.
"""

import math

from .. import elements as E
from .. import kit as K
from .. import mesh as M

GROUND_H = 5.20
NOBILE_Z0, NOBILE_Z1 = 5.40, 11.40
CORNICE_Z = 11.40
PARAPET_Z = 12.40


def _face(face, w, d):
    """A matrix whose local x runs along the named wall, local +y points out of it, origin on the wall."""
    return {"+y": M.xform((0.0, d * 0.5, 0.0), (0.0, 0.0, 0.0)),
            "-y": M.xform((0.0, -d * 0.5, 0.0), (0.0, 0.0, 180.0)),
            "+x": M.xform((w * 0.5, 0.0, 0.0), (0.0, 0.0, -90.0)),
            "-x": M.xform((-w * 0.5, 0.0, 0.0), (0.0, 0.0, 90.0))}[face]


def _window(stone, glass, gold, mat, cx, z, width, height, kind="round", proud=0.30):
    """A round-headed window in a face frame: jambs, an arch head with a gold keystone, a sill, glazing."""
    jamb = width * 0.15
    rise = width * 0.5 * (1.35 if kind == "ogee" else 1.0)
    body = height - rise
    for sgn in (-1.0, 1.0):
        stone.box(jamb, proud, body, at=(cx + sgn * (width * 0.5 - jamb * 0.5), proud * 0.5, z),
                  matrix=mat, chamfer=jamb * 0.2, centre_z=False)
    E.arch_band(stone, width, rise, proud, jamb, at=(cx, proud * 0.5, z + body), kind=kind, steps=9, matrix=mat)
    gold.box(jamb * 1.1, proud * 1.15, jamb * 1.5, at=(cx, proud * 0.55, z + body + rise + jamb * 0.2),
             matrix=mat, chamfer=jamb * 0.15, centre_z=False)
    stone.box(width * 1.30, proud * 1.5, jamb * 0.8, at=(cx, proud * 0.6, z - jamb * 0.8),
              matrix=mat, chamfer=jamb * 0.15, centre_z=False)
    glass.box(width - jamb * 2.0, 0.06, body + rise * 0.72, at=(cx, 0.05, z), matrix=mat, centre_z=False)


def _arcade_opening(stone, dark, gold, mat, cx, width, height, proud=0.45):
    """A ground-storey arch: a deep dark recess framed by a rusticated surround."""
    jamb = width * 0.16
    rise = width * 0.5
    body = height - rise
    dark.box(width - 0.10, 0.05, body + rise * 0.8, at=(cx, 0.04, 0.55), matrix=mat, centre_z=False)
    for sgn in (-1.0, 1.0):
        stone.box(jamb, proud, body - 0.55, at=(cx + sgn * (width * 0.5 - jamb * 0.5), proud * 0.5, 0.55),
                  matrix=mat, chamfer=jamb * 0.2, centre_z=False)
    E.arch_band(stone, width, rise, proud, jamb * 1.1, at=(cx, proud * 0.5, body), kind="round", steps=10,
                keystone=True, matrix=mat)


def _pilaster(stone, gold, mat, cx, z0, z1, width=0.70):
    stone.box(width, 0.34, z1 - z0 - 0.40, at=(cx, 0.17, z0), matrix=mat, chamfer=0.05, centre_z=False)
    gold.box(width * 1.28, 0.46, 0.40, at=(cx, 0.23, z1 - 0.40), matrix=mat, chamfer=0.06, centre_z=False)


def _balustrade(stone, mat, length, z, height=1.10, spacing=0.46, butt=False):
    """A straight balustrade along local x on the face line: plinth, turned balusters, coping.

    `butt` runs it the full length (a wall that joins its neighbour); otherwise it stops short of the corners."""
    run = length if butt else length - 0.60
    stone.box(run, 0.62, 0.22, at=(0.0, 0.10, z), matrix=mat, chamfer=0.05, centre_z=False)
    n = int(run / spacing)
    for i in range(n):
        x = -run * 0.5 + run * (i + 0.5) / n
        stone.lathe([(0.0, 0.0), (0.07, 0.0), (0.06, height * 0.16), (0.11, height * 0.36), (0.065, height * 0.62),
                     (0.08, height * 0.80), (0.0, height - 0.40)], segments=6, smooth=True,
                    matrix=mat @ M.xform((x, 0.10, z + 0.22)))
    stone.box(run, 0.70, 0.18, at=(0.0, 0.10, z + height - 0.18), matrix=mat, chamfer=0.05, centre_z=False)
    if not butt:
        for sgn in (-1.0, 1.0):
            stone.box(0.52, 0.72, height + 0.10, at=(sgn * run * 0.5, 0.10, z), matrix=mat, chamfer=0.06,
                      centre_z=False)


def _rustication(stone, w, d, z0, z1, step=0.62):
    """Proud horizontal courses on the ground storey: the shadow lines that say "heavy base"."""
    z = z0 + step
    while z < z1 - 0.2:
        stone.box(w + 0.08, d + 0.08, 0.10, at=(0.0, 0.0, z), chamfer=0.03, centre_z=False)
        z += step


def _order(stone, dark, gold, glass, w, d, faces, bays, extra_storey=0.0):
    """The shared palace order on a rectangular block: ground arcade, nobile windows between gilded pilasters,
    an optional upper storey, cornice, balustrade. Returns the z of the parapet top."""
    stone.box(w + 0.50, d + 0.50, 0.55, chamfer=0.08, centre_z=False)                 # plinth
    top = PARAPET_Z + extra_storey
    # the block stands 3 cm proud of the cornice's top, so the two up-facing faces are never in one plane
    stone.box(w, d, top - 0.55 + 0.03, at=(0.0, 0.0, 0.55), chamfer=0.06, centre_z=False)
    _rustication(stone, w, d, 0.55, GROUND_H)
    stone.box(w + 0.46, d + 0.46, 0.22, at=(0.0, 0.0, GROUND_H), chamfer=0.05, centre_z=False)  # string course
    gold.box(w + 0.50, d + 0.50, 0.06, at=(0.0, 0.0, GROUND_H + 0.22), centre_z=False)
    for face in faces:
        length = w if face in ("+y", "-y") else d
        n = bays[face]
        mat = _face(face, w, d)
        bay = length / n
        for i in range(n):
            cx = -length * 0.5 + bay * (i + 0.5)
            _arcade_opening(stone, dark, gold, mat, cx, min(2.6, bay * 0.56), GROUND_H - 0.55)
            _window(stone, glass, gold, mat, cx, NOBILE_Z0 + 0.55, min(1.9, bay * 0.42), 4.30)
            if extra_storey > 0.0:
                _window(stone, glass, gold, mat, cx, NOBILE_Z1 + 0.45, min(1.5, bay * 0.34), extra_storey - 1.0,
                        kind="ogee")
        for i in range(n + 1):
            _pilaster(stone, gold, mat, -length * 0.5 + bay * i + (0.35 if i == 0 else -0.35 if i == n else 0.0),
                      NOBILE_Z0, NOBILE_Z1 + extra_storey)
    zc = CORNICE_Z + extra_storey
    stone.box(w + 0.40, d + 0.40, 0.45, at=(0.0, 0.0, zc), chamfer=0.06, centre_z=False)       # architrave/frieze
    gold.box(w + 0.44, d + 0.44, 0.08, at=(0.0, 0.0, zc + 0.45), centre_z=False)
    stone.box(w + 1.10, d + 1.10, 0.47, at=(0.0, 0.0, zc + 0.53), chamfer=0.14, centre_z=False)  # cornice
    for face in ("+y", "-y", "+x", "-x"):
        length = w if face in ("+y", "-y") else d
        _balustrade(stone, _face(face, w, d), length, top, butt=False)
    return top


def _mansard(roof, stone, gold, glass, w, d, z, lower=3.4, upper=1.9, dormers=3, inset=0.9):
    """A French mansard behind the balustrade: a steep lower slope with dormers, a low upper hip, gold cresting."""
    lw, ld = w - 2.0 * inset, d - 2.0 * inset
    taper = 0.80
    roof.prism([(-lw * 0.5, -ld * 0.5), (lw * 0.5, -ld * 0.5), (lw * 0.5, ld * 0.5), (-lw * 0.5, ld * 0.5)],
               lower, z0=z, taper=taper)
    # the taper scales both plan dimensions, so the top of the steep slope is lw*taper x ld*taper
    tw, td = lw * taper, ld * taper
    E.roof_ridged(roof, tw, td, upper, at=(0.0, 0.0, z + lower + 0.19), overhang=0.08, ridge_frac=max(0.05, 1.0 - td / tw))
    rl = tw * 0.5 * max(0.05, 1.0 - td / tw)
    gold.box(rl * 2.0 + 0.10, 0.16, 0.34, at=(0.0, 0.0, z + lower + upper + 0.08), chamfer=0.03, centre_z=False)
    for sgn in (-1.0, 1.0):
        E.finial(stone, (sgn * rl, 0.0, z + lower + upper + 0.30), 1.30, radius=0.14, gold=gold)
    # dormers on the long faces, standing on the steep slope
    for side in (1.0, -1.0):
        for i in range(dormers):
            x = -lw * 0.5 + lw * (i + 0.5) / dormers
            y = side * (ld * 0.5 - 0.55)
            rot = (0.0, 0.0, 0.0 if side > 0 else 180.0)
            m = M.xform((x, y, z + 0.35), rot)
            stone.box(1.50, 1.30, 1.95, at=(0.0, 0.0, 0.0), matrix=m, chamfer=0.05, centre_z=False)
            E.arch_band(gold, 0.95, 0.48, 0.16, 0.10, at=(0.0, 0.70, 1.00), kind="round", steps=8, matrix=m)
            glass.box(0.80, 0.06, 1.25, at=(0.0, 0.66, 0.25), matrix=m, centre_z=False)
            E.roof_ridged(roof, 1.30, 1.70, 0.95, at=(0.0, 0.0, 2.14), rot=(0.0, 0.0, 90.0), overhang=0.12,
                          ridge_frac=1.0, matrix=m)
    return z + lower + upper


def palace_wing(f):
    """A five-bay palace front, 24 x 12 m, 18.6 m to the ridge: the Bible's layered palace in one piece."""
    stone = f.part("stone")
    dark = f.part("stone_dark")
    gold = f.part("gold")
    glass = f.part("glass")
    roof = f.part("roof_alt")
    W, D = 24.0, 12.0
    top = _order(stone, dark, gold, glass, W, D, ("+y", "-y"), {"+y": 5, "-y": 5})
    _mansard(roof, stone, gold, glass, W, D, top - 0.02, dormers=3)
    return K.ModuleSpec(
        "WL_Palace_Wing", "palace", "structure", "body",
        f.emit("WL_Palace_Wing"),
        [K.Socket("bottom", 0.0, W * 0.5, "ground"),
         K.Socket("eaves", PARAPET_Z, W * 0.5, "bridge_end", "parapet at 12.40 m; the balustrade walk"),
         K.Socket("end_a", 0.0, D * 0.5, "pier", "plain butt wall at x = -12.00 m; a pavilion or a wing joins here"),
         K.Socket("end_b", 0.0, D * 0.5, "pier", "plain butt wall at x = +12.00 m; a pavilion or a wing joins here")],
        districts=("city", "castle", "plaza", "royal_garden"),
        note="five-bay palace front: rusticated arcade, piano nobile between gilded pilasters, cornice and "
             "balustrade, lilac mansard with dormers and gold cresting; 24 x 12 m, joins end to end",
        params={"plan_m": [W, D], "bays": 5, "parapet_z_m": PARAPET_Z},
        tri_budget=60000, collision=True)


def palace_pavilion(f):
    """A 14 m square corner pavilion one storey taller than a wing, under a tall roof and a lantern."""
    stone = f.part("stone")
    dark = f.part("stone_dark")
    gold = f.part("gold")
    glass = f.part("glass")
    roof = f.part("roof")
    P = 14.0
    UP = 4.40
    top = _order(stone, dark, gold, glass, P, P, ("+y", "-y", "+x", "-x"), {"+y": 3, "-y": 3, "+x": 3, "-x": 3},
                 extra_storey=UP)
    # corner quoins run the full height: the pavilion reads as a tower-like mass against the wings
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            # they stop under the frieze: run to the parapet and their tops share the cornice's plane
            stone.box(0.80, 0.80, CORNICE_Z + UP - 0.55, at=(sx * (P * 0.5 - 0.25), sy * (P * 0.5 - 0.25), 0.55),
                      chamfer=0.08, centre_z=False)
    z = top - 0.02
    inner = P - 1.8
    H1, H2 = 7.2, 2.6
    roof.prism([(-inner * 0.5, -inner * 0.5), (inner * 0.5, -inner * 0.5), (inner * 0.5, inner * 0.5),
                (-inner * 0.5, inner * 0.5)], H1, z0=z, taper=0.34)
    cap = inner * 0.34
    gold.box(cap + 0.30, cap + 0.30, 0.30, at=(0.0, 0.0, z + H1), chamfer=0.06, centre_z=False)
    # the lantern: four small arched openings under a gold bell
    lz = z + H1 + 0.30
    stone.box(cap - 0.30, cap - 0.30, H2, at=(0.0, 0.0, lz), chamfer=0.06, centre_z=False)
    for face in ("+y", "-y", "+x", "-x"):
        m = _face(face, cap - 0.30, cap - 0.30) @ M.xform((0.0, 0.0, lz))
        E.arch_band(gold, 0.80, 0.40, 0.14, 0.10, at=(0.0, 0.06, 1.20), kind="round", steps=8, matrix=m)
        glass.box(0.66, 0.05, 1.45, at=(0.0, 0.03, 0.15), matrix=m, centre_z=False)
    gold.lathe(M.bell((cap - 0.10) * 0.72, 2.20, steps=8, flare=0.18, z0=lz + H2), segments=12, smooth=True)
    E.finial(stone, (0.0, 0.0, lz + H2 + 2.05), 2.40, radius=0.26, gold=gold)
    # dormers in the tall roof, one a face
    for face_yaw in (0.0, 90.0, 180.0, 270.0):
        m = M.xform((0.0, 0.0, z), (0.0, 0.0, face_yaw))
        stone.box(1.30, 1.40, 1.80, at=(0.0, inner * 0.5 - 1.10, 0.40), matrix=m, chamfer=0.05, centre_z=False)
        E.arch_band(gold, 0.80, 0.40, 0.14, 0.09, at=(0.0, inner * 0.5 - 0.36, 1.35), kind="round", steps=8, matrix=m)
        glass.box(0.66, 0.05, 1.15, at=(0.0, inner * 0.5 - 0.38, 0.55), matrix=m, centre_z=False)
        roof.lathe(M.needle(0.95, 1.45, steps=4, concavity=0.1, z0=2.18), segments=4, smooth=False,
                   matrix=m @ M.xform((0.0, inner * 0.5 - 1.10, 0.0), (0.0, 0.0, 45.0)))
    return K.ModuleSpec(
        "WL_Palace_Pavilion", "palace", "structure", "body",
        f.emit("WL_Palace_Pavilion"),
        [K.Socket("bottom", 0.0, P * 0.5, "ground"),
         K.Socket("end_a", 0.0, P * 0.5, "pier", "wall at x = -7.00 m; a wing's end butts here"),
         K.Socket("end_b", 0.0, P * 0.5, "pier", "wall at x = +7.00 m; a wing's end butts here")],
        districts=("city", "castle", "plaza", "royal_garden"),
        note="14 m square pavilion: the palace order plus an upper storey, corner quoins, a tall rose roof with "
             "dormers, a lantern under a gold bell; closes and punctuates a run of wings",
        params={"plan_m": [P, P], "bays_per_face": 3, "parapet_z_m": PARAPET_Z + UP},
        tri_budget=60000, collision=True)


def _dome_profile(R, H, z0, steps=18, point=0.62):
    """A slightly pointed dome: r = R (1 - u^2)^point. 0.5 is a hemisphere-like ellipse; more draws the crown in."""
    out = []
    for i in range(steps + 1):
        u = i / float(steps)
        r = R * max(0.0, 1.0 - u * u) ** point
        out.append((r, z0 + H * u))
    out[-1] = (0.0, z0 + H)
    return out


def palace_dome_grand(f):
    """The great dome: a 34 m podium with a portico, a columned drum, a ribbed dome and a lantern. ~47 m."""
    stone = f.part("stone")
    dark = f.part("stone_dark")
    gold = f.part("gold")
    glass = f.part("glass")
    shell = f.part("roof_alt")
    roof = f.part("roof")
    P = 34.0
    top = _order(stone, dark, gold, glass, P, P, ("+y", "-y", "+x", "-x"), {"+y": 7, "-y": 7, "+x": 7, "-x": 7})
    # the roof terrace, 6 cm above the cornice's top plane (the validator caught them sharing it)
    stone.box(P - 1.2, P - 1.2, 0.30, at=(0.0, 0.0, top - 0.24), centre_z=False)

    # corner turrets with rose needles, so the podium's corners answer the dome
    for sx in (-1.0, 1.0):
        for sy in (-1.0, 1.0):
            m = M.xform((sx * (P * 0.5 - 2.0), sy * (P * 0.5 - 2.0), 0.0))
            stone.lathe([(1.90, top), (1.90, top + 5.6)], segments=16, smooth=False, matrix=m, cap_bottom=False)
            E.string_course(stone, top + 5.6, 1.90, run=M.CORNICE_CAVETTO, segments=16, matrix=m)
            for (x, y, a) in K.radial(4, 1.92, phase=math.pi / 4.0):
                mw = m @ M.xform((x, y, 0.0), (0.0, 0.0, a - 90.0))
                glass.box(0.60, 0.06, 1.8, at=(0.0, 0.02, top + 2.2), matrix=mw, centre_z=False)
            roof.lathe(M.needle(2.15, 7.8, steps=7, concavity=0.35, z0=top + 5.95), segments=16, smooth=True, matrix=m)
            E.finial(stone, (sx * (P * 0.5 - 2.0), sy * (P * 0.5 - 2.0), top + 13.6), 1.9, radius=0.22, gold=gold)

    # the drum
    RD = 12.0
    z0 = top
    stone.lathe([(RD + 0.9, z0), (RD + 0.9, z0 + 1.1), (RD + 0.6, z0 + 1.1)], segments=48, smooth=False,
                cap_bottom=False)
    zd0, zd1 = z0 + 1.1, z0 + 8.6
    stone.lathe([(RD, zd0), (RD, zd1)], segments=48, smooth=False, cap_bottom=False, cap_top=False)
    n_win = 16
    for k, (x, y, a) in enumerate(K.radial(n_win, RD)):
        mw = M.xform((x, y, 0.0), (0.0, 0.0, a - 90.0))
        _window(stone, glass, gold, mw, 0.0, zd0 + 1.4, 1.7, 4.6, proud=0.34)
    for (x, y, a) in K.radial(n_win, RD + 0.55, phase=math.pi / n_win):
        E.column(stone, (x, y, zd0), zd1 - zd0, 0.42, flutes=0)
    E.corbel_table(stone, zd1, RD + 0.15, count=48, depth=0.40, drop=0.55)
    gold.lathe([(RD + 0.55, zd1 + 0.75), (RD + 0.75, zd1 + 0.75), (RD + 0.75, zd1 + 0.87), (RD + 0.55, zd1 + 0.87)],
               segments=48, smooth=False, cap_bottom=False, cap_top=False)
    zs = zd1 + 0.95

    # the dome: a ribbed, slightly pointed shell with a gold band at its springing
    R, H = RD + 0.35, 14.0
    prof = _dome_profile(R, H, zs)
    shell.lathe(prof, segments=64, smooth=True, cap_bottom=False)
    gold.lathe([(R + 0.10, zs - 0.05), (R + 0.22, zs + 0.25), (R * 0.985 + 0.12, zs + 0.85), (R * 0.97, zs + 0.95)],
               segments=64, smooth=True, cap_bottom=False, cap_top=False)
    lantern_z = None
    for i, (r, z) in enumerate(prof):
        if r < 2.6:
            lantern_z = z
            break
    for (cx, cy, a) in K.radial(16, 1.0):
        pts = [(cx * (r + 0.10), cy * (r + 0.10), z) for (r, z) in prof if z <= lantern_z]
        gold.sweep(pts, [0.20] * len(pts), sides=4, cap=False)

    # the lantern
    LR = 2.30
    stone.lathe([(LR + 0.35, lantern_z - 0.40), (LR + 0.35, lantern_z + 0.30), (LR, lantern_z + 0.30)], segments=24,
                smooth=False, cap_bottom=True)
    for (x, y, a) in K.radial(8, LR - 0.20):
        stone.box(0.38, 0.38, 3.2, at=(x, y, lantern_z + 0.30), rot=(0.0, 0.0, a), chamfer=0.06, centre_z=False)
    glass.lathe([(LR - 0.55, lantern_z + 0.30), (LR - 0.55, lantern_z + 3.50)], segments=16, smooth=False)
    stone.lathe([(LR + 0.30, lantern_z + 3.50), (LR + 0.30, lantern_z + 4.00), (0.0, lantern_z + 4.00)], segments=24,
                smooth=False, cap_bottom=True)
    gold.lathe(_dome_profile(LR + 0.10, 2.2, lantern_z + 4.00, steps=8, point=0.7), segments=24, smooth=True,
               cap_bottom=False)
    E.finial(stone, (0.0, 0.0, lantern_z + 6.10), 4.2, radius=0.36, gold=gold)

    # the portico on the +y front: six columns, an entablature and a pediment with a gold roundel, and steps
    fy = P * 0.5
    col_h = 10.2
    for i in range(6):
        x = -7.5 + 3.0 * i
        E.column(stone, (x, fy + 3.4, 0.55), col_h, 0.70, flutes=12)
    stone.box(17.6, 5.2, 0.55, at=(0.0, fy + 2.3, 0.0), chamfer=0.08, centre_z=False)
    stone.box(17.2, 4.8, 1.30, at=(0.0, fy + 2.2, col_h + 0.55), chamfer=0.08, centre_z=False)
    gold.box(17.3, 4.9, 0.08, at=(0.0, fy + 2.2, col_h + 1.10), centre_z=False)
    pz = col_h + 1.85
    E.plate_xz(stone, [(-9.0, 0.0), (9.0, 0.0), (0.0, 3.6)], 4.8, at=(0.0, fy + 2.2, pz))
    gold.lathe([(0.0, -0.05), (1.10, -0.05), (1.10, 0.25), (0.0, 0.25)], segments=20, smooth=False,
               matrix=M.xform((0.0, fy + 4.7, pz + 1.35), (90.0, 0.0, 0.0)))
    # two steps down from the portico floor to the ground
    for k in range(2):
        stone.box(17.6, 0.90, 0.275 * (2 - k), at=(0.0, fy + 5.35 + 0.90 * k, 0.0), chamfer=0.03, centre_z=False)
    return K.ModuleSpec(
        "WL_Palace_Dome_Grand", "palace", "landmark", "hero",
        f.emit("WL_Palace_Dome_Grand"),
        [K.Socket("bottom", 0.0, P * 0.5, "ground", "the podium's plinth")],
        districts=("castle", "city", "plaza"),
        note="the great dome: 34 m arcaded podium with corner turrets and a six-column portico, a 16-window "
             "columned drum, a ribbed pointed dome (roof_alt shell: a layer chooses lilac, rose, blue or gold) "
             "with a gold springing band, lantern and finial",
        params={"podium_m": P, "drum_radius_m": RD, "dome_rise_m": H, "ribs": 16},
        tri_budget=160000, collision=True)


BUILDERS = (palace_wing, palace_pavilion, palace_dome_grand)
