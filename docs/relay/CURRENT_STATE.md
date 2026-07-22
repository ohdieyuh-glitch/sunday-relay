# Sunday Relay — Current State

> The single source of truth for where Relay stands. Update at every phase
> boundary. Last updated: **2026-07-22 17:10 UTC** (Prompt 7 complete —
> isolated worktree execution foundation; the July 24 demo remains
> `npm run relay:yc`, with `npm run relay:manual` as the supporting demo).

## Phase

**Prompt 7 — Isolated Worktree Manager and Safe Local Execution Foundation: COMPLETE**
(2026-07-22 17:10 UTC). The security boundary required before Relay may
control a real Claude Code session — REAL local infrastructure
(`provenance: live`, verifier `relay-workspace`), alongside the untouched
simulation demos:
- **Module boundary:** `src/relay/workspace/` — the ONLY Node
  process/filesystem zone in Relay, composed solely by
  `createWorkspaceService`. Provider-neutral ports (`WorkspaceManagerPort`,
  `WorkspaceInspectionPort`, `CommandExecutionPort`); pure browser-safe
  policy modules (contracts, protected-paths, command-policy,
  output-sanitizer, cleanup); Node implementation (repository-inspector,
  worktree-manager, command-runner, workspace-evidence, doctor,
  verify-harness). Boundary-tested: core/protocol/ledger/connectors never
  import the implementation or `child_process`; the CLI uses the facade
  only; adapters cannot create worktrees.
- **Worktree isolation:** validated source root (subdirs/traversal/null
  bytes rejected), pinned revision + base branch (never assumes `main`;
  dirty source allowed but never copied), real `git worktree add -b
  relay/run/<safe-token>` under `<parent>/.relay-workspaces/<project>/
  <run>/` (0o700, realpath-verified, never a symlink, never inside the
  source), post-create verification (HEAD/branch/git-common-dir),
  idempotent registration, conflicting branch reuse refused,
  branch-injection shapes rejected.
- **Source protection:** before/after inspection; unexpected source
  movement → `checkpoint_required` + `workspace.source_changed` + failed
  evidence, never silent continuation; no reset/clean/checkout/commit/
  merge/push of the source exists in the infrastructure git surface.
- **Path + claim enforcement:** policy-input protected paths (baseline
  `.git` always), segment-safe matching, claimed/unclaimed/protected/
  symlink-escape classification of every changed path; protected or
  escaping changes stop work at `checkpoint_required`; unclaimed → dirty +
  flagged; claims are NEVER auto-expanded.
- **Safe execution:** executable+args arrays, `shell: false`, allowlist
  with an absolute denylist above it (shells, destructive git, publish,
  network tools), inspection-only git surface, validated cwd containment,
  env allowlist ∩ secret-name denylist (provider secrets never inherited),
  bounded runtime (30s/120s) and output (256KiB/1MiB, overflow terminates),
  SIGTERM→SIGKILL escalation with HONEST termination reporting,
  cancellation by commandId, secret-shape output redaction, structured
  results with live evidence refs.
- **Cleanup:** authorization ALWAYS required; `preserve_on_failure`
  default (failure/cancelled/dirty/checkpoint preserved even when
  authorized); identity checks before deletion (registered, under approved
  root, never the source, no path sharing); `git worktree remove` never
  forced; unknown workspaces refused.
- **CLI + verification:** `relay workspace doctor` (truthful: worktree
  management live local; agent execution/Claude Code/Codex UNAVAILABLE) ·
  `relay workspace verify` / `npm run relay:workspace:verify` — 23-check
  deterministic harness on a throwaway fixture repo (passed twice).
- **Demo preservation:** `relay:yc:verify` and `relay:manual:verify`
  passed twice AFTER the change; scenario configs, adapters, and the
  recorded flow untouched. Workspace profiles documented
  (none/simulated/local_isolated); existing scenarios stay simulated.
- **Docs:** WORKSPACE_SECURITY.md (new, authoritative) + sync blockquotes
  in ARCHITECTURE/PROTOCOL/SECURITY_BOUNDARIES/TEST_STRATEGY + CLI.md.

