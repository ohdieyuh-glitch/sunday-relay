# Sunday Relay — Session Log (append-only)

> Newest entry last. Never overwrite prior entries.

---

## 2026-07-21 — Phase 1: Founder Decision Lock and Expanded Architecture

**Timestamp:** 2026-07-21 ~17:05 UTC (start) → ~17:35 UTC (close).

**Prompt objective:** Turn the accepted pre-Phase-1 analysis and founder
decisions 1–10 into an authoritative, internally consistent architecture
package that Prompt 2 can implement without unresolved product ambiguity.
Docs only — no core, CLI, adapters, simulation, persistence, or UI.

**Founder decisions accepted:** 1 hybrid dispatch + credential ownership +
spend layering · 2 Prompt Architect identity (simulated/imported/live;
ChatGPT as external human-supervised architect today) · 3 Codex as first
live independent Reviewer · 4 Guided Mode one-repair conditions (15) ·
5 enforced/advisory/unsupported classification · 6 July 24 simulation-demo
scope + gated stretch goal · 7 prototype preservation/classification ·
8 authoritative module boundaries · 9 clients of one Relay Core ·
10 document governance.

**Documents created:** docs/relay/PROTOCOL.md, ARCHITECTURE.md,
RELAY_MVP_SPEC.md, SECURITY_BOUNDARIES.md, TEST_STRATEGY.md, DECISIONS.md
(ADR-001…019 + dependency analysis), CURRENT_STATE.md, SESSION_LOG.md
(this file).

**Documents updated:** RELAY_STATUS.md + RELAY_INTEGRATION.md (superseded
headers prepended; bodies preserved as historical); AGENTS.md (new
narrowly scoped §7 Sunday Relay — worktree, headless core, terminal-first
scoping of §5.6, provenance truthfulness, worktree-manager safety gate,
docs pointer).

**Files deliberately left unchanged:** all `src/**` (including the
prototype — no relocation this phase), `relay.html`, `vite.config.mts`,
`package.json` (zero dependencies added), CLAUDE.md, docs/relay/UI_VISION.md
(already authoritative, cec62dd).

**Architecture decisions:** ADR-001…019 in DECISIONS.md, all accepted.

**Commands run / tests:**
- `npm run typecheck` — clean.
- `npx vitest run src/relay` — 7 files, **49/49 passed**.
- `npx vitest run src/relay/relay-boundary.test.ts` — **7/7 passed**.
- `npx vitest run` (full suite; justified: AGENTS.md + root docs edited and
  source-level tests read repo files) — **1638/1638 passed** (123+ files,
  328s).
- No provider calls, no paid calls, no deployment, no push to main, no
  production UI.

**Known blockers:** none.

**Exact next step:** *Prompt 2 — Relay Protocol, Domain Model, and
Deterministic Run State Machine* (scope pinned in CURRENT_STATE.md §Next
prompt and PROTOCOL.md's Prompt-2 markings).

---

## 2026-07-21 — Phase 1 resume after usage-limit interruption (audit + fixes)

**Timestamp:** 2026-07-21 ~20:40 → 21:15 UTC.

**Resume context:** the session usage limit interrupted the two-lens
adversarial audit of the Phase-1 docs (acceptance lens completed;
consistency lens died mid-run). All Phase-1 docs were already committed
(b8359e2); no partial/uncommitted work existed.

**Recovery inspection:** repo root `~/sunday-relay`, branch
`feature/relay-yc-demo`, clean tree, cec62dd + full docs/relay/ set
present and committed. Stopping point identified as "audit findings not
yet applied".

**Audit results (both lenses pass-with-fixes; all findings verified then
fixed):**
- Acceptance lens (10 findings): blueprint reports are now run-level
  (no taskId/packageId — PROTOCOL §1.3); MVP workflow order aligned
  (task AFTER accept-blueprint, recorded as **ADR-020**);
  ProjectRequirement + ArchitectureRecord classified in PROTOCOL §6;
  skill-permissions subsection added to SECURITY §4; disagreement seam
  added to ARCHITECTURE §7/§8; autonomous-provider-switching non-goal
  added to MVP_SPEC §5; prompt-numbering contradiction removed
  (PROTOCOL §2.2); boundary-walk timing split (TEST_STRATEGY §8);
  id-prefix list completed + commandId/queryId exemption (PROTOCOL §0);
  enforcement-level display added to UI_VISION §5 detail views.
- Consistency lens (9 findings): run-level `blocked` mapping defined
  (task blocked → run checkpoint_required; audit outcome may be blocked)
  and aligned across PROTOCOL/MVP_SPEC/ARCHITECTURE; import-row promotion
  rule corrected (only accept-blueprint is a human accept command; manual
  reviews promote via CompletionPolicy); `contextVersion` vs
  `ledgerVersion` defined (PROTOCOL §0); `provenanceProfile` derivation
  rule defined (imported+live ⇒ mixed); `invalidated-by-decision`
  pre-execution check restored + TEST_STRATEGY §5 case; ADR count
  corrected to 001…020; dangling §secrets cross-reference fixed;
  ARCHITECTURE §6 DONE node relabeled (audit precedes terminal
  completed); CURRENT_STATE §Next prompt expanded to the full Prompt-2
  module scope.

**Founder decisions applied:** 1–14 of the resume prompt (identical to
Decision Lock 1–10) — no deviations.

**Documents updated this entry:** PROTOCOL.md, ARCHITECTURE.md,
RELAY_MVP_SPEC.md, SECURITY_BOUNDARIES.md, TEST_STRATEGY.md, DECISIONS.md
(+ADR-020), UI_VISION.md (enforcement display — visual direction itself
unchanged), CURRENT_STATE.md, SESSION_LOG.md (this entry).
**Deliberately preserved:** prototype code untouched; superseded headers
unchanged; AGENTS.md §7 unchanged; no dependencies; no code.

**Commands / tests (this resume):**
- `npx vitest run src/relay/relay-boundary.test.ts` — **7/7 passed**.
- `npx vitest run src/relay` — **49/49 passed** (7 files).
- `npm run typecheck` — clean (exit 0).
- Full suite not re-run for the doc-only audit fixes; last full run this
  phase (after AGENTS.md/root-doc edits): **1638/1638 passed** (328s).
- No provider/paid calls, no credential access, no deployment, no push.

**Known issues:** none blocking. Prompt-2 schedule pressure for July 24
remains the tracked risk (CURRENT_STATE §Known risks).

**Exact next step:** *Prompt 2 — Relay Protocol, Domain Model, and
Deterministic Run State Machine* per CURRENT_STATE §Next prompt.

---

## 2026-07-21 — Prompt 2: Protocol, Domain Model, Ledger Foundation, Run State Machine

**Timestamp:** 2026-07-21 ~21:55 → 22:20 UTC.

**Objective:** implement the first executable Relay foundation — versioned
protocol contracts, runtime validation, domain models, minimal canonical
ledger, deterministic RelayRun/RelayTask machines, structured errors,
test-only in-memory repositories, comprehensive deterministic tests. No
CLI/adapters/simulation/persistence/UI.

**Preflight:** clean tree at 59b14e8 (Phase 1 complete); CURRENT_STATE
named this phase; conventions confirmed (vitest, hand-rolled validators,
prefix ids, ISO UTC, RelayResult pattern). No discrepancies.

**Files created:** `src/relay/protocol/` — version.ts, errors.ts, ids.ts,
enums.ts, validate.ts, contracts.ts, envelopes.ts, index.ts,
protocol.test.ts · `src/relay/core/` — run-machine.ts, task-machine.ts,
index.ts, run-machine.test.ts, task-machine.test.ts · `src/relay/ledger/`
— ledger.ts, projection.ts, promotion.ts, index.ts, ledger.test.ts ·
`src/relay/storage/` — interfaces.ts, memory.ts, index.ts ·
`src/relay/testing/` — factories.ts · `src/relay/relay-core-boundary.test.ts`.
**Files modified:** docs/relay/PROTOCOL.md + TEST_STRATEGY.md
(implementation-sync headers), CURRENT_STATE.md, SESSION_LOG.md (this
entry). **Prototype untouched;** existing relay-boundary.test.ts untouched.

**Architecture decisions applied:** documented status×phase run model wins
over the prompt's flat state list (PROTOCOL.md authoritative; run-level
blocked = checkpoint_required); additive command set (`dispatch-task`,
`dispatch-revision`, `cancel-run` reason); dotted event-kind taxonomy with
required safeSummary; provenance stays the documented four values with
`dispatchPath` on usage records covering live_local/live_cloud; strict
schemas with designated `metadata` escape hatch; hidden-reasoning denylist
on untrusted payloads; ADR-009 hand-rolled validators; ADR-016 in-memory
first behind ports.

**Dependencies:** none added (zod/state-machine/CLI frameworks all
avoided; existing vitest + TS only).

**Tests run (exact):**
- `npx vitest run src/relay` — **111/111 passed** (12 files: 62 new
  Prompt-2 tests + 49 prototype tests).
- `npx vitest run` (full repository) — **1700/1700 passed** (174s).
- `npm run typecheck` — clean. `npm run build` — green.
  `npm run backend:build` — green.
