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

## Real executor closure checkpoint (2026-08-31)

The BEFORE-only CI failure was traced, not waived. The host receipt directory is owned by the Actions runner. The container had `--cap-drop=ALL`; therefore its trusted uid-0 executor lacked `DAC_OVERRIDE` and could create neither the staged receipt nor command-output files on the bind mount. Its attempted identity drop also required `SETUID`/`SETGID`. The inline Docker argument made this failure unnecessarily opaque.

PR #206 installs a fixed executor program into the digest-addressed sandbox image. The container grants only `DAC_OVERRIDE`, `SETUID`, `SETGID`, and `KILL` to that trusted program; `setpriv` changes the worker to uid/gid 65532 while clearing its bounding, inheritable, and ambient capability sets. The executor fsyncs and atomically publishes BEFORE, runs the requested effect unprivileged, reaps every uid-65532 descendant, proves none remain, measures the workspace, and then fsyncs and publishes AFTER. The orchestrator only consumes the resulting files.

GitHub Actions run `33354964563` passed the real PostgreSQL 16 and Docker scenario. It proved migrations 001–021, serializable request retry, stale-lease fencing, `SKIP LOCKED`, unprivileged network-denied mutation, executor BEFORE/effect/AFTER integrity, crash-after-effect recovery without re-execution, exactly one settlement/budget/evidence record, stale sandbox-owner refusal, cleanup, and orphan quarantine. The fixture also starts a delayed background writer; the executor kills it before AFTER and the test proves no late mutation appears.

Live-provider authorization remains absent: `OPENAI_API_KEY`, `OPENAI_PROMPT_ARCHITECT_MODEL`, `RELAY_PROMPT_ARCHITECT_MODE`, `ANTHROPIC_API_KEY`, `RELAY_HERMES_MODE`, `RELAY_HERMES_SERVICE_URL`, and `RELAY_HERMES_SERVICE_TOKEN` are unset. Consequently the real three-role mission remains `BLOCKED_EXTERNAL_CREDENTIAL`, not passed.

The independent re-review still controls the security verdict. In particular, a direct-Docker orchestrator can access the host receipt store and Docker control plane; cryptographic independence from a malicious orchestrator requires a separately privileged executor/receipt service or attestation boundary. Julius remains **not beta-ready** until that deployment boundary, live provider mission, provider-triggered repair, broader real resource/authorization evals, and final zero-Critical/zero-High review are complete.

### Final validation and independent review for PR #206

The fresh single-worker repository run completed 463 passing files, one environment-gated skipped file, 8,740 passing tests, five todo, and one unrelated five-second timeout in `src/relay/persistence/persistence.test.ts`. The timed-out file immediately passed alone (22/22), classifying the full-run failure as resource contention rather than an executor regression. Typecheck, application/Relay/bridge builds, strict surface parity, repository boundary, parity gate, and diff check passed.

A genuinely separate re-review closed the background-descendant High after the real delayed-daemon proof. Its final scoped verdict is **Critical 0 / High 1**. The remaining High is independent receipt authenticity against a malicious orchestrator that itself owns the Docker API and host receipt directory. No file-permission or local signing change can establish that trust separation while Julius retains direct Docker authority. Production hostile-orchestrator clearance requires a separate executor/control-plane service with an executor-only signing/attestation key or append-only receipt credential, and Julius settlement must verify that attestation. The direct Docker adapter is therefore limited to deployments that explicitly trust the Julius orchestrator.

## Live composition checkpoint (2026-09-01, post-#208)

The missing production composition between the durable Julius runtime and the
three existing live provider implementations now exists, on the branch
`relay/julius-live-validation`. States are claimed per this document's own
definitions and no further.

**Live three-role composition: IMPLEMENTED and WIRED, not REAL_INFRA_PROVEN.**
`relay-bridge/julius/` adds three `JuliusProviderAdapter` factories that wrap
the existing engines without duplicating a provider client — `runGptArchitect`
(OpenAI Responses, plan validated by `validateArchitectPlan`),
`runHostedCodingAgent` (Claude Agent SDK, edits inside its pinned envelope),
`runHermesReview` (local Hermes, parsed findings) — plus the first production
implementation of `JuliusBootstrapPort` (run + criteria + Project Brain +
plan→build task graph + transitions to READY, idempotent per contract digest),
a PostgreSQL runtime-store composition mirroring the conformance suite, and an
executor-routed shell port that carries every workspace effect (base revision,
diff, deterministic test) through the PR #208 control plane's durable
request→authorize→claim→execute→settle path. One supported entrypoint exists
and only one: `npm run relay:julius:mission -- run --contract <file>
[--confirm-live]`, which fails closed naming every missing variable, prints
SET/MISSING only, and starts nothing without the explicit flag. It lives in
the bridge tree because the CLI is boundary-tested never to reference
`relay-bridge`, where two of the three live engines live.

