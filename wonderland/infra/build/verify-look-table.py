#!/usr/bin/env python3
"""Prove the LOOK table's build-time override actually overrides.

The point of WONDERLAND_LOOK is that a GPU session can sweep several looks
per cook instead of edit-rebuild-look. That only holds if an override
genuinely reaches the render — and the failure mode is silent: a mistyped
key gets dropped, the cook proceeds, and the sweep reports a value it never
rendered. That is worse than having no sweep, so the parser refuses unknown
keys and this checks that it does.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")


def load(env):
    """Execute the file's header — the LOOK table and its parser — alone."""
    src = io.open(GEN, encoding="utf8").read()
    head = src[:src.index("\ndef build_niagara")]
    g = {"__name__": "probe", "__file__": GEN}
    os.environ.pop("WONDERLAND_LOOK", None)
    if env is not None:
        os.environ["WONDERLAND_LOOK"] = env
    try:
        exec(compile(head, GEN, "exec"), g)
        return g["LOOK"]
    finally:
        os.environ.pop("WONDERLAND_LOOK", None)


def main():
    fails = []

    src = io.open(GEN, encoding="utf8").read()
    base = load(None)
    for key in ("sunLux", "exposureBias", "gain", "saturation", "heroLights"):
        if key not in base:
            fails.append("LOOK is missing %s" % key)

    # scalars, tuples and a flag all round-trip
    got = load("sunLux=420,vignette=0.2,heroLights=0,gain=0.7/0.7/0.75")
    for key, want in (("sunLux", 420.0), ("vignette", 0.2),
                      ("heroLights", 0.0), ("gain", (0.7, 0.7, 0.75))):
        if got[key] != want:
            fails.append("override %s: wanted %r, got %r" % (key, want, got[key]))
    # and an untouched key keeps its default rather than being reset
    if got["saturation"] != base["saturation"]:
        fails.append("override clobbered an untouched key")

    # THE CHECK MUST BE ABLE TO FAIL. Each of these is a real mistake someone
    # will make at 2am on a rented GPU, and each must stop the cook.
    for bad, want in (("sunLuxx=1", KeyError),
                      ("gain=0.5", ValueError),
                      ("nonsense", ValueError),
                      ("sunLux=abc", ValueError)):
        try:
            load(bad)
            fails.append("bad override %r was ACCEPTED" % bad)
        except want:
            pass
        except Exception as e:
            fails.append("bad override %r raised %s, wanted %s"
                         % (bad, type(e).__name__, want.__name__))

    # every value carries provenance, so nobody "improves" a measured one
    table = src[src.index("LOOK = {"):src.index("def _look_overrides")]
    for tag in ("MEASURED", "PROVEN", "CHOSEN", "UNTESTED"):
        if tag not in table:
            fails.append("provenance tag %s absent from the LOOK table" % tag)

    # EVERY KEY MUST BE WIRED. Mutation-testing this harness found it happily
    # passing while a value had been hardcoded back into the render path: the
    # table still declared `vignette`, the parser still accepted an override
    # for it, and the cook still rendered 0.44. A sweep that silently ignores
    # one of its own knobs is the failure this whole table exists to prevent,
    # so the reference is checked, not assumed.
    body = src[src.index("def _look_overrides"):]
    for key in base:
        if ('LOOK["%s"]' % key) not in body:
            fails.append("LOOK key %r is declared but never read - an override "
                         "for it would silently do nothing" % key)

    if fails:
        for f in fails:
            print("FAIL %s" % f)
        return 1
    print("LOOK TABLE OK  %d keys, overrides apply, bad input refused" % len(base))
    return 0


if __name__ == "__main__":
    sys.exit(main())
