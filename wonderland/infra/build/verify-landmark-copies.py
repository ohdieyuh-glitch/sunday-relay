#!/usr/bin/env python3
"""Catch a COPY of a landmark's coordinates living in the generator.

WHY THIS EXISTS

`HeroLight_Gate` is a violet-warm practical whose entire job is to sit inside
the Golden Build Gate. It was authored at (-1050, 400). The gate was moved to
(-880, 1180) in a later pass, and the light stayed where it was -- 800 uu away,
lighting empty lawn, for as long as it took a frame to be looked at closely.

Nothing was wrong with either number. The defect is that there were TWO of them
for one fact, so moving the landmark could not move the light. `landmark_xy(id,
fallback)` in the generator is the fix: ask the layout by name and get the
staged position, keep-out and sight-line rules already applied.

This gate finds the ones that were never converted. It reads the generator as
TEXT and looks for a numeric pair on one line that matches some landmark's
authored location -- which is what a copy looks like, and what a call to
`landmark_xy` does not.

    python3 verify-landmark-copies.py [--tolerance=40]

Exit 1 if any copy is found.

WHAT IT DELIBERATELY DOES NOT DO: it does not flag a line that already calls
landmark_xy (the fallback literal beside the call is the point of the fallback),
and it does not flag the layout file. It cannot see a copy that has been
arithmetically disguised -- `-1050.0 + 0.0` -- and does not pretend to.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
LAYOUT = os.path.normpath(os.path.join(HERE, "..", "..", "WorldDesign", "hub-layout.json"))

# A COMMA-ADJACENT PAIR, which is what an (x, y) argument pair looks like.
# Matching merely-adjacent numbers found `520.0 * s, 0.5 * s` for a landmark at
# (520, 40) thirty-four times: the second number has to be a COORDINATE, not a
# scale that happens to fall inside an absolute tolerance.
_TQ = chr(34) * 3
_SQ = chr(39) * 3
PAIR = re.compile(r"(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)")

# Only landmarks genuinely off both axes can be recognised this way. One at
# x = 0 matches any lone zero, and one at y = 40 matches any 0.5 within any
# absolute tolerance worth having. Those are UNCHECKABLE by this method and
# saying so is better than a gate that reports them wrongly.
MIN_COORD = 250.0


def main():
    tol = 40.0
    for a in sys.argv[1:]:
        if a.startswith("--tolerance="):
            tol = float(a.split("=", 1)[1])

    import json
    layout = json.load(io.open(LAYOUT, encoding="utf-8"))
    marks = []
    for m in layout.get("landmarks", ()):
        if isinstance(m, dict) and isinstance(m.get("location"), list) and len(m["location"]) >= 2:
            marks.append((m.get("id", "?"), float(m["location"][0]), float(m["location"][1])))
    if not marks:
        print("verify-landmark-copies: no landmarks in %s" % LAYOUT)
        return 1

    checkable = [m for m in marks if abs(m[1]) >= MIN_COORD and abs(m[2]) >= MIN_COORD]
    skipped = [m[0] for m in marks if m not in checkable]

    def near(a, b):
        """Within the tolerance, or 5% -- whichever is larger."""
        return abs(a - b) <= max(tol, abs(b) * 0.05)

    hits = []
    in_doc = False                             # inside a triple-quoted block
    for n, raw in enumerate(io.open(GEN, encoding="utf-8").read().split("\n"), 1):
        # PROSE IS NOT CODE. Two of this gate's first six hits were docstrings
        # quoting the very coordinates they exist to explain -- a gate that
        # cannot tell code from a comment reports the comment.
        ticks = raw.count(_TQ) + raw.count(_SQ)
        was_doc = in_doc
        if ticks % 2:
            in_doc = not in_doc
        if was_doc or in_doc:
            continue
        line = raw.split("#", 1)[0]            # a trailing comment is prose too
        if not line.strip() or "landmark_xy" in line:
            continue
        # An explicit acknowledgement, for a pair that genuinely is not a copy:
        # boulder scatter happens to straddle a landmark. Saying so on the one
        # line is better than loosening the tolerance for every line.
        if "not-a-landmark-copy" in raw:
            continue
        for m in PAIR.finditer(line):
            ax, ay = float(m.group(1)), float(m.group(2))
            if abs(ax) < MIN_COORD or abs(ay) < MIN_COORD:
                continue
            for mid, lx, ly in checkable:
                if near(ax, lx) and near(ay, ly):
                    hits.append((n, mid, ax, ay, lx, ly, raw.strip()[:88]))
                    break

    if not hits:
        print("verify-landmark-copies OK — no copied coordinate pair in "
              "generate-hub-level.py.\n  checked %d landmark(s) at tolerance "
              "max(%.0f uu, 5%%)\n  NOT CHECKABLE, within %.0f uu of an axis: %s"
              % (len(checkable), tol, MIN_COORD, ", ".join(skipped) or "none"))
        return 0

    print("verify-landmark-copies FAILED — %d coordinate pair(s) copied from a "
          "landmark instead of asked for by name:\n" % len(hits))
    for n, mid, ax, ay, lx, ly, txt in hits:
        print("  generate-hub-level.py:%d" % n)
        print("      (%.0f, %.0f) matches landmark '%s' at (%.0f, %.0f)" % (ax, ay, mid, lx, ly))
        print("      %s" % txt)
        print("      FIX: x, y = landmark_xy(%r, (%.1f, %.1f))\n" % (mid, ax, ay))
    return 1


if __name__ == "__main__":
    sys.exit(main())
