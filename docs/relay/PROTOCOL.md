# Relay Protocol — `relay.protocol.v1` (specification)

> **Implementation sync (Prompt 8.3, 2026-07-22):** the live Codex reviewer
> adds normalized event kinds only (additive): `reviewer.dispatch_requested`,
> `reviewer.live_approval_recorded`, `reviewer.process_started`,
> `reviewer.initialization_verified`, `reviewer.session_created`,
> `reviewer.activity_observed`, `reviewer.diff_inspection_observed`,
> `reviewer.evidence_inspection_observed`, `reviewer.report_received`,
> `reviewer.process_completed`/`_failed`/`_timed_out`/`_cancelled`,
> `reviewer.output_malformed`, `reviewer.attestation_created`,
> `reviewer.finding_created`, `reviewer.verdict_accepted`/`_rejected`, and the
> `output.held_for_review`/`output.revision_required`/`output.approved_for_
> release` visibility events. Reviewer events carry provenance `live` and
> classification `unverified-claim`. The `RELAY_REVIEW_REPORT_V1` report is a
> module-local serializable claim validated inside Relay (ids/revisions/
> workspace-revision must match; secret + hidden-reasoning content rejected) —
> never a stored credential or stream. The Reviewer Execution Attestation
> reuses the Prompt-8.1 attestation shape.

> **Implementation sync (Prompt 8.2, 2026-07-22):** Mission Control adds NO
> new protocol envelopes, commands, or event kinds. Modes, credential handles,
> the dog activity, the terminal read model, entitlement, and output
> visibility are module-local SERIALIZABLE read-model PROJECTIONS in
> `src/relay/mission/` derived from existing canonical contracts + the
> append-only event ledger. Mode escalation consent and boundary stops are
> policy values, not envelopes. Dog speed, terminal ordering, and output
> visibility are pure functions of the existing event stream. A CredentialHandle
> is a reference (names/scopes/policy) and by construction carries no credential
> value; provenance reuses the existing `simulated`/`live` values.

> **Implementation sync (Prompt 8.1, 2026-07-23):** the competitive proof
> layer adds NO new protocol envelopes, commands, or event kinds. The
> mission structures (RelayMissionContract, RelayExecutionAttestation,
> RelayReview/Finding/Repair, MissionVerdict, TimelineEntry) are module-local
> SERIALIZABLE read-model PROJECTIONS in `src/relay/mission/contracts.ts`,
> derived from existing canonical contracts + the append-only event ledger.
> Attestation and verdict provenance reuse the existing `simulated`/`live`
> provenance; identity separation (requested vs actual) is a projection over
> handoff/assignment/audit identities, never a stored credential.

> **Implementation sync (Prompt 8, 2026-07-23):** the live Claude Code
> adapter adds `agent.*` event kinds only (live_dispatch_requested,
> live_approved, process_started, initialized, activity_observed,
> process_completed, process_failed, process_timed_out, process_cancelled,
> session_resume_requested, malformed_output) — all `provenance: live`,
> source `coding-agent`/`relay-core`/`system`, classification
> `unverified-claim` for agent activity. The Agent Execution Report is a
> module-local marker schema (`RELAY_AGENT_EXECUTION_REPORT_V1`), parsed
> strictly and treated as an unverified claim; Relay workspace inspection is
> the authoritative changed-path source. Claude session ids are stored as
> plain strings with association only — never credentials. No new command
> types or envelope contracts were required.

> **Implementation sync (Prompt 7, 2026-07-22):** workspace foundation
> contracts live in `src/relay/workspace/contracts.ts` (module-local, not
> yet protocol-envelope types — they cross no external boundary this
> phase). Additive protocol deltas: event taxonomy gained the `workspace.*`
> family (validated / created / reused / inspected / source_changed /
> change_flagged / command_started / command_completed / command_rejected /
> cancelled / preserved / cleaned / cleanup_refused) and `EventRefs` gained
> `workspaceId` (the existing `wsp_` prefix). Workspace events/evidence are
> the first `provenance: live` producers — live LOCAL infrastructure,
> distinguished from simulated agents and from future live provider
> execution by verifier identity `relay-workspace`.

