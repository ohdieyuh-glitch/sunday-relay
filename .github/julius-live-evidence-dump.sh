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

# ORDERING IS THE LEDGER'S, NOT THE CLOCK'S.
#
# Every query below that reads `relay_wonderland.events` selects `e.sequence` and orders by it.
# That column is the per-stream position the event ledger ALLOCATES on append, out of
# `stream_sequences`, inside a SERIALIZABLE transaction — `UNIQUE(stream_id,sequence)`, app
# allocated rather than a Postgres SERIAL, so it has no gaps and no two events of one run can
# share one. `occurred_at` is a wall clock and several events of a paid mission routinely share a
# millisecond, so sorting by it leaves the tie to whatever order the planner happened to return —
# which is not an order at all, and cannot answer "who worked WHEN" for three interleaved workers.
# `occurred_at` stays in the output as a fact about the run; it is simply no longer the key.
#
# The key is `stream_id,sequence`, both columns, because `sequence` is scoped to ONE stream and a
# Julius event's stream IS its run: every writer — julius-event-postgres, julius-postgres,
# julius-repair-postgres, julius-tool-settlement-postgres — passes the run id as the stream id.
# A database holding two runs would interleave nonsensically under a bare `sequence`, so the run
# is exported as `run_id` and sorted on first: the rows of a run stay together and, within one,
# stand in the exact order the ledger committed them.
#
# This is the same authority `julius-slot-report.v1` projects its chronology from, so the bundle
# and the report cannot disagree about what happened first. NOT every file here can be moved onto
# it: `julius_trajectory_events` has no sequence column at all and keeps its own
# `occurred_at,trajectory_event_id` tiebreak, and `cost-accounting.tsv` is an aggregate whose
# order is its grouping. Those are stated rather than papered over.
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
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,t.role,e.event_type,e.payload->'facts'->>'code' AS julius_code,e.payload->'facts'->>'failureClass' AS failure_class,e.payload->'facts'->>'errorRetryable' AS error_retryable,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'action' AS recovery_action,e.occurred_at FROM relay_wonderland.events e LEFT JOIN relay_wonderland.julius_tasks t ON t.task_id=e.payload->>'taskId' WHERE e.event_type IN ('julius.task.failed','julius.provider.failure','julius.run.failed','julius.retry.scheduled','julius.recovery.action','julius.budget.denied') ORDER BY e.stream_id,e.sequence" failures.tsv

# WHAT EACH DISPATCH WAS ALLOWED TO SPEND, AND WHAT IT SPENT.
# Paid run 34037313976 was refused for cost and the bundle could not say what the
# ceiling was, who set it, or how much of the mission remained — the amount lived
# only in a message nothing persisted. The mission contract now derives a bounded
# allocation per Coding Agent dispatch (`julius-allocation.v1`); these are the
# rows that prove which round was granted what, and what the ledger settled.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'allocatedUsdMicros' AS allocated_usd_micros,e.payload->'facts'->>'allocationBasis' AS allocation_basis,e.payload->'facts'->>'shareUsdMicros' AS share_usd_micros,e.payload->'facts'->>'remainingUsdMicros' AS remaining_usd_micros,e.payload->'facts'->>'allocationPolicy' AS allocation_policy,e.payload->'facts'->>'usdMicros' AS settled_usd_micros,e.payload->'facts'->>'costBasis' AS cost_basis,e.payload->'facts'->>'estimatedUsdMicros' AS estimated_usd_micros,e.payload->'facts'->>'reason' AS reason,e.payload->'facts'->>'slotRefusal' AS slot_refusal,e.payload->'facts'->>'reservationId' AS reservation_id,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.budget.allocated','julius.budget.reserved','julius.budget.settled','julius.budget.denied') ORDER BY e.stream_id,e.sequence" budget.tsv

