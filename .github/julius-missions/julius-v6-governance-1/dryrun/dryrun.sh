#!/usr/bin/env bash
# V6 GOVERNANCE MISSION (julius-v6-governance-1), DRY RUN, ZERO SPEND, NO PROVIDER, NO NETWORK.
#
# Questions a paid run must never be the first to ask:
#   1. the seed (the repository's own code): does the seeded specification FAIL, for the RIGHT reasons?
#   2. a HALF fix (the cancelled branch checked, the already-decided branch not): does the specification still fail?
#      If it passed, the reviewer would be the only thing between the mission and a green half-change.
#   3. the REFERENCE fix (checks first, then the cancelled branch, then the duplicate branch): does it pass? (satisfiable)
#   4. each MUTANT of the reference (mut-a: cancelled write before the checks; mut-b: duplicate answers before the checks;
#      mut-c: blank check after the cancelled write): does the specification FAIL? (the oracle can see each wrong order)
#
# Every variant exists only in a throwaway workspace built from the slice list; none reaches the repository, and the last
# step checks that git still sees the sliced file unmodified. A variant that fails to apply KILLS the run (exit 3).
#
# NOTE: julius-events.ts (in the slice, byte-identical) uses a TypeScript parameter property, which Node 22 strip-only mode refuses;
# the test command therefore adds --experimental-transform-types (Node >= 22.7).
# Usage: REPO=<checkout the slice is read from> bash dryrun.sh      (default REPO: the checkout this mission is committed in)
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
M=$(cd "$HERE/.." && pwd)
REPO=${REPO:-$(cd "$HERE/../../../.." && pwd)}
SPEC=src/relay/mission/julius/julius-approval-authority.test.ts
IMPL=src/relay/mission/julius/julius-lifecycle-runtime.ts
BUILD="$HERE/build_variant.py"

for f in "$BUILD" "$M/slice.txt" "$M/seed/$SPEC" "$REPO/$IMPL" "$REPO/.github/julius-mission-slice/loader.mjs"; do
  [ -f "$f" ] || { echo "MISSING INPUT: $f"; exit 2; }
done

fresh() { # fresh <dir>: the slice, byte-identical to the repository's, plus the seeded spec and the slice harness
  mkdir -p "$1/.julius" || return 1
  while IFS= read -r line; do
    case "$line" in ''|'#'*) continue ;; esac
    mkdir -p "$1/$(dirname "$line")" && cp "$REPO/$line" "$1/$line" || return 1
  done < "$M/slice.txt"
  mkdir -p "$1/$(dirname "$SPEC")" && cp "$M/seed/$SPEC" "$1/$SPEC" || return 1
  cp "$REPO/.github/julius-mission-slice/loader.mjs" "$REPO/.github/julius-mission-slice/resolve.mjs" "$1/.julius/" || return 1
}

run() { # run <dir> <label> <expect pass|fail>
  local dir="$1" label="$2" expect="$3"
  # The entry is a LITERAL on ONE line (relay-repository-boundary.mjs refuses a node entry built at run time).
  ( cd "$dir" && node --experimental-transform-types --import ./.julius/loader.mjs --test src/relay/mission/julius/julius-approval-authority.test.ts > run.log 2>&1 )
  local code=$?
  local got; [ "$code" -eq 0 ] && got=pass || got=fail
  printf '%-34s exit %d  %s' "$label" "$code" "$got"
  [ "$got" = "$expect" ] && echo "  AS REQUIRED" || echo "  *** EXPECTED $expect ***"
  grep -E "^# (tests|pass|fail)" "$dir/run.log" | tr '\n' ' '; echo
  grep -E "^not ok|^    not ok" "$dir/run.log" | head -12 | sed 's/^/    /'
  echo
  [ "$got" = "$expect" ]
}

base=$(mktemp -d)
ok=0
scenario() { # scenario <variant> <expect>
  local dir="$base/$1"
  fresh "$dir" || { echo "COULD NOT BUILD THE WORKSPACE FOR $1"; exit 2; }
  if [ "$1" != unfixed ]; then
    ( cd "$dir" && python "$BUILD" "$1" ) || { echo "PATCH FAILED TO APPLY: $1 — the scenario would be meaningless"; exit 3; }
  fi
  echo "=========== $1 (expect $2)"
  run "$dir" "$1" "$2" || ok=1
}

scenario unfixed fail
scenario half fail
scenario reference pass
scenario mut-a fail
scenario mut-b fail
scenario mut-c fail

echo "=========== the repository's sliced file is untouched"
if git -C "$REPO" diff --quiet -- "$IMPL"; then echo "git sees $IMPL unmodified  AS REQUIRED"; else echo "*** $IMPL MODIFIED IN THE REPOSITORY ***"; ok=1; fi
echo
[ "$ok" -eq 0 ] && echo "DRY RUN OK: every scenario behaved as required" || echo "DRY RUN FAILED: see *** lines above"
echo "workspaces: $base"
exit "$ok"