> **Implementation sync (Prompt 6.1, 2026-07-22):** Manual Task checkpoints
> are implemented in `src/relay/core/manual-task.ts` on the EXISTING
> checkpoint architecture (no second checkpoint state or engine). Additive
> deltas: id prefixes `mtk_` (ManualTask) + `mrq_` (ManualActionRequest);
> `Checkpoint` gained optional `manualTask` (the canonical, core-compiled
> user-facing task — one active per run via the single checkpoint slot);
> command set gained `respond-manual-task {done|help|cannot}` (cancel stays
> the canonical `cancel-run`); event taxonomy gained the `manual.*` family
> (action_requested / request_validated / request_rejected / task_created /
> response_recorded / verification_started / verification_passed / _failed /
> _unavailable / task_completed / task_cancelled); run-machine intents
> gained `record-manual-verification` and `raise-checkpoint` accepts the
> compiled task; FinalAuditReport gained optional `manualTasks[]`.
> ManualActionRequests are UNTRUSTED adapter input: shape-gated by
> `checkManualActionRequest`, semantically validated + compiled by Relay
> Core only (adapters can ask for help, never publish user instructions).
> Done is a claim — Relay verification (or explicit operator confirmation
> when verification is unavailable) decides completion and resume.

> **Implementation sync (Prompt 4, 2026-07-22):** the simulation harness and
> orchestrated vertical slice are implemented in `src/relay/connectors`
> (ports + four deterministic simulation adapters, provenance `simulated`
> hard-wired) and `src/relay/core/orchestrator.ts` (bounded step engine).
> Additive deltas: run-machine intent `raise-checkpoint` (core-raised
> checkpoints for budget stops, adapter failures, unsatisfied completion);
> RelayStores gained `commands` + `audits`; FinalAuditReport gained the
> optional Prompt-4 audit-detail fields (identities, sessionRefs, package/
> report refs, ownership history, claim promotions, completionReason, and
> the mandatory-when-not-live `simulationNotice`). Handoff ledger staleness
> is judged against the last CANONICAL-affecting version (historical
> bookkeeping events — incl. a package's own handoff.created — never
> invalidate it; canonical decisions/promotions do), surfaced as
> `lastCanonicalLedgerVersion` on the eligibility input. Reviewer
> "insufficient evidence" maps to `changes_requested` + an
> `insufficient-evidence` finding (the verdict enum is unchanged).

> **Implementation sync (Prompt 3, 2026-07-21):** the coordination layer is
> implemented in `src/relay/{coordination,handoff,verification,recovery}`.
> Additive contract deltas: Role enum gained `security-reviewer` +
> `operations`; RelayTask gained `equivalenceKey` (structured dedup key —
> Relay makes NO semantic-equivalence claims) and `revisionOf`; FileClaim
> gained `mode: read|write` (read=shared, write=exclusive) and ResourceClaim
> `mode: exclusive|shared`; AgentHandoffPackage gained required
> `baseRevision` + `createdAt` and optional `expiresAt`/`correlationId`;
> RevisionContract gained the optional narrow-repair payload (evidence refs,
> allowed/protected files, behaviorToPreserve, verification to rerun, budget
> remaining, pinned versions); CompletionPolicy gained `acceptedProvenance`
> (absent = live-only — a live policy never silently accepts simulation
> evidence) and `allowedVerifiers`; BudgetPolicy gained `warningAtFraction`
> + `missingEstimate: allow|checkpoint|deny`; event kind
> `architect.revision_created` added. Structured decisions
> (DuplicateWorkDecision, DependencyDecision, DispatchEligibilityResult,
> CompletionPolicyResult, BudgetDecision, AutomaticRepairDecision,
> RepeatedFailureDecision, NoProgressDecision, RecoveryDecision) are
> implementation types in those modules.

> **Implementation sync (Prompt 2, 2026-07-21):** the Prompt-2 contracts
> below are now implemented in `src/relay/protocol` (envelopes, ids, enums,
> validators), `src/relay/core` (run/task machines), `src/relay/ledger`
> (append/projection/promotion), `src/relay/storage` (ports + volatile
> test adapters). Implementation deltas, all additive: command set gained
> `dispatch-task` and `dispatch-revision` (the run-internal EXECUTE/APPLY
> intents) and `cancel-run` requires a `reason`; the event `kind` taxonomy
> is formalized as dotted categories (`run.* architect.* handoff.* agent.*
> reviewer.* verification.* ledger.* task.* file_claim.* usage.* budget.*
> policy.* audit.*` — the §3.1 names map to `ledger.claim_recorded` /
> `ledger.claim_promoted` / `ledger.claim_rejected`); events carry a
> required `safeSummary`; ids gained `art_ ses_ wsp_` prefixes; the
> prompt-level `live_local`/`live_cloud` provenance aliases are represented
> as provenance `live` + a `dispatchPath` field on usage records (Decision 1
> keeps the pipes structurally separate). Unknown envelope fields are
> rejected (strict schemas); unknown external data survives only in
> designated `metadata` fields; hidden-reasoning fields are rejected on all
> untrusted payloads.

