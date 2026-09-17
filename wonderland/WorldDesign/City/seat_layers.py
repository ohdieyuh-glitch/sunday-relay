#!/usr/bin/env python3
"""WS01 -- wall-mounted dressing moves back onto the real wall (2026-09-17).

THE GAP. Every facade pass placed its clip-ons on a census BOX face (faces_of), and a box face is not the wall
(wall_seat.py): cornices and balconies reach the bounds, so the wall stands inside them. Measured against the layers,
with the median gap per pass:
  - FD02 arched windows on castle halls: 28-30 cm on the short sides, 63-72 cm on the long sides. The window is a
    39 cm deep clip-on with a flat back plate, so from any oblique view it hangs in the air.
  - SF01 shopfronts: 30-38 cm (a 1.45 m deep shop hides most of it).
  - FD04 banners and FD05 wall lanterns: 17-28 cm, their wall plates held off the wall on nothing.

WHAT. For every instance in the named layers that stands ON a box face -- within ON_FACE of the face plane, inside
its span and height, and turned to face out of it -- move it back along the face normal onto the plain wall.
The wall's depth is wall_seat.wall_depth over the instance's own module height band. Batch ids, counts, heights,
rotations and every other field stay exactly as they were, so a pass saved in the map by id is replaced like for
like. An instance already on the wall is no longer within ON_FACE of the box face, so running this twice changes
nothing. A move larger than MAX_MOVE is refused: on a landmark whose upper structure stands proud of its own foot,
that is a different problem, not a clip-on sitting off its wall. Meshes with no cross-section keep their positions.

    python seat_layers.py fd02 fd04 fd05 sf01      (rewrites <pass>_*.json in place; prints what moved)
"""
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import facade_dressing as F
import wall_seat as WS
from shopfronts import faces_of

HERE = Path(__file__).resolve().parent
TMP = F.TMP
KIT = json.loads((HERE.parent / "Skyline" / "kit_modules.json").read_text(encoding="utf-8"))["modules"]
ON_FACE = 15.0
FACING = 0.95
# A clip-on standing off its wall moves centimetres. When the slices said 2.5 m -- a banner on a district gatehouse,
# whose foot outline is 2.1 m inside its bounds while its upper structure is not -- that is not the same defect, and
# pushing a banner two metres into a landmark would be worse than leaving it. Those are left alone and counted.
MAX_MOVE = 90.0


def module_heights():
    out = {}
    for m in KIT.values():
        for p in m.get("parts", []):
            out[p["mesh"]] = m["height"]
    return out


def main(passes):
    buildings = json.loads((TMP / "building_census.json").read_text(encoding="utf-8"))
    bg = F.grid_of(buildings, lambda b: (b["x"], b["y"]))
    heights = module_heights()
    stats = defaultdict(Counter)
    depths = defaultdict(list)
    for pas in passes:
        for f in sorted(HERE.glob("%s_*.json" % pas)):
            layer = json.loads(f.read_text(encoding="utf-8"))
            if not isinstance(layer, dict) or "batches" not in layer:
                continue
            changed = False
            for bt in layer["batches"]:
                h = heights.get(bt["mesh"], 100.0)
                for inst in bt["instances"]:
                    x, y, z, yaw = inst[0], inst[1], inst[2], inst[4]
                    ux, uy = math.cos(math.radians(yaw - 90.0)), math.sin(math.radians(yaw - 90.0))
                    best = None
                    for bi in F.around(bg, x, y):
                        b = buildings[bi]
                        if not (b["zmin"] - 50.0 <= z <= b["zmax"]):
                            continue
                        for fi, (nx, ny, fx, fy, half_t) in enumerate(faces_of(b)):
                            if abs(nx * ux + ny * uy) < FACING:
                                continue
                            dn = (x - fx) * nx + (y - fy) * ny
                            if abs(dn) > ON_FACE or abs((x - fx) * -ny + (y - fy) * nx) > half_t + 5.0:
                                continue
                            if best is None or abs(dn) < abs(best[0]):
                                best = (dn, b, fi, nx, ny)
                    if best is None:
                        stats[pas]["not_on_a_box_face"] += 1
                        continue
                    dn, b, fi, nx, ny = best
                    if b["mesh"] not in WS.SECTIONS:
                        stats[pas]["no_section_" + b["mesh"]] += 1
                        continue
                    d = WS.wall_depth(b, fi, z, z + h)
                    move = dn + d
                    if move < 1.0:
                        stats[pas]["already_on_the_wall"] += 1
                        continue
                    if move > MAX_MOVE:
                        stats[pas]["too_deep_" + b["mesh"]] += 1
                        continue
                    inst[0], inst[1] = round(x - nx * move, 1), round(y - ny * move, 1)
                    stats[pas]["seated"] += 1
                    depths[pas].append(move)
                    changed = True
            if changed:
                f.write_text(json.dumps(layer), encoding="utf-8", newline="\n")
    for pas in passes:
        v = sorted(depths[pas])
        med = v[len(v) // 2] if v else 0.0
        print(pas, dict(stats[pas]), "moved median %.1f cm, max %.1f" % (med, v[-1] if v else 0.0))


if __name__ == "__main__":
    main(sys.argv[1:] or ["fd02", "fd04", "fd05", "sf01"])