Fourteen offline tests (`relay-bridge/julius/julius-live-composition.test.ts`)
prove the wiring with zero network: C.A.R.D. role→adapter resolution including
the requested models; fail-closed refusal per missing variable before any
adapter is constructed; refusal of a reviewer sharing the coder's vendor;
refusal of a coding agent without the executor port (no local fallback); the
scripted fixtures unreachable from every live module; the full
architect→coder→reviewer drive on the in-memory model with Julius sequencing,
executor-routed effects, reviewer packets fed from Julius-owned artifacts, a
real repair cycle on a blocking verdict, completion granted only by the
verification gate and withheld while a decision is not ACCEPT; and no provider
payload, plan body, or secret-shaped string reaching durable state. Typecheck
(all four projects), the repository boundary, the parity gate and strict
surface parity pass; the parity registry is untouched.

**Findings recorded while wiring, not fixed silently.** (1) The verification
evaluator checks each acceptance criterion's `requiredEvidenceTypes` against
EVERY verified task, so a TEST-typed criterion can never accept the plan task
and a three-role run parks in VERIFYING forever — the composition therefore
stores criteria with empty type lists and carries the machine-testable TEST
requirement on the build task's own `requiredEvidenceTypes`, which `verifyTask`
HALTs without. (2) `runHermesReview` spawns Hermes with env `{PATH, HOME}`
only: the xAI credential reaches the model through the operator's own Hermes
profile, not the process environment; the entrypoint reports `XAI_API_KEY`
presence for the record and says so. (3) The dispatch-path
`JuliusBudgetPort` is an in-process ceiling seeded from the mission spend
limit; durable per-invocation budget rows exist only on the executor
settlement path. (4) Compiled context packets and task-claim lease
generations reach adapters through same-process handoffs, because PostgreSQL
deliberately stores context metadata without packet text; a restart resumes
through the idempotent bootstrap and fresh claims recompile context.

**First real Julius mission: still ABSENT.** Nothing here has executed against
a real provider, a real PostgreSQL, or the real executor service. On the
development machine the entrypoint was executed and correctly reported BLOCKED
(missing `DATABASE_URL` and the five executor variables) with exit 1 and zero
provider contact. Executing the first mission requires a host or CI
environment with PostgreSQL 16, the Docker executor control plane from
`.github/workflows/julius-real-infra.yml`, the three provider credentials, and
an operator running the entrypoint above with `--confirm-live`.

### Independent review of PR #209 (2026-09-01)

A genuinely separate reviewer audited the full diff against source, proving two
findings by executing probes against the composition's own exports. Verdict:
**Critical 0 / High 2 / Medium 7 / Low 3 / Informational 3.** One High and
the trivially-fixable items were repaired in one bounded iteration; the
second High was resolved at its root by PR #210 on main:

- **F1 (High, fixed):** on the resume path the same-process artifact exchange
  is empty, and the probe proved an Independent Reviewer dispatched with an
  empty diff could COMPLETE the mission. The reviewer now refuses a dispatch
  when neither the plan nor the diff artifact is available, and the coder
  refuses without the plan — a resumed run fails visibly instead of
  completing falsely. The durable artifact store remains the real fix and is
  open debt.
- **F2 (High, core-rooted — RESOLVED at the root by PR #210 on main,
  2026-09-01):** the completion rule required EVERY durable verification
  decision to be ACCEPT, so any repair round parked the run in VERIFYING even
  after a successful repair and an approving re-review — proven by probe.
  Main now reads per-task CURRENT effective verification state with
  planner-contract repair-lineage supersession (history immutable, HALT
  fail-closed). After rebasing this branch onto that main, the composition's
  own drive test proves the closure end-to-end: architect → coder → blocking
  review → Julius-planned repair → accepting re-review → **COMPLETED**, with
  the admitting REPAIR still in durable history and completion emitted by the
  run loop's own advance (`julius-live-composition.test.ts`, "a repaired and
  re-approved run reaches COMPLETED"). The driver's `haltCause` reporting
  remains for the cases that still honestly park: a HALT, or a repair lineage
  that never reached acceptance.