> Status: **locked for implementation** (Phase 1 architecture lock,
> 2026-07-21). This document SPECIFIES contracts; nothing here is implemented
> yet. "Prompt 2" marks contracts implemented by *Prompt 2 — Relay Protocol,
> Domain Model, and Deterministic Run State Machine*; later work is marked
> "deferred (Prompt N/phase)". Runtime schema validation is part of Prompt 2
> for every Prompt-2 contract (hand-rolled validators per repo convention —
> no schema dependency).

## 0. Conventions

- **Ids** are opaque strings with stable prefixes: `prj_ run_ tsk_ pkg_ evt_
  evd_ bnd_ rpt_ blu_ vrf_ flr_ dcn_ apr_ oqn_ use_ aud_ clm_ asn_ dsg_
  pol_ hcr_ ckp_`. Exempt from the prefix convention: client-generated
  `commandId` and `queryId` (any unique string; the server treats them as
  opaque correlation values).
- **Timestamps** are ISO-8601 UTC.
- **`protocolVersion`** (`"relay.protocol.v1"`) appears in every envelope.
  Versioning behavior: additive optional fields do not bump the version;
  removed/retyped fields or changed semantics bump to `v2` with a migration
  note here. Consumers reject unknown protocol versions.
- **Enums** (shared, Prompt 2):
  - `Provenance = simulated | live | imported | manual` — how an activity or
    artifact actually originated. Never inferred, always stamped by the
    producer and preserved end-to-end (truthfulness requirement).
  - `Classification = canonical | historical | derived | external-artifact |
    unverified-claim | verified-evidence` — System 1 six-way taxonomy.
  - `Enforcement = enforced | advisory | unsupported` (Decision 5).
  - `Role = architect | coding-agent | reviewer | verification`.
  - `RunStatus = created | active | paused | checkpoint_required | completed
    | failed | cancelled`.
  - `RunPhase = blueprint | handoff | implementation | verification | review
    | repair | final_verification | final_review | audit`.
  - `TaskStatus = proposed | queued | assigned | working | waiting |
    reviewing | revision_required | blocked | checkpoint_required |
    completed | failed | cancelled | obsolete`.
  - `EvidenceStatus = passed | failed | pending | unavailable | unverified |
    requires_approval`.
- **Validation boundary**: every envelope crossing a boundary (client → core,
  adapter → core, import → core) is schema-validated at relay-protocol; agent
  and imported content is additionally TRUST-validated by relay-core
  (promotion, §3). Schema-valid ≠ accepted.
- **`ledgerVersion` vs `contextVersion`**: `ledgerVersion` on a package/
  record = the project ledger version at compile/append time.
  `contextVersion` = the ledger version at which the entity's CONSUMED
  context was selected. Both are assigned by the producing module
  (relay-handoff for packages, relay-core for tasks). They are equal in the
  sequential MVP and diverge only when compilation deliberately pins an
  earlier context snapshot.

## 1. Envelopes (all Prompt 2)

### 1.1 CommandEnvelope — client/CLI → relay-core
Required: `protocolVersion, commandId, commandType, issuedAt, actor
{kind: user|client|system, id}, payload`.
Optional: `idempotencyKey` (dedupe window; same key → same result),
`correlationId`, `expectedLedgerVersion` (optimistic concurrency — command
rejected with `ledger-version-conflict` if the ledger moved).
Producer: clients. Consumer: relay-core only. Commands never mutate state
directly; accepted commands emit events.
Command types (MVP set): `create-project, create-run, submit-objective,
import-blueprint, accept-blueprint, compile-handoff, submit-report (manual
import path), request-verification, pause-run, resume-run, cancel-run,
respond-checkpoint {approve|reject}, answer-open-question, set-budget,
assign-agent, approve-completion`.

