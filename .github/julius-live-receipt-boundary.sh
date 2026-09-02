#!/usr/bin/env bash
# Proves the receipt transport's boundary from the runner's side, after the executor is up, in
# both the first-live workflow and the `first-live-topology` regression.
#
# WHAT IT ESTABLISHES, PRECISELY. With a host receipt root chosen (JULIUS_RECEIPT_HOST_ROOT):
#   - the root exists, is root:root 0700, and is not a symlink;
#   - the ordinary runner user — the user the live coding agent's file tools run as — can neither
#     list, read nor write it (checked by trying, without sudo);
#   - the executor container carries exactly ONE receipt mount, source and destination the same
#     absolute path, and no mount that names /executor-private, the signing key or the ledger;
#   - the executor holds its key and its ledger under /executor-private, and neither exists on the
#     host; the executor, as root, can write under the receipt root, which is what the daemon's
#     bind of a sandbox's scoped subtree depends on.
# With no host receipt root (the negative regression), it establishes that no receipt mount exists.
# It does NOT establish protection against sudo or the Docker socket: this job holds both.
set -euo pipefail
mounts=$(docker inspect julius-executor --format '{{range .Mounts}}{{.Source}}:{{.Destination}} {{end}}')
for forbidden in executor-private private.pem ledger; do
  if printf '%s' "$mounts" | grep -q "$forbidden"; then echo "receipt_boundary_violation:mount_names_$forbidden" >&2; exit 1; fi
done
docker exec julius-executor test -f /executor-private/private.pem || { echo 'receipt_boundary_violation:executor_missing_key' >&2; exit 1; }
docker exec julius-executor test -d /executor-private/ledger || { echo 'receipt_boundary_violation:executor_missing_ledger' >&2; exit 1; }
for host_path in /executor-private/private.pem /executor-private/ledger /tmp/julius-executor/private.pem /tmp/julius-executor/ledger; do
  if [ -e "$host_path" ]; then echo "receipt_boundary_violation:host_holds_$host_path" >&2; exit 1; fi
done

if [ -z "${JULIUS_RECEIPT_HOST_ROOT:-}" ]; then
  if printf '%s' "$mounts" | grep -q 'receipts'; then echo 'receipt_boundary_violation:unexpected_receipt_mount' >&2; exit 1; fi
  echo 'RECEIPT TRANSPORT: executor-private (no host mount) — the negative regression topology'
  exit 0
fi

root=$JULIUS_RECEIPT_HOST_ROOT
if [ -L "$root" ]; then echo 'receipt_boundary_violation:root_is_symlink' >&2; exit 1; fi
actual=$(sudo stat -c '%U:%G %a' "$root")
[ "$actual" = 'root:root 700' ] || { echo "receipt_boundary_violation:root_is_$actual" >&2; exit 1; }
# The ordinary runner user, without sudo: every access must be refused.
if ls "$root" >/dev/null 2>&1; then echo 'receipt_boundary_violation:runner_can_list' >&2; exit 1; fi
if cat "$root/probe" >/dev/null 2>&1; then echo 'receipt_boundary_violation:runner_can_read' >&2; exit 1; fi
if touch "$root/probe" >/dev/null 2>&1; then echo 'receipt_boundary_violation:runner_can_write' >&2; exit 1; fi
if [ -r "$root" ] || [ -w "$root" ] || [ -x "$root" ]; then echo 'receipt_boundary_violation:runner_has_mode_bits' >&2; exit 1; fi
# Exactly one receipt mount, same path on both sides.
receipt_mounts=$(printf '%s\n' $mounts | grep -c "^$root:" || true)
[ "$receipt_mounts" = '1' ] || { echo "receipt_boundary_violation:receipt_mounts=$receipt_mounts" >&2; exit 1; }
printf '%s\n' $mounts | grep -qx "$root:$root" || { echo 'receipt_boundary_violation:receipt_mount_path_differs' >&2; exit 1; }
# The executor sees the same directory and can write beneath it; the write is removed again.
docker exec julius-executor sh -c "test -d '$root' && touch '$root/.boundary-probe' && rm -f '$root/.boundary-probe'" \
  || { echo 'receipt_boundary_violation:executor_cannot_write_receipt_root' >&2; exit 1; }
echo "RECEIPT TRANSPORT OK: $root is root:root 0700 on the host, mounted into the executor at the same path, unreadable by the runner user; key and ledger stay executor-private."
echo '  (A sudo or Docker-socket holder could still read receipts; the boundary is against the file-reading coding agent.)'
