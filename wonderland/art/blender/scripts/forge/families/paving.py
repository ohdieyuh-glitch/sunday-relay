"""Paving you can see the stones in: flagstone fields for the walked foreground.

THE GAP (founder quality directive and environment quality reference, 2026-09-13; GAP 18). The reference's plaza is
chunky individual stones in a loose light/dark checker, each bevelled and a little proud or sunk against its
neighbours, with deep joints and moss in them -- relief the low sun finds. Wonderland's walked ground is the V2 plaza
slab: one smooth tile shape repeated on a grid, joints a hairline, every top in one plane, so a plaza reads as a
tinted sheet however good its material is.

WHAT A FLAGSTONE FIELD IS. A 4.0 x 4.0 m patch laid over existing paving (its datum is the paving's top):
  * courses of stones in running bond -- course depths 36-56 cm, stone lengths 34-72 cm, so no two courses align;
  * every stone a chamfered block with its own height (5.0-5.9 cm) and its own chamfer, 1.6 cm from its neighbours;
  * stones in three tints (paving / paving_warm / paving_shade) in a loose checker, ~40% dark;
  * a moss bed under the joints, so the gaps read dark and green, not as the old slab showing through.
Three layouts (A, B, C) from different seeds, so a plaza laid with rotated patches does not repeat. No collision: the
paving under it already carries the walk, and 6 cm of relief is below a step.
"""

from .. import kit as K
from .. import mesh as M

SIZE = 4.0
JOINT = 0.016


def _field(f, asset_id, seed):
    parts = {"paving": f.part("paving"), "paving_warm": f.part("paving_warm"), "paving_shade": f.part("paving_shade")}
    moss = f.part("moss")
    moss.box(SIZE, SIZE, 0.012, at=(0.0, 0.0, 0.0), centre_z=False)
    half = SIZE * 0.5
    y = -half
    row = 0
    stones = 0
    tallest = 0.0
    while y < half - 1e-6:
        depth = M.rrange(0.36, 0.56, row, seed, 1)
        if half - (y + depth) < 0.30:
            depth = half - y                       # no sliver course at the far edge
        x = -half
        col = 0
        while x < half - 1e-6:
            length = M.rrange(0.34, 0.72, row * 31 + col, seed, 2)
            if half - (x + length) < 0.24:
                length = half - x
            r = M.rnd(row * 131 + col * 7, seed, 3)
            parity = (row + col) % 2
            if (parity == 0 and r < 0.62) or (parity == 1 and r < 0.18):
                key = "paving_shade"
            elif r > 0.72:
                key = "paving_warm"
            else:
                key = "paving"
            height = 0.050 + 0.009 * M.rnd(row * 17 + col * 3, seed, 4)
            chamfer = 0.012 + 0.008 * M.rnd(row * 5 + col * 11, seed, 5)
            parts[key].box(length - JOINT, depth - JOINT, height, at=(x + length * 0.5, y + depth * 0.5, 0.0),
                           chamfer=chamfer, centre_z=False)
            tallest = max(tallest, height)
            stones += 1
            x += length
            col += 1
        y += depth
        row += 1
    return K.ModuleSpec(
        asset_id, "paving", "prop", "detail",
        f.emit(asset_id),
        [K.Socket("bottom", 0.0, half, "ground", "laid on the old paving's top"),
         K.Socket("edge", tallest, half, "edge", "the stones' tops; a kerb or a border course butts to it")],
        districts=("plaza", "royal_garden", "cloister", "city", "castle"),
        note="4 m flagstone field: %d chamfered stones in running bond, three tints in a loose checker, 1.6 cm joints "
             "over a moss bed, 5.0-5.9 cm proud" % stones,
        params={"size_m": SIZE, "stones": stones, "joint_m": JOINT, "seed": seed},
        tri_budget=6000, nanite=True, collision=False)


def flagstone_a(f):
    return _field(f, "WL_Ground_Flagstone_A", 1801)


def flagstone_b(f):
    return _field(f, "WL_Ground_Flagstone_B", 1802)


def flagstone_c(f):
    return _field(f, "WL_Ground_Flagstone_C", 1803)


BUILDERS = (flagstone_a, flagstone_b, flagstone_c)
