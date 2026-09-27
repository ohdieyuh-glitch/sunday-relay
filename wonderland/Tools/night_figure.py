"""THE FIGURE MEASUREMENT, IN ONE PLACE, because it now has two callers.

zc_night_bodies photographs five skins at one place. zc_night_bodies_world photographs the one skin with no
glow geometry at five districts. Both need the same body/light/ground/form arithmetic, and the alternative is
two copies of it.

TWO COPIES IS NOT HYPOTHETICAL HERE. Three separate surfaces carried the sentence "DEVELOPMENT PREVIEW -
SIMULATED JULIUS EXECUTION" as a literal in three files today, and all three went stale together without any
of them noticing, because nothing compares two literals. A measurement is worse than a sentence: two copies of
a threshold drift apart silently and both keep publishing numbers.

Nothing here touches the world, the engine or PIE. It reads a PNG and returns numbers.
"""

import os
import sys

STEP = 2
# A surface at or under this is crushed: no usable form or material information left in it. 0.14 of full white
# is the same floor the world lane's night sweep uses, so the two lanes' "dark" mean the same thing.
DARK = 0.14 * 255.0
# At or over this a cell has lost its surface upward rather than downward: no form information left in it
# either. A luminous skin is allowed to be bright; it is not allowed to be a flat white cut-out.
BLOWN = 0.97 * 255.0
# At or over this a cell is one of the figure's own lights rather than its body.
LIGHT = 0.72 * 255.0

def read(path):
    """The PNG, as (width, height, channels, pixels). occupancy lives beside this module in Tools/."""
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from occupancy import read_png                                  # noqa: WPS433
    return read_png(path)


