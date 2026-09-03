#!/usr/bin/env bash
# Dumps the safe columns of the Julius tables the first-live mission writes, one TSV per table,
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

# WHY A TASK FAILED, WITHOUT A RAW LOG.
#
# The first paid attempt failed at its `plan` task and this artifact could not say why: the
# normalized code lived only in the operational event stream and the trajectory row, neither of
# which was dumped, and the database is destroyed with the job. Six queries described WHAT
# happened and none of them WHY.
#
# NAMED FACT KEYS ONLY, never `payload` whole. Every value below is a machine token by
# construction — `code` is one of nine JuliusErrorCodes, `failureClass` is narrowed by
# `safeFailureClass` to /^[a-z][a-z0-9_]{0,63}$/, `reasonCode` is a continuation reason — so a
# provider message, a prompt, a URL or an `Authorization:` header cannot reach this file even if
# an adapter passes one. The narrowing refuses every shape but an all-lower-case alphanumeric
# token, which is the first layer; the workflow's credential scan before publication is the
# second. Neither is claimed to be the only one.
# The role comes from the task row, so a reader sees which of the three C.A.R.D. roles stopped.
# One row names no task: the run loop's own `julius.run.failed`, the run's ending rather than a
# worker's. The pipeline emits that type too — an unresolvable role, a policy denial, a repair it
# cannot plan — and those DO name their task. Blank means the run's ending; the type alone does not.
dump "SELECT e.payload->>'taskId' AS task_id,t.role,e.event_type,e.payload->'facts'->>'code' AS julius_code,e.payload->'facts'->>'failureClass' AS failure_class,e.payload->'facts'->>'errorRetryable' AS error_retryable,e.payload->'facts'->>'reasonCode' AS reason_code,e.occurred_at FROM relay_wonderland.events e LEFT JOIN relay_wonderland.julius_tasks t ON t.task_id=e.payload->>'taskId' WHERE e.event_type IN ('julius.task.failed','julius.provider.failure','julius.run.failed','julius.retry.scheduled') ORDER BY e.occurred_at" failures.tsv
