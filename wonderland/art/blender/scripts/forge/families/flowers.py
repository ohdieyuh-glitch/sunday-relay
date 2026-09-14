"""Flowers you can see the flowers in: bed runs for path edges and planters.

FL01b (2026-09-13): the first planting read mostly green -- blooms of 3-4.5 cm on 20-34 cm stems over 16 cm leaf
domes lost the Bible's colour along the path. Blooms are now 5.5-8 cm, more of them, on lower stems, over low
fine leaf clumps, so a bed reads as flowers first (Wonderland scale, not botanical scale).

THE GAP (founder quality directive, 2026-09-13: "Flowers should not read as flat color clusters"; environment quality
reference; GAP 19). The Golden Arrival's path edging is laid with SM_flower_cluster -- a rounded blob in a petal
material -- so a bed reads as a pink or violet cushion. The reference's beds are made of flowers: daisies with white
petals round a gold eye, lavender spikes standing out of grey-green leaves, roses among dark leaves, spilling over
the stone.

WHAT A BED RUN IS. A 1.2 x 0.5 m strip, its datum the surface it is planted on:
  * a low mound of leaf clumps (part `leaf`) the flowers rise out of;
  * flowers as FLOWERS: petals are separate blades round a centre, each on its own stem at its own height and lean;
  * petals are the `petal` part, so one mesh plants a pink, violet, white or rose bed by the batch's material;
    daisy eyes are `petal_centre` (gold).
Three kinds -- daisy, lavender, rose -- because a border of one kind reads as a pattern. No collision.
"""

import math

from .. import kit as K
from .. import mesh as M

RUN_L, RUN_W = 1.2, 0.5


def _mound(leaf, seed, height=0.09, count=16):
    """Leaf clumps: flattened, overlapping domes along the run."""
    for k in range(count):
        x = -RUN_L * 0.5 + RUN_L * (k + 0.5) / count + M.rrange(-0.05, 0.05, k, seed, 11)
        y = M.rrange(-0.12, 0.12, k, seed, 12)
        r = M.rrange(0.06, 0.10, k, seed, 13)
        h = height * M.rrange(0.7, 1.1, k, seed, 14)
        leaf.lathe([(r, 0.0), (r * 0.95, h * 0.45), (r * 0.6, h * 0.85), (0.0, h)], segments=7, smooth=True, cap_bottom=False,
                   matrix=M.xform((x, y, 0.0), scale=(1.0, M.rrange(0.7, 1.0, k, seed, 15), 1.0)))


def _positions(n, seed, margin=0.05):
    out = []
    for k in range(n):
        x = -RUN_L * 0.5 + margin + (RUN_L - 2 * margin) * (k + M.rnd(k, seed, 21)) / n
        y = M.rrange(-RUN_W * 0.5 + margin, RUN_W * 0.5 - margin, k, seed, 22)
        out.append((k, x, y))
    return out


def flower_daisy_run(f):
    leaf, petal, eye = f.part("leaf"), f.part("petal"), f.part("petal_centre")
    seed = 1901
    _mound(leaf, seed)
    count = 38
    for k, x, y in _positions(count, seed):
        h = M.rrange(0.14, 0.28, k, seed, 1)
        lean_x, lean_y = M.rrange(-0.04, 0.04, k, seed, 2), M.rrange(-0.04, 0.04, k, seed, 3)
        hx, hy, hz = x + lean_x, y + lean_y, h
        leaf.sweep([(x, y, 0.06), ((x + hx) * 0.5, (y + hy) * 0.5, h * 0.6), (hx, hy, hz)], [0.004, 0.0035, 0.003], sides=3, cap=False)
        r = M.rrange(0.055, 0.080, k, seed, 4)
        face_tilt = M.rrange(10.0, 35.0, k, seed, 5)
        face_yaw = M.rrange(0.0, 360.0, k, seed, 6)
        face = M.xform((hx, hy, hz), (face_tilt, 0.0, face_yaw))
        eye.lathe([(r * 0.30, 0.0), (r * 0.28, 0.006), (0.0, 0.010)], segments=7, smooth=True, matrix=face)
        petals = 10
        for p in range(petals):
            a = 360.0 * p / petals
            petal.box(r * 1.05, r * 0.36, 0.005, at=(0.0, 0.0, 0.0), matrix=face @ M.xform((0.0, 0.0, 0.002), (0.0, -8.0, a)) @ M.xform((r * 0.78, 0.0, 0.0)))
    return K.ModuleSpec(
        "WL_Flower_Daisy_Run", "flowers", "prop", "detail", f.emit("WL_Flower_Daisy_Run"),
        [K.Socket("bottom", 0.0, RUN_L * 0.5, "ground", "planted on a bed, a kerb top or a planter's soil")],
        districts=("royal_garden", "plaza", "cloister", "tea_terrace", "grove"),
        note="1.2 m bed run of %d daisies (ten petal blades round a gold eye, each on its own stem, height and lean) "
             "rising out of leaf clumps; petal colour is the batch's material" % count,
        params={"length_m": RUN_L, "flowers": count}, tri_budget=12000, nanite=True, collision=False)


