#!/usr/bin/env python3
"""Every landmark must build to the height hub-layout.json declares for it.

WHY THIS GATE EXISTS. hub-layout.json gives all 19 landmarks a dimensionsUu,
and for a long time the generator consulted it in exactly one place. The rest
were built at whatever scale their kit call happened to pass, so the layout's
authored sizes were decoration. Measuring them found the damage:

    rose_arch          2.61x its declared height
    overlook_terrace   2.56x
    framing_tree       2.54x   (and before that, not built AT ALL)
    clock_tower        2.00x
    agent_pergola      1.83x
    stacked_teacup_a   0.42x
    portrait_frame     0.48x

Oversized props crowd the top third of the arrival frame; undersized ones read
as clutter rather than as the tea-party landmarks the reference is full of.
Neither failure is visible in a screenshot as a SIZE error -- it just looks
wrong -- which is why it survived so long and why it needs a number.

This runs the generator offline against the stubbed engine, groups the emitted
pieces by landmark id, and compares each built z-extent to the declared one.
It needs no GPU and no engine.

A landmark that builds NO pieces is a hard failure: that is how the Great
Framing Tree, a primary sightlineHero landmark, went missing without a word.
"""
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
WL = os.path.dirname(os.path.dirname(HERE))
LAYOUT = os.path.join(WL, "WorldDesign", "hub-layout.json")
PREVIEW = os.path.join(HERE, "verify-hero-composition.py")

# A kit is a built form, not a box, so it will never hit its declared height to
# the millimetre. These bounds are wide enough for honest kit variation and far
# too tight for the 2.5x and 0.4x errors above.
LO, HI = 0.70, 1.40


def main():
    with tempfile.TemporaryDirectory() as td:
        dump = os.path.join(td, "actors.json")
        env = dict(os.environ, WL_DUMP_ACTORS=dump)
        proc = subprocess.run([sys.executable, PREVIEW], env=env,
                              stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        if not os.path.exists(dump):
            print("FAIL: the offline preview produced no actor dump")
            print(proc.stdout.decode("utf8", "replace")[-2000:])
            return 1
        with open(dump, encoding="utf8") as fh:
            actors = json.load(fh)

    with open(LAYOUT, encoding="utf8") as fh:
        landmarks = json.load(fh)["landmarks"]

    # One pass over the actors, bucketed by id, instead of a scan per landmark.
    ids = [m.get("id", "") for m in landmarks]
    buckets = {i: [] for i in ids}
    for a in actors:
        label = a["label"]
        for i in ids:
            if label == i or label.startswith(i + "_"):
                buckets[i].append(a)
                break

    failures = []
    print("%-28s %8s %8s %7s" % ("landmark", "declared", "built", "ratio"))
    for m in landmarks:
        mid = m.get("id", "")
        dims = m.get("dimensionsUu")
        parts = buckets.get(mid, [])
        if not dims or len(dims) < 3:
            print("%-28s %8s %8s %7s" % (mid, "-", "-", "no dims"))
            continue
        declared = float(dims[2])
        if not parts:
            print("%-28s %8.0f %8s %7s" % (mid, declared, "NONE", "MISSING"))
            failures.append("%s builds no geometry at all" % mid)
            continue
        lo = min(a["loc"][2] - abs(a["scale"][2]) * 50.0 for a in parts)
        hi = max(a["loc"][2] + abs(a["scale"][2]) * 50.0 for a in parts)
        built = hi - lo
        ratio = built / declared if declared > 0 else 0.0
        bad = not (LO <= ratio <= HI)
        print("%-28s %8.0f %8.0f %7.2f%s"
              % (mid, declared, built, ratio, "   <-- OFF SPEC" if bad else ""))
        if bad:
            failures.append("%s: declared %.0f uu, builds %.0f uu (%.2fx)"
                            % (mid, declared, built, ratio))

    print()
    if failures:
        print("FAIL: %d landmark(s) do not build to their declared size" % len(failures))
        for f in failures:
            print("  - %s" % f)
        return 1
    print("PASS: all %d landmarks build within [%.2f, %.2f] of their declared height"
          % (len(landmarks), LO, HI))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