**Failures + repair (one each, then green):** (1) event immutability —
appendEvent returned the pre-freeze envelope while the store froze a copy;
fixed by freezing the stored envelope itself. (2) boundary test flagged
ledger.test.ts for importing the volatile adapter; scoped the
adapter-import ban to production files (tests legitimately use it).

**Security:** no provider calls, no paid calls, no credential access, no
secret material in fixtures (asserted by the credential-shape scan), no
deployment, no push to main.

**Known issues:** budget stop-before-dispatch wiring, CompletionPolicy
evaluation, and FailureRecord detection functions deliberately ride with
Prompt 3 (they operate on compiled dispatches). Prototype relocation to
`src/relay/prototype/` remains deferred.

**Exact next step:** *Prompt 3 — Task Ownership, Duplicate-Work
Prevention, and Structured Handoff Compiler* (scope pinned in
CURRENT_STATE.md §Next prompt).

---

## 2026-07-22 — Prompt 3: Coordination, Handoff Compiler, Completion Policy, Bounded Recovery

**Timestamp:** 2026-07-21 ~23:50 → 2026-07-22 02:20 UTC.

**Objective:** the deterministic coordination layer — task ownership +
leases, duplicate-work prevention, dependency validation, file/resource
claims, staleness validation, the centralized 28-check pre-execution
battery, the provider-neutral Handoff Compiler with role-specific
composition, low-risk CompletionPolicy evaluation, budget
stop-before-dispatch, the Guided one-repair decision + RevisionContract
compilation, repeated-failure/no-progress detection, and bounded recovery
decisions. No orchestrator loop, no adapters, no shell/Git, no CLI/UI.

**Preflight:** clean tree at ba2122d (Prompt 2 complete per
CURRENT_STATE.md); no discrepancies between this prompt and PROTOCOL.md
beyond additive deltas recorded in the PROTOCOL sync note.

**Files created:** `src/relay/coordination/` — ownership.ts, checks.ts,
claims.ts, eligibility.ts, index.ts + 4 test files ·
`src/relay/handoff/` — compiler.ts, validation.ts, revision.ts, index.ts,
handoff.test.ts · `src/relay/verification/` — completion.ts, budget.ts,
index.ts, verification.test.ts · `src/relay/recovery/` — repair.ts,
detection.ts, decision.ts, index.ts, recovery.test.ts ·
`src/relay/relay-coordination-scenarios.test.ts` (Section-24 scenarios 1–9).
**Files modified:** protocol contracts/enums/envelopes (additive deltas per
PROTOCOL sync note), storage interfaces + memory (6 new stores), testing
factories (9 new builders), relay-core-boundary.test.ts (walk extended to
the four new roots + no-shell/no-Git/no-reassignment assertions),
PROTOCOL.md, TEST_STRATEGY.md, CURRENT_STATE.md, SESSION_LOG.md.
**Prototype untouched.**

**Decisions applied:** structured-keys-only duplicate detection (no
semantic claims); read=shared/write=exclusive claims with segment-safe
parent/child conflicts; staleness → checkpoint (explicit revalidation),
structural handoff defects → denied; live completion policies never
silently accept simulated evidence; budget basis = max(actual, estimated)
per dimension, no rounding bypass; the 15 repair conditions share one
canonical name list (FIFTEEN_CONDITIONS) across evaluator and contract;
recovery can at most compile the single revision — no provider
reassignment exists anywhere.

**Dependencies:** none added (hashing = djb2 test fingerprint, explicitly
NOT a security signature).

**Tests run (exact):**
- `npx vitest run src/relay` — **201/201 passed** (18 files: 90 new
  Prompt-3 tests + 111 prior).
- `npx vitest run` (full repository) — **1790/1790 passed** (138 files).
- `npm run typecheck` — clean. `npm run build` + `npm run backend:build` —
  green.
**Failures + repairs (one focused fix each, then green):** (1)
checkAgentHandoffPackage hardcoded the pre-Prompt-3 role list → switched to
the ROLES enum; (2) eligibility cascades — assignment-matches and
handoff-valid double-reported missing-owner/staleness, and the strict
budget schema rejected the new warningAtFraction field → checks scoped +
schema extended.

**Security:** no provider/paid calls, no credential access, no shell/Git
execution, no repository file edited by any agent, no deployment, no push.

**Known limitations:** enforcement of file claims remains advisory until
the worktree manager; DuplicateWorkDecision's retry policy is a caller
flag pending the orchestrator; high-risk CompletionPolicy execution still
deferred (contracts validate).

**Exact next step:** *Prompt 4 — Deterministic Simulation Harness and Full
Relay Vertical Slice* (scope pinned in CURRENT_STATE.md §Next prompt).

---

## 2026-07-22 — Prompt 4: Simulation Harness and Orchestrated Vertical Slice

**Timestamp:** 2026-07-22 ~04:20 → 05:20 UTC.

**Objective:** first executable end-to-end Relay workflow on deterministic
simulation adapters behind the provider-neutral connector ports, driven by
a real orchestrator over the accepted machine/ledger/coordination/handoff/
verification/recovery systems. No CLI/UI, no real adapters, no persistence,
no shell/Git, no paid calls.

**Preflight:** clean tree at 274a474; Prompt 3 complete per CURRENT_STATE;
relay 201/201 verified live; no doc/code discrepancies.

**Files created:** `src/relay/connectors/` — ports.ts, simulated.ts,
index.ts, simulated.test.ts · `src/relay/core/orchestrator.ts` ·
`src/relay/relay-vertical-slice.test.ts`.
**Files modified:** run-machine.ts (+`raise-checkpoint` intent),
storage interfaces + memory (+commands/audits stores), contracts.ts
(FinalAuditReport optional audit-detail fields incl. simulationNotice),
eligibility.ts (+`lastCanonicalLedgerVersion` — see decision below),
core/index.ts, connectors/index.ts, PROTOCOL.md, TEST_STRATEGY.md,
CURRENT_STATE.md, SESSION_LOG.md. **Prototype untouched.**

**Key decisions:** (1) Handoff ledger staleness is judged against the last
CANONICAL-affecting event — a package's own `handoff.created` bookkeeping
event can never invalidate it, while canonical decisions/promotions still
do (the strict rule made every compiled package instantly stale). (2) The
machine's `record-verification` emits the authoritative
`verification.completed`; the orchestrator drops the adapter's duplicate of
that concept. (3) `runUntilStopped` treats max-steps exhaustion as an
honest stop (`max-steps-reached`), not an internal error. (4) Reviewer
"insufficient evidence" maps to `changes_requested` + `insufficient-evidence`
finding — the protocol verdict enum is unchanged. (5) Scenario auto-accept
of blueprints is a recorded system command (actor `scenario-auto-approve`),
provenance-honest.

**Dependencies:** none added.

**Tests run (exact):**
- `npx vitest run src/relay` — **221/221 passed** (22 files: 20 new
  Prompt-4 tests + 201 prior; Prompt 2+3 regressions all green).
- `npx vitest run` (full repository) — **1810/1810 passed** (140 files).
- `npm run typecheck` — clean. `npm run build` + `npm run backend:build` —
  green.
**Failures + repairs (one focused fix per root cause, then green):**
(1) instant package staleness → canonical-aware ledger-current rule;
(2) duplicate `verification.completed` emission → orchestrator drops the
adapter copy; (3) budget hard-stop missing its `budget.exceeded` event in
the handoff phase → budget gate added before eligibility; (4) max-steps
error semantics → honest stop reason (+ stale-revision test stops at step 4).

**Security:** no provider/paid calls, no credentials/secrets, no shell/Git
execution, no real repository file modified by any agent, no deployment,
no push. Simulation is impossible to mistake for live: provenance
`simulated` end-to-end, audit `simulationNotice` mandatory when not live,
live-only completion policies reject simulated evidence (tested).

**Known limitations:** in-memory stores are volatile (durable persistence
is a later phase — no crash-recovery claim made); blueprint auto-accept is
scenario-only (interactive acceptance arrives with the CLI); reviewer
adapter maps extended verdict vocabulary onto the two protocol verdicts.

**Exact next step:** *Prompt 5 — Relay CLI (terminal client of Relay
Core)* per CURRENT_STATE §Next prompt — the July 24 demo surface.

---

## 2026-07-22 — Prompt 5: Terminal CLI Client (July 24 demo surface)

**Timestamp:** 2026-07-22 ~06:40 → 07:30 UTC.

**Objective:** first user-facing terminal client on Relay Core + the
simulation harness — thin client, serializable boundary, truthful
simulation/volatile labeling, July 24 demo commands.

**Preflight:** clean at 802cfb5; Prompt 4 verified live (scenarios 20/20);
no read models existed → added at the core boundary, never in the CLI.

**Files created:** `src/relay/core/read-models.ts`, `src/relay/core/app.ts`
(composition root + scenario registry), `src/relay/cli/` — main.ts,
interactive.ts, render.ts, exit-codes.ts, index.ts, cli.test.ts,
`docs/relay/CLI.md`. **Files modified:** core/index.ts,
relay-core-boundary.test.ts (CLI thin-client rules + composition-root
exemption + import-precise prototype scan), package.json (additive
scripts: relay:build / relay / relay:test), PROTOCOL/TEST_STRATEGY sync
notes pending in doc? (No — CLI is a client; protocol unchanged),
CURRENT_STATE.md, SESSION_LOG.md. **Prototype + protocol contracts
untouched.**

