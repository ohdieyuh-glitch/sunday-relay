#!/usr/bin/env python3
"""Fail the build if anything large stands in the hero sight line.

WHY THIS EXISTS

`_in_corridor` in the generator says of itself "Nothing tall gets to stand in
here". It is asked by nine scatter passes. In one afternoon three separate
things were found standing in the corridor anyway, each because a DIFFERENT
collection never asked:

    brain_landmark        a landmark      x = 0, 27 m out
    brain_pool_rim        a landmark      x = 0, 25 m out
    brain_reflecting_pool a waterFeature  x = 0 -- and when the LANDMARK rim was
                                          moved, the WATER stayed, so the
                                          turquoise surface sat behind the Dog
                                          for the whole sprint

and then the repair for the third had the same shape inside it: the water plane
moved and its rim, foam, ripple rings and lilies were left at the old centre by
a `_wc = w["center"]` eleven lines further down.

Every one of those was invisible to every existing gate, because each gate
checks the rule and not the WORLD. This checks the world: it runs the generator,
looks at what was actually placed, and fails if a big piece's centre lands in
the corridor.

    python3 verify-hero-corridor.py [--half=430] [--y1=6000] [--min-area=1.2]

WHAT IS ALLOWED THROUGH, and why each one:
  * the ground, the paving and the paths -- the corridor is a floor;
  * the arcane circle and the Dog -- the corridor exists to show them;
  * the rose arch -- the reference has an arch on its axis, and you see through
    an arch;
  * anything small. `--min-area` is in square metres of footprint: a flower on
    the walk is not what this is about.
"""
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
LAYOUT = os.path.normpath(os.path.join(HERE, "..", "..", "WorldDesign", "hub-layout.json"))

# Floors and things you see through. Each of these is either the ground itself
# or the subject the corridor exists to show.
ALLOW = ("PATH", "BLVD", "Plaza", "Tile", "Roll", "Hill", "Ground", "Rune",
         "Arcane", "DOG", "Dog", "rose_arch", "Step", "Terr", "Kerb", "Bed",
         "Moss", "Meadow", "Cobble", "Boul", "Marble", "Sky", "Cloud", "Bird",
         "Forecourt",          # paving in front of a landmark: also a floor
         "Carpet",             # ground-cover soil discs, 2 cm proud of the turf
         "FarMeadow", "MeadowPatch")


def main():
    half, y1, min_area, min_height = 430.0, 6000.0, 1.2, 150.0
    for a in sys.argv[1:]:
        if a.startswith("--half="):
            half = float(a.split("=", 1)[1])
        elif a.startswith("--y1="):
            y1 = float(a.split("=", 1)[1])
        elif a.startswith("--min-area="):
            min_area = float(a.split("=", 1)[1])
        elif a.startswith("--min-height="):
            min_height = float(a.split("=", 1)[1])

    records = []

    # THE HOOK'S REAL SIGNATURE, copied from the generator rather than guessed:
    #   _wl_piece_hook(mesh_key, location, scale, label, rotation, mat)
    # Guessing it put the rotation in the label column and the label in the
    # material column, and the gate happily reported 92 failures made of
    # nonsense. A hook read in the wrong order still runs.
    def record(mesh_key, location, scale, label, rotation=(0.0, 0.0, 0.0), mat=None):
        records.append((mesh_key, location, scale, mat, label))

    # ONE STUB, THE DRY RUN'S. A second hand-written `unreal` stub would drift
    # from the first and this gate would then be measuring a different world
    # from every other offline check.
    import importlib.util
    _spec = importlib.util.spec_from_file_location(
        "wl_dryrun", os.path.join(HERE, "verify-generator-dryrun.py"))
    _dry = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_dry)
    sys.modules["unreal"] = _dry.make_unreal()
    sys.path.insert(0, HERE)
    from wl_preview_leaf import apply as _wl_leaf_apply

    src = io.open(GEN, encoding="utf-8").read()
    ns = {"__name__": "__wl_corridor__", "__file__": GEN}
    exec(compile(src, GEN, "exec"), ns)
    _wl_leaf_apply(ns)
    if "_wl_piece_hook" not in ns:
        raise SystemExit("generate-hub-level.py no longer defines _wl_piece_hook "
                         "— this gate cannot read the world and will not pretend to.")
    ns["_wl_piece_hook"] = record
    records[:] = []
    ns["build"](json.load(io.open(LAYOUT, encoding="utf8")))
    if not records:
        raise SystemExit("verify-hero-corridor: the generator placed NOTHING. "
                         "An empty world passes every check, so this is a failure.")

    hits = {}
    for mesh, loc, scale, mat, label in records:
        try:
            x, y = float(loc[0]), float(loc[1])
            sx, sy = abs(float(scale[0])), abs(float(scale[1]))
        except (TypeError, ValueError, IndexError):
            continue
        if abs(x) >= half or not (-1450.0 < y < y1):
            continue
        if any(str(label).startswith(a) or a in str(label) for a in ALLOW):
            continue
        # OCCLUSION IS HEIGHT x WIDTH, NOT FOOTPRINT. A wide flat boulder on
        # the walk hides nothing; a narrow post the height of a man hides the
        # Dog behind it. Judging on footprint alone the gate reported three
        # rocks and a shrub -- none of which block anything -- while a floor
        # slab would have scored higher than either.
        #
        # So: it has to be tall enough to occlude AND wide enough to matter.
        # A UE primitive at scale 1 is 100 uu in every axis.
        try:
            sz = abs(float(scale[2]))
        except (TypeError, ValueError, IndexError):
            sz = 0.0
        height_uu = sz * 100.0
        area = (sx * 100.0) * (sy * 100.0) / 10000.0
        if height_uu < min_height or area < min_area:
            continue
        fam = str(label).split("_", 1)[0]
        prev = hits.get(fam)
        if prev is None or area > prev[0]:
            hits[fam] = (area, x, y, mat, label, height_uu)

    if not hits:
        print("verify-hero-corridor OK — %d pieces placed, nothing at least "
              "%.0f uu tall with a footprint over %.1f m2 stands in the hero "
              "sight line (|x| < %.0f, %.0f < y < %.0f)"
              % (len(records), min_height, min_area, half, -1450.0, y1))
        return 0

    print("verify-hero-corridor FAILED — %d family/families stand in the hero "
          "sight line. The goal's eye path is Dog -> gate/garden -> castle, and "
          "a solid object here ends it at the first step.\n" % len(hits))
    for fam, (area, x, y, mat, label, height) in sorted(hits.items(), key=lambda kv: -kv[1][0]):
        print("  %-22s %7.1f m2 x %5.0f uu tall at (%+.0f, %+.0f)  %-12s e.g. %s"
              % (fam, area, height, x, y, mat, label))
    print("\n  FIX: route it through _off_sight_line (landmarks and water already "
          "are), or add it to this gate's ALLOW list with a reason.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
