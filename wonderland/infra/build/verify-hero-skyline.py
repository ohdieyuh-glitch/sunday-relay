#!/usr/bin/env python3
"""Assert that a hero camera can actually SEE what the backdrop was bought for.

A camera can be aimed perfectly at its subject and still throw away the whole
environment behind it, and nothing in the build notices: the level generates,
the shell imports at the right size and the right way up, the cook is clean,
the stream runs. The only symptom is a frame with no castle city in it, and the
cheapest place to see that is a person on metered GPU time.

The measurement that found it (wonderland/marble/preview-offline.py, offline,
no GPU): HeroCam0 is pitched -11.6 degrees to hold the hero Dog on its arcane
circle, so its frame spans elevation -30.2 .. +7.1. The Marble castle city sits
around +21 degrees, because the reference image was cropped ABOVE the dog band
to stop Marble generating Relay Dogs -- which also removed the ground, so the
surviving content reconstructed high above the viewpoint. 0.9% of that skyline
reaches HeroCam0's frame. No yaw fixes it. The limit is elevation.

So this asserts the geometry, from the generator's own hero-shot table and the
Marble manifest, with no engine:

  - a wide arrival camera exists
  - it sits at EXACTLY the backdrop's anchor point, so the shell's scale stays
    free from it, the way it is free from HeroCam0
  - its frame still holds the hero Dog, or it has traded away the subject
  - its frame reaches materially higher than HeroCam0's, or it has bought
    nothing

It does NOT claim the skyline looks good. That needs eyes on a streamed frame.
"""
import ast
import io
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WL = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)

# One parser of the generator's camera literal, shared with the browser
# inspector's placement contract. Two would be two chances to disagree about
# what the world contains.
from hero_shots import hero_shots  # noqa: E402

GENERATOR = os.path.join(HERE, "generate-hub-level.py")
MANIFEST = os.path.join(WL, "marble", "worlds", "royal-garden-backdrop", "manifest.json")

WIDE = 6
ARRIVAL = 0
# Measured from the shell itself, not chosen: the median elevation of its far,
# above-horizon, non-sky geometry seen from the anchor point.
SKYLINE_ELEVATION_DEG = 21.3
ASPECT = 9.0 / 16.0


def fail(msg):
    sys.stderr.write("verify-hero-skyline: %s\n" % msg)
    sys.exit(1)


def frame(pos, look, fov_deg):
    """-> (pitch, bottom, top) in degrees. Unreal FOV is HORIZONTAL."""
    dx, dy, dz = (look[i] - pos[i] for i in range(3))
    flat = math.hypot(dx, dy)
    pitch = math.degrees(math.atan2(dz, flat)) if flat else (90.0 if dz > 0 else -90.0)
    half_v = math.degrees(math.atan(math.tan(math.radians(fov_deg) * 0.5) * ASPECT))
    return pitch, pitch - half_v, pitch + half_v


def elevation_of(pos, point):
    dx, dy, dz = (point[i] - pos[i] for i in range(3))
    flat = math.hypot(dx, dy)
    return math.degrees(math.atan2(dz, flat)) if flat else 90.0


def main():
    shots = hero_shots()
    for index in (ARRIVAL, WIDE):
        if index not in shots:
            fail("HeroCam%d is missing from the generator's hero_shots table. The "
                 "wide arrival is the only shot that holds both the hero Dog and "
                 "the Marble skyline; without it the backdrop is bought and not "
                 "seen." % index)

    a_pos, a_look, a_fov = shots[ARRIVAL]
    w_pos, w_look, w_fov = shots[WIDE]

    if tuple(w_pos) != tuple(a_pos):
        fail("HeroCam%d is at %s but HeroCam%d is at %s. They must share a POINT: "
             "the Marble shell is anchored at the arrival camera, which is what "
             "makes its 6x backdrop scale free from there. Move the aim, never "
             "the position." % (WIDE, list(w_pos), ARRIVAL, list(a_pos)))

    if os.path.exists(MANIFEST):
        manifest = json.load(io.open(MANIFEST, encoding="utf8"))
        origin = (manifest.get("transform") or {}).get("unreal_origin_cm")
        if origin and [float(v) for v in origin] != [float(v) for v in a_pos]:
            fail("the Marble backdrop is anchored at %s but the arrival camera is "
                 "at %s. Every ray from the anchor is unchanged by the shell's "
                 "scale; from anywhere else it is not."
                 % (list(origin), list(a_pos)))

    a_pitch, a_bottom, a_top = frame(a_pos, a_look, a_fov)
    w_pitch, w_bottom, w_top = frame(w_pos, w_look, w_fov)
    subject = elevation_of(a_pos, a_look)

    if not (w_bottom <= subject <= w_top):
        fail("HeroCam%d's frame spans elevation %+.1f..%+.1f and the hero Dog sits "
             "at %+.1f. A wide arrival that drops the subject has traded the thing "
             "the world is about for scenery."
             % (WIDE, w_bottom, w_top, subject))

    if w_top <= a_top + 5.0:
        fail("HeroCam%d reaches %+.1f degrees and HeroCam%d reaches %+.1f. The "
             "Marble skyline sits around %+.1f, so a wide arrival that does not "
             "reach materially higher has bought nothing."
             % (WIDE, w_top, ARRIVAL, a_top, SKYLINE_ELEVATION_DEG))

    if a_top >= SKYLINE_ELEVATION_DEG:
        sys.stderr.write(
            "verify-hero-skyline: NOTE — HeroCam%d now reaches %+.1f degrees, at or "
            "above the skyline at %+.1f. If the arrival camera was re-aimed, this "
            "gate's premise has changed and the wide camera may be redundant.\n"
            % (ARRIVAL, a_top, SKYLINE_ELEVATION_DEG))

    print("verify-hero-skyline: ok — HeroCam%d %+.1f..%+.1f deg (fov %.0f) holds the "
          "Dog at %+.1f; HeroCam%d %+.1f..%+.1f deg (fov %.0f) also reaches the "
          "skyline at %+.1f, sharing the backdrop anchor at %s."
          % (ARRIVAL, a_bottom, a_top, a_fov, subject,
             WIDE, w_bottom, w_top, w_fov, SKYLINE_ELEVATION_DEG, list(a_pos)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
