# Sunday Relay — MVP Specification (authoritative)

> **Implementation sync (Prompt 8.1, 2026-07-23):** the competitive proof
> layer adds `src/relay/mission/` — pure, browser-safe PROJECTIONS over
> canonical state (not a second source of truth): the Mission Contract
> (revisioned, binding-digest staleness), immutable Execution Attestations
> (requested-vs-actual identity, visible authorized fallback, live/simulated
> provenance), the linked Review/Finding/Repair ledger (evidence + re-review
> gate resolution; no scope/claim expansion), a deterministic mission verdict
> engine (the eight verdicts; agent claims are never evidence; approval never
> bypasses a missing test), and a mission timeline over the existing event
> stream. `npm run relay:competitive` (SIMULATED Claude Implementer + Codex
> Reviewer) reaches VERIFIED COMPLETE through the REAL orchestrator; the real
> Claude path stays `npm run relay:claude:live`. See MISSION_CONTRACT.md,
> EXECUTION_ATTESTATION.md, REVIEW_REPAIR_LEDGER.md,
> COMPETITIVE_FEATURE_COVERAGE.md.

> Status: **locked** (Phase 1 architecture lock, 2026-07-21). Product scope
> for the first powerful Relay version. Contracts: `PROTOCOL.md`.
> Architecture: `ARCHITECTURE.md`.

## 1. Product promise

Sunday Relay turns separate AI agents into one continuous, supervised
workforce. Relay gives each agent the correct responsibility, compiles
agent-specific context packages, preserves project continuity across
providers, prevents duplicate and conflicting work, detects failures and
routes recovery, requires independent verification for important work,
controls cost, latency, permissions, and interruptions, maintains canonical
project intelligence owned by the user, and produces objective evidence
before declaring completion.

**Relay is not another coding agent.** Claude Code, Codex, Hermes, and
future agents perform the specialized work. Relay owns cross-company agent
continuity, responsibility transfer, task supervision, project-level memory,
agent routing, verification, failure recovery, disagreement resolution,
cost allocation, and completion proof.

## 2. User problem & competitive distinction

Founders and teams already run several agent tools, but each is a silo:
context dies between sessions, work is duplicated or conflicts, "done"
means whatever the agent claimed, and nobody owns the project's memory.
Relay's distinction is exactly the layer no coding agent owns: the
**handoff network** — compiled responsibility contracts between agents, a
canonical user-owned ledger, and completion that must be *proved*, never
self-reported.

Relay must not become: a chat window with agent buttons; a shared markdown
handoff doc with a UI (that is the *prototype*, deliberately superseded); a
transcript forwarder; a whole-task router; unbounded agent debate; a coding
agent; a Hermes competitor; a provider memory wrapper; a dashboard that
displays without controlling; **a system that accepts self-reported
completion as proof.**

## 3. The five-system MVP

1. **Canonical Project Ledger** — typed append-only events, monotonic
   version, six-way classification, claim promotion (PROTOCOL §2.2, §3.1).
2. **Agent adapter interfaces** — Architect / CodingAgent / Reviewer /
   Verification ports with simulation adapters first (PROTOCOL §1.3;
   ARCHITECTURE §7 connectors).
3. **Structured Handoff Compiler** — AgentHandoffPackage with pinned
   ledger/context versions and per-restriction enforcement levels
   (PROTOCOL §4.2–4.3).
4. **Task ownership and completion proof** — single-owner RelayTask, leases
   with expiry recovery, pre-execution check battery, Relay-executed
   EvidenceBundles, CompletionPolicy (PROTOCOL §2.4–2.6, §3.2–3.5).
5. **One bounded review-and-repair loop** — deterministic verification →
   independent review → at most one automatic repair → re-verification →
   re-review per policy → final audit (PROTOCOL §4.4, §5.4).

## 4. MVP workflow (sequential, Guided Mode)

```
User objective
→ Prompt Architect Blueprint (simulated | imported | live-adapter later)
→ accept-blueprint checkpoint (Guided)
→ Canonical Task Contract (owned RelayTask, pre-execution checks)
→ compiled Claude-Code-role responsibility contract (AgentHandoffPackage)
→ implementation report (ingested as unverified claim)
→ Relay-executed deterministic verification (EvidenceBundle)
→ independent review (simulated now; Codex first live)
→ at most ONE automatic repair (Revision Contract, conditions §6)
→ re-verification (+ re-review when policy requires)
→ claim promotion per CompletionPolicy
→ Canonical Project Ledger update
→ Final Audit Report (the one verified completion report)
```

Ordering note: the task is created AFTER blueprint acceptance because the
Canonical Task Contract derives from the accepted Blueprint's
`taskBreakdown` — a deliberate refinement of the addendum's literal
ordering, recorded as ADR-020 and reflected identically in ARCHITECTURE §5,
PROTOCOL §2.3, and TEST_STRATEGY §11.

### 4.1 The three Architect sources (Decision 2)
1. **Simulated Architect** — deterministic Phase-1 harness.
2. **Imported Architect Blueprint** — structured Blueprint authored
   externally (currently: the founder gives the objective to ChatGPT, which
   authors the Blueprint; the founder imports it). Imported blueprints are
   untrusted external artifacts, schema-validated, promoted only by the
   human `accept-blueprint` command. **The initial real workflow uses this
   path — no paid Architect API call.**
