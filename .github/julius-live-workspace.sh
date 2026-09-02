#!/usr/bin/env bash
# Provisions the ONE disposable mission workspace for the first live Julius
# mission, and nothing else.
#
# WHY A THROWAWAY REPOSITORY AND NOT THIS CHECKOUT. The executor bind-mounts
# the workspace into a sandbox and refuses any workspace whose BACKING
# FILESYSTEM is larger than the declared ceiling
# (`assertEnforceableWorkspaceCeiling`), which for the live composition is
# `BETA_WORKSPACE_BYTES` = 4 MiB. A repository checkout on the runner's root
# filesystem measures tens of gigabytes and is refused outright, and the
# sandbox has no network with which to install anything. So the mission gets
# its own 4 MiB tmpfs holding a two-file git repository: small enough to be
# bounded, real enough to diff, and disposable enough that a mistake by a live
# coding agent costs nothing.
#
# OWNERSHIP. Commands inside the sandbox run as uid 65532, so git refuses a
# repository owned by anyone else ("dubious ownership") and the coder's diff
# would come back empty. The workspace leaf is therefore handed to 65532 while
# staying mode 0777, which is what lets the host-side coding agent — running as
# the runner user — still create files in it. The ANCESTORS deliberately stay
# 0755 and owned by the runner: `assertUnrenameableAncestry` refuses a parent
# that is group/other-writable or owned by 65532, so the workspace cannot be
# renamed out from under its own mount.
set -euo pipefail

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

cat > package.json <<'JSON'
{
  "name": "julius-live-proof",
  "version": "0.0.0",
  "private": true,
  "description": "Disposable workspace for the first live Julius mission."
}
JSON

cat > README.md <<'MARKDOWN'
# Julius first live mission workspace

A throwaway repository. It exists only so one live Julius mission can make a
small, real, reviewable change inside a bounded sandbox: 4 MiB, no network, no
dependencies, and no path back to the Sunday Relay repository.

The mission's own contract states what must be built here.
MARKDOWN

git init --quiet --initial-branch=main .
git -c user.name='Julius Live Mission' -c user.email='julius-live@invalid' \
    add package.json README.md
git -c user.name='Julius Live Mission' -c user.email='julius-live@invalid' \
    commit --quiet -m 'Disposable workspace for the first live Julius mission'

# The sandbox runs as 65532; git refuses a repository it does not own.
sudo chown -R "$SANDBOX_UID:$SANDBOX_UID" "$WORKSPACE"
sudo chmod 0777 "$WORKSPACE"

echo "workspace=$WORKSPACE"
echo "workspace_bytes=$WORKSPACE_BYTES"
echo "base_revision=$(git -c safe.directory="$WORKSPACE" rev-parse HEAD)"