**Key decisions:** read models + facade live in core (Decision 9 — clients
render only serializable data); `core/app.ts` is the ONE approved
composition root (boundary test names it); interactive blueprint approval
issues the canonical accept-blueprint command (auto-accept = recorded
system actor, demo only); demo choreography for cancel/pause-resume/stale
acts MID-run (a post-completion cancel would be a dishonest demo); exit
codes never use 0 for incomplete work; facade type renamed conflict-free
(RelayApp interface ≠ prototype component — boundary scan made
import-precise).

**Dependencies:** none added (node:util.parseArgs + node:readline;
no CLI/color/spinner libraries).

**Verification (exact):** relay suite **234/234** (24 files; 13 new CLI
tests); full repository **1823/1823** (141 files); typecheck clean;
frontend + backend + relay bundles green. Bundled CLI manually verified:
help/version; `demo repair` → completed exit 0 with 1/1 repairs and
simulation notice; checkpoint/duplicate/failure → 5; budget-stop → 7;
cancel → 6; stale → 5; pause-resume → 0 with real mid-run pause; `--json`
parses clean (no ANSI, no secret shapes); doctor truthful, exit 0; unknown
scenario → exit 2.
**Failures + repairs (one per root cause):** cancel/pause-resume/stale
demos originally completed before choreography → mid-run stepping; CLI
boundary walk flagged its own test file + the composition root + a name
collision with the prototype component → walk scoped to production files,
app.ts exemption named, prototype scan made import-precise; parseArgs
`--max-cost -1` ambiguity → `=` syntax in test.

**Security:** no provider/paid calls, no credentials/secrets (doctor
prints names only — verified by test), no shell/Git by Relay, no real
repository modification, no deployment, no push.

**Known limitations:** volatile storage (no cross-process resume — CLI
says so); interactive mode uses process readline (tested via the pure
handler); blueprint rejection maps to canonical run cancellation.

**Exact next step:** *Prompt 6 — Durable Local Persistence and Real
Cross-Process Resume* per CURRENT_STATE §Next prompt.

---

## 2026-07-22 — Prompt 6: YC Demo Hardening and Presentation Preset

**Timestamp:** 2026-07-22 ~08:20 → 09:10 UTC.

**Objective:** presentation-grade July 24 demonstration on the existing
CLI/orchestrator — no architecture expansion, no persistence, no live
adapters.

**Preflight:** clean at 6ef0dd8; repair/checkpoint/duplicate demos +
doctor verified live; CLI tests 12/12.

**Files created:** `src/relay/cli/presentation.ts` (renderer-only
milestone frames), `src/relay/cli/yc.test.ts`,
`scripts/relay-yc-verify.mjs`, `docs/relay/YC_DEMO_RUNBOOK.md`,
`docs/relay/YC_VIDEO_SCRIPT.md`.
**Files modified:** connectors/simulated.ts (+reviewerFinding fixture
seam), core/app.ts (+yc scenario, YC 13-check policy, definition
presentation fields), cli/main.ts (+--presentation/--pace/--compact,
async runCli with renderer-only sleep between frames, DemoOutcome.app),
package.json (+relay:yc, relay:yc:verify), CLI.md, TEST_STRATEGY.md,
CURRENT_STATE.md, SESSION_LOG.md. **Core workflow, protocol, and exit
semantics untouched.**

**Verification (exact):** `npm run relay:yc:verify` **passed twice**
(≈34 checks/run: completed + exit 0, exactly one repair, same-session
resume, independent reviewer, promotions all evidence-backed, milestone
ordering, monotonic sequences, clean JSON, no secrets, no repo
modifications, stable semantics across runs). Bundled `demo yc --pace 0`
manually reviewed at 80/100/120 columns — no clipped critical lines, no
dumps, final screen persists. Relay suite **239/239** (17 CLI tests incl.
5 new YC tests); full repository **1828/1828**; typecheck + frontend +
backend + relay builds green. *(Counts recorded after the final run
below.)* Failures: 2 root causes — YC policy const declared after use
(moved), catch-branch missing new parse fields (added). One focused fix
each.

**Security:** no provider/paid calls, no credentials, no shell/Git through
Relay, no repository modification by the demo (verified programmatically),
no deployment, no push.

**Known limitations:** presentation evidence split assumes equal per-attempt
check counts (true by policy construction, asserted in tests); recovery
after terminal loss = deterministic rerun (volatile storage — documented,
never claimed otherwise).

**Exact next step:** record the YC video per YC_DEMO_RUNBOOK.md; then
*Post-YC: Durable Local Persistence and Real Cross-Process Resume*.

---

## 2026-07-22 — Prompt 6.1: Manual Task Checkpoint Experience

**Timestamp:** 2026-07-22 ~12:30 → 13:05 UTC.

**Objective:** the final bounded product addition before the July 24
recording — Manual Task as the extremely simple user-facing form of an
EXISTING Relay checkpoint that requires a human action. No persistence, no
live adapters, no CLI redesign, no second checkpoint engine, YC demo
semantically untouched.

**Preflight:** clean at fa57193; `relay:yc:verify` passed; `relay:yc`
exit 0; `demo checkpoint` reached CHECKPOINT REQUIRED; relay suite 239/239.

**Architecture:** ManualTask is a canonical payload on the existing
`Checkpoint` (`Checkpoint.manualTask?`) — the single checkpoint slot IS the
one-active-task-per-run enforcement. Flow: adapter returns untrusted
`manualActionRequest: unknown` on its result port → protocol shape gate
(`checkManualActionRequest`) → core semantic validation + compilation
(`src/relay/core/manual-task.ts`, the ONLY compiler) → `raise-checkpoint`
intent carries the task → `respond-manual-task {done|help|cannot}` command
(cancel = canonical `cancel-run`) → Done recorded as a claim →
`record-manual-verification` intent applies Relay's configured verification
(passed → completed + core-approved resume; failed → needs_more_information,
stopped; unavailable → honest disclosure + operator `/approve`).

**Files created:** `src/relay/core/manual-task.ts`,
`src/relay/core/manual-task.test.ts`, `src/relay/relay-manual-task.test.ts`,
`src/relay/cli/manual.test.ts`, `scripts/relay-manual-verify.mjs`.
**Files modified:** protocol `ids/enums/contracts/envelopes` (mtk_/mrq_
prefixes; category/status enums; ManualActionRequest + ManualTask contracts;
`respond-manual-task` command; `manual.*` event family; audit
`manualTasks[]`), `core/run-machine.ts` (manual-task transitions incl.
cancel/approve closure), `core/orchestrator.ts` (request interception,
Done→verification, audit summary, `manualVerificationOutcomes` seam),
`core/read-models.ts` (+manualTaskView), `core/app.ts` (+`manual` scenario,
respondManualTask/manualTask facade, test-only overrides seam),
`connectors/ports.ts` + `connectors/simulated.ts` (untrusted request seam),
`cli/render.ts` (+renderManualTask/Help), `cli/interactive.ts` (/manual
/done /manual-help /cannot-complete + prompt-scoped D/H/N/C + auto
display), `cli/main.ts` (manual choreography, JSON `manualTask`),
`package.json` (+relay:manual, relay:manual:verify), protocol.test.ts +
relay-core-boundary.test.ts (additive), docs (PROTOCOL sync, CLI.md,
UI_VISION §11, YC_VIDEO_SCRIPT supporting beat, CURRENT_STATE, this log).

**Dependencies:** none added.

**Verification (exact):** `npm run relay:manual:verify` passed (double-run
semantic acceptance: completed + exit 0, task completed + verification
passed, checkpoint association, 3–6 short steps, milestone ordering, no
agent dispatch while stopped, monotonic sequences, clean JSON, no secrets,
no repo modifications, stable semantics). `npm run relay:yc:verify`
**passed twice after the change** (semantic outcome unchanged). Relay suite
**279/279** (27 files; 40 new: 19 domain/machine, 8 lifecycle/ledger/audit,
10 CLI, 3 additive boundary); full repository **1868/1868** (145 files);
typecheck + frontend/backend build (`tsc -b && vite build`) + relay bundle
green. Failures + repairs (one per root cause): full-output 80-column
assertion caught pre-existing >80 event-feed lines → scoped to the Manual
Task block (the spec's surface); two strict-build test-type errors (unused
import, string vs event-kind union) → removed/widened.

**Security:** manual requests treated as untrusted input end to end;
rejected requests never rendered and their content never persisted;
secret-shape/stack-trace/internal-id rejection tested; no secret values in
CLI output, JSON, ledger, or audit (asserted); no provider/paid calls, no
credentials, no shell/Git through Relay, no repository modification by
demos (verified programmatically), no deployment, no push.

**Known limitations:** volatile storage (manual tasks do not survive the
process — CLI says so); `verifying` is never a resting status (verification
applies synchronously); one Manual Task per run by design (count badge
reserved in UI_VISION §11); operator `/approve` on a pending task closes it
as `cancelled` — never fakes completion.

**Exact next step:** record the YC video per YC_DEMO_RUNBOOK.md (main demo
`npm run relay:yc`; supporting `npm run relay:manual`); then *Post-YC:
Durable Local Persistence and Real Cross-Process Resume*.

