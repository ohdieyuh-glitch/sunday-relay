#!/usr/bin/env bash
# Provisions the disposable mission workspace for ONE bounded live Julius
# mission, whichever mission that is.
#
# GENERIC MECHANISM, MISSION-SUPPLIED CONTENTS. The tmpfs, the enforceable
# ceiling, the git repository, the ownership dance and the outputs below are
# infrastructure and are identical for every mission. What differs is only the
# seed tree, which is copied from `$JULIUS_MISSION_DIR/workspace`. This used to
# embed the first mission's four files as heredocs, which meant a second
# mission could not exist without a second copy of all of the reasoning below.
#
# WHY A THROWAWAY REPOSITORY AND NOT THIS CHECKOUT. The executor bind-mounts
# the workspace into a sandbox and refuses any workspace whose BACKING
# FILESYSTEM is larger than the declared ceiling
# (`assertEnforceableWorkspaceCeiling`), which for the live composition is
# `BETA_WORKSPACE_BYTES` = 4 MiB. A repository checkout on the runner's root
# filesystem measures tens of gigabytes and is refused outright, and the
# sandbox has no network with which to install anything. So the mission gets
# its own 4 MiB tmpfs holding a four-file git repository: small enough to be
# bounded, real enough to diff, and disposable enough that a mistake by a live
# coding agent costs nothing.
#
# WHY THE DELIVERABLES ARE SEEDED AND TRACKED, NOT CREATED. Two constraints
# that are easy to miss until a paid run fails on them:
#   - the hosted coding agent is allowed `Read/Glob/Grep/Edit` and is expressly
#     DENIED `Write` (`relay-bridge/hosted-coding-agent/hosted-envelope.ts`), so
#     it cannot bring a new file into existence at all;
#   - `git diff` — which is how the mission captures the change for the
#     Independent Reviewer — never reports an untracked file, so even a created
#     file would reach the reviewer as zero bytes.
# Both disappear if the deliverables already exist and are committed: the agent
# EDITS them, and the diff is real. The stubs below are deliberately failing, so
# the declared test command cannot pass until the work is actually done.
#
# OWNERSHIP. Commands inside the sandbox run as uid 65532, so git refuses a
# repository owned by anyone else ("dubious ownership") and the coder's diff
# would come back empty. The workspace is therefore handed to 65532 — and then
# made group/other writable, because the coding agent edits these files from the
# HOST as the runner user, which is a different uid. The ANCESTORS deliberately
# stay 0755 and owned by the runner: `assertUnrenameableAncestry` refuses a
# parent that is group/other-writable or owned by 65532, so the workspace cannot
# be renamed out from under its own mount.
set -euo pipefail

# WHICH MISSION. Declared by the caller; never guessed. An unset or unreadable
# mission directory is a refusal, not a fallback to the first mission — seeding
# the wrong workspace would hand a live coding agent the wrong task and the
# diff would look perfectly legitimate.
MISSION_DIR=${JULIUS_MISSION_DIR:?missing JULIUS_MISSION_DIR}
[ -d "$MISSION_DIR" ] || { echo "mission_dir_missing: $MISSION_DIR" >&2; exit 1; }
# ABSOLUTE, AND RESOLVED HERE. Callers pass a repository-relative path, and this
# script later `cd`s into the workspace — so a relative seed path would be
# resolved against the empty tmpfs and every mission would fail provisioning
# with `mission_workspace_seed_missing`. Resolving before the `cd` is what makes
# the order of the rest of this file irrelevant.
MISSION_DIR=$(cd "$MISSION_DIR" && pwd)
MISSION_NAME=$(basename "$MISSION_DIR")
SEED_DIR="$MISSION_DIR/workspace"
# WHERE THE REPOSITORY IS, captured before the `cd` into the empty tmpfs. Slice
# mode reads the repository through git, and `git -C` needs a path that is still
# meaningful after this script has changed directory.
GITHUB_WORKSPACE_DIR=$(cd "${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}" && pwd)

