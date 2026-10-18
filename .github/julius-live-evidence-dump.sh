#!/usr/bin/env bash
# Dumps the safe columns of the Julius tables the first-live mission writes, one TSV per table,
# into the directory given as the first argument. Only safe columns: no environment dump, no
# config, no packet text, no credential-bearing row. The one exception is `artifacts/`: the work
# artifacts' bodies, as the founder approved (decision A), checked before they are copied and
# scanned before the bundle is uploaded (see "THE WORK ARTIFACTS" below).
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

# WHICH CODE, WHICH WORKFLOW RUN, WHICH MODE AND WHICH JULIUS RUN THIS BUNDLE IS.
#
# A bundle used to carry none of them, so the Beta Gate scored any bundle against whatever tree
# read it: paid run 36568129865's bundle, produced at main, "proved" at a stack code it never ran,
# and a free dry run's executor receipts read as a paid mission's. `bundle-manifest.txt` is written
# FIRST, so a dump that stops half way still says what it was, and the gate refuses to let a
# bundle's mission rows PASS when the manifest is missing, names another commit, is not
# `mode=paid`, or names no Julius run.
#
# Machine tokens only: a commit, a tree, the workflow run and attempt, the event, the mode and the
# run id the entrypoint's own accepted line names. Nothing is read from a provider, a prompt or a
# secret. Every value is reduced to a token alphabet, and every command is guarded: this script
# runs under `set -e`, and a manifest that could abort the dump would cost the evidence it names.
#
# COMMIT is `git rev-parse HEAD` of the checkout that ran this dump, taken now: on a runner the
# job's own checkout (for a `pull_request` event, GitHub's merge commit, never the PR head), off a
# runner the launcher's checkout, which refuses to dump from any commit but the one its rig ran.
# The Beta Gate binds a bundle only when it is read at exactly that commit, and only when
# `tracked_changes` is 0.
#
# MODE. On a runner the dispatch input decides it: a `workflow_dispatch` whose `confirm_live` is
# exactly `RUN LIVE MISSION` is the one paid path the mission workflow has. Anything else — a
# preflight, a pull-request regression, an unreadable event — is not paid. Off a runner the
# launcher must declare it (`JULIUS_EVIDENCE_MODE=paid|preflight`); undeclared is `unknown`, which
# the gate reads as not paid.
manifest_token() { printf '%s' "${1:-}" | tr -c 'A-Za-z0-9._:/@#+=-' '_' | cut -c1-200; }
write_manifest() {
  local commit tree tracked status mode mode_basis source run_id accepted count
  commit=$(git rev-parse HEAD 2>/dev/null || echo unknown)
  tree=$(git rev-parse 'HEAD^{tree}' 2>/dev/null || echo unknown)
  if status=$(git status --porcelain --untracked-files=no 2>/dev/null); then
    tracked=$(printf '%s' "$status" | grep -c . || true)
  else
    tracked=unknown
  fi
  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    source=github-actions
    if [ ! -r "${GITHUB_EVENT_PATH:-}" ]; then
      mode=unknown; mode_basis=event_unreadable
    elif [ "${GITHUB_EVENT_NAME:-}" = workflow_dispatch ] \
      && grep -Eq '"confirm_live"[[:space:]]*:[[:space:]]*"RUN LIVE MISSION"' "$GITHUB_EVENT_PATH"; then
      mode=paid; mode_basis=dispatch_confirm_live
    else
      mode=preflight; mode_basis="$(manifest_token "${GITHUB_EVENT_NAME:-unknown}")_not_confirmed_live"
    fi
  else
    source=local
    case "${JULIUS_EVIDENCE_MODE:-}" in
      paid|preflight) mode=$JULIUS_EVIDENCE_MODE; mode_basis=launcher_declared ;;
      *) mode=unknown; mode_basis=undeclared ;;
    esac
  fi
  # THE RUN THIS BUNDLE IS ABOUT, in the entrypoint's own words: the one `Run … accepted` line of
  # the mission evidence the workflow and the local launcher both rebuild before this dump runs.
  # None, or more than one, is `none`: the gate then scopes nothing to a run it would have guessed.
  run_id=none
  if [ -f "$out/live-mission.evidence.txt" ]; then
    accepted=$(sed -n 's/^Run \([^ ]*\) accepted in state READY; driving the Julius run loop\.$/\1/p' "$out/live-mission.evidence.txt" | sort -u || true)
    count=$(printf '%s' "$accepted" | grep -c . || true)
    [ "$count" = 1 ] && run_id=$accepted
  fi
  {
    echo 'manifest_version=1'
    echo "source=$source"
    echo "commit=$(manifest_token "$commit")"
    echo "tree=$(manifest_token "$tree")"
    echo "tracked_changes=$(manifest_token "$tracked")"
    echo "mode=$mode"
    echo "mode_basis=$(manifest_token "$mode_basis")"
    echo "julius_run_id=$(manifest_token "$run_id")"
    echo "workflow_run_id=$(manifest_token "${GITHUB_RUN_ID:-none}")"
    echo "workflow_run_attempt=$(manifest_token "${GITHUB_RUN_ATTEMPT:-none}")"
    echo "workflow_ref=$(manifest_token "${GITHUB_WORKFLOW_REF:-none}")"
    echo "event=$(manifest_token "${GITHUB_EVENT_NAME:-none}")"
    echo "ref=$(manifest_token "${GITHUB_REF:-none}")"
    echo "github_sha=$(manifest_token "${GITHUB_SHA:-none}")"
    echo "produced_at=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)"
  } > "$out/bundle-manifest.txt"
  echo "JULIUS_EVIDENCE_MANIFEST mode=$mode commit=$(manifest_token "$commit") julius_run_id=$(manifest_token "$run_id") workflow_run_id=$(manifest_token "${GITHUB_RUN_ID:-none}")"
}
write_manifest || echo 'JULIUS_EVIDENCE_MANIFEST unavailable'

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
#
# EVERY FILE NAMES ITS RUN. The Beta Gate scopes each file to the one run the manifest names, so a
# database that also holds an older, completed run (a rerun on one rig) cannot decide this run's
# verdicts. `run_id` is APPENDED where a table carries it, so no column a reader uses moves.
# `execution_sessions` has no run: it is scoped by the run's mission instead.
#
# WHAT A VERDICT RESTED ON (B5). `evidence.tsv` carries the task each row belongs to and its
# `integrity_hash` (the DIFF's is the sha256 of the bytes a review judged), and `decisions.tsv` and
# `findings.tsv` carry the `evidence_ids` they cite, so "the re-review accepted citing the repair's
# evidence" is readable from the artifact rather than asserted about it.
#
# HOW EACH TOOL INVOCATION ENDED. `exit_code` tells a test that ran and failed (settled, the thing
# the repair loop exists for) from an invocation that never settled; `recovery_state` names the
# UNKNOWN_OUTCOME the terminal sweep closes an unsettled one as; `task_id` ties it to its task.
dump "SELECT run_id,mission_id,state,card_revision,created_at,updated_at FROM relay_wonderland.julius_runs ORDER BY created_at" runs.tsv
dump "SELECT task_id,task_type,role,state,ordinal,parent_task_id,run_id,lease_generation FROM relay_wonderland.julius_tasks ORDER BY ordinal,task_id" tasks.tsv
dump "SELECT evidence_id,evidence_type,status,safe_summary,occurred_at,run_id,task_id,integrity_hash,artifact_ref FROM relay_wonderland.julius_evidence ORDER BY occurred_at" evidence.tsv
dump "SELECT decision_id,task_id,action,reason_code,occurred_at,run_id,evidence_ids FROM relay_wonderland.julius_verification_decisions ORDER BY occurred_at" decisions.tsv
dump "SELECT finding_id,blocking,status,claim,run_id,task_id,evidence_ids FROM relay_wonderland.julius_reviewer_findings ORDER BY created_at" findings.tsv
dump "SELECT invocation_id,tool_id,state,requested_at,run_id,task_id,exit_code,recovery_state,completed_at FROM relay_wonderland.julius_tool_invocations ORDER BY requested_at" tool-invocations.tsv