### 1.2 EventEnvelope — relay-core/ledger → everyone (the ONLY UI/CLI feed)
Required: `protocolVersion, eventId, sequence, at, projectId, source
(relay-core | architect | coding-agent | reviewer | verification | system |
user), kind, provenance, classification, payload`.
Optional: `runId, taskId, correlationId (causing command/report), refs
{ledgerVersion, contextVersion, packageId, evidenceIds[], blueprintId, ...}`.
- `sequence` is the **monotonic per-project ledger version** — gap-free,
  assigned only by relay-ledger on append. `ledgerVersion` of a project ==
  highest appended `sequence`.
- Events are **append-only**; there is no delete/update event mutation.
  Supersession/obsolescence is expressed by NEW events.
- Payloads are **typed per kind** (no prose-only events). Human-readable
  terminal lines are DERIVED at render time by clients from kind+payload.
Producer: relay-ledger (sole appender), on behalf of relay-core decisions.
Consumer: clients, projections, audit.

### 1.3 ReportEnvelope — adapter/import → relay-core
Required: `protocolVersion, reportId, projectId, runId, reportType
(blueprint | implementation | review | repair | verification-output),
agentIdentity {adapterId, role, displayName, sessionRef?}, provenance,
submittedAt, payload`.
Required for every reportType EXCEPT `blueprint`: `taskId, packageId (the
handoff being answered)`. Blueprint reports are RUN-level: no task exists
yet (the task derives from the accepted blueprint — §2.3 phase order), so
they bind to `runId` + a run awaiting its blueprint; an imported blueprint
binds the same way via the `import-blueprint` command.
Optional: `usage {estimated|actual tokens/cost}, notes`.
- **Always ingested as `classification: unverified-claim`.** `agentIdentity`
  is assigned by the ADAPTER/session layer, never trusted from report text
  (Decision 3). `sessionRef` is an opaque safe reference — never a
  credential.
- Binding: for task-level reports, `packageId` + `taskId` must match an
  outstanding package (carries forward the prototype's cross-mission
  rejection); for blueprint reports, `runId` must match a run in the
  `blueprint` phase.
Producer: connectors (incl. manual-import path). Consumer: relay-core.

### 1.4 Query / ReadModel envelopes — client → relay-core (read-only)
Query: `{protocolVersion, queryId, queryType, params}`. ReadModel response:
`{protocolVersion, queryId, readModelType, asOfLedgerVersion, data}`.
Read models (MVP): `project-brain, run-status, task-detail, handoff-detail,
evidence-detail, event-feed (paged), usage-summary, audit-report`.
Clients contain no workflow logic (Decision 9): read models are computed by
relay-core/projections and returned serialized.

### 1.5 ErrorEnvelope
`{protocolVersion, code, message, details[], retryable, correlationId}`.
Codes are stable strings (`ledger-version-conflict`, `illegal-transition`,
`duplicate-task`, `stale-context`, `budget-exceeded`, `validation-failed`,
`checkpoint-required`, `not-found`, `immutable`, ...).

## 2. Ledger & run contracts

### 2.1 RelayProject (Prompt 2)
Required: `projectId, name, createdAt, objective (current), ledgerVersion`.
Optional: `repository {path, defaultBranch}, constraints[], securityNotes`.
Producer: `create-project`. Consumer: everything. The project OWNS the
ledger; agents/providers never do.

### 2.2 ProjectLedger (Prompt 2)
The append-only sequence of EventEnvelopes for a project plus the
**current-state projection** derived from canonical events only. Required
behaviors: gap-free monotonic `sequence`; projection rebuildable from events
alone; six-way classification on every event; claims NEVER enter the
projection until promoted (§3). Storage engine is deferred to the
persistence prompt (relay-storage — after the simulation harness and CLI;
see CURRENT_STATE.md); Prompt 2 uses an in-memory ledger behind the same
repository interface.

### 2.3 RelayRun (Prompt 2)
Required: `runId, projectId, createdAt, status: RunStatus, phase: RunPhase,
objective, mode ("guided" only in MVP), taskIds[], budget {maxUsd?,
maxTokens?, maxRuntimeMs?}, repairCount (0|1), provenanceProfile
(simulated | live | mixed)`.
Optional: `pausedAt, completedAt, checkpoint {id, reason, requestedAt},
finalAuditId`.
State machine (Prompt 2, deterministic, illegal transitions rejected):
- `created → active(blueprint)`; phases advance strictly:
  `blueprint → handoff → implementation → verification → review →
  [completed-path | repair → final_verification → final_review] → audit`.
