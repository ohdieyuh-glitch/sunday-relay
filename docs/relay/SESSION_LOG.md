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
