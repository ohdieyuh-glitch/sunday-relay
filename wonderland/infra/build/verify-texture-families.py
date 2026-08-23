#!/usr/bin/env python3
"""Every texture family a material asks for must actually be imported.

THE BUG THIS EXISTS FOR

gen-textures.py synthesises eleven surface families. build_textures() imported
six of them, from a list retyped beside the generator rather than read from it.
So metal, glaze, cap, ripple and petal were written to disk on every build and
never turned into Texture2D assets, and FOURTEEN materials rendered with no map:
gold, gold_glow, brass_deep, porcelain, dog_body — the Relay Dogs' own coat —
all three mushrooms, water, and every petal, which generate-hub-level.py's own
comment calls the carrier of "most of the world's pink and violet".

It was invisible because the failure prints as

    TEXTURE MISSING for gold (family metal): keeping the palette base colour

which reads as a considered fallback, not as five families going missing. Three
of those lines sat in every build log for a whole session.

The three lists that have to agree are:

  1. what gen-textures.py FAMILIES produces,
  2. what build_textures() imports,
  3. what the `textured` material table asks for.

(2) now derives from (1), so this checks that nothing in (3) is outside it, and
that (2) really does read (1) rather than having quietly grown a second literal.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GENERATOR = os.path.join(HERE, "generate-hub-level.py")
GENTEX = os.path.join(HERE, "gen-textures.py")


def fail(msg):
    sys.stderr.write("verify-texture-families: %s\n" % msg)
    raise SystemExit(1)


def main():
    gen = io.open(GENTEX, encoding="utf8").read()
    src = io.open(GENERATOR, encoding="utf8").read()

    produced = re.findall(r'\("(\w+)",\s*make_\w+,\s*\d+\)', gen)
    if not produced:
        fail("no FAMILIES tuple found in gen-textures.py — this checker reads it "
             "statically and the shape has changed")

    # (2) must READ (1). A hardcoded family list here is the defect itself, so
    # the check is on the mechanism, not only on today's contents.
    if "ns.get(\"FAMILIES\"" not in src:
        fail("build_textures() no longer reads gen-textures.py's FAMILIES. It is "
             "back to a retyped list, which is exactly how five families went "
             "missing: %s" % ", ".join(produced))

    # (3): every family the material table asks for must be produced.
    block = re.search(r"textured = \{(.*?)\n    \}", src, re.S)
    if not block:
        fail("no `textured` material table found in %s" % GENERATOR)
    asked = {}
    for m in re.finditer(r'"(\w+)":\s*\("(\w+)"', block.group(1)):
        asked.setdefault(m.group(2), []).append(m.group(1))

    orphans = {fam: mats for fam, mats in asked.items() if fam not in produced}
    if orphans:
        lines = ["%d material family(ies) have no generated texture:" % len(orphans)]
        for fam, mats in sorted(orphans.items()):
            lines.append("  %-8s wanted by %d material(s): %s"
                         % (fam, len(mats), ", ".join(sorted(mats))))
        lines.append("Either add it to gen-textures.py FAMILIES or stop asking for it.")
        fail("\n".join(lines))

    unused = [f for f in produced if f not in asked]
    total = sum(len(v) for v in asked.values())
    note = (" (%s generated but unused)" % ", ".join(unused)) if unused else ""
    print("verify-texture-families: ok — %d families produced, all %d families "
          "asked for by %d materials are among them%s"
          % (len(produced), len(asked), total, note))


if __name__ == "__main__":
    main()
