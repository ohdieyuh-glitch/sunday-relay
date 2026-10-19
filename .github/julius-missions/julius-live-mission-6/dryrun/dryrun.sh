#!/usr/bin/env bash
# MISSION 6, DRY RUN, ZERO SPEND.
#
# Three questions a paid run must never be the first to ask:
#   1. does the seeded specification FAIL today, and for the RIGHT reason?
#   2. can a HALF fix — both helpers exported, neither one called — pass it?
#      If yes, the spec does not enforce its own "a helper nobody calls is not a
#      fix" criterion on the Linux runner, and the Independent Reviewer is the
#      only thing standing between the mission and a green no-op.
#   3. is it SATISFIABLE — does a correct minimal change make it pass?
#
# Every fix below exists only in a throwaway workspace. None reaches the
# repository: producing it is the Coding Agent's work, and the last line of this
# script checks that git still sees the slice unmodified.
#
# A PATCH THAT FAILS TO APPLY MUST KILL THE RUN, not quietly leave the previous
# scenario's answer standing. The first version of this script used a relative
# `dirname $0` and then `cd`-ed into the workspace, so both python steps silently
# did not run — and scenario 2 reported "fail AS REQUIRED" for entirely the wrong
# reason. That is the same vacuous-pass shape this mission exists to punish, so
# every patch step is now checked and every path is absolute.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
M="$REPO/.github/julius-missions/julius-live-mission-6"
SLICE=src/relay/workspace/julius-tools/node-tool-adapter.ts
SPEC=src/relay/workspace/julius-tools/node-tool-search-paths.test.ts
HELPERS="$HERE/half-fix-helpers-only.py"
WIRE="$HERE/full-fix-wire-call-sites.py"

for f in "$HELPERS" "$WIRE" "$M/seed/$SPEC" "$REPO/$SLICE" \
         "$REPO/.github/julius-mission-slice/loader.mjs"; do
  [ -f "$f" ] || { echo "MISSING INPUT: $f"; exit 2; }
done

fresh() { # fresh <dir>
  mkdir -p "$1/$(dirname "$SLICE")" "$1/.julius" || return 1
  cp "$REPO/$SLICE" "$1/$SLICE" || return 1
  cp "$M/seed/$SPEC" "$1/$SPEC" || return 1
  cp "$REPO/.github/julius-mission-slice/loader.mjs" \
     "$REPO/.github/julius-mission-slice/resolve.mjs" "$1/.julius/" || return 1
}

patch() { # patch <dir> <script>   — a failure here ends the run
  ( cd "$1" && python "$2" "$SLICE" ) \
    || { echo "PATCH FAILED TO APPLY: $2 — the scenario below would be meaningless"; exit 3; }
}

run() { # run <dir> <label> <expect pass|fail>
  local dir="$1" label="$2" expect="$3"
  # THE ENTRY IS A LITERAL, and `relay-repository-boundary.mjs` is why. It refused
  # an earlier version of this line for giving `node` a path built at run time
  # (`--test "$SPEC"`): a deployment-capable path whose entry is a variable cannot
  # be read, so neither the file nor the commands inside it can be audited. The
  # rule is correct and the variable bought nothing, since $SPEC was a constant.
  # It is also all on ONE line: a `\` continuation makes the scan read the token
  # after `--test` as `\` and refuse it as a path above the repository.
  ( cd "$dir" && node --import ./.julius/loader.mjs --test src/relay/workspace/julius-tools/node-tool-search-paths.test.ts > run.log 2>&1 )
  local code=$?
  local got; [ "$code" -eq 0 ] && got=pass || got=fail
  printf '%-42s exit %d  %s' "$label" "$code" "$got"
  [ "$got" = "$expect" ] && echo "  AS REQUIRED" || echo "  *** EXPECTED $expect ***"
  grep -E "^# (tests|pass|fail)" "$dir/run.log" | tr '\n' ' '; echo
  grep -E "does not provide an export|backslash needle matched nothing|emitted a host-separated" \
    "$dir/run.log" | head -2 | sed 's/^/    /'
  echo
  [ "$got" = "$expect" ]
}

base=$(mktemp -d)
ok=0

echo "=========== 1. UNFIXED — the spec must fail, naming what is missing"
fresh "$base/unfixed" || exit 3
run "$base/unfixed" "unfixed slice" fail || ok=1

echo "=========== 2. HALF FIX — helpers exported, NOTHING wired. Must still FAIL."
fresh "$base/half" || exit 3
patch "$base/half" "$HELPERS"
run "$base/half" "helpers exported, call sites untouched" fail || ok=1

echo "=========== 3. FULL FIX — helpers exported AND all three call sites wired"
fresh "$base/full" || exit 3
patch "$base/full" "$HELPERS"
patch "$base/full" "$WIRE"
run "$base/full" "helpers exported and wired" pass || ok=1

echo "REPOSITORY UNTOUCHED: $(cd "$REPO" && git status --porcelain -- "$SLICE" | wc -l) modification(s) to the slice in git."
if [ "$ok" -eq 0 ]; then
  echo "ALL THREE AS REQUIRED — the contract is honest, enforcing, and satisfiable."
else
  echo "AT LEAST ONE SCENARIO WRONG — fix the contract before any spend. Logs under $base"
fi
exit "$ok"
