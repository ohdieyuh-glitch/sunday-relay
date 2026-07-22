# Sunday Relay — Current State

> The single source of truth for where Relay stands. Update at every phase
> boundary. Last updated: **2026-07-22 (Prompt 8.2 complete — Mission Control,
> operational modes, Relay Dog, live terminal, reviewer release gate).** The
> July 24 product demo is `npm run relay:yc`; `npm run relay:mission-control`
> is the graphical product surface (deterministic projection); `npm run
> relay:competitive` is the deterministic full-workforce proof (Mission
> Contract + Claude + Codex + finding + repair + verdict); and `npm run
> relay:claude:live` is the real single-agent proof.

## Phase

**Prompt 8.2 — Mission Control, Operational Modes, Relay Dog, Live Terminal,
and Pro/Max Reviewer Gate: COMPLETE** (2026-07-22). The final major
product-facing phase before the July 24 demo — a graphical Mission Control
surface plus four Relay-Core-owned systems, all built as PURE, browser-safe
projections/policies (no second engine, no client-side workflow):
- **Operational Modes** (`mission/modes.ts`) — guided/semi/autonomous as
  canonical policies (steps/repairs/spend/ask/credential defaults). Relay Core
  owns the mode; the UI submits, never decides. Autonomous escalation needs an
  immutable consent event (bounded scope; `'*'`/`'all'` rejected); reduction is
  immediate; 17 boundary stop-actions; autonomous never bypasses the reviewer
  or a Manual Task. CLI `/mode`.
- **Secure Access** (`mission/credential-handle.ts`) — a `CredentialHandle`
  that NEVER holds the value; secret-shaped keys/values rejected; no
  raw-password storage; scope/expire/revoke; MFA/user-presence →
  `requires_manual_task`; summary carries names/scopes only. NOT a full
  encrypted vault (deferred). CLI `/access`.
- **Relay Dog** (`mission/dog.ts`) — 16 deterministic event-driven states;
  terminal/boundary → phase → speed; `sprinting` requires sustained
  architect+coding coordination (SYNC HIGH); speed is a pure function of
  meaningful events (never token stream / adapter / UI / fabricated);
  reduced-motion honored; ASCII + React frames. CLI `/dog` (`motion on|off`).
