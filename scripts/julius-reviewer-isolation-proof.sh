#!/usr/bin/env bash
# THE PAID REVIEWER'S ISOLATION, PROVEN AGAINST THE PINNED HERMES OFF THE RUNNER.
#
# `.github/julius-live-hermes.sh` proves on every dispatch that the reviewer
# Hermes builds holds no tool. This script runs that same bootstrap, unmodified,
# in a disposable `node:22-bookworm-slim` container with a placeholder
# credential, and then runs it once more per mutation in
# `scripts/julius-reviewer-isolation-proof-mutations.mjs`. The unmodified
# bootstrap must pass. Each mutated one must be refused, for the reason the
# mutation names:
#
#   before-this-change     the heredoc the paid path wrote until now, restored
#                          verbatim (a deadline and nothing about tools), with
#                          the proof and its verdict left in place
#                          -> reviewer_holds_tools:...
#   without-kanban         the reviewer harness's own 23-name list
#                          -> reviewer_toolsets_enabled:kanban
#   without-safe-mode      the proof run without the flag the review passes
#                          -> reviewer_safe_mode_off
#
# The container needs the network for what the bootstrap itself fetches: the
# pinned Hermes source from github.com and its Python dependencies. The proof
# inside the bootstrap closes the network before Hermes starts, and no provider
# is ever contacted. Run from the repository root:
#
#   bash scripts/julius-reviewer-isolation-proof.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=node:22-bookworm-slim

command -v docker > /dev/null || { echo 'isolation_proof_needs_docker' >&2; exit 2; }

WS=$(mktemp -d)
trap 'rm -rf "$WS"' EXIT

# Exactly the files the bootstrap reads, plus the mutations, copied from the working tree.
for path in \
  .github/julius-live-hermes.sh \
  .github/julius-live-hermes-isolation/sitecustomize.py \
  scripts/julius-reviewer-isolation.mjs \
  scripts/julius-reviewer-deadline.mjs \
  scripts/julius-reviewer-isolation-proof-mutations.mjs; do
  mkdir -p "$WS/repo/$(dirname "$path")"
  cp "$ROOT/$path" "$WS/repo/$path"
done

cat > "$WS/cases.sh" <<'CASES'
set -uo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq > /dev/null && apt-get install -y -qq python3 python3-venv git > /dev/null

failures=0
run_case() { # name, expectation (PROVEN or a refusal prefix)
  local name=$1 expectation=$2
  rm -rf /work && cp -a /ws/repo /work && cd /work
  if [ "$expectation" != PROVEN ] && ! node scripts/julius-reviewer-isolation-proof-mutations.mjs apply "$name" < /dev/null; then
    echo "FAIL $name: the mutation did not apply"; failures=$((failures + 1)); return
  fi
  local log="/tmp/$name.log" evidence="/tmp/evidence-$name.txt"
  env -i PATH="$PATH" HOME=/root \
    HERMES_PROFILE_HOME="/tmp/profile-$name" HERMES_WRAPPER_DIR="/tmp/bin-$name" \
    HERMES_BOOTSTRAP_EVIDENCE="$evidence" XAI_API_KEY=proof-placeholder \
    HERMES_REQUEST_TIMEOUT_SECONDS=480 RELAY_HERMES_PROVIDER=xai RELAY_HERMES_MODEL=grok-build-0.1 \
    bash .github/julius-live-hermes.sh < /dev/null > "$log" 2>&1
  local code=$?
  if [ "$expectation" = PROVEN ]; then
    if [ "$code" -eq 0 ] && grep -q '^hermes_reviewer_isolation=PROVEN ' "$evidence"; then
      echo "PASS $name: $(grep '^hermes_reviewer_isolation=' "$evidence")"
    else
      echo "FAIL $name: exit $code"; tail -n 8 "$log"; failures=$((failures + 1))
    fi
  elif [ "$code" -ne 0 ] && grep -q "^$expectation" "$log" && grep -q '^hermes_reviewer_isolation_refused$' "$log"; then
    echo "PASS $name: refused, $(grep "^$expectation" "$log" | head -n 1)"
  else
    echo "FAIL $name: exit $code, expected a refusal starting $expectation"; tail -n 8 "$log"; failures=$((failures + 1))
  fi
}

run_case candidate PROVEN
cd /ws/repo
mutations=$(node scripts/julius-reviewer-isolation-proof-mutations.mjs list)
[ -n "$mutations" ] || { echo 'FAIL: no mutations listed'; exit 1; }
while IFS=$'\t' read -r name refusal; do
  run_case "$name" "$refusal"
done <<< "$mutations"
exit "$failures"
CASES

# A Windows host hands Docker a Windows path; everywhere else the path is already right.
MOUNT="$WS"
if command -v cygpath > /dev/null; then MOUNT=$(cygpath -w "$WS"); fi

docker pull -q "$IMAGE" > /dev/null
echo "image: $IMAGE ($(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE"))"
MSYS_NO_PATHCONV=1 docker run --rm -v "$MOUNT:/ws:ro" "$IMAGE" bash /ws/cases.sh