---

## 2026-07-22 — Prompt 7: Isolated Worktree Manager and Safe Local Execution Foundation

**Timestamp:** 2026-07-22 ~14:20 → 15:30 UTC.

**Objective:** build the security boundary required before Relay may
control a real Claude Code session — real isolated Git worktrees, protected
paths, file-claim enforcement, safe bounded command execution, evidence,
and conservative cleanup. Deadline-critical: the YC video records July 23
night; commit 94ccb59 is the known-good recording fallback, and the YC and
Manual Task demonstrations must retain their semantic outcomes. No Claude
Code adapter this prompt; no provider calls.

**Preflight:** clean at 94ccb59; `relay:yc:verify` and
`relay:manual:verify` passed; relay suite 279/279; git 2.39.5 (worktrees
supported), node v22.23.1.

**Architecture:** new `src/relay/workspace/` boundary behind
provider-neutral ports (`WorkspaceManagerPort`, `WorkspaceInspectionPort`,
`CommandExecutionPort`; combined `WorkspaceService`, composed only by
`createLocalWorkspaceService`). Pure policy modules (contracts,
protected-paths, command-policy, output-sanitizer, cleanup) carry zero Node
imports; Node access (repository-inspector, worktree-manager,
command-runner, doctor, verify-harness, index) is confined to the module
(boundary-tested: no `child_process` anywhere else in `src/relay`; Core,
connectors, and the browser prototype never import workspace; the CLI uses
the composition root only). Workspace evidence/events are
`provenance: live` — live LOCAL enforcement, explicitly distinguished from
simulated agents and from still-unavailable live providers.
`WORKSPACE_PROFILES` (`none|simulated|local_isolated`) added to protocol
enums; every existing scenario stays `simulated`.

**Files created:** `src/relay/workspace/{contracts,protected-paths,
command-policy,output-sanitizer,repository-inspector,worktree-manager,
command-runner,workspace-evidence,cleanup,doctor,verify-harness,index}.ts`,
`src/relay/workspace/{policy,workspace}.test.ts`,
`docs/relay/WORKSPACE_SECURITY.md`.
**Files modified:** protocol `enums.ts` (+WORKSPACE_PROFILES) +
`envelopes.ts` (+`workspace.*` event family, EventRefs.workspaceId) +
`protocol.test.ts` (family check), `core/app.ts` (+workspaceProfile
label), `cli/main.ts` (+`workspace doctor|verify` commands, help, doctor
line, JSON workspaceProfile), `cli/cli.test.ts` (parse coverage),
`relay-core-boundary.test.ts` (+workspace boundary suite, CLI allowlist),
`package.json` (+relay:workspace:verify), docs (PROTOCOL / ARCHITECTURE /
SECURITY_BOUNDARIES / TEST_STRATEGY sync blockquotes, CLI.md,
CURRENT_STATE.md, this log).

**Dependencies:** none added (node:child_process/fs/os/path only).

**Verification (exact):** `npm run relay:workspace:verify` **passed twice**
(30 checks/run: pinned isolated worktree, idempotent reuse, source
byte-identical end-to-end, approved command, push rejected, claimed change
allowed, protected change stops execution, timeout/cancel confirmed
terminations, output limit, secret sanitization, conservative cleanup +
refusals, protocol-valid events, live-local evidence, no secret shapes,
fixture removed). `relay:yc:verify` **passed twice** and
`relay:manual:verify` **passed twice** after the change. Relay suite
**314/314** (29 files; 35 new workspace tests + boundary/CLI additions);
full repository **1903/1903** (147 files); typecheck + frontend + backend +
relay builds green. `relay workspace doctor` truthful (agents unavailable,
adapters DEFERRED, push prohibited), exit 0. Failures + repairs (one per
root cause): `git rev-parse --git-common-dir` returns absolute paths in
worktrees (joined unconditionally → ENOENT) → isAbsolute branch; dangling
symlink escapes missed because `existsSync` follows links → lstat-based
detection with deleted-file exemption; git "Preparing worktree" stderr
leaked to the terminal (execFileSync default) → explicit piped stdio.

**Security:** no provider/paid calls; no credentials read (secret-named env
keys stripped before inheritance — tested); no shell execution anywhere
(`shell: false` + metacharacter rejection); push/reset/clean/merge/publish
denied by policy and tested; source repositories inspect-only (worktree
bookkeeping under `.git` disclosed in WORKSPACE_SECURITY.md §4); all
fixture repositories confined to tmpdir and removed; no deployment; no
push; the real Sunday repository was never used as a workspace source.

**Known limitations:** volatile workspace registry (durable persistence is
a later phase; on-disk worktrees survive and are manually inspectable);
run branches retained after worktree removal; no cancellation during the
bounded synchronous worktree creation; claim enforcement is detective
(inspect + stop), not OS-level sandboxing — reported truthfully.

**Exact next step:** record the YC video (July 23 night — simulated demos,
fallback 94ccb59); then *Real Claude Code Local Adapter* inside the
Prompt-7 workspace boundary, per CURRENT_STATE §Next prompt.

---

## 2026-07-22 — Prompt 7 (final): workspace foundation re-implemented and landed

**Timestamp:** 2026-07-22 ~15:45 → 17:15 UTC.

**Supersession note (append-only honesty):** the previous entry describes
the Prompt-7 implementation committed as 3946727. That implementation was
intentionally removed from the working tree before this session continued;
this entry describes the REPLACEMENT implementation that supersedes it in
the follow-up commit. The prior code remains reachable in git history at
3946727 only. Naming/scope deltas against the prior entry: the composition
root is `createWorkspaceService` (not `createLocalWorkspaceService`);
workspace profiles live in `workspace/contracts.ts` (module-local, not
protocol enums); `core/app.ts` and `cli/cli.test.ts` are untouched this
time; the verification harness runs 23 checks; the output-limit policy
terminates the process on stream overflow.

**Architecture (as landed):** `src/relay/workspace/` behind
`WorkspaceManagerPort` / `WorkspaceInspectionPort` / `CommandExecutionPort`
(combined `WorkspaceService`, composed only by `createWorkspaceService`).
Pure browser-safe modules: contracts, protected-paths (segment-safe,
claim-never-expands, protection-beats-claims), command-policy (allowlist
with absolute denylist, env allowlist ∩ secret-name denylist),
output-sanitizer (byte bounding + secret-shape redaction), cleanup
(authorization-always-required decisions). Node zone: repository-inspector
(fixed-executable git, porcelain-z parsing, repo-root validation),
worktree-manager (root/branch validation, create/verify/remove, no force),
command-runner (`spawn shell:false`, SIGTERM→SIGKILL, honest
termination_unconfirmed), workspace-evidence (live provenance, verifier
`relay-workspace`, no absolute paths), doctor, verify-harness, index.

**Files created:** `src/relay/workspace/{contracts,protected-paths,
command-policy,output-sanitizer,repository-inspector,worktree-manager,
command-runner,workspace-evidence,cleanup,doctor,verify-harness,index}.ts`,
`src/relay/workspace/{policy,workspace}.test.ts`,
`docs/relay/WORKSPACE_SECURITY.md` (rewritten for this implementation).
**Files modified:** protocol `envelopes.ts` (+`workspace.*` event family,
`EventRefs.workspaceId`) + `protocol.test.ts` (family check),
`cli/main.ts` (+`workspace doctor|verify`, help),
`relay-core-boundary.test.ts` (+Workspace boundary suite; CLI allowlist
gains the workspace facade only; CLI child_process ban),
`package.json` (+`relay:workspace:verify`), docs (PROTOCOL / ARCHITECTURE /
SECURITY_BOUNDARIES / TEST_STRATEGY sync blockquotes, CLI.md,
CURRENT_STATE.md, this log).

**Dependencies:** none added (node:child_process/fs/os/path only).

**Verification (exact):** `npm run relay:workspace:verify` **passed twice**
(23 checks/run: baseline fixture repo → pinned isolated worktree outside
the source → idempotent reuse → source unchanged → approved command exit 0
→ git push and bash rejected → claimed change allowed → protected change
flagged + workspace checkpoint → timeout with termination_confirmed →
cancellation honored → flagged workspace preserved despite authorized
cleanup → clean workspace removed when authorized → double-cleanup refused
→ source pristine at pinned revision → live secret-free evidence → fixture
fully removed). `relay:yc:verify` **passed twice** and
`relay:manual:verify` **passed twice** after the change (scenario configs
and adapters untouched). Relay suite **316/316** (29 files; 32 new
workspace tests + boundary additions); typecheck + frontend + backend +
relay builds green; `relay workspace doctor` truthful, exit 0. Full-suite
count recorded in the commit gate below. Failures + repairs (one per root
cause): arrow-function `=>` in the harness's `node -e` fixtures tripped the
metacharacter rejection (fixtures rewritten without metacharacters — the
policy was right); branch validator accepted `a/./b` (segment rule
tightened); boundary regex flagged the simulated adapters' truthful
`worktree-isolation` enforcement LABEL (regex narrowed to real
spawn/import patterns).