- `active ↔ paused` (user); any state except terminal → `cancelled` (user);
  `active → checkpoint_required` (core decision) → `active` (approve) |
  `failed/cancelled` (reject); terminal states (`completed, failed,
  cancelled`) are frozen — post-terminal commands rejected `immutable`.
- `repairCount` may never exceed 1 (Decision 4); the transition
  `review → repair` requires ALL Guided-Mode auto-repair conditions
  (RELAY_MVP_SPEC §Guided Mode) else `checkpoint_required`.
- **`blocked` mapping:** RunStatus has no `blocked` value. When the run's
  task enters task-level `blocked`, the run transitions to
  `checkpoint_required`; the Final Audit Report outcome (§5.4) may still be
  `blocked` to describe WHY the run stopped. Founder Decision 4's "stop at
  checkpoint_required, blocked, or failed" reads as: run status
  `checkpoint_required` or `failed`, with task status / audit outcome
  carrying `blocked`.
- **`provenanceProfile` is derived, never client-set:** `simulated` when
  every non-user-command activity in the run carries provenance
  `simulated`; `live` when every such activity is `live`; otherwise
  `mixed` (any `imported`/`manual` content, or any mixture, yields
  `mixed`). Human commands/approvals do not count as activity. The MVP's
  first real workflow (imported Blueprint + live agents) is therefore
  `mixed` and rendered as such.

### 2.4 RelayTask (Prompt 2)
Required: `taskId, projectId, runId, objective, category, status: TaskStatus,
ownerAssignmentId | null, dependencies[], claimedFiles[], acceptanceCriteria[],
completionPolicyId, contextVersion, baseRevision (git rev the task is
grounded on), createdAt, updatedAt, priority`.
Optional: `leaseExpiresAt, supersededBy, completionEvidenceRefs[],
claimedResources[]`.
Pre-execution checks (Prompt 2, relay-coordination): duplicate active task,
equivalent task, already completed, superseded, dependencies incomplete,
files unclaimed/conflicting, stale `contextVersion` (< current
ledgerVersion for consumed state), `baseRevision` no longer current, lease
expired, assignment/session invalid, **newer accepted decision invalidates
the task** (a DecisionRecord accepted after the task's `contextVersion`
that conflicts with its objective/constraints → error
`invalidated-by-decision`). Each failure → typed ErrorEnvelope + event.
Lease semantics: `leaseExpiresAt` set on assignment; expiry emits
`task-lease-expired` and returns the task to `queued` (crash recovery — no
permanent locks). One owner at a time, enforced.

### 2.5 TaskAssignment (Prompt 2)
Required: `assignmentId, taskId, role, adapterId, assignedAt, provenance`.
Optional: `sessionRef (opaque), leaseExpiresAt, endedAt, endReason`.
Reviewer-independence is STRUCTURAL: independence checks compare
`TaskAssignment.adapterId`/session lineage, not report-body strings
(Decision 3). Producer: relay-routing (manual/default assignment in MVP).

### 2.6 FileClaim / ResourceClaim (FileClaim Prompt 2; ResourceClaim schema-only Prompt 2, enforcement deferred)
Required: `claimId, taskId, path|resource, claimedAt, expiresAt, status
(active | released | expired)`.
Claims expire and recover; enforcement level is declared per adapter
(Decision 5): advisory in manual/simulated paths, enforced by the worktree
manager for local live adapters (deferred phase).

## 3. Claims, promotion, evidence

### 3.1 Claim promotion (Prompt 2 — the trust boundary)
Every ReportEnvelope ingest emits `claim-recorded` (classification
`unverified-claim`). ONLY relay-core may emit `claim-accepted` /
`claim-rejected`. Acceptance criteria come from CompletionPolicy + the
specific claim type (e.g. an implementer's "findings resolved" claim is
accepted only when re-verification evidence + required re-review support
it). Accepted content is re-emitted as canonical/verified events; the
original claim remains in history untouched. **No agent report ever mutates
the projection directly.**