# THE WORK ARTIFACTS THE EVIDENCE NAMES, AND THEIR BODIES (founder decision A, 2026-10-03). `evidence.tsv` carries
# each row's `artifact_ref` (`artifact:<artifact_id>`, appended last) beside its `integrity_hash`;
# `work-artifacts.tsv` is the record of every body the run stored (content_hash, byte size, storage_ref; never the
# body). The bodies themselves are copied into `artifacts/` by `scripts/julius-evidence-bodies.mjs`, which checks each
# against its row before copying a byte and records every row's outcome in `artifacts/BODIES.tsv`. The bundle carries
# its own resolver, `resolve-artifacts.mjs`, which verifies both hashes from the bundle's files alone.
# HERE THE BUNDLE STOPS BEING TOKENS ONLY: the bodies are text the run's workers wrote (plans, diffs, test output),
# as the founder approved, and no TSV column carries them. The credential scan that runs after this dump drops a body
# that trips it and records the drop (DROPPED_BY_SCAN); a hit anywhere else still refuses the whole bundle.
dump "SELECT artifact_id,project_id,run_id,task_id,lease_generation,role,kind,content_type,byte_size,content_hash,storage_ref,occurred_at,created_at FROM relay_wonderland.julius_work_artifacts ORDER BY occurred_at,artifact_id" work-artifacts.tsv
# Both run from the checkout root, as every workflow runs this script (./.github/julius-live-evidence-dump.sh) and
# as julius-live-hermes.sh runs its own node entry: the repository boundary scan must be able to read the file node
# runs, and a path built at run time ("$here/...") is unanalyzable by design.
node scripts/julius-evidence-bodies.mjs "$out" || echo "julius-evidence-bodies: exited $?" >&2
cp scripts/julius-evidence-resolve.mjs "$out/resolve-artifacts.mjs" || echo 'julius-evidence-dump: resolve-artifacts.mjs was not copied' >&2

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
# Each settlement also says HOW it was paid for (`billing_path`) and, beside a
# NOT_APPLICABLE basis, the runtime's own price (`execution_usd_micros`). This
# database dies with the runner, so without these two columns no bundle could
# show a subscription settlement was never counted as API spend.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'allocatedUsdMicros' AS allocated_usd_micros,e.payload->'facts'->>'allocationBasis' AS allocation_basis,e.payload->'facts'->>'shareUsdMicros' AS share_usd_micros,e.payload->'facts'->>'remainingUsdMicros' AS remaining_usd_micros,e.payload->'facts'->>'allocationPolicy' AS allocation_policy,e.payload->'facts'->>'usdMicros' AS settled_usd_micros,e.payload->'facts'->>'costBasis' AS cost_basis,e.payload->'facts'->>'estimatedUsdMicros' AS estimated_usd_micros,e.payload->'facts'->>'billingPath' AS billing_path,e.payload->'facts'->>'executionUsdMicros' AS execution_usd_micros,e.payload->'facts'->>'reason' AS reason,e.payload->'facts'->>'slotRefusal' AS slot_refusal,e.payload->'facts'->>'reservationId' AS reservation_id,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.budget.allocated','julius.budget.reserved','julius.budget.settled','julius.budget.denied') ORDER BY e.stream_id,e.sequence" budget.tsv

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
# AN UNSETTLED RESERVATION IS AN UNKNOWN COMPONENT, never $0 and never absent.
#
# A reservation whose settlement could not be written (#297: the store failed after the result
# was accepted, and the hold was deliberately NOT released) has a `budget.reserved` row and no
# `budget.settled` row. Counting settled rows alone made it vanish from this rollup, so a mission
# could read as cheaper than it was. It now counts as a component whose spend is unknown, and
# `unsettled_components` says how many of the unknowns are that case. Settled rows remain the
# ONLY source of known spend: a reservation is never a charge.
#
# PER RUN AS WELL AS PER ROLE: a database holding two runs (a rerun on one rig) would otherwise add
# one run's spend to another's under the same role.
dump "SELECT c.run_id,COALESCE(c.role,'UNKNOWN_ROLE') AS role,count(*)::text AS components,COALESCE(sum(CASE WHEN c.basis IN ('PROVIDER_REPORTED','MEASURED_FROM_USAGE') THEN c.usd::numeric ELSE 0 END),0)::text AS known_usd_micros,COALESCE(sum(COALESCE(c.estimated::numeric,0)),0)::text AS estimated_usd_micros,count(*) FILTER (WHERE c.usd IS NULL)::text AS unknown_components,count(*) FILTER (WHERE c.basis='ESTIMATED')::text AS estimated_components,count(*) FILTER (WHERE c.unsettled)::text AS unsettled_components FROM (SELECT e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'costBasis' AS basis,e.payload->'facts'->>'usdMicros' AS usd,e.payload->'facts'->>'estimatedUsdMicros' AS estimated,false AS unsettled,e.stream_id AS run_id FROM relay_wonderland.events e WHERE e.event_type='julius.budget.settled' UNION ALL SELECT r.payload->'facts'->>'role',NULL,NULL,NULL,true,r.stream_id FROM relay_wonderland.events r WHERE r.event_type='julius.budget.reserved' AND NOT EXISTS (SELECT 1 FROM relay_wonderland.events s WHERE s.event_type='julius.budget.settled' AND s.stream_id=r.stream_id AND s.payload->'facts'->>'reservationId'=r.payload->'facts'->>'reservationId')) c GROUP BY 1,2 ORDER BY 1,2" cost-accounting.tsv

