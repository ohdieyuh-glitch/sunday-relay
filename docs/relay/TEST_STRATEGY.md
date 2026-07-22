# Sunday Relay — Test Strategy (authoritative)

> **Implementation sync (Prompt 7, 2026-07-22):** workspace security tests
> in `src/relay/workspace/policy.test.ts` (pure: branch-name injection,
> command allow/deny matrix incl. shells/push/reset/clean/force/metachars,
> environment secret-stripping, segment-safe protected-path classification,
> sanitizer, bounded output, cleanup decisions) and
> `src/relay/workspace/workspace.test.ts` (real git fixtures under tmpdir:
> repo validation, unborn/bare rejection, pinning, idempotent + conflicting
> reuse, symlinked-root rejection, source-change detection, clean→allowed→
> unclaimed→protected→symlink-escape walk without claim expansion, runner
> completion/rejection/timeout/cancel/output-limit/sanitization/env
> isolation, execution refusal when flagged, conservative cleanup incl.
> dirty-worktree refusal and unknown-workspace refusal). Boundary additions
> in `relay-core-boundary.test.ts` (workspace purity, child_process
> confinement, no core/connector/prototype imports, CLI composition-root-
> only access, denylist presence). End-to-end proof:
> `npm run relay:workspace:verify` (30-check fixture harness, run twice).

> **Implementation sync (Prompt 6, 2026-07-22):** YC presentation tests in
> `src/relay/cli/yc.test.ts` (scenario registration/objective, one repair +
> same-session + independence through the real orchestrator, 26 evidence
> records with exactly one failure, presentation frame ordering incl. the
> Project Brain/Handoff/Repair moments, 80-column safety, simulation
> labeling, renderer-only pacing, honest failure frames, repeatable
> semantics, clean JSON) + `scripts/relay-yc-verify.mjs` (bundled
> double-run semantic acceptance, exit 0 gate).

> **Implementation sync (Prompt 4, 2026-07-22):** §9 adapter contracts and
> §11 demonstration scenarios are implemented — 20 new tests:
> `src/relay/connectors/simulated.test.ts` (adapter contracts: provenance,
> role, association, determinism, malformed-input rejection via the same
> schema gate as real input, independence, no credential shapes) and
> `src/relay/relay-vertical-slice.test.ts` (direct success; §11.1 golden
> path with one same-session repair; §11.2 checkpoint escalation; §11.3
> duplicate + stale-revision prevention with zero agent invocation; §11.4
> honest failure ×3 incl. unavailable verification and live-only policy
> rejecting simulated evidence; budget hard-stop + warning; pause/resume/
> cancel/duplicate-command idempotency/terminal protection/checkpoint
> approval). Run scenarios with:
> `npx vitest run src/relay/relay-vertical-slice.test.ts`.

> **Implementation sync (Prompt 3, 2026-07-21):** §§5–7 and the coordination
> scope are implemented — 90 new tests: ownership/lease boundaries
> (`coordination/ownership.test.ts`), duplicate-work/dependency/staleness
> (`coordination/checks.test.ts`), file+resource claims incl. hostile-path
> rejection (`coordination/claims.test.ts`), the 28-check pre-execution
> battery (`coordination/eligibility.test.ts`), compiler/validation/revision
> (`handoff/handoff.test.ts`), completion-policy + evidence-quality + budget
> (`verification/verification.test.ts`), 15-condition repair decision +
> repeated-failure/no-progress/recovery (`recovery/recovery.test.ts`), the
> nine Section-24 integration scenarios
> (`relay-coordination-scenarios.test.ts`), and the extended boundary walk
> (no shell/Git/fs, no provider reassignment). Remaining: §9
> adapter/simulation and §11 demo-scenario wiring (Prompt 4).

