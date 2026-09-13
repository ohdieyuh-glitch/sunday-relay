#!/usr/bin/env bash
# THE MISSION 6 TEST COMMAND, RUN WHERE A PAID RUN WILL RUN IT.
#
# Mission 6's specifications drive Julius's real kernel, whose run loop, router
# and execution coordinator use TypeScript parameter properties. Node's plain
# type stripping refuses those, so the contract's test command passes
# `--experimental-transform-types`. The paid rig builds its sandbox `FROM
# node:22-bookworm-slim` with no digest (`.github/julius-live-images.sh`), so the
# Node that runs this mission floats with that tag. If a 22.x ever renamed or
# dropped the flag, the mission would fail for a reason that has nothing to do
# with Julius. This script is the check: it provisions the workspace the way
# `.github/julius-live-workspace.sh` provisions a slice, then runs, inside that
# image with no network, `node --version` and the contract's own test command
# read from `contract.json`, never retyped here.
#
# EXPECTED against the committed stub: the existing specification passes, the
# new one fails, so the contract's command exits non-zero. Anything else is a
# finding. Run from the repository root:
#
#   bash scripts/julius-live-mission-6-sandbox-proof.sh
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MISSION_DIR="$ROOT/.github/julius-missions/julius-live-mission-6"
IMAGE=node:22-bookworm-slim

command -v docker > /dev/null || { echo 'sandbox_proof_needs_docker' >&2; exit 2; }

WS=$(mktemp -d)
trap 'rm -rf "$WS"' EXIT

mapfile -t paths < <(sed -e 's/#.*$//' -e 's/[[:space:]]*$//' "$MISSION_DIR/slice.txt" | sed '/^$/d')
for path in "${paths[@]}"; do
  git -C "$ROOT" ls-files --error-unmatch -- "$path" > /dev/null 2>&1 || { echo "sandbox_proof_untracked_slice_path: $path" >&2; exit 1; }
  mkdir -p "$WS/$(dirname "$path")"
  cp "$ROOT/$path" "$WS/$path"
done
cp -R "$MISSION_DIR/seed/." "$WS/"
mkdir -p "$WS/.julius"
cp "$ROOT/.github/julius-mission-slice/resolve.mjs" "$ROOT/.github/julius-mission-slice/loader.mjs" "$WS/.julius/"

TEST_COMMAND=$(node -e "process.stdout.write(JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8')).testCommand)" "$MISSION_DIR/contract.json")
EXISTING_ONLY=$(printf '%s' "$TEST_COMMAND" | sed 's/ src\/relay\/mission\/julius\/julius-learning-loop.test.ts$//')

# A Windows host hands Docker a Windows path; everywhere else the path is already right.
MOUNT="$WS"
if command -v cygpath > /dev/null; then MOUNT=$(cygpath -w "$WS"); fi

run_in_sandbox() {
  MSYS_NO_PATHCONV=1 docker run --rm --network none -v "$MOUNT:/ws" -w /ws "$IMAGE" sh -c "$1"
}

docker pull -q "$IMAGE" > /dev/null
echo "image: $IMAGE ($(docker image inspect --format '{{index .RepoDigests 0}}' "$IMAGE"))"
echo "node: $(run_in_sandbox 'node --version')"

summary() { grep -E '^# (tests|pass|fail) ' | tr '\n' ' '; }

set +e
existing=$(run_in_sandbox "$EXISTING_ONLY" 2>&1); existing_code=$?
full=$(run_in_sandbox "$TEST_COMMAND" 2>&1); full_code=$?
set -e
echo "existing specification alone: exit=$existing_code $(printf '%s\n' "$existing" | summary)"
echo "contract test command:        exit=$full_code $(printf '%s\n' "$full" | summary)"
if printf '%s\n' "$full" | grep -q 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX\|bad option'; then
  echo 'RESULT: FAILED — this Node refuses the flag or the kernel syntax' >&2; exit 1
fi
[ "$existing_code" -eq 0 ] || { echo 'RESULT: FAILED — the existing specification does not pass against the committed slice' >&2; exit 1; }
[ "$full_code" -ne 0 ] || { echo 'RESULT: FAILED — the contract command passes against the stub, so completion would be free' >&2; exit 1; }
echo 'RESULT: the sandbox image runs the kernel under the contract flag; existing green, new red against the stub'
