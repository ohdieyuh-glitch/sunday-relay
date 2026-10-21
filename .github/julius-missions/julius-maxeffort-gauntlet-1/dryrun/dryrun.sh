#!/usr/bin/env bash
# DIAGNOSTIC MISSION DRY RUN, ZERO SPEND, NO PROVIDER, NO NETWORK. Generic: the mission's own `dryrun/scenarios.txt` says what to run.
#
# Questions a paid run must never be the first to ask:
#   1. does the seeded specification FAIL today, and for the RIGHT reasons?
#   2. can PARTIAL fixes pass it? Every fix applied alone, and every proper subset, must still FAIL: the specification must enforce each fix.
#   3. is it SATISFIABLE: do the correct, minimal fixes together make it pass?
#
# Every fix below exists only in a throwaway workspace built from the mission's slice list. None reaches the repository: producing it is the Coding Agent's
# work, and the last line checks that git still sees the slice unmodified. A patch that fails to apply KILLS the run (exit 3).
#
# scenarios.txt: one scenario per line, `label|expect|fix-a.py,fix-b.py` (expect = pass or fail; fixes may be empty); `#` lines are comments.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
M=$(cd "$HERE/.." && pwd)
REPO=${REPO:-$(cd "$HERE/../../../.." && pwd)}
SPEC=$(sed -n 's/^# SPEC: //p' "$M/slice.txt" | head -1)
TESTCMD=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf8'))['testCommand'])" "$M/contract.json")
SLICE=$(grep -v '^#' "$M/slice.txt" | grep -v '^$')

[ -n "$SPEC" ] || { echo "slice.txt has no '# SPEC: <path>' line"; exit 2; }
for f in "$M/seed/$SPEC" "$M/dryrun/scenarios.txt" "$REPO/.github/julius-mission-slice/loader.mjs"; do [ -f "$f" ] || { echo "MISSING INPUT: $f"; exit 2; }; done
for f in $SLICE; do [ -f "$REPO/$f" ] || { echo "MISSING INPUT: $f"; exit 2; }; done

fresh() { # fresh <dir>
  mkdir -p "$1/.julius" || return 1
  for f in $SLICE; do mkdir -p "$1/$(dirname "$f")" && cp "$REPO/$f" "$1/$f" || return 1; done
  mkdir -p "$1/$(dirname "$SPEC")" && cp "$M/seed/$SPEC" "$1/$SPEC" || return 1
  cp "$REPO/.github/julius-mission-slice/loader.mjs" "$REPO/.github/julius-mission-slice/resolve.mjs" "$1/.julius/" || return 1
}

run() { # run <dir> <label> <expect>
  local dir="$1" label="$2" expect="$3"
  # THE TEST COMMAND IS THE CONTRACT'S, run as written (the entry stays a literal on one line, as relay-repository-boundary.mjs requires).
  ( cd "$dir" && bash -c "$TESTCMD" > run.log 2>&1 )
  local code=$?
  local got; [ "$code" -eq 0 ] && got=pass || got=fail
  printf '%-58s exit %d  %s' "$label" "$code" "$got"
  [ "$got" = "$expect" ] && echo "  AS REQUIRED" || echo "  *** EXPECTED $expect ***"
  grep -E "^# (tests|pass|fail)" "$dir/run.log" | tr '\n' ' '; echo
  grep -E "^not ok|^    not ok" "$dir/run.log" | head -12 | sed 's/^/    /'
  echo
  [ "$got" = "$expect" ]
}

base=$(mktemp -d)
ok=0
n=0
while IFS='|' read -r label expect fixes; do
  case "$label" in ''|'#'*) continue ;; esac
  n=$((n + 1))
  dir="$base/s$n"
  fresh "$dir" || { echo "COULD NOT BUILD THE WORKSPACE FOR: $label"; exit 2; }
  IFS=',' read -r -a list <<< "$fixes"
  for fix in "${list[@]}"; do
    [ -z "$fix" ] && continue
    ( cd "$dir" && python "$HERE/$fix" ) || { echo "PATCH FAILED TO APPLY: $fix — the scenario below would be meaningless"; exit 3; }
  done
  echo "=========== $n. $label (expect $expect)"
  run "$dir" "$label" "$expect" || ok=1
done < "$HERE/scenarios.txt"

echo "REPOSITORY UNTOUCHED: $(cd "$REPO" && git status --porcelain -- $SLICE | wc -l) modification(s) to the slice in git."
if [ "$ok" -eq 0 ]; then
  echo "EVERY SCENARIO AS REQUIRED — the contract is honest, enforcing, and satisfiable."
else
  echo "AT LEAST ONE SCENARIO WRONG — fix the contract before any spend. Logs under $base"
fi
exit "$ok"