# WHAT THE MISSION COST, PER ROLE, WITH THE UNKNOWN PART STILL VISIBLE.
#
# `budget.tsv` above holds every component; this is the arithmetic over them, done here so
# nobody has to do it by hand over a TSV — which is precisely how Live Run 3's $0.608861 came
# to be quoted as a mission total. That run settled ONE component with a runtime-reported
# figure and THREE with nothing at all, and the honest reading is "at least $0.61".
#
# THE THREE SUMS ARE DELIBERATELY NOT ONE.
#   `known_usd_micros`     — only PROVIDER_REPORTED and MEASURED_FROM_USAGE. Money someone was
#                            charged. A FLOOR whenever `unknown_components` is non-zero.
#   `estimated_usd_micros` — a harness's own arithmetic (Hermes writes an `estimated_cost` from
#                            token counts and its own price table). Recorded, never added to the
#                            known total: an estimate is not a bill.
#   `unknown_components`   — settlements that reported no amount at all. NOT zero-cost ones.
#
# Adding these three together would produce the very number this file exists to prevent.
dump "SELECT COALESCE(e.payload->'facts'->>'role','UNKNOWN_ROLE') AS role,count(*)::text AS components,COALESCE(sum(CASE WHEN e.payload->'facts'->>'costBasis' IN ('PROVIDER_REPORTED','MEASURED_FROM_USAGE') THEN (e.payload->'facts'->>'usdMicros')::numeric ELSE 0 END),0)::text AS known_usd_micros,COALESCE(sum(COALESCE((e.payload->'facts'->>'estimatedUsdMicros')::numeric,0)),0)::text AS estimated_usd_micros,count(*) FILTER (WHERE e.payload->'facts'->>'usdMicros' IS NULL)::text AS unknown_components,count(*) FILTER (WHERE e.payload->'facts'->>'costBasis'='ESTIMATED')::text AS estimated_components FROM relay_wonderland.events e WHERE e.event_type='julius.budget.settled' GROUP BY 1 ORDER BY 1" cost-accounting.tsv

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
#
# WHY AN ANSWER STOPPED EARLY.
#
# `provider_status`, `incomplete_reason`, `reasoning_tokens`, `max_output_tokens`
# and `total_tokens` are the architect's. Mission 4's first paid attempt bought
# 62 seconds of a reasoning model and returned `incomplete` with no plan, and
# `failure_shape` could only say `incomplete_response` — true, and no help in
# deciding what to change. These say what the reasoning consumed, the ceiling it
# consumed against, and the provider's own one word for stopping.
#
# ALL FIVE WERE ALLOWLISTED WITHOUT BEING EXPORTED, which is a half-wiring this
# bundle cannot survive: a `diag_` key that reaches the durable ledger and has no
# column here is destroyed with the database at the end of the job, and the
# operator learns nothing they did not already pay for. Mission 4's bundle
# carries none of them. A structural test now runs from the allowlist outward and
# fails when it admits a key this query does not select.
#
# WHY A BUILD FAILED, AS A CLASSIFICATION AND NEVER A QUOTATION.
#
# `failure_reason` is the Coding Agent's. The hosted runner reduces a provider
# error to a fixed sentence by deliberate design — a provider error can quote the
# request, and the request can quote the credential — so Mission 5's coder failed
# in 81 seconds having spent six of its twenty-six turns, and nothing in the
# bundle could say why. The classifier MATCHES the thrown error, and the
# runtime's own final text, against a pattern table and returns a constant of its
# own; no substring of either travels. The reason is recordable and the text
# still never leaves.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,t.role,e.payload->'facts'->>'diag_stage' AS stage,e.payload->'facts'->>'diag_transport' AS transport,e.payload->'facts'->>'diag_provider' AS provider,e.payload->'facts'->>'diag_servedModel' AS served_model,e.payload->'facts'->>'diag_processExitCode' AS process_exit_code,e.payload->'facts'->>'diag_timedOut' AS timed_out,e.payload->'facts'->>'diag_outputBytesObserved' AS output_bytes_observed,e.payload->'facts'->>'diag_outputByteLimit' AS output_byte_limit,e.payload->'facts'->>'diag_outputTruncated' AS output_truncated,e.payload->'facts'->>'diag_jsonDetected' AS json_detected,e.payload->'facts'->>'diag_jsonParseable' AS json_parseable,e.payload->'facts'->>'diag_reviewObjectCount' AS review_object_count,e.payload->'facts'->>'diag_verdictPresent' AS verdict_present,e.payload->'facts'->>'diag_verdictValid' AS verdict_valid,e.payload->'facts'->>'diag_summaryPresent' AS summary_present,e.payload->'facts'->>'diag_failureShape' AS failure_shape,e.payload->'facts'->>'diag_providerHttpStatus' AS provider_http_status,e.payload->'facts'->>'diag_serviceHttpStatus' AS service_http_status,e.payload->'facts'->>'diag_processStarted' AS process_started,e.payload->'facts'->>'diag_processPidObserved' AS process_pid_observed,e.payload->'facts'->>'diag_firstOutputObserved' AS first_output_observed,e.payload->'facts'->>'diag_firstOutputAfterMs' AS first_output_after_ms,e.payload->'facts'->>'diag_elapsedMs' AS elapsed_ms,e.payload->'facts'->>'diag_timeoutMs' AS timeout_ms,e.payload->'facts'->>'diag_exitObserved' AS exit_observed,e.payload->'facts'->>'diag_signalSent' AS signal_sent,e.payload->'facts'->>'diag_cleanupCompleted' AS cleanup_completed,e.payload->'facts'->>'diag_providerRequestStarted' AS provider_request_started,e.payload->'facts'->>'diag_packetBytes' AS packet_bytes,e.payload->'facts'->>'diag_requestedModel' AS requested_model,e.payload->'facts'->>'diag_responseId' AS response_id,e.payload->'facts'->>'diag_validationPassed' AS validation_passed,e.payload->'facts'->>'diag_validationReasonCode' AS validation_reason_code,e.payload->'facts'->>'diag_validationField' AS validation_field,e.payload->'facts'->>'diag_validationClaimPhrase' AS validation_claim_phrase,e.payload->'facts'->>'diag_planAttempts' AS plan_attempts,e.payload->'facts'->>'diag_reviewAttempts' AS review_attempts,e.payload->'facts'->>'attempt' AS dispatch_attempt,e.payload->'facts'->>'diag_resultSubtype' AS result_subtype,e.payload->'facts'->>'diag_isError' AS is_error,e.payload->'facts'->>'diag_failureReason' AS failure_reason,e.payload->'facts'->>'diag_numTurns' AS num_turns,e.payload->'facts'->>'diag_toolUseCount' AS tool_use_count,e.payload->'facts'->>'diag_permissionDenials' AS permission_denials,e.payload->'facts'->>'diag_implementationPresent' AS implementation_present,e.payload->'facts'->>'diag_costUsdMicros' AS cost_usd_micros,e.payload->'facts'->>'diag_costCeilingUsdMicros' AS cost_ceiling_usd_micros,e.payload->'facts'->>'diag_costSource' AS cost_source,e.payload->'facts'->>'diag_runtimeStarted' AS runtime_started,e.payload->'facts'->>'diag_outcome' AS outcome,e.payload->'facts'->>'diag_startedAt' AS started_at,e.payload->'facts'->>'diag_completedAt' AS completed_at,e.payload->'facts'->>'diag_contractRevision' AS contract_revision,e.payload->'facts'->>'diag_contractBindingDigest' AS contract_binding_digest,e.payload->'facts'->>'diag_costBasis' AS cost_basis,e.payload->'facts'->>'diag_estimatedCostUsdMicros' AS estimated_cost_usd_micros,e.payload->'facts'->>'diag_inputTokens' AS input_tokens,e.payload->'facts'->>'diag_outputTokens' AS output_tokens,e.payload->'facts'->>'diag_providerStatus' AS provider_status,e.payload->'facts'->>'diag_incompleteReason' AS incomplete_reason,e.payload->'facts'->>'diag_reasoningTokens' AS reasoning_tokens,e.payload->'facts'->>'diag_maxOutputTokens' AS max_output_tokens,e.payload->'facts'->>'diag_totalTokens' AS total_tokens,e.payload->'facts'->>'diag_participationPresent' AS participation_present,e.payload->'facts'->>'diag_participationReadable' AS participation_readable,e.payload->'facts'->>'diag_participationRefusal' AS participation_refusal,e.payload->'facts'->>'diag_participationAskedGuidance' AS participation_asked_guidance,e.payload->'facts'->>'diag_participationAskedResearch' AS participation_asked_research,e.payload->'facts'->>'diag_participationAskedResume' AS participation_asked_resume,e.payload->'facts'->>'evidenceCount' AS evidence_count,e.event_type,e.payload->'facts'->>'code' AS julius_code,e.payload->'facts'->>'errorRetryable' AS retryable,e.occurred_at FROM relay_wonderland.events e LEFT JOIN relay_wonderland.julius_tasks t ON t.task_id=e.payload->>'taskId' WHERE e.payload->'facts'->>'diag_transport' IS NOT NULL ORDER BY e.stream_id,e.sequence" worker-diagnostics.tsv

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

