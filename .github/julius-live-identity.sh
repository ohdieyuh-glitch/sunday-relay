#!/usr/bin/env bash
# Mints the ephemeral, per-job credentials the first-live rig runs on, and nothing durable.
#
# NOTE: no signing key is created here. The executor mints its own inside its container
# (.github/julius-executor-entrypoint.sh) so that this user — the user that also runs Julius —
# never holds the private material it is supposed to be verifying against. Only the credential
# root, which Julius legitimately derives its scoped credentials from, is minted on this side.
#
# Shared by the first-live workflow and the `first-live-topology` regression job.
set -euo pipefail
root=$(openssl rand -base64 33 | tr -d '\n')
echo "::add-mask::$root"
# The database password is ephemeral too. A literal one would be a credential committed to this
# file, and the boundary scanner is right to refuse that even for a throwaway container.
database_password=$(openssl rand -hex 24)
echo "::add-mask::$database_password"
# Mask every credential derivable from the root, not just the ones this job uses, so none can
# surface in a later log line.
EXECUTOR_CREDENTIAL_ROOT="$root" node scripts/julius-derive-scoped-credentials.mjs --values \
  | while read -r value; do echo "::add-mask::$value"; done
scoped=$(EXECUTOR_CREDENTIAL_ROOT="$root" node scripts/julius-derive-scoped-credentials.mjs --json \
  create prepare execute cancel destroy inspect artifacts)
{
  echo "root=$root"
  echo "database_password=$database_password"
  echo "scoped=$scoped"
} >> "${GITHUB_OUTPUT:?missing GITHUB_OUTPUT}"
echo 'identity minted (root, database password and scoped credentials are masked step outputs)'
