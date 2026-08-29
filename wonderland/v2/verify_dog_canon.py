#!/usr/bin/env python3
"""GATE: the Unreal Relay Dog is THE SAME character as the web Dog — measurably.

  python3 wonderland/v2/verify_dog_canon.py                 # canon self-check + ratio table
  python3 wonderland/v2/verify_dog_canon.py --log wp-dog.log   # + compare the generator's
                                                              #   measured part extents (uu)

Checks (1) every canonical band from relay-dog.ts holds for the transcribed
numbers, (2) the web->Unreal mapping preserves every size and the handedness
(the tail stays on the Dog's LEFT hip: -Y in Unreal), (3) with --log, the
extents the generator MEASURED on the built meshes match the canon within
tolerance, part by part. Exit 1 on any failure. Stdlib only; no engine.
"""
import re
import sys

import dog_canon as D

TOL_UU = 0.6   # measured extents vs canon, in uu (Geometry Script boxes are exact; this is float slack)


def fail(msg):
    print("FAIL " + msg)
    return 1


def box_range(name, axis):
    """(lo, hi) of one canonical box on one web axis."""
    for bname, _joint, _surface, centre, size in D.BOXES:
        if bname == name:
            return centre[axis] - size[axis] / 2.0, centre[axis] + size[axis] / 2.0
    raise KeyError(name)


def check_seams():
    """THE ELBOWS AND KNEES COST NOTHING IN SILHOUETTE — proven, not asserted.

    Splitting a limb so it can pivot is only safe if the standing Dog is the
    same object it was: the founder's rule is that the proportions ARE the
    identity. Two things make that checkable:

      1. each hinge block is strictly inside BOTH limbs it joins on the two
         axes across the limb (it straddles the seam on the long axis by
         design), so a straight arm hides it completely;
      2. the two halves of a split limb TILE the original block exactly —
         same outer bounds, and they meet at the seam with no gap and no
         overlap. A gap would show as a slot in the leg; an overlap would
         z-fight.

    Both are arithmetic on the canon table, so they hold on this laptop with
    no engine, and they fail loudly the moment someone nudges a seam.
    """
    rc = 0
    for hinge, upper, lower in D.SEAMS:
        for axis, label in ((0, "x"), (2, "z")):
            h = box_range(hinge, axis)
            for limb in (upper, lower):
                lo, hi = box_range(limb, axis)
                if not (lo - 1e-9 <= h[0] and h[1] <= hi + 1e-9):
                    rc |= fail("hinge %s escapes %s on %s: %.4f..%.4f not inside %.4f..%.4f"
                               % (hinge, limb, label, h[0], h[1], lo, hi))
        hy = box_range(hinge, 1)
        uy, ly = box_range(upper, 1), box_range(lower, 1)
        if abs(uy[0] - ly[1]) > 1e-6:
            rc |= fail("seam %s: %s bottom %.4f does not meet %s top %.4f" % (hinge, upper, uy[0], lower, ly[1]))
        if not (ly[0] - 1e-9 <= hy[0] and hy[1] <= uy[1] + 1e-9):
            rc |= fail("hinge %s reaches outside the limb pair on y: %.4f..%.4f" % (hinge, hy[0], hy[1]))
        print("  seam %-14s hinge %.4f..%.4f hidden inside %s+%s (%.4f..%.4f), meeting at %.4f"
              % (hinge, hy[0], hy[1], upper, lower, ly[0], uy[1], uy[0]))
    # the legs must still be exactly the web's single block, in two pieces
    for side, thigh, shin in (("Left", "legLeftThigh", "legLeftShin"), ("Right", "legRightThigh", "legRightShin")):
        t, sh = box_range(thigh, 1), box_range(shin, 1)
        if abs(sh[0] - D.FOOT_TOP) > 1e-9 or abs(t[1] - D.LEG_TOP) > 1e-9:
            rc |= fail("leg %s no longer spans FOOT_TOP..LEG_TOP: %.4f..%.4f" % (side, sh[0], t[1]))
        for axis, label in ((0, "x"), (2, "z")):
            if box_range(thigh, axis) != box_range(shin, axis):
                rc |= fail("leg %s halves disagree on %s" % (side, label))
    # every joint must hang from a real parent, and every box belong to a joint
    for joint, parent in D.PARENTS.items():
        if joint not in D.JOINTS:
            rc |= fail("PARENTS names %s, which is not a joint" % joint)
        if parent is not None and parent not in D.JOINTS:
            rc |= fail("joint %s hangs from %s, which is not a joint" % (joint, parent))
    for joint in D.JOINTS:
        if joint not in D.PARENTS:
            rc |= fail("joint %s has no entry in PARENTS" % joint)
    for _n, joint, _s, _c, _sz in D.BOXES:
        if joint not in D.JOINTS:
            rc |= fail("a box belongs to unknown joint %s" % joint)
    return rc


