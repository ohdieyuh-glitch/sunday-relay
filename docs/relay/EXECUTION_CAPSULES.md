# Per-Agent Execution Capsules — Mission Operations Milestone 3

Status: implemented (deterministic, browser-safe, **no live agent integration**)
Module: `src/relay/mission/execution-capsules/`
Tests: one `*.test.ts` per module, plus `capsule-scenarios.test.ts` (the ten
required fixtures A–J end-to-end) and `capsule-boundary.test.ts` (zero external
activity, asserted at the source level)

## Purpose

One agent run currently scatters its story across prompts, terminal output,
provider sessions, tool logs, shell logs, file changes, worktrees, branches,
commits, test results, findings, approvals, costs, and reports. A capsule is
the single coherent record that answers, long after the session is gone: what
was this run responsible for, which revisions and handoff did it receive, who
was requested, who actually ran, was that launch independently verified, under
which permissions and workspace, what did it touch, what did it claim, what
supports the claim, and what did it cost.

**One capsule per run.** The repository enforces unique capsule ids AND unique
run ids; a retry or reassignment is a NEW run with a NEW capsule, never a
rewritten history.

## Requested versus actual identity

The capsule's `identity` is a DISCRIMINATED UNION, not a bag of optional
fields:

| state | meaning |
| --- | --- |
| `requested` | Relay knows what it intends to launch. Nothing has started. |
| `launch_requested` | A launch was attempted; no trusted source has confirmed activity. |
| `launch_failed` | A trusted source proved the requested runtime did NOT become active. |
| `verified` | A trusted source observed this actual runtime running. |
| `fallback_unauthorized` | Something else ran, and policy did not authorize it. |

`actual` exists only inside `verified`, so a wrapper response, a report, or a
sentence claiming "Codex reviewed this" cannot populate it — there is no code
path that accepts an actual identity without a trusted attestation. An
unauthorized fallback is its own state precisely because it must stay visible
forever and can never reach `running` (`UNAUTHORIZED_FALLBACK`). Requested and
actual are never silently reconciled: a differing actual identity MUST be
recorded as a fallback, and an identical one may not claim to be a fallback.

Identity comparison is by EXECUTION IDENTITY, so a fresh session of the same
runtime is the same party — the property reviewer independence depends on.

## Launch attestation boundary

`RelayExecutionLaunchAttestation` is the capsule-scoped record that a trusted
supervisory source (`relay_supervisor`, `trusted_adapter`, `workspace_monitor`)
observed a launch. An agent may never attest its own launch
(`AGENT_SELF_ATTESTATION_FORBIDDEN`, enforced on both the requested and the
observed identity). A verified attestation must name a source, an observed
identity, and a verification time that does not precede the request.

**This milestone creates no production attestations.** Everything here is a
domain/fixture record. Real attestations must later be emitted by a trusted
supervisory or adapter layer that independently observed the process.
`adaptProductionExecutionAttestation` reads the existing production
`RelayExecutionAttestation` (`src/relay/mission/contracts.ts`, built by
`src/relay/mission/attestation.ts`) into the capsule-scoped shape without
copying it into the capsule and without inventing anything it does not assert —
an unverified production record yields no actual identity.

## Responsibility, revision, handoff, and policy binding

Fixed at preparation and immutable for the life of the run: project, mission,
task, run, responsibility, mission revision, task revision, handoff id, handoff
compiler version, policy-pack version, and passport id. Revisions must be
positive integers; a missing handoff, policy, or passport reference rejects
preparation. The repository refuses any replacement whose binding drifted
(`RESPONSIBILITY_REVISION_MISMATCH`), including a silent workspace switch, so a
final report always stays attributable to the revision the agent actually
received. A new revision needs a new run — supersession modelling belongs to a
later milestone.

## Permission snapshot and workspace binding

The permission snapshot captures the EFFECTIVE permissions at preparation plus
the policy version they came from, reusing the Milestone 2
`CommandPermissionContext` shape rather than starting a second permission
system. Secret VALUES are never present (`secretPolicy` records the category
only). Later expansion or revocation never rewrites the snapshot — it arrives
as a permission trace reference, so the capsule always shows which policy was
active while the run executed. Reviewer capsules are read-only; a repair
assignment carries no review authority.

Workspace binding is required for file-changing responsibilities
(`WORKSPACE_REQUIRED`), refuses a read-only workspace for them
(`WORKSPACE_INCOMPATIBLE`), rejects concurrent write ownership at preparation
(`WRITE_OWNER_CONFLICT`), keeps CLI and browser worktrees structurally
distinguishable, and cannot be switched after preparation. `baseCommitSha`
mirrors the canonical `RelayWorkspace.sourceRevision` pin. No real worktree is
created, inspected, or transferred; `ophiuchusExecutionRef` is reserved.

## Lifecycle and status

`prepared → starting → running`, with `waiting`/`stalled` as recoverable
activity states, and five terminals: `completed`, `failed`, `cancelled`,
`timed_out`, `orphaned`.

- **stalled** — no sufficient progress or heartbeat within the configured
  threshold; still alive, evaluated against an INJECTED clock, and recoverable.
