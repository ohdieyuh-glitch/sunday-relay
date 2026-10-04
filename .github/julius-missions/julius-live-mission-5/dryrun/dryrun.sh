#!/usr/bin/env bash
# MISSION 5, DRY RUN, ZERO SPEND, on the RESTORED 2026-09-10 starting state (../DRIFT_REPAIR.md).
#
# Four questions a paid run must never be the first to ask:
#   0. is the workspace still byte for byte what all four 09-10 attempts were handed?
#   1. does the declared test FAIL on it, and for the RIGHT reason: the stub's
#      `context_integrity_not_implemented`, never a module that cannot load?
#   2. what does a HALF fix earn, with the integrity module implemented and NOTHING wired
#      into compileJuliusContext or createJuliusContextSnapshot? The answer is recorded,
#      not wished: the declared test PASSES it. REQ 12 INTEGRATION is enforced by the
#      Independent Reviewer, as the 09-10 plan review did, and by the scorers. Never by the test.
#   3. is it SATISFIABLE? A correct change must pass, with the no-claims path left byte for
#      byte as it was (REQ 13 BACKWARD COMPATIBILITY). "REQ n" counts the contract's requirements from 1.
#
# The donors for 2 and 3 are #288's own code (c833e268), read from git history, so this
# needs a checkout holding that commit. Nothing built here reaches the repository, and
# the last line checks that the mission tree is unmodified.
set -uo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
REPO=$(cd "$HERE/../../../.." && pwd)
M="$REPO/.github/julius-missions/julius-live-mission-5"
P=src/relay/mission/julius
DONOR=c833e2680a5480df6936bfa00fa1ebbca354ca42
WIRE="$HERE/full-fix-wire-qualified-path.py"

git -C "$REPO" cat-file -e "$DONOR^{commit}" 2>/dev/null || { echo "MISSING DONOR COMMIT $DONOR: run this in a full clone"; exit 2; }

# 0. THE HISTORICAL BYTES. All four 09-10 attempts (runs 34485676189, 34504244415,
# 34515588859, 34529874100) sliced exactly these blobs.
ok=0
while read -r want rel; do
  got=$(git hash-object "$M/workspace/$rel")
  if [ "$got" = "$want" ]; then echo "   = $rel"; else echo "   *** $rel is $got, not the 09-10 $want"; ok=1; fi
done <<'PINS'
7e09bf6d5c20b92672b921f76900a2d804a31994 src/relay/mission/julius/julius-context-integrity.ts
615a0d824c648992f40e60700bfb2b35c729e8ab src/relay/mission/julius/julius-runtime.ts
3b4b0a7ad75a969bb87d53ae39b5969c1bfb28da src/relay/mission/julius/julius-context-snapshot.ts
6b6e5628f2ffaa42a592d817d11782b187560eb7 src/relay/mission/julius/julius-memory-trust.ts
ff1ce20f7e102c98a53ca07d34f5f2286e5fd354 src/relay/mission/julius/julius-repair-lineage.ts
77dc2a44cb7145e1124b29e9ea4cf1e514aa97af src/relay/mission/julius/julius-context-integrity.test.ts
b811ab9107dbe59b25e0d92a84ff5ffd5e6c1ccd .julius/loader.mjs
c222c8c51867ffd31b66b6713dbcd11b92535fff .julius/resolve.mjs
PINS
[ "$ok" -eq 0 ] || { echo "THE WORKSPACE IS NOT THE 09-10 STATE: stop"; exit 3; }

fresh() { mkdir -p "$1" && cp -R "$M/workspace/." "$1/"; }
donor() { git -C "$REPO" show "$DONOR:$P/$1" > "$2/$P/$1" || { echo "DONOR READ FAILED: $1"; exit 3; }; }

run() { # run <dir> <label> <expect pass|fail>
  local dir="$1" label="$2" expect="$3"
  # The entry is a literal, on one line, for relay-repository-boundary.mjs (see Mission 6's dryrun.sh).
  ( cd "$dir" && node --import ./.julius/loader.mjs --test src/relay/mission/julius/julius-context-integrity.test.ts > run.log 2>&1 )
  local code=$?
  local got; [ "$code" -eq 0 ] && got=pass || got=fail
  printf '%-58s exit %d  %s' "$label" "$code" "$got"
  [ "$got" = "$expect" ] && echo "  AS RECORDED" || echo "  *** EXPECTED $expect ***"
  grep -E "^# (tests|pass|fail)" "$dir/run.log" | tr '\n' ' '; echo
  [ "$got" = "$expect" ]
}

base=$(mktemp -d)

echo "=========== 1. UNFIXED: the restored stub must fail, by its own refusal"
fresh "$base/unfixed" || exit 3
run "$base/unfixed" "restored 09-10 workspace" fail || ok=1
reason=$(grep -c "context_integrity_not_implemented" "$base/unfixed/run.log")
broken=$(grep -cE "ERR_MODULE_NOT_FOUND|does not provide an export|SyntaxError" "$base/unfixed/run.log")
echo "   failures naming context_integrity_not_implemented: $reason; load errors: $broken"
{ [ "$reason" -gt 0 ] && [ "$broken" -eq 0 ]; } || { echo "   *** RED FOR THE WRONG REASON"; ok=1; }

echo "=========== 2. HALF FIX: the module implemented (#288's), NOTHING wired. Recorded: it PASSES."
fresh "$base/half" || exit 3
donor julius-context-integrity.ts "$base/half"
run "$base/half" "module implemented, runtime and snapshot untouched" pass || ok=1
echo "   => REQ 12 INTEGRATION is NOT enforced by the declared test. The reviewer and the scorers must check it."

echo "=========== 3. FULL FIX: module + qualified path wired + snapshot records the decision"
fresh "$base/full" || exit 3
donor julius-context-integrity.ts "$base/full"
donor julius-context-snapshot.ts "$base/full"
git -C "$REPO" show "$DONOR:$P/julius-runtime.ts" > "$base/donor-runtime.ts" || exit 3
( cd "$base/full" && python "$WIRE" "$P/julius-runtime.ts" "$base/donor-runtime.ts" ) || { echo "PATCH FAILED TO APPLY: the scenario would be meaningless"; exit 3; }
kept=$(grep -c "if (used + sanitized.length > input.maxCharacters) break;" "$base/full/$P/julius-runtime.ts")
[ "$kept" -eq 1 ] || { echo "   *** the no-claims path was changed (REQ 13 BACKWARD COMPATIBILITY)"; ok=1; }
run "$base/full" "wired, no-claims path byte-identical to 09-10" pass || ok=1

echo "MISSION TREE UNTOUCHED: $(cd "$REPO" && git status --porcelain -- "$M" | wc -l) modification(s) in git."
if [ "$ok" -eq 0 ]; then
  echo "ALL AS RECORDED: the restored start is RED for the right reason and SATISFIABLE; REQ 12 INTEGRATION is reviewer-enforced."
else
  echo "AT LEAST ONE SCENARIO WRONG: fix the restoration before any spend. Logs under $base"
fi
exit "$ok"