- **F3 (Medium, fixed):** `repair:plan` is no longer registered on the coding
  agent — a routed `repair:plan` inherited the plan task's ARTIFACT evidence
  requirement the coder cannot produce, making it a paid dispatch guaranteed
  to HALT. An immediate routing refusal is the honest failure.
- **F8 (Medium, fixed):** a non-approved verdict without blocking-severity
  findings now maps to FAILED review evidence (matching the engine's own
  `hasBlockingFinding` semantics) and `unable_to_review` fails the dispatch,
  instead of parking the run on inconclusive evidence.
- **F4 (Medium, fixed):** a malformed `JULIUS_SCOPED_CREDENTIALS` no longer
  reaches `JSON.parse`'s own error message (which quotes the input — a
  credential map); the refusal is composed and echoes nothing.
- **F10/F11/F12 (Low, fixed):** the bootstrap replay branch matches the
  string the runtime actually throws and reports the run's ACTUAL durable
  state instead of asserting READY; provider-authored model/response
  identifiers are bounded by `safeClaim` before entering durable summaries;
  the phantom `JULIUS_MISSION_WORKSPACE` variable name is gone.

**Open findings carried as debt, in the reviewer's words, unfixed here:**
F5 — the preflight verifies environment variables but probes neither the
hermes binary nor the Agent SDK runtime, so a missing binary surfaces only
after upstream roles were paid (`hermesPreflight` and `probeHostedReadiness`
exist and are not yet called; note `hermesPreflight` performs a tiny real
generation and so belongs behind `--confirm-live`). F6 — the drive loop
claims ANY runnable task in the project, so a leftover non-terminal run in
the same project would be driven by this process's adapters and budget;
scope-to-run filtering is not yet built. F7 — a tolerated base/diff executor
failure still settles durable FAILED command evidence on the task, which
manufactures a repair round the adapter itself meant to absorb. F9 — on
PostgreSQL `repairRoundsFor` reads `julius_repair_cycles`, which nothing on
this path writes, so the contract's `repairCycles` ceiling is not durably
enforced (bounded in practice by idempotent repair task ids and unroutable
`repair:repair:*` types). F14 — the worst-case adapter chain can exceed the
600s lease with no heartbeat during dispatch; safe single-process today,
flagged for the first live run.

## First live mission rig (2026-09-02)

`.github/workflows/julius-first-live-mission.yml` is the only workflow in this
repository that may spend provider money. It is `workflow_dispatch`-only —
there is deliberately no `push`, `pull_request` or `schedule` trigger — runs in
the `julius-live-validation` GitHub Environment, and reaches the paid stage
only when a human types `RUN LIVE MISSION` at dispatch AND the entrypoint's own
`--confirm-live` flag is passed. `scripts/julius-first-live-mission.test.ts`
holds that arrangement in place offline.

**Preflight spends nothing and is the supported dry run.** Dispatching with an
empty `confirm_live` proves the whole rig: PostgreSQL reachable and migrated
with the Julius tables verified present, the independent executor answering,
receipts verifying against the ephemeral signing key, the scoped `execute`
credential authorizing a real operation, the 4 MiB workspace ceiling actually
enforceable, and — the reason `scripts/julius-live-preflight.ts` exists —
`git rev-parse HEAD` succeeding *inside* the sandbox. Commands there run as uid
65532, so a workspace git refuses would yield an empty diff and hand the
Independent Reviewer nothing to review, after the mission had already paid an
architect and a coding agent. The entrypoint is then run without
`--confirm-live` and must exit **5** — which is what proves all three roles
resolved into real adapters — and the configured models are pinned to
`gpt-5.6-sol`, `claude-fable-5` and `xai/grok-build-0.1`. The model a provider
actually serves is a separate fact, observed during the run as
`actualModel` / `servedModel`; no preflight can know it.