**Security:** no provider/paid calls; no credentials read; secret-named
env keys stripped at approval AND at child-env construction (tested); no
shell execution anywhere; push/reset/clean/checkout/merge/worktree/config/
-c/--force/publish denied by policy and tested; source repositories
inspect-only; fixtures confined to tmpdir and removed; no deployment; no
push; the Sunday repository was never used as a workspace source.

**Known limitations:** volatile workspace registry (orphaned worktrees
after a crash need manual `git worktree remove`); run branches preserved
after removal; no cancellation during synchronous worktree creation;
grandchildren detaching from the process group may outlive termination —
reported as `termination_unconfirmed`, never claimed dead; claim
enforcement is detective (inspect + stop), not OS sandboxing.

**Exact next step:** record the YC video (July 23 night — simulated demos,
fallback 94ccb59); then *Real Claude Code Local Adapter* executing inside
this workspace boundary, per CURRENT_STATE §Next prompt.

---

## 2026-07-23 — Prompt 8: Real Claude Code Local Adapter and Live Isolated Coding Proof

**Timestamp:** 2026-07-23 (Gate A offline build/verify → Gate B live smoke).

**Objective:** connect ONE real local Claude Code coding agent to the
Prompt-7 isolated-worktree boundary behind the existing provider-neutral
`CodingAgentAdapter` port — no Codex, no durable persistence, no history
rewrite, the simulated demos preserved.

**Preflight:** clean at 2044fbb; `relay:workspace:verify`, `relay:yc:verify`,
`relay:manual:verify` all passed; relay suite 316/316. Installed Claude
probed read-only: `/home/kaisinrogodfree5/.local/bin/claude` → v2.1.217;
`-p`/`--output-format stream-json`/`-r`/`--session-id`/`--permission-mode`/
`--tools`/`--allowedTools`/`--disallowedTools`/`--json-schema`/`--safe-mode`/
`--strict-mcp-config` present; NO `--max-turns`. `claude auth status`:
first-party `claude.ai` OAuth, subscription `max` = approved
`claude_local_subscription`; no provider API-key env vars; Sunday repo has
CLAUDE.md but no `.claude/settings*`/`.mcp.json`/hooks. No material
incompatibility (turn-capping unavailable → bounded by runtime/output/calls).

**Architecture (as landed):** `src/relay/connectors/claude-code/` implements
the port; Relay Core never imports it (boundary-tested). Only the workspace
module and this adapter's process runner use `child_process`. Claude runs
ONLY inside a ready isolated worktree (cwd), `shell:false`, credential-
stripped env (ANTHROPIC_API_KEY/AUTH_TOKEN/base-URL/Bedrock/Vertex removed),
tool-restricted (Read/Glob/Grep/Edit; Bash/network/MCP forbidden),
`--safe-mode`+`--strict-mcp-config` isolation, bounded runtime (6m)/output
(1MiB/256KiB), SIGTERM→SIGKILL with honest termination, cancellation,
hidden-reasoning dropped+counted, no `--dangerously-skip-permissions`. The
Agent Execution Report (`RELAY_AGENT_EXECUTION_REPORT_V1` marker) is an
unverified claim; Relay independently inspects the worktree and runs
`node --test` via the Prompt-7 runner (live evidence), then a low-risk
CompletionPolicy (accepted provenance live, no reviewer). Session UUID
captured + stored with association only (never tokens); explicit exact-id
resume; wrong-id and second-repair rejected. The sync port `execute` refuses
live launch so no test/build/sim run ever calls Claude.

**Files created:** `src/relay/connectors/claude-code/{contracts,
capability-probe,config,environment,permission-compiler,prompt-compiler,
process-runner,stream-parser,event-normalizer,report-parser,session-manager,
adapter,live-runner,doctor,fixture,fake-executable,contract-verify,index,
claude-code.test}.ts`, `docs/relay/CLAUDE_CODE_ADAPTER.md`,
`docs/relay/LIVE_CLAUDE_DEMO.md`.
**Files modified:** protocol `envelopes.ts` (+11 `agent.*` live event kinds)
+ `protocol.test.ts` (family check), `cli/main.ts` (+`claude
doctor|run|inspect|cancel|contract-verify`, approval screen, manual-task
stop), `relay-core-boundary.test.ts` (+Claude adapter suite; CLI facade
allowance; workspace "only these spawn" now includes the Claude runner;
simulation-adapter connector checks scoped away from claude-code),
`package.json` (+relay:claude:contract-verify, relay:claude:live), docs
(ARCHITECTURE/PROTOCOL/SECURITY_BOUNDARIES/TEST_STRATEGY sync, CLI.md,
YC_DEMO_RUNBOOK §9, CURRENT_STATE, this log).

**Dependencies:** none added (no Claude Agent SDK — the installed CLI covers
every required capability; node:child_process/fs/os/path only).

**Gate A (offline, no provider call):** `relay claude doctor` truthful
(exe found, v2.1.217, auth ready local-subscription max, API-key env no,
Codex/Hermes/durable unavailable). `npm run relay:claude:contract-verify`
**30/30 PASS twice** — full pipeline against the deterministic fake Claude
(end-to-end fixture proof with real edits → inspection → Relay verification →
live audit; plus malformed line, missing init/session, wrong-task,
max-turns, execution error, timeout, cancellation, output overflow, hidden-
reasoning omission, session capture/duplicate/resume/wrong-id/second-repair).
Relay suite **342/342**; boundary suite green; workspace/yc/manual verify
**twice each**; typecheck + frontend/backend/relay builds green; full suite
**1931/1931**. The no-`--confirm-live` path shows the approval screen and
makes NO live call (verified).

**Gate B (explicit live smoke — user-run, separate terminal):**
`npm run relay:claude:live` → LIVE CLAUDE CODE RUN screen (confirmed via
`--confirm-live`) → real Claude session started → execution report received
(claim, not proof) → RELAY INSPECTION: 1 claimed file changed
(`src/normalize.js`), 0 protected files changed, source worktree unchanged →
RELAY VERIFICATION [PASS] Tests / File-claim / Protected-path / Source-
worktree protection → FINAL AUDIT "Live Claude Code execution verified;
Independent reviewer: not required by the selected low-risk CompletionPolicy"
→ RELAY COMPLETE. First attempt; no repair; one live Claude call consumed.
Post-Gate-B non-provider regressions re-run green (typecheck, relay 342,
four verifiers, build, full suite 1931); the working repo was untouched by
the separate live run and no fixture/workspace residue remained.

**Security:** live subscription auth via Claude's own OAuth (never read,
stored, or printed); API-key/third-party env stripped from the child;
`shell:false` throughout; no Bash/network/MCP/deploy/push/commit tools; no
`--dangerously-skip-permissions`; hidden reasoning never surfaced; the agent
report gated by Relay's independent inspection + Relay-run verification; no
deployment, no push, no source-repository modification; the real Sunday repo
never used as a live source; temp fixtures under tmpdir, cleaned.

**Known limitations:** no `--max-turns` on this CLI (bounded by
runtime/output/2-call ceiling); volatile sessions + workspace registry (no
durable cross-process resume); edit path-scoping advisory (inspection is the
enforced gate); nested Claude-in-Claude not assumed safe (live smoke run in
a separate terminal); Codex reviewer, Hermes, durable persistence, and the
live Architect adapter remain unimplemented by design.

**Exact next step:** *Real Codex Independent Reviewer Adapter* behind the
reviewer port, per CURRENT_STATE §Next prompt.

---

## 2026-07-23 — Prompt 8.1: YC Competitive Proof Layer

**Timestamp:** 2026-07-23 (from commit 749e0ca).

**Objective:** add the minimum missing competitive structures + presentation
so the YC demo visibly proves Relay is provider-neutral mission control above
the agents — Mission Contract, requested-vs-actual Execution Attestation,
Finding/Repair ledger, deterministic mission verdicts, mission timeline, a
competitive golden path, and the 19-feature coverage matrix. No second
workflow engine; no live provider call.

**Preflight:** clean at 749e0ca; `relay:claude:contract-verify` 30/30,
`relay:workspace:verify`, `relay:yc:verify`, `relay:manual:verify` all exit
0; relay suite 342/342.

**Mapping (no duplication):** every requested structure is a PROJECTION over
existing canonical state — Mission Contract ← project/blueprint/task/
CompletionPolicy/budget/loop; Attestation ← handoff/assignment/audit
identities + session/evidence + adapter provenance; Review/Finding/Repair ←
ReviewerVerdict + ReviewFinding + RevisionContract + evidence; Verdict ←
evaluateCompletionPolicy + reviews + attestations + findings; Timeline ← the
append-only event ledger. The competitive scenario reuses the Prompt-4
orchestrator's real verify→review→changes_requested→repair→re-verify→
approve→audit flow.

**Architecture (as landed):** new PURE, browser-safe leaf module
`src/relay/mission/{contracts,mission,attestation,review-repair,verdict,
timeline,read-models,index}.ts` — imports protocol types only; never Relay
Core internals, adapters, CLI, Node, or child_process (boundary-tested). A
pure deterministic digest (no node:crypto) keeps the whole module reusable by
a future graphical Mission Control. Relay Core stays the source of truth; the
CLI renders read models only.