def figure_stats(path, box):
    """Body, light and ground readings inside a frame whose figure is known to be in `box`.

    box is (x0, y0, x1, y1) in fractions of the frame. Everything outside it is world, not figure.
    """
    w, h, chan, px = read(path)
    x0, y0, x1, y1 = (int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h))
    body = []
    lit = []
    lights = 0
    blown = 0
    inside = []
    seen = 0
    for y in range(y0, min(y1, h), STEP):
        row = y * w * chan
        for x in range(x0, min(x1, w), STEP):
            i = row + x * chan
            lum = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
            seen += 1
            inside.append(lum)
            if lum >= BLOWN:
                blown += 1
            if lum >= LIGHT:
                lights += 1
                lit.append(lum)
            else:
                body.append(lum)
    # ---- TWO GROUND BANDS, BECAUSE THE ONE UNDER THE FEET IS MOSTLY THE FIGURE'S OWN SHADOW.
    #
    # THIS JOB REPORTED "98 PER CENT OF THE GROUND UNDER RELAY OG IS CRUSHED" AND SENT THE WORLD LANE TO FIX
    # THE WORLD WITH IT. Their own sweep then read a broad plaza patch at the same district and the same hour
    # at 0.197 -- four times brighter than my 0.045. Same place, same hour, two answers, and the difference is
    # that their patch has nobody standing on it. A strip immediately below a lit figure at 5.2 m is largely
    # that figure's contact shadow, so this measured SHADOW DEPTH and called it world darkness.
    #
    # So: UNDER is the strip below the feet, which is shadow plus ground. BESIDE is the same strip shifted one
    # figure-width to the side, out of the shadow, which is ground. The difference between them is the shadow,
    # and that is a number neither lane has had: the founder asked for shadows that stay deep AND readable,
    # which cannot be judged from a reading that fuses the shadow with the surface it falls on.
    gy0, gy1 = min(y1, h - 1), min(int(y1 + (y1 - y0) * 0.16), h)
    figure_w = max(x1 - x0, 1)

    def band(bx0, bx1):
        vals = []
        for y in range(gy0, gy1, STEP):
            row = y * w * chan
            for x in range(max(bx0, 0), min(bx1, w), STEP):
                i = row + x * chan
                vals.append(0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2])
        return vals

    ground = band(x0, min(x1, w))
    # One full figure-width to the side, and whichever side has more frame to give.
    room_right = w - x1
    beside = band(x1 + int(figure_w * 0.15), x1 + int(figure_w * 1.15)) if room_right >= figure_w         else band(x0 - int(figure_w * 1.15), x0 - int(figure_w * 0.15))

    def frac_dark(vals):
        return round(sum(1 for v in vals if v < DARK) / float(max(len(vals), 1)), 4)

    def spread(vals):
        """STANDARD DEVIATION ACROSS THE WHOLE FIGURE, which is the only number here that measures FORM.

        A figure reads as a figure because its surfaces differ from one another: lit planes, turned-away
        planes, the line where one meets the next. Every other measure in this job is about LEVEL, and level
        cannot tell three cases apart that need three different answers -- a body crushed flat to black, a
        body blown flat to white, and a body standing in readable light. The first two are both formless and
        sit at opposite ends of every mean.

        This matters because two of the five skins are luminous BY DESIGN. Arden Infernal builds 45 per cent
        of its geometry from glow materials and Skeleton Flame 83 per cent, and Skeleton Flame being a
        luminous ghost is the skin's identity rather than a defect. Asking those two to be dimmer is a
        founder question. Asking them to still have a SHAPE is not, and this is the number that asks it.
        """
        if len(vals) < 2:
            return None
        mean = sum(vals) / float(len(vals))
        var = sum((v - mean) ** 2 for v in vals) / float(len(vals))
        return round((var ** 0.5) / 255.0, 4)

    def mean(vals):
        return round(sum(vals) / float(max(len(vals), 1)) / 255.0, 4)

    return {"body_mean": mean(body), "body_dark_fraction": frac_dark(body),
            # THE TWO FORMLESS FAILURES, MEASURED SEPARATELY FROM THE LEVEL.
            "blown_fraction": round(blown / float(max(seen, 1)), 4),
            "figure_form": spread(inside),
            # ---- AND THE FOUNDER'S SENTENCE AS A SINGLE NUMBER.
            #
            # "Glowing objects floating in blackness" is not a statement about how bright the eyes are or how
            # dark the world is. It is a statement about the RATIO, and neither half of this job measured it:
            # light_fraction counts how many cells are lights, body_mean averages the cells that are not, and
            # a figure can pass both while its eyes are twenty times the brightness of everything around them.
            #
            # The world lane found the case that proves it belongs here. At 18:15 the Dog's eye glow sits at
            # 21.1 of a 24 maximum -- nearly full daylight value -- while the world around it measures luma
            # 0.043 with ground at 0.0155. Every absolute reading in this job would call that figure DARK. The
            # ratio is what calls it a pair of lights in a void, and the ratio is the thing the founder saw.
            "light_mean": mean(lit),
            # ---- ENERGY, NOT A MEAN, AND THE FIRST VERSION OF THIS WAS DERIVED FROM THE WRONG QUANTITY.
            #
            # I built this ratio as light_mean over world, and derived its bound from the eye glow scale falling
            # 24 to 8 across the crossover: a factor of three, so the ratio should fall by about two. It came
            # back RISING, 2.36 at noon to 2.93 at night, and the clause failed the canonical mascot.
            #
            # light_mean CANNOT FALL BY THREE. It averages only cells already above 0.72 of full white, whose
            # luma is bounded at 1.0, so it sits near 0.91 whatever the emissive underneath is doing. The whole
            # 2.36-to-2.93 movement was the WORLD term: beside_mean 0.3749 at noon against 0.3143 at night, a
            # ratio of 1.19 against the measured 1.24. I had derived a bound for one quantity and applied it to
            # another that is clipped by construction.
            #
            # light_fraction is the half that responds -- Arden's went 0.7376 to 0.0618 at dusk when the glow
            # curve moved, a factor of twelve. So the figure's light OUTPUT is area times brightness, and that
            # is what a ratio against the world should divide.
            #
            # AND THE NOON LEG IS NOT PURELY THE FIGURE'S OWN LIGHTS, which makes the night-over-noon test
            # LENIENT rather than strict. At noon a sunlit white surface crosses 0.72 of full white on its own:
            # Relay OG has no glow geometry at all and still reads light_fraction 0.0330 at noon against 0.0249
            # at night. So the noon denominator is inflated by daylight, the ratio comes out smaller than the
            # truth, and a figure could pass while being somewhat more of a light source at night than this
            # says. Recorded rather than corrected: separating an eye from a sunlit flank needs the figure's
            # own materials, not a luma threshold, and a threshold swept to fix it would only move which
            # surfaces are miscounted. The direction of the error is the safe one to know about.
            "light_energy": (round(len(lit) / float(max(seen, 1)) * mean(lit), 4) if lit else 0.0),
            "eye_over_world": (round(len(lit) / float(max(seen, 1)) * mean(lit) / max(mean(beside), 1e-6), 3)
                               if lit and mean(beside) else None),
            "light_fraction": round(lights / float(max(seen, 1)), 4),
            "ground_mean": mean(ground), "ground_dark_fraction": frac_dark(ground),
            # THE SAME STRIP, OUT OF THE FIGURE'S SHADOW. This is the one that answers "does the world light
            # the ground"; the pair above answers "how deep is the mascot's shadow".
            "beside_mean": mean(beside), "beside_dark_fraction": frac_dark(beside),
            "shadow_depth": (round((mean(beside) - mean(ground)) / max(mean(beside), 1e-6), 4)
                             if mean(beside) else None),
            "cells": seen}

