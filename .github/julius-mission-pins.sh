#!/usr/bin/env bash
# A FROZEN MISSION STAYS FROZEN, proven on the host that runs it.
#
# A paid run of a frozen mission must run the mission that was frozen — not a contract, a seed or a
# sliced source that drifted after the freeze. `.github/julius-mission-pins.txt` names, per mission,
# the git object id each path must have. This refuses unless every pinned path has exactly that id
# at the revision being sliced AND the working tree agrees with that revision, because the contract
# and the seed overlay are read from disk rather than from git. A mission with no pins passes.
#
# Called by .github/julius-live-workspace.sh BEFORE anything is mounted or built, so a drifted
# mission costs a refusal and never a provisioned rig — on the hosted runner and on a local rig alike.
#
#   usage: julius-mission-pins.sh <mission> <repository dir> <revision>
#   JULIUS_MISSION_PINS_FILE overrides the pins file (tests only).
set -euo pipefail
MISSION=${1:?mission}; REPO=${2:?repository dir}; REV=${3:?revision}
PINS=${JULIUS_MISSION_PINS_FILE:-$REPO/.github/julius-mission-pins.txt}
[ -f "$PINS" ] || { echo "mission_pins_file_missing: $PINS" >&2; exit 1; }
git -C "$REPO" rev-parse --verify --quiet "$REV^{commit}" >/dev/null || { echo "mission_pins_revision_unknown: $REV" >&2; exit 1; }

count=0
while read -r name path want _rest || [ -n "${name:-}" ]; do
  case "${name:-}" in ''|'#'*) continue ;; esac
  [ "$name" = "$MISSION" ] || continue
  [ -n "${path:-}" ] && [ -n "${want:-}" ] || { echo "mission_pin_malformed: $name" >&2; exit 1; }
  got=$(git -C "$REPO" rev-parse --verify --quiet "$REV:$path") || got=missing
  if [ "$got" != "$want" ]; then
    echo "mission_pin_mismatch: $MISSION $path is $got at $REV, frozen as $want" >&2; exit 1
  fi
  if ! git -C "$REPO" diff --quiet "$REV" -- "$path" \
    || [ -n "$(git -C "$REPO" status --porcelain --untracked-files=all -- "$path")" ]; then
    echo "mission_pin_working_tree_drift: $MISSION $path on disk differs from $REV" >&2; exit 1
  fi
  count=$((count + 1))
done < "$PINS"
echo "mission_pins_verified=$count mission=$MISSION revision=$(git -C "$REPO" rev-parse "$REV^{commit}")"