3. **Live Architect Adapter** — future, only after core, persistence,
   checkpoints, and worktree safety are stable. No provider (ChatGPT,
   OpenAI, Claude, Sunday) is hardcoded in Relay Core.

Architect identity, session reference (when available), blueprint
provenance/version/validation, and usage records are first-class contract
fields regardless of source.

### 4.2 First live path (Decision 3)
The first concrete live Reviewer is **Codex** (`CodexReviewerAdapter`),
behind the provider-neutral ReviewerAdapter port. Reviewer identity derives
from the assigned adapter + execution session, never from report text. A
coding agent reviewing its own work is never independent review; Architect
feedback does not satisfy an independent-review policy; manual review may
be imported but is labeled `manual` and never presented as automated
independent review. Until the Codex adapter exists, independent review is
demonstrated simulated and clearly labeled.

## 5. MVP boundaries & non-goals

In scope: one active implementation task; sequential; one Coding Agent
role; one Reviewer role; one automatic revision; Guided Mode only; local
simulation adapters; budget policy that stops before overrun.

Excluded (non-goals for MVP): Autopilot; real cross-agent parallelism;
adaptive/learned routing; autonomous provider switching (recovery in MVP
detects and STOPS — it never reassigns to another provider); Hermes; skill
compilation; Digital Twins; subscription-aware routing; agent debate;
production deployment; push-to-main; unrestricted shell; **any live
coding-agent adapter before the isolated worktree manager exists and
passes its safety tests.**

## 6. Guided Mode behavior (Decision 4)

Guided Mode may perform **at most one** automatic repair without user
approval, only when ALL of these are true:

1. The failure is supported by objective evidence.
2. The repair request is narrow and unambiguous.
3. The same Coding Agent and session can continue.
4. The repair stays inside the existing task objective.
5. The repair stays inside the existing file claims.
6. No protected file must change.
7. No new permission is required.
8. No destructive command is required.
9. No deployment is required.
10. No new dependency is required (unless already approved).
11. No additional credentials are required.
12. Projected cost stays inside the approved budget.
13. No budget-warning checkpoint is active.
14. No unresolved product or architecture decision exists.
15. The Reviewer's finding does not conflict with an accepted canonical
    decision.

Any condition false → `checkpoint_required`. The Revision Contract records
every condition's evaluation (PROTOCOL §4.4). After the one repair: rerun
deterministic verification; rerun the Reviewer check when policy requires;
complete only when CompletionPolicy is satisfied; otherwise stop at
`checkpoint_required` / `blocked` / `failed` (run status becomes
`checkpoint_required` or `failed`; `blocked` is the task status / audit
outcome — see PROTOCOL §2.3 blocked-mapping). **Never a second automatic
repair.**

## 7. Completion requirements

A run is `verified-complete` only when: every gating claim has been
promoted through relay-core; the EvidenceBundle for the final revision is
green under the task's CompletionPolicy (low-risk preset in MVP: targeted
checks + typecheck pass, expected diff exists, independent review
required); reviewer independence is structurally satisfied; evidence is
pinned to the final `repoRevision`; and the Final Audit Report is recorded.
Evidence statuses `unavailable`/`unverified` block completion wherever the
policy requires enforcement (Decision 5). Failure is recorded honestly —
the audit report can state `failed`.

## 8. July 24 demonstration (Decision 6)

**The demo is a real Relay Core + CLI workflow on deterministic simulation
adapters.** It must prove: the Canonical Project Ledger; one owned
RelayTask; a structured AgentHandoffPackage with explicit context and
ledger versions; duplicate-work prevention; simulated Architect; simulated
Coding Agent; Relay-executed simulated verification; simulated independent
Reviewer; one bounded review-and-repair loop; CompletionPolicy;
EvidenceBundle; Final Audit Report; accurate simulated/live provenance;
pause, resume, cancel, inspect, and checkpoint behavior; **no paid calls;
no misleading claims of real code execution.**

The golden-path web experience may also be shown, labeled **"Relay Protocol
Prototype"** — never as the finished architecture.

A real Claude Code execution before July 24 is a **stretch goal only**,
allowed only when ALL are complete and green: persistent run storage;
Guided checkpoint enforcement; budget enforcement; isolated worktree
manager; protected-path enforcement; command restrictions; cancellation
behavior; crash recovery; Claude Code adapter contract tests;
no-secret-output tests. The architecture is never weakened to make a live
demo happen.

## 9. Long-term direction: Relay Autopilot

Autopilot (mission-level objective → decomposition → assignment → bounded
parallel execution → verification → one verified completion report) remains
the long-term mode, always bounded by cost/time/loop/permission limits,
protected resources, destructive-action/credential/product-decision
checkpoints, disagreement escalation, and a complete audit history. Nothing
in Autopilot is part of the MVP; the MVP's contracts (ledger, tasks,
claims, evidence, audits) are its foundation.