**The mission is disposable by construction.** `workspacePath` is a 4 MiB tmpfs
holding a four-file throwaway git repository, never this checkout —
`scripts/julius-live-contract-check.mjs` refuses a contract whose workspace
resolves inside the repository, and refuses `spendUsd > 5` or
`repairCycles > 1`. The sandbox keeps `network: DENY`, so the declared test
command must run with no network and no `node_modules`; `node --test` on plain
CommonJS is what that leaves.

**The deliverables are seeded, tracked, and edited — not created.** An
independent review of the first draft caught two defects that would have made
the paid run fail with certainty. The hosted coding agent is allowed
`Read/Glob/Grep/Edit` and expressly denied `Write`
(`relay-bridge/hosted-coding-agent/hosted-envelope.ts`), so it cannot bring a
new file into existence; and `git diff` — how the mission captures the change
for the reviewer — never reports an untracked file, so even a created file
would have reached the Independent Reviewer as zero bytes. Both vanish when the
deliverables are committed stubs the agent edits. The preflight now also writes
a marker on the host and requires it to appear in the diff captured inside the
sandbox, so that hand-off is proven rather than assumed.

**The reviewer's credential is redirected for the reviewer alone.** Pointing the
job's `HOME` at the profile would also hand it to the live Claude coding agent,
a child of the same process holding `Read/Glob/Grep`. Instead
`RELAY_HERMES_EXECUTABLE` points at a wrapper that sets `HOME` at exec time for
the Hermes child only, and the credential is written to
`$HOME/.hermes/.env` — Hermes's own first lookup for an api-key provider
(`get_env_value_prefer_dotenv`), which needs no TTY and makes no network call.
Its resolvability is then proven through Hermes's own resolver with
`HERMES_HOME` unset, exactly as Julius spawns it.

**Ephemeral by default.** The executor credential root, the database password
and the Hermes profile are generated inside the job and destroyed by an
`if: always()` cleanup step; the Ed25519 signing key is minted by the executor
itself, inside its container. No durable executor secret is provisioned, so
there is nothing to rotate or revoke afterwards. The three provider credentials
are the only stored secrets, and they are referenced by name only.

**The reviewer credential boundary is unchanged.** `runHermesReview` forwards
`{PATH, HOME}` and nothing else to the Hermes child, so the workflow hands the
reviewer its credential by pointing `HOME` at an ephemeral profile written by
`hermes auth add` — the tool's own supported mechanism. `XAI_API_KEY` is
deliberately *not* set on the live step: it would not reach the child, and
setting it would suggest the credential flows through Julius. Julius was not
modified to make any of this easier.

**Open, and why this is not yet proven end to end.** No live mission has run.
Two things are outside this repository: the three provider secrets must be
added to the `julius-live-validation` environment, and Hermes must install on
the runner from `NousResearch/hermes-agent` at the pinned `hermes_ref` — the
proven local build reports a carried commit, so the upstream ref is not known
to be byte-identical to it. The `edit on host → diff via executor` choreography
is production code proven only against an offline fake shell; this preflight is
its first real-infrastructure exercise, which is exactly why it runs before
anything is paid for.

## Final pre-live hardening (2026-09-02)

The independent review's Medium findings, accepted under the one-iteration rule
at the time, are now closed — each with a mutation-proven test.

**F4 — the executor owns its signing key, against every file-reading path.**
The key used to be minted on the runner by the same user that runs Julius, so
any file read could take it — including a `Read` from the live coding agent.
It is now generated inside the executor container by
`.github/julius-executor-entrypoint.sh`, under `/executor-private` — the
container's own writable layer, deliberately not bind-mounted — beside the
ledger. (The receipt store moved to a root-owned host transport after dry run #2;
see below.) What leaves the container is the public key, read
out once over `docker exec`. A preflight step asserts exactly what that
arrangement establishes: the host paths do not exist, the private root is not
among the container's mounts, the executor does hold its key, and what Julius
holds contains a public key and no private material. Stated plainly rather
than implied away: this is a FILESYSTEM boundary, and its adversary is the
file-reading coding agent. The runner user itself holds the Docker socket and
sudo, so a process acting as that user could still `docker exec` the key out —
the same channel this job uses for the public half. Full #208-grade separation
(Julius in its own container, no socket) remains the reference architecture;
here the secret moved instead of Julius, because the coding agent and Hermes
both live host-side. No loopback, network or containment guard changed.

