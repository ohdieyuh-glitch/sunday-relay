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

The durable repository persists missions, task nodes/dependencies, transitions, evidence, leases, and idempotency keys alongside the existing outbox. The existing Wonderland budget reservation, provider receipts, realtime fanout, GVE, and swarm implementations remain intact. Julius authorizes sub-agent requests only after C.A.R.D. depth/count checks, a budget reservation, and strict permission narrowing; the result is a bounded child task, while swarms remain bounded parallel execution. The gauntlet domain is an explicit versioned scheduled-round machine with round, retry, spend, duration, cancellation, and stale-writer bounds. Durable gauntlet checkpoint storage and scheduler wiring remain outstanding.

Recovery is database-driven. Expired task leases are selected with skip locking and either requeued, failed after retry exhaustion, or cancelled with their run. Worker results are unique per task lease generation and idempotency key; duplicate callbacks return their prior receipt, while stale generations and results arriving after cancellation are rejected. Result persistence and the authoritative task transition share one serializable transaction, so a restart cannot expose half of that boundary. Repair-cycle storage records the original and repair tasks, round, findings, evidence, and required budget reservation for subsequent runtime wiring.

Claimed work now passes through an authoritative execution coordinator: C.A.R.D.-filtered worker selection, resource reservation, provider-neutral dispatch, result validation, evidence persistence, generation-safe result acceptance, and reservation settlement. Denial prevents dispatch; transient provider failures retry only when policy permits; permanent and malformed failures release the reservation and fail safely. Provider adapters cannot directly complete missions or bypass evidence ingestion.

Completion is valid only when Julius is verifying, all tasks are successful or explicitly skipped, and every required verification decision is `ACCEPT`.