def flower_lavender_run(f):
    leaf, petal = f.part("leaf"), f.part("petal")
    seed = 1902
    _mound(leaf, seed, height=0.07, count=14)
    count = 30
    for k, x, y in _positions(count, seed):
        h = M.rrange(0.28, 0.44, k, seed, 1)
        lx, ly = M.rrange(-0.07, 0.07, k, seed, 2), M.rrange(-0.07, 0.07, k, seed, 3)
        tip = (x + lx, y + ly, h)
        leaf.sweep([(x, y, 0.05), (x + lx * 0.4, y + ly * 0.4, h * 0.5), tip], [0.004, 0.0035, 0.003], sides=3, cap=False)
        florets = 7
        spike = 0.16 * M.rrange(0.8, 1.2, k, seed, 4)
        for j in range(florets):
            t = j / float(florets - 1)
            z = h - spike + spike * t
            px = x + lx * (z / h)
            py = y + ly * (z / h)
            s = 0.026 * (1.0 - 0.40 * t)
            petal.box(s, s, s * 1.4, at=(px, py, z), rot=(0.0, 0.0, 45.0 * j), chamfer=s * 0.3)
    return K.ModuleSpec(
        "WL_Flower_Lavender_Run", "flowers", "prop", "detail", f.emit("WL_Flower_Lavender_Run"),
        [K.Socket("bottom", 0.0, RUN_L * 0.5, "ground", "planted on a bed, a kerb top or a planter's soil")],
        districts=("royal_garden", "plaza", "tea_terrace", "grove"),
        note="1.2 m bed run of %d lavender spikes (seven florets up a leaning stem) out of low leaf clumps" % count,
        params={"length_m": RUN_L, "spikes": count}, tri_budget=12000, nanite=True, collision=False)


def flower_rose_run(f):
    leaf, petal = f.part("leaf"), f.part("petal")
    seed = 1903
    _mound(leaf, seed, height=0.13, count=16)
    count = 22
    for k, x, y in _positions(count, seed, margin=0.08):
        h = M.rrange(0.13, 0.24, k, seed, 1)
        r = M.rrange(0.055, 0.075, k, seed, 2)
        tilt = M.rrange(0.0, 30.0, k, seed, 3)
        yaw = M.rrange(0.0, 360.0, k, seed, 4)
        head = M.xform((x, y, h), (tilt, 0.0, yaw))
        # three nested cups, each smaller, higher and turned, read as layered petals
        for j, (rr, hh, turn) in enumerate(((r, r * 0.9, 0.0), (r * 0.72, r * 1.0, 25.0), (r * 0.42, r * 0.95, 50.0))):
            petal.lathe([(rr * 0.35, 0.0), (rr, hh * 0.55), (rr * 0.92, hh)], segments=7, smooth=True,
                        # closed: an open cup's signed volume depends on where it sits, and the validator reads it as inside-out
                        matrix=head @ M.xform((0.0, 0.0, 0.004 * j), (0.0, 0.0, turn)))
        petal.lathe([(0.0, 0.0), (r * 0.18, r * 0.5), (0.0, r * 0.8)], segments=5, smooth=True, matrix=head)
    return K.ModuleSpec(
        "WL_Flower_Rose_Run", "flowers", "prop", "detail", f.emit("WL_Flower_Rose_Run"),
        [K.Socket("bottom", 0.0, RUN_L * 0.5, "ground", "planted on a bed, a kerb top or a planter's soil")],
        districts=("royal_garden", "plaza", "cloister", "tea_terrace"),
        note="1.2 m bed run of %d roses (three nested, turned petal cups) among a deep leaf mound" % count,
        params={"length_m": RUN_L, "roses": count}, tri_budget=8000, nanite=True, collision=False)


BUILDERS = (flower_daisy_run, flower_lavender_run, flower_rose_run)
