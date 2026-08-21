#!/usr/bin/env python3
"""Keep the preview's Dog honest against the C++ pawn that builds the real one.

The Dog is the focal subject of the hero frame and the generator does not
build it — AWonderlandDogPawn::BuildVisibleBody assembles it at runtime — so
verify-hero-composition.py carries a TRANSCRIPTION of that part list.

A transcription rots silently, and this one already had. The stand-in it
replaced was three cubes eyeballed at "about dog-shaped": 168 uu tall where
the real Dog is 325, with no legs. Every composition figure quoted for the
Dog understated the one object the shot is arranged around, by a factor of
nearly three, and nothing anywhere could have noticed.

So the two are compared mechanically: the C++ part table is parsed out of the
source and checked against the preview's copy. If the pawn's proportions
change, this fails and says which row.

Runs anywhere; no engine, no GPU.
"""
import io
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
# THE TABLE MOVED. It used to live in WonderlandDogPawn.cpp and be copied by
# hand for the world's Dogs; the copy was never written and eight Relay Dogs
# went missing. There is now one canonical table in WonderlandDogBody.cpp that
# every Dog builds from, so that is what this checks the preview against.
PAWN = os.path.normpath(os.path.join(HERE, "..", "..", "Source", "Wonderland",
                                     "WonderlandDogBody.cpp"))
PREVIEW = os.path.join(HERE, "verify-hero-composition.py")


def cpp_parts():
    """Pull S, the derived heights, and the FVector part rows out of the pawn."""
    src = io.open(PAWN, encoding="utf8").read()
    # The scale is a PARAMETER now, so the number to check against is the
    # published reference constant rather than a local literal.
    m = re.search(r"ReferenceScale = ([\d.]+)f;", src)
    if not m:
        m = re.search(r"const float S = ([\d.]+)f;", src)
    if not m:
        raise SystemExit("could not find the reference scale in %s" % PAWN)
    S = float(m.group(1))
    env = {"S": S, "FRotator": None}
    # PARSE THE LOCAL CONSTANTS INSTEAD OF HARDCODING THEM.
    #
    # This used to assume LegH/Bz/Hz and compute them itself. The moment the
    # part table gained HeadX and LegT, every row that used them failed to
    # evaluate and was SILENTLY SKIPPED — so the checker compared the surviving
    # rows against the wrong preview rows and reported a mismatch at part 3
    # that had nothing to do with part 3. A checker that drops what it cannot
    # read reports the failure in the wrong place.
    for name, expr in re.findall(r"const float (\w+)\s*=\s*([^;]+);", src):
        text = expr.replace("f", "").strip()
        try:
            env[name] = float(eval(text, {"__builtins__": {}}, env))
        except Exception:
            continue
    for required in ("LegH", "Bz", "Hz"):
        if required not in env:
            raise SystemExit("could not evaluate %s from %s" % (required, PAWN))

    rows = []
    for loc, scale in re.findall(
            r"\{\s*FVector\(([^)]*)\),\s*FVector\(([^)]*)\)", src):
        def ev(text):
            out = []
            for term in text.split(","):
                term = term.strip().replace("f", "")
                if not term:
                    return None
                try:
                    out.append(float(eval(term, {"__builtins__": {}}, env)))
                except Exception:
                    return None
            return out
        L, Sc = ev(loc), ev(scale)
        if L and Sc and len(L) == 3 and len(Sc) == 3:
            rows.append((tuple(round(v, 4) for v in L),
                         tuple(round(v, 4) for v in Sc)))
    return S, rows


def preview_parts():
    """Run the preview's own transcription block and collect what it emits."""
    src = io.open(PREVIEW, encoding="utf8").read()
    m = re.search(r"for _n, \((.*?)\) in enumerate\(\((.*?)\n        \)\):",
                  src, re.S)
    if not m:
        raise SystemExit("preview's Dog transcription block not found — the "
                         "harness changed shape and this check needs updating")
    S = 1.3
    env = {"_S": S, "_M": "dog_body"}
    # PARSE THE PREVIEW'S OWN DERIVED HEIGHTS, for the same reason the C++ side
    # does: these were hardcoded as _LegH = 100 * S, and when the Dog's legs
    # changed to 92 the checker compared correct rows against heights nobody
    # used any more and blamed the tail. Both halves read their constants from
    # the source now, so there is no third place for the number to live.
    for name, expr in re.findall(r"^\s*(_LegH|_Bz|_Hz)\s*=\s*(.+)$", src, re.M):
        try:
            env[name] = float(eval(expr.strip(), {"__builtins__": {}}, env))
        except Exception:
            continue
    for required in ("_LegH", "_Bz", "_Hz"):
        if required not in env:
            raise SystemExit("could not evaluate %s from %s" % (required, PREVIEW))
    rows = []
    for line in m.group(2).splitlines():
        # Strip trailing comments BEFORE parsing. Without this the rows that
        # carry one — body, head — failed to eval, were silently skipped, and
        # every subsequent row compared against the wrong part. A checker that
        # drops what it cannot read reports a mismatch in the wrong place.
        line = line.split("#")[0].strip().rstrip(",")
        if not line.startswith("("):
            continue
        try:
            vals = eval(line, {"__builtins__": {}}, env)
        except Exception as e:
            raise SystemExit("preview Dog row %r did not evaluate: %s" % (line, e))
        if not isinstance(vals, tuple) or len(vals) != 7:
            raise SystemExit("preview Dog row did not parse as 7 values: %r" % line)
        if True:
            rows.append((tuple(round(float(v), 4) for v in vals[0:3]),
                         tuple(round(float(v), 4) for v in vals[3:6])))
    return rows


def main():
    S, want = cpp_parts()
    got = preview_parts()
    fails = []

    if not want:
        fails.append("parsed no parts out of the C++ pawn")
    if not got:
        fails.append("parsed no parts out of the preview transcription")

    if len(want) != len(got):
        fails.append("the pawn builds %d parts, the preview transcribes %d"
                     % (len(want), len(got)))

    for i, (w, g) in enumerate(zip(want, got)):
        if w != g:
            fails.append("part %d differs\n      pawn:    loc=%s scale=%s"
                         "\n      preview: loc=%s scale=%s"
                         % (i, w[0], w[1], g[0], g[1]))

    if fails:
        for f in fails:
            print("FAIL %s" % f)
        print("\nThe preview's Dog is a transcription of the C++ pawn. If the "
              "pawn changed on purpose, update the block in "
              "verify-hero-composition.py to match.")
        return 1

    top = max(l[2] + s[2] * 50.0 for l, s in want)
    print("DOG PROXY OK  %d parts, S=%.1f, %.0f uu tall - preview matches the pawn"
          % (len(want), S, top))
    return 0


if __name__ == "__main__":
    sys.exit(main())