**Files created:** `src/relay/mission/*` (8 modules + `mission.test.ts`),
`src/relay/cli/competitive.ts` + `competitive.test.ts`,
`docs/relay/{MISSION_CONTRACT,EXECUTION_ATTESTATION,REVIEW_REPAIR_LEDGER,
COMPETITIVE_FEATURE_COVERAGE}.md`.
**Files modified:** `core/app.ts` (+`competitive` scenario + 6-check policy;
the anonymous rate-limit proof fails on attempt 1 due to the IPv6 bypass, so
the orchestrator can compile the revision — matching the YC-proven flow),
`cli/main.ts` (+competitive presentation/JSON, help), `cli/interactive.ts`
(+`/mission /attestation /findings /repairs /verdict /timeline`),
`relay-core-boundary.test.ts` (+Mission projection suite; CLI allowlist +
`./competitive` + `../mission`), `package.json` (+`relay:competitive`), docs
(RELAY_MVP_SPEC/ARCHITECTURE/PROTOCOL/SECURITY_BOUNDARIES/TEST_STRATEGY sync,
CLI.md, YC_DEMO_RUNBOOK §10, CURRENT_STATE, this log).

**Dependencies:** none added.

**Verification (exact):** `npm run relay:competitive` reaches MISSION
VERDICT: VERIFIED COMPLETE, exit 0 (F-1 resolved, R-1 resolved, both agents
attested, no fallback, timeline finding_created/repair_created/
finding_resolved exactly once, 80-column, no ANSI, clean JSON, stable across
runs). Mission tests 24, competitive CLI tests 8. `relay:yc:verify`,
`relay:manual:verify`, `relay:workspace:verify` passed **twice each**;
`relay:claude:contract-verify` 30/30. Relay suite **379/379** (32 files);
full suite **1968/1968** (150 files); typecheck + frontend + backend + relay
builds green. **NO provider call anywhere.** Failures + repairs (one per root
cause): the review-driven repair needed failed verification evidence to
compile the RevisionContract (added `failingCheckAttempt1` on the IPv6
rate-limit proof — coherent narrative, matches YC); a test helper misused
RelayReview where ReviewInput was required (fixed the fixtures); the timeline
spliced finding_resolved 3× because the reviewer emits duplicate
verdict events (guarded on flags, splice once at completion).

**Security:** no provider/paid calls; no deployment; no push; no Supabase/
Railway/Vercel changes; no production auth/rate-limit/spend-breaker changes
(the competitive mission is deterministic scenario DATA, not real code); no
secrets/tokens/streams/hidden reasoning in any read model or attestation
(asserted); no unbounded review loop (iteration limit enforced); no claim
treated as proof (verdict engine); the Sunday repo was never used as a live
source.

**Known limitations:** volatile (no durable mission/attestation/verdict
store); the competitive mission uses a fixed spec (operator authoring is
post-YC); the Codex reviewer is a deterministic simulation (external Codex
not active); features 7/8/11/15/16/18 are partially implemented and 13/14/19
deferred per COMPETITIVE_FEATURE_COVERAGE.md.

**Exact next step:** *Real Codex Independent Reviewer Adapter* behind the
reviewer port, per CURRENT_STATE §Next prompt.

---

## 2026-07-22 — Prompt 8.2: Mission Control, Operational Modes, Relay Dog, Live Terminal, and Pro/Max Reviewer Gate

**Prompt objective:** the final major product-facing implementation phase
before the July 24 YC demonstration — a graphical Mission Control surface plus
four Relay-Core-owned systems (operational modes, secure access, the Relay Dog
activity engine, the live terminal, and the reviewer entitlement + release
gate), built as PURE, browser-safe projections/policies with no second engine
and no client-side workflow logic.

**Built (all in `src/relay/mission/` unless noted):**
- `modes.ts` — guided/semi/autonomous canonical policies; `selectMode`
  (autonomous escalation requires an immutable consent event; reduction
  immediate); `buildAutonomousConsent`/`validateAutonomousAccess` (rejects
  `'*'`/`'all'`); `AUTONOMOUS_STOP_ACTIONS` (17) / `SEMI_STOP_ACTIONS` /
  `actionRequiresStop`.
- `credential-handle.ts` — `CredentialHandle` that never holds a value;
  secret-shaped key/value rejection; `revokeHandle`; `evaluateHandleAccess`
  (→ `requires_manual_task` for MFA/presence); `accessSummary` (names/scopes).
- `dog.ts` — 16 deterministic states; `computeDogActivity` (terminal/boundary
  → phase → speed; `sprinting` needs architectAndCoding && level≥70 &&
  sync≥60; meaningful-event filter excludes ledger/file_claim/usage/
  phase_changed); `renderDogFrames`/`DOG_FRAME`; reduced motion.
- `entitlement.ts` — entitlement policy; `computeOutputVisibility` state
  machine (working→held_for_verification→held_for_review→revision_required→
  approved_for_release→released; blocked); `reviewerIsIndependent` (structural);
  `assignReviewer`; `buildReviewerPackage` (excludes transcript/secrets).
- `terminal.ts` — `redactTerminalText`, `projectTerminalEvent` ("Private
  reasoning omitted."), `createInProcessTerminalStream` (loadSince dedup/
  ordering/gap detection + connect/reconnect/disconnect), `buildAgentExchanges`.
- UI: `ui/{data.ts,MissionControl.tsx,LiveTerminal.tsx,RelayDog.tsx,
  mission-control.css}` — compact, progressive-disclosure, Relay identity,
  desktop + mobile, accessible + reduced-motion; projects Relay Core, submits
  commands only. `main.tsx` renders `<MissionControl />`.
- CLI: `cli/mission-control.ts` (`buildMissionControlFrames`), `demo
  mission-control` in `cli/main.ts`, `/mode /dog /terminal /reviewer /access`
  in `cli/interactive.ts`; `package.json` `relay:mission-control`.

**Tests:** `mission/mission-control.test.ts` (19), `cli/mission-control.test.ts`,
`ui/mission-control.test.tsx` (7, DOM-less SSR), plus a Mission Control boundary
suite in `relay-core-boundary.test.ts` (mission engines + `ui/` pure/
browser-safe; adapters can't drive dog/mode/entitlement/consent; the handle
holds no value; CLI allowlist gains `./mission-control`).

**Dependencies:** none added.

**Verification (exact):** `npm run relay:mission-control` renders modes/consent/
dog/reviewer-gate/exchanges/terminal/access at 80 columns, no ANSI, clean JSON,
exit 0, byte-identical across two runs, no secret-shaped output. `relay:yc:verify`,
`relay:manual:verify`, `relay:workspace:verify` passed **twice each**;
`relay:claude:contract-verify` 30/30; `relay:competitive` exit 0. Relay suite
**413/413** (35 files); full suite **2002/2002** (153 files); typecheck +
frontend + backend + relay builds green. **NO provider call anywhere.** Fixes
(≤5-iteration budget): two boundary assertions (CLI allowlist missing
`./mission-control`; credential-handle phrase match case-normalized) — both real
boundary-test corrections, not code weakenings.

**Security / truthfulness:** CredentialHandles never carry a value (no
raw-password storage; mode config rejects password values); not a full
encrypted vault (deferred); MFA stays a Manual Task. Relay Core owns mode +
consent + output visibility + dog + reviewer independence; adapters cannot
raise autonomy, grant credentials, control the dog, mark themselves
independent, release their own work, bypass review, fabricate events, or reveal
secrets (boundary-tested). The Live Terminal never shows hidden reasoning
(only "Private reasoning omitted."), system prompts, or secrets; production
WebSocket transport NOT implemented (in-process only). The Reviewer is a
deterministic SIMULATION (external Codex not active); no billing/Stripe; all
state volatile (no durable persistence). No provider/paid call, no deployment,
no push.

**Docs:** MODES.md, RELAY_DOG.md, LIVE_TERMINAL.md, REVIEWER_GATE.md,
MISSION_CONTROL.md (new) + sync blockquotes across RELAY_MVP_SPEC/ARCHITECTURE/
PROTOCOL/SECURITY_BOUNDARIES/UI_VISION/CLI/TEST_STRATEGY, YC_DEMO_RUNBOOK §11,
CURRENT_STATE, this log.

**Exact next step:** *Real Codex Independent Reviewer Adapter* behind the
reviewer port, per CURRENT_STATE §Next prompt — makes the reviewer gate's
approval come from a live independent agent with its own Execution Attestation.

---

## 2026-07-22 — Prompt 8.3: Real Codex Independent Reviewer Adapter and Live Review Attestation (Gate A)

**Prompt objective:** connect a REAL local Codex reviewer to the Prompt-8.2
Reviewer Gate — proving Relay can assign an implementer's work to a DIFFERENT
live provider as an independent, read-only, attested reviewer that never
approves its own work, never releases output, never modifies files, and never
silently falls back to a simulation.

**Probe (read-only, no model call):** codex-cli 0.144.4 on PATH. `codex exec`
supports `--json`, `--output-schema`, `--output-last-message`, `--sandbox
read-only`, `--cd`, `--ignore-user-config`, `--ignore-rules`, `--strict-config`,
`exec resume <uuid>`. The native `codex exec review` lacks `--json`/
`--output-schema`/`--sandbox`/`--cd`/`--output-last-message`, so
**exec_structured_review** was selected (structured output + session identity +
read-only sandbox preserved). `codex login status` → **not signed in**; no
explicit API-key env source present.

