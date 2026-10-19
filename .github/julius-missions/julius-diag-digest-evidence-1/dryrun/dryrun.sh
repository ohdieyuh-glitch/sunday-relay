#!/usr/bin/env bash
# DIAGNOSTIC MISSION DRY RUN, ZERO SPEND, NO PROVIDER, NO NETWORK. Generic: the mission's own `dryrun/scenarios.txt` says what to run.
#
# Questions a paid run must never be the first to ask:
#   1. does the seeded specification FAIL today, and for the RIGHT reasons?
#   2. can PARTIAL fixes pass it? Every fix applied alone, and every proper subset, must still FAIL: the specification must enforce each fix.
#   3. is it SATISFIABLE: do the correct, minimal fixes together make it pass?
#   4. TYPECHECK (added after a Codex finding on PR #377: an "advertised alternative" used String.prototype.toWellFormed, ES2024, while the repository's lib is ES2022): a fix the
#      seeded spec accepts must ALSO typecheck against the repository's own compiler settings, or it is not a valid solution. The editable slice files of every scenario are checked
#      with the repository's tsc (target ES2022, lib ES2022 + DOM) and only NEW diagnostics against the unfixed slice count (a slice has missing type-only imports of its own).
#
# Every fix below exists only in a throwaway workspace built from the mission's slice list. None reaches the repository: producing it is the Coding Agent's
# work, and the last line checks that git still sees the slice unmodified. A patch that fails to apply KILLS the run (exit 3).
#
# scenarios.txt: one scenario per line, `label|expect|fix-a.py,fix-b.py` (fixes may be empty); `#` lines are comments. expect is one of
#   pass                the spec passes AND the patched slice files add no type error (a VALID solution)
#   fail                the spec fails (typecheck is not evaluated)
#   passspec_typered    the spec passes BUT the patched slice files add a type error (a reviewer-visible case that is NOT a valid solution)
# DRYRUN_TYPECHECK=0 skips the typecheck (then `pass` means the spec only and passspec_typered scenarios are reported as skipped).
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
M=$(cd "$HERE/.." && pwd)
REPO=${REPO:-$(cd "$HERE/../../../.." && pwd)}
SPEC=$(sed -n 's/^# SPEC: //p' "$M/slice.txt" | head -1)
TESTCMD=$(python -c "import json,sys;print(json.load(open(sys.argv[1],encoding='utf8'))['testCommand'])" "$M/contract.json")
SLICE=$(grep -v '^#' "$M/slice.txt" | grep -v '^$')
TC=${DRYRUN_TYPECHECK:-1}
TSC="$REPO/node_modules/typescript/bin/tsc"
REPO_W=$(cygpath -m "$REPO" 2>/dev/null || echo "$REPO")   # the tsconfig is read by Windows Node: it needs a Windows-style path

[ -n "$SPEC" ] || { echo "slice.txt has no '# SPEC: <path>' line"; exit 2; }
for f in "$M/seed/$SPEC" "$M/dryrun/scenarios.txt" "$REPO/.github/julius-mission-slice/loader.mjs"; do [ -f "$f" ] || { echo "MISSING INPUT: $f"; exit 2; }; done
for f in $SLICE; do [ -f "$REPO/$f" ] || { echo "MISSING INPUT: $f"; exit 2; }; done
if [ "$TC" = 1 ] && [ ! -f "$TSC" ]; then echo "MISSING INPUT: $TSC (set DRYRUN_TYPECHECK=0 to skip the typecheck)"; exit 2; fi

fresh() { # fresh <dir>
  mkdir -p "$1/.julius" || return 1
  for f in $SLICE; do mkdir -p "$1/$(dirname "$f")" && cp "$REPO/$f" "$1/$f" || return 1; done
  mkdir -p "$1/$(dirname "$SPEC")" && cp "$M/seed/$SPEC" "$1/$SPEC" || return 1
  cp "$REPO/.github/julius-mission-slice/loader.mjs" "$REPO/.github/julius-mission-slice/resolve.mjs" "$1/.julius/" || return 1
}

# The slice's TypeScript files (not the spec): what a coder edits and what the repository compiles.
slice_ts() { for f in $SLICE; do case "$f" in *.ts) echo "$f" ;; esac; done; }

