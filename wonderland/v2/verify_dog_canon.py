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
    if len(D.BOXES) != 31:
        rc |= fail("expected 31 canonical boxes, transcribed %d" % len(D.BOXES))
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
