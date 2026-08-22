#!/usr/bin/env python3
"""The Relay Dog that spawns is the quadruped CLASSIC / RELAY OG form.

FOUNDER DECISION, 2026-08-22: the canonical Relay Dog at world spawn is the
QUADRUPED classic form — the clearest canonical Relay identity and the one that
preserves the established mascot design. The bipedal hero render may exist as a
variant, an advanced form, a pose or a later presentation. It is not the default
spawn.

WHY A GATE AND NOT A NOTE. The body is built in C++ from a table of parts, and a
leg is four lines in an array. Removing two of them turns the canonical spawn
form into something else with no compiler error, no test failure, and no visible
signal until somebody looks at a frame — which in this project has repeatedly
meant a metered GPU session. A decision that cannot be checked is a decision
that gets undone by accident.

It asserts the SHAPE, not the pixels: four legs, at mirrored offsets, below a
body, with a head forward of it. What the Dog looks like is the founder's call;
that it has four legs is now the build's.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
WL = os.path.dirname(os.path.dirname(HERE))
BODY = os.path.join(WL, "Source", "Wonderland", "WonderlandDogBody.cpp")


def fail(msg):
    sys.stderr.write("verify-canonical-dog: %s\n" % msg)
    sys.exit(1)


def main():
    if not os.path.exists(BODY):
        fail("no %s — the Relay Dog's body is not defined anywhere this can check."
             % BODY)
    source = io.open(BODY, encoding="utf8").read()
    code = "\n".join(l for l in source.splitlines()
                     if not l.lstrip().startswith("//"))

    # Legs are the parts whose Z is half the leg height: FVector(x, y, LegH * 0.5f)
    legs = re.findall(
        r"FVector\(\s*(-?[\d.]+f?)\s*\*\s*S,\s*(-?[\d.]+f?)\s*\*\s*S,\s*LegH\s*\*\s*0\.5f\s*\)",
        code)
    if len(legs) != 4:
        fail("found %d leg part(s), not 4. The canonical spawn Relay Dog is the "
             "QUADRUPED classic form; a two-legged spawn is the bipedal hero "
             "variant, which the founder ruled is NOT the default. Legs found: %s"
             % (len(legs), legs))

    def f(v):
        return float(v.rstrip("f"))

    xs = sorted({round(f(x), 3) for x, _y in legs})
    ys = sorted({round(f(y), 3) for _x, y in legs})
    if len(xs) != 2 or len(ys) != 2:
        fail("the four legs do not sit at two X offsets and two Y offsets "
             "(x=%s y=%s). A quadruped stands on a rectangle." % (xs, ys))
    if abs(xs[0] + xs[1]) > 1e-6 or abs(ys[0] + ys[1]) > 1e-6:
        fail("the leg offsets are not mirrored about the body (x=%s y=%s). "
             "An asymmetric stance is not the classic form." % (xs, ys))

    # A body above the legs, and a head forward of it, or it is a table.
    if "LegH + 34.0f * S" not in code:
        fail("no body sitting above the legs — the classic form is a body ON four "
             "legs, not four legs alone.")
    if not re.search(r"HeadX\s*=\s*[\d.]+f\s*\*\s*S", code):
        fail("no head offset forward of the body. The canonical Relay Dog silhouette "
             "is a body, four legs and a head with the visor.")

    print("verify-canonical-dog: ok — quadruped CLASSIC form: 4 legs at x=%s y=%s, "
          "mirrored, body above them, head forward. This is the canonical spawn." 
          % (xs, ys))
    return 0


if __name__ == "__main__":
    sys.exit(main())
