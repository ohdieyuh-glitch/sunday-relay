#!/usr/bin/env bash
# DIAGNOSTIC MISSION 2 (julius-diag-output-safety-1), DRY RUN, ZERO SPEND.
#
# Three questions a paid run must never be the first to ask:
#   1. does the seeded specification FAIL today, and for the RIGHT reason?
#   2. can a HALF fix (boundOutput made exact, the runner untouched) pass it? If yes, the specification does not enforce the
#      runner half of the work, and the independent reviewer would be the only thing between the mission and a green no-op.
#   3. is it SATISFIABLE: does a correct change (exact bound, per-stream decoders, redact first and bound second) make it pass?
#
# Every fix below exists only in a throwaway workspace. None reaches the repository: producing it is the Coding Agent's work, and
# the last line of this script checks that git still sees the slice unmodified. A patch that fails to apply KILLS the run (exit 3)
# instead of leaving the previous scenario's answer standing.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
M="$REPO/.github/julius-missions/julius-diag-output-safety-1"
SAN=src/relay/workspace/output-sanitizer.ts
RUN=src/relay/workspace/command-runner.ts
SPEC=src/relay/workspace/output-safety.test.ts
HALF="$HERE/half-fix-bound-only.py"
FULL="$HERE/full-fix-runner.py"

for f in "$HALF" "$FULL" "$M/seed/$SPEC" "$REPO/$SAN" "$REPO/$RUN" \
         "$REPO/.github/julius-mission-slice/loader.mjs"; do
  [ -f "$f" ] || { echo "MISSING INPUT: $f"; exit 2; }
done

fresh() { # fresh <dir>
  mkdir -p "$1/$(dirname "$SAN")" "$1/.julius" || return 1
  cp "$REPO/$SAN" "$1/$SAN" || return 1
  cp "$REPO/$RUN" "$1/$RUN" || return 1
  cp "$M/seed/$SPEC" "$1/$SPEC" || return 1
  cp "$REPO/.github/julius-mission-slice/loader.mjs" \
     "$REPO/.github/julius-mission-slice/resolve.mjs" "$1/.julius/" || return 1
}

patch() { # patch <dir> <script>   — a failure here ends the run
  ( cd "$1" && python "$2" ) \
    || { echo "PATCH FAILED TO APPLY: $2 — the scenario below would be meaningless"; exit 3; }
}

run() { # run <dir> <label> <expect pass|fail>
  local dir="$1" label="$2" expect="$3"
  # The entry is a LITERAL on ONE line (relay-repository-boundary.mjs refuses a node entry built at run time).
  ( cd "$dir" && node --import ./.julius/loader.mjs --test src/relay/workspace/output-safety.test.ts > run.log 2>&1 )
  local code=$?
  local got; [ "$code" -eq 0 ] && got=pass || got=fail
  printf '%-46s exit %d  %s' "$label" "$code" "$got"
  [ "$got" = "$expect" ] && echo "  AS REQUIRED" || echo "  *** EXPECTED $expect ***"
  grep -E "^# (tests|pass|fail)" "$dir/run.log" | tr '\n' ' '; echo
  grep -E "^not ok|^    not ok" "$dir/run.log" | head -8 | sed 's/^/    /'
  echo
  [ "$got" = "$expect" ]
}

base=$(mktemp -d)
ok=0

echo "=========== 1. UNFIXED — the spec must fail, naming what is wrong"
fresh "$base/unfixed" || exit 3
run "$base/unfixed" "unfixed slice" fail || ok=1

echo "=========== 2. HALF FIX — boundOutput exact, the runner untouched. Must still FAIL."
fresh "$base/half" || exit 3
patch "$base/half" "$HALF"
run "$base/half" "exact bound, runner untouched" fail || ok=1

echo "=========== 3. FULL FIX — exact bound AND decoders AND redact-then-bound"
fresh "$base/full" || exit 3
patch "$base/full" "$HALF"
patch "$base/full" "$FULL"
run "$base/full" "exact bound and corrected runner" pass || ok=1

echo "REPOSITORY UNTOUCHED: $(cd "$REPO" && git status --porcelain -- "$SAN" "$RUN" | wc -l) modification(s) to the slice in git."
if [ "$ok" -eq 0 ]; then
  echo "ALL THREE AS REQUIRED — the contract is honest, enforcing, and satisfiable."
else
  echo "AT LEAST ONE SCENARIO WRONG — fix the contract before any spend. Logs under $base"
fi
exit "$ok"
