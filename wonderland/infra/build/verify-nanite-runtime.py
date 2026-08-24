#!/usr/bin/env python3
"""Nanite that is not RUNNING is Nanite that is not helping.

WHY THIS EXISTS

Five primitive meshes were converted to Nanite and the frame rate did not move:
14/13/11 against 14/15/10. Nothing errored, the conversion reported success,
and every offline gate was green.

The runtime log said why: SF_VULKAN_SM5. NANITE REQUIRES SM6. A Nanite mesh on
a platform without SM6 silently renders its FALLBACK mesh at the full triangle
count -- so the world kept submitting ~100 million triangles a frame and the
optimisation was inert.

This is the THIRD time in one session that the same shape of defect has cost a
build. The material usage flag: bound correctly, silently replaced by engine
grey at draw time. A docker knob absent from the forwarding list: set correctly,
never delivered, indistinguishable from having no effect. And now Nanite
without SM6. In every case the authored side is correct and verifiable, and the
ENGINE quietly declines to use it.

The lesson those three share is the rule this file encodes: when an
optimisation or a material can be silently declined at runtime, the only
evidence that counts comes from the RUNTIME, and a check that reads only the
source is checking the wrong side of the seam.

WHAT IT CHECKS

  1. OFFLINE -- the project targets SM6, so the cook produces the shaders
     Nanite needs.
  2. AGAINST A REAL RUN -- the packaged log actually reports an SM6 platform.
     A log that shows SM5 FAILS even though the config is right, because the
     config being right is exactly what was true when this cost a build.

    python3 verify-nanite-runtime.py [runtime-log ...]
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
INI = os.path.abspath(os.path.join(HERE, "..", "..", "Config", "DefaultEngine.ini"))


def nanite_default_on():
    """Whether the generator turns Nanite on by default. Read, never assumed."""
    gen = os.path.join(HERE, "generate-hub-level.py")
    if not os.path.isfile(gen):
        return None
    src = io.open(gen, encoding="utf8").read()
    m = re.search(r'os\.environ\.get\(\s*"WONDERLAND_NANITE"\s*,\s*"([01])"\s*\)', src)
    return None if not m else (m.group(1) != "0")


def check_source():
    if not os.path.isfile(INI):
        print("FAIL: %s is missing, so nothing was checked." % INI)
        return 1
    ini = io.open(INI, encoding="utf8").read()
    rhis = re.findall(r'TargetedRHIs\s*=\s*(\S+)', ini)
    if not rhis:
        print("FAIL: no TargetedRHIs at all. The build takes the platform "
              "default, which measured as SF_VULKAN_SM5 -- and Nanite is inert "
              "on SM5.")
        return 1
    if not any("SM6" in r for r in rhis):
        print("FAIL: TargetedRHIs names %s and none of them is SM6. Nanite "
              "meshes will render their fallback at full triangle count."
              % ", ".join(rhis))
        return 1
    print("source : targets %s" % ", ".join(rhis))
    return 0


def check_runtime(paths):
    for p in paths:
        if not os.path.isfile(p):
            print("FAIL: %s does not exist, so no runtime evidence was read." % p)
            return 1
        blob = io.open(p, "rb").read()
        if b"LogInit" not in blob and b"LogRHI" not in blob and b"LogVulkanRHI" not in blob:
            print("FAIL: %s carries no engine log lines, so its silence is not "
                  "evidence." % os.path.basename(p))
            return 1
        sm6 = re.findall(rb"SF_VULKAN_SM6|PCD3D_SM6|\bSM6\b", blob)
        sm5 = re.findall(rb"SF_VULKAN_SM5|PCD3D_SM5", blob)
        name = os.path.basename(p)
        if sm5 and not sm6:
            print("FAIL: %s reports an SM5 shader platform. Nanite is INERT "
                  "there: the meshes render their fallback at the full triangle "
                  "count and the world stays geometry-bound." % name)
            return 1
        if not sm6:
            print("FAIL: %s never names an SM6 platform, so there is no "
                  "evidence Nanite can run." % name)
            return 1
        print("runtime: %s -- an SM6 platform is present (%d mention(s))"
              % (name, len(sm6)))
    return 0


def main():
    on = nanite_default_on()
    if on is None:
        print("FAIL: cannot read the WONDERLAND_NANITE default; this validator "
              "has drifted from the code it checks.")
        return 1
    if not on:
        print("Nanite is OFF by default, so SM6 is NOT required.")
        print("MEASURED: SM6 costs half the frame rate on this target even with")
        print("Nanite disabled -- 7/8/7 fps against 14/15/10 on SM5, and VRAM")
        print("1.6 GB -> 2.8 GB, for a visually identical frame. This check")
        print("applies when Nanite is switched back on, and not before.")
        print()
        print("PASS")
        return 0
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
