#!/usr/bin/env bash
# DIAGNOSTIC MISSION 3 (julius-diag-audit-fixes-1), DRY RUN, ZERO SPEND.
#
# Questions a paid run must never be the first to ask:
#   1. does the seeded specification FAIL today, and for the RIGHT reasons?
#   2. can PARTIAL fixes pass it? Fix A alone, and fixes A and B together, must each still FAIL: the specification must enforce every one of the three fixes.
#   3. is it SATISFIABLE: do the three correct, minimal fixes together make it pass?
#
# Every fix below exists only in a throwaway workspace. None reaches the repository: producing it is the Coding Agent's work, and the last line of this script
# checks that git still sees the slice unmodified. A patch that fails to apply KILLS the run (exit 3).
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
M="$REPO/.github/julius-missions/julius-diag-audit-fixes-1"
SPEC=src/relay/audit-fixes.test.ts
SLICE="src/relay/mission/review-repair.ts src/relay/recovery/detection.ts src/relay/coordination/claims.ts src/relay/protocol/errors.ts"

for f in "$HERE/fix-a-ledger.py" "$HERE/fix-b-signals.py" "$HERE/fix-c-claims.py" "$M/seed/$SPEC" "$REPO/.github/julius-mission-slice/loader.mjs"; do
  [ -f "$f" ] || { echo "MISSING INPUT: $f"; exit 2; }
done
for f in $SLICE; do [ -f "$REPO/$f" ] || { echo "MISSING INPUT: $f"; exit 2; }; done

fresh() { # fresh <dir>
  mkdir -p "$1/.julius" || return 1
  for f in $SLICE; do mkdir -p "$1/$(dirname "$f")" && cp "$REPO/$f" "$1/$f" || return 1; done
  cp "$M/seed/$SPEC" "$1/$SPEC" || return 1
  cp "$REPO/.github/julius-mission-slice/loader.mjs" "$REPO/.github/julius-mission-slice/resolve.mjs" "$1/.julius/" || return 1
}

patch() { # patch <dir> <script>   — a failure here ends the run
  ( cd "$1" && python "$2" ) \
    || { echo "PATCH FAILED TO APPLY: $2 — the scenario below would be meaningless"; exit 3; }
}

run() { # run <dir> <label> <expect pass|fail>
  local dir="$1" label="$2" expect="$3"
  # The entry is a LITERAL on ONE line (relay-repository-boundary.mjs refuses a node entry built at run time).
  ( cd "$dir" && node --import ./.julius/loader.mjs --test src/relay/audit-fixes.test.ts > run.log 2>&1 )
  local code=$?
  local got; [ "$code" -eq 0 ] && got=pass || got=fail
  printf '%-46s exit %d  %s' "$label" "$code" "$got"
  [ "$got" = "$expect" ] && echo "  AS REQUIRED" || echo "  *** EXPECTED $expect ***"
  grep -E "^# (tests|pass|fail)" "$dir/run.log" | tr '\n' ' '; echo
  grep -E "^not ok" "$dir/run.log" | head -8 | sed 's/^/    /'
  echo
  [ "$got" = "$expect" ]
}

base=$(mktemp -d)
ok=0

echo "=========== 1. UNFIXED — the spec must fail, naming what is wrong"
fresh "$base/unfixed" || exit 3
run "$base/unfixed" "unfixed slice" fail || ok=1

echo "=========== 2. FIX A ONLY — must still FAIL (B and C are enforced)"
fresh "$base/a" || exit 3
patch "$base/a" "$HERE/fix-a-ledger.py"
run "$base/a" "ledger fixed, signals and claims not" fail || ok=1

echo "=========== 3. FIXES A AND B — must still FAIL (C is enforced)"
fresh "$base/ab" || exit 3
patch "$base/ab" "$HERE/fix-a-ledger.py"
patch "$base/ab" "$HERE/fix-b-signals.py"
run "$base/ab" "ledger and signals fixed, claims not" fail || ok=1

echo "=========== 4. ALL THREE FIXES — must PASS (satisfiable)"
fresh "$base/abc" || exit 3
patch "$base/abc" "$HERE/fix-a-ledger.py"
patch "$base/abc" "$HERE/fix-b-signals.py"
patch "$base/abc" "$HERE/fix-c-claims.py"
run "$base/abc" "all three fixed" pass || ok=1

echo "REPOSITORY UNTOUCHED: $(cd "$REPO" && git status --porcelain -- $SLICE | wc -l) modification(s) to the slice in git."
if [ "$ok" -eq 0 ]; then
  echo "ALL FOUR AS REQUIRED — the contract is honest, enforcing, and satisfiable."
else
  echo "AT LEAST ONE SCENARIO WRONG — fix the contract before any spend. Logs under $base"
fi
exit "$ok"
