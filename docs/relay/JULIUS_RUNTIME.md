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

The durable repository persists missions, task nodes/dependencies, transitions, evidence, leases, and idempotency keys alongside the existing outbox. The existing Wonderland budget reservation, provider receipts, realtime fanout, GVE, and swarm implementations remain intact. Sub-agents are not durable Julius primitives yet; their intended representation is bounded child tasks, while swarms remain bounded parallel execution. `/gauntletloop` is also not wired yet and must become a persisted scheduled iteration with maximum rounds, spend, duration, and retries—not recursion or an infinite loop.

Completion is valid only when Julius is verifying, all tasks are successful or explicitly skipped, and every required verification decision is `ACCEPT`.
