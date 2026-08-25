#!/usr/bin/env python3
"""Nothing in the visible palette may be authored neutral.

WHAT THIS FILE USED TO CLAIM, AND WHY THAT WAS WRONG

This gate was written on the theory that physically-based shading delivers only
about a THIRD of a material's authored saturation, so the palette had to be
authored past the target to survive being lit. It even carried arithmetic that
appeared to close: mush_white authored 0.184, delivered 0.095.

That theory is REFUTED, by the frame that fixed the real defect. 38 materials
were being replaced by the engine's DEFAULT GREY at draw time, because the
master material never declared bUsedWithInstancedStaticMeshes and Wonderland
draws 137,816 of its pieces as instances (see verify-material-usage-flags.py).
The 0.095 was not shading loss. It was the engine's grey.

MEASURED on the first frame after the fix, across twelve large single-material
panels: delivered saturation is 103% of authored. Shading costs essentially
nothing here. Every material re-authored "past the target" has been reverted,
along with the three knobs raised to compensate.

WHAT IT CHECKS NOW, on a claim that is actually true

The founder's direction is explicit -- "I better not see a single grey
anywhere" -- and that is a statement about the PALETTE, not about the renderer.
So this fails when a material that is not achromatic BY DESIGN is authored at a
saturation low enough to read as grey no matter how well it is drawn.

The floor is deliberately low. It is a floor against neutral, not a lever for
vividness: pushing saturation to make a frame colourful is exactly the mistake
recorded above, and it is the renderer's job now that the renderer works.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")

FLOOR = 0.12

# ACHROMATIC ON PURPOSE. Each of these is exempt because of what the thing is,
# not because it failed. Anything added here needs a reason of the same kind.
ALLOW = {
    "dog_body":   "the Relay Dog's canonical white body -- identity, not palette",
    "dog_bone":   "the Skeleton Flame skin's bone white -- the same identity",
    "dog_visor":  "the canonical black visor",
    "spray":      "fountain foam; water broken into droplets really is white",
    "cloud":      "cumulus stood in for by geometry",
    "cloud_warm": "the same, on the sunlit side",
    # THE MASONRY, ADDED 2026-08-24 WITH A MEASUREMENT BEHIND IT.
    #
    # These five failed this gate the moment the architecture palette was cut
    # from the brightness of paper down to real stone, and the failure is worth
    # taking seriously rather than waving through: this gate exists because a
    # previous session authored the world grey and it rendered grey.
    #
    # What makes them exempt is what they ARE. The founder's material direction
    # is explicit — "white = ivory/cream fantasy masonry", "no blown-out
    # white/gold" — and cream is a hue at LOW CHROMA by definition. The
    # reference is a pale stone city whose colour lives in its roofs, its roses,
    # its mushrooms and its magic, none of which are in this list and none of
    # which were touched.
    #
    # And the frame agrees. Measured on the native HeroCam6 render before and
    # after the cut, mean saturation went 0.23 -> 0.44 against the reference's
    # 0.43 — it went UP by desaturating these five, because a near-white surface
    # contributes no chroma of its own and drags the mean down by occupying the
    # frame. Raising their saturation would move the picture away from the
    # reference, which is the exact mistake the docstring above warns about
    # from the other direction.
    "stone":      "ivory masonry; cream is a hue at low chroma, and the roofs carry the colour",
    "plaza":      "the same courtyard stone, one step darker",
    "cobble":     "the paving's pale course",
    "cobble2":    "the paving's dark course -- the checker needs a neutral pair",
    "porcelain":  "china; glaze is white and the pattern on it is not the material",
    "spire_far":  "distant towers, deliberately pale so aerial perspective reads as distance",
}


def palette(src):
    """Every ((r, g, b), ...) entry in the material table, by name."""
    out = []
    for m in re.finditer(
            r'"([a-z_0-9]+)":\s*\(\(\s*([0-9.]+),\s*([0-9.]+),\s*([0-9.]+)\s*\)',
            src):
        name = m.group(1)
        rgb = tuple(float(m.group(i)) for i in (2, 3, 4))
        out.append((name, rgb))
    return out


def sat(rgb):
    hi = max(rgb)
    return 0.0 if hi <= 0.0 else (hi - min(rgb)) / hi


def main():
    src = io.open(GEN, encoding="utf8").read()
    mats = palette(src)
    if len(mats) < 30:
        print("FAIL: only %d materials were found in %s. This validator has "
              "drifted from the table it checks, and a check that cannot find "
              "its subject must never report a pass." % (len(mats), GEN))
        return 1

    pale = [(n, c, sat(c)) for n, c in mats if n not in ALLOW and sat(c) < FLOOR]
    exempt = [n for n, _ in mats if n in ALLOW]

    print("materials in palette : %d" % len(mats))
    print("saturation floor     : %.2f" % FLOOR)
    print("achromatic by design : %d  (%s)" % (len(exempt), ", ".join(sorted(exempt))))
    print("below the floor      : %d" % len(pale))
    print()

    if pale:
        print("FAIL: %d material(s) are authored too pale to survive being lit." % len(pale))
        print()
        print("      A material this close to neutral reads as grey however well")
        print("      it is drawn, and the founder's direction is that nothing in")
        print("      Wonderland should. Give it a hue, or add it to ALLOW with a")
        print("      reason for being achromatic on purpose.")
        print()
        print("      Do NOT raise saturation here to make the frame more")
        print("      colourful. That was tried against a renderer that was")
        print("      silently drawing engine grey, and it changed nothing.")
        print()
        for n, c, s in sorted(pale, key=lambda t: t[2]):
            print("   %-14s (%.2f, %.2f, %.2f)   saturation %.3f"
                  % (n, c[0], c[1], c[2], s))
        return 1

    print("PASS: nothing in the visible palette is authored neutral.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