# SETTLEMENT INTEGRITY: a reservation settled more than once is FLAGGED, never deduplicated.
#
# The rollup above sums every settled row, deliberately: deduplicating would hide the defect
# #297 fixed (a release after a commit wrote a second `budget.settled`, and the spend was counted
# twice). This file lists every reservation with more than one settled row. An empty file is the
# healthy answer. The count is printed on its own line, so a regression is visible in the job log
# without anyone opening the bundle.
dump "SELECT e.stream_id AS run_id,e.payload->'facts'->>'reservationId' AS reservation_id,COALESCE(e.payload->'facts'->>'role','UNKNOWN_ROLE') AS role,count(*)::text AS settled_rows FROM relay_wonderland.events e WHERE e.event_type='julius.budget.settled' GROUP BY 1,2,3 HAVING count(*) > 1 ORDER BY 1,2" settlement-integrity.tsv
if [ "$(head -n 1 "$out/settlement-integrity.tsv")" = 'unavailable' ]; then
  echo 'JULIUS_SETTLEMENT_INTEGRITY unavailable'
else
  echo "JULIUS_SETTLEMENT_INTEGRITY duplicate_reservations=$(tail -n +2 "$out/settlement-integrity.tsv" | grep -cv '^(' || true)"
fi

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
# WHAT SERVED THE CODING AGENT, AND THE THREE ACCOUNTS BEHIND THE ANSWER.
#
# `served_model` was the model the runtime's `init` message ANNOUNCED, before any
# turn existed. Paid attempt 1 announced `claude-fable-5` and its only turn produced
# zero tokens, so the bundle said a model served when none had. The coder's
# `served_model` is now named only when the output-bearing turns and the result's own
# `modelUsage` agree on one model, and `served_model_basis` says why when they do not.
# The accounts travel beside the verdict so a reader can check it:
#   - `served_model_usage_key` and `served_model_usage_canonical` are the key and the SDK's
#     `canonicalModel` of the `modelUsage` entry that credited the served model. They are
#     the only mapping a requested-versus-served comparison may use; never a prefix;
#   - `announced_model` is what init claimed;
#   - `turn_model` and `turn_model_count` are what the turns named;
#   - `result_model_count` and the `result_model_first`, `_second` and `_third`
#     entries are the runtime's own final accounting, largest producer first.
# Appended after the existing columns, so no column a reader already uses moves.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,t.role,e.payload->'facts'->>'diag_stage' AS stage,e.payload->'facts'->>'diag_transport' AS transport,e.payload->'facts'->>'diag_provider' AS provider,e.payload->'facts'->>'diag_servedModel' AS served_model,e.payload->'facts'->>'diag_processExitCode' AS process_exit_code,e.payload->'facts'->>'diag_timedOut' AS timed_out,e.payload->'facts'->>'diag_outputBytesObserved' AS output_bytes_observed,e.payload->'facts'->>'diag_outputByteLimit' AS output_byte_limit,e.payload->'facts'->>'diag_outputTruncated' AS output_truncated,e.payload->'facts'->>'diag_jsonDetected' AS json_detected,e.payload->'facts'->>'diag_jsonParseable' AS json_parseable,e.payload->'facts'->>'diag_reviewObjectCount' AS review_object_count,e.payload->'facts'->>'diag_verdictPresent' AS verdict_present,e.payload->'facts'->>'diag_verdictValid' AS verdict_valid,e.payload->'facts'->>'diag_summaryPresent' AS summary_present,e.payload->'facts'->>'diag_failureShape' AS failure_shape,e.payload->'facts'->>'diag_storeErrorClass' AS store_error_class,e.payload->'facts'->>'diag_providerHttpStatus' AS provider_http_status,e.payload->'facts'->>'diag_serviceHttpStatus' AS service_http_status,e.payload->'facts'->>'diag_processStarted' AS process_started,e.payload->'facts'->>'diag_processPidObserved' AS process_pid_observed,e.payload->'facts'->>'diag_firstOutputObserved' AS first_output_observed,e.payload->'facts'->>'diag_firstOutputAfterMs' AS first_output_after_ms,e.payload->'facts'->>'diag_elapsedMs' AS elapsed_ms,e.payload->'facts'->>'diag_timeoutMs' AS timeout_ms,e.payload->'facts'->>'diag_exitObserved' AS exit_observed,e.payload->'facts'->>'diag_signalSent' AS signal_sent,e.payload->'facts'->>'diag_cleanupCompleted' AS cleanup_completed,e.payload->'facts'->>'diag_providerRequestStarted' AS provider_request_started,e.payload->'facts'->>'diag_packetBytes' AS packet_bytes,e.payload->'facts'->>'diag_requestedModel' AS requested_model,e.payload->'facts'->>'diag_responseId' AS response_id,e.payload->'facts'->>'diag_validationPassed' AS validation_passed,e.payload->'facts'->>'diag_validationReasonCode' AS validation_reason_code,e.payload->'facts'->>'diag_validationField' AS validation_field,e.payload->'facts'->>'diag_validationClaimPhrase' AS validation_claim_phrase,e.payload->'facts'->>'diag_planAttempts' AS plan_attempts,e.payload->'facts'->>'diag_reviewAttempts' AS review_attempts,e.payload->'facts'->>'diag_reviewReaskShape' AS review_reask_shape,e.payload->'facts'->>'diag_engineApiCalls' AS engine_api_calls,e.payload->'facts'->>'diag_executorStep' AS executor_step,e.payload->'facts'->>'diag_executorRefusal' AS executor_refusal,e.payload->'facts'->>'diag_executorRefusalField' AS executor_refusal_field,e.payload->'facts'->>'attempt' AS dispatch_attempt,e.payload->'facts'->>'diag_resultSubtype' AS result_subtype,e.payload->'facts'->>'diag_isError' AS is_error,e.payload->'facts'->>'diag_terminalReason' AS terminal_reason,e.payload->'facts'->>'diag_resultClass' AS result_class,e.payload->'facts'->>'diag_failureReason' AS failure_reason,e.payload->'facts'->>'diag_numTurns' AS num_turns,e.payload->'facts'->>'diag_toolUseCount' AS tool_use_count,e.payload->'facts'->>'diag_permissionDenials' AS permission_denials,e.payload->'facts'->>'diag_implementationPresent' AS implementation_present,e.payload->'facts'->>'diag_costUsdMicros' AS cost_usd_micros,e.payload->'facts'->>'diag_costCeilingUsdMicros' AS cost_ceiling_usd_micros,e.payload->'facts'->>'diag_costSource' AS cost_source,e.payload->'facts'->>'diag_runtimeStarted' AS runtime_started,e.payload->'facts'->>'diag_outcome' AS outcome,e.payload->'facts'->>'diag_startedAt' AS started_at,e.payload->'facts'->>'diag_completedAt' AS completed_at,e.payload->'facts'->>'diag_contractRevision' AS contract_revision,e.payload->'facts'->>'diag_contractBindingDigest' AS contract_binding_digest,e.payload->'facts'->>'diag_costBasis' AS cost_basis,e.payload->'facts'->>'diag_billingPath' AS billing_path,e.payload->'facts'->>'diag_executionCostUsdMicros' AS execution_cost_usd_micros,e.payload->'facts'->>'diag_estimatedCostUsdMicros' AS estimated_cost_usd_micros,e.payload->'facts'->>'diag_inputTokens' AS input_tokens,e.payload->'facts'->>'diag_cachedInputTokens' AS cached_input_tokens,e.payload->'facts'->>'diag_outputTokens' AS output_tokens,e.payload->'facts'->>'diag_providerStatus' AS provider_status,e.payload->'facts'->>'diag_incompleteReason' AS incomplete_reason,e.payload->'facts'->>'diag_reasoningTokens' AS reasoning_tokens,e.payload->'facts'->>'diag_maxOutputTokens' AS max_output_tokens,e.payload->'facts'->>'diag_totalTokens' AS total_tokens,e.payload->'facts'->>'diag_streamUsageMessages' AS stream_usage_messages,e.payload->'facts'->>'diag_streamAbortedMessages' AS stream_aborted_messages,e.payload->'facts'->>'diag_streamInputTokens' AS stream_input_tokens,e.payload->'facts'->>'diag_streamOutputTokens' AS stream_output_tokens,e.payload->'facts'->>'diag_streamCacheReadInputTokens' AS stream_cache_read_input_tokens,e.payload->'facts'->>'diag_streamCacheCreationInputTokens' AS stream_cache_creation_input_tokens,e.payload->'facts'->>'diag_participationPresent' AS participation_present,e.payload->'facts'->>'diag_participationReadable' AS participation_readable,e.payload->'facts'->>'diag_participationRefusal' AS participation_refusal,e.payload->'facts'->>'diag_participationAskedGuidance' AS participation_asked_guidance,e.payload->'facts'->>'diag_participationAskedResearch' AS participation_asked_research,e.payload->'facts'->>'diag_participationAskedResume' AS participation_asked_resume,e.payload->'facts'->>'diag_participationAskedReport' AS participation_asked_report,e.payload->'facts'->>'diag_participationAskedObservations' AS participation_asked_observations,e.payload->'facts'->>'diag_codingAgentProvider' AS coding_agent_provider,e.payload->'facts'->>'diag_codingAgentFailure' AS coding_agent_failure,e.payload->'facts'->>'diag_operatorActionRequired' AS operator_action_required,e.payload->'facts'->>'evidenceCount' AS evidence_count,e.event_type,e.payload->'facts'->>'code' AS julius_code,e.payload->'facts'->>'errorRetryable' AS retryable,e.occurred_at,e.payload->'facts'->>'diag_servedModelBasis' AS served_model_basis,e.payload->'facts'->>'diag_servedModelUsageKey' AS served_model_usage_key,e.payload->'facts'->>'diag_servedModelUsageCanonical' AS served_model_usage_canonical,e.payload->'facts'->>'diag_announcedModel' AS announced_model,e.payload->'facts'->>'diag_turnModel' AS turn_model,e.payload->'facts'->>'diag_turnModelCount' AS turn_model_count,e.payload->'facts'->>'diag_resultModelCount' AS result_model_count,e.payload->'facts'->>'diag_resultModelFirst' AS result_model_first,e.payload->'facts'->>'diag_resultModelFirstInputTokens' AS result_model_first_input_tokens,e.payload->'facts'->>'diag_resultModelFirstOutputTokens' AS result_model_first_output_tokens,e.payload->'facts'->>'diag_resultModelSecond' AS result_model_second,e.payload->'facts'->>'diag_resultModelSecondInputTokens' AS result_model_second_input_tokens,e.payload->'facts'->>'diag_resultModelSecondOutputTokens' AS result_model_second_output_tokens,e.payload->'facts'->>'diag_resultModelThird' AS result_model_third,e.payload->'facts'->>'diag_resultModelThirdInputTokens' AS result_model_third_input_tokens,e.payload->'facts'->>'diag_resultModelThirdOutputTokens' AS result_model_third_output_tokens FROM relay_wonderland.events e LEFT JOIN relay_wonderland.julius_tasks t ON t.task_id=e.payload->>'taskId' WHERE e.payload->'facts'->>'diag_transport' IS NOT NULL ORDER BY e.stream_id,e.sequence" worker-diagnostics.tsv

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
dump "SELECT entry_id,entry_kind,worker_id,task_id,revision,created_at,run_id FROM relay_wonderland.julius_brain_entries ORDER BY revision" project-brain.tsv
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
dump "SELECT contract_id,contract_revision,task_id,state,binding_digest,locked_at,locked_by_evaluator_id,created_at,run_id FROM relay_wonderland.julius_task_contracts ORDER BY contract_id,contract_revision" task-contracts.tsv

