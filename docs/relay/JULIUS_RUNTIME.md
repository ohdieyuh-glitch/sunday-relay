# Julius runtime

Julius is Relay's provider-neutral Compound Agent harness. Models provide intelligence; Julius organizes it; Relay operationalizes Julius; Wonderland consumes the resulting authoritative state.

## Ownership

Julius owns mission transitions, task dependencies, worker selection, context compilation, evidence evaluation, and the completion decision. Workers own only their bounded work and return structured results. Workers never call one another or mutate global mission state.

```text
Mission Contract -> Julius state + task graph -> registered worker adapter
                         ^                         |
                         |-- evidence + result ----|
                         |
                    verification decision -> next transition
```

The kernel provides a validated mission state machine, provider-independent default and specialist roles, deterministic DAG readiness, compare-and-set task transitions, bounded role-specific Project Brain context, normalized evidence, and a verification/completion gate.

PostgreSQL is authoritative for Julius runs, tasks, dependencies, lifecycle transitions, evidence, verification decisions, and reproducible context metadata. Run creation and lifecycle transitions commit their safe versioned event to Relay's existing event/outbox tables in the same serializable transaction. Runnable-task claims use `FOR UPDATE SKIP LOCKED`, a lease generation, expiry, and owner checks so multiple schedulers cannot successfully own the same generation. Expired active leases are reclaimable; stale heartbeats and completions fail their compare-and-set predicate.

## Safety and policy boundaries

Context is selected by role and task, bounded by a character budget, and excludes entries marked `SECRET`. The compiler applies defense-in-depth redaction, but callers must store credentials only in credential handles—not Project Brain. Decisions contain reason codes, safe summaries, and evidence references, never chain-of-thought.

C.A.R.D. is the runtime policy input. Julius returns structured allow, deny, approval, or limited decisions for providers, capabilities, network, filesystem mutation, retries, fallbacks, sub-agents, gauntlet continuation, worker concurrency, and Unchained continuation. Unchained relaxes continuation behavior only: explicit network, provider, capability, sub-agent, gauntlet, and concurrency limits remain enforced.

Provider routing resolves a typed role and capability through the worker registry, C.A.R.D., adapter availability, provider circuit state, and provider concurrency. Provider-specific dispatch stays behind adapters. Rate limits and timeouts are transient; authentication/configuration, policy denial, cancellation, and unknown worker failures are not blindly retried.

## Integration sequence

The durable repository persists missions, task nodes/dependencies, transitions, evidence, leases, and idempotency keys alongside the existing outbox. The existing Wonderland budget reservation, provider receipts, realtime fanout, GVE, and swarm implementations remain intact. Julius authorizes sub-agent requests only after C.A.R.D. depth/count checks, a budget reservation, and strict permission narrowing; the result is a bounded child task, while swarms remain bounded parallel execution. The gauntlet domain is an explicit versioned scheduled-round machine with round, retry, spend, duration, cancellation, and stale-writer bounds. Durable gauntlet storage and round scheduling are now wired: migration 017 persists the gauntlet and every round, a round is an ordinary task the normal scheduler claims, and `PRIMARY KEY(gauntlet_id, round, phase)` makes duplicate round scheduling a schema impossibility.

Recovery is database-driven. Expired task leases are selected with skip locking and either requeued, failed after retry exhaustion, or cancelled with their run. Worker results are unique per task lease generation and idempotency key; duplicate callbacks return their prior receipt, while stale generations and results arriving after cancellation are rejected. Result persistence and the authoritative task transition share one serializable transaction, so a restart cannot expose half of that boundary. Repair-cycle storage records the original and repair tasks, round, findings, evidence, and required budget reservation for subsequent runtime wiring.

Verification repair decisions now materialize as bounded, parent-linked Coding Agent tasks only after a resource reservation exists. Repair scheduling atomically persists the child task, original-task/finding/evidence provenance, round number, and a versioned outbox event. Replayed scheduling is idempotent per original task and round; cancellation and terminal runs refuse new repair work, while scheduled or active cycles can be recovered after restart.

Versioned trajectory events record bounded operational facts for topology, routing, contexts, dispatch, retry/fallback, sub-agents, gauntlets, findings, repairs, verification, recovery, and completion. They carry runtime, policy, C.A.R.D., Mission Contract, and Project Brain revisions plus trusted usage/latency fields; secret-shaped and oversized facts are rejected. Tenant- and runtime-scoped Julius Evals aggregate verified completion, cost, latency, retry, fallback, repair, recovery, and gauntlet outcomes without treating this instrumentation as model training.

The authoritative operational event source emits a closed, provider-neutral vocabulary through the existing sequenced event log and outbox in one serializable transaction. Events contain only bounded scalar facts, reject secret-shaped fields, enforce run/project ownership, and make exact replay idempotent while detecting event-ID payload conflicts. They contain no presentation wording or private reasoning; clients and terminal projections remain downstream consumers.

Claimed work now passes through an authoritative execution coordinator: C.A.R.D.-filtered worker selection, resource reservation, provider-neutral dispatch, result validation, evidence persistence, generation-safe result acceptance, and reservation settlement. Denial prevents dispatch; transient provider failures retry only when policy permits; permanent and malformed failures release the reservation and fail safely. Provider adapters cannot directly complete missions or bypass evidence ingestion.

Verification is a separate Julius-owned phase. Acceptance criteria map to normalized evidence types, reviewer policy can schedule the typed Independent Reviewer role, and reviewer findings must cite evidence that exists in the same run. Open blocking findings request repair; missing evidence halts; only Julius combines successful tasks, criteria, findings, and accepted decisions into a mission-completion eligibility decision. Reviewer approval alone never completes a run.

