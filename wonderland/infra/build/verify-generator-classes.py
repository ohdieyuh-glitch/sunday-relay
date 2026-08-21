#!/usr/bin/env python3
"""Every C++ class the generator spawns must actually exist in the C++.

WHY THIS EXISTS

generate-hub-level.py placed the hero Relay Dog and seven skinned companions by
loading `/Script/Wonderland.WonderlandStrollingDog`. That class was never
written. `unreal.load_class` returns None for a class that does not exist — it
does not raise — so the helper logged one warning and returned, and eight Dogs,
including the one the arrival camera is composed around, were absent from every
build that has ever run. Nothing downstream could notice: an object that is
never spawned is not in the actor count, not in the proof, and not in the frame.

That is a CLASS of bug, not an incident. Any `/Script/Wonderland.X` in a
generator is a promise about the C++ module, and Python cannot check it because
the check needs the engine. This checks it against the source instead, which
costs nothing and runs on a laptop.

    python3 verify-generator-classes.py        # exit 0 clean, 1 with findings
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.normpath(os.path.join(HERE, "..", "..", "Source", "Wonderland"))
SCANNED = ("generate-hub-level.py",)

# "/Script/<Module>.<Class>" anywhere in the file, including inside a format
# string. The module is checked too: /Script/Engine.* is the engine's and is not
# ours to verify.
REFERENCE = re.compile(r"/Script/(?P<module>\w+)\.(?P<cls>\w+)")
# UCLASS declarations: `class AWonderlandStrollingDog : public AActor`
DECLARED = re.compile(r"^\s*class\s+(?:\w+_API\s+)?(?P<name>[AUFE]\w+)\s*:", re.M)


def declared_classes():
    names = set()
    if not os.path.isdir(SOURCE):
        return names
    for entry in sorted(os.listdir(SOURCE)):
        if not entry.endswith((".h", ".cpp")):
            continue
        text = io.open(os.path.join(SOURCE, entry), encoding="utf8", errors="replace").read()
        for match in DECLARED.finditer(text):
            names.add(match.group("name"))
    return names


def main():
    declared = declared_classes()
    if not declared:
        print("FAIL could not read any class declarations from %s" % SOURCE)
        return 1

    problems = []
    checked = 0
    for name in SCANNED:
        path = os.path.join(HERE, name)
        if not os.path.exists(path):
            problems.append("%s is missing" % name)
            continue
        text = io.open(path, encoding="utf8", errors="replace").read()
        for match in REFERENCE.finditer(text):
            module, cls = match.group("module"), match.group("cls")
            if module != "Wonderland":
                continue          # not ours to verify
            checked += 1
            # Unreal's path name omits the A/U prefix. Accept either.
            if not any(("%s%s" % (prefix, cls)) in declared or cls in declared
                       for prefix in ("A", "U", "F", "E")):
                line = text[:match.start()].count("\n") + 1
                problems.append(
                    "%s:%d spawns /Script/Wonderland.%s and no such class is "
                    "declared in Source/Wonderland.\n"
                    "      unreal.load_class returns None for this — it does NOT "
                    "raise — so whatever it was going to place will be silently "
                    "absent from the level." % (name, line, cls))

    if problems:
        print("FAIL %d problem(s):" % len(problems))
        for problem in problems:
            print("  - %s" % problem)
        return 1
    print("GENERATOR CLASSES OK  %d /Script/Wonderland references, all declared "
          "(%d classes in Source/Wonderland)" % (checked, len(declared)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