# WHAT HAPPENED TO THE AGREEMENT, as identifiers and tokens only. A refusal here is the
# reason a coder or reviewer was NOT dispatched — a stale handoff, a review that did not hold
# the coder's binding, a lock that was never taken — and without it the bundle could show a
# task FAILED under a contract that looks perfectly locked. No terms, no prose: revisions,
# digests, task ids and the closed reason code. A bound task's CLAIM is here too — the revision
# and digest the coder and the reviewer actually executed under — so the gate can compare what
# was locked with what was run, rather than trusting that the two are one document.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'disposition' AS disposition,e.payload->'facts'->>'evaluatorId' AS evaluator_id,e.payload->'facts'->>'evidenceCount' AS evidence_count,e.payload->'facts'->>'evidenceIds' AS evidence_ids,e.payload->'facts'->>'contractTaskId' AS contract_task_id,e.payload->'facts'->>'contractId' AS contract_id,e.payload->'facts'->>'contractRevision' AS contract_revision,e.payload->'facts'->>'bindingDigest' AS binding_digest,e.payload->'facts'->>'recordedRevision' AS recorded_revision,e.payload->'facts'->>'currentRevision' AS current_revision,e.payload->'facts'->>'reviewRevision' AS review_revision,e.payload->'facts'->>'implementationRevision' AS implementation_revision,e.payload->'facts'->>'role' AS role,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN('julius.contract.proposed','julius.contract.challenged','julius.contract.locked','julius.contract.refused','julius.contract.disposition') OR (e.event_type='julius.task.claimed' AND e.payload->'facts'->>'contractId' IS NOT NULL) ORDER BY e.stream_id,e.sequence" contract-events.tsv

