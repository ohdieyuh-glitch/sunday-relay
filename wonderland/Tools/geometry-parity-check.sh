#!/usr/bin/env bash
# THE UNREAL GEOMETRY SAMPLER, COMPILED AND RUN, AND DIFFED AGAINST THE FIXTURE.
#
# There is no Unreal Engine here and no GPU, so the usual answer would be an
# editor automation test nobody in this repository can run. Instead this builds
# the REAL sampler against the same stubs the syntax check uses and compares
# what it computes with what the TypeScript emitted.
#
# It proves the ALGORITHM agrees. It does not prove the widget draws, and it
# cannot — that needs the engine. Those are different claims and this script
# only makes the first.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../Source/Wonderland"
STUBS="$HERE/SyntaxStubs"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

g++ -std=c++17 -O1 -I"$STUBS" -I"$SRC" \
  "$HERE/GeometryHarness/main.cpp" \
  "$SRC/WonderlandUsageGeometry.cpp" \
  "$SRC/WonderlandUsageGeometry.canonical.cpp" \
  -o "$OUT/harness"

"$OUT/harness" > "$OUT/actual.tsv"
grep -v '^#' "$SRC/WonderlandUsageGeometry.golden.tsv" > "$OUT/expected.tsv"

# COMPARED NUMERICALLY, WITH A STATED TOLERANCE, AND THE REASON MATTERS.
#
# An exact text diff fails on a handful of rows in the sixth decimal. That is
# not the algorithm disagreeing: the contract stores control points as float32
# while TypeScript computes in doubles, so the two start from inputs that differ
# around the eighth decimal and the difference propagates. Forcing bit-equality
# would mean widening the mirrored struct to double purely to satisfy a
# comparison, which is the tail wagging the dog.
#
# So the tolerance is 1e-4: three orders of magnitude looser than the observed
# float32 residual, and three orders of magnitude TIGHTER than any real
# algorithmic divergence would be. A sampler that inverted its arc-length table
# wrongly, or dropped the segment-boundary reset, is wrong in the second or
# third decimal — nowhere near this. The worst deviation is printed either way,
# so a residual that starts creeping is visible before it becomes a failure.
TOLERANCE=0.0001
python3 - "$OUT/expected.tsv" "$OUT/actual.tsv" "$TOLERANCE" <<'PY'
import sys
expected, actual, tol = sys.argv[1], sys.argv[2], float(sys.argv[3])
def rows(path):
    with open(path) as fh:
        return [line.rstrip("\n").split("\t") for line in fh if line.strip()]
E, A = rows(expected), rows(actual)
if len(E) != len(A):
    print(f"FAIL sample count differs: fixture {len(E)}, sampler {len(A)}")
    sys.exit(1)
worst, where = 0.0, ""
for e, a in zip(E, A):
    if e[0] != a[0] or abs(float(e[1]) - float(a[1])) > 1e-9:
        print(f"FAIL rows are not aligned: {e[0]}@{e[1]} vs {a[0]}@{a[1]}")
        sys.exit(1)
    for col in range(2, 7):
        d = abs(float(e[col]) - float(a[col]))
        if d > worst:
            worst, where = d, f"{e[0]} t={e[1]} column {col}"
if worst > tol:
    print(f"FAIL the Unreal sampler diverges from the TypeScript fixture by {worst:.8f} at {where}")
    sys.exit(1)
print(f"ok   Unreal sampler matches the TypeScript fixture ({len(A)} samples, worst deviation {worst:.8f} at {where})")
PY
