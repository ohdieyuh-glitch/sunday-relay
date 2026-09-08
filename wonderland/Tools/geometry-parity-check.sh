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

# BUILT WITH THE SANITIZERS ON, and that is not belt-and-braces.
#
# The stubs are hand-written, and a hand-written stub can be wrong in ways a
# parse cannot see. One was: FMath::Max returned `decltype(a>b?a:b)`, which for
# two lvalues is a REFERENCE to the function's own parameter. Every check passed
# at -O0 because the dead stack slot still held the right number, and the same
# build aborted at -O1 with a Reserve() of -1073741824. ASan and UBSan name that
# directly instead of leaving it to whichever optimisation level happens to be
# in the script that day.
# BUILT AND RUN TWICE, UNOPTIMISED AND OPTIMISED, AND THAT IS NOT PARANOIA.
#
# The stubs are hand-written, and a hand-written stub can be wrong in ways a
# parse cannot see. One was: FMath::Max returned `decltype(a>b?a:b)`, which for
# two lvalues is a REFERENCE to the function's own parameter. Every check passed
# at -O0, because the dead stack slot still held the right number; the same
# build aborted at -O1 with a Reserve() of -1073741824. The DISAGREEMENT between
# the two levels is what exposes that class, so both are run and both must pass.
#
# The sanitizers are on as well, and the two settings need each other. ASan
# names that defect precisely — "stack-use-after-return ... in FMath::Max" — but
# only in the -O2 build; at -O0 and -O1 it reported nothing, because the
# reference had not yet been reused. Optimisation is what makes the bug
# observable and the sanitizer is what makes it legible, so the check runs both
# rather than picking one and hoping.
SANITIZE="-g -fsanitize=address,undefined -fno-sanitize-recover=all"

build_harness() {
	# shellcheck disable=SC2086
	g++ -std=c++17 "$1" $SANITIZE -I"$STUBS" -I"$SRC" \
	  "$HERE/GeometryHarness/main.cpp" \
	  "$SRC/WonderlandUsageGeometry.cpp" \
	  "$SRC/WonderlandUsageGeometry.canonical.cpp" \
	  -o "$2"
}

# THE OUTPUT IS SHOWN WHEN IT FAILS, which sounds obvious and was not.
#
# The first version redirected each run to a file and printed only the last one.
# Under `set -e` a failing harness exited the script the moment it returned
# non-zero, so every "FAIL <what broke>" line sat unread in a temp directory
# that the EXIT trap then deleted: four deliberate mutations came back as a bare
# exit code with no output at all. A check that cannot say what failed is worse
# than no check, because it looks like one.
run_harness() {
	local bin="$1" out="$2"
	if ! "$bin" > "$out" 2>&1; then
		echo "FAIL $(basename "$bin") reported failures:"
		cat "$out"
		exit 1
	fi
}

build_harness -O0 "$OUT/harness-O0"
build_harness -O2 "$OUT/harness-O2"
run_harness "$OUT/harness-O0" "$OUT/actual-O0.tsv"
run_harness "$OUT/harness-O2" "$OUT/actual.tsv"

# The two levels must AGREE as well as both succeed. Numbers that shift with the
# optimiser are a defect wherever they live, and would otherwise show up as a
# tolerance that mysteriously needed loosening.
if ! diff -q "$OUT/actual-O0.tsv" "$OUT/actual.tsv" > /dev/null; then
	echo "FAIL the sampler computes different numbers at -O0 and -O2:"
	diff "$OUT/actual-O0.tsv" "$OUT/actual.tsv" | head -10
	exit 1
fi

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