**Prior phase — Prompt 6.1 — Manual Task Checkpoint Experience: COMPLETE**
(2026-07-22 13:05 UTC). The final bounded product addition before the
July 24 recording, built ON the existing checkpoint architecture (no second
checkpoint state, engine, or store — the single `RelayRun.checkpoint` slot
carries the one active Manual Task per run):
- **Untrusted request flow:** the coding-agent port gained
  `manualActionRequest?: unknown` — an adapter may ASK for human help but
  never publishes instructions. Relay shape-gates the request
  (`checkManualActionRequest`, strict + hidden-reasoning rejection) and
  `src/relay/core/manual-task.ts` semantically validates it (association,
  run state, requester identity, safety-bypass/destructive/credential-into-
  Relay denylists, permission truthfulness, known verification methods,
  secret-shape + stack-trace rejection) and alone compiles the canonical
  ManualTask. Rejected requests are never shown to the user (generic safe
  checkpoint reason; content never persisted).
- **Extreme simplicity, deterministically validated:** title ≤ 7 words,
  why ≤ 2 short sentences, 3–6 one-action steps ≤ 90 chars, no jargon
  denylist hits, no internal ids; core-compiled security notice for
  credential categories, per-category deterministic help text, and an
  always-present "what Relay will do next" line (honest when verification
  is unavailable).
- **Responses:** `respond-manual-task {done|help|cannot}` (+ canonical
  `cancel-run`). Done records a CLAIM, then Relay runs the configured
  deterministic verification (`manualVerificationOutcomes` seam): passed →
  task completed + core-approved resume; failed → `needs_more_information`,
  run stays stopped; unavailable → honestly disclosed, operator `/approve`
  confirms. Machine intent `record-manual-verification`; supporting
  health-check evidence recorded by Relay. No agent dispatch while a task
  is pending or verifying.
- **CLI:** automatic Manual Task screen at the checkpoint, `/manual`,
  `/done`, `/manual-help`, `/cannot-complete [note]`, and D/H/N/C single
  letters active ONLY at the task prompt; 80-column, plain/no-color/JSON
  safe (JSON = serializable read model, no ANSI/mascot/secrets).
- **Ledger + audit:** full `manual.*` event history (request → validation →
  creation → responses → verification → completion/cancellation) and the
  additive `FinalAuditReport.manualTasks[]` summary.
- **Demo:** `npm run relay:manual` / `relay demo manual` — real core end to
  end (stop → simple steps → Done → verified → resume → complete, exit 0);
  `npm run relay:manual:verify` (double-run semantic acceptance, mirrors
  the YC verifier). `npm run relay:yc` is semantically unchanged
  (verified twice post-change).
- **Docs:** UI_VISION §11 (future desktop/mobile placement),
  YC_VIDEO_SCRIPT supporting sentence, CLI.md Manual Task sections,
  PROTOCOL.md Prompt-6.1 sync.

