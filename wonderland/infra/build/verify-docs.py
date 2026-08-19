#!/usr/bin/env python3
"""Check that the build docs still describe the code that exists.

Most defects in this repository began as a claim the code no longer
supports. GPU-READY-QUEUE.md and HANDOVER.md are read at the START of an
expensive, time-boxed GPU session, by someone who will act on them
immediately and has no cheap way to check them — which is the worst
possible moment for a stale instruction.

So the mechanical claims are checked mechanically: every file the docs
tell you to run must exist, every WONDERLAND_LOOK key they tell you to
sweep must be a real key, and every code identifier they name as a dial
must still be in the generator. Prose about intent is not checked and
cannot be; this catches the rot that has actually bitten.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
DOCS = ("GPU-READY-QUEUE.md", "HANDOVER.md")


def look_keys():
    src = io.open(GEN, encoding="utf8").read()
    head = src[:src.index("\ndef build_niagara")]
    g = {"__name__": "probe", "__file__": GEN}
    os.environ.pop("WONDERLAND_LOOK", None)
    exec(compile(head, GEN, "exec"), g)
    return set(g["LOOK"])


def main():
    fails = []
    keys = look_keys()
    gen_src = io.open(GEN, encoding="utf8").read()

    for doc in DOCS:
        path = os.path.join(HERE, doc)
        if not os.path.exists(path):
            fails.append("%s: referenced doc is missing" % doc)
            continue
        text = io.open(path, encoding="utf8").read()

        # every python3 <script> the doc tells you to run
        for script in set(re.findall(r"python3 ([\w.-]+\.py)", text)):
            if not os.path.exists(os.path.join(HERE, script)):
                fails.append("%s: tells you to run %s, which does not exist"
                             % (doc, script))

        # every WONDERLAND_LOOK key it tells you to sweep
        for entry in re.findall(r'WONDERLAND_LOOK="([^"]+)"', text):
            for kv in entry.split(","):
                k = kv.split("=")[0].strip()
                if k and k not in keys:
                    fails.append("%s: sweeps WONDERLAND_LOOK key %r, which the "
                                 "LOOK table does not define" % (doc, k))

        # every backticked identifier it names as a dial in the generator
        for ident in set(re.findall(r"`(NO_SHADOW_[A-Z_]+|in_camera_lap|"
                                    r"DetailAmp|RoughVary|heroLightLumens|"
                                    r"r\.AutoExposure\.Bias)`", text)):
            if ident.replace("\\", "") not in gen_src and "." not in ident:
                fails.append("%s: names %r as a dial, but it is not in the "
                             "generator" % (doc, ident))

    if fails:
        for f in fails:
            print("FAIL %s" % f)
        return 1
    print("DOCS OK  %d docs, references resolve, %d LOOK keys known"
          % (len(DOCS), len(keys)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