> **Implementation sync (Prompt 2, 2026-07-21):** §§1–6 and §8's Prompt-2
> purity walk are implemented — 62 new tests across
> `src/relay/protocol/protocol.test.ts`, `src/relay/core/run-machine.test.ts`,
> `src/relay/core/task-machine.test.ts`, `src/relay/ledger/ledger.test.ts`,
> and `src/relay/relay-core-boundary.test.ts` (protocol validation incl.
> every command/report family, full + one-revision run lifecycles,
> checkpoint/pause/resume/cancel, terminal protection, revision limits 0/1,
> event ordering + idempotency, append-only ledger + replay determinism,
> claim recording/promotion/rejection, task invariants + staleness
> primitives + lease recovery, boundary + security invariants incl.
> credential-shape and hidden-reasoning scans). §7 budget wiring, §9
> adapter/simulation, and §11 demo scenarios land with the next prompts.

> Status: **locked** (Phase 1 architecture lock, 2026-07-21). Framework:
> vitest, mocked/deterministic, **zero paid provider calls ever** (repo
> rule). Tests land with the prompt that implements the behavior; the
> mapping below marks the earliest prompt. Existing prototype tests (7
> files under `src/relay/`) remain green and untouched until the prototype
> is relocated.

## 1. Protocol & schema (Prompt 2)

- **Runtime schema validation** — every envelope/contract validator accepts
  the documented shape and rejects: missing required fields, wrong types,
  unknown protocol version, placeholder junk (carry the prototype's
  placeholder-rejection pattern).
- **Versioning** — unknown `protocolVersion` rejected with a stable error
  code; additive optional fields do not break old fixtures.

## 2. Run/task state machines (Prompt 2)

- **Legal transitions** — the full sequential phase walk, pause/resume,
  checkpoint enter/approve/reject.
- **Illegal transitions** — every out-of-order phase jump rejected
  (`illegal-transition`); table-driven over the full status × command grid.
- **Terminal-state protection** — completed/failed/cancelled runs reject
  every mutating command with `immutable`; late reports become historical
  claims only.
- **One-repair limit** — `repairCount` can never reach 2 by any command
  sequence (property-style test over command permutations).
- **Guided checkpoint behavior** — each of the 15 auto-repair conditions
  individually false → `checkpoint_required` (15 cases); all true → exactly
  one Revision Contract compiled with all 15 evaluations recorded.

## 3. Ledger (Prompt 2)

- **Append-only** — no API mutates or deletes an appended event; attempts
  are compile-impossible (no method) and runtime-guarded.
- **Monotonic ledger version** — gap-free sequence under interleaved
  appends; `expectedLedgerVersion` conflict returns
  `ledger-version-conflict`.
- **Projection rebuild** — current-state projection rebuilt from events
  equals incrementally maintained projection (determinism check).
- **Classification** — claims never appear in the canonical projection;
  only `claim-accepted` re-emissions do.

## 4. Claims, promotion, evidence (Prompt 2)

- **Claim promotion** — schema-valid report → `claim-recorded` only;
  promotion requires policy satisfaction; rejection paths emit
  `claim-rejected` with reasons.
- **Unsupported success claims** — an implementation report claiming green
  commands NEVER yields verified evidence by itself (the anti-pattern
  test: prototype-style pasted "pass" stays `unverified-claim`).
- **Evidence integrity** — EvidenceRecords carry exitCode/environment/
  repoRevision/executedAt; a bundle mixing repoRevisions is `unverified`.
- **Evidence freshness / revision pinning** — evidence for revision A does
  not satisfy a policy evaluated at revision B; freshness computed from
  repoRevision+executedAt, never ingestion time.
- **Reviewer independence** — verdicts from an assignment sharing
  adapter/session lineage with the implementer are rejected as
  non-independent regardless of report-body names; manual reviews satisfy
  policies only when the policy admits `manual`.

## 5. Coordination (Prompt 2)

- **Task ownership** — one owner at a time; second assignment refused.
- **Duplicate-task detection** — same objective/category active →
  `duplicate-task`; completed/superseded tasks refuse re-execution.
- **File-claim conflicts** — overlapping active claims refused; released/
  expired claims free the path.
- **Lease expiry** — expired lease emits `task-lease-expired`, task returns
  to `queued`, a new assignment succeeds (crash recovery).
- **Stale context** — package compiled at contextVersion N refused
  execution when consumed state moved past N; `baseRevision` drift detected.
- **Superseded task / dependency blocking** — superseded tasks are
  `obsolete`; unmet dependencies hold tasks out of `assigned`.
