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

The initial kernel provides a validated mission state machine, provider-independent default and specialist roles, deterministic DAG readiness, compare-and-set task transitions, bounded role-specific Project Brain context, normalized evidence, and a verification/completion gate. It is pure domain code so durable adapters can persist transitions and graph snapshots through Relay's existing transactional outbox architecture.

## Safety and policy boundaries

Context is selected by role and task, bounded by a character budget, and excludes entries marked `SECRET`. The compiler applies defense-in-depth redaction, but callers must store credentials only in credential handles—not Project Brain. Decisions contain reason codes, safe summaries, and evidence references, never chain-of-thought.

C.A.R.D. remains the runtime policy input. Unchained may later relax approval frequency only inside hard authorization, tenancy, sandbox, network, and budget boundaries. It must never disable those boundaries.

## Integration sequence

Durable repositories should persist missions, task nodes/dependencies, transitions, evidence, leases, and idempotency keys in one transaction with outbox events. The existing Wonderland scheduler, budget reservation, provider receipts, realtime fanout, GVE, and swarm implementations should be adapted to these ports rather than replaced. Sub-agents are bounded child tasks; swarms are bounded parallel execution over task nodes. `/gauntletloop` should be a persisted scheduled iteration with maximum rounds, spend, duration, and retries—not recursion or an infinite loop.

Completion is valid only when Julius is verifying, all tasks are successful or explicitly skipped, and every required verification decision is `ACCEPT`.