- **Live Terminal** (`mission/terminal.ts` + `ui/LiveTerminal.tsx`) — a
  read-only projection of structured responsibility exchanges over existing
  events; in-process stream with dedup/ordering/gap detection/reconnect;
  redaction + "Private reasoning omitted."; the `[>_]` button (aria "Open Live
  Terminal", active/waiting/failure dot); desktop drawer + mobile full-screen.
  Production WebSocket NOT implemented (in-process only). CLI `/terminal`.
- **Reviewer entitlement + release gate** (`mission/entitlement.ts`) —
  RelayEntitlement (free/pro/max/enterprise) separate from mode; pro/max unlock
  an independent Reviewer; the output-visibility state machine
  (working→held_for_verification→held_for_review→revision_required→
  approved_for_release→released; blocked) is Relay-Core-owned and never
  releases before the required independent review + CompletionPolicy;
  independence is structural; reviewer package excludes transcript/secrets.
  CLI `/reviewer`.
- **Mission Control UI** (`ui/`) — compact, progressive-disclosure React
  surface in the Relay identity (near-black/bone/Sunday-gold/terminal density),
  desktop + mobile, accessible + reduced-motion; projects Relay Core via
  `ui/data.ts` and submits commands only; `main.tsx` renders it; the Vite
  build proves it is browser-safe.
- **Demo:** `npm run relay:mission-control` / `relay demo mission-control` —
  deterministic projection of modes/consent/dog/reviewer-gate/exchanges/
  terminal/access, 80-column, no ANSI, clean JSON, exit 0, stable across runs.
  Reviewer labeled SIMULATED (external Codex not active); terminal transport
  in-process; state volatile.
- **Regression:** `relay:yc:verify`, `relay:manual:verify`,
  `relay:workspace:verify` passed twice each; `relay:claude:contract-verify`
  30/30; `relay:competitive` and `relay:mission-control` deterministic (exit
  0). Relay suite 413/413 (35 files); full suite 2002/2002 (153 files);
  typecheck + frontend + backend + relay builds green. NO provider call.
- **Docs:** MODES.md, RELAY_DOG.md, LIVE_TERMINAL.md, REVIEWER_GATE.md,
  MISSION_CONTROL.md (new) + sync blockquotes across RELAY_MVP_SPEC/
  ARCHITECTURE/PROTOCOL/SECURITY_BOUNDARIES/UI_VISION/CLI/TEST_STRATEGY,
  YC_DEMO_RUNBOOK §11, CURRENT_STATE, SESSION_LOG.

**Prior phase — Prompt 8.1 — YC Competitive Proof Layer: COMPLETE** (2026-07-23). The
minimum missing competitive structures + presentation so the YC demo
visibly proves Relay is provider-neutral mission control ABOVE the agents —
not another coding agent. Built as PURE, browser-safe PROJECTIONS over
existing canonical state (`src/relay/mission/`) — no second source of truth,
no second workflow engine (the competitive scenario reuses the Prompt-4
orchestrator's real golden path):
- **Mission Contract** (`mission.ts`) — revisioned projection from
  project/blueprint/task/policy; deterministic validation; binding-digest
  staleness (binding changes stale handoffs, display changes do not);
  secret/hidden-reasoning rejection; CLI `/mission`.
- **Execution Attestation** (`attestation.ts`) — immutable requested-vs-
  actual identity; launch-request ≠ proof; failed launch cannot attest;
  visible policy-authorized fallback that never inherits the requested
  identity; live/simulated provenance from the adapter descriptor; no
  "Reviewed by Codex" without a Codex attestation; CLI `/attestation`.
- **Review/Finding/Repair ledger** (`review-repair.ts`) — linked records;
  blocking findings create scope-locked repairs; resolution needs post-repair
  evidence AND an approving re-review (never an agent claim); no scope/claim
  expansion; iteration limit; CLI `/findings` `/repairs`.
- **Mission verdict engine** (`verdict.ts`) — the eight deterministic
  verdicts (not aliases); agent claims are never evidence; approval never
  bypasses a missing/failed required test; missing review/evidence/
  attestation blocks verified_complete; CLI `/verdict`.
- **Mission timeline** (`timeline.ts`) — ordered, attributable projection
  over the existing event stream with requested-vs-actual identity,
  provenance, attempt, and revision; finding/repair/resolution spliced once;
  failure path representable; CLI `/timeline`.
- **Competitive golden path** — `relay demo competitive` /
  `npm run relay:competitive`: Mission Contract → CLAIMED COMPLETE →
  independent Codex review finds the IPv6 /128 rotation bypass (CHANGES
  REQUIRED) → F-1 + R-1 → repair claim (finding open) → 6/6 Relay
  verification → Codex re-review approves → F-1 resolved → VERIFIED COMPLETE.
  Truthful labels: Claude Implementer + Codex Reviewer are deterministic
  SIMULATIONS here; external Codex not active; real Claude via
  `relay:claude:live`. No provider call.
- **19-feature coverage matrix** — `COMPETITIVE_FEATURE_COVERAGE.md`
  (implemented / partially_implemented / deferred, honestly assessed).
- **Regression:** `relay:yc:verify`, `relay:manual:verify`,
  `relay:workspace:verify`, `relay:claude:contract-verify` all pass
  (twice where required); relay suite 379/379; full suite 1968/1968;
  typecheck + all builds green.
- **Docs:** MISSION_CONTRACT.md, EXECUTION_ATTESTATION.md,
  REVIEW_REPAIR_LEDGER.md, COMPETITIVE_FEATURE_COVERAGE.md (new) + sync
  blockquotes across the authoritative set + CLI.md + YC_DEMO_RUNBOOK §10.

**Prior phase — Prompt 8 — Real Claude Code Local Adapter and Live Isolated Coding Proof: COMPLETE**
(2026-07-23; Gate A offline + Gate B live smoke both passed). One real local
Claude Code coding agent connected to the Prompt-7 isolated-worktree boundary
behind the existing provider-neutral `CodingAgentAdapter` port:
- **Module:** `src/relay/connectors/claude-code/` — capability probe, auth
  classification, settings/MCP risk detection, credential-stripping
  environment, permission compiler, prompt compiler, shell-free bounded
  process runner, incremental stream-json parser, event normalizer, strict
  report parser, session manager (capture + explicit resume), the adapter
  (implements the port; sync `execute` refuses live launch), the live-run
  orchestrator, doctor, safe-edit fixture, deterministic fake executable,
  and the offline contract harness. Relay Core never imports it
  (boundary-tested).
- **Authentication:** approved profile `claude_local_subscription` (Claude's
  own OAuth; verified `claude.ai` first-party, subscription `max`). Relay
  never reads/stores/prints credentials; API-key/Bedrock/Vertex/base-URL env
  vars are stripped; an API-key source triggers a Manual Task, not an
  API-billed run.
- **Execution:** Claude runs ONLY inside a ready isolated worktree (cwd),
  `shell:false`, tool-restricted (Read/Glob/Grep/Edit; no Bash/network/MCP),
  `--safe-mode`+`--strict-mcp-config` isolation, bounded runtime/output,
  cancellation, hidden-reasoning omission, no `--dangerously-skip-
  permissions`. This CLI (v2.1.217) has no `--max-turns`; bounded by
  runtime/output/2-call ceiling (disclosed).
- **Trust:** the Agent Execution Report is an unverified claim; Relay
  independently inspects the worktree (claimed/protected/unclaimed/symlink/
  source) and runs `node --test` through the Prompt-7 command runner
  producing live evidence; a low-risk CompletionPolicy (accepted provenance
  live, no reviewer) then evaluates. Session UUID captured + stored with
  association only (never tokens); one focused repair resumes the exact
  session (wrong id / second repair rejected).
- **Commands:** `relay claude doctor` (truthful, no model call),
  `npm run relay:claude:contract-verify` (30-check offline pipeline proof
  via a fake Claude, no provider call), `npm run relay:claude:live` (the
  explicit REAL proof; `--confirm-live`, never in tests/CI).
- **Gate B live smoke (passed):** real Claude session started → one claimed
  file (`src/normalize.js`) changed → 0 protected/unclaimed changes → source
  fixture unchanged → Relay-run `node --test` PASS → live Final Audit
  "verified-complete", "Independent reviewer: not required by the low-risk
  policy" → RELAY COMPLETE. No deployment, push, credential access, API-key
  use, or source modification; temp fixture cleaned.
- **Regression:** `relay:yc:verify`, `relay:manual:verify`,
  `relay:workspace:verify`, and `relay:claude:contract-verify` all pass;
  relay suite 342/342; full suite 1931/1931; typecheck + all builds green.
- **Docs:** CLAUDE_CODE_ADAPTER.md + LIVE_CLAUDE_DEMO.md (new) + sync
  blockquotes in ARCHITECTURE/PROTOCOL/SECURITY_BOUNDARIES/TEST_STRATEGY,
  CLI.md, YC_DEMO_RUNBOOK.md §9.

**Prior phase — Prompt 7 — Isolated Worktree Manager and Safe Local Execution Foundation: COMPLETE**
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
| MISSION_CONTROL.md | Graphical product surface; projection layer; truthful status (Prompt 8.2) |
| MODES.md | Operational modes (guided/semi/autonomous), consent, boundary stops (Prompt 8.2) |
| RELAY_DOG.md | Deterministic event-driven activity indicator (Prompt 8.2) |
| LIVE_TERMINAL.md | Structured-exchange read model; in-process transport (Prompt 8.2) |
| REVIEWER_GATE.md | Entitlement + output-visibility release gate (Prompt 8.2) |
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

**Real Codex Independent Reviewer Adapter** — a live, independent reviewer
behind the existing reviewer port, so a live run can REQUIRE and satisfy
independent review AND produce a real reviewer Execution Attestation (the
Prompt-8.1 competitive proof simulates it). Independence is structural
(distinct adapter/session lineage from the coding agent), the reviewer
verdict is an unverified claim gated by Relay, real findings feed the
Prompt-8.1 Review/Finding/Repair ledger, and the same safety boundaries
(isolated workspace, no push/deploy, credential-free core, spend controls
per Decision 1) apply unweakened. Only then does a live run demonstrate the
full Architect → Claude → independent Codex → review → bounded repair →
verified-complete loop against real agents.

**Superseded next-prompt records:** *Real Claude Code Local Adapter* — DONE
(Prompt 8, live smoke passed). *YC Competitive Proof Layer* — DONE
(Prompt 8.1). *Mission Control, Operational Modes, Relay Dog, Live Terminal,
Reviewer Release Gate* — DONE (Prompt 8.2). The Reviewer surfaced there is a
deterministic SIMULATION; the Real Codex adapter below makes it live.

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
