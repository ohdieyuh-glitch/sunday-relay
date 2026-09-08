#!/usr/bin/env bash
# THE WIRE DECODER, COMPILED AND RUN — the only piece of this seam whose
# failure mode is silence.
#
# An unmatched enum token lands on `Unobserved`; a zero-filled carrier reads as
# "Relay did not say". So a decoder that gets everything wrong looks exactly
# like a Relay that is reporting nothing, and no screenshot distinguishes them.
# This runs the real decoder over real payloads and hostile ones and asserts
# what it PRODUCED, plus the canonical fixtures generated from the TypeScript.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$HERE/../Source/Wonderland"
STUBS="$HERE/SyntaxStubs"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"' EXIT

FIXTURES="${1:-$HERE/WireHarness/fixtures.tsv}"
DELIVERIES="${2:-$HERE/WireHarness/deliveries.tsv}"
USAGES="${3:-$HERE/WireHarness/usages.tsv}"

# BUILT AND RUN TWICE. See geometry-parity-check.sh for why: a hand-written stub
# returned a dangling reference, every check passed at -O0, and the same build
# aborted under optimisation. The disagreement between the levels is the signal.
SANITIZE="-g -fsanitize=address,undefined -fno-sanitize-recover=all"

build_harness() {
	# shellcheck disable=SC2086
	g++ -std=c++17 "$1" $SANITIZE -I"$STUBS" -I"$SRC" \
	  "$HERE/WireHarness/main.cpp" \
	  "$SRC/WonderlandWireDecode.cpp" \
	  "$SRC/WonderlandWireDecode.tables.cpp" \
	  -o "$2"
}

run_harness() {
	local bin="$1" out="$2"
	if ! "$bin" "$FIXTURES" "$DELIVERIES" "$USAGES" > "$out" 2>&1; then
		echo "FAIL $(basename "$bin") reported failures:"
		cat "$out"
		exit 1
	fi
}

build_harness -O0 "$OUT/wire-O0"
build_harness -O2 "$OUT/wire-O2"
run_harness "$OUT/wire-O0" "$OUT/out-O0.txt"
run_harness "$OUT/wire-O2" "$OUT/out-O2.txt"

if ! diff -q "$OUT/out-O0.txt" "$OUT/out-O2.txt" > /dev/null; then
	echo "FAIL the wire decoder behaves differently at -O0 and -O2:"
	diff "$OUT/out-O0.txt" "$OUT/out-O2.txt" | head -10
	exit 1
fi
cat "$OUT/out-O2.txt"
