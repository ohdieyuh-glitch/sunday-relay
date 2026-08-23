#!/usr/bin/env python3
"""No practical may be bright enough to become the key light.

WHY THIS EXISTS. Wonderland's arrival frame read as "one tan material" for
several sessions. The cause was not the materials, the textures, the tints, the
grade, the exposure or the sun -- each of those was measured and ruled out, two
of them by a rendered frame. It was the lantern practicals: 14,000 lumens each,
GOLD, CastShadows FALSE, over an 1,100 uu radius, roughly eighteen of them.
About a quarter of a million lumens of gold light in a garden whose sun is 340
lux, passing through every wall and canopy on the way.

It showed up in the frame as every material's BRIGHTEST pixels converging on
one hue regardless of the material's own colour -- porcelain (244,242,237)
rendering a top decile of (213,176,69) -- and nothing about the material or the
grade could explain that, because nothing about the material or the grade was
responsible.

A practical lights its own surroundings. The moment one is bright enough to
light the SCENE, it is the key light, and every colour decision in the world is
made by whatever colour that lamp happens to be.

So this gate reads every light the generator creates, offline, and fails on a
point or spot light above PRACTICAL_CEILING lumens. It has nothing to say about
the directional key and sky -- those are supposed to light the scene.

For scale: a domestic bulb is ~800-1,600 lumens; a bright shop fitting ~5,000.
The ceiling is set at one shop fitting, which is generous for a lantern on a
post and far below the value that caused the problem.
"""
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
PRACTICAL_CEILING = 6000.0


def main():
    spec = importlib.util.spec_from_file_location(
        "wl_dryrun_lb", os.path.join(HERE, "verify-generator-dryrun.py"))
    dry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dry)
    stub = dry.make_unreal()

    seen = []
    Any = dry.Any
    real_call = Any.__call__

    def spy(self, *a, **kw):
        nm = getattr(self, "_name", "")
        if nm.endswith("set_intensity") and a:
            try:
                seen.append((nm, float(a[0])))
            except (TypeError, ValueError):
                pass
        return real_call(self, *a, **kw)

    Any.__call__ = spy
    sys.modules["unreal"] = stub
    ns = {"__name__": "__wl_lightbudget__", "__file__": GEN}
    try:
        exec(compile(io.open(GEN, encoding="utf8").read(), GEN, "exec"), ns)
    finally:
        Any.__call__ = real_call

    # Point/spot components reach set_intensity through a name containing the
    # component they were fetched from. Directional and sky are exempt by name.
    KEYWORDS = ("PointLight", "SpotLight", "RectLight")
    EXEMPT = ("Directional", "SkyLight", "SkyAtmosphere")
    practicals = [(n, v) for n, v in seen
                  if any(k in n for k in KEYWORDS) and not any(e in n for e in EXEMPT)]

    print("light intensity calls captured : %d" % len(seen))
    print("identified as practicals       : %d" % len(practicals))
    if practicals:
        worst = max(v for _, v in practicals)
        print("brightest practical            : %.0f lumens (ceiling %.0f)"
              % (worst, PRACTICAL_CEILING))
    over = [(n, v) for n, v in practicals if v > PRACTICAL_CEILING]
    print()
    if over:
        print("FAIL: %d practical(s) above %.0f lumens -- bright enough to light "
              "the SCENE, which makes them the key light" % (len(over), PRACTICAL_CEILING))
        for n, v in sorted(over, key=lambda t: -t[1])[:8]:
            print("  %-52s %.0f" % (n[-52:], v))
        return 1
    if not practicals:
        # Not a pass. A gate that finds nothing to check has not checked
        # anything, and this one has been fooled by a stub before.
        print("FAIL: no practical lights were seen at all. Either the world has "
              "none (it should have lanterns) or this harness no longer observes "
              "them -- and a gate that checks nothing must not report a pass.")
        return 1
    print("PASS: every practical is at or below %.0f lumens" % PRACTICAL_CEILING)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
