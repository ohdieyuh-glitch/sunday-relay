# Relay Competitive Feature Coverage (Prompt 8.1)

> **Implementation sync (Prompt 8.3, 2026-07-22):** the "independent reviewer"
> capability moves from SIMULATED to a REAL live provider. A live local Codex
> reviewer now runs behind the provider-neutral Reviewer port — read-only,
> isolated-workspace, attested by Relay, structurally independent from the
> implementer, with no fallback — proven offline (`relay:codex:contract-verify`)
> and LIVE via the explicit `relay:codex:live` Gate-B review (PASSED
> 2026-07-22: one real Codex call, seeded defect found, verdict
> changes_required, output held, stopped safely). The deterministic
> Codex reviewer remains the demo/mission-control default; the competitive demo
> still labels its reviewer SIMULATED. Live Claude repair + Codex re-review loop
> (closing the workforce cycle) remains DEFERRED to Prompt 8.4.

> The 19 founder-specified competitive features, mapped to what actually
> exists in the codebase. Status is honest: a feature is `implemented` ONLY
> when working code exists (a type or a doc entry alone is never
> `implemented`). Statuses: `implemented` · `partially_implemented` ·
> `architecture_only` · `deferred` · `blocked`.

The competitive distinction Relay proves: a plugin connects two agents;
Relay governs the work between every agent. Agents are replaceable; the
mission intelligence, governance, evidence, and execution history stay with
Relay. `npm run relay:competitive` demonstrates this end-to-end (SIMULATED
Claude Implementer + Codex Reviewer); `npm run relay:claude:live` proves the
real Claude Code path.

| # | Feature | Status |
| --- | --- | --- |
| 1 | Structured Mission Contract | implemented |
| 2 | Canonical Project Ledger | implemented |
| 3 | Role-Specific Handoff Compiler | implemented |
| 4 | Provider-Neutral Agent Adapter System | implemented |
| 5 | Safe Agent Workspace Isolation | implemented |
| 6 | Task Ownership and Duplicate-Work Prevention | implemented |
| 7 | Agent Passport and Permission Governance | partially_implemented |
| 8 | Agent Run Supervisor | partially_implemented |
| 9 | Truthful Execution Attestation | implemented |
| 10 | Independent Review and Repair Ledger | implemented |
| 11 | Review Budget Governor | partially_implemented |
| 12 | Evidence-Backed Completion Engine | implemented |
| 13 | Automatic Agent Routing | deferred |
| 14 | Failure Rerouting and Rescue | deferred |
| 15 | Cross-Agent Continuity Test | partially_implemented |
| 16 | Mission Policy Pack | partially_implemented |
| 17 | Append-Only Relay Event Ledger | implemented |
| 18 | Relay Mission-Control Interface | partially_implemented |
| 19 | Aquala Trace Integration | deferred |

---

### 1. Structured Mission Contract — **implemented**
- **Existing:** `src/relay/mission/mission.ts` builds + validates a
  `RelayMissionContract` projection from canonical state; revisions with a
  binding digest; handoff staleness; CLI `/mission`, JSON read model.
- **Missing:** operator-driven live revision authoring (demo uses a fixed
  spec); persistence of revision history (volatile).
- **YC relevance:** the headline — Relay owns the authoritative mission.
- **Post-YC:** durable revision store + operator revision editing.
- **Dependencies:** Project Ledger, Blueprint, CompletionPolicy.
- **Security:** secret + hidden-reasoning rejection in mission text.

### 2. Canonical Project Ledger — **implemented**
- **Existing:** `src/relay/ledger/` — gap-free monotonic append-only log,
  frozen envelopes, idempotency, deterministic projection.
- **Missing:** durable on-disk persistence (volatile in-memory).
- **YC relevance:** the single source of truth agents can't rewrite.
- **Post-YC:** file-backed JSONL persistence (ADR-016).
- **Dependencies:** protocol event contracts.
- **Security:** sole appender; typed events only; no secrets in events.

### 3. Role-Specific Handoff Compiler — **implemented**
- **Existing:** `src/relay/handoff/compiler.ts` — role-specific packages
  with pinned ledger/context/base revisions, allowed/protected files,
  required evidence; Claude-specific prompt compiler (Prompt 8).
- **Missing:** compilers for roles beyond coding-agent/reviewer at live scale.
- **YC relevance:** each agent gets exactly what it needs — not a transcript.
- **Post-YC:** live reviewer + security-reviewer prompt compilers.
- **Dependencies:** Mission Contract, Project Ledger.
- **Security:** minimum-context, no secrets, no transcripts.

