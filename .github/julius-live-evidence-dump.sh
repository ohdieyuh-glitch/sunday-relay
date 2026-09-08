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
# `safeFailureClass` to /^[a-z][a-z0-9_]{0,63}$/, and `reasonCode` is either a SOURCE LITERAL — a
# continuation reason, a C.A.R.D. verdict, a dispatch refusal, a run-state reason such as
# UNRESOLVED_WORKER_ROLE or TASK_FAILED — or a cause narrowed by the wider `safeReasonCode`
# (/^[A-Za-z][A-Za-z0-9_]{0,63}$/), which admits upper case and so admits strictly more — so a
# provider message, a prompt, a URL or an `Authorization:` header cannot reach this file even if
# an adapter passes one. The failure-class rule is `[a-z]` then up to 63 of `[a-z0-9_]`, so it
# refuses an upper-case letter, a leading digit or underscore, every punctuation mark but a
# non-leading `_`, and anything longer — but a token already in that alphabet, such as a hex
# digest beginning a-f, would pass. The reason-code rule admits mixed case, so shapes the narrow
# rule refuses — `ghp_…`, `AKIA…` — would pass it; only the repair planner's own throws reach it. That is the first layer; the
# workflow's credential scan before publication is the second. Neither is claimed to be the only one.
# The role comes from the task row, so a reader sees which of the three C.A.R.D. roles stopped.
# `julius.recovery.action` is here because a task can now END for a reason no other row carries:
# the recovery sweep fails one whose expired lease it has already reclaimed too many times
# (RECOVERY_LIMIT_REACHED), and a task that never reached a worker leaves no `task.failed` behind.
# The sweep also records ordinary REQUEUEs, which are not failures, so `recovery_action` is
# exported as the discriminator — a source literal from a four-value union. `owner` is NOT
# exported: which worker held a lease is not part of explaining why a mission failed.
# One row names no task: the run loop's own `julius.run.failed`, the run's ending rather than a
# worker's. The pipeline emits that type too — an unresolvable role, a policy denial, a repair it
# cannot plan — and those DO name their task. Blank means the run's ending; the type alone does not.
dump "SELECT e.payload->>'taskId' AS task_id,t.role,e.event_type,e.payload->'facts'->>'code' AS julius_code,e.payload->'facts'->>'failureClass' AS failure_class,e.payload->'facts'->>'errorRetryable' AS error_retryable,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'action' AS recovery_action,e.occurred_at FROM relay_wonderland.events e LEFT JOIN relay_wonderland.julius_tasks t ON t.task_id=e.payload->>'taskId' WHERE e.event_type IN ('julius.task.failed','julius.provider.failure','julius.run.failed','julius.retry.scheduled','julius.recovery.action','julius.budget.denied') ORDER BY e.occurred_at" failures.tsv

# WHAT EACH DISPATCH WAS ALLOWED TO SPEND, AND WHAT IT SPENT.
# Paid run 34037313976 was refused for cost and the bundle could not say what the
# ceiling was, who set it, or how much of the mission remained — the amount lived
# only in a message nothing persisted. The mission contract now derives a bounded
# allocation per Coding Agent dispatch (`julius-allocation.v1`); these are the
# rows that prove which round was granted what, and what the ledger settled.
dump "SELECT e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'allocatedUsdMicros' AS allocated_usd_micros,e.payload->'facts'->>'allocationBasis' AS allocation_basis,e.payload->'facts'->>'shareUsdMicros' AS share_usd_micros,e.payload->'facts'->>'remainingUsdMicros' AS remaining_usd_micros,e.payload->'facts'->>'allocationPolicy' AS allocation_policy,e.payload->'facts'->>'usdMicros' AS settled_usd_micros,e.payload->'facts'->>'reason' AS reason,e.payload->'facts'->>'reservationId' AS reservation_id,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.budget.allocated','julius.budget.reserved','julius.budget.settled','julius.budget.denied') ORDER BY e.occurred_at" budget.tsv

