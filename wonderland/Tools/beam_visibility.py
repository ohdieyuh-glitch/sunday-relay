# "Reports visible" and "can be seen" are different assertions, and only the second is the one the founder
# judges. The joint proof asserts the first from the renderer's own state; this asserts the second from the
# PICTURE, by counting the beam's colour in the captured frames.
#
# CALIBRATED AGAINST A KNOWN FAILURE, which is the only way a new check earns trust: run against the film
# where the beam was a 10 uu thread seen end-on and genuinely could not be made out, it reports a small
# difference and fails. A check that has never been shown failing is not yet a check.
#
# AND AGAINST ITS OWN FALSE NEGATIVE. The first version of this file keyed on hue and would have rejected a
# correct beam, because at the exposure this world needs a cyan beam tonemaps to near-white. A check that
# can only fail in one direction is half a check.
#
# It is a heuristic and says so. The beam is a distinctive bright cyan, but Wonderland already contains
# cyan -- the Jhinn's crystalline body most of all -- so an absolute count means nothing. What means
# something is the DIFFERENCE between frames where the beam is lit and frames where it is not, taken close
# together so the camera and the companions have barely moved.
import json
import io
import os
import sys

from PIL import Image

# The proof job's result file, which carries the frame list and each frame's capture path.
RESULT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("WL_JOINT_RESULT", "")

# WHAT COUNTS AS BEAM, and why this is not a hue test any more.
#
# The first version keyed on cyan: blue high, green high, green clearly above red. That worked while the
# beam was dim, and would have FAILED A PERFECT ONE. At the x4000 exposure an unlit emissive needs in this
# world, a cyan beam tonemaps to near-white -- and white has green equal to red, so the hue test rejects it.
# The check would have reported "not visible" for the brightest possible beam.
#
# So it keys on BRIGHT AND COOL instead: very light, and not warmer than it is cool. That accepts the beam
# anywhere from dim cyan to blown-out white, and still rejects the garden, which is warm stone, pink
# blossom and green foliage. Sky is the one cool bright thing it can catch, which is why the count is only
# ever used as a DIFFERENCE between frames taken seconds apart, where the sky contributes equally to both.
def beam_pixels(path, step=2):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    count = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            if b >= 205 and g >= 195 and b >= r - 6 and (r + g + b) >= 620:
                count += 1
    return count * step * step


def main():
    if not RESULT or not os.path.isfile(RESULT):
        print("usage: beam_visibility.py <zc_joint_proof.json>")
        return 1
    with io.open(RESULT, encoding="utf-8") as fh:
        data = json.load(fh)
    frames = [f for f in data.get("frames", []) if f.get("capture") and os.path.isfile(f["capture"])]
    if not frames:
        print("no captures to look at")
        return 1

    lit = [f for f in frames if f.get("beam_on")]
    dark = [f for f in frames if not f.get("beam_on")]
    if not lit:
        print("the beam was never lit in any captured frame")
        return 1

    # Compare against the frames either side of the beam, not against the whole mission: the camera is in
    # roughly the same place there, so the difference is the beam rather than the scenery.
    first, last = lit[0]["i"], lit[-1]["i"]
    near = [f for f in dark if abs(f["i"] - first) <= 12 or abs(f["i"] - last) <= 12]
    if not near:
        near = dark

    lit_counts = [beam_pixels(f["capture"]) for f in lit]
    near_counts = [beam_pixels(f["capture"]) for f in near]
    lit_mean = sum(lit_counts) / len(lit_counts)
    near_mean = sum(near_counts) / len(near_counts)
    delta = lit_mean - near_mean

    print("beam-coloured pixels")
    print("  while lit    : %8.0f   (%d frames)" % (lit_mean, len(lit)))
    print("  either side  : %8.0f   (%d frames)" % (near_mean, len(near)))
    print("  difference   : %8.0f" % delta)
    print()
    # A beam 34 uu across its bright core, seen at a few metres, is a few thousand pixels. Under a thousand
    # means it is technically on screen and practically not there -- which is exactly the failure the last
    # run passed.
    # HOW MUCH TO TRUST THIS. The counts include sky and pale stone, so the difference is a small signal on
    # a large baseline; below about a third of the baseline it is worth no more than a hint, and the frames
    # decide. Printed rather than hidden, because a verdict without its signal-to-noise invites exactly the
    # over-reading this file already caused once.
    share = (delta / near_mean) if near_mean else 0.0
    verdict = "VISIBLE" if delta >= 1000 else "NOT VISIBLE ENOUGH"
    print("verdict: %s (threshold 1000 px, delta is %.0f%% of the baseline)" % (verdict, 100.0 * share))
    if delta >= 1000 and share < 0.33:
        print("         WEAK SIGNAL -- look at the frames before believing this")
    return 0 if delta >= 1000 else 2


if __name__ == "__main__":
    sys.exit(main())