- **Invalidated by decision** — a DecisionRecord accepted after the task's
  `contextVersion` that conflicts with the task refuses execution with
  `invalidated-by-decision` (PROTOCOL §2.4).

## 6. Recovery & failure (Prompt 2 detection; recovery later)

- **Repeated failure** — identical command/test failure twice → FailureRecord
  with `repeated-*` signal → stop (no second repair).
- **No-progress detection** — revision with no meaningful diff → FailureRecord
  → checkpoint/blocked.

## 7. Budget & spend (schema Prompt 2; enforcement wiring in the checkpoint/cost prompt)

- **Budget enforcement** — projected overrun refuses compile/dispatch
  (`budget-exceeded`), emits checkpoint.
- **Spend-authorization layering** — cloud dispatch requires inner
  BudgetPolicy AND outer SpendAuthorizationPort approval; a stub outer-deny
  blocks even when inner approves (layering test with fake gateway).
- **Local/cloud dispatch separation** — a local package can never route to
  the cloud gateway and vice versa (type/port-level + runtime test).

## 8. Boundaries (extend the existing pattern; Prompt 2)

- **Relay-core purity** — `src/relay/{protocol,core,ledger,coordination,handoff,routing,verification,recovery}/**`
  import no fusion-engine, server, session-store, react, zustand, browser
  APIs, or node-fs (fs confined to storage/cli/connectors). Timing:
  **Prompt 2** adds a purity walk over the NEW roots only (prototype
  folders explicitly excluded, existing `relay-boundary.test.ts`
  untouched); the later prototype-relocation prompt rewrites the walk to
  cover all of `src/relay/**` with only `prototype/`, `storage/`, `cli/`,
  `connectors/` exemptions — never weakened as a drive-by (AGENTS.md §5.4).
- **CLI/core boundary** — cli imports only relay-protocol (+ rendering);
  no state-transition/completion/routing/policy/promotion logic in clients
  (source-level assertion, mirroring Decision 9).
- **UI/core boundary** — same assertion for any future client folder.
- **No-secret-output** — events, packages, reports, audits, CLI output
  fixtures scanned against credential shapes (reuse repo secret-redactor
  conventions); adapters' sessionRef fixtures prove opacity.

## 9. Adapters & simulation (simulation-harness prompt)

- **Adapter contract tests** — every adapter (simulated first, Claude
  Code/Codex later) passes the same port-level contract suite: consumes a
  package, emits schema-valid reports, honors stoppingCondition, labels
  provenance truthfully, declares its enforcement capabilities.
- **Simulation provenance** — every simulated event/report carries
  `provenance: simulated`; the run's `provenanceProfile` is `simulated`;
  rendering fixtures show the Simulated label (truthfulness test).
- **Cancellation** — cancel mid-phase invalidates leases/packages; late
  simulated reports are recorded historical, never promoted.
- **Crash recovery** — kill/restart the harness mid-run (in-memory:
  re-hydrate from events); leases expire; run resumes or blocks cleanly.

## 10. Future (reserved, written when parallelism lands)

- **Parallel-conflict tests** — concurrent claims, merge-order, dependency
  scheduling, heartbeat staleness.

## 11. First deterministic demonstration scenarios (the July 24 script)

1. **Golden path with one repair** — objective → simulated blueprint →
   accept → task → package (pinned versions shown) → simulated
   implementation → Relay-executed simulated verification (one failing
   check) → simulated review (changes_requested, 1 finding) → all 15
   conditions true → one Revision Contract → re-verify green → re-review
   approved → promotion → Final Audit Report `verified-complete`,
   provenanceProfile `simulated`.
2. **Checkpoint escalation** — same flow, but the finding touches a
   protected path (condition 6 false) → `checkpoint_required` → founder
   approves via CLI → manual-labeled continuation → audit records the
   checkpoint.
3. **Duplicate/stale prevention** — second identical objective refused
   (`duplicate-task`); a package executed after a ledger move refused
   (`stale-context`); lease expiry frees a crashed run's task.
4. **Honest failure** — repair's re-verification fails → no second repair →
   `blocked` → Final Audit Report `failed` (proves audits are not success
   certificates).
