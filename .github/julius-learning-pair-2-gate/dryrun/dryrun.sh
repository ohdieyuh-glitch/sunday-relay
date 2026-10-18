#!/usr/bin/env bash
# REGISTRATION 2 DESIGN GATE, ZERO SPEND. Protocol: DESIGN_GATE_PROTOCOL_AND_ACCEPTANCE_r1_20261018 (hashed before this file existed).
# Scenarios S1-S6 on throwaway copies of the seed workspace. No model, no network. Every patch step is checked.
set -uo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
M=$(cd "$HERE/../../julius-missions/julius-learning-pair-2-without-1" && pwd)
SEED="$M/workspace"
SPEC=src/relay/mission/julius/julius-accept-review-gate.hold-binding.test.ts
GATEF=src/relay/mission/julius/julius-accept-review-gate.ts
OUT=${1:-/tmp/pair2-gate}
rm -rf "$OUT"; mkdir -p "$OUT"
PY=${PYTHON:-python}
fresh() { rm -rf "$OUT/$1"; cp -R "$SEED" "$OUT/$1" || exit 2; }
runv() { ( cd "$OUT/$1" && node --import ./.julius/loader.mjs --test "$SPEC" >"$OUT/$1.v.out" 2>&1 ); echo $? >"$OUT/$1.v.rc"; cat "$OUT/$1.v.rc"; }
counts() { grep -E '^# (pass|fail) ' "$OUT/$1.v.out" | tr '\n' ' '; }
fail=0
expect() { # expect <label> <got> <want>
  if [ "$2" = "$3" ]; then echo "PASS $1 (got $2)"; else echo "DEVIATION $1: got [$2] want [$3]"; fail=1; fi
}
sha() { sha256sum "$1" | cut -d' ' -f1; }

SPEC_SHA=$(sha "$SEED/$SPEC")
echo "spec_sha256=$SPEC_SHA seed_gate_sha256=$(sha "$SEED/$GATEF")"

for pass in 1 2; do
  echo "=== run $pass ==="
  # S1 seed
  fresh s1; rc=$(runv s1); expect "S$pass.1 seed: V fails" "$rc" 1
  echo "   $(counts s1)"
  expect "S$pass.1 seed: only the new tests fail (6 fail, 5 pass)" "$(counts s1)" "# pass 5 # fail 6 "
  "$PY" -I "$HERE/integration_check.py" "$OUT/s1" >"$OUT/s1.i.out"; expect "S$pass.1 seed: I fails" "$?" 1
  # S2 half-fix gate + helper
  fresh s2; "$PY" -I "$HERE/patch_lib.py" "$OUT/s2" gate_and_helper || exit 2
  rc=$(runv s2); expect "S$pass.2 half-fix (gate+helper): V passes" "$rc" 0
  "$PY" -I "$HERE/integration_check.py" "$OUT/s2" >"$OUT/s2.i.out"; expect "S$pass.2 half-fix (gate+helper): I fails" "$?" 1
  # S3 half-fix pipeline only
  fresh s3; "$PY" -I "$HERE/patch_lib.py" "$OUT/s3" pipeline_inline_only || exit 2
  rc=$(runv s3); expect "S$pass.3 half-fix (pipeline inline only): V fails" "$rc" 1
  # S4 full fix
  fresh s4; "$PY" -I "$HERE/patch_lib.py" "$OUT/s4" gate_and_helper || exit 2; "$PY" -I "$HERE/patch_lib.py" "$OUT/s4" pipeline_with_helper || exit 2
  rc=$(runv s4); expect "S$pass.4 full fix: V passes" "$rc" 0
  echo "   $(counts s4)"
  "$PY" -I "$HERE/integration_check.py" "$OUT/s4" >"$OUT/s4.i.out"; expect "S$pass.4 full fix: I passes" "$?" 0
  # S5 full fix, then restore the seed gate: V must fail again
  cp "$SEED/$GATEF" "$OUT/s4/$GATEF"; rc=$(runv s4); expect "S$pass.5 full fix with the seed gate restored: V fails" "$rc" 1
  # S6 patches touch only the declared files; the spec is byte-identical in every scenario
  for d in s1 s2 s3 s4; do expect "S$pass.6 $d spec byte-identical" "$(sha "$OUT/$d/$SPEC")" "$SPEC_SHA"; done
  changed=$(cd "$OUT" && for d in s2 s4; do diff -rq "$SEED" "$d" | grep -v "\.v\.\|node_modules" ; done | sed 's#.* and ##' | sort -u | tr '\n' ' ')
  echo "   changed files (s2,s4): $changed"
done
# (a)-(d)
expect "(b) the workspace holds exactly one test file" "$(find "$SEED" -name '*.test.ts' | wc -l | tr -d ' ')" 1
expect "(d) workspace size under 4 MiB" "$([ "$(du -sb "$SEED" | cut -f1)" -lt 4194304 ] && echo yes)" yes
echo "workspace_bytes=$(du -sb "$SEED" | cut -f1)"
[ "$fail" = 0 ] && echo "DESIGN GATE: ALL EXPECTED RESULTS HELD" || echo "DESIGN GATE: DEVIATION(S) — the mission is revised and the WHOLE gate rerun"
exit $fail
