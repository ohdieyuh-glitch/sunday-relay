#!/usr/bin/env python3
"""A lighting change must not quietly cost the world its colour.

WHY THIS EXISTS

Cutting the lantern practicals from 14,000 lumens to 2,200 was correct: they
were shadowless, gold, and eighteen of them against a 340-lux sun, so they
decided the hue of every material in the world. That was measured per material
and the fix stands.

It also halved the frame's colour, and nothing noticed for forty commits.

    a203547  base                  frame chroma 0.1826
    9bdb61e                        frame chroma 0.1655
    f80c8c6  lamps 14000 -> 2200   frame chroma 0.0907   <-- HALVED HERE
    84a66fd  head                  frame chroma 0.0835

The reason nothing noticed is that every metric being steered by was a PALETTE
CLASSIFIER count -- gold_amber 10.1% -> 0.6%, warm_timber_stone 23.6% -> 3.1%.
Those record a cast LEAVING. They cannot see colourfulness leaving with it,
because a frame that has lost all its colour scores beautifully on "not too
much gold". A whole session then went into hunting a defect downstream of that
change, refuting ten innocent mechanisms on the way.

So this measures the thing those numbers cannot: how much colour the frame
carries per unit of brightness.

WHY CHROMA OVER LUMA, AND NOT CHROMA

Because a darker frame has less chroma for uninteresting reasons. A Lambertian
surface lit at level E renders albedo*E, so chroma and luma both scale by E and
their RATIO does not -- it is the part that belongs to the world rather than to
the exposure.

Comparing raw chroma against raw SATURATION, (max-min)/max, is a different
formula and supports no conclusion at all. That mistake is how the size of this
defect got misreported for most of a session, including in a published report.

    python3 verify-colourfulness.py <capture.png> [floor]
"""
import os
import subprocess
import sys

# The base build delivered 0.93 and the frame it delivered was FALSE -- a cast
# is colourful. So this is deliberately NOT "as much as base". It is a floor
# under which the world has visibly lost its palette, set just below the
# corrected head reading of 0.298 so it catches the NEXT regression rather than
# failing on the current state and being switched off.
DEFAULT_FLOOR = 0.26


def srgb_to_linear(v):
    v = v / 255.0
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4


def measure(path):
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-vf", "scale=480:270",
         "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        stdout=subprocess.PIPE)
    raw = out.stdout
    if not raw:
        return None
    n = len(raw) // 3
    chroma = luma = 0.0
    for k in range(n):
        i = k * 3
        r = srgb_to_linear(raw[i])
        g = srgb_to_linear(raw[i + 1])
        b = srgb_to_linear(raw[i + 2])
        chroma += max(r, g, b) - min(r, g, b)
        luma += 0.299 * r + 0.587 * g + 0.114 * b
    return chroma / n, luma / n


def main():
    if len(sys.argv) < 2:
        print("usage: verify-colourfulness.py <capture.png> [floor]")
        return 2
    path = sys.argv[1]
    floor = float(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_FLOOR
    if not os.path.isfile(path):
        print("FAIL: no such capture: %s" % path)
        return 1

    got = measure(path)
    if got is None:
        print("FAIL: %s could not be decoded, so nothing was measured -- and a "
              "check that measured nothing must not report a pass." % path)
        return 1

    chroma, luma = got
    if luma <= 0.0:
        print("FAIL: the frame has no light in it at all (luma %.4f)" % luma)
        return 1
    ratio = chroma / luma

    print("frame            : %s" % os.path.basename(path))
    print("mean chroma      : %.4f" % chroma)
    print("mean luma        : %.4f" % luma)
    print("chroma per luma  : %.4f   (floor %.4f)" % (ratio, floor))
    print()

    if ratio < floor:
        print("FAIL: the world has lost its colour. This is what a lighting")
        print("      change costs when the light it removed was carrying the")
        print("      palette -- and the palette-family percentages will look")
        print("      FINE while it happens, because a frame with no colour left")
        print("      scores beautifully on 'not too much gold'.")
        return 1
    print("PASS: the frame carries its colour.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