### 4. Provider-Neutral Agent Adapter System — **implemented**
- **Existing:** `src/relay/connectors/ports.ts` (provider-neutral ports),
  simulated adapters (Prompt 4), **real Claude Code adapter** (Prompt 8),
  **real Codex reviewer adapter** (Prompt 8.3, Gate B live-proven).
- **Missing:** real Hermes/OpenClaw/Ophiuchus adapters.
- **YC relevance:** agents are replaceable behind one port.
- **Post-YC:** additional real provider adapters.
- **Dependencies:** workspace isolation, protocol contracts.
- **Security:** adapters can request but never self-attest/promote.

### 5. Safe Agent Workspace Isolation — **implemented**
- **Existing:** `src/relay/workspace/` — real `git worktree` isolation,
  protected paths, file-claim enforcement, shell-free bounded execution
  (Prompt 7); `relay workspace verify`.
- **Missing:** OS-level sandbox (detective enforcement today).
- **YC relevance:** real edits, source repo never touched.
- **Post-YC:** durable workspace registry; OS sandbox hardening.
- **Dependencies:** git, Node std lib.
- **Security:** the enforced boundary a live agent runs inside.

### 6. Task Ownership and Duplicate-Work Prevention — **implemented**
- **Existing:** `src/relay/coordination/` — one active owner, leases,
  structured equivalence keys, dispatch eligibility (Prompt 3).
- **Missing:** cross-process ownership (volatile).
- **YC relevance:** no two agents silently do the same work.
- **Post-YC:** durable ownership with persistence.
- **Dependencies:** Project Ledger.
- **Security:** no semantic-equivalence claims; structured keys only.

### 7. Agent Passport and Permission Governance — **partially_implemented**
- **Existing:** permission compilation + tool policy + protected paths + env
  credential stripping (Prompt 7/8); requested-vs-actual identity +
  attestation (Prompt 8.1).
- **Missing:** a formal signed Agent Passport (capability token / identity
  credential) — not built.
- **YC relevance:** Relay governs what each agent may do; identity is tracked.
- **Post-YC:** Agent Passport issuance + verification.
- **Dependencies:** attestation, permission compiler.
- **Security:** no credentials in state; identity separated from execution.

### 8. Agent Run Supervisor — **partially_implemented**
- **Existing:** bounded process runner with runtime/output limits,
  cancellation, SIGTERM→SIGKILL, honest termination (Prompt 7/8); the
  orchestrator step engine.
- **Missing:** a full runtime supervisor (heartbeat/liveness, multi-run
  scheduling) — explicit Prompt-8.1 non-goal.
- **YC relevance:** live runs are bounded and cancellable.
- **Post-YC:** full supervisor with liveness + rescue hooks.
- **Dependencies:** workspace runner, adapter.
- **Security:** no unbounded processes; termination reported truthfully.

### 9. Truthful Execution Attestation — **implemented**
- **Existing:** `src/relay/mission/attestation.ts` — immutable
  requested-vs-actual attestations, launch-verified vs requested, visible
  authorized fallback, live/simulated provenance; CLI `/attestation`.
- **Missing:** attestation persistence (volatile); passport reference wiring.
- **YC relevance:** "Reviewed by Codex" cannot exist without a Codex
  attestation — one now exists from the live Gate-B review (Prompt 8.3).
- **Post-YC:** durable attestations.
- **Dependencies:** ledger/audit identities, session capture.
- **Security:** no credentials/streams/hidden reasoning; digests over safe
  summaries only.

### 10. Independent Review and Repair Ledger — **implemented**
- **Existing:** `src/relay/mission/review-repair.ts` — linked
  Review/Finding/Repair records; blocking findings create repairs; evidence
  + re-review required to resolve; scope/claim expansion rejected; CLI
  `/findings` `/repairs`.
- **Missing:** the live repair + re-review loop (Prompt 8.4); the live Codex
  reviewer produced a real blocking finding (F-1 + linked R-1) in the Gate-B
  proof, but no live repair/re-review has run yet.
- **YC relevance:** findings become tracked repair obligations, not chat.
- **Post-YC:** live Claude repair + exact-session Codex re-review (Prompt 8.4).
- **Dependencies:** ReviewerVerdict, RevisionContract, evidence.
- **Security:** an agent "fixed it" claim never resolves a finding.