**F5 — evidence is built by allowlist, never by redaction.** Raw `tee`'d logs
are no longer copied into the artifact. `scripts/julius-live-evidence.mjs`
re-emits only lines matching the entrypoint's known shapes — the failure
outcomes (`RESULT: BLOCKED …`, `crashed: …`) included, because the runs that
most need evidence are the ones that went wrong — then drops any survivor
carrying key-shaped or opaque mixed-case material, and reports how many lines
it withheld. Behind it, the workflow greps the evidence for the
JOB'S OWN exact values — provider keys, credential root, database password and
every derived scoped credential — via a needle file deleted before the upload
step exists; a hit deletes the evidence and fails the job without naming which
value matched. Masking is still applied but nothing relies on it.

**F8 — Hermes is pinned to `2ea39daeb1f675d72e5c21c9400f2d58d7e6d71a`.** That
is the exact commit the proven local build runs, and it is public upstream:
the install banner's "+1 carried commit" was bookkeeping against a stale
origin ref in a shallow clone, not a local-only patch. The commit's whole
delta is `gateway/run.py` plus one gateway test — the messaging gateway, which
the reviewer's one-shot CLI path never touches. `pyproject.toml` at that
commit declares `requires-python >=3.11,<3.14` (the runner's 3.12 is in
range) and the `hermes` console script. A mutable ref is refused twice, in
the dispatch gate and again in the install script, before pip runs.

**F9 — dispatch inputs are validated first.** A gate step runs before any
build, container or credential exists: `max_ticks` must be an integer in
[8, 32] — the floor because the six-task graph cannot complete much under
eight ticks, so less would buy a paid run guaranteed to be cut off; the
ceiling because 32 is the entrypoint's own default, so the input can tighten
Julius's bound but never loosen it. A near-miss `confirm_live` phrase is
refused outright rather than silently downgraded to a dry run, and a
non-40-hex `hermes_ref` is refused here too. The gate's bash is executed by
the offline tests with well-formed, malformed, out-of-range and boundary
values.

**F6 — a paid mission cannot repeat by accident.** Live dispatches share one
concurrency group (never cancelled in flight); dry runs get a per-run group,
so proving the rig stays unlimited and free. TWO durable markers, and the
distinction is what the first paid attempt taught:

- `julius-first-live-attempted` is uploaded after every free gate has passed
  and BEFORE the provider-capable entrypoint is invoked. It means a paid run
  was AUTHORIZED AND ENTERED — the strongest claim this job can honestly make,
  since whether a provider was billed is not observable from the runner. It
  carries provenance fields and the Mission Contract's sha256, never its text.
- `julius-first-live-completed` is uploaded only when Julius itself reached
  legitimate completion, exactly as before.

A live dispatch that finds EITHER marker refuses unless the operator typed
`RERUN PAID MISSION`. Run 33697109210 is why: it crossed the live boundary,
failed at its `plan` task and left no marker at all, so an ordinary
re-dispatch would have been treated as the first paid run. A marker list that
answers with something other than a count is now routed to the same refusal an
unreadable list gets, because a default-to-zero is the one answer that lets a
second paid run through.

Both marker steps and the live entrypoint now write `success()` into their
conditions. That guard was already there implicitly — GitHub applies a default
`success()` to a step whose `if:` names no status function, and runs
33625851653 and 33635375764 show it, where a failed preflight skipped every
custom-`if:` step below it. Writing it out is defence in depth, not a repair: a
paid step later given `always()` or `!cancelled()` WOULD reach the entrypoint
that spends, and the contract test now refuses that.

Stated limit, not papered over: artifacts expire and can be deleted, so this
guards against accident — a second dispatch of a mission already entered — and
sits behind the typed phrase and the environment's own approval, not in place
of them. Julius's contract-digest idempotency remains inert across dispatches
because PostgreSQL is per-job; that is a documented property rather than an
implied protection.

**F10 — a failed paid run says why, safely.** The first paid attempt failed at
its Prompt Architect task and the uploaded evidence could not say why: the
normalized `JuliusErrorCode` lived only in the operational event stream and
the trajectory row, neither of which was dumped, and the job destroys its
database. Two repairs, both provider-free:

- The connector's own classification now travels with the code.
  `JuliusDispatchError` carries a `failureClass`, narrowed by
  `safeFailureClass` to `/^[a-z][a-z0-9_]{0,63}$/`, so a provider exception,
  a header or a key shape cannot survive into a durable row even if an adapter
  passes one. Nine coarse codes cannot separate a refusal from a malformed
  response from a 500; the class can.
