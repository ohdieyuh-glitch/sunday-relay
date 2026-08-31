# Julius beta readiness

**Assessment date:** 2026-08-30 UTC. **Base reviewed:** PR #202 / current main `96451fc0c8da59de792d973113c4e203ddab6f01`. **Working branch:** `codex/julius-beta-hardening`. Julius is **not beta-ready**.

States are strictly cumulative: `ABSENT`, `DOMAIN_ONLY`, `IMPLEMENTED`, `WIRED`, `DURABLE`, `REAL_INFRA_PROVEN`, `BETA_READY`. Tests of an exported class do not make it wired; SQL-text fakes do not make it durable or infrastructure-proven.

## Re-audit

- GitHub currently has PR #202 as the only open PR numbered 202 or later. It remains open, clean, and unmerged at `5359b3036a0ae917372a2a2721c5b5182b57d748`. No old PR was merged or closed.
- The supplied checkout contained a squash-equivalent consolidation commit `90c427721d13557b36243bc42eb09583622df471`, based on current main. Its tree contains the effective #198, #185, and #201 changes. Work continues without rewriting the historical branches.
- Migrations 001–018 were present. This hardening adds 019 for tool invocations, dispatch intent, and artifact metadata. Migration-chain tests enumerate the directory, so an unregistered file fails.
- The #198 boundary remains: feature code consumes generic Julius interfaces; Julius has no feature runtime, API, event, trajectory kind, policy field, or namespaced feature table.
- PR #202 review found five concrete issues. Shell-expanded Git arguments, unbounded listings, and missing creation ancestors are fixed. Production approval gating now has an atomic store operation. Production sub-agent task/grant creation now rechecks limits under a per-run transaction lock.

## Capability matrix

| Capability | State | Evidence / blocker |
|---|---|---|
| Effective #202 architecture | IMPLEMENTED | Consolidated tree exists; founder has not authorized merge. |
| #198 dependency boundary | IMPLEMENTED | Structural boundary suite remains authoritative. |
| Sandbox domain port | IMPLEMENTED | Provider-neutral create/prepare/execute/cancel/destroy/inspect/collect contract includes tenant, run, task, lease, policy, expiry, and resource ceilings. |
| Docker sandbox adapter | REAL_INFRA_PROVEN | Digest-addressed image, no shell in host launcher, read-only root, dropped capabilities, no-new-privileges, unprivileged user, controlled bind mount/network, CPU/memory/PID/nofile/tmpfs/wall/output limits. GitHub run `33327055137` passed with the real Docker engine and PostgreSQL service; the adversarial matrix remains incomplete. |
| Production host-shell prevention | IMPLEMENTED | Production adapter is explicitly disabled unless trusted composition enables it. The old Node adapter remains development-only and is not a hostile-code boundary. |
| OS filesystem/network isolation | IMPLEMENTED | Docker flags compile policy into mounts and `--network none`; the basic real Docker path passed in GitHub run `33327055137`, while the complete adversarial matrix remains open. |
| Durable invocation lifecycle | IMPLEMENTED | Migration 019 and PostgreSQL repository persist the lifecycle and real PostgreSQL tests pass, but crash-after-effect result recovery and atomic budget/evidence settlement are not solved. |
| Transactional dispatch intent | IMPLEMENTED | Invocation and dispatch intent share a transaction and real `SKIP LOCKED` claims pass. Expired `DISPATCHING`/`RUNNING` recovery deliberately does not replay destructive work and currently requires reconciliation; it is not recoverable yet. |
| Durable artifact metadata | DOMAIN_ONLY | Migration 019 defines composite-scoped metadata and references, but no production metadata repository/atomic completion integration exists. |
| Artifact bytes | IMPLEMENTED | Local adapter atomically stores 0600 content and metadata, validates tenant/project scope and hash, and keeps blobs outside hot DB rows. Production object storage is absent. |
| Provider-neutral turn loop | IMPLEMENTED | Bounded model-turn/tool-call/runtime/observation loop supports interchangeable adapters. No provider adapter is wired to it. |
| Live Prompt Architect | DOMAIN_ONLY | Existing provider path exists elsewhere; not composed into this durable tool loop. |
| Live Coding Agent tools | IMPLEMENTED | Protocol and bounded loop exist; no configured live provider credential is present. |
| Live Independent Reviewer | DOMAIN_ONLY | Existing reviewer harness exists; no real three-worker Julius mission has run. |
| Real PostgreSQL proof | REAL_INFRA_PROVEN | Installed a disposable PostgreSQL 16 cluster locally; migrations 001–019, concurrent invocation identity, digest conflict, stale tool lease, SKIP LOCKED dispatch, concurrent task claims, heartbeat and completion fencing passed. Docker proof remains pending CI. |
| First real Julius mission | ABSENT | No durable Prompt Architect → Coding Agent → Reviewer → repair → completion run yet. |
| Restart/chaos proof for tools | DOMAIN_ONLY | Existing Julius chaos tests do not cover the new real sandbox/outbox result boundary. |
| Live Terminal tool projection | DOMAIN_ONLY | Generic projection exists; durable tool events are not composed into the deployed bridge. |
| Beta eval pack | ABSENT | Must follow real provider and infrastructure composition. |