# A FROZEN MISSION IS PROVEN FROZEN BEFORE ANYTHING IS BUILT FOR IT. The pins name the git object
# id of the mission, its sliced source and its harness at the revision being sliced; a mismatch or a
# working tree that disagrees is refused here, before the mount, the images or any credential, so a
# drifted mission costs a refusal and never a paid run. An unlisted mission is not frozen and passes.
( cd "$GITHUB_WORKSPACE_DIR" && bash .github/julius-mission-pins.sh "$MISSION_NAME" . "${JULIUS_SLICE_REV:-HEAD}" )

FLEET_ROOT=${JULIUS_FLEET_ROOT:-/tmp/julius-workspace}
TENANT=${JULIUS_TENANT_ID:-tenant}
WORKSPACE="$FLEET_ROOT/$TENANT/ws"
SANDBOX_UID=65532

# Must equal BETA_WORKSPACE_BYTES and the options `tmpfsOptionsFor` derives, or
# the executor refuses the mount as an unenforceable ceiling.
WORKSPACE_BYTES=4194304
TMPFS_OPTIONS="size=${WORKSPACE_BYTES},nr_inodes=$((WORKSPACE_BYTES / 1024)),mode=0777,nosuid,nodev"

mkdir -p "$FLEET_ROOT/$TENANT"
chmod 0755 "$FLEET_ROOT" "$FLEET_ROOT/$TENANT"
mkdir -p "$WORKSPACE"

if ! mountpoint -q "$WORKSPACE"; then
  sudo mount -t tmpfs -o "$TMPFS_OPTIONS" tmpfs "$WORKSPACE"
fi

# Prove the ceiling is real before anything depends on it: the executor's own
# check is `total > workspaceBytes → refuse`, so a silently-unmounted tmpfs
# would surface as a confusing sandbox failure much later.
backing=$(df -B1 --output=size "$WORKSPACE" | tail -n 1 | tr -d ' ')
if [ "$backing" -gt "$WORKSPACE_BYTES" ]; then
  echo "workspace_ceiling_unenforceable: backing filesystem is ${backing} bytes, ceiling is ${WORKSPACE_BYTES}" >&2
  exit 1
fi

cd "$WORKSPACE"

# THE SEED TREE IS THE MISSION'S, AND MUST NOT BE EMPTY.
#
# WHY THE DELIVERABLES ARE SEEDED AND TRACKED, NOT CREATED. Two constraints
# that are easy to miss until a paid run fails on them:
#   - the hosted coding agent is allowed `Read/Glob/Grep/Edit` and is expressly
#     DENIED `Write` (`relay-bridge/hosted-coding-agent/hosted-envelope.ts`), so
#     it cannot bring a new file into existence at all;
#   - `git diff` — which is how the mission captures the change for the
#     Independent Reviewer — never reports an untracked file, so even a created
#     file would reach the reviewer as zero bytes.
# Both disappear if the deliverables already exist and are committed: the agent
# EDITS them, and the diff is real. Every mission's stubs are therefore
# deliberately failing, so the declared test command cannot pass until the work
# is actually done.
# TWO SEED KINDS, ONE MECHANISM. A mission either ships a throwaway tree
# (`workspace/`) or declares a SLICE of this repository (`slice.txt`). Exactly
# one of them, because a mission that declared both would have two answers to
# "what is the coder editing?" and the diff could not say which.
SLICE_FILE="$MISSION_DIR/slice.txt"
if [ -d "$SEED_DIR" ] && [ -f "$SLICE_FILE" ]; then
  echo "mission_seed_ambiguous: $MISSION_NAME declares both workspace/ and slice.txt" >&2; exit 1
fi

