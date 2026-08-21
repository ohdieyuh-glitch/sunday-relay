#!/usr/bin/env python3
"""Turn a probe log into a per-name verdict.

    parse-cvar-probe.py <names-file> <log> <out.json>

A name is `present` only if the log shows the engine ANSWERING for it. Silence
is not presence: a name that produced no line at all is recorded as `silent`,
because "the engine said nothing" and "the engine has it" are different facts
and only one of them justifies shipping the setting.
"""
import io
import json
import os
import re
import sys

# Unreal's phrasing for an unknown console command has changed across versions,
# so several are matched. A name that hits ANY of them is absent.
UNKNOWN = (
    re.compile(r"command not recognized[:\s]+(?P<name>[\w.]+)", re.I),
    re.compile(r"unrecognized command[:\s]+(?P<name>[\w.]+)", re.I),
    re.compile(r"(?P<name>[\w.]+)\s+is not a recognized", re.I),
)
# `r.Foo` with no argument echoes its value. NOT anchored to the start of the
# line: real output is `LogConsoleResponse: Display: r.ScreenPercentage = "100"`,
# and an anchored pattern matched none of it — the first version of this parser
# reported a CVar the engine had answered for as `silent`, which is the exact
# wrong-in-the-safe-direction failure that makes a gate stop gating.
# Over-matching is harmless: every hit is intersected with the requested name
# list before it becomes a verdict.
PRESENT = (
    re.compile(r"(?P<name>[A-Za-z_][\w.]*)\s*=\s*", re.M),
    re.compile(r"(?P<name>[A-Za-z_][\w.]*)\s*:\s*Current value", re.I),
)


def main(argv):
    if len(argv) != 4:
        sys.stderr.write(__doc__)
        return 2
    names = [n.strip() for n in io.open(argv[1], encoding="utf8") if n.strip()]
    log = io.open(argv[2], encoding="utf8", errors="replace").read()

    absent, present = set(), set()
    for pattern in UNKNOWN:
        for match in pattern.finditer(log):
            absent.add(match.group("name"))
    for pattern in PRESENT:
        for match in pattern.finditer(log):
            present.add(match.group("name"))

    lowered_absent = {n.lower() for n in absent}
    lowered_present = {n.lower() for n in present}

    result = {
        "engine": os.environ.get("WL_UE_VERSION", "5.8"),
        "probed_names": len(names),
        "log": os.path.abspath(argv[2]),
        "verdicts": {},
    }
    counts = {"present": 0, "absent": 0, "silent": 0}
    for name in names:
        key = name.lower()
        if key in lowered_absent:
            verdict = "absent"
        elif key in lowered_present:
            verdict = "present"
        else:
            verdict = "silent"
        counts[verdict] += 1
        result["verdicts"][name] = verdict
    result["counts"] = counts

    # A probe where NOTHING was recognised did not measure the engine; it
    # measured a launch that failed. Saying so beats writing a file that
    # declares every setting absent and looks authoritative.
    if counts["present"] == 0:
        result["warning"] = (
            "not one name was answered. The build probably never reached a "
            "console — check the log before believing any verdict here.")

    with io.open(argv[3], "w", encoding="utf8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print("present %(present)d  absent %(absent)d  silent %(silent)d" % counts)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
