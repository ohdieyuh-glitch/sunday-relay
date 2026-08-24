# Wonderland backend audit and implementation map

Audit date: 2026-08-24. Base: `7276889ed1eae08f91100ae176f3c9bfc15f6425`.

## Existing architecture

- The repository is a TypeScript/Node 20 monorepo without Supabase or Convex dependencies. `relay-bridge` is an HTTP service and `relay-hermes-service` is a separate reviewer service.
- Relay Core already has strong domains for mission coordination, protocol envelopes, append-only ledger projections, verification, usage budgets, MCP permissions, workspace policy, recovery, evidence, and atomic file persistence. Wonderland builds on these conventions rather than replacing them.
- Project Brain already has a short-term file store under `src/relay/persistence`; it is narrower than Wonderland's durable project record.
- The web beta Mission runner currently polls `relay-bridge` mission views. Hermes also polls its remote review job API. Those are existing Relay product transports, not Wonderland transports. They were not silently reused or duplicated: Wonderland v1 has one cursor subscription path and no polling fallback. Replacing the general beta runner requires a bridge streaming endpoint and is remaining cross-product work.
- No existing multiplayer, presence, Project Avatar, battle, Goal Mode, Eval Mode, or Wonderland server domain existed. Unreal content is intentionally untouched.

## Implemented boundary

`Relay Core -> src/relay/wonderland domain -> durable event log/subscription -> Unreal or web contract`

The first foundation is persistence-adapter-neutral. `WonderlandStore` has crash-safe local JSON and memory/test adapters. A future hosted adapter can commit the same aggregate and outbox event in a database transaction, then fan out with Supabase Realtime, Convex, or a WebSocket gateway without changing client contracts.

State-changing commands use durable idempotency keys. Aggregates and their event are committed in one store transaction. Events have a monotonic global cursor. Subscribers provide their last applied sequence, receive ordered catch-up, then live delivery; each subscription suppresses already-applied sequences. Disconnect handling is explicit: reconnect and subscribe with the persisted cursor. There is no polling fallback.

## Security and authority

The service snapshots locked competitive Mission Contracts and exact C.A.R.D. versions. It checks execution/tool permission, aggregate spend, and swarm bounds server-side. Rewards and all commands are idempotent. Project Avatar XP requires a completed battle or locked Mission as evidence. Telemetry has `OWNER`, `PARTICIPANTS`, and `PUBLIC` scopes and recursively removes secret/reasoning fields and common bearer tokens.

GVE (Gamified Verification Environment) results are computed from typed test/security/performance evidence, verified Eval findings, and measured usage. An invalid/failed check carries a score penalty; scores are not client-provided and the test winner is not hard-coded.

## Remaining production integrations

1. Host `WonderlandService` behind authenticated bridge routes and authorize player/project membership from Relay identity.
2. Add a production transactional database/outbox adapter and managed realtime fan-out. The repository currently has no database SDK or configured infrastructure.
3. Connect isolated execution workers and actual token/compute/tool receipts to `consume`; the foundation enforces reported authoritative receipts but does not provision sandboxes.
4. Connect Relay Mission/Agent transitions, MCP denials, and GVE runners to event emission.
5. Add WebSocket/SSE transport heartbeat, backpressure, retention/compaction, session expiry worker, rate limiting, and OpenTelemetry export.
6. Migrate the existing general web beta Mission polling transport separately after its bridge stream exists; do not add polling to Wonderland.

## Hosted milestone

The Relay bridge now mounts authenticated Wonderland command routes and an SSE event stream whenever a durable state root is configured. The default deployed principal is the authenticated Relay operator; deployments may inject the existing participant/session and project-role resolver through `WonderlandAuthorizer`. The handler ignores body identity fields and filters every event by authenticated project role and visibility.

The SSE path performs ordered cursor catch-up and live fan-out, refuses malformed cursors and cross-project access, tracks reconnect/replay/pressure metrics, and closes slow clients when the Node response buffer fills. It sends a connection/heartbeat contract without adding a polling timer. Presence heartbeat is an authenticated command; expiry is an explicit durable lifecycle operation suitable for the host scheduler.

`RelayWonderlandPublisher` maps real persisted Relay Mission phases and terminal records into the existing v1 vocabulary. `RelaySubagentWorker`, `GveRunner`, and `ProviderReceiptSource` are execution ports: hosted workers—not clients—produce sub-agent results, verification evidence, artifacts, and usage. `ProviderBudgetEnforcer` applies receipts while work is running and emits a safe budget-exhausted event on refusal.

The repository still has no PostgreSQL/Supabase/Convex SDK. `TransactionalWonderlandDatabase` is therefore the production adapter contract: an implementation must lock and atomically commit the aggregate with its appended outbox event. The mounted bridge currently uses the crash-safe durable file adapter; multi-instance production deployment remains blocked on injecting a real database implementation. Durable artifact bytes use restrictive file permissions and HMAC-bound, expiring, principal-specific access tokens; object storage remains a host adapter follow-up.

## Connected competition milestone

Relay Mission registry mutations now invoke the Wonderland publisher automatically at the event/phase mutation boundary. Browser/GitHub sessions are verified by the existing browser session store; the verified participant is resolved to repository ownership and C.A.R.D./Agent ownership from server state. Body identity fields remain non-authoritative.

Goal acceptance now creates and locks one immutable Mission Contract, snapshots both exact C.A.R.D. versions, provisions two execution contexts, synchronizes battle start, and launches two Relay Missions. The production orchestrator uses Relay's hardened bounded command runner for real local swarm work and GVE checks. GVE outcomes—not client values—feed existing scoring, result explanations, idempotent reward grants, and Project Brain history. Eval Mode reuses the same GVE runner to create findings only from observable failed checks; a finding can be rebutted only by passed GVE evidence.

Participant event authorization is battle-specific: project membership alone no longer grants `PARTICIPANTS` battle telemetry. Artifact metadata is now atomically persisted with the file adapter and survives restart.

The environment still has no hosted database credentials, database driver, managed pub/sub, object-store credentials, or OpenTelemetry SDK. Consequently multi-instance outbox fan-out, relational migrations/deployment, managed artifacts, and exported OpenTelemetry remain explicit blockers rather than simulated successes. The default bridge can authenticate browser sessions, but a deployed orchestrator also needs an execution-root/provisioner configuration before acceptance routes can run instead of returning `orchestrator_unavailable`.

Presence sessions now persist their project binding. The hosted bridge runs a lifecycle-only scheduler that expires durable stale sessions, disables challenge availability, and emits exactly one project-scoped `presence.left`; graceful shutdown stops this scheduler with the existing cron scheduler. This is server maintenance, not client live-state polling.
