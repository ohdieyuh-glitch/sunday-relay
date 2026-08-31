#!/usr/bin/env python3
"""Does the route actually cross every kind of walking surface?

    python3 wonderland/v2/tools/surface_families.py

"The fix is not proven if only one road works" -- founder, 2026-08-31. The
step-height defect was one number applied to every flat slab in the world, so
the proof has to touch every family that number governs, and the TRANSITIONS
between them, which is where a lip would show.

A leg counts as touching a family when its line passes within reach of a slab
of that family. Reach is generous on purpose: this asks whether the Dog goes
NEAR each kind of surface, not whether it lands on a particular one.
"""
import math, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
os.environ.setdefault("WLV2_PASS02", "1"); os.environ.setdefault("WLV2_PASS03", "1")
import layout_v2 as L      # noqa: E402

#: label fragment -> the founder's name for it
#: Read off the world's own labels rather than guessed: the first version of
#: this used "Garden" and "Parterre" and matched four slabs out of 654.
FAMILIES = [
    ("processional road", ("RingRoad", "NorthWay", "_Road_Seg", "Procession")),
    ("garden path",       ("garden_P_Walk", "garden_Approach")),
    ("district lane",     ("Lane", "hamlet_Lane")),
    ("grove path",        ("grove_Path",)),
    ("water-garden walk", ("water_Walk", "lake_Walk")),
    ("stairs",            ("Steps", "Stair")),
    ("court / plaza",     ("court_P_Walk", "clockyard_Yard", "Plaza")),
]

#: NOT required to be crossed, and named here so the omission is a decision
#: rather than an oversight. A rill is a water channel the step-height contract
#: deliberately exempts (36 uu surface); walking down one is not traversal.
EXEMPT = ("water_Rill",)
REACH = 900.0     # uu from a leg's line


def main():
    gen = subprocess.run([sys.executable, os.path.join(HERE, "route.py"),
                          "--capsule=60", "--cpp"], capture_output=True, text=True).stdout
    legs = [(float(x), float(y)) for x, y in
            re.findall(r"Add\(([-\d.]+)f, ([-\d.]+)f", gen)]
    if len(legs) < 2:
        print("no route to check"); return 1
    surf = []
    for p in L.ALL:
        lab = p.get("label") or ""
        if p["asset"] not in ("terrace_platform", "path_steps", "side_steps", "stairs_broad"):
            continue
        surf.append((p["pos"][0], p["pos"][1], lab))
    print("ROUTE SURFACE COVERAGE -- %d legs, %d walking slabs in the world\n" % (len(legs), len(surf)))
    print("%-20s %8s %8s   %s" % ("family", "slabs", "touched", "first leg that meets it"))
    print("-" * 74)
    ok = True
    for (name, keys) in FAMILIES:
        members = [(x, y) for (x, y, lab) in surf if any(k in lab for k in keys)]
        first, hits = None, 0
        for n, ((ax, ay), (bx, by)) in enumerate(zip(legs, legs[1:]), start=1):
            dx, dy = bx - ax, by - ay
            den = dx * dx + dy * dy or 1.0
            for (mx, my) in members:
                t = max(0.0, min(1.0, ((mx - ax) * dx + (my - ay) * dy) / den))
                if math.hypot(mx - (ax + t * dx), my - (ay + t * dy)) < REACH:
                    hits += 1
                    if first is None:
                        first = n
                    break
        print("%-20s %8d %8d   %s" % (name, len(members), hits,
                                      ("leg %d" % first) if first else "NEVER"))
        if members and first is None:
            ok = False
    print()
    print("every family the route governs is crossed" if ok
          else "SOME FAMILY IS NEVER CROSSED -- the traversal would not prove the fix")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