# WHAT HAPPENED TO THE AGREEMENT, as identifiers and tokens only. A refusal here is the
# reason a coder or reviewer was NOT dispatched — a stale handoff, a review that did not hold
# the coder's binding, a lock that was never taken — and without it the bundle could show a
# task FAILED under a contract that looks perfectly locked. No terms, no prose: revisions,
# digests, task ids and the closed reason code. A bound task's CLAIM is here too — the revision
# and digest the coder and the reviewer actually executed under — so the gate can compare what
# was locked with what was run, rather than trusting that the two are one document.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'disposition' AS disposition,e.payload->'facts'->>'evaluatorId' AS evaluator_id,e.payload->'facts'->>'evidenceCount' AS evidence_count,e.payload->'facts'->>'evidenceIds' AS evidence_ids,e.payload->'facts'->>'contractTaskId' AS contract_task_id,e.payload->'facts'->>'contractId' AS contract_id,e.payload->'facts'->>'contractRevision' AS contract_revision,e.payload->'facts'->>'bindingDigest' AS binding_digest,e.payload->'facts'->>'recordedRevision' AS recorded_revision,e.payload->'facts'->>'currentRevision' AS current_revision,e.payload->'facts'->>'reviewRevision' AS review_revision,e.payload->'facts'->>'implementationRevision' AS implementation_revision,e.payload->'facts'->>'role' AS role,e.occurred_at,e.payload->'facts'->>'leaseGeneration' AS lease_generation FROM relay_wonderland.events e WHERE e.event_type IN('julius.contract.proposed','julius.contract.challenged','julius.contract.locked','julius.contract.refused','julius.contract.disposition') OR (e.event_type='julius.task.claimed' AND e.payload->'facts'->>'contractId' IS NOT NULL) ORDER BY e.stream_id,e.sequence" contract-events.tsv

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
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'taskType' AS task_type,e.payload->'facts'->>'inputTokens' AS input_tokens,e.payload->'facts'->>'outputTokens' AS output_tokens,e.payload->'facts'->>'reasoningTokens' AS reasoning_tokens,e.payload->'facts'->>'toolCalls' AS tool_calls,e.payload->'facts'->>'researchCalls' AS research_calls,e.payload->'facts'->>'activeMs' AS active_ms,e.payload->'facts'->>'providerCalls' AS provider_calls,e.payload->'facts'->>'brainRetrievals' AS brain_retrievals,e.payload->'facts'->>'guidanceConsumed' AS guidance_consumed,e.payload->'facts'->>'evidenceInspected' AS evidence_inspected,e.payload->'facts'->>'allocatedUsdMicros' AS allocated_usd_micros,e.payload->'facts'->>'settledUsdMicros' AS settled_usd_micros,e.payload->'facts'->>'settlementBasis' AS settlement_basis,e.payload->'facts'->>'evidenceGenerated' AS evidence_generated,e.payload->'facts'->>'repairRounds' AS repair_rounds,e.payload->'facts'->>'guidanceGenerated' AS guidance_generated,e.payload->'facts'->>'reviewerVerdicts' AS reviewer_verdicts,e.payload->'facts'->>'effortVersion' AS effort_version,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type='julius.worker.effort' ORDER BY e.stream_id,e.sequence" effort.tsv