**Built (`src/relay/connectors/codex-reviewer/`):** contracts, capability-probe,
environment (provider-key stripping; `codex_local_login`), configuration
(isolation risk), reviewer-prompt-compiler (`RELAY_REVIEW_REPORT_V1` schema +
marker), permission-compiler (read-only; FORBIDDEN_FLAGS never emitted),
process-runner (`shell:false`, bounded, cancellation, reads
`--output-last-message`), stream-parser (reasoning dropped), event-normalizer
(`reviewer.*`), report-parser (strict id/revision + verdict/finding + secret/
hidden-reasoning rejection), session-manager (capture + exact-session
re-review), attestation, adapter (sync `review()` refuses live), live-runner
(Gate B orchestrator), doctor, fixture (seeded `&&`-vs-`||` dispatch defect),
fake-executable, verify-harness, index. New Relay-owned composite
`mission/reviewer-gate.ts` (`evaluateReviewerGate`) so the adapter never decides
the gate. Additive `reviewer.*`/`output.*` event kinds in `protocol/envelopes.ts`.
CLI: `codex doctor|contract-verify|run|inspect|cancel`, `--confirm-live` gated
(never inferred from TTY); `relay:codex:contract-verify` + `relay:codex:live`
scripts.

**Tests:** `connectors/codex-reviewer/codex-reviewer.test.ts` (unit) +
`verify-harness.ts` (offline contract proof, 53 checks) + a Prompt-8.3
`relay-core-boundary.test.ts` suite. Dependencies: none added.

**Verification (Gate A, exact):** `relay:codex:contract-verify` **53/53**
(offline, fake Codex, NO provider call) run twice; `codex doctor` truthful
(found, capabilities available, not signed in); `codex run --confirm-live` with
login not ready → "Sign in to Codex" Manual Task, exit 5, **no call**.
`relay:mission-control`, `relay:competitive`, `relay:claude:contract-verify` (30/30)
pass; `relay:workspace:verify`, `relay:yc:verify`, `relay:manual:verify` pass
**twice each**. Relay suite **442/442** (36 files); boundary tests green;
typecheck + frontend + backend + relay builds green; full suite green. One
in-budget fix: the `output_overflow` fake used `process.exit`/`fs.writeSync`
that discarded/EAGAIN-dropped buffered stdout — switched to async writes with a
keep-alive so Relay observes the overflow and terminates it.

**Security:** read-only Codex (`--sandbox read-only`, explicit `--cd`), config
isolation, no bypass/full-access/workspace-write flags, provider-key stripping,
`codex_local_login` (no credential read/store/print), API-key source → Manual
Task, before/after workspace gate (a reviewer file change fails the review), no
fallback, no deployment, no push, no provider call in automated verification.

**Gate B status: READY, blocked pending a local Codex login.** The founder runs
`npm run relay:codex:live` in a
separate terminal AFTER `codex login`. Expected: one live Codex call, session
captured, requested/actual reviewer Codex, independent, read-only, zero file
changes, source unchanged, verdict changes_required with a blocking finding
tied to AC-1, repair obligation created, output revision_required, RELAY STOPPED
SAFELY (exit 3), no fallback, no completion claim.

**Exact next step:** run Gate B after signing in to Codex; then Prompt 8.4
(Live Claude Repair and Codex Re-review Loop).

---

## 2026-07-22 — Prompt 8.3 (continued): Gate-B authentication-preflight repair

**Blocker:** the founder signed in (`codex login status` → `Logged in using
ChatGPT`), but `npm run relay:codex:live` stopped before launching Codex with
exit 5 and incorrectly raised the "Sign in to Codex" Manual Task. No live call
was made or consumed.

**Root cause (exact):** the Gate-A login probe (`tryExecStatus`) used
`execFileSync`, which on a **successful** exit returns **stdout only** — but
`codex login status` prints `Logged in using ChatGPT` on **stderr** with exit
0 (verified against codex-cli 0.145.0; the CLI self-updated from 0.144.4).
The probe therefore saw an empty string on the success path, matched no
logged-in phrase, and the old classifier hard-mapped that to `not_ready` →
`approvedForLiveReview: false` → "Sign in to Codex" Manual Task, exit 5.
Doctor, preflight, and live launch shared the same defective probe (one probe,
one bug — no divergence).

**Repair (one focused change, `capability-probe.ts` + `environment.ts`):** ONE
canonical probe used identically by `relay codex doctor`, the Gate-B
preflight, live-launch eligibility, and the Manual Task recheck —
`probeCodexLoginStatus` (`spawnSync`, `shell:false`, 15s timeout, **stdout AND
stderr captured**, sanitized: account/email + secret-shaped material redacted,
ANSI stripped) + pure `classifyCodexLoginOutput` (exit 0 REQUIRED for `ready`;
`logged in`/`signed in`/`authenticated` wording variations recognized;
explicit not-logged-in → `not_ready`; unknown exit-0 output → `unverified`;
non-zero exit NEVER `ready`). The probe child env is the same
`buildCodexEnvironment` filter used to launch the review (HOME, PATH, USER,
LOGNAME, LANG, TMPDIR, XDG_CONFIG/CACHE/DATA/STATE/RUNTIME paths + CODEX_HOME
preserved; provider keys/tokens/gateway URLs stripped; `XDG_STATE_HOME` added).
No credential file read; no authentication material printed.

**Tests:** 5 focused unit tests (stderr+exit-0 recognition via a real fake
executable, sanitization, wording variations, non-zero-exit never ready,
`classifyCodexAuth` end-to-end) + 4 offline contract checks (Gate-B login
preflight proven with fake login-status executables — no provider call).

**Verification (exact):** typecheck green; codex-reviewer tests 29/29;
`relay:codex:contract-verify` **58/58** (twice); `relay-core-boundary` 45/45;
relay suite **448/448** (36 files); full suite **2037/2037** (154 files);
frontend/backend build + relay build green; `relay codex doctor` → "Local
login: ready (local login)", exit 0. NO provider call, NO live launch.

**Gate B status: READY FOR GATE-B RETRY.** The founder runs, in a separate
terminal: `npm run relay:codex:live`

**Exact next step:** Gate B retry; after it passes, commit
`feat(relay): add real Codex independent reviewer`; then Prompt 8.4
(Live Claude Repair and Codex Re-review Loop).

---

## 2026-07-22 — Prompt 8.3 COMPLETE: Gate B live Codex review PASSED

**Gate B (founder-run, separate terminal, authoritative terminal output):**
`npm run relay:codex:live` passed **on the second command attempt** with
exactly **ONE** live Codex call (codex-cli 0.145.0). The first attempt stopped
BEFORE provider launch (exit 5, no call consumed) on the stdout-only login
probe repaired earlier this session — see the previous entry for the exact
root cause and repair.

**Live proof observed:** real Codex reviewer started; Requested Reviewer:
Codex; Actual Reviewer: Codex; launch verified: Yes; sandbox: read only;
fallback: none; verdict **changes_required**; blocking finding "Single active
safety control does not block dispatch" (the seeded `&&`-vs-`||` defect, tied
to AC-1); Finding F-1 created; Repair R-1 created; output remained held;
RELAY STOPPED SAFELY; **no RELAY COMPLETE claim**. No repair or re-review was
performed in Prompt 8.3 (that loop is Prompt 8.4); output correctly remained
blocked. Durable Reviewer recovery remains unavailable (needs persistence).

**Gate-B validation (safe artifacts, no further provider call):** a real Codex
session rollout file exists timestamped seconds after the live run's rebuild
(filename only inspected — content never read); the changes_required exit-3
path structurally requires launch verification + captured session + valid
report + zero reviewer file changes + independence before F-1/R-1 can print
(a reviewer file change or failed independence exits 5 first); pre/post
workspace snapshot equality gates the same path; the fixture root is removed
in a `finally` — no `relay-codex-fixture-*` remains on disk; source repository
untouched; nothing pushed (branch is local-only); no credential file was read
by Relay (probe uses `codex login status` only). Association
(project/mission/task/review/workspace/attempt), initialization verification,
read-only permission compilation, report validation, AC-1 linkage, F-1→R-1
linkage, revision_required visibility, and no-fallback attestation are each
proven on the identical code path by the offline contract harness (58 checks).

**Post-Gate-B verification (exact, non-provider):**
`relay:codex:contract-verify` 58/58; focused codex-reviewer + mission
(reviewer gate) + workspace + boundary tests 149/149 (6 files); relay suite
448/448 (36 files); typecheck green; frontend + backend + relay builds green;
full suite **2037/2037** (154 files); `relay:mission-control`,
`relay:competitive`, `relay:claude:contract-verify`, `relay:workspace:verify`,
`relay:yc:verify`, `relay:manual:verify` all pass. NO provider call.

**Docs:** CURRENT_STATE (phase COMPLETE, truthful two-attempt record),
LIVE_CODEX_REVIEW §Gate-B result, CODEX_REVIEWER_ADAPTER (proven-live),
COMPETITIVE_FEATURE_COVERAGE (§4/§9/§10 sync), this log.

**Commit:** `feat(relay): add real Codex independent reviewer` (no push).