## Host capability discovery

Available executables: `unshare`, `systemd-run`, `systemctl`, `prlimit`, and `setpriv`. PostgreSQL 16 was installed into this disposable environment and the real integration suite passed. Missing sandbox executables remain: Docker, Podman, containerd/ctr, nerdctl, Bubblewrap, nsjail, Firejail, and cgexec. The cgroup v2 filesystem is not writable. This host therefore cannot honestly prove the Docker boundary or establish a safe alternative. Production execution stays disabled here.

The repository now includes a GitHub Actions job with another disposable PostgreSQL 16 service and Docker engine. It builds a content-addressed local sandbox image and runs the real-infrastructure suite. GitHub run `33327055137` passed this basic path; the broader security/chaos exit criteria remain open.

## Credentials and provider status

No `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `XAI_API_KEY`, Relay operator token, or safe provider-specific credential is present. `OPENAI_BASE_URL`/cluster routing variables alone do not authorize a live call. A live beta proof requires an explicitly scoped credential and configured worker route for each role; no fake pass is recorded.

## Independent hardening review

A separate reviewer found Critical/High gaps after the first infrastructure commit. This follow-up enforces `READ_FILESYSTEM=false` with no workspace bind, rejects unsupported mediated networking, checks sandbox expiry/cwd/invocation-specific cancellation, validates current tenant membership/worker/lease expiry/policy on durable requests, validates completion references, makes artifact scope run/task/invocation-specific, and repairs approval/sub-agent duplicate behavior. The reviewer also confirmed that destructive dispatch recovery, fully transactional budget/evidence completion, persistent sandbox ownership, workspace disk accounting, production artifact metadata, and real-provider composition remain open.

## Blockers remaining

1. Extend the passing real-infrastructure CI run to independently attack its container boundary, including parent/child/grandchild survival and disk/PID exhaustion.
2. Replace the development Node executor in every production composition with the sandbox port; keep the enable switch fail-closed.
3. Add production object-store artifact bytes and transactional linkage between artifact metadata, invocation completion, budget settlement, evidence, and events.
4. Wire a real provider adapter into the bounded turn loop, then wire Prompt Architect, Coding Agent, and Independent Reviewer through the durable runtime.
5. Execute the intentionally failing first mission, repair, restart/chaos matrix, terminal projection, Project Brain write, and beta eval pack.
6. Run another independent Critical/High security review. Beta requires zero open Critical or High findings.

## Exit decision

**NOT BETA-READY.** This change materially closes architecture and durability gaps and creates a real-infrastructure proof path, with real PostgreSQL and basic Docker proof, but no live provider mission or complete hostile-code/chaos proof exists.

## PR #203 follow-on closure checkpoint (2026-08-30)

The follow-on branch `codex/julius-beta-closure` adds migration 020 rather than rewriting published migration 019. It introduces explicit effect classes, durable executor-receipt and sandbox-ownership schemas, a fail-closed reconciliation decision, recovery claims for expired `DISPATCHING`/`RUNNING` work, opaque Docker discovery labels, and physical sandbox discovery/quarantine operations. Dispatch and completion now revalidate the live task lease and C.A.R.D. revision; completion rejects mismatched invocation and artifact references. The bounded provider loop now enforces a real wall-clock abort rather than checking time only between turns.

These changes move crash-after-effect handling from **ABSENT** to **IMPLEMENTED**, not `DURABLE` or `REAL_INFRA_PROVEN`. In particular, arbitrary shell work with an unknown outcome is blocked from automatic replay, but the Docker executor does not yet write terminal receipts independently of the orchestrator process. Persistent sandbox rows and physical discovery exist, but deployment composition does not yet run the complete DB↔Docker reconciler. Migration 020's settlement ledger establishes exactly-once schema identity, but a single transaction that commits budget, evidence, trajectory, event, task outcome, and artifact metadata is still open.

No live provider credential is present in this environment. `OPENAI_BASE_URL` and `OPENAI_CLUSTER` without `OPENAI_API_KEY` do not authorize a request; no Anthropic/xAI credential is present. Therefore no first real provider mission, reviewer-triggered repair, or honest beta claim is recorded here.

### Fresh validation on this follow-on

A fresh full repository run with one worker completed 462 files: 460 passed, 1 infrastructure-only suite remained skipped/todo without credentials, and `relay-bridge/loop-routes.test.ts` had one 5-second timeout (8,727 passed, 1 failed, 4 todo). The failed file immediately passed in isolation (39/39), classifying it as suite-load/resource contention rather than a Julius regression. An earlier parallel full run also exposed the newly added migration/test-accounting updates plus a boundary-scanner timeout; the migration/accounting defects were fixed, and the boundary scanner then passed alone (209/209). The full matrix is therefore not represented as unconditionally green and Julius remains not beta-ready.

### Independent security review

A genuinely separate reviewing agent audited the effective follow-on diff and its revisions. Final review found **0 Critical** findings. The revision closed DB-clock lease fencing, pre-execution stale authority, scoped receipt/sandbox constraints, terminal-result integrity, hard provider deadlines, and exclusive generation-fenced recovery claims. Remaining High findings are explicitly blocking: executor-side before/after receipts plus a composed recovery worker; one atomic budget/evidence/artifact/event/trajectory/task settlement; and composition of the durable sandbox repository into Docker lifecycle/restart handling. No beta-readiness claim is made.

## Phase II correctness checkpoint (2026-08-31)

The stacked branch `codex/julius-beta-phase2` closes the three previously open High findings in code and focused tests without changing the #198 boundary:

- **Executor witness:** the Docker adapter mounts a root-owned receipt directory outside the disposable container layer. A trusted wrapper writes immutable, identity-bound `BEFORE` and `AFTER` receipts around an unprivileged process. Receipt consumption validates scope, manifest and payload digests; `BEFORE` without a valid terminal receipt is `UNKNOWN_EFFECT` and is never replayed automatically.
- **Exactly-once settlement:** one serializable PostgreSQL operation validates the terminal executor receipt and finalized artifact bytes, commits the scoped budget reservation, invocation result, artifact metadata, evidence, trajectory, operational event, task outcome, outbox, and settlement identity. Same identity/digest is idempotent; a changed digest conflicts. Task success additionally requires a persisted accepting verification decision whose passed evidence is included in the settlement.
- **Durable Docker ownership:** create, physical binding, execution authorization, heartbeat, destroy and restart reconciliation use the PostgreSQL sandbox owner/generation. Reconciliation compares DB records with Docker IDs, images and opaque labels, consumes receipts before declaring loss, and quarantines mismatches and orphans.

A genuinely separate final reviewer reported **Critical 0 / High 0 for these three targets**. That verdict is scoped to the Phase II diff and does not make Julius beta-ready. This machine still has no Docker/PostgreSQL executables for a local real-infrastructure rerun, and no `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or configured remote Hermes credential. The GitHub PostgreSQL+Docker job and first live three-provider mission must pass before the states advance to `REAL_INFRA_PROVEN` or `BETA_READY`.

Remaining beta blockers are the real CI run, a production object-store adapter, live Prompt Architect/Coding Agent/Independent Reviewer routes, the genuine reviewer-failure/repair mission, Project Brain/terminal/restart proof, the full resource/chaos/eval matrix. The Phase II checkout completed a fresh single-worker run with 464 files and 8,741 tests passing (5 todo), plus typecheck, builds and repository/parity gates; the environment-gated real-infrastructure proof remains pending.

### Real-infrastructure CI result

GitHub Actions run `33349662781` proved migrations through 021, serializable invocation retry, stale lease fencing, `SKIP LOCKED`, concurrent task claims, and orphan-container quarantine. The crash-after-effect case failed because the container produced a `BEFORE` receipt but no terminal `AFTER` receipt or effect. Julius correctly kept the outcome unknown rather than replaying it. This is a **REAL REGRESSION / unresolved executor-image integration failure**, not a pass; consequently HIGH-1 is not infrastructure-proven and the live mission must not start.
