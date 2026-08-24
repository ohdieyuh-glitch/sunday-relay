#!/usr/bin/env python3
"""No frame-filling material may be authored pale.

WHY THIS EXISTS -- and it is the answer to a question that cost most of a week.

Wonderland kept rendering grey. Fourteen explanations were proposed and refuted
against real frames: the batch binding, the material overwrite, specular, fog,
sky hue, bloom, the ACES shoulder, ambient wash, metal-vs-dielectric, the
BaseColor wiring, emissive defaults, aerial perspective, a stale cached master,
a dead BaseColor parameter. Every one was checked. Every one was innocent.

The runtime probe in WonderlandInstancedBatch.cpp settled the binding question
for good: every batch resolves its intended material, `overrides=1`, zero
mismatches, and the bound object reports a vivid BaseColor -- MI_stone at
(1.000, 0.460, 0.571), MI_mush_red at (1.000, 0.003, 0.188). The materials were
never wrong.

WHAT WAS ACTUALLY WRONG

This file's own LOOK table already recorded the mechanism, measured:

    "ambient arrives from every direction at once, indirect light comes back
     off neighbours, specular is white on a dielectric, and the tonemapper
     compresses. Every one of those steps moves a surface toward the light's
     colour and none move it back."

Physically-based shading delivers roughly a THIRD of a material's authored
saturation. That is not a defect; it is what the renderer does. It means the
palette has to be authored PAST the target, which the LOOK table argues for at
length -- and which had been applied to the accents and never to the materials
that actually cover the screen.

Measured on the delivered frame at 1d4a1a8, over the mushroom field, a region
large enough to identify by eye and impossible to misattribute:

    authored mush_white   saturation 0.184
    delivered             saturation 0.095

0.184 x ~0.35 = 0.09. The arithmetic closes. There was nothing left to find.
The ground, the plazas, the tower band, the mushroom caps and the porcelain --
the materials that fill the frame -- were authored between 0.18 and 0.40, so
the frame could only ever come back grey however the lighting was tuned.

WHAT THIS CHECKS

Every material in the palette carries at least FLOOR saturation, unless it is
on the allow-list below. The allow-list is short and every entry states why it
is achromatic on purpose -- a material is exempt because of what it IS, never
because it happens to fail.

It is offline and it runs in a second on a laptop, which matters: the frame
that proves it costs a 35-minute package and a GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")

FLOOR = 0.35

# ACHROMATIC ON PURPOSE. Each of these is exempt because of what the thing is,
# not because it failed. Anything added here needs a reason of the same kind.
ALLOW = {
    "dog_body":   "the Relay Dog's canonical white body -- identity, not palette",
    "dog_bone":   "the Skeleton Flame skin's bone white -- the same identity",
    "dog_visor":  "the canonical black visor",
    "spray":      "fountain foam; water broken into droplets really is white",
    "cloud":      "cumulus stood in for by geometry",
    "cloud_warm": "the same, on the sunlit side",
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
        print("      Physically-based shading delivers about a THIRD of authored")
        print("      saturation. A material authored at %.2f arrives at roughly" % FLOOR)
        print("      %.2f, which is the point at which a surface reads as grey." % (FLOOR / 3.0))
        print("      This is not fixed by lighting, by the grade, or by emissive:")
        print("      all three were tried, measured and refuted. It is fixed by")
        print("      authoring the palette past the target.")
        print()
        for n, c, s in sorted(pale, key=lambda t: t[2]):
            print("   %-14s (%.2f, %.2f, %.2f)   saturation %.3f   -> delivers ~%.3f"
                  % (n, c[0], c[1], c[2], s, s / 3.0))
        return 1

    print("PASS: every material that is not achromatic by design is authored "
          "to survive being lit.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