**Exact next step:** **Prompt 8.4 — Live Claude Repair and Codex Re-review
Loop**: live Claude implementation → Relay verification → live Codex finding →
exact Claude session repair → Relay re-verification → exact Codex session
re-review → VERIFIED COMPLETE.

---

## 2026-07-22 — Prompt 8.4 GATE A PASSED: live supervised workflow offline-proven

**Recovery note:** the prior laptop session powered off before any Prompt-8.4
work reached disk — recovery inspection found HEAD at the 8.3 checkpoint
9a74a10, a clean tree, no stashes, no untracked files, no `relay:supervised:*`
scripts, and no supervised module. Gate A was therefore implemented from the
clean checkpoint (nothing restarted, nothing lost).

**Built (`src/relay/connectors/supervised/`):** a COMPOSITION over the two
approved live adapters — it spawns no process, writes nothing into any
workspace, and decides no verdict. Workflow: real Claude implementation
(isolated worktree) → Relay inspection (claimed-only) → Relay-controlled
verification (`node --test`, Relay-run) → output HELD → real independent
Codex review (read-only, attested, independence Relay-computed) → **PATH A**
genuine approval → CompletionPolicy (requires the independent review) →
VERIFIED COMPLETE (exit 0); or **PATH B** genuine validated finding →
F-1 + R-1 (linked, scope-locked) → the EXACT original Claude session resumes
for ONE bounded repair (`--resume`, identity confirmed, attempt-2 report
required) → Relay re-inspects + re-verifies → the EXACT original Codex
session resumes for re-review (`resume <uuid>`, identity confirmed) →
VERIFIED COMPLETE only after genuine approval. Honest stops: failing
verification / needs_human / blocked / unapproving re-review (exit 3, single
repair never exceeded); integrity rejections (exit 5): unclaimed or protected
changes, reviewer file modification, wrong session on EITHER resume, invalid
report/attestation/independence.

**Prohibitions enforced structurally:** no planted defect, no fault
injection, no `demo.fault_injected` anywhere in Relay production sources, no
forced verdict, no manufactured finding, no misleading attribution — proven
by the Prompt-8.4 boundary suite + source-level tests (runner has no
workspace write, no `DEFECT_IMPLEMENTATION` reference, no child_process; the
live fixture is the genuine safe-edit task with NO seeded defect). Offline
fakes simulate approved/changes_required outcomes ONLY (permitted for
orchestration testing): the fake Claude writes the CORRECT reference
implementation; the scripted fake finding is labeled a SIMULATED reviewer
outcome asserting no real defect. Additive fake-Codex extension:
`resumeVerdict`/`resumeFindings` for per-attempt scripted outcomes.

**Commands:** `npm run relay:supervised:contract-verify` (Gate A) ·
`npm run relay:supervised:live` (Gate B, FOUNDER-INITIATED ONLY,
`--confirm-live` required; 2 expected live calls, up to 4 with the single
repair cycle). Combined prerequisites reuse both adapters' gates unweakened;
the no-confirm run verifiably stops at exit 5 with the confirmation screen
and makes no call.

**Gate A verification (exact, NO provider call):**
`relay:supervised:contract-verify` **47/47 (twice)** ending
`READY FOR LIVE SUPERVISED WORKFLOW`; supervised + boundary tests 59/59;
connectors + CLI 103/103; relay suite **462/462** (37 files); typecheck
green; full suite **2051/2051** (155 files); frontend + backend + relay
builds green; `relay:claude:contract-verify` and `relay:codex:contract-verify`
still pass; `relay:yc:verify`, `relay:manual:verify`,
`relay:workspace:verify`, `relay:competitive`, `relay:mission-control` all
pass (exit 0).

**Docs:** SUPERVISED_WORKFLOW.md (new, authoritative) + sync blockquotes in
ARCHITECTURE/TEST_STRATEGY/CLI, CURRENT_STATE (phase + docs table + next
prompt), this log. Uncommitted by instruction (no commit, no push this
session).

**GATE A: READY FOR LIVE SUPERVISED WORKFLOW.**

**Exact next step:** Gate B — the founder runs, in a separate terminal:
`npm run relay:supervised:live`. Both PATH A and PATH B are successful
outcomes; after Gate B passes, commit
`feat(relay): add live supervised implementation review and repair loop`,
then proceed to Post-YC Durable Local Persistence.

---

## 2026-07-22 — Prompt 8.4 COMPLETE: Gate B live supervised workflow PASSED via PATH A

**Gate B (founder-run, separate terminal, authoritative terminal output):**
the FIRST `npm run relay:supervised:live` completed the full loop end to end
with exactly **TWO live calls** (one Claude implementation, one Codex
review). Observed: real Claude implementer launched in the isolated
worktree; execution report received AS A CLAIM; Relay inspection — exactly
one claimed file changed (`src/normalize.js`), zero protected changes,
source worktree unchanged; Relay independently ran
`node --test test/normalize.test.js` — PASS; output HELD FOR REVIEW; real
Codex reviewer launched read-only; attestation — Requested/Actual
Implementer: Claude Code, Requested/Actual Reviewer: Codex, sandbox read
only, fallback none; the reviewer **GENUINELY returned APPROVED on first
review**; CompletionPolicy evaluated the real evidence only after the
approval; Final Audit outcome **verified-complete**, repairs used **0 of
1**; RELAY COMPLETE. This is **PATH A: first-pass approval**. Claude
completed the fixture correctly on its first implementation; no live repair
was required and no live re-review occurred; no Finding or Repair record
was created; no Claude or Codex resume happened; no defect was planted and
no finding was manufactured. **The PATH-B conditional repair /
exact-session re-review branch remains OFFLINE contract-proven, not
live-proven** — it will be exercised live only if a future
founder-authorized run genuinely elicits a blocking finding.

**Accidental second invocation (audited from safe local evidence only —
process table, Relay temp state, sanitized npm invocation logs, provider
artifact FILENAMES/timestamps; no credential file read, no session id
exposed, no provider call made):** while run 1 was executing, typed lines
queued in the terminal. Evidence: npm ran `relay:supervised:live` at
19:52:48 (run 1) and again at 19:53:57 (run 2); exactly two new Claude
fixture-workspace session dirs (19:53, 19:54; ONE session file each — no
resumes) and exactly two new Codex rollout files (19:53:24, 19:54:22)
exist. **Outcome B for the second invocation: it did not stop at the
confirmation screen — it ran to a second FULL PATH-A completion (2
additional live calls) and cleaned up normally.** It is NOT Gate-B
evidence; the first run is authoritative. A THIRD queued
`npm run relay:supervised:live` never executed (no npm record, no
artifacts — this is what Ctrl+C stopped), and an earlier typo'd
`relay:supervised:live~` (19:51:04) was rejected by npm with zero calls.
**Total live calls in the window: 4 (2 authoritative + 2
accidental-complete); no uncertain calls.** Cleanup accounting: both
completed runs removed their fixtures; no active Relay/Claude/Codex
workflow process remained; one stale HALF-BUILT fixture scaffold
(`/tmp/relay-claude-fixture-*`, 19:18:43 — pre-Gate-B, empty src/test, no
commit, no workspace, correlating with NO provider artifact, i.e. an
interrupted non-npm test process that never reached any launch) was
inspected and removed; the source repository shows only the Prompt-8.4
change set.

**Path-A validation (terminal evidence + safe artifacts + code-path
invariants):** Claude session captured (exactly one session file for run
1's workspace — no second session, no resume); requested=actual implementer
(Claude Code) and reviewer (Codex); associations
project/mission/task/workspace/attempt correct by construction (the
exit-0 path structurally requires launch verification, captured sessions,
valid id-matched reports, `allowed` inspections, zero reviewer file
changes, snapshot equality, source-unchanged, Relay-run verification bound
to the reviewed workspace revision, structural independence, and
CompletionPolicy satisfaction — proven on the identical code path by the
47-check offline harness); reviewer read-only with pre/post snapshot
equality; verdict `approved` genuine (parsed report; no forced verdict
exists — boundary-tested); no Finding/Repair created; output released only
at verified-complete; no fallback/deploy/push/source modification; run 1
used the expected two-call PATH-A budget.

**Post-Gate-B verification (exact, NO provider call):** typecheck green;
supervised + Prompt-8.4 boundary tests 59/59;
`relay:supervised:contract-verify` **47/47 (twice)** ending `READY FOR LIVE
SUPERVISED WORKFLOW`; `relay:claude:contract-verify` and
`relay:codex:contract-verify` PASS; `relay:workspace:verify`,
`relay:yc:verify`, `relay:manual:verify` PASS; `relay:mission-control` and
`relay:competitive` exit 0; `relay:test` **462/462**; frontend + backend +
relay builds green; `npm test` **2051/2051** (155 files).

**Docs:** SUPERVISED_WORKFLOW.md §Status (Gate-B PATH-A result + audited
second invocation), CURRENT_STATE (phase COMPLETE, truthful PATH-A record,
next prompt = durable persistence), CLI.md blockquote, this log.

**Commit:** `feat(relay): add live supervised implementation review and
repair loop` (no push).

**Exact next step:** **Post-YC Durable Local Persistence and Real
Cross-Process Resume** (ADR-016) — the workspace registry and
Claude/Codex session records join that scope; durable reviewer/implementer
recovery becomes possible only then.