### 11. Review Budget Governor — **partially_implemented**
- **Existing:** `maximumReviewRuns` + `maximumRepairIterations` in the
  Mission Contract; `limitExceeded` in the ledger projection; budget
  evaluator (Prompt 3).
- **Missing:** a dedicated governor service enforcing review spend at
  dispatch time across runs.
- **YC relevance:** no unbounded review loops.
- **Post-YC:** governor wired into live dispatch.
- **Dependencies:** budget evaluator, mission limits.
- **Security:** deterministic bounds; no infinite loop.

### 12. Evidence-Backed Completion Engine — **implemented**
- **Existing:** `evaluateCompletionPolicy` (Prompt 3) + the deterministic
  mission verdict engine `src/relay/mission/verdict.ts` (Prompt 8.1); CLI
  `/verdict`.
- **Missing:** persistence of verdict history.
- **YC relevance:** VERIFIED COMPLETE is a Relay verdict, never an agent
  claim.
- **Post-YC:** durable verdict records.
- **Dependencies:** evidence, reviews, attestations, findings.
- **Security:** free-text claims never count; approval never bypasses a
  missing/failed required test.

### 13. Automatic Agent Routing — **deferred**
- **Existing:** the provider-neutral adapter system makes routing possible.
- **Missing:** any routing/selection logic (explicit non-goal this phase).
- **YC relevance:** shown conceptually, not demoed.
- **Post-YC:** capability-based routing over the adapter registry.
- **Dependencies:** adapter system, mission policy.
- **Security:** routing must preserve attestation + governance.

### 14. Failure Rerouting and Rescue — **deferred**
- **Existing:** the bounded recovery decision (Prompt 3) stops safely
  (checkpoint/blocked) — but does NOT reroute.
- **Missing:** rerouting/rescue to an alternate agent (explicit non-goal).
- **YC relevance:** Relay stops safely; rescue is future.
- **Post-YC:** policy-authorized fallback with visible attestation.
- **Dependencies:** attestation fallback fields (already modeled), routing.
- **Security:** no silent fallback; fallback never inherits identity.

### 15. Cross-Agent Continuity Test — **partially_implemented**
- **Existing:** the competitive demo shows Claude → Codex continuity via the
  shared Mission Contract + Ledger + Handoff (context preserved across
  agents, provenance tracked).
- **Missing:** a dedicated continuity harness across REAL agents.
- **YC relevance:** the core "keep the context across agents" claim.
- **Post-YC:** live Claude→Codex continuity test.
- **Dependencies:** mission, ledger, real adapters.
- **Security:** no transcript forwarding; references only.

### 16. Mission Policy Pack — **partially_implemented**
- **Existing:** CompletionPolicy, PermissionPolicy, BudgetPolicy, LoopPolicy,
  mission completion rules + limits as first-class policy objects.
- **Missing:** a unified, versioned Mission Policy Pack bundle.
- **YC relevance:** the mission's rules are explicit and enforced.
- **Post-YC:** bundle + versioning + operator authoring.
- **Dependencies:** mission contract, policies.
- **Security:** enforcement levels disclosed truthfully.

### 17. Append-Only Relay Event Ledger — **implemented**
- **Existing:** `src/relay/ledger/ledger.ts` — gap-free monotonic sequence,
  frozen envelopes, idempotency, replay determinism.
- **Missing:** durable on-disk log (volatile).
- **YC relevance:** the attributable, ordered mission history.
- **Post-YC:** JSONL persistence.
- **Dependencies:** protocol events.
- **Security:** no silent event removal; no secrets.

### 18. Relay Mission-Control Interface — **partially_implemented**
- **Existing:** CLI mission-control surface — `/mission /attestation
  /findings /repairs /verdict /timeline`, `relay demo competitive`, and
  serializable read models designed for a future graphical Mission Control.
- **Missing:** the graphical Mission Control + Live Terminal (non-goals).
- **YC relevance:** a real, inspectable control surface today.
- **Post-YC:** graphical Mission Control reusing these read models.
- **Dependencies:** mission read models.
- **Security:** JSON read models carry no ANSI/mascot/secrets.

### 19. Aquala Trace Integration — **deferred**
- **Existing:** none (explicit non-goal).
- **Missing:** everything (trace/telemetry export to Aquala).
- **YC relevance:** mentioned as future infrastructure, not demoed.
- **Post-YC:** trace integration once durable persistence exists.
- **Dependencies:** durable ledger, external Aquala service.
- **Security:** trace export must redact secrets and honor provenance.