# PARTICIPATION — whether a worker ever STOPPED, asked, and was made to wait.
# A checkpoint that minted no continuation stopped a worker without giving it
# anywhere to resume, which is a stall rather than a barrier working, so the
# route and its reason are exported beside the checkpoint itself. The
# checkpoint's own `sequence` is its position within one dispatch and is NOT the
# ledger's; it is exported as `checkpoint_sequence` so the two can never be read
# as the same number.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'checkpointId' AS checkpoint_id,e.payload->'facts'->>'trigger' AS trigger,e.payload->'facts'->>'origin' AS origin,e.payload->'facts'->>'sequence' AS checkpoint_sequence,e.payload->'facts'->>'evidenceCount' AS evidence_count,e.payload->'facts'->>'route' AS route,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'wouldHaveRouted' AS would_have_routed,e.payload->'facts'->>'stage' AS stage,e.payload->'facts'->>'guidanceId' AS guidance_id,e.payload->'facts'->>'guidanceRevision' AS guidance_revision,e.payload->'facts'->>'guidanceDigest' AS guidance_digest,e.payload->'facts'->>'deliveredTo' AS delivered_to,e.payload->'facts'->>'proposedTo' AS proposed_to,e.payload->'facts'->>'proposalEntryId' AS proposal_entry_id,e.payload->'facts'->>'entryId' AS delivered_entry_id,e.payload->'facts'->>'recommendedActions' AS recommended_actions,e.payload->'facts'->>'additionalProhibitions' AS additional_prohibitions,e.payload->'facts'->>'references' AS reference_count,e.payload->'facts'->>'contractRevision' AS contract_revision,e.payload->'facts'->>'contractBindingDigest' AS contract_binding_digest,e.payload->'facts'->>'continuationTaskId' AS continuation_task_id,e.payload->'facts'->>'outcomes' AS research_outcomes,e.payload->'facts'->>'handoffEntryId' AS handoff_entry_id,e.payload->'facts'->>'provenanceEntryId' AS provenance_entry_id,e.payload->'facts'->>'deliveredChars' AS delivered_chars,e.payload->'facts'->>'requestReadable' AS request_readable,e.payload->'facts'->>'requestReasonCode' AS request_reason_code,e.payload->'facts'->>'deliveredAt' AS delivered_at,e.payload->'facts'->>'raisedBy' AS raised_by,e.payload->'facts'->>'declinedFailureClass' AS declined_failure_class,e.payload->'facts'->>'failureClass' AS failure_class,e.payload->'facts'->>'unitRootTaskId' AS unit_root_task_id,e.payload->'facts'->>'authorWorkerId' AS author_worker_id,e.payload->'facts'->>'deliveredByWorkerId' AS delivered_by_worker_id,e.payload->'facts'->>'deliveredAtTaskId' AS delivered_at_task_id,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.checkpoint.recorded','julius.checkpoint.verdict','julius.guidance.issued','julius.guidance.delivered','julius.guidance.refused','julius.guidance.deferred') ORDER BY e.stream_id,e.sequence" participation.tsv

