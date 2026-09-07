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
BASELINE="WonderlandDogAnimation.cpp:0 WonderlandEnvelope.cpp:0 WonderlandEntry.cpp:0 WonderlandJuliusState.cpp:0 WonderlandModule.cpp:0 WonderlandHubGameMode.cpp:0 WonderlandDogPawn.cpp:5"

# HEADERS ARE CHECKED TOO, STANDALONE, and that gap cost a whole layer.
#
# Only four .cpp files exist; every other declaration in this module is
# header-only, and a header no translation unit includes was never parsed by
# anything. `WonderlandJuliusState.h` and `WonderlandUsageHud.h` are exactly
# that shape — the C++ side of the Julius/HUD seam, with no .cpp yet — so a
# malformed one would have passed this script silently.
#
# A header is checked with `-x c++` so g++ treats it as a unit rather than
# precompiling it. Each carries its own baseline for the same reason a .cpp
# does: WonderlandHubLevel.h uses UDataAsset, which the stubs do not model.
HEADER_BASELINE="RelayWorldState.h:0 WonderlandTypes.h:0 WonderlandDogAnimation.h:0 WonderlandDogPawn.h:0 WonderlandHubGameMode.h:0 WonderlandHubLevel.h:2 WonderlandJuliusState.h:0 WonderlandUsageHud.h:0 WonderlandEntry.h:0 WonderlandEnvelope.h:0"

status=0

# THE BASELINES ARE HAND-MAINTAINED, so a file added without an entry would be
# silently unchecked — the same shape of gap that let two whole headers go
# unparsed until the baseline above was added. So enumerate the directory and
# require every unit to be listed. Adding a name is the sanctioned fix; being
# forgotten is not an option this script leaves open.
for path in "$SRC"/*.h "$SRC"/*.cpp; do
  unit="$(basename "$path")"
  case " $HEADER_BASELINE $BASELINE " in
    *" $unit:"*) ;;
    *)
      echo "FAIL $unit: not listed in HEADER_BASELINE or BASELINE, so nothing parses it"
      status=1
      ;;
  esac
done

for entry in $HEADER_BASELINE; do
  unit="${entry%%:*}"; allowed="${entry##*:}"
  n=$(g++ -fsyntax-only -std=c++17 -x c++ -I"$STUBS" -I"$SRC" "$SRC/$unit" 2>&1 | grep -c "error:" || true)
  if [ "$n" -gt "$allowed" ]; then
    echo "FAIL $unit: $n errors (baseline $allowed) — a real regression or a new engine symbol needing a stub"
    g++ -fsyntax-only -std=c++17 -x c++ -I"$STUBS" -I"$SRC" "$SRC/$unit" 2>&1 | grep "error:" | head -4
    status=1
  else
    echo "ok   $unit: $n errors (baseline $allowed)"
  fi
done

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
