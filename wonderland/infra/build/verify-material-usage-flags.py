#!/usr/bin/env python3
"""A material drawn on instances must DECLARE that usage, or the engine swaps it out.

THE BUG. Wonderland rendered grey for days. The cause was one unset flag:

    LogMaterial: Warning: Material MI_gold missing usage flag
    InstancedStaticMeshes! Default Material will be used in game.

UE requires a material to declare every usage domain it will be drawn in. A
material applied to an instanced-static-mesh component without
bUsedWithInstancedStaticMeshes does NOT fail to bind and does NOT error. The
engine silently substitutes the DEFAULT MATERIAL -- the grey checker -- at draw
time. 38 materials, the whole visible world, were being replaced this way.

WHY EVERY OTHER CHECK PASSED. Because every other check was true:

    SetMaterial/GetMaterial agreed on 150 of 150 batches
    zero mismatches, zero NULL slots
    the bound objects reported vivid BaseColor at runtime
    all 59 instances were written albedo at saturation 0.49-1.00

The binding was correct. The engine refused to USE what was correctly bound,
and nothing in the binding can see that.

It also hides in the editor, which adds missing usage flags on demand and saves
them. A COOKED build cannot compile a new usage variant at runtime, so the
fallback appears ONLY in the packaged game -- the one place no offline
validator was looking, and the only place the founder ever sees.

WHAT THIS CHECKS

Two things, because one alone is not enough:

  1. OFFLINE -- every master material this generator creates declares the flag,
     on the freshly-created path AND on the cached path. A master rebuilt with
     the flag and a master loaded without it render differently and look
     identical in the source.

  2. AGAINST A REAL RUN -- given a packaged-build log, that the engine emitted
     no "missing usage flag" warning at all. That is the only evidence that
     actually proves it, because it comes from the renderer.

    python3 verify-material-usage-flags.py [runtime-log ...]
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")

# Every master this generator builds. A new one must be added here, and the
# check below fails if the generator creates a master this list does not name.
# M_WLRunes added 2026-08-25. THIS GATE ALREADY CAUGHT IT AND NOBODY RAN IT.
# The arcane circle drew as engine grey for a whole sprint -- three passes went
# into its brightness, its texture and its Z before the packaged log gave it
# away -- and this validator was failing the entire time with exactly the right
# message: "the generator creates master material(s) this validator does not
# know about: M_WLRunes". It is not in prepare.sh's gate list, so it was never
# run. A gate that is right and unrun is worth nothing, and that is the lesson
# rather than the material.
MASTERS = ("M_WLMaster", "M_WLLeaf", "M_WLRunes")


def check_source():
    src = io.open(GEN, encoding="utf8").read()

    created = set(re.findall(r'create_asset\(\s*"(M_WL[A-Za-z_]+)"', src))
    unknown = sorted(created - set(MASTERS))
    if unknown:
        print("FAIL: the generator creates master material(s) this validator "
              "does not know about: %s" % ", ".join(unknown))
        print("      Add them to MASTERS, and make sure they declare the "
              "instanced-static-mesh usage flag.")
        return 1

    if "def wl_allow_instanced_use" not in src:
        print("FAIL: wl_allow_instanced_use is gone. Nothing declares the "
              "instanced usage flag, so every instanced material in the "
              "packaged build will draw as the engine's grey default.")
        return 1

    calls = re.findall(r'wl_allow_instanced_use\(\s*\w+\s*,\s*"([^"]+)"', src)

    # A MASTER THAT DELETES ITSELF FIRST HAS NO CACHED PATH, and demanding one
    # makes this gate fail on correct code. M_WLRunes does
    # `if does_asset_exist(path): delete_asset(path)` and then creates -- there
    # is exactly one path through it, so exactly one call is required.
    #
    # This matters more than it looks. This validator was ALREADY failing,
    # correctly, on M_WLRunes being unknown to it, and was not in prepare.sh's
    # list, so nobody ran it while the arcane circle drew as engine grey for a
    # whole sprint. A gate that cries wolf on correct code is a gate that gets
    # dropped from the list, and that is how the last one was lost.
    def _recreates(name):
        m = re.search(r'path\s*=\s*pkg\s*\+\s*"/%s"(.{0,400})' % re.escape(name),
                      src, re.S)
        return bool(m) and "delete_asset(path)" in m.group(1)

    missing = []
    for m in MASTERS:
        named = [c for c in calls if c.startswith(m)]
        if not any(c == m for c in named):
            missing.append("%s (created path)" % m)
        if _recreates(m):
            continue           # deletes any existing asset; no cached path exists
        if not any("cached" in c for c in named):
            missing.append("%s (cached path)" % m)
    if missing:
        print("FAIL: these master materials do not declare the "
              "instanced-static-mesh usage flag:")
        for x in missing:
            print("   %s" % x)
        print()
        print("      Without it the engine draws the DEFAULT GREY MATERIAL in a")
        print("      cooked build while every binding check still passes.")
        return 1

    print("source : both masters declare the flag on the created and cached paths")
    return 0


def check_runtime(paths):
    """The only proof that counts: the renderer did not complain."""
    pat = re.compile(rb"missing usage flag ([A-Za-z]+)")
    total = 0
    seen_any_log = False
    for p in paths:
        if not os.path.isfile(p):
            print("FAIL: %s does not exist, so no runtime evidence was read -- "
                  "and a check that read nothing must not pass." % p)
            return 1
        blob = io.open(p, "rb").read()
        seen_any_log = True
        hits = pat.findall(blob)
        # A log with no engine lines at all proves nothing; require it to look
        # like a real run before believing its silence.
        if b"LogInit" not in blob and b"LogMaterial" not in blob:
            print("FAIL: %s carries no engine log lines, so its silence about "
                  "usage flags is not evidence." % os.path.basename(p))
            return 1
        if hits:
            kinds = sorted({h.decode() for h in hits})
            print("FAIL: %s reports %d material(s) missing usage flags (%s)."
                  % (os.path.basename(p), len(hits), ", ".join(kinds)))
            print("      Those materials are being replaced by the engine's "
                  "default grey wherever they are drawn.")
            total += len(hits)
        else:
            print("runtime: %s -- no material was defaulted for a usage flag"
                  % os.path.basename(p))
    if total:
        return 1
    if not seen_any_log:
        print("FAIL: no runtime log was checked.")
        return 1
    return 0


def main():
    rc = check_source()
    logs = sys.argv[1:]
    if logs:
        rc |= check_runtime(logs)
    else:
        print("runtime: not checked (pass a packaged-build log to prove it)")
    print()
    print("PASS" if rc == 0 else "FAIL")
    return rc


if __name__ == "__main__":
    raise SystemExit(main())