# RESEARCH. These rows are the research budget's durable truth — the mediator
# PROJECTS its per-role meter by folding them — so a bundle without them cannot
# show that a restart remembered what a slot had already spent, and cannot show
# that all three slots were able to reach the outside world at all. The eight
# outcomes are never collapsed into "no evidence": a refusal, an exhausted
# budget, a throttle, an unreachable host and a page that signalled injection
# are five different facts. `counted` is whether the ask was CHARGED, which is
# not the same as whether it succeeded. `reason_code` is Relay's refusal code
# and `reach_refusal` Live Reach's own, which the mapping to it folds; with
# `requested_source`, `requested_capability` and `requested_host` (a host
# name only, never the path, query or purpose a worker wrote) they say which wall
# a refused ask hit and what it reached for.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'requestKey' AS request_key,e.payload->'facts'->>'attemptKey' AS attempt_key,e.payload->'facts'->>'askCount' AS ask_count,e.payload->'facts'->>'guard' AS attempt_guard,e.payload->'facts'->>'outcome' AS outcome,e.payload->'facts'->>'counted' AS counted,e.payload->'facts'->>'evidenceId' AS evidence_id,e.payload->'facts'->>'signalled' AS injection_signals,e.payload->'facts'->>'segment' AS segment,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'reachRefusal' AS reach_refusal,e.payload->'facts'->>'requestedSource' AS requested_source,e.payload->'facts'->>'requestedCapability' AS requested_capability,e.payload->'facts'->>'requestedHost' AS requested_host,e.payload->'facts'->>'bytes' AS bytes,e.payload->'facts'->>'bytesRecorded' AS bytes_recorded,e.payload->'facts'->>'askOrdinal' AS ask_ordinal,e.payload->'facts'->>'resourcePath' AS resource_path,e.payload->'facts'->>'mechanism' AS mechanism,e.payload->'facts'->>'contentDigest' AS content_digest,e.payload->'facts'->>'readableChars' AS readable_chars,e.payload->'facts'->>'deliveredFrom' AS delivered_from,e.payload->'facts'->>'deliveredChars' AS delivered_chars,e.payload->'facts'->>'deliveryCut' AS delivery_cut,e.payload->'facts'->>'deliveryAnchor' AS delivery_anchor,e.payload->'facts'->>'handoffTaskId' AS handoff_task_id,e.payload->'facts'->>'handoffEntryId' AS handoff_entry_id,e.payload->'facts'->>'stage' AS stage,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.research.attempted','julius.research.retrieved','julius.research.refused') ORDER BY e.stream_id,e.sequence" research.tsv

dump "SELECT event_kind,task_id,worker_id,provider_id,outcome,usd_micros,duration_ms,input_tokens,output_tokens,safe_facts,occurred_at,run_id FROM relay_wonderland.julius_trajectory_events ORDER BY occurred_at,trajectory_event_id" trajectory.tsv

# WHAT THE LEARNING LOOP RECORDED FOR EACH ARM OF A REGISTERED PAIR (E9-a). The live mission calls the
# loop at a registered arm's terminal state and writes ONE `learning.arm.recorded` event per run, and
# the ledger dies with the runner, so without this file no bundle could show that the caller ran. One
# row per arm: its registration digest, its pairing (objective digest, roles, runtime version), the
# policy declared before it ran and its metrics off its own trajectory; on arm WITH also the WITHOUT
# run it was compared with, the comparison, one delta token per declared dimension
# (`dimension:VERDICT:without:with:bounded|total`), the gate's decision and whether a promotion was
# PROPOSED, which is all the record can ever do. `cites_event_id` is the WITHOUT arm's own record, so
# the two arms of a pair are tied by id rather than by order. Tokens, digests, run ids and numbers only.
dump "SELECT e.stream_id AS run_id,e.sequence,e.event_id,e.payload->>'causationId' AS cites_event_id,e.payload->>'correlationId' AS pair_correlation,e.payload->'facts'->>'recordVersion' AS record_version,e.payload->'facts'->>'loopVersion' AS loop_version,e.payload->'facts'->>'registrationDigest' AS registration_digest,e.payload->'facts'->>'arm' AS arm,e.payload->'facts'->>'runState' AS run_state,e.payload->'facts'->>'objectiveDigest' AS objective_digest,e.payload->'facts'->>'roles' AS roles,e.payload->'facts'->>'runtimeVersion' AS runtime_version,e.payload->'facts'->>'policyDimensions' AS policy_dimensions,e.payload->'facts'->>'policyMinimumRelativeImprovement' AS policy_minimum_relative_improvement,e.payload->'facts'->>'policyMinimumImprovedDimensions' AS policy_minimum_improved_dimensions,e.payload->'facts'->>'trajectoryRows' AS trajectory_rows,e.payload->'facts'->>'runs' AS runs,e.payload->'facts'->>'dispatches' AS dispatches,e.payload->'facts'->>'retries' AS retries,e.payload->'facts'->>'repairs' AS repairs,e.payload->'facts'->>'recoveries' AS recoveries,e.payload->'facts'->>'fallbacks' AS fallbacks,e.payload->'facts'->>'findings' AS findings,e.payload->'facts'->>'verifiedCompletions' AS verified_completions,e.payload->'facts'->>'knownUsdMicros' AS known_usd_micros,e.payload->'facts'->>'costComplete' AS cost_complete,e.payload->'facts'->>'averageDurationMs' AS average_duration_ms,e.payload->'facts'->>'knownInputTokens' AS known_input_tokens,e.payload->'facts'->>'knownOutputTokens' AS known_output_tokens,e.payload->'facts'->>'unknownUsageComponents' AS unknown_usage_components,e.payload->'facts'->>'withoutRunId' AS without_run_id,e.payload->'facts'->>'withoutRunState' AS without_run_state,e.payload->'facts'->>'withoutTrajectoryRows' AS without_trajectory_rows,e.payload->'facts'->>'comparison' AS comparison,e.payload->'facts'->>'comparisonReason' AS comparison_reason,e.payload->'facts'->>'deltas' AS deltas,e.payload->'facts'->>'decision' AS decision,e.payload->'facts'->>'decisionReason' AS decision_reason,e.payload->'facts'->>'improved' AS improved,e.payload->'facts'->>'regressed' AS regressed,e.payload->'facts'->>'marginalValue' AS marginal_value,e.payload->'facts'->>'proposal' AS proposal,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type='julius.learning.arm.recorded' ORDER BY e.stream_id,e.sequence" learning.tsv

