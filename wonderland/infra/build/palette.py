#!/usr/bin/env python3
"""One definition of the reference's colour families, and one classifier.

This exists because there are now two things that need to answer "what colour
family is this pixel": the composition preview, which measures OUR frame, and
measure-reference.py, which measures the FOUNDER'S image. Two copies of a
classifier is two answers to the same question, and the comparison between them
is the whole point — a drift between the copies would show up as a difference
between the world and the reference and be debugged as one.

The bands are measured off RENDERED PIXELS, never off material names. Names
drift and a family map built from them quietly stops describing the frame.
"""

# Ordered for reporting: the reference's own emphasis, roughly.
FAMILIES = (
    "cream_white",
    "pink_rose_red",
    "violet_purple",
    "gold_amber",
    "green_foliage",
    "blue_teal",
    "neutral_stone",
    "warm_timber_stone",
    "dark",
)

# The two thresholds that decide "is this a colour at all".
DARK_MAX = 60          # below this the pixel is shadow, whatever its hue
CHROMA_MIN = 26        # below this it is achromatic: stone or cream
CREAM_MIN = 165        # an achromatic pixel brighter than this is cream, not stone

# GOLD IS BRIGHT AND SATURATED; TIMBER AND FLAGSTONE ARE NEITHER.
# 20-65 degrees covers gold leaf AND tree bark AND warm paving. Measured as one
# bucket it read 28% and said "this world is more brass than fairy-tale" — a
# finding that would have sent someone to de-gold a world whose actual gold is
# a third of that.
GOLD_VALUE_MIN = 150
GOLD_SAT_MIN = 0.42


def hue_degrees(r, g, b, mx, chroma):
    """Hue in degrees for a pixel already known to be chromatic."""
    if mx == r:
        return 60.0 * (((g - b) / float(chroma)) % 6)
    if mx == g:
        return 60.0 * (((b - r) / float(chroma)) + 2)
    return 60.0 * (((r - g) / float(chroma)) + 4)


def classify(r, g, b):
    """The colour family one RGB pixel belongs to. Never returns None."""
    mx, mn = max(r, g, b), min(r, g, b)
    chroma = mx - mn
    if mx < DARK_MAX:
        return "dark"
    if chroma < CHROMA_MIN:
        return "cream_white" if mx > CREAM_MIN else "neutral_stone"
    h = hue_degrees(r, g, b, mx, chroma)
    if 20 <= h < 65:
        sat = chroma / float(mx)
        return ("gold_amber" if (mx >= GOLD_VALUE_MIN and sat >= GOLD_SAT_MIN)
                else "warm_timber_stone")
    if 65 <= h < 170:
        return "green_foliage"
    if 170 <= h < 250:
        return "blue_teal"
    if 250 <= h < 310:
        return "violet_purple"
    return "pink_rose_red"


def percentages(counts, total):
    """Family counts to percentages of a stated total, zeros included.

    Zeros ARE included on purpose: a family that is absent is a fact about the
    frame, and a dict that simply omits it makes 'violet is missing' and
    'violet was never measured' look identical.
    """
    total = max(1, total)
    return dict((f, 100.0 * counts.get(f, 0) / total) for f in FAMILIES)
