#!/usr/bin/env bash
# Offline regression test for wonderland-gcp.sh, using a stubbed gcloud.
#
# WHY. Every gcloud-present code path in the provider — the quota parsing, the
# filter syntax, the paid boundary, the secret hygiene — would otherwise first
# execute against a real billed project, in front of someone waiting. A stub
# that answers like a healthy project, and can be told to answer like an
# unhealthy one, exercises all of it for nothing.
#
# The point is NOT that preflight passes. It is that each gate can FAIL. A check
# incapable of failing is worse than no check, which this session has now proven
# three separate times.
# NO pipefail here, deliberately. Several assertions are of the form
#   cmd 2>&1 | grep -q PATTERN
# where cmd is EXPECTED to exit non-zero (a blocked preflight) and the thing
# under test is whether the message appeared. With pipefail the pipeline returns
# cmd's status, so those assertions silently test the wrong thing — which is how
# this file first reported three failures against a script that was correct.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="$HERE/mockbin-tmp:$PATH"
mkdir -p "$HERE/mockbin-tmp"; cp "$HERE/mock-gcloud" "$HERE/mockbin-tmp/gcloud"; chmod +x "$HERE/mockbin-tmp/gcloud"
trap 'rm -rf "$HERE/mockbin-tmp"' EXIT
P=0; F=0
ok()  { printf '  [pass] %s\n' "$*"; P=$((P+1)); }
no()  { printf '  [FAIL] %s\n' "$*"; F=$((F+1)); }
GCP="$HERE/wonderland-gcp.sh"

GCP_PROJECT_ID=demo "$GCP" preflight >/dev/null 2>&1 \
  && ok "healthy project -> preflight clear" || no "healthy project should pass preflight"

for f in auth billing api gquota rquota accel ceiling; do
  MOCK_FAIL=$f GCP_PROJECT_ID=demo "$GCP" preflight >/dev/null 2>&1
  [ $? -ne 0 ] && ok "gate fires: $f" || no "gate DOES NOT fire: $f — this check cannot fail"
done

GCP_PROJECT_ID=demo GCP_GPU_COUNT=4 "$GCP" preflight 2>&1 | grep -q "refusing to plan a multi-GPU" \
  && ok "multi-GPU refused" || no "multi-GPU NOT refused"

MOCK_FAIL=rquota GCP_PROJECT_ID=demo "$GCP" create >/dev/null 2>&1
[ $? -ne 0 ] && ok "create refuses when preflight is blocked" || no "create emitted a command despite a blocked preflight"

GCP_PROJECT_ID=demo "$GCP" create 2>&1 | grep -q '^gcloud compute instances create' \
  && ok "create emits a command when preflight is clear" || no "create emitted nothing"

GCP_PROJECT_ID=demo GCP_PROVISIONING_MODEL=SPOT "$GCP" create 2>&1 | grep -q 'provisioning-model=SPOT' \
  && ok "SPOT reaches the command" || no "SPOT did not reach the command"

out="$(GCP_PROJECT_ID=demo GHCR_PAT=SUPERSECRET123 WONDERLAND_REPO_URL=https://tok123@x/y "$GCP" create 2>&1)"
printf '%s' "$out" | grep -q 'SUPERSECRET123\|tok123' \
  && no "A SECRET VALUE APPEARED IN THE OUTPUT" || ok "no secret value in create output"

"$GCP" bogus >/dev/null 2>&1
[ $? -ne 0 ] && ok "unknown subcommand exits non-zero" || no "unknown subcommand reported success"

printf '\n%d passed, %d failed\n' "$P" "$F"
[ "$F" -eq 0 ]
