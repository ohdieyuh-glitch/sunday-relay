#!/usr/bin/env python3
"""The Nanite conversion must actually RUN, not merely fail safely.

WHY THIS EXISTS

wl_naniteise_primitives() is wrapped in a try/except that keeps the engine
primitives when conversion fails, because a missing mesh deletes geometry from
the world and a slow Wonderland beats an empty one. That fallback is correct.

It is also SILENT, and it hid a plain scope bug -- the call site passed `eal`
and `tools`, which are locals of other functions and not in scope in build().
The generator logged one warning, the offline dry-run PASSED because the
exception was caught, and the mistake was only visible after a ten-minute
package and a stream measurement that had not moved.

A fallback that makes a bug survivable must never also make it invisible. So
this asserts the conversion actually produced meshes, against the generator
walked with the offline stub -- on a laptop, in seconds.

    python3 verify-nanite-conversion.py
    WONDERLAND_NANITE=0 python3 verify-nanite-conversion.py   # must report OFF
"""
import importlib.util
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")


def main():
    spec = importlib.util.spec_from_file_location(
        "wl_dry_nanite", os.path.join(HERE, "verify-generator-dryrun.py"))
    dry = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(dry)
    sys.modules["unreal"] = dry.make_unreal()

    src = io.open(GEN, encoding="utf8").read()
    marker = "            _NANITE_MESH = wl_naniteise_primitives()"
    if marker not in src:
        print("FAIL: the Nanite call site is gone or has changed shape. This "
              "validator has drifted from the code it checks, and a check that "
              "cannot find its subject must not pass.")
        return 1
    src = src.replace(
        marker,
        marker + "\n            _WL_NAN['converted'] = dict(_NANITE_MESH)", 1)

    # Record the fallback too, so "it failed safe" is visible rather than quiet.
    fb = '            unreal.log_warning("NANITE: conversion step failed (%s); the world "'
    if fb in src:
        src = src.replace(fb, "            _WL_NAN['error'] = str(_nse)\n" + fb, 1)

    ns = {"__name__": "__wl_nanite__", "__file__": GEN, "_WL_NAN": {}}
    exec(compile(src, GEN, "exec"), ns)
    got = ns["_WL_NAN"]

    # READ THE DEFAULT FROM THE CODE, never assume it. This validator asserted
    # a default of "1" and started failing the moment the default was flipped
    # to "0" on measurement -- a check that encodes a policy it does not own
    # will fail honest changes and get switched off.
    m = re.search(r'os\.environ\.get\(\s*"WONDERLAND_NANITE"\s*,\s*"([01])"\s*\)', src)
    if not m:
        print("FAIL: cannot find the WONDERLAND_NANITE default in the generator; "
              "this validator has drifted from the code it checks.")
        return 1
    default_on = m.group(1) != "0"
    off = os.environ.get("WONDERLAND_NANITE", m.group(1)) == "0"
    conv = got.get("converted")
    err = got.get("error")

    if off:
        if conv:
            print("FAIL: Nanite is OFF but the conversion still ran.")
            return 1
        print("PASS: Nanite is OFF (default %s) — conversion correctly skipped."
              % ("on" if default_on else "off"))
        print("      MEASURED: Nanite halves the frame rate in this world "
              "(5/7/8 fps against 14/15/10) for an identical frame. It is built "
              "for high-poly meshes; this world is 137,816 primitives of 12-1,900 "
              "triangles. WONDERLAND_NANITE=1 re-enables it.")
        return 0

    if err:
        print("FAIL: the Nanite conversion raised and fell back to the engine "
              "primitives:")
        print("   %s" % err)
        print()
        print("      The world still renders, which is the point of the "
              "fallback -- but it is geometry-bound and this was the fix.")
        return 1
    if conv is None:
        print("FAIL: the conversion never ran at all.")
        return 1
    if not conv:
        print("FAIL: the conversion ran and produced NOTHING. Every primitive "
              "kept its engine mesh, so the ~100M triangles a frame are "
              "unchanged.")
        return 1

    print("primitives converted : %d" % len(conv))
    for k in sorted(conv):
        print("   %-12s -> %s" % (k, conv[k]))
    print()
    print("PASS: the Nanite conversion runs and produces meshes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