# WHAT A RUN INHERITED, AND WHAT ITS PLANNER WAS HANDED (founder ruling 2026-10-04, R2). The carry
# decides at bootstrap what earlier runs of the same mission verified and the new run's planner may
# inherit, and writes ONE `knowledge.carried` row in the same transaction as the carried brain rows:
# the source runs, how many candidates it looked at and how many were eligible, one token per carried
# row (`entry|kind|source|source run|source task|source task type|source scope|severity|category|
# criterion|author|trust|sha256 of the text`), and every exclusion by reason and by reference — or
# FAILED with its closed reason. Each dispatch whose packet was owed carried rows writes ONE
# `knowledge.consumed` row: what it was owed, which arrived (by entry id) and which the budget evicted.
# With project-brain.tsv (the `carried:` rows and their task) and findings.tsv / finding-lifecycle.tsv
# (what the source run's reviewer found and resolved), this is the four-point evidence: what the earlier
# run wrote, what became eligible, what was carried, and that the planner received it. Ids, closed
# tokens, counts and digests only: no finding text, no packet text.
dump "SELECT e.stream_id AS run_id,e.sequence,e.event_id,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'carryVersion' AS carry_version,e.payload->'facts'->>'outcome' AS outcome,e.payload->'facts'->>'reasonCode' AS reason_code,e.payload->'facts'->>'missionId' AS mission_id,e.payload->'facts'->>'scopeTaskId' AS scope_task_id,e.payload->'facts'->>'scopeTaskType' AS scope_task_type,e.payload->'facts'->>'scopeRole' AS scope_role,e.payload->'facts'->>'sourceRuns' AS source_runs,e.payload->'facts'->>'sourceRunIds' AS source_run_ids,e.payload->'facts'->>'candidates' AS candidates,e.payload->'facts'->>'candidatesTruncated' AS candidates_truncated,e.payload->'facts'->>'eligible' AS eligible,e.payload->'facts'->>'carried' AS carried,e.payload->'facts'->>'carriedFindings' AS carried_findings,e.payload->'facts'->>'carriedArchitecture' AS carried_architecture,e.payload->'facts'->>'carriedEntries' AS carried_entries,e.payload->'facts'->>'entriesTruncated' AS entries_truncated,e.payload->'facts'->>'excluded' AS excluded,e.payload->'facts'->>'excludedByReason' AS excluded_by_reason,e.payload->'facts'->>'excludedRefs' AS excluded_refs,e.payload->'facts'->>'excludedRefsTruncated' AS excluded_refs_truncated,e.payload->'facts'->>'contextId' AS context_id,e.payload->'facts'->>'attempt' AS attempt,e.payload->'facts'->>'role' AS role,e.payload->'facts'->>'taskType' AS task_type,e.payload->'facts'->>'inScope' AS in_scope,e.payload->'facts'->>'admitted' AS admitted,e.payload->'facts'->>'admittedEntryIds' AS admitted_entry_ids,e.payload->'facts'->>'evicted' AS evicted,e.payload->'facts'->>'evictedEntryIds' AS evicted_entry_ids,e.payload->'facts'->>'excludedInScope' AS excluded_in_scope,e.payload->'facts'->>'missing' AS missing,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.knowledge.carried','julius.knowledge.consumed') ORDER BY e.stream_id,e.sequence" knowledge-carry.tsv

# THE CARRIED COPIES, BY DIGEST (Decision C, C-7 point 3). project-brain.tsv names every brain row but not its
# text, and the carry's own record binds each copy's text by its full sha256 (`carriedEntries`). So every
# `carried:` row is dumped with the digest of the text the store holds, never the text: the off-host verifier
# re-derives the text from the source run's carry-sources.json and needs only the store's digest of it.
dump "SELECT b.run_id,b.entry_id,b.task_id,b.worker_id,b.entry_kind,encode(sha256(convert_to(b.safe_content,'UTF8')),'hex') AS content_sha256 FROM relay_wonderland.julius_brain_entries b WHERE b.entry_id LIKE 'carried:%' ORDER BY b.run_id,b.revision" carry-copies.tsv

