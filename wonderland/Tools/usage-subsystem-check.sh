#!/usr/bin/env bash
# THE USAGE SUBSYSTEM, COMPILED AND RUN AGAINST THE SEQUENCES A LIVE WORLD SEES.
#
# The syntax check proves the file parses. This proves it BEHAVES: that a
# reconnect replaying an old reading cannot rewind the HUD, that another
# project's fan-out cannot overwrite this world's spend, and that a dropped link
# leaves the last figures standing rather than clearing them to zero.
#
# `Super` is supplied on the command line because UHT is not here to write it.
# The value is not a guess — WonderlandUsageSubsystem.h declares the base one
# line above — and defining it here rather than in the shared stubs keeps the
# syntax check honest about every other class, where the base is not known.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../Source/Wonderland"
STUBS="$HERE/SyntaxStubs"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

# The declared base and the one supplied here must be the same class, so it is
# checked rather than trusted: a subsystem re-parented without this line being
# updated would otherwise compile against the wrong base and pass.
BASE="UGameInstanceSubsystem"
if ! grep -q "class WONDERLAND_API UWonderlandUsageSubsystem : public ${BASE}$" \
	"$SRC/WonderlandUsageSubsystem.h"; then
	echo "FAIL UWonderlandUsageSubsystem no longer declares '${BASE}' as its base;"
	echo "     update BASE in $(basename "${BASH_SOURCE[0]}") to match."
	exit 1
fi

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
	g++ -std=c++17 "$1" $SANITIZE "-DSuper=${BASE}" -I"$STUBS" -I"$SRC" \
	  "$HERE/UsageHarness/main.cpp" \
	  "$SRC/WonderlandUsageSubsystem.cpp" \
	  "$SRC/WonderlandEnvelope.cpp" \
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
run_harness "$OUT/harness-O0" "$OUT/out-O0.txt"
run_harness "$OUT/harness-O2" "$OUT/out-O2.txt"

if ! diff -q "$OUT/out-O0.txt" "$OUT/out-O2.txt" > /dev/null; then
	echo "FAIL the subsystem behaves differently at -O0 and -O2:"
	diff "$OUT/out-O0.txt" "$OUT/out-O2.txt" | head -10
	exit 1
fi
cat "$OUT/out-O2.txt"
