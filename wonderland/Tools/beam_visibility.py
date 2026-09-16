# "Reports visible" and "can be seen" are different assertions, and only the second is the one the founder
# judges. The joint proof asserts the first from the renderer's own state; this asserts the second from the
# PICTURE, by counting the beam's colour in the captured frames.
#
# CALIBRATED AGAINST A KNOWN FAILURE, which is the only way a new check earns trust: run against the film
# where the beam was a 10 uu thread seen end-on and genuinely could not be made out, it reports a
# difference of 196 px and fails. A check that has never been shown failing is not yet a check.
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

# The author sets the beam's colour to linear (0.42, 0.86, 1.0). After tonemapping that lands as a bright
# cyan with blue at or near white; the test is deliberately loose on exact values and tight on the RELATION
# between channels, which is what survives exposure.
def beam_pixels(path, step=2):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    px = im.load()
    count = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            r, g, b = px[x, y]
            if b > 200 and g > 175 and b >= g and g - r > 38:
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
    verdict = "VISIBLE" if delta >= 1000 else "NOT VISIBLE ENOUGH"
    print("verdict: %s (threshold 1000 px)" % verdict)
    return 0 if delta >= 1000 else 2


if __name__ == "__main__":
    sys.exit(main())
