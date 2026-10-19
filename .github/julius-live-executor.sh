#!/usr/bin/env bash
# Starts the first-live rig's PostgreSQL 16 and its independent executor, exactly as the paid
# mission runs them, and hands Julius the executor's PUBLIC key. Shared by the first-live workflow
# and the `first-live-topology` regression job in julius-real-infra.yml, so the regression starts
# the executor the mission starts.
#
# Required env: SANDBOX_IMAGE, EXECUTOR_IMAGE (digests from julius-live-images.sh),
# EXECUTOR_CREDENTIAL_ROOT, PGUSER, PGPASSWORD, PGDATABASE, EXECUTOR_KEY_ID, JULIUS_CALLER_ID,
# JULIUS_TENANT_ID, JULIUS_FLEET_ROOT, JULIUS_PUBLIC_KEY_PATH, GITHUB_WORKSPACE, GITHUB_ENV.
#
# RECEIPT TRANSPORT — the one topology choice this script makes. The executor asks the HOST
# Docker daemon, over the mounted socket, to bind-mount each sandbox's scoped receipt directory
# into that sandbox (docker-sandbox-adapter.ts, `--mount type=bind,src=<receipt root>/<scope>`),
# and the daemon resolves bind sources ON THE HOST. So where the receipt root lives decides
# whether a sandbox can be created at all:
#
#   JULIUS_RECEIPT_HOST_ROOT unset   receipts under /executor-private/receipts, inside the executor
#                                    container's own writable layer and on no host path. The #212
#                                    F4 shape; what free dry runs #1 and #2 started. PROVEN on real
#                                    Docker (PR #214) to stop every sandbox at prepareWorkspace with
#                                    `sandbox_create_failed class=bind_source_missing`: the daemon
#                                    cannot see the source. Kept only as the negative regression
#                                    the `first-live-topology` job runs.
#   JULIUS_RECEIPT_HOST_ROOT=<dir>   receipts under a HOST directory created here root:root 0700
#                                    and bind-mounted into the executor at the same path, so the
#                                    daemon and the executor name one directory. PROVEN (runs
#                                    33667743669, 33685880591) to carry create, prepare, execute,
#                                    signed receipts, the host→sandbox diff and destroy; the scope
#                                    proof was added afterwards and is held by the same job. THE
#                                    MISSION'S TRANSPORT.
#
# Whichever is chosen, the signing key and the ledger stay under /executor-private and are never
# bind-mounted anywhere: nothing on the host holds the key, and no sandbox sees the ledger. Each
# sandbox is handed ONLY its own scoped subtree of the receipt root (docker-sandbox-adapter.ts
# mounts `<root>/<sha256(sandboxId)>` at /julius-receipts-root), never the root itself.
set -euo pipefail
: "${SANDBOX_IMAGE:?missing SANDBOX_IMAGE}"; : "${EXECUTOR_IMAGE:?missing EXECUTOR_IMAGE}"
: "${EXECUTOR_CREDENTIAL_ROOT:?missing EXECUTOR_CREDENTIAL_ROOT}"; : "${PGPASSWORD:?missing PGPASSWORD}"
: "${PGUSER:?missing PGUSER}"; : "${PGDATABASE:?missing PGDATABASE}"
: "${EXECUTOR_KEY_ID:?missing EXECUTOR_KEY_ID}"; : "${JULIUS_CALLER_ID:?missing JULIUS_CALLER_ID}"
: "${JULIUS_TENANT_ID:?missing JULIUS_TENANT_ID}"; : "${JULIUS_PUBLIC_KEY_PATH:?missing JULIUS_PUBLIC_KEY_PATH}"
fleet_root=${JULIUS_FLEET_ROOT:-/tmp/julius-workspace}

# THE HOST PORT IS THE ONE LOCAL SWITCH, and unset it is 5432: exactly what both workflows ran
# before. The founder's local qualification rig (scripts/julius-local-qualification.sh) sets it,
# because inside WSL2 127.0.0.1:5432 is ALREADY TAKEN by Docker Desktop's forward to Julius's live
# durable store: every WSL2 distro shares one network namespace, so a disposable qualification
# database published there would collide with, or be mistaken for, the real one. Digits only, so
# nothing but a port can reach the `-p` argument or the connection URL.
pg_port=${JULIUS_LIVE_PG_PORT:-5432}
case "$pg_port" in ''|*[!0-9]*) echo "pg_port_refused:$pg_port" >&2; exit 1 ;; esac

docker run -d --name julius-postgres -p "127.0.0.1:${pg_port}:5432" \
  -e POSTGRES_USER="$PGUSER" -e POSTGRES_PASSWORD="$PGPASSWORD" -e POSTGRES_DB="$PGDATABASE" postgres:16-bookworm
for _ in $(seq 1 40); do docker exec julius-postgres pg_isready -U "$PGUSER" && break; sleep 1; done
# Assembled at runtime from parts, so this file carries a format string rather than a connection
# URL with inline credentials.
printf 'DATABASE_URL=postgresql://%s:%s@127.0.0.1:%s/%s\n' "$PGUSER" "$PGPASSWORD" "$pg_port" "$PGDATABASE" >> "${GITHUB_ENV:?missing GITHUB_ENV}"
DATABASE_URL=$(printf 'postgresql://%s:%s@127.0.0.1:%s/%s' "$PGUSER" "$PGPASSWORD" "$pg_port" "$PGDATABASE")

