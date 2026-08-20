#!/usr/bin/env python3
"""Every project-local Wonderland header an #include names must actually exist.

A real L4 run got through UHT and nine compile actions before dying on

    WonderlandDogPawn.cpp:21:10: fatal error: 'WonderlandInteractable.h' file not found

That header had never been committed — not in the tree, not in any commit on
any branch. Neither had WonderlandRelayLink.h on the line below it. Both were
found one at a time, by paying for a compile.

This finds all of them at once, in under a second, before the GPU is billing.

THE HARD PART IS NOT FINDING MISSING FILES, it is not crying wolf. A C++ file
includes three quite different kinds of thing and only one of them lives in
this repository:

  ENGINE / PLUGIN   "GameFramework/Pawn.h", "HttpModule.h", "Dom/JsonObject.h"
                    Resolved by UBT from module include paths this script
                    cannot see. Never checked.
  GENERATED         "WonderlandDogPawn.generated.h"
                    Written by UnrealHeaderTool at build time. Correct to
                    reference and always absent from source control.
  PROJECT-LOCAL     "WonderlandInteractable.h"
                    Ours. Must be on disk.

The rule used here: an include is project-local when its basename starts with a
known project prefix AND it is not a .generated.h. That is deliberately
conservative — it will never reject an engine header, and it catches exactly
the class of failure that has actually cost GPU time.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MODULE = os.path.normpath(os.path.join(HERE, "..", "..", "Source"))

INCLUDE = re.compile(r'^\s*#\s*include\s+"([^"]+)"', re.M)

# A header is ours if it starts with one of these. RelayWorldState.h is the one
# project header that does not begin with "Wonderland".
PROJECT_PREFIXES = ("Wonderland", "RelayWorldState")


def is_generated(name):
    return name.endswith(".generated.h")


def is_project_local(name):
    base = os.path.basename(name)
    if is_generated(base):
        return False
    return any(base.startswith(p) for p in PROJECT_PREFIXES)


def collect_sources(root):
    out = []
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            if f.endswith((".h", ".cpp")):
                out.append(os.path.join(dirpath, f))
    return sorted(out)


def main():
    if not os.path.isdir(MODULE):
        print("FAIL no Source tree at %s" % MODULE)
        return 1

    sources = collect_sources(MODULE)
    if not sources:
        print("FAIL no .h/.cpp found under %s" % MODULE)
        return 1

    # Every header actually on disk, by basename. UBT resolves project headers
    # by name across the module's include paths, so basename is the right key.
    on_disk = {}
    for path in sources:
        if path.endswith(".h"):
            on_disk.setdefault(os.path.basename(path), path)

    fails = []
    checked = 0
    generated_seen = 0
    engine_seen = 0

    for path in sources:
        rel = os.path.relpath(path, MODULE)
        text = io.open(path, encoding="utf8", errors="replace").read()
        for inc in INCLUDE.findall(text):
            base = os.path.basename(inc)
            if is_generated(base):
                generated_seen += 1
                # A .generated.h must correspond to a real header of the same
                # stem, or UHT will never produce it.
                stem = base[: -len(".generated.h")]
                if stem + ".h" not in on_disk:
                    fails.append("%s includes %s but there is no %s.h for UHT to "
                                 "generate it from" % (rel, inc, stem))
                continue
            if not is_project_local(inc):
                engine_seen += 1
                continue
            checked += 1
            if base not in on_disk:
                fails.append("%s includes project header %r which does not exist "
                             "anywhere in the module" % (rel, inc))

    if fails:
        for f in sorted(set(fails)):
            print("FAIL %s" % f)
        print("\nThese are the failures that otherwise appear one at a time, "
              "at the cost of a GPU compile each.")
        return 1

    print("LOCAL INCLUDES OK  %d source files, %d project-local includes resolve, "
          "%d generated, %d engine/plugin ignored"
          % (len(sources), checked, generated_seen, engine_seen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
