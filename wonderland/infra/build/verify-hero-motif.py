#!/usr/bin/env python3
"""The Relay Dog stands ON its arcane circle. Checked, because it did not.

    python3 wonderland/infra/build/verify-hero-motif.py

The founder's reference has one identifying element above all others: a glowing
violet arcane circle on the ground BENEATH the hero Relay Dog. The art bible
calls it "the single most identifying element of the shot".

It was not beneath the Dog. Measured off the generator on 2026-08-21: the rings
were centred at (0, 0) with an outermost radius of 320 uu and the gold studs at
300, while HERO_DOG stood at (-260, -260) — 368 uu from the centre, 48 uu beyond
the rim. The violet practical whose only job is to put violet light on the hero
was at (0, 0) too, pooling on empty paving. And the comment beside HERO_DOG said
the opposite: "further back onto its own arcane circle — which is the beat, the
Dog standing on its Relay identity".

Nothing caught it because nothing was looking. This looks.

EVERY NUMBER IS PARSED OUT OF THE GENERATOR, not restated here. verify-dog-proxy
learned that lesson the expensive way: a checker with its own copy of the
constants reports mismatches in the wrong place the moment the real ones move.
"""
import io
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")

# UE's /Engine/BasicShapes/Cylinder is 100 uu across, so an actor scale of s
# gives a radius of 50s. Stated once, here, because it is the conversion the
# whole check turns on.
CYLINDER_RADIUS_PER_SCALE = 50.0


def source():
    with io.open(GEN, encoding="utf8") as handle:
        return handle.read()


def hero_dog(src):
    match = re.search(r"HERO_DOG\s*=\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)", src)
    if not match:
        raise SystemExit("HERO_DOG not found in the generator. Nothing was checked.")
    return float(match.group(1)), float(match.group(2))


def ring_radius(src):
    """The outermost arcane ring, from the rings table itself."""
    match = re.search(r"rings\s*=\s*\[(.*?)\]", src, re.S)
    if not match:
        raise SystemExit("the arcane rings table not found. Nothing was checked.")
    scales = [float(s) for s in re.findall(r"\(\s*[\d.]+\s*,\s*([\d.]+)\s*,", match.group(1))]
    if not scales:
        raise SystemExit("no ring scales parsed. Nothing was checked.")
    return max(scales) * CYLINDER_RADIUS_PER_SCALE


def stud_radius(src):
    match = re.search(r'"Glyph%d"', src)
    if not match:
        return None
    window = src[max(0, match.start() - 500):match.start()]
    radii = [float(r) for r in re.findall(r"math\.cos\(a\)\s*\*\s*([\d.]+)", window)]
    return max(radii) if radii else None


def circle_follows_dog(src):
    """Is the circle actually handed the Dog's position at the call site?"""
    return bool(re.search(r"kit_plaza\([^)]*circle\s*=\s*HERO_DOG", src))


def light_follows_dog(src):
    match = re.search(r"\(([^)]*?),\s*\(176,\s*108,\s*255\),[^)]*?\"HeroLight_Arcane\"\)", src)
    if not match:
        return None
    return "HERO_DOG" in match.group(1)


def main():
    src = source()
    dog_x, dog_y = hero_dog(src)
    rim = ring_radius(src)
    studs = stud_radius(src)
    follows = circle_follows_dog(src)
    lit = light_follows_dog(src)

    # WHERE THE CIRCLE ACTUALLY IS. When kit_plaza is handed circle=HERO_DOG the
    # centre is the Dog and the offset is zero by construction; otherwise it is
    # the plaza centre the call site passes.
    if follows:
        offset = 0.0
        centre = "HERO_DOG"
    else:
        plaza = re.search(r"kit_plaza\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)", src)
        px, py = (float(plaza.group(1)), float(plaza.group(2))) if plaza else (0.0, 0.0)
        offset = math.hypot(dog_x - px, dog_y - py)
        centre = "(%.0f, %.0f)" % (px, py)

    print("HERO MOTIF")
    print("  hero Dog          (%.0f, %.0f)" % (dog_x, dog_y))
    print("  circle centre     %s" % centre)
    print("  outer ring radius %.0f uu" % rim)
    if studs:
        print("  gold studs at     %.0f uu" % studs)
    print("  Dog is %.0f uu from the circle centre" % offset)

    problems = []
    if offset > rim:
        problems.append(
            "the Dog stands %.0f uu from the circle centre and the outermost ring "
            "reaches %.0f — it is %.0f uu OUTSIDE its own arcane circle. That "
            "circle is the founder's single most identifying element and it is "
            "supposed to be under the Dog." % (offset, rim, offset - rim))
    elif offset > rim * 0.5:
        problems.append(
            "the Dog is %.0f uu off centre on a circle of radius %.0f — inside "
            "the rim but past halfway, which reads as standing at the edge "
            "rather than on it." % (offset, rim))
    if lit is False:
        problems.append(
            "HeroLight_Arcane is not placed on HERO_DOG. It is the one practical "
            "whose whole job is to put violet light on the hero; anywhere else "
            "and it pools on empty paving.")
    elif lit is None:
        problems.append("HeroLight_Arcane was not found — the violet key on the "
                        "hero cannot be checked, so it is not claimed.")

    print()
    if problems:
        for problem in problems:
            print("  MISS %s" % problem)
        print("\nHERO MOTIF: NOT MET")
        return 1
    print("  HERO MOTIF OK — the Dog stands on its circle, and the violet "
          "practical is on it too")
    return 0


if __name__ == "__main__":
    sys.exit(main())
