#!/usr/bin/env python3
"""The sky fill must not be the thing that decides what colour a shadow is.

WHY THIS EXISTS. The SkyLight is the only OMNIDIRECTIONAL light in Wonderland.
The sun reaches nothing in shadow by definition, and the ground bounce is a
directional pointing up, so it fills down-facing surfaces and nothing else.
That leaves the SkyLight as the entire light budget of every shadowed surface
in the world -- and it captures the scene, so its colour is the colour of the
sky, which is blue.

Measured on a delivered frame, that produced a world whose shadows were blue
whatever they were made of:

    petal_pink   albedo (0.94, 0.40, 0.66)   shadowed rgb( 29,  30,  45)
    foliage      albedo (0.23, 0.46, 0.22)   shadowed rgb( 32,  28,  41)
    mush_red     albedo (0.74, 0.16, 0.26)   shadowed rgb( 63,  61,  70)

which is the same defect as the 14,000-lumen gold lanterns, in the opposite
colour: ONE dominant coloured light deciding the hue of most of the frame.

So LOOK["skyWarm"] tints the SkyLight back to near-neutral. This gate exists
because that call is exactly the kind that silently does nothing here -- this
same file has already lost the fog tint to a UE5 rename (FogInscatteringColor
-> *Luminance) and every practical's colour to an FColor/FLinearColor
TypeError. Both looked fine in the source and did nothing in the build.

It therefore asserts the call is REACHED and the colour it carries is near
neutral, and it fails if it never observes a SkyLight at all.
"""
import importlib.util
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
# A fill this far off neutral starts choosing hues for surfaces the sun misses.
# Measured on the LINEAR colour the light actually receives (srgb_light_color
# converts on the way in), so 0.18 is about sRGB (255, 243, 233): a fill may be
# a little warmer than the key, and may not be made of a colour.
MAX_CHANNEL_SPREAD = 0.18


def main():
    spec = importlib.util.spec_from_file_location(
        "wl_dryrun_sky", os.path.join(HERE, "verify-generator-dryrun.py"))
    dry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dry)
    stub = dry.make_unreal()

    Any = dry.Any
    real_call = Any.__call__
    colors, intensities, spawned = [], [], []

    def spy(self, *a, **kw):
        nm = getattr(self, "_name", "")
        if "SkyLight" in nm and nm.endswith("set_light_color") and a:
            colors.append(a[0])
        if "SkyLight" in nm and nm.endswith("set_intensity") and a:
            try:
                intensities.append(float(a[0]))
            except (TypeError, ValueError):
                pass
        return real_call(self, *a, **kw)

    Any.__call__ = spy

    # The stub makes a LinearColor with a plain lambda that discards its
    # arguments, so the colour arrives at set_light_color carrying nothing to
    # read. Wrap it here -- in the gate, not in the stub -- and keep the numbers
    # ON the object handed along, in __dict__ because Any.__getattr__ answers
    # every name and would otherwise hide them.
    _real_lc = stub.LinearColor

    def _lc(*a, **kw):
        out = _real_lc(*a, **kw)
        vals = []
        for v in a:
            try:
                vals.append(float(v))
            except (TypeError, ValueError):
                vals = []
                break
        if len(vals) >= 3:
            try:
                out.__dict__["_wl_rgb"] = vals[:3]
            except (AttributeError, TypeError):
                pass
        return out

    stub.LinearColor = _lc

    # Same reason as verify-light-budget.py: without tagging the spawn, every
    # component call arrives under one anonymous name and "is this the sky?"
    # cannot be answered.
    real_sub = stub.get_editor_subsystem

    class _Tagging(object):
        def __init__(self, inner):
            self._inner = inner

        def spawn_actor_from_class(self, cls, *a, **kw):
            nm = str(getattr(cls, "_name", cls))
            spawned.append(nm)
            return Any(nm)

        def __getattr__(self, k):
            return getattr(self._inner, k)

    stub.get_editor_subsystem = lambda c: _Tagging(real_sub(c))
    sys.modules["unreal"] = stub
    ns = {"__name__": "__wl_skyfill__", "__file__": GEN}
    try:
        exec(compile(io.open(GEN, encoding="utf8").read(), GEN, "exec"), ns)
    finally:
        Any.__call__ = real_call

    saw_sky = any("SkyLight" in s for s in spawned)
    print("SkyLight actors spawned      : %d" % sum(1 for s in spawned if "SkyLight" in s))
    print("set_intensity calls on it    : %s"
          % (", ".join("%.2f" % v for v in intensities) or "none"))
    print("set_light_color calls on it  : %d" % len(colors))
    print()

    if not saw_sky:
        print("FAIL: no SkyLight was spawned at all. Either the world lost its "
              "ambient or this harness no longer observes it -- and a gate that "
              "checks nothing must not report a pass.")
        return 1
    if not colors:
        print("FAIL: the SkyLight's colour is never set, so the fill is whatever "
              "colour the captured dome happens to be. In this world that is "
              "blue, and it lands on every surface the sun does not reach.")
        return 1

    bad = []
    for c in colors:
        # srgb_light_color returns a LinearColor-ish object; read what we can.
        rgb = c.__dict__.get("_wl_rgb") if hasattr(c, "__dict__") else None
        if not rgb:
            rgb = []
            for ch in ("r", "g", "b"):
                v = getattr(c, ch, None)
                try:
                    rgb.append(float(v))
                except (TypeError, ValueError):
                    rgb = []
                    break
        if len(rgb) != 3:
            print("FAIL: the sky colour was set to something this gate cannot "
                  "read (%r). It cannot certify a value it cannot see." % (c,))
            return 1
        spread = max(rgb) - min(rgb)
        print("sky fill colour              : (%.3f, %.3f, %.3f)  spread %.3f"
              % (rgb[0], rgb[1], rgb[2], spread))
        if spread > MAX_CHANNEL_SPREAD:
            bad.append((rgb, spread))

    print()
    if bad:
        print("FAIL: the sky fill is %.3f off neutral (ceiling %.3f). It is the "
              "only omnidirectional light here, so a fill this coloured decides "
              "the hue of every shadowed surface in Wonderland."
              % (max(s for _, s in bad), MAX_CHANNEL_SPREAD))
        return 1
    print("PASS: the sky fill is near neutral, so a shadow keeps the colour of "
          "whatever is standing in it.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
