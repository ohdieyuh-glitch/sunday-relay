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
