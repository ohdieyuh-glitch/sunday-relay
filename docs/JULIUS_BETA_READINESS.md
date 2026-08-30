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