def main(argv):
    rc = 0
    m = D.measurements()
    print("RELAY DOG CANON (HEAD_WIDTH = 1.000; total height %.4f)" % m["totalHeight"])
    for k, v in m.items():
        print("  %-14s %.4f" % (k, v))
    for key, (lo, hi) in D.DOG_CANON.items():
        v = m[key]
        ok = lo - 1e-9 <= v <= hi + 1e-9
        print("  band %-11s %.3f in [%.2f, %.2f] %s" % (key, v, lo, hi, "ok" if ok else "OUT OF BAND"))
        if not ok:
            rc |= fail("%s outside the canonical band" % key)
    if len(D.BOXES) != 37:
        rc |= fail("expected 37 canonical boxes (31 web boxes + 2 leg splits + 4 hinges), transcribed %d" % len(D.BOXES))
    rc |= check_seams()
    # (2) mapping: sizes preserved, handedness flipped so shape is preserved
    scale = 60.0
    for name, joint, surface, centre, size in D.BOXES:
        c_ue, d_ue = D.to_unreal(centre, size, scale)
        if abs(d_ue[0] - size[2] * scale) > 1e-9 or abs(d_ue[1] - size[0] * scale) > 1e-9 or abs(d_ue[2] - size[1] * scale) > 1e-9:
            rc |= fail("size not preserved for %s" % name)
    tail = [b for b in D.BOXES if b[1] == "tail"]
    tail_y = [D.to_unreal(b[3], b[4], scale)[0][1] for b in tail]
    if not all(y < 0 for y in tail_y):
        rc |= fail("the tail must sit on the Dog's LEFT hip (-Y in Unreal); got %s" % tail_y)
    eyes = sorted(b for b in D.BOXES if b[2] == "eye")
    if len(eyes) != 2:
        rc |= fail("exactly two eyes")
    # (3) generator log
    log = None
    if "--log" in argv:
        log = argv[argv.index("--log") + 1]
    if log:
        text = open(log, errors="replace").read()
        found = 0
        want = D.parts(scale)
        for (joint, surface), boxes in want.items():
            lo, hi = D.extents(boxes)
            pat = re.compile(r"DOG PART %s_%s extents=([-\d.]+),([-\d.]+),([-\d.]+) size=([-\d.]+),([-\d.]+),([-\d.]+)" % (joint, surface))
            mm = pat.search(text)
            if not mm:
                rc |= fail("no measured extents for %s_%s in %s" % (joint, surface, log))
                continue
            found += 1
            got_size = tuple(float(mm.group(i)) for i in (4, 5, 6))
            exp_size = tuple(hi[i] - lo[i] for i in range(3))
            for i, axis in enumerate("xyz"):
                if abs(got_size[i] - exp_size[i]) > TOL_UU:
                    rc |= fail("%s_%s size %s: measured %.2f vs canon %.2f uu" % (joint, surface, axis, got_size[i], exp_size[i]))
            print("  measured %-16s size (%.1f, %.1f, %.1f) uu  canon (%.1f, %.1f, %.1f)  ok" % (
                joint + "_" + surface, got_size[0], got_size[1], got_size[2], exp_size[0], exp_size[1], exp_size[2]))
        scale_line = re.search(r"DOG SCALE W_UU=([\d.]+)", text)
        if scale_line and abs(float(scale_line.group(1)) - scale) > 1e-6:
            rc |= fail("generator ran at W_UU=%s, gate assumes %s" % (scale_line.group(1), scale))
        print("  %d/%d parts measured" % (found, len(want)))
    print("VERDICT %s" % ("PASS" if rc == 0 else "FAIL"))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
