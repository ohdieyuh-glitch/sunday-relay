#!/usr/bin/env bash
# Dumps the safe columns of the six Julius tables the first-live mission writes, one TSV per table,
# into the directory given as the first argument. Only safe columns: no environment dump, no
# config, no packet text, no credential-bearing row.
#
# WHY A SCRIPT. Free dry runs #1 and #2 uploaded `evidence.tsv` and `findings.tsv` reading only
# `unavailable`: the inline queries named a column (`type`) and a table (`julius_findings`) that
# the migrations never created, and `psql` failing silently became "unavailable" forever. The
# queries now live here, where the mission runs them, and the `first-live-topology` job runs this
# same script against a freshly migrated database and refuses any `unavailable` file — so a
# stale name fails a PR instead of an artifact. `julius-first-live-mission.test.ts` also checks
# every table and column below against the migration SQL, offline.
set -euo pipefail
out=${1:?usage: julius-live-evidence-dump.sh <directory>}
: "${PGUSER:?missing PGUSER}"; : "${PGDATABASE:?missing PGDATABASE}"; : "${PGPASSWORD:?missing PGPASSWORD}"
container=${JULIUS_POSTGRES_CONTAINER:-julius-postgres}
mkdir -p "$out"
dump() {
  if ! docker exec -e PGPASSWORD "$container" psql -U "$PGUSER" -d "$PGDATABASE" -A -F $'\t' -c "$1" > "$out/$2" 2>/dev/null; then
    echo 'unavailable' > "$out/$2"
  fi
}
dump "SELECT run_id,mission_id,state,card_revision,created_at,updated_at FROM relay_wonderland.julius_runs ORDER BY created_at" runs.tsv
dump "SELECT task_id,task_type,role,state,ordinal,parent_task_id FROM relay_wonderland.julius_tasks ORDER BY ordinal,task_id" tasks.tsv
dump "SELECT evidence_id,evidence_type,status,safe_summary,occurred_at FROM relay_wonderland.julius_evidence ORDER BY occurred_at" evidence.tsv
dump "SELECT decision_id,task_id,action,reason_code,occurred_at FROM relay_wonderland.julius_verification_decisions ORDER BY occurred_at" decisions.tsv
dump "SELECT finding_id,blocking,status,claim FROM relay_wonderland.julius_reviewer_findings ORDER BY created_at" findings.tsv
dump "SELECT invocation_id,tool_id,state,requested_at FROM relay_wonderland.julius_tool_invocations ORDER BY requested_at" tool-invocations.tsv