- The evidence bundle gains `failures.tsv`: task, role, event type, Julius
  code, failure class, `errorRetryable` and timestamp, read from named fact keys and
  never from a whole payload.

A run whose only remaining tasks are blocked behind a terminally failed
dependency now reports FAILED rather than WAITING. A claim is offered only when
every dependency is SUCCEEDED or SKIPPED and nothing revives a FAILED task, so
"waiting" was describing a run that could never move.

## Dry run #1 (2026-09-02) — the executor refused the live output ceiling

The first free dispatch of the first-live workflow (run 33625851653 on main
2335c08) passed the input gate, the disposable workspace, PostgreSQL, the
migrations, the executor start and the key-boundary check, then failed on the
very first `createSandbox`: `executor_operation_invalid:limits.outputBytes`.
The live composition asked for 262,144 bytes of output, a literal chosen in
#209; the executor's validator caps that field at `MAX_SANDBOX_OUTPUT_BYTES`,
derived in #208 from the 4 MiB response envelope (257,377 at the current
constants). The preflight carried the same literal on purpose, which is why it
failed exactly as the paid mission would have, after paying an architect and a
coding agent. No sandbox, receipt or diff existed; Hermes, the contract check
and role resolution were skipped; no provider was contacted.


## Dry run #2 (2026-09-02) — the preflight's identity, and the receipt transport

The second free dispatch (run 33635375764, main 168105b) got past the output
ceiling and failed at its first `createSandbox` with a masked
`executor_failure`. PR #214 made the executor record one safe diagnostic line
per refusal — operation, safe code or `masked`, the error's own class, status —
and reproduced the mission's exact executor on real Docker in a
`first-live-topology` job. The class was 23503, PostgreSQL's foreign-key
violation: the preflight probe had invented a project, run, task and invocation
and seeded none of the rows `julius_sandboxes` references. The probe now seeds a
nonce-scoped, disposable identity in foreign-key order, records each invocation
through the production tool repository with its dispatch claimed for that
invocation alone, and removes exactly what it created; a PostgreSQL-backed
regression holds all of it through the executor's own repository.

With a legitimate identity the matrix then decided the receipt question. The
#212 hardening had placed the receipt root at `/executor-private/receipts`,
inside the executor container's own layer, but the executor asks the HOST
Docker daemon to bind-mount each sandbox's scoped receipt directory and the
daemon resolves bind sources on the host: every sandbox stopped at
`prepareWorkspace` with `sandbox_create_failed class=bind_source_missing`. A
root:root 0700 host directory, `/tmp/julius-executor/receipts`, mounted into
the executor at the same path, carried the whole provider-free preflight to a
pass — create, prepare, execute, signed receipts verified, the host-written
change visible in the sandbox diff, destroy, fixture cleanup. That is now the
mission's transport (`JULIUS_RECEIPT_HOST_ROOT` in the workflow, applied by the
shared launcher). Stated precisely: the receipt root is unreadable by the
runner user, which is the file-reading coding agent's user; a sudo or
Docker-socket holder can still read it. The signing key and the ledger stay
under `/executor-private` and are never bind-mounted anywhere; each sandbox is
handed only `<root>/<sha256(sandboxId)>` at `/julius-receipts-root`: the preflight
reads that from the daemon's own mount table while its third sandbox exists, and
proves from inside that the workload, uid 65532, cannot even list the root-owned
receipt mount. The executor-private shape is kept
in the topology job as an expected-failure regression: green only when the
host daemon refuses it at exactly that point with exactly that class.

Repair: `relay-bridge/julius/sandbox-limits.ts` is now the single place Julius
states its request. `outputBytes` IS the executor's ceiling, imported from the
validator's own module, and both the live composition and the preflight import
those same frozen objects, so parity is identity rather than a maintained copy.
`sandbox-limits.test.ts` runs the live limits through the real validator,
accepts the ceiling and refuses one byte more, and reads the three files that
could hold a second number. No executor limit, guard or validator changed, and
the envelope was not raised. Free dry run #3 (run 33695712645, main
`fb4f21f`) then passed every stage, and the first paid attempt (run
33697109210) followed — it failed at its `plan` task, which is what F10 above
is the repair for.