# AND WHAT A LATER RUN MAY CARRY FROM THIS ONE, AS ONE VERIFIABLE FILE (Decision C, C-7 point 1).
# `carry-sources.json` holds the run the manifest names: its reviewer findings, the `finding.*` ledger rows that
# give them their lives, and the run and task facts a carried finding's header renders
# (`.github/julius-carry-sources.sql` says exactly which, and why each is the store reader's own shape). Its sha256
# goes into the manifest the moment it is written, so whoever verifies the chain later checks these bytes against
# what THIS job recorded. A failed query writes `unavailable`, exactly as a table above would.
carry_run=$(sed -n 's/^julius_run_id=//p' "$out/bundle-manifest.txt" 2>/dev/null | head -n 1 || true)
if docker exec -i -e PGPASSWORD "$container" psql -X -q -t -A -v ON_ERROR_STOP=1 -v run="${carry_run:-none}" \
    -U "$PGUSER" -d "$PGDATABASE" < "$(dirname "$0")/julius-carry-sources.sql" > "$out/carry-sources.json" 2>/dev/null; then
  # From stdin: given a file NAME, sha256sum escapes one it dislikes (a backslash: `\<digest>`), and cut keeps the `\`.
  carry_digest=$(sha256sum < "$out/carry-sources.json" 2>/dev/null | cut -d' ' -f1 || true)
  if [ -n "$carry_digest" ]; then echo "carry_sources_sha256=$carry_digest" >> "$out/bundle-manifest.txt"; fi
else
  echo 'unavailable' > "$out/carry-sources.json"
fi

# WHAT THE CODER CHANGED THAT ITS CONTRACT DID NOT ALLOW (B2). The Beta Gate's PERMISSIONS /
# MISSION BOUNDARIES row judges BOUNDARIES — a scope violation, a denial, an effect left
# unsettled — and never whether a test exited non-zero, which is the repair loop's business. The
# scope check's verdicts reached only the durable ledger, which dies with the runner, so no bundle
# could show a forbidden-path edit. Counts, the closed rule (`OUT_OF_SCOPE`,
# `OUTSIDE_PERMITTED_PATHS`) and who it is attributed to; never a path or a coder's report, which
# are worker-influenced text. `coder.report.refused` travels too, as its event type alone: it is the
# one path on which Julius could not read what the coder changed, so it writes no implementation
# row, and without it that silence read as a change set with nothing wrong in it.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'rule' AS rule,e.payload->'facts'->>'resolvedBy' AS resolved_by,e.payload->'facts'->>'attributedTo' AS attributed_to,e.payload->'facts'->>'attempt' AS attempt,e.payload->'facts'->>'scopeChecked' AS scope_checked,e.payload->'facts'->>'scopeViolations' AS scope_violations,e.payload->'facts'->>'ownScopeViolations' AS own_scope_violations,e.payload->'facts'->>'cleanliness' AS cleanliness,e.payload->'facts'->>'workspaceCaptured' AS workspace_captured,e.payload->'facts'->>'captured' AS attempt_captured,e.payload->'facts'->>'changedPaths' AS changed_paths,e.payload->'facts'->>'attemptOutcome' AS attempt_outcome,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.coder.scope.violated','julius.coder.implementation.recorded','julius.coder.attempt.workspace','julius.coder.report.refused') ORDER BY e.stream_id,e.sequence" scope.tsv

# WHAT BECAME OF EACH FINDING, AND WHAT EACH REVIEW SAID (B1). A finding row is written OPEN once
# and never updated: its life (ADDRESSED, RESOLVED, SUPERSEDED) exists only as
# `finding.transitioned` events, so `findings.tsv` alone makes a clean catch, repair and
# resolution read as "COMPLETED over an open blocking finding". The lifecycle and the reviewer's
# verdict events are exported here as tokens and identifiers: the verdict, its category, target,
# route and source, the finding ids and the moves. The declaration's `claim`, `warnings` and
# `resolutions` are reviewer prose and have no column.
dump "SELECT e.stream_id AS run_id,e.sequence,e.payload->>'taskId' AS task_id,e.event_type,e.payload->'facts'->>'findingId' AS finding_id,e.payload->'facts'->>'move' AS finding_move,e.payload->'facts'->>'to' AS to_status,e.payload->'facts'->>'reviewTaskId' AS review_task_id,e.payload->'facts'->>'repairTaskId' AS repair_task_id,e.payload->'facts'->>'supersededByFindingId' AS superseded_by_finding_id,e.payload->'facts'->>'blocking' AS blocking,e.payload->'facts'->>'category' AS category,e.payload->'facts'->>'evidenceId' AS evidence_id,e.payload->'facts'->>'reviewedTaskId' AS reviewed_task_id,e.payload->'facts'->>'verdict' AS verdict,e.payload->'facts'->>'declared' AS declared_verdict,e.payload->'facts'->>'derived' AS derived_verdict,e.payload->'facts'->>'source' AS verdict_source,e.payload->'facts'->>'route' AS verdict_route,e.payload->'facts'->>'target' AS verdict_target,e.payload->'facts'->>'warningCount' AS warning_count,e.payload->'facts'->>'resolutionCount' AS resolution_count,e.payload->'facts'->>'warningsRetained' AS warnings_retained,e.payload->'facts'->>'warningsPromoted' AS warnings_promoted,e.payload->'facts'->>'reasonCode' AS reason_code,e.occurred_at FROM relay_wonderland.events e WHERE e.event_type IN ('julius.finding.recorded','julius.finding.transitioned','julius.review.verdict.declared','julius.review.verdict.refused','julius.review.verdict.applied') ORDER BY e.stream_id,e.sequence" finding-lifecycle.tsv

# AND EACH FINDING'S STATUS NOW: its last `finding.transitioned` move, or the recorded OPEN when it
# never moved. Every transition the runtime writes was legal when written, so the last one is the
# state the pipeline's own fold reached; `transitions` says how many moves it took.
dump "SELECT f.run_id,f.finding_id,f.task_id,f.blocking,f.status AS recorded_status,COALESCE((SELECT t.payload->'facts'->>'to' FROM relay_wonderland.events t WHERE t.event_type='julius.finding.transitioned' AND t.stream_id=f.run_id AND t.payload->'facts'->>'findingId'=f.finding_id ORDER BY t.sequence DESC LIMIT 1),f.status) AS effective_status,(SELECT count(*) FROM relay_wonderland.events t WHERE t.event_type='julius.finding.transitioned' AND t.stream_id=f.run_id AND t.payload->'facts'->>'findingId'=f.finding_id)::text AS transitions FROM relay_wonderland.julius_reviewer_findings f ORDER BY f.run_id,f.created_at" finding-status.tsv
