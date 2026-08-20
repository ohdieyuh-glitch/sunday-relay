#!/usr/bin/env python3
"""The tracer's texture table must match the generator's.

`generate-hub-level.py` decides which palette entry takes which map and at
what world scale. `verify-hero-lighting.py` carries a SECOND COPY of that
mapping so it can sample the same maps at the same scale.

Two copies of one fact drift, and the drift is silent in the worst way: the
trace keeps rendering, just of a slightly different world than the one that
cooks. A material given a map in the generator and missing from the tracer is
shaded with flat colour and reads as a material problem that does not exist;
one with a mismatched scale renders the right texture at the wrong size and
invites a pass to "fix" a tiling that is only wrong in the preview.

Both tables are parsed out of the source, so this cannot be satisfied by
remembering to update a comment.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(HERE, "generate-hub-level.py")
TRACE = os.path.join(HERE, "verify-hero-lighting.py")
TEXTOOL = os.path.join(HERE, "gen-textures.py")


def parse_generator():
    """The `textured = { ... }` block inside build()."""
    src = io.open(GEN, encoding="utf8").read()
    m = re.search(r"\n\s*textured = \{(.*?)\n\s*\}\n", src, re.S)
    if not m:
        raise SystemExit("could not find the generator's `textured` table")
    out = {}
    for name, fam, scale in re.findall(
            r'"([A-Za-z0-9_]+)":\s*\(\s*"([a-z]+)",\s*([0-9.]+)', m.group(1)):
        out[name] = (fam, float(scale))
    return out


def parse_tracer():
    src = io.open(TRACE, encoding="utf8").read()
    m = re.search(r"\nTEXTURED = \{(.*?)\n\}\n", src, re.S)
    if not m:
        raise SystemExit("could not find the tracer's TEXTURED table")
    out = {}
    for name, fam, scale in re.findall(
            r'"([A-Za-z0-9_]+)":\s*\(\s*"([a-z]+)",\s*([0-9.]+)', m.group(1)):
        out[name] = (fam, float(scale))
    return out


def parse_families():
    src = io.open(TEXTOOL, encoding="utf8").read()
    m = re.search(r"\nFAMILIES = \((.*?)\n\)\n", src, re.S)
    if not m:
        raise SystemExit("could not find FAMILIES in gen-textures.py")
    return {n for n in re.findall(r'\("([a-z]+)",', m.group(1))}


def main():
    gen, trace, fams = parse_generator(), parse_tracer(), parse_families()
    fails = []

    if not gen:
        fails.append("parsed no entries from the generator table")
    if not trace:
        fails.append("parsed no entries from the tracer table")

    for name, (fam, scale) in sorted(gen.items()):
        if name not in trace:
            fails.append("%s is textured in the generator (%s) but NOT in the tracer "
                         "- the trace shades it flat" % (name, fam))
            continue
        tfam, tscale = trace[name]
        if tfam != fam:
            fails.append("%s: generator uses %s, tracer uses %s" % (name, fam, tfam))
        if abs(tscale - scale) > 1e-9:
            fails.append("%s: scale %s in the generator, %s in the tracer"
                         % (name, scale, tscale))

    for name in sorted(trace):
        if name not in gen:
            fails.append("%s is textured in the tracer but not in the generator "
                         "- the trace renders a map the cook will not" % name)

    # every family either table names must actually be produced
    for src_name, table in (("generator", gen), ("tracer", trace)):
        for name, (fam, _s) in table.items():
            if fam not in fams:
                fails.append("%s maps %s to family %r, which gen-textures.py does "
                             "not build" % (src_name, name, fam))

    if fails:
        for f in sorted(set(fails)):
            print("FAIL %s" % f)
        return 1
    print("TEXTURE PARITY OK  %d materials, %d families, generator and tracer agree"
          % (len(gen), len(fams)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