# WHAT THE RUN DID, ROW BY ROW. The trajectory is the record evals read: every context compile,
# dispatch, retry, finding, verification and repair round, with the worker and provider that
# answered, what it cost, how long it took, and — for a bound task — the contract revision and
# digest it ran under. Without it the bundle can show what a run ENDED as and not the path it
# took there; a paid rerun's repair path and cost are these rows. `safe_facts` is the closed
# vocabulary the runtime writes, never prose.
# WHAT EACH WORKER DID, AND WHEN — the rows the paid proof's own questions are
# answered from.
#
# §6.5 of `docs/JULIUS_CONTINUOUS_ARMING.md` names, for each of the eight
# questions the paid run exists to answer, the FIELD that answers it. Five of
# those fields are carried by three event types, and not one of the three was
# exported: `worker.effort`, the checkpoint pair, and the research pair reached
# the durable ledger and were destroyed with the database, because this script
# is the only hop that survives the job. This is the same defect #250 repaired
# for the architect diagnostics — "they reached the durable ledger and were
# destroyed with the database" — arriving again one layer up, and it is why a
# bundle could have been collected, ordered correctly, published, and still
# answered none of A, C, E or G.
#
# NAMED FACT KEYS ONLY, as everywhere else here. Every value is a count, a
# digest, a closed-union token or one of this repository's own identifiers:
# `role` and `taskType` are source literals, `outcome` is one of eight research
# outcomes, `settlementBasis` one of five cost bases, `trigger` / `origin` /
# `route` / `reasonCode` are closed unions, `requestKey` is a task id with an
# index, and every `*Digest` is a hash Julius computed. No prose, no packet, no
# provider text and no whole payload has a column in any of them.

