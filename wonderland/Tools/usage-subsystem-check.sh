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

g++ -std=c++17 -O1 "-DSuper=${BASE}" -I"$STUBS" -I"$SRC" \
  "$HERE/UsageHarness/main.cpp" \
  "$SRC/WonderlandUsageSubsystem.cpp" \
  "$SRC/WonderlandEnvelope.cpp" \
  -o "$OUT/harness"

"$OUT/harness"
