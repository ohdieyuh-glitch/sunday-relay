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


# Families that describe LIGHT rather than hue. A lit render pushes pixels into
# "dark" that an unlit projection leaves coloured, and pushes bright surfaces
# into "cream_white"; neither move says anything about the palette an artist
# chose.
ACHROMATIC = ("dark", "cream_white", "neutral_stone")

CHROMATIC = tuple(f for f in FAMILIES if f not in ACHROMATIC)


def chromatic_mix(counts):
    """The hue mix among COLOURED pixels only, as percentages summing to 100.

    Why this exists: comparing absolute family percentages between a lit render
    and an unlit projection is meaningless — the reference measures 25.7% dark
    and the preview 2.6%, and every other family is deflated in proportion.
    Dropping the three achromatic families and renormalising removes most of
    that, because shadow mostly changes a pixel's VALUE and not its hue.

    IT DOES NOT REMOVE ALL OF IT, and the honest caveat is specific: a hue whose
    every instance is in shadow disappears from a lit image entirely. In the
    founder's reference the green topiary does exactly that — it reads 0.00%
    green — so green stays unreliable here while pink, violet and gold do not.
    """
    total = sum(counts.get(f, 0) for f in CHROMATIC)
    if not total:
        return dict((f, 0.0) for f in CHROMATIC)
    return dict((f, 100.0 * counts.get(f, 0) / total) for f in CHROMATIC)


def chromatic_mix_from_pct(pct):
    """Same, from percentages rather than raw counts."""
    return chromatic_mix(dict((f, pct.get(f, 0.0)) for f in FAMILIES))


# HUES THE REFERENCE GETS FROM LIGHT RATHER THAN FROM PAINT, and how far to
# trust a delta on each. Measured on the founder's reference, sampling the SAME
# flagstone in three places:
#
#     inside the arcane circle   rgb(127, 77,145)  chroma 68  hue 284  violet
#     plaza just above it        rgb(185,147,164)  chroma 38  hue 333  pink
#     plaza far left             rgb( 43, 33, 29)  chroma 14  hue  17  DARK
#     plaza far right            rgb( 34, 28, 23)  chroma 11  hue  27  DARK
#
# One stone, three readings. The reference's violet is the circle's light
# flooding the plaza, not violet paint — and its far paving is nearly black
# because nothing is lighting it. So a violet deficit measured against it must
# NOT be closed by painting surfaces violet; the lever is the light.
#
# Green is worse: the reference's topiary is entirely in shadow and reads 0.0%,
# which says nothing about the palette at all.
LIGHT_DOMINATED = {
    "green_foliage": (
        "not comparable — the reference's topiary is entirely in shadow and "
        "measures 0.0%, which is a fact about its lighting and not its palette"),
    "violet_purple": (
        "read with care — most of the reference's violet is the arcane circle's "
        "LIGHT flooding the plaza, not violet surfaces. Measured: the same "
        "flagstone reads violet beside the circle and near-black away from it. "
        "Close this gap with light, never with paint"),
}