Every dispatch can now bind to a deterministic context snapshot containing the compiler version, role, Mission Contract/C.A.R.D./Project Brain revisions, selected Brain entry IDs, dependency tasks, evidence, findings, acceptance criteria, size, redaction count, and an integrity hash. PostgreSQL stores this bounded metadata rather than duplicating an arbitrary transcript. Julius Brain writes have a typed kind, task/worker/evidence provenance, and a unique run revision so stale concurrent writers cannot overwrite shared memory.

Completion is valid only when Julius is verifying, all tasks are successful or explicitly skipped, and every required verification decision is `ACCEPT`.

---

## Status, by capability

Written after wiring the runtime, and deliberately not by reading the sections
above: every claim in this table is a claim about what a code path DOES, and
the markers separate the five different things "done" can mean.

| marker | means |
|---|---|
| `DOMAIN` | a pure function or type exists |
| `PERSISTED` | a durable schema and repository exist |
| `WIRED` | a production code path actually calls it |
| `CONCURRENCY` | its races are proven, against the deterministic model |
| `RECOVERABLE` | proven to survive a simulated restart |
| `API` | reachable through the authoritative execution API |

**Nothing here is marked production ready.** No Julius run has executed against
a real provider, a real PostgreSQL database, or a real deployment. Every test
in this stack runs against a deterministic in-memory model whose header states
exactly what it does and does not model. A passing suite is evidence about the
runtime's logic and is not evidence about PostgreSQL, and calling any of this
production ready on the strength of it would be the specific overclaim this
repository's truthfulness rules exist to prevent.

| capability | DOMAIN | PERSISTED | WIRED | CONCURRENCY | RECOVERABLE | API |
|---|---|---|---|---|---|---|
| mission state machine | yes | yes | yes | yes | yes | yes |
| task DAG + dependency wakeup | yes | yes | yes | yes | yes | yes |
| scheduler claim + leases | — | yes | yes | yes | yes | — |
| C.A.R.D. policy evaluation | yes | **no — see gaps** | yes | — | — | — |
| budget reservation | reused | yes | yes | — | yes | — |
| provider routing | yes | in-memory health | yes | — | **no — health is lost on restart** | — |
| context snapshots | yes | yes | yes | — | yes | — |
| execution + evidence | yes | yes | yes | yes | yes | yes |
| verification + findings | yes | yes | yes | — | yes | yes |
| repair rounds | yes | yes | yes | — | yes | — |
| sub-agents | yes | yes (016) | yes | yes | yes | yes |
| gauntlet | yes | yes (017) | yes | yes | yes | yes |
| approvals | yes | yes (018) | yes | — | yes | yes |
| pause / resume / cancel | yes | yes (018) | yes | — | yes | yes |
| Unchained continuation | yes | — | yes | — | — | — |
| operational events | yes | yes | yes | — | yes | yes |
| trajectories | yes | yes | yes | — | yes | — |
| Julius Evals | yes | yes | yes | — | — | — |
| recovery sweep | yes | yes | yes | yes | yes | — |
| realtime delivery | — | outbox + dead-letter | **projection only** | — | — | cursor read |

## Known gaps, stated rather than implied

**C.A.R.D. policy is not persisted.** `julius_runs` stores a `card_revision`
and nothing stores the policy that revision names, so the runtime takes it
through a port a deployment supplies. Two consequences follow and both are
real: a run's autonomy cannot be changed at runtime, which is why
`autonomy.changed` is deliberately absent from the event catalogue; and two
workers can be handed different policies for one `card_revision` with nothing
detecting it.

**Provider health is in-memory.** `JuliusProviderHealthRegistry` is a `Map`.
A restart forgets every open circuit, so a provider that was failing is tried
again immediately after a deploy.

**Two attempt ceilings disagree.** The dispatch path bounds attempts with
`MAX_TASK_ATTEMPTS`; `recoverExpired` bounds requeues with a `maxRetries`
written as the literal `2` inside its own SQL. They are the same idea in two
places and one of them is invisible.

**The sub-agent depth bound is exclusive.** `evaluateJuliusPolicy` refuses when
`depth >= maxDepth` and a child's depth is `parentDepth + 1`, so `maxDepth: 1`
permits no children at all. The same `>=` is correct for `maxActive` and
`maxTotal`, where the value counts children that already exist. Pinned by a
test and left unchanged, because loosening a C.A.R.D. bound is a product
decision rather than a wiring fix.

**A repair task's type must be routable.** `planJuliusRepair` names a repair
`repair:<original taskType>` and assigns it to a CODING_AGENT whatever the
original role was, so a deployment must register a coding agent that accepts a
repair of every task type it plans. Nothing detects the omission until a repair
cannot be routed.

**Realtime is a projection and not a delivery.** The outbox exists with
attempts, a next-attempt time, an error and a `DEAD` terminal state, and the
authoritative timeline is readable by cursor. Nothing in this stack subscribes,
fans out, or reconnects — a transport is a Relay concern and lives on the other
side of the boundary.

**No PostgreSQL exists on the development machine**, so every concurrency,
chaos and recovery result in this stack is evidence about the runtime's logic
against a model that reproduces the claim exclusion, the lease generations, the
compare-and-set on every writer, the five idempotency constraints, optimistic
run versioning and the dependency predicate. It does not model durability, real
isolation, deadlock, planner behaviour, or anything about a network.