# EFFORT. Every dimension is nullable on purpose and a blank means UNKNOWN, never
# zero: `brainRetrievals` and `evidenceInspected` are Julius's own measurements
# and are null when no context was compiled, and `checkpoints` and
# `guidanceConsumed` are not on the row at all because nothing in the runtime
# knows them. A reader must be able to tell "the provider reported nothing" from
# "the provider reported none", which is the whole reason these are separate
# columns rather than a rollup.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'taskType' AS task_type,e.payload->'facts'->>'inputTokens' AS input_tokens,e.payload->'facts'->>'outputTokens' AS output_tokens,e.payload->'facts'->>'reasoningTokens' AS reasoning_tokens,e.payload->'facts'->>'toolCalls' AS tool_calls,e.payload->'facts'->>'researchCalls' AS research_calls,e.payload->'facts'->>'activeMs' AS active_ms,e.payload->'facts'->>'providerCalls' AS provider_calls,e.payload->'facts'->>'brainRetrievals' AS brain_retrievals,e.payload->'facts'->>'evidenceInspected' AS evidence_inspected,e.payload->'facts'->>'allocatedUsdMicros' AS allocated_usd_micros,e.payload->'facts'->>'settledUsdMicros' AS settled_usd_micros,e.payload->'facts'->>'settlementBasis' AS settlement_basis,e.payload->'facts'->>'evidenceGenerated' AS evidence_generated,e.payload->'facts'->>'repairRounds' AS repair_rounds,e.payload->'facts'->>'guidanceGenerated' AS guidance_generated,e.payload->'facts'->>'reviewerVerdicts' AS reviewer_verdicts,e.payload->'facts'->>'effortVersion' AS effort_version,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type='julius.worker.effort' ORDER BY e.stream_id,e.sequence" effort.tsv

# PARTICIPATION — whether a worker ever STOPPED, asked, and was made to wait.
# A checkpoint that minted no continuation stopped a worker without giving it
# anywhere to resume, which is a stall rather than a barrier working, so the
# route and its reason are exported beside the checkpoint itself. The
# checkpoint's own `sequence` is its position within one dispatch and is NOT the
# ledger's; it is exported as `checkpoint_sequence` so the two can never be read
# as the same number.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'checkpointId' AS checkpoint_id,e.payload->'facts'->>'trigger' AS trigger,e.payload->'facts'->>'origin' AS origin,e.payload->'facts'->>'sequence' AS checkpoint_sequence,e.payload->'facts'->>'evidenceCount' AS evidence_count,e.payload->'facts'->>'route' AS route,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'wouldHaveRouted' AS would_have_routed,e.payload->'facts'->>'stage' AS stage,e.payload->'facts'->>'guidanceId' AS guidance_id,e.payload->'facts'->>'guidanceRevision' AS guidance_revision,e.payload->'facts'->>'guidanceDigest' AS guidance_digest,e.payload->'facts'->>'recommendedActions' AS recommended_actions,e.payload->'facts'->>'additionalProhibitions' AS additional_prohibitions,e.payload->'facts'->>'references' AS reference_count,e.payload->'facts'->>'contractRevision' AS contract_revision,e.payload->'facts'->>'contractBindingDigest' AS contract_binding_digest,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.checkpoint.recorded','julius.checkpoint.verdict','julius.guidance.issued','julius.guidance.refused','julius.guidance.deferred') ORDER BY e.stream_id,e.sequence" participation.tsv

# RESEARCH. These rows are the research budget's durable truth — the mediator
# PROJECTS its per-role meter by folding them — so a bundle without them cannot
# show that a restart remembered what a slot had already spent, and cannot show
# that all three slots were able to reach the outside world at all. The eight
# outcomes are never collapsed into "no evidence": a refusal, an exhausted
# budget, a throttle, an unreachable host and a page that signalled injection
# are five different facts. `counted` is whether the ask was CHARGED, which is
# not the same as whether it succeeded.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'requestKey' AS request_key,e.payload->'facts'->>'outcome' AS outcome,e.payload->'facts'->>'counted' AS counted,e.payload->'facts'->>'evidenceId' AS evidence_id,e.payload->'facts'->>'signalled' AS injection_signals,e.payload->'facts'->>'segment' AS segment,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'stage' AS stage,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.research.retrieved','julius.research.refused') ORDER BY e.stream_id,e.sequence" research.tsv

dump "SELECT event_kind,task_id,worker_id,provider_id,outcome,usd_micros,duration_ms,input_tokens,output_tokens,safe_facts,occurred_at FROM relay_wonderland.julius_trajectory_events ORDER BY occurred_at,trajectory_event_id" trajectory.tsv
