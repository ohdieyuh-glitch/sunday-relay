# Relay Review + Repair Ledger (Prompt 8.1)

> **Persistence sync (Prompt 8.5, 2026-07-22):** Findings and Repairs
> persist durably (linked ids, criteria, bounded evidence, required
> actions, status) and reconstruct after a crash: an interrupted run
> restores its open Finding, linked Repair, `revision_required`
> visibility, and remaining call budget, and the recovery plan requires
> explicit founder authorization before the bounded repair resumes. See
> DURABLE_LOCAL_PERSISTENCE.md.

> **Implementation sync (Prompt 8.3, 2026-07-22):** the ledger now receives
> findings from a REAL independent reviewer. The live Codex reviewer's
> validated `RELAY_REVIEW_REPORT_V1` findings are mapped into the neutral
> `ReviewInput` shape and projected through this ledger by the Relay-owned
> `evaluateReviewerGate`: a blocking finding creates exactly one linked repair
> obligation (scope-locked to the original claims, no scope/claim expansion),
> and the finding stays open (output revision_required) until BOTH post-repair
> evidence AND an approving re-review exist — never the reviewer's word. Repair
> EXECUTION is not part of Prompt 8.3 (it arrives with the live Claude repair +
> Codex re-review loop, Prompt 8.4).

> Extends the existing ReviewerVerdict / ReviewFinding / RevisionContract
> behavior into explicit, LINKED records so review findings become tracked
> repair obligations that cannot close on an agent's word. Implemented in
> `src/relay/mission/review-repair.ts` (pure). CLI: `/findings`, `/repairs`.

## Records

- **RelayReview** — a review event: reviewer identity (requested vs actual),
  reviewed mission/task/workspace revision, verdict
  (`approved` | `changes_required`), linked finding ids, provenance.
- **RelayFinding** — `findingId · reviewId · severity · title · description ·
  evidenceIds · affectedFiles · affectedCriterionIds · requiredAction ·
  blocking · status(open|in_repair|resolved|reopened) · repairTaskId ·
  resolutionEvidenceIds · openedAt · resolvedAt · resolutionReviewId`.
- **RelayRepair** — `repairId · findingId · originalTaskId · assignedAgentId
  · revisionContractId · requiredChanges · prohibitedScopeExpansion(true) ·
  affectedFiles · requiredTests · requiredEvidence · iteration · status ·
  evidenceIds`.

## Rules (deterministic, enforced)

- `changes_required` must carry at least one actionable finding
  (`reviewHasActionableFinding`).
- Every **blocking** finding creates/links exactly ONE repair obligation.
- A repair **links to its finding**, **preserves the acceptance criterion**
  (`affectedCriterionIds`), and cannot silently expand the task objective.
- A repair cannot expand file claims — `repairExpandsFileClaims` flags any
  file outside the original task's claims.
- A Coding Agent "fixed it" statement does **not** resolve a finding.
- Resolution requires BOTH supporting post-repair verification evidence AND
  an approving required re-review — never one without the other.
- A reviewer may reopen a finding (`status: reopened`) with new evidence;
  `openBlockingFindings` then counts it as still blocking.
- Blocking open findings prevent verified completion.
- Finding + repair history remains visible after resolution.
- No infinite loop: `repairIterationsUsed > maximumRepairIterations` sets
  `limitExceeded`, which blocks verified completion.

## Competitive demo flow

Review attempt 1 → `changes_required` with **F-1 IPv6 /128 rotation bypass**
(high). Relay creates finding F-1 and repair R-1 (scope-locked, iteration 1).
Claude claims the repair complete → F-1 stays open. Relay re-runs the 6
checks (all pass) → re-review (attempt 2) approves → F-1 resolved by re-review
with evidence → verified completion. All SIMULATED; the external Codex
connection is not active.

## Boundary + security

The mission module never mutates FileClaims, promotes evidence, resolves
findings on behalf of an agent, or decides completion outside these
deterministic rules. Adapters cannot resolve findings or promote evidence
(boundary-tested). No secrets are stored.
