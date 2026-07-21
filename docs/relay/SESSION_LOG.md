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
