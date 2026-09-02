#!/usr/bin/env bash
# Asserts, from the side that must NOT hold it, that the executor's signing key is beyond every
# file-reading path. Shared by the first-live workflow and the `first-live-topology` regression.
#
# What these assertions establish — precisely: the key is on no host path and no bind mount, so
# no FILE-READING tool can reach it; the live coding agent (Read/Glob/Grep, no shell) is the
# party that boundary is for. They do NOT establish protection from a holder of the Docker socket
# or sudo: the job itself reads the PUBLIC half via `docker exec`, and the same command with the
# other filename would read the private half. Claiming more here would be untrue.
set -euo pipefail
: "${JULIUS_PUBLIC_KEY_PATH:?missing JULIUS_PUBLIC_KEY_PATH}"
# Asked with sudo: /tmp/julius-executor is root:root 0700 under the mission's receipt transport,
# and an unprivileged `[ -e ]` beneath it answers "absent" without looking.
for path in /executor-private/private.pem /tmp/julius-executor/private.pem /tmp/julius-executor/ledger; do
  if sudo test -e "$path"; then
    echo "executor_private_key_readable_by_julius:$path" >&2
    exit 1
  fi
done
mounts=$(docker inspect julius-executor --format '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}')
if printf '%s' "$mounts" | grep -q 'executor-private'; then
  echo 'executor_private_root_is_bind_mounted_from_host' >&2
  exit 1
fi
# And the executor really does hold its key, and its ledger, in its own layer.
docker exec julius-executor test -f /executor-private/private.pem \
  || { echo 'executor_missing_its_own_signing_key' >&2; exit 1; }
docker exec julius-executor test -d /executor-private/ledger \
  || { echo 'executor_missing_its_own_ledger' >&2; exit 1; }
# Julius holds the public half, and only the public half.
grep -q 'BEGIN PUBLIC KEY' "$JULIUS_PUBLIC_KEY_PATH"
# `grep && { ... }` would return non-zero on the DESIRED no-match and abort under `set -e`; the
# branch has to be explicit.
if grep -q 'PRIVATE KEY' "$JULIUS_PUBLIC_KEY_PATH"; then
  echo 'julius_holds_private_key_material' >&2
  exit 1
fi
echo "executor_mounts=$mounts"
echo 'PREFLIGHT OK: the signing key is on no host path and no bind mount — no file-reading tool can reach it.'
echo '  (A Docker-socket or sudo holder could still extract it; the boundary is against the file-reading coding agent.)'