# typecheck <dir> -> writes <dir>/tsc.diag: one line per diagnostic, "file CODE message" WITHOUT line numbers (a patch moves lines), sorted.
typecheck() {
  local dir="$1"
  local files; files=$(slice_ts | sed 's/.*/"&"/' | paste -sd, -)
  cat > "$dir/tsconfig.slice.json" <<EOF
{
  "extends": "$REPO_W/tsconfig.json",
  "compilerOptions": { "noEmit": true, "typeRoots": ["$REPO_W/node_modules/@types"], "baseUrl": "." },
  "include": [],
  "files": [$files]
}
EOF
  # tsc exits 0 (clean) or non-zero WITH `error TS` lines (diagnostics). A non-zero exit WITHOUT any `error TS` line (killed at the heap cap, a crash) means the slice was NOT checked:
  # that is an instrument failure and must never read as "clean" (returns 1; the caller fails the scenario).
  local rc=0
  ( cd "$dir" && node --max-old-space-size=1536 "$TSC" -p tsconfig.slice.json --pretty false > tsc.raw 2>&1 ) || rc=$?
  sed -E 's/\([0-9]+,[0-9]+\)//' "$dir/tsc.raw" | grep -E "error TS[0-9]+" | sort > "$dir/tsc.diag"
  if [ "$rc" -ne 0 ] && [ ! -s "$dir/tsc.diag" ]; then
    echo "    TYPECHECK INSTRUMENT FAILURE (node/tsc exit $rc, no error TS line): the slice was not checked" >&2
    return 1
  fi
}

# new_type_errors <baseline dir> <dir> -> prints the diagnostics present in <dir> beyond the baseline (multiset difference)
new_type_errors() { comm -13 "$1/tsc.diag" "$2/tsc.diag"; }

run() { # run <dir> <label> <expect>
  local dir="$1" label="$2" expect="$3"
  # THE TEST COMMAND IS THE CONTRACT'S, run as written (the entry stays a literal on one line, as relay-repository-boundary.mjs requires).
  ( cd "$dir" && bash -c "$TESTCMD" > run.log 2>&1 )
  local code=$?
  local got; [ "$code" -eq 0 ] && got=pass || got=fail
  local tcstate="skipped" newerr=""
  if [ "$TC" = 1 ] && [ "$got" = pass ]; then
    if typecheck "$dir"; then
      newerr=$(new_type_errors "$base/baseline" "$dir")
      if [ -z "$newerr" ]; then tcstate=clean; else tcstate=RED; fi
    else tcstate=FAILED; fi
  fi
  local verdict
  case "$expect" in
    pass) if [ "$got" = pass ] && { [ "$tcstate" = clean ] || [ "$tcstate" = skipped ]; }; then verdict=ok; else verdict=bad; fi ;;
    fail) [ "$got" = fail ] && verdict=ok || verdict=bad ;;
    passspec_typered) if [ "$got" = pass ] && [ "$tcstate" = RED ]; then verdict=ok; elif [ "$tcstate" = skipped ] && [ "$got" = pass ]; then verdict=ok; else verdict=bad; fi ;;
    *) verdict=bad ;;
  esac
  printf '%-58s exit %d  %s  typecheck %s' "$label" "$code" "$got" "$tcstate"
  [ "$verdict" = ok ] && echo "  AS REQUIRED" || echo "  *** EXPECTED $expect ***"
  grep -E "^# (tests|pass|fail)" "$dir/run.log" | tr '\n' ' '; echo
  grep -E "^not ok|^    not ok" "$dir/run.log" | head -12 | sed 's/^/    /'
  [ -n "$newerr" ] && echo "$newerr" | head -6 | sed 's/^/    TYPE: /'
  echo
  [ "$verdict" = ok ]
}

base=$(mktemp -d)
ok=0
n=0
if [ "$TC" = 1 ]; then
  fresh "$base/baseline" || { echo "COULD NOT BUILD THE BASELINE WORKSPACE"; exit 2; }
  typecheck "$base/baseline" || { echo "THE BASELINE TYPECHECK DID NOT COMPLETE: no scenario can be judged against it"; exit 2; }
  echo "typecheck baseline (the unfixed slice): $(wc -l < "$base/baseline/tsc.diag" | tr -d ' ') pre-existing diagnostic(s), ignored"
fi
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