if [ -f "$SLICE_FILE" ]; then
  # ---------------------------------------------------------------- slice mode
  #
  # WHY A SLICE OF THIS REPOSITORY AT ALL. A mission that engineers Sunday Relay
  # has to edit Sunday Relay's own files, and the throwaway-tree seed cannot
  # express that: its files are invented for the mission and its diff applies to
  # nothing. A slice is the same files, byte for byte, so the diff a mission
  # produces is a PATCH AGAINST THIS REPOSITORY — which is what lets a worker
  # branch carry it into CI instead of a human re-typing the change.
  #
  # WHY IT IS STILL A THROWAWAY. The tmpfs, the 4 MiB ceiling, the fresh
  # `git init` and the teardown are unchanged. Julius gets real Relay source in a
  # disposable filesystem it may break; the canonical checkout is never mounted,
  # never written and never at risk. This is the sandbox rule in one sentence:
  # trusted SHA in, candidate diff out, nothing else touched.
  #
  # FROM A REVISION, NOT FROM THE WORKING TREE. `git archive` reads the named
  # commit, so a runner with a dirty tree cannot leak an uncommitted file into a
  # paid mission, and the slice is exactly what that SHA says it is.
  SLICE_REV=${JULIUS_SLICE_REV:-HEAD}
  slice_sha=$(git -C "$GITHUB_WORKSPACE_DIR" rev-parse --verify "$SLICE_REV^{commit}")

  # PATHS ARE DATA, AND THEY ARE CHECKED. Comments and blanks are dropped; an
  # absolute path, a `..` segment or a glob is refused rather than passed to
  # git, because the whole safety of this mode is that a mission can only name
  # paths inside the repository.
  paths=()
  while IFS= read -r line; do
    line=${line%%#*}; line=$(printf '%s' "$line" | tr -d '[:space:]')
    [ -n "$line" ] || continue
    case "$line" in
      /*|*..*|*'*'*|*'?'*|*'['*) echo "mission_slice_path_refused: $line" >&2; exit 1 ;;
    esac
    paths+=("$line")
  done < "$SLICE_FILE"
  [ "${#paths[@]}" -gt 0 ] || { echo "mission_slice_empty: $SLICE_FILE" >&2; exit 1; }

  # SIZED BEFORE IT IS WRITTEN. The tmpfs ceiling would refuse an oversized slice
  # too, but only as a confusing ENOSPC part-way through an extraction; naming
  # the slice and its size is a refusal someone can act on.
  slice_bytes=$(git -C "$GITHUB_WORKSPACE_DIR" archive --format=tar "$slice_sha" -- "${paths[@]}" | wc -c)
  [ "$slice_bytes" -gt 0 ] || { echo "mission_slice_matched_nothing: ${paths[*]}" >&2; exit 1; }
  if [ "$slice_bytes" -gt "$WORKSPACE_BYTES" ]; then
    echo "mission_slice_too_large: ${slice_bytes} bytes of slice against a ${WORKSPACE_BYTES} byte workspace" >&2
    exit 1
  fi

  # REPOSITORY-RELATIVE PATHS ARE PRESERVED, which is the point: a diff taken
  # here names `src/relay/...` and applies to Sunday Relay unchanged.
  git -C "$GITHUB_WORKSPACE_DIR" archive --format=tar "$slice_sha" -- "${paths[@]}" | tar -x -C "$WORKSPACE"

  # THE HARNESS, NOT THE DELIVERABLE. Two dependency-free files under `.julius/`
  # so the sliced sources need no edit to be importable. They sit outside every
  # repository path a slice can name, so they can never shadow a real file.
  mkdir -p "$WORKSPACE/.julius"
  cp "$GITHUB_WORKSPACE_DIR/.github/julius-mission-slice/resolve.mjs" \
     "$GITHUB_WORKSPACE_DIR/.github/julius-mission-slice/loader.mjs" "$WORKSPACE/.julius/"

  # ------------------------------------------------------- the seed overlay
  #
  # WHAT A SLICE ALONE CANNOT EXPRESS, and the first slice mission needed it.
  #
  # A mission's deliverable is real repository source, which slicing supplies.
  # Its SPECIFICATION — the test that must fail until the work is really done —
  # cannot be: a deliberately-failing test committed to Sunday Relay would break
  # `npm test` on main, and a test that passes against a stub would let a
  # mission satisfy its TEST evidence having implemented nothing. Both are
  # refused elsewhere in this rig for good reasons, and neither is fixable by
  # choosing different slice paths.
  #
  # So a slice mission may carry `seed/`, whose contents are laid over the
  # extracted slice at REPOSITORY-RELATIVE paths — the same coordinates the
  # slice uses, so the mission's diff still applies to Sunday Relay and the new
  # file lands as a new file.
  #
  # AN OVERLAY MAY NOT SHADOW A SLICED FILE. That is refused rather than
  # resolved: a mission quietly replacing real Relay source with its own copy
  # would produce a diff describing changes to a file the worker never saw the
  # real version of — a diff that lies about what changed. The slice is the
  # repository's word and the overlay is the mission's; where they disagree,
  # nobody should have to guess which won.
  SEED_OVERLAY="$MISSION_DIR/seed"
  overlaid=0
  if [ -d "$SEED_OVERLAY" ]; then
    while IFS= read -r -d '' file; do
      rel=${file#"$SEED_OVERLAY"/}
      if [ -e "$WORKSPACE/$rel" ]; then
        echo "mission_seed_overlay_shadows_slice: $rel is both sliced and seeded" >&2; exit 1
      fi
      case "$rel" in
        .julius/*) echo "mission_seed_overlay_reserved_path: $rel" >&2; exit 1 ;;
      esac
      mkdir -p "$WORKSPACE/$(dirname "$rel")"
      cp "$file" "$WORKSPACE/$rel"
      overlaid=$((overlaid + 1))
    done < <(find "$SEED_OVERLAY" -type f -print0)
    [ "$overlaid" -gt 0 ] || { echo "mission_seed_overlay_empty: $SEED_OVERLAY" >&2; exit 1; }
  fi

  echo "slice_rev=$slice_sha"
  echo "slice_paths=${#paths[@]}"
  echo "slice_bytes=$slice_bytes"
  echo "seed_overlay_files=$overlaid"
else
  # ------------------------------------------------------ throwaway-tree mode
  [ -d "$SEED_DIR" ] || { echo "mission_workspace_seed_missing: $SEED_DIR" >&2; exit 1; }
  # An empty seed would produce an empty repository, an empty diff, and a mission
  # that looks like it ran. Refuse instead.
  seeded=$(find "$SEED_DIR" -type f | wc -l)
  [ "$seeded" -gt 0 ] || { echo "mission_workspace_seed_empty: $SEED_DIR" >&2; exit 1; }
  cp -R "$SEED_DIR/." "$WORKSPACE/"
fi

git init --quiet --initial-branch=main .
git -c user.name='Julius Live Mission' -c user.email='julius-live@invalid' add -A
git -c user.name='Julius Live Mission' -c user.email='julius-live@invalid' \
    commit --quiet -m "Disposable workspace for Julius mission $MISSION_NAME"

# The sandbox runs as 65532; git refuses a repository it does not own. The
# coding agent then edits from the host as a DIFFERENT uid, so the tree is also
# made group/other writable — without this the agent's only permitted tool
# (`Edit`) has no writable target.
sudo chown -R "$SANDBOX_UID:$SANDBOX_UID" "$WORKSPACE"
sudo chmod -R a+rwX "$WORKSPACE"

echo "mission=$MISSION_NAME"
echo "workspace=$WORKSPACE"
echo "workspace_bytes=$WORKSPACE_BYTES"
echo "base_revision=$(git -c safe.directory="$WORKSPACE" rev-parse HEAD)"
