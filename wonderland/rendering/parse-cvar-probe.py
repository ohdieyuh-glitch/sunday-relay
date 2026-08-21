#!/usr/bin/env python3
"""Turn a probe into a per-name verdict.

    parse-cvar-probe.py <names-file> <log> <out.json> [registry.html]

A name is `present` only if the ENGINE ANSWERED for it. Silence is not
presence: a name that produced no line at all is recorded as `silent`, because
"the engine said nothing" and "the engine has it" are different facts and only
one of them justifies shipping the setting.

TWO INDEPENDENT CHANNELS, because the first one has already failed silently.
A probe run reported 44 of 44 names `silent`: the echo a console variable
prints when you type its name goes out at Display verbosity under
LogConsoleResponse, and it did not reach the packaged log. So the launcher now
also asks the engine to write its own console registry to a FILE, which no log
verbosity setting can filter, and this reads whichever channel actually
answered. Every verdict records WHICH one, because "present according to the
registry" and "present and we saw its value" are different strengths of claim.
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


# A console registry dump lists each entry as a name in a table cell or an
# anchor. Matching a bare `word.word` token anywhere in the file would also
# match prose, so hits are always intersected with the requested names and the
# name must stand alone between tags or whitespace.
REGISTRY = re.compile(r"[>\s\"'](?P<name>[A-Za-z_][\w.]{2,})[<\s\"']")


def read_registry(path):
    """Names the engine says it has, from a file it wrote itself.

    Returns None when there is no registry to read — which is a different
    answer from "the registry was empty" and has to stay distinguishable.
    """
    if not path or not os.path.exists(path):
        return None
    text = io.open(path, encoding="utf8", errors="replace").read()
    return {m.group("name").lower() for m in REGISTRY.finditer(text)}


def main(argv):
    if len(argv) not in (4, 5):
        sys.stderr.write(__doc__)
        return 2
    names = [n.strip() for n in io.open(argv[1], encoding="utf8") if n.strip()]
    log = io.open(argv[2], encoding="utf8", errors="replace").read()
    registry = read_registry(argv[4] if len(argv) == 5 else None)

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
        "registry": os.path.abspath(argv[4]) if len(argv) == 5 and argv[4] else None,
        "registry_entries": (len(registry) if registry is not None else None),
        "verdicts": {},
        "evidence": {},
    }
    counts = {"present": 0, "absent": 0, "silent": 0}
    sources = {"echo": 0, "registry": 0, "none": 0}
    for name in names:
        key = name.lower()
        in_registry = registry is not None and key in registry
        if key in lowered_absent:
            # The engine said it does not recognise the name. That is a direct
            # statement and it outranks a registry the parser inferred.
            verdict, source = "absent", "echo"
        elif key in lowered_present:
            verdict, source = "present", "echo"
        elif in_registry:
            verdict, source = "present", "registry"
        else:
            verdict, source = "silent", "none"
        counts[verdict] += 1
        sources[source] += 1
        result["verdicts"][name] = verdict
        result["evidence"][name] = source
    result["counts"] = counts
    result["evidence_counts"] = sources

    # A probe where NOTHING was recognised did not measure the engine; it
    # measured a launch that failed. Saying so beats writing a file that
    # declares every setting absent and looks authoritative.
    if counts["present"] == 0:
        result["warning"] = (
            "not one name was answered, by the log OR the registry. The build "
            "probably never reached a console — check the log before believing "
            "any verdict here.")
    elif sources["echo"] == 0:
        # Worth saying out loud rather than leaving in the counts. It means the
        # console echo channel is still broken and every verdict rests on the
        # registry alone — true, but a weaker claim, and the next person should
        # know which one carried the answer.
        result["warning"] = (
            "every verdict came from the console registry; the engine's echo "
            "output never reached the log. The names are registered, but no "
            "current VALUE was observed for any of them.")

    with io.open(argv[3], "w", encoding="utf8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print("present %(present)d  absent %(absent)d  silent %(silent)d" % counts)
    print("evidence: echo %(echo)d  registry %(registry)d  none %(none)d" % sources)
    if result.get("warning"):
        print("WARNING: %s" % result["warning"])
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
