#!/usr/bin/env python3
"""Every Blueprint parent make-blueprints.py names must be a real C++ class.

WHY THIS GATE

make-blueprints.py creates Blueprint SUBCLASSES of C++ actors. `unreal.load_class`
returns None for a class that does not exist rather than raising, so a renamed or
deleted parent produces one error line in a log nobody reads and a build with no
Blueprints in it — the same shape that once removed eight Relay Dogs from a world
that still reported a plausible actor count.

Checking it needs no engine: the parent path names a class, and the class either
has a header in Source/Wonderland or it does not.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
MAKER = os.path.join(HERE, "make-blueprints.py")
SOURCE = os.path.normpath(os.path.join(HERE, "..", "..", "Source", "Wonderland"))


def fail(msg):
    sys.stderr.write("verify-blueprint-parents: %s\n" % msg)
    raise SystemExit(1)


def main():
    if not os.path.isfile(MAKER):
        fail("make-blueprints.py is missing — nothing generates the Blueprint layer")
    src = io.open(MAKER, encoding="utf8").read()

    refs = re.findall(r'"/Script/Wonderland\.(\w+)"', src)
    if not refs:
        fail("make-blueprints.py names no /Script/Wonderland parents — it would "
             "create nothing, which is not the same as being disabled")

    headers = {f[:-2] for f in os.listdir(SOURCE) if f.endswith(".h")}
    missing = [r for r in refs if r not in headers]
    if missing:
        fail("these Blueprint parents have no class in Source/Wonderland:\n  %s\n"
             "unreal.load_class returns None for them and the build ships with "
             "no Blueprints." % "\n  ".join(sorted(set(missing))))

    # AND IT MUST NOT CLOBBER AUTHORED WORK. Regenerating an existing Blueprint
    # every build discards whatever was authored in its graph, which makes the
    # whole Blueprint layer pointless.
    if "does_asset_exist" not in src:
        fail("make-blueprints.py does not check whether an asset already exists — "
             "it would overwrite authored Blueprints on every build")

    # A hand-written .uasset is not a Blueprint; it is a corrupt file that looks
    # like one. The only supported path is the asset tools.
    if "create_asset" not in src:
        fail("make-blueprints.py does not use AssetToolsHelpers.create_asset")
    if re.search(r"open\([^)]*\.uasset", src):
        fail("make-blueprints.py appears to write a .uasset by hand — Blueprints "
             "are binary assets and cannot be fabricated")

    print("verify-blueprint-parents: ok — %d Blueprint parent(s) all declared in "
          "Source/Wonderland, creation is idempotent and goes through the asset tools"
          % len(set(refs)))


if __name__ == "__main__":
    main()
