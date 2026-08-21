#!/usr/bin/env python3
"""Every console-variable name this repo might apply, one per line.

The probe and the gate read the SAME list from the SAME place, so a name
cannot be applied by a profile without having been offered to the engine for
verification. A second hand-maintained list is how the two drift apart.
"""
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def names():
    found = []
    profiles = json.load(io.open(os.path.join(HERE, "profiles.json"), encoding="utf8"))
    for profile in profiles.get("profiles", {}).values():
        found.extend(profile.get("cvars", {}).keys())
    for name in profiles.get("candidates", []):
        found.append(name)
    seen, ordered = set(), []
    for name in found:
        if name not in seen:
            seen.add(name)
            ordered.append(name)
    return ordered


if __name__ == "__main__":
    sys.stdout.write("\n".join(names()) + "\n")
