#!/usr/bin/env python3
"""Every WONDERLAND_* knob the generator reads must be forwarded into the container.

WHY THIS EXISTS

The world generator runs inside the Unreal container, and docker forwards no
environment variable it is not explicitly told to. build-render.sh names them
one at a time in wl_knob_pairs().

A knob missing from that list does not fail. It goes SILENTLY INERT -- the
build succeeds, the world is generated, and the frame comes back looking
exactly as if the knob had been set and had had no effect. That is
indistinguishable from the feature being broken, and it is worse than an
error because it invites you to go and debug the feature.

It cost a real build. WONDERLAND_TEST_STRIP=1 was set to stand a row of
material panels in front of the hero camera; the packaged world came back
with INSTANCED_PIECES=137804, byte-identical to the run before it, and the
strip was simply not in the level. Checking the list afterwards showed
WONDERLAND_MARBLE_BACKDROP_SLUG had been inert in the same way for longer,
with nothing to reveal it.

WHAT IT CHECKS

The set of WONDERLAND_* names the generator reads from the environment, minus
the set wl_knob_pairs() forwards, must be empty. It reads both files as text
rather than running anything, so it costs a second on a laptop -- against the
35-minute package that is the only other way to find out.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
RENDER = os.path.abspath(os.path.join(HERE, "..", "lightning", "build-render.sh"))


def knobs_read(src):
    """WONDERLAND_* names the generator pulls out of the environment."""
    names = set()
    names |= set(re.findall(r'os\.environ\.get\(\s*"(WONDERLAND_[A-Z0-9_]+)"', src))
    names |= set(re.findall(r'os\.environ\[\s*"(WONDERLAND_[A-Z0-9_]+)"\s*\]', src))
    names |= set(re.findall(r'os\.getenv\(\s*"(WONDERLAND_[A-Z0-9_]+)"', src))
    return names


def knobs_forwarded(src):
    """WONDERLAND_* names listed in the wl_knob_pairs() for-loop."""
    m = re.search(r'wl_knob_pairs\(\)\s*\{(.*?)\n\}', src, re.S)
    if not m:
        return None
    body = m.group(1)
    loop = re.search(r'for\s+name\s+in\s+(.*?);\s*do', body, re.S)
    if not loop:
        return None
    return set(re.findall(r'WONDERLAND_[A-Z0-9_]+', loop.group(1)))


def main():
    for path in (GEN, RENDER):
        if not os.path.isfile(path):
            print("FAIL: %s is missing, so nothing was compared -- and a check "
                  "that compared nothing must not report a pass." % path)
            return 1

    read = knobs_read(io.open(GEN, encoding="utf8").read())
    fwd = knobs_forwarded(io.open(RENDER, encoding="utf8").read())

    if fwd is None:
        print("FAIL: could not find the wl_knob_pairs() for-loop in %s. This "
              "validator has drifted from the code it checks." % RENDER)
        return 1
    if not read:
        print("FAIL: the generator appears to read no WONDERLAND_* knobs at "
              "all. That is not credible; this validator has drifted.")
        return 1

    missing = sorted(read - fwd)
    print("knobs the generator reads : %d  (%s)" % (len(read), ", ".join(sorted(read))))
    print("knobs forwarded to docker : %d" % len(fwd))
    print("read but NOT forwarded    : %d" % len(missing))
    print()

    if missing:
        print("FAIL: %d knob(s) are read by the generator and never reach it." % len(missing))
        print()
        print("      These do not error. They go SILENTLY INERT: the build")
        print("      succeeds, the world generates, and the frame looks exactly")
        print("      as though the knob were set and did nothing.")
        print()
        for n in missing:
            print("   %s" % n)
        print()
        print("      Add them to the for-loop in wl_knob_pairs() in")
        print("      %s" % RENDER)
        return 1

    print("PASS: every knob the generator reads is forwarded into the container.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