### 3.2 EvidenceRecord (Prompt 2)
One observed check result, produced by relay-verification (never by the
agent under evaluation).
Required: `evidenceId, taskId, runId, source (relay-verification adapter id),
evidenceType (command | diff | artifact | reviewer-verdict | health-check),
command?, exitCode?, outputExcerpt, executedAt, environment {os, node,
cwd}, repoRevision, verificationStatus: EvidenceStatus, verifier,
provenance`.
Optional: `artifactRef, integrity {sha256?, sizeBytes?}, expiresAt`.
Agent-submitted command lists (prototype pattern) are stored as
`unverified-claim` report content — they are NOT EvidenceRecords.
Freshness = `repoRevision` + `executedAt`, never ingestion time.

### 3.3 EvidenceBundle (Prompt 2)
Required: `bundleId, taskId, runId, evidenceIds[], collectedAt,
overallStatus: EvidenceStatus, repoRevision`.
A bundle is coherent: all records pinned to the same `repoRevision` (or the
bundle is `unverified`).

### 3.4 VerificationRecord (Prompt 2)
Result of evaluating an EvidenceBundle against a CompletionPolicy.
Required: `verificationId, taskId, runId, policyId, bundleId, at, outcome
(passed | failed | pending | unavailable), checks[] {id, label, status:
EvidenceStatus, detail}`.
Represents pass AND fail — failed verifications are recorded events feeding
`revision_required / checkpoint_required / blocked`, never discarded.
(Prototype's success-only record is explicitly corrected.)

### 3.5 CompletionPolicy (Prompt 2: low-risk preset + interface; high-risk documented only)
Required: `policyId, riskLevel (low | high), requiredEvidence[]
{evidenceType, command?, mustPass}, requiresIndependentReview (bool),
requiresHumanApproval (bool), enforcementRequirements[] {control,
minimumLevel: Enforcement}`.
Low-risk preset (MVP): targeted checks + typecheck pass, expected diff
exists, independent review required, no human approval. High-risk preset:
documented shape only (needs deployment/migration evidence types that do
not exist in MVP; `unavailable` blocks completion when required).

### 3.6 ReviewerVerdict (Prompt 2)
Required: `reportId (source), reviewerAssignmentId, verdict (approved |
changes_requested), findings[] {id, severity (critical|major|minor), title,
detail, recommendation?}, independent (bool — computed by relay-core from
assignments, never self-declared), provenance`.
`changes_requested` with zero findings is invalid (carried from prototype
R2). Manual/imported reviews carry `provenance: manual|imported` and are
labeled as such; they satisfy an independent-review policy only if the
policy admits manual review (Decision 3).

## 4. Blueprint & handoff contracts

### 4.1 Blueprint artifact (Prompt 2)
The Prompt Architect's output (Decision 2).
Required: `blueprintId, projectId, runId, version (int, per run), source
(simulated | imported | live-adapter), architectIdentity {adapterId?,
displayName, sessionRef?}, submittedAt, content {objectiveRestatement,
approach, taskBreakdown[], acceptanceCriteria[], risks[], constraints[]},
provenance`.
Imported blueprints (ChatGPT/founder-authored) are UNTRUSTED external input:
schema-validated, recorded as `external-artifact`, and promoted to canonical
only via `accept-blueprint` (a human command in Guided Mode). No provider
hardcoding in the contract.

### 4.2 AgentHandoffPackage (Prompt 2)
Required: `packageId, protocolVersion, projectId, runId, taskId,
targetAdapterId, role, objective, responsibilityBoundary, contextRefs[]
(ledger refs, artifact refs — references not embeddings), requiredInputs[],
permittedTools[] {name, enforcement}, permittedFiles[] {pattern,
enforcement}, prohibitedActions[] {action, enforcement}, dependencies[],
acceptanceCriteria[], requiredEvidence[], budget {maxUsd?, maxTokens?},
stoppingCondition {deadline?, maxRuntimeMs?, description}, expectedReportType,
contextVersion, ledgerVersion, idempotencyKey`.
Every restriction carries its Enforcement level explicitly (Decision 5) —
the compiler must not emit a restriction without one.

### 4.3 HandoffCompilationRecord (Prompt 2)
Required: `recordId, packageId, compiledAt, ledgerVersion, contextVersion,
inputRefs[] (exact ledger events/artifacts consumed), compilerVersion`.
Makes every package reproducible/auditable.

### 4.4 Revision Contract (Prompt 2)
The single bounded repair instruction (Decision 4).
Required: `packageId (new package), parentPackageId, findingsTargeted[]
(ReviewerVerdict finding ids), narrowScope {sameTask: true, sameFiles:
true, sameAssignment: true}, conditionsChecked[] {condition, satisfied}` —
all 15 Guided-Mode conditions recorded with their evaluation at compile
time. If any is false the contract is not compiled; run →
`checkpoint_required`.

## 5. Failure, disagreement, usage, audit

### 5.1 FailureRecord (Prompt 2)
Required: `failureId, taskId, runId, at, signal (repeated-command-failure |
repeated-test-failure | no-progress | agent-blocked | session-unavailable |
tool-unavailable | budget | other), attempts[] {at, packageId, summaryRef},
commandRefs[], evidenceRefs[], constraintsSnapshot[], stoppingCondition`.
Carries the raw material a future FailureRecoveryPackage compiles from
(recovery compilation itself deferred). Repeated-identical-failure and
no-progress detection are Prompt-2 deterministic functions over these
records.

### 5.2 DisagreementRecord (schema-only Prompt 2; engine deferred)
Required: `disagreementId, projectId, taskId?, participants[], proposals[]
{by, summary, evidenceRefs[]}, category, risk, decisionAuthority, status
(open | resolved | escalated)`.
Optional: `resolutionMethod, finalDecisionRef`.

### 5.3 Usage record (Prompt 2)
Required: `usageId, runId, taskId?, adapterId, at, kind (estimated |
actual), tokens?, usd?, runtimeMs?`.
Budget/stop-before-dispatch checks are computed over these (relay-core;
enforcement wiring deferred to the checkpoint/cost phase). Cloud dispatch
additionally passes SpendAuthorizationPort (ARCHITECTURE §hybrid; Decision 1)
— both the Relay budget AND the Sunday global breaker must approve.

### 5.4 Final Audit Report (Prompt 2)
Required: `auditId, runId, projectId, at, outcome (verified-complete |
failed | cancelled | blocked), objective, blueprintRef, taskRefs[],
verificationRefs[], reviewRefs[], repairCount, evidenceBundleRefs[],
usageSummary {estimatedUsd?, actualUsd?, tokens?}, checkpoints[]
{id, reason, response}, provenanceProfile, unresolvedQuestions[]`.
Producer: relay-verification (final audit step). Consumer: clients (the
"one verified completion report"), ledger (canonical). An audit can record
failure — it is not a success certificate.

### 5.5 DecisionRecord / ApprovalRecord / OpenQuestion (Prompt 2, minimal)
DecisionRecord: `decisionId, at, title, decision, rationale,
rejectedAlternatives[], decidedBy, supersededBy?`.
ApprovalRecord: `approvalId, checkpointId, runId, at, actor, response
(approve | reject), note?`.
OpenQuestion: `questionId, at, question, raisedBy, status (open |
answered), answerRef?`.

## 6. Deferred contracts (documented here, NOT in Prompt 2)
`AgentProfile` (schema lands with relay-routing manual assignment — Prompt 2
carries a static minimal form: `adapterId, provider, roles[], displayName`),
`AgentCapabilityObservation`, `ComputeResource`, `SubscriptionCapacity`,
`AqualaSkill`, `SkillCompilationTarget`, `FailureRecoveryPackage`,
`DeploymentRecord`, `ProjectSnapshot` (interface reserved; audit report is
NOT a snapshot), session/workspace repositories (relay-storage phase),
`ProjectRequirement` and `ArchitectureRecord` (documented-future — land
with the ledger-enrichment/persistence prompt; in the MVP their sufficient
subset is carried by `RelayProject.constraints[]`, `DecisionRecord`, and
the accepted Blueprint's content — the ledger's System-1 record list is
satisfied without dedicated entities until then).

## 7. Ownership summary

| Contract | Producer | Sole mutator | Validated at |
| --- | --- | --- | --- |
| Commands | clients | — (immutable) | relay-protocol |
| Events | relay-ledger | append-only | relay-protocol |
| Reports | connectors/import | — (immutable claims) | relay-protocol + relay-core promotion |
| Run/Task state | relay-core | relay-core | state machine guards |
| Evidence | relay-verification | relay-verification | relay-protocol |
| Promotion | relay-core | relay-core | CompletionPolicy |
| Audit | relay-verification | append-only | relay-protocol |
