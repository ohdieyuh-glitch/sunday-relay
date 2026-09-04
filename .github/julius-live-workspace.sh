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
[ -d "$SEED_DIR" ] || { echo "mission_workspace_seed_missing: $SEED_DIR" >&2; exit 1; }
# An empty seed would produce an empty repository, an empty diff, and a mission
# that looks like it ran. Refuse instead.
seeded=$(find "$SEED_DIR" -type f | wc -l)
[ "$seeded" -gt 0 ] || { echo "mission_workspace_seed_empty: $SEED_DIR" >&2; exit 1; }
cp -R "$SEED_DIR/." "$WORKSPACE/"

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