**Prior phase — Prompt 6 — YC Demo Hardening and Presentation Preset: COMPLETE**
(2026-07-22 09:05 UTC). Added on top of the unchanged workflow:
- **`yc` scenario** in the registry: presentation objective ("Finish
  Sunday's anonymous live-access activation safely…"), 13-check simulated
  completion policy (12 pass + `anonymous spend-control proof` fails on
  attempt 1; 13 pass after the single repair), product-relevant reviewer
  finding (SEC-1 anonymous spend-boundary bypass) — all deterministic
  fixture data, labeled SIMULATED; the real activation is never claimed.
- **Presentation mode** (renderer-only): milestone frames (opening/
  objective/brain/blueprint/owner/handoff/attempt/verify/review/repair/
  re-verify/audit/complete), `--presentation --pace <ms> --compact`,
  ~2.5 s default pacing on TTY (≈40 s total), 80-column safe, mascot
  optional, honest STOPPED SAFELY frame for non-success, exit codes
  unchanged, full event feed still queryable.
- **Commands:** `npm run relay:yc` (exit 0 only on completion) ·
  `npm run relay:yc:verify` (double-run semantic acceptance, passed twice).
- **Docs:** YC_DEMO_RUNBOOK.md (recording checklist, recovery = rerun —
  no false resume claims) + YC_VIDEO_SCRIPT.md (~80 s founder narration
  distinguishing the real engine from simulated agents).

**Prior phase — Prompt 5 — Terminal CLI Client (July 24 demo surface): COMPLETE**
(2026-07-22 07:25 UTC). Implemented in `src/relay/cli` + the core client
seams `src/relay/core/{read-models,app}.ts`:
- **Serializable client boundary** — read models (status, event feed,
  project brain, task/ownership, blueprint, handoff, evidence, review,
  usage, checkpoint, final audit) + the ONE approved composition root
  (`createRelayApp`): serializable commands in, read models out, zero
  workflow logic client-side (boundary-tested both directions).
- **CLI** (`dist-relay/cli.cjs`, esbuild like the backend): `relay` /
  `demo <scenario>` / `run --objective` / `doctor` / `version` / `help`;
  interactive slash-command session (pure line handler, TTY-free tests);
  interactive Guided blueprint approval (canonical accept-blueprint) and
  checkpoint responses; step/continue/pause/resume/cancel; 10 demo
  scenarios incl. mid-run choreography for cancel/pause-resume/stale;
  stable exit codes (0 never for incomplete work; budget stops = 7);
  restrained gold ANSI with NO_COLOR/plain/ASCII fallback; optional 3-line
  mascot bound to real run state; clean `--json` (no ANSI, no mascot);
  truthful `doctor` (DEFERRED labels, no env values). Every screen shows
  `[SIMULATED]` + `SESSION STORAGE: VOLATILE`; no durable-resume claims.
- **Demo commands:** `npm run relay -- demo repair` (exit 0) ·
  `demo checkpoint` (5) · `demo duplicate` (5) · `demo failure` (5) ·
  `demo budget-stop` (7) · `demo cancel` (6) · `doctor` (0). See CLI.md.

**Prior phase — Prompt 4 — Simulation Harness and Full Relay Vertical Slice: COMPLETE**
(2026-07-22 05:15 UTC). Implemented in `src/relay/connectors` +
`src/relay/core/orchestrator.ts`:
- **Four simulation adapters** behind provider-neutral ports (Architect /
  CodingAgent / Reviewer / Verification): deterministic from an explicit
  ScenarioConfig, provenance `simulated` hard-wired, reports re-validated
  through the same schema gate as real input, sessions minted + resumed for
  the single repair, truthful enforcement declarations, no live-execution
  claims anywhere.
- **Workflow orchestrator**: a bounded step engine (one legal action per
  step; runUntilStopped hard-capped) driving the REAL machine, eligibility
  battery, compiler, verification, completion, promotion, and audit;
  budget-gated before every adapter dispatch; core-raised checkpoints via
  the new `raise-checkpoint` intent; command path with duplicate-delivery
  idempotency; commands/reports/events/evidence/usage/audits persisted in
  the in-memory stores (volatile — honestly non-durable).
- **Vertical-slice scenarios green**: direct success · golden path with one
  same-session repair · checkpoint escalation (failed founder condition) ·
  duplicate + stale-revision prevention with zero agent invocation · honest
  failure ×3 (still-failing repair / unavailable verification / live-only
  policy rejecting simulated evidence) · budget hard-stop + warning ·
  pause/resume/cancel/idempotency/terminal protection/checkpoint approval.
- **Run the demo scenarios:** `npx vitest run src/relay/relay-vertical-slice.test.ts`.

**Prior phase — Prompt 3 — Coordination and Handoff Compiler: COMPLETE** (2026-07-22
02:15 UTC). Implemented in `src/relay/{coordination,handoff,verification,recovery}`:
- **Task ownership + leases** — one active owner enforced; assign/renew/
  release/transfer/expire/inspect; expiry never silently transfers; history
  append-only; idempotent assignment; boundary-exact lease expiry (expired
  AT the instant).
- **Duplicate-work prevention** — structured equivalence/idempotency keys
  only (no semantic claims); active/completed/superseded/obsolete/revision/
  retry outcomes with conflicting-task references.
- **Dependency validation** — completion-with-evidence required; cancelled/
  failed/obsolete never count; supersession chains followed; self/circular
  rejected; stale dependencies checkpoint.
- **File/resource claims** — safe path normalization (absolute/traversal/
  null-byte rejected), shared-read vs exclusive-write, parent/child
  conflicts, expiry/release lifecycle, idempotent reacquisition.
- **Version/staleness validation** — ledger/context/base-revision/decision-
  currency/handoff/evidence freshness with current | stale_but_revalidatable
  | stale_blocking | unavailable | invalid; missing revisions honest.
- **Pre-execution battery** — one `evaluateDispatchEligibility` (28 checks,
  structured multi-check result, never dispatches or mutates).
- **Handoff Compiler** — role-specific packages (architect/coding-agent/
  reviewer/security-reviewer/operations) from canonical structured state
  with explicit context selection + exclusion records, artifacts as
  references, pinned ledger/context/base revisions, deterministic +
  idempotent; HandoffCompilationRecord; validation (association, owner,
  staleness, protected-path conflicts, credential-shape, unbounded
  packages, enforcement minimums).
- **CompletionPolicy evaluation** — low-risk preset; Relay-produced
  evidence only; unavailable≠passed, unverified≠failed; provenance policy
  (live never silently accepts simulated); verifier allowlist; independent
  review + unresolved-finding gates; unsupported enforcement blocks or
  checkpoints by risk.
- **Budget stop-before-dispatch** — usd/token/runtime/loop ceilings, no
  rounding bypass, warning threshold, missing-estimate policy
  (allow/checkpoint/deny), estimated-vs-actual preserved.
- **Guided one-repair decision** — all 15 founder conditions individually
  evaluated + recorded; limit denial; RevisionContract compilation (narrow,
  task identity preserved, claims never expanded, no second repair).
- **Repeated-failure / no-progress detection** — safe structured
  fingerprints (no secrets; deterministic, not cryptographic); conservative
  no-progress (insufficient_data honest); **bounded recovery decision**
  (continue/compile_revision/checkpoint/blocked/fail_run; no provider
  reassignment).

**Prior phase — Prompt 2 — Protocol and State Machine: COMPLETE** (2026-07-21 22:17 UTC).
Implemented: `relay.protocol.v1` (versioned envelopes for commands /
reports / events / queries, branded ids, enums, structured errors, strict
hand-rolled runtime validation with hidden-reasoning rejection); the
Prompt-2 contract set (RelayProject/Run/Task, TaskAssignment, File/Resource
claims, Blueprint, AgentHandoffPackage + CompilationRecord +
RevisionContract, Evidence Record/Bundle, VerificationRecord,
CompletionPolicy, ReviewerVerdict, Failure/Decision/Approval/OpenQuestion/
Usage records, FinalAuditReport, Checkpoint + budget/loop/permission policy
shapes; DisagreementRecord schema-only; ProjectRequirement/
ArchitectureRecord interface-only per PROTOCOL §6); the deterministic
RelayRun status×phase machine (centralized `transitionRun`: golden path,
one-revision path, 15-condition checkpoint escalation, honest-failure stop,
terminal protection, completion guard requiring Relay-produced passing
verification + independent approval); RelayTask transition validation with
owner/evidence/finding invariants, staleness + decision-invalidation
primitives, lease-expiry recovery; the append-only ledger foundation
(gap-free monotonic sequences, frozen envelopes, idempotency, deterministic
replay projection, claim record/promote/reject with exactly-once
promotion); storage ports + volatile test-only in-memory adapters (explicit
`acknowledgeVolatile` guard); deterministic test factories.
**Not implemented (by design):** CLI, adapters, simulation workflow,
handoff-compiler behavior, coordination wiring, persistence, UI.

**Prior phase — Phase 1 Architecture Lock (complete, commit 59b14e8):**
founder decisions 1–10 encoded into this documentation set.

## Authoritative documents (docs/relay/)

| Document | Role |
| --- | --- |
| RELAY_MVP_SPEC.md | Product scope, five-system MVP, Guided Mode rules, July 24 demo definition |
| ARCHITECTURE.md | Placement, module boundaries, dependency direction, hybrid execution, diagrams |
| PROTOCOL.md | `relay.protocol.v1` contracts + Prompt-2/deferred markings |
| SECURITY_BOUNDARIES.md | Trust boundaries, credentials, isolation, enforcement matrix, threats |
| TEST_STRATEGY.md | Planned tests per prompt + first deterministic demo scenarios |
| DECISIONS.md | ADR-001…020 + dependency analysis (zero dependencies added) |
| UI_VISION.md | Permanent visual direction (locked earlier, commit cec62dd) |
| SESSION_LOG.md | Append-only phase journal |

Superseded (historical, headers added): root `RELAY_STATUS.md`,
`RELAY_INTEGRATION.md`. AGENTS.md gained narrowly scoped §7 (Relay).

## Prototype status

The golden-path web app (`/relay.html`, `src/relay/**`) is the **Relay
Protocol Prototype**: preserved, committed, truthfully labeled; its pasted
evidence is classified `unverified claim`; it may be demoed only under the
prototype label. Its dogfood run (real independent review R1–R6 + real
repairs, commits 3277ffc/508fb92) remains a genuine artifact.

## Accepted founder decisions (2026-07-21)

1. Hybrid local/cloud execution; credential-free core; SpendAuthorizationPort
   + CloudDispatchGateway outside core; both budget layers must approve
   Aquala-funded calls.
2. Prompt Architect: simulated / imported (ChatGPT-authored, human-supervised)
   / live adapter later; no provider hardcoded; initial real workflow uses
   imported Blueprints.
3. Codex is the first live independent Reviewer; independence from
   assignment/session lineage; manual review labeled manual.
4. Guided Mode: max one automatic repair behind 15 deterministic conditions;
   otherwise checkpoint_required; never a second automatic repair.
5. Every control classified enforced / advisory / unsupported; matrix in
   SECURITY_BOUNDARIES.md; UIs display the true level.
6. July 24 demo = real Core + CLI on simulation adapters (no paid calls, no
   fake execution claims); prototype shown only as "Relay Protocol
   Prototype"; live Claude Code run is a safety-gated stretch goal.
7. Prototype preserved, not deleted; paste evidence = unverified claim.
8. Logical boundaries per ARCHITECTURE.md §1; directories under `src/relay/*`.
9. All clients consume the same Relay Core; no client-side workflow logic.
10. Stale docs superseded with headers; authoritative set under docs/relay/;
    narrow AGENTS.md Relay section added.

## Completed work

- Relay Protocol Prototype (2026-07-21 morning): domain, gate, store, web
  UI, 7 test files, dogfooded adversarial review + repairs. All green.
- UI vision locked (cec62dd).
- Pre-Phase-1 architecture analysis (accepted) + 3-lens adversarial critique.
- **This phase**: authoritative docs set written; supersession applied;
  AGENTS.md §7; verification run (see SESSION_LOG.md for exact results).

## Current work

None in flight — Phase 1 closes with this commit.

## Next prompt

**Real Claude Code Local Adapter** — a live coding-agent adapter that
executes INSIDE the Prompt-7 workspace boundary: dispatch prepares an
isolated workspace from the handoff (claims → policy input), the local
Claude Code session runs confined to that worktree, its commands route
through the approved command policy, all changes pass the inspection gate
(claimed/protected/symlink) before any report is trusted, and evidence
carries true live provenance distinct from the workspace infrastructure's.
Safety gates from SECURITY_BOUNDARIES.md and WORKSPACE_SECURITY.md apply
unweakened; no push, no deployment, spend controls per Decision 1.

**Superseded next-prompt record (pre-Prompt-7): Post-YC Durable Local
Persistence and Real Cross-Process Resume** — implement the relay-storage
file-backed repositories per ADR-016 (append-only JSONL event log + JSON
projections under a project-local `.relay/` directory, node builtins only,
behind the existing storage ports; deterministic replay-on-load; honest
crash-recovery semantics; truthful `relay resume <run-id>`). Now queued
AFTER the Claude Code adapter; the workspace registry joins this
persistence scope when it lands.

**Superseded next-prompt record (Prompt 5, now complete):** implement
`src/relay/cli` as a THIN client per UI_VISION.md — `node:util.parseArgs`,
esbuild-bundled like the backend (`dist-relay/cli.cjs`); commands to create
a project/run, drive the simulated vertical slice, respond to checkpoints,
pause/resume/cancel, and inspect run status / event feed / handoff /
evidence / audit via serializable read models; renders normalized events
with truthful provenance labels (SIMULATED badges) and enforcement levels;
zero workflow logic in the client (boundary-tested); scenario walkthroughs
of TEST_STRATEGY §11 runnable from the terminal — the July 24 demo surface.
No real adapters, no persistence, no UI beyond the terminal, no paid calls.

**Superseded next-prompt record (Prompt 4, now complete):** implement the simulation adapters (Architect / CodingAgent /
Reviewer / Verification) behind the connector ports — every output stamped
`provenance: simulated`, each adapter declaring simulated-vs-enforced
policies — plus the orchestrator loop that wires commands → state machine →
coordination battery → compiler → simulated execution → evidence →
completion → promotion → final audit, exercising TEST_STRATEGY §9 adapter
contracts and the four §11 demonstration scenarios end-to-end (golden path
with one repair; checkpoint escalation; duplicate/stale prevention; honest
failure). Still no CLI (next after), no real adapters, no persistence, no
paid calls.

**Superseded next-prompt record (Prompt 3, now complete):** wire relay-coordination's pre-execution battery
(duplicate/equivalent/completed/superseded task detection, file-claim
conflicts, stale context/base-revision/decision checks — the primitives
from Prompt 2 — into dispatch), lease bookkeeping over the stores, and
implement relay-handoff's compiler behavior: compile AgentHandoffPackage +
HandoffCompilationRecord from ledger refs at pinned versions, role-specific
package composition, Revision Contract compilation with real evaluation of
the 15 Guided-Mode conditions, CompletionPolicy evaluation (low-risk
preset), and relay-recovery's repeated-failure/no-progress detection
functions over FailureRecords. Tests per TEST_STRATEGY §§5–7. Still no
adapters, no CLI, no persistence, no UI, no paid calls.

Remaining carried-over Prompt-2 notes: budget stop-before-dispatch wiring
(TEST_STRATEGY §7) lands with the compiler/checkpoint work; CompletionPolicy
evaluation and FailureRecord detection functions were deferred to Prompt 3
with the compiler since they operate on compiled dispatches.

## Known blockers

None.

## Known risks

- July 24 is 3 days out: Prompts 2–4 (protocol/core → simulation harness →
  CLI) must land on schedule for the demo definition in RELAY_MVP_SPEC §8.
- The worktree-manager safety gate makes the live-Claude-Code stretch goal
  unlikely by the 24th — by design; do not weaken.
- Prototype relocation to `src/relay/prototype/` (with boundary-test
  rewrite) is deliberately deferred to a later prompt to keep this phase
  docs-only.

## Verification status

See SESSION_LOG.md entry 2026-07-21 (Phase 1) for the exact commands run
and results in this phase.

## Branch / worktree

`../sunday-relay` worktree, branch `feature/relay-yc-demo`. Phase 1 docs
commits: c0a959f (protocol+architecture), ccebea5 (spec+security), 36ebc0e
(tests+ADRs), b8359e2 (state/log/supersessions/AGENTS §7), then the final
audit-fix lock commit (`docs(relay): lock expanded Relay architecture` —
see `git log`).