receipt_root=/executor-private/receipts
receipt_mount=()
if [ -n "${JULIUS_RECEIPT_HOST_ROOT:-}" ]; then
  # The transport must be an absolute host path of its own: never the private root the daemon
  # cannot see, never the workspace fleet the sandboxes mount, never a path the runner can rename.
  case "$JULIUS_RECEIPT_HOST_ROOT" in
    /executor-private|/executor-private/*) echo "receipt_root_refused:executor_private:$JULIUS_RECEIPT_HOST_ROOT" >&2; exit 1 ;;
    "$fleet_root"|"$fleet_root"/*) echo "receipt_root_refused:inside_workspace_fleet:$JULIUS_RECEIPT_HOST_ROOT" >&2; exit 1 ;;
    /*) ;;
    *) echo "receipt_root_refused:not_absolute:$JULIUS_RECEIPT_HOST_ROOT" >&2; exit 1 ;;
  esac
  # root:root 0700: the ordinary runner user cannot list, read, write or traverse it. Stated
  # plainly: a holder of sudo or of the Docker socket still can. That party is not the boundary's
  # adversary; the file-reading coding agent that runs as the runner user is. `install -d` follows
  # a symlink that already sits where it is told to create, so a planted link at the root or its
  # parent is refused BEFORE anything is created; afterwards the path must resolve to itself and
  # both the parent and the root must measure root:root 0700 — proven, not assumed.
  parent=$(dirname "$JULIUS_RECEIPT_HOST_ROOT")
  for candidate in "$parent" "$JULIUS_RECEIPT_HOST_ROOT"; do
    if sudo test -L "$candidate"; then echo "receipt_root_refused:symlink:$candidate" >&2; exit 1; fi
  done
  sudo install -d -m 0700 -o root -g root "$parent"
  sudo install -d -m 0700 -o root -g root "$JULIUS_RECEIPT_HOST_ROOT"
  resolved=$(sudo realpath "$JULIUS_RECEIPT_HOST_ROOT")
  if [ "$resolved" != "$JULIUS_RECEIPT_HOST_ROOT" ]; then echo "receipt_root_refused:resolves_elsewhere" >&2; exit 1; fi
  for measured in "$parent" "$JULIUS_RECEIPT_HOST_ROOT"; do
    actual=$(sudo stat -c '%U:%G %a' "$measured")
    if [ "$actual" != 'root:root 700' ]; then echo "receipt_root_not_private:$measured:$actual" >&2; exit 1; fi
  done
  receipt_root=$JULIUS_RECEIPT_HOST_ROOT
  receipt_mount=(-v "$JULIUS_RECEIPT_HOST_ROOT:$JULIUS_RECEIPT_HOST_ROOT")
fi

# The executor shares the HOST network namespace so that it can keep binding loopback only — its
# own guard refuses a wider bind, and publishing a port would have required weakening it. Julius
# runs on the host and reaches it at 127.0.0.1:8787. The sandboxes it creates are unaffected: they
# get `--network none`.
# THE MOUNTS: the Docker socket, the checkout (read-only), the workspace fleet root, and — only
# when a host receipt root was chosen — that receipt root. NOTHING under /executor-private is
# mounted: it is the container's own writable layer, so the host cannot read the signing key or
# the ledger, and Julius cannot sign what it later verifies.
docker run -d --name julius-executor --network host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE:ro" \
  -v "$fleet_root:$fleet_root" \
  "${receipt_mount[@]}" \
  -w "$GITHUB_WORKSPACE" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e EXECUTOR_PRIVATE_ROOT=/executor-private \
  -e EXECUTOR_RECEIPT_ROOT="$receipt_root" \
  -e EXECUTOR_LEDGER_ROOT=/executor-private/ledger \
  -e EXECUTOR_SIGNING_KEY_PATH=/executor-private/private.pem \
  -e EXECUTOR_KEY_ID="$EXECUTOR_KEY_ID" \
  -e EXECUTOR_RUNTIME_ID=executor-julius-live \
  -e EXECUTOR_VERSION=docker-executor.v1 \
  -e EXECUTOR_WORKSPACE_ROOT="$fleet_root" \
  -e EXECUTOR_TENANT_WORKSPACE_ROOT="$fleet_root" \
  -e JULIUS_SANDBOX_IMAGE="$SANDBOX_IMAGE" \
  -e JULIUS_CALLER_ID="$JULIUS_CALLER_ID" \
  -e JULIUS_TENANT_ID="$JULIUS_TENANT_ID" \
  -e EXECUTOR_CREDENTIAL_ROOT="$EXECUTOR_CREDENTIAL_ROOT" \
  "$EXECUTOR_IMAGE" sh "$GITHUB_WORKSPACE/.github/julius-executor-entrypoint.sh"
./.github/wait-for-executor.sh

# Take the PUBLIC key only. This is the whole of what Julius is given to verify attestations
# with, and the private half never leaves the container that produced it.
docker exec julius-executor cat /executor-private/public.pem > "$JULIUS_PUBLIC_KEY_PATH"
test -s "$JULIUS_PUBLIC_KEY_PATH" || { echo 'executor_public_key_not_exported' >&2; exit 1; }
grep -q 'BEGIN PUBLIC KEY' "$JULIUS_PUBLIC_KEY_PATH" || { echo 'executor_public_key_malformed' >&2; exit 1; }
echo "executor_receipt_root=$receipt_root"
echo "executor_receipt_host_mount=$([ -n "${JULIUS_RECEIPT_HOST_ROOT:-}" ] && echo yes || echo no)"
