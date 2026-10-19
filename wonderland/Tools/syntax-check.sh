#!/usr/bin/env bash
# WONDERLAND — C++ syntax check WITHOUT Unreal.
#
# `g++ -fsyntax-only` against hand-written stubs of the engine types the code
# uses. WHAT THIS PROVES: the translation units are well-formed C++17 — typos,
# unbalanced braces, wrong signatures are caught on any machine, including the
# Chromebook this was written on. WHAT IT NEVER PROVES: compilation against
# real Unreal, linkage, UHT reflection correctness, or any runtime behaviour.
# It is a pre-commit tripwire, not a build, and no output of it may be cited as
# playability evidence (see UNREAL_SESSION_CHECKLIST.md).
#
# KNOWN LIMIT: units using UHT-generated symbols (`Super`, generated
# constructors) report residual errors that are the STUBS' gap, not defects —
# the pawn is expected to report a small number. The check therefore fails only
# when a unit exceeds its recorded baseline, so a regression is a delta, not an
# absolute.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
SRC="$HERE/../Source/Wonderland"
STUBS="$HERE/SyntaxStubs"

# unit:max-known-stub-errors. 0 means it parses clean today.
BASELINE="WonderlandDogAnimation.cpp:0 WonderlandModule.cpp:0 WonderlandHubGameMode.cpp:0 WonderlandDogPawn.cpp:5"

status=0
for entry in $BASELINE; do
  unit="${entry%%:*}"; allowed="${entry##*:}"
  n=$(g++ -fsyntax-only -std=c++17 -I"$STUBS" -I"$SRC" "$SRC/$unit" 2>&1 | grep -c "error:" || true)
  if [ "$n" -gt "$allowed" ]; then
    echo "FAIL $unit: $n errors (baseline $allowed) — a real regression or a new engine symbol needing a stub"
    g++ -fsyntax-only -std=c++17 -I"$STUBS" -I"$SRC" "$SRC/$unit" 2>&1 | grep "error:" | head -4
    status=1
  else
    echo "ok   $unit: $n errors (baseline $allowed)"
  fi
done
exit $status
