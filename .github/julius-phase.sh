#!/usr/bin/env bash
# Runs one Julius phase as its own container, so a phase boundary is a genuine Julius restart.
# The container is given no Docker socket, no signing key, no receipt store, no ledger and no executor secret.
set -euo pipefail
phase="${1:?missing phase}"
entry='dist-relay-executor/julius-sibling-e2e.cjs'
if [ "$phase" = 'evals' ]; then entry='dist-relay-executor/julius-provider-independent-evals.cjs'; fi
exec docker run --rm --network container:julius-executor \
  -v "$GITHUB_WORKSPACE:$GITHUB_WORKSPACE:ro" -v /tmp/julius-workspace:/tmp/julius-workspace \
  -v /tmp/julius-public.pem:/tmp/julius-public.pem:ro -w "$GITHUB_WORKSPACE" \
  -e PGHOST=julius-postgres -e PGPORT=5432 -e PGUSER=julius -e PGPASSWORD=julius -e PGDATABASE=julius \
  -e JULIUS_CALLER_ID -e JULIUS_TENANT_ID -e JULIUS_OTHER_CALLER_ID -e EXECUTOR_KEY_ID \
  -e JULIUS_SCOPED_CREDENTIALS="$SCOPED" -e JULIUS_OTHER_SCOPED_CREDENTIALS="$OTHER_SCOPED" \
  -e JULIUS_OPERATOR_SCOPED_CREDENTIALS="${OPERATOR_SCOPED:-}" \
  -e JULIUS_PUBLIC_KEY_PATH=/tmp/julius-public.pem -e JULIUS_WORKSPACE=/tmp/julius-workspace/tenant/ws -e JULIUS_FOREIGN_WORKSPACE=/tmp/julius-workspace/other-tenant/ws \
  -e JULIUS_ORPHAN_EXPECTED="${JULIUS_ORPHAN_EXPECTED:-}" \
  -e PROBE_EXECUTOR_PRIVATE_KEY=/tmp/julius-executor/private.pem \
  -e PROBE_EXECUTOR_RECEIPT_ROOT=/tmp/julius-executor/receipts \
  -e PROBE_EXECUTOR_LEDGER_ROOT=/tmp/julius-executor/ledger \
  -e SIBLING_PHASE="$phase" node:22-bookworm-slim node "$entry"
