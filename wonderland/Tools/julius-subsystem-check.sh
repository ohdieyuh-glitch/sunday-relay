#!/usr/bin/env bash
# THE JULIUS SUBSYSTEM, COMPILED AND RUN THROUGH A RECONNECT.
#
# The ordering RULE is proven by ordering-parity-check.sh, against a table
# generated from the TypeScript. This proves the SUBSYSTEM around it: that a
# snapshot adopted after a reconnect sets the revision without moving the
# sequence, that a replayed tail cannot undo a completion, that a dropped link
# changes no mission state, and that a world switching projects cannot show the
# previous run.
#
# `Super` is supplied on the command line because UHT is not here to write it,
# and the declared base is checked below rather than trusted.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../Source/Wonderland"
STUBS="$HERE/SyntaxStubs"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

BASE="UGameInstanceSubsystem"
if ! grep -q "class WONDERLAND_API UWonderlandJuliusSubsystem : public ${BASE}$" \
	"$SRC/WonderlandJuliusSubsystem.h"; then
	echo "FAIL UWonderlandJuliusSubsystem no longer declares '${BASE}' as its base;"
	echo "     update BASE in $(basename "${BASH_SOURCE[0]}") to match."
	exit 1
fi

# BUILT AND RUN TWICE, UNOPTIMISED AND OPTIMISED. See geometry-parity-check.sh
# for the defect that made this necessary: a hand-written stub returned a
# dangling reference, every check passed at -O0, and the same build aborted
# under optimisation. The disagreement between the levels is the signal.
SANITIZE="-g -fsanitize=address,undefined -fno-sanitize-recover=all"

build_harness() {
	# shellcheck disable=SC2086
	# The declared base and the one supplied here must be the same class, so it
	# is checked rather than trusted: a subsystem re-parented without this line
	# being updated would compile against the wrong base and pass.
	g++ -std=c++17 "$1" $SANITIZE "-DSuper=${BASE}" -I"$STUBS" -I"$SRC" \
	  "$HERE/JuliusHarness/main.cpp" \
	  "$SRC/WonderlandJuliusSubsystem.cpp" \
	  "$SRC/WonderlandOrdering.cpp" \
	  "$SRC/WonderlandEnvelope.cpp" \
	  "$SRC/WonderlandJuliusState.cpp" \
	  "$SRC/WonderlandDogAnimation.cpp" \
	  -o "$2"
}

# The output is shown when it fails, which sounds obvious and was not: under
# `set -e` a failing harness exited before anything was printed, so deliberate
# mutations came back as a bare exit code with the diagnosis stuck in a temp
# file the EXIT trap then deleted.
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
	echo "FAIL the julius subsystem behaves differently at -O0 and -O2:"
	diff "$OUT/out-O0.txt" "$OUT/out-O2.txt" | head -10
	exit 1
fi
cat "$OUT/out-O2.txt"