# THE FACTS THAT LET SOMEONE DEBUG THE CLASS, WITHOUT BUYING A SECOND PAID RUN.
#
# `failures.tsv` above names WHICH boundary broke. It cannot say the exit code Hermes returned,
# how many bytes arrived against the ceiling, or how many verdict-bearing objects made a text
# ambiguous — so `review_process_exit` and `review_output_too_large` each named a class an
# operator could only investigate by paying again. Paid attempt #2 had none of these.
#
# FLAT SCALARS, NOT A NESTED OBJECT. An operational event's facts are
# `Record<string,string|number|boolean|null>` by contract, and the runtime's
# `recordEvent` coerces any non-scalar with `String(value)` — so a nested
# diagnostics object reached the row as the literal text `[object Object]` and
# every column below read null. The domain flattens to `diag_*` at the source,
# which is why these read a scalar key rather than descending into one.
#
# EVERY COLUMN IS REBUILT BY AN ALLOWLIST BEFORE IT IS WRITTEN. `safeReviewDiagnostics` in the
# domain constructs this object from a fixed set of keys with a fixed type each, so a key nobody
# listed cannot reach the event however an adapter passed it, and a wrong-typed value becomes
# null rather than travelling. Counts are non-negative integers, flags are booleans, `transport`
# and `stage` are closed vocabularies, `provider` and `failureShape` take the narrow
# failure-class alphabet, and `servedModel` is bounded to 48 characters and refused outright
# when it looks like a credential. NO reviewer text, summary, diff, prompt or provider body has
# a column here, because none of them has a key in that allowlist.
#
# `NULL` is a real answer everywhere and always means "not known here", never zero: a reviewer
# that never started has no exit code, and 0 would say it exited cleanly.
dump "SELECT e.payload->>'taskId' AS task_id,t.role,e.payload->'facts'->>'diag_stage' AS stage,e.payload->'facts'->>'diag_transport' AS transport,e.payload->'facts'->>'diag_provider' AS provider,e.payload->'facts'->>'diag_servedModel' AS served_model,e.payload->'facts'->>'diag_processExitCode' AS process_exit_code,e.payload->'facts'->>'diag_timedOut' AS timed_out,e.payload->'facts'->>'diag_outputBytesObserved' AS output_bytes_observed,e.payload->'facts'->>'diag_outputByteLimit' AS output_byte_limit,e.payload->'facts'->>'diag_outputTruncated' AS output_truncated,e.payload->'facts'->>'diag_jsonDetected' AS json_detected,e.payload->'facts'->>'diag_jsonParseable' AS json_parseable,e.payload->'facts'->>'diag_reviewObjectCount' AS review_object_count,e.payload->'facts'->>'diag_verdictPresent' AS verdict_present,e.payload->'facts'->>'diag_verdictValid' AS verdict_valid,e.payload->'facts'->>'diag_summaryPresent' AS summary_present,e.payload->'facts'->>'diag_failureShape' AS failure_shape,e.payload->'facts'->>'diag_providerHttpStatus' AS provider_http_status,e.payload->'facts'->>'diag_serviceHttpStatus' AS service_http_status,e.payload->'facts'->>'diag_requestedModel' AS requested_model,e.payload->'facts'->>'diag_responseId' AS response_id,e.payload->'facts'->>'diag_validationPassed' AS validation_passed,e.payload->'facts'->>'diag_validationReasonCode' AS validation_reason_code,e.payload->'facts'->>'diag_validationField' AS validation_field,e.payload->'facts'->>'diag_resultSubtype' AS result_subtype,e.payload->'facts'->>'diag_isError' AS is_error,e.payload->'facts'->>'diag_numTurns' AS num_turns,e.payload->'facts'->>'diag_toolUseCount' AS tool_use_count,e.payload->'facts'->>'diag_permissionDenials' AS permission_denials,e.payload->'facts'->>'diag_implementationPresent' AS implementation_present,e.payload->'facts'->>'diag_costUsdMicros' AS cost_usd_micros,e.payload->'facts'->>'diag_costCeilingUsdMicros' AS cost_ceiling_usd_micros,e.payload->'facts'->>'diag_costSource' AS cost_source,e.payload->'facts'->>'diag_runtimeStarted' AS runtime_started,e.payload->'facts'->>'code' AS julius_code,e.payload->'facts'->>'errorRetryable' AS retryable,e.occurred_at FROM relay_wonderland.events e LEFT JOIN relay_wonderland.julius_tasks t ON t.task_id=e.payload->>'taskId' WHERE e.payload->'facts'->>'diag_transport' IS NOT NULL ORDER BY e.occurred_at" worker-diagnostics.tsv

# WHAT THE RUN LEARNED, AND WHO IT RAN FOR.
#
# Two tables the bundle has never carried, and both answer a Beta Gate row that could otherwise
# only guess.
#
# `julius_brain_entries` is the Project Brain. Until now it had one writer — the bootstrap seed —
# so a bundle could not distinguish "the run recorded nothing" from "nothing was ever dumped".
# Identifiers, kind, revision and time only: `safe_content` is deliberately NOT selected, because
# it is worker-authored prose and this bundle's rule is that no model-written text has a column.
#
# `execution_sessions.player_id` is the account the mission belongs to. Both bounded missions
# declare tenant `tenant` and run under an operator token, so today it reads as the operator and
# the ACCOUNT / ONBOARDING row correctly FAILS; the day a real account starts a mission it reads
# as that account. Identifiers only — the same class the run and mission columns already carry.
dump "SELECT entry_id,entry_kind,worker_id,task_id,revision,created_at FROM relay_wonderland.julius_brain_entries ORDER BY revision" project-brain.tsv
dump "SELECT execution_id,mission_id,project_id,player_id,agent_id,state FROM relay_wonderland.execution_sessions ORDER BY execution_id" sessions.tsv

# WHAT THE CODER WAS CHARGED WITH, AND WHETHER IT WAS AGREED BEFORE IT RAN.
#
# A build may not be dispatched without a LOCKED task contract, so this table is what turns that
# from a code path into evidence: the bundle shows the revision, its lock state, the instant it
# stopped being arguable and who accepted it. Without it, "the reviewer graded against the same
# agreement the coder worked under" is unfalsifiable after the database is destroyed.
#
# IDENTIFIERS AND STATE ONLY. `safe_terms` is deliberately NOT selected — the objective, the
# criteria statements and the scope are prose, and some of it is architect-authored after a
# revision, which is exactly the class this bundle refuses a column. `binding_digest` IS selected
# and is safe by construction: it is a sha256 of the terms, never the terms.
dump "SELECT contract_id,contract_revision,task_id,state,binding_digest,locked_at,locked_by_evaluator_id,created_at FROM relay_wonderland.julius_task_contracts ORDER BY contract_id,contract_revision" task-contracts.tsv