- **timed_out** — a runtime or heartbeat deadline was exceeded.
- **orphaned** — Relay can no longer prove control of, or communication with, a
  previously active external process. Nothing is inferred about what the agent
  did after contact was lost.

Terminal capsules are immutable (`TERMINAL_CAPSULE_IMMUTABLE`) and never return
to running; a retry is a new run. The single deliberate exception is
cost-receipt attachment, because economics receipts reconcile after a run ends
(Milestone 5). Every operation is a named service function with its own
preconditions — there is no generic setter — and a rejected operation leaves
the previous capsule byte-for-byte unchanged.

## Reports, claims, and evidence

Four distinct things, deliberately never merged:

- **partial output** — recoverable work captured before completion,
  cancellation, failure, timeout, or intervention (preserved by all four);
- **final report** — the actual agent's structured report; an agent claim, and
  not proof that any command or test ran;
- **completion claim** — "I finished"; an agent claim, never verification;
- **Relay evidence / review results** — collected by supervisory systems and
  referenced by id.

A run whose launch was never verified can hold neither a report nor a claim, so
a failed launch cannot receive a fabricated final report. Completion requires a
final report unless policy explicitly waives it (`FINAL_REPORT_REQUIRED`).
Evidence and cost-receipt ids are unique per capsule and always attributable to
the run that produced them.

**Review credit** requires a verified actual reviewer identity AND a completed
run: an unlaunched reviewer, a wrapper, an unauthorized fallback, and an
orphaned or cancelled review all earn nothing. An authorized fallback credits
the agent that ACTUALLY reviewed, never the one that was asked. Whether a
review's findings still apply to the CURRENT artifact remains Milestone 1/2
stale-review territory and is deliberately not decided here.

## Cost references

Only ids. No pricing lookup, no aggregation, no estimation, no provider billing
call. A run with no receipt is `pending` — explicitly unknown, **never $0**.
Totals arrive with Mission Economics (Milestone 5).

## Trace references

Ordered, deduplicated, redacted POINTERS into ten channels (prompt, tool,
command, permission, file, process, review, approval, errors, warnings). A
duplicate event id is rejected across ALL channels. An `agent_report` source is
always `unverified` — an agent cannot certify itself — and an agent can never
emit a trusted supervisory event about itself. No reference may claim
`verified` integrity and no capsule may claim verified trace integrity: nothing
hash-chains anything yet, so `traceIntegrityStatus` stays `not_evaluated`.

## Milestone 1 execution mapping

`projectCapsuleExecutionStatus` maps capsule status onto the Milestone 1
EXECUTION dimension only: `prepared→not_started`, `starting→starting`,
`running→running`, `waiting→waiting`, `stalled→waiting`,
`completed→completed`, `failed→failed`, `cancelled→cancelled`,
`timed_out→failed`, `orphaned→failed`.

Capsule completion does **not** set outcome satisfied, does **not** set
verification approved or verified, and does **not** set release eligible. A
finished process is not a satisfied mission. Reviewer capsule completion does
not grant review credit without a verified identity, and never produces a
verdict. Milestone 1 remains authoritative for outcome, verification, and
release; this milestone provides a PROJECTION and mutates no mission status.

## Milestone 2 command integration boundary

Typed and documented here; **the Milestone 2 command executor is not changed.**

| command | capsule effect (future wiring) |
| --- | --- |
| START | prepare a new capsule and request launch |
| PAUSE | running → waiting, after the checkpoint capture exists |
| RESUME | waiting → running while the verified process remains valid |
| CANCEL | preserve partial output, append references, mark cancelled |
| REASSIGN | create a NEW capsule for the replacement — never rewrite the old actual identity |
| RETRY | create a NEW run and capsule linked to the prior failed one |

Adapter and orchestrator integration belongs to Milestone 8.

## What is deterministic / mock here

Everything. Zero provider calls, zero network, zero process control, zero
database, zero environment access, zero clock reads — ids and timestamps are
caller-supplied, exactly as in Milestones 1 and 2. `capsule-boundary.test.ts`
asserts this at the source level, including the import allowlist: the domain
reaches only `../status/status-model`, `../contracts`, `../terminal`,
`../commands/command-context`, and `../commands/command-events`.

Current limitations, stated plainly:

- the repository is **in-memory and non-production**; durable capsule storage
  is future work;
- there are **no production launch attestations** — fixtures and domain
  validation only;
- there is **no hash chaining** and no proven trace integrity;
- there is **no live agent integration** and no Agent Run interface.

## Future integration boundaries

- **Milestone 4 — Aquala Trace**: the ledger owns the events these references
  point at, adds hash chaining and durable append-only storage, and takes over
  full reconstruction; `capsule-reconstruction.ts` deliberately does only
  snapshot validation and operation replay until then.
- **Milestone 5 — Mission Economics**: cost receipts gain amounts, aggregation,
  and budget behaviour.
- **Milestone 6 — Mission Operations interface**: renders
  `projectAgentRun` output as the Agent Run page.
- **Ophiuchus**: real workspace execution binding via
  `ophiuchusExecutionRef`.
- **Aladiah audit**: capsules become the per-run audit unit.
- **Milestone 8 — Adapter integration**: adapters emit real launch
  attestations and trace events; the command executor drives capsule lifecycle
  operations for live runs.
