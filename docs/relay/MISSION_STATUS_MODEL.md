# Mission Status Model — Mission Operations Milestone 1

Status: implemented (deterministic, browser-safe, no live integration)
Module: `src/relay/mission/status/`
Tests: `status-model.test.ts`, `legacy-compat.test.ts`, `status-projection.test.ts`

## The rule this model enforces

> execution completed ≠ outcome satisfied ≠ verification complete ≠ release authorized

Relay is not optimized around how many agents ran. It is optimized around
whether the mission was safely completed, independently verified, and
economically efficient. A single "Complete" status cannot carry that burden,
so mission status is FOUR independent dimensions that travel together and
never collapse:

| Dimension | Values | Question it answers |
| --- | --- | --- |
| execution | `not_started · starting · running · waiting · completed · failed · cancelled` | Did the work run? |
| outcome | `unknown · partial · satisfied · violated` | Was the mission intent met? |
| verification | `unverified · reviewing · changes_required · approved · verified` | Did independent review confirm it? |
| release | `not_eligible · human_approval_required · eligible · released · rolled_back` | Is the result authorized to ship? |

`AqualaOutcomeStatus` is the combined record; `createInitialAqualaOutcomeStatus()`
is the ONE canonical starting point.

## Transitions

Each dimension has an explicit valid-transition table (`status-model.ts`).
Everything not in the table — including no-ops and unknown values — is
rejected with a structured `AqualaStatusTransitionError`, never a thrown
string. Terminal execution states never silently resume; `violated` never
recovers; `rolled_back` never jumps back to `released` without a fresh
eligibility pass.

`applyStatusTransition(current, request)` is the single authorized mutation
path. On success it returns the next status plus exactly ONE append-only
`AqualaStatusTransitionEvent` (readonly-typed and frozen at runtime). On any
failure — including a corrupted/unknown dimension string from persisted
data — the ORIGINAL status object is returned untouched alongside a
structured error, never a crash.

## Cross-dimension invariants

The per-dimension tables cannot see combinations, so
`validateCrossDimensionInvariants` guards the proposed COMBINED status:

- `changes_required` or a `violated` outcome forces release to
  `not_eligible` (a standing release grant must be withdrawn first — the
  model rejects the review decision until the grant is removed).
- While release stands at `eligible`, the gates must remain met: reopening
  verification (`verified → reviewing`) requires withdrawing eligibility
  first.
- `eligible` requires the configured `AqualaReleasePolicy` gates (default:
  outcome satisfied AND verification verified). `human_approval_required`
  can only be REQUESTED once those gates are met — it means "everything
  passed; a human decides", never "nothing has run yet". Transitioning into
  `released` requires the gates AND the `eligible` state immediately before
  it. A STANDING `released` status never blocks later execution/outcome/
  verification facts (rollback exists for reversal, not bookkeeping).
- A verification DECISION into `approved`/`verified` must reference the
  CURRENT artifact revision. A stale review (reviewed revision ≠ current
  revision) is rejected — at apply time via
  `request.currentArtifactRevision`, and during reconstruction via
  `ReconstructContext.currentArtifactRevision`. The check binds only to the
  verification dimension transitioning; events in other dimensions after a
  standing approval legitimately omit `artifactRevision`.

`deriveReleaseEligibility(status, policy)` is the pure release-gate
derivation (used by invariants, the compatibility adapter, and the
projection). `changes_required` and `violated` are hard blockers regardless
of policy toggles.

## Reconstruction

`reconstructStatusFromEvents(initial, events, context)` deterministically
folds an ordered event stream into a final status. It fails on the FIRST
invalid event with its index: `previousStatus` mismatch, backward
`missionRevision`, illegal transition, cross-dimension violation, or stale
artifact approval. The input array is never mutated. Reconstruction and live
application agree on every prefix (tested).

## Compatibility adapter (`legacy-compat.ts`)

Older Relay state predates this model. The adapter maps it WITHOUT inventing
facts the old state never asserted:

- **Browser app** (`RelayMissionState`, `src/relay/ui/app/contracts.ts`):
  every coarse state has an ordered transition PLAN from the initial status;
  `materializeLegacyStatusEvents` replays the plan through the real engine,
  so every adapted status is reachable by construction and comes with a
  legitimate, reconstructable event history. A submitted claim maps to
  outcome `unknown` (claims are not evidence); `verified_complete` derives
  its release dimension from the policy (default →
  `human_approval_required` — the founder still approves releases); the
  adapter never fabricates `released` or `rolled_back`.
- **Mission layer** (`MissionStatus`, `src/relay/mission/contracts.ts`): the
  single-value ancestor at mission scope (`draft/locked` → initial,
  `blocked` → execution `waiting`, etc.).
- **Mission verdicts** (`MissionVerdict`): `adaptMissionVerdict` returns only
  what a verdict POSITIVELY establishes, grounded in the verdict engine's
  actual producers (`verdict.ts`): a claim establishes nothing; `reviewed`
  means every completed review demanded changes (`changes_required`);
  `failed` is a run fact that asserts nothing about outcome; `blocked` has
  mixed causes and asserts nothing; only `needs_human` demands a human. It
  never widens a verdict into execution or release claims. Terminal
  browser-state plans (`failed`/`cancelled`) likewise never fabricate a
  "role actively working" step the coarse legacy value does not assert.
- **Narrow adapters**: `CodingTerminalStatus` → execution dimension only;
  `MissionReview['verdict']` → verification only (`unable_to_review` →
  `unverified`: an unfinished review is not a review).

Deliberately OUT of scope here: `RunStatus`/`RunPhase`/`TaskStatus`
(`src/relay/protocol/enums.ts`) stay run/task-scoped — their adapter belongs
to the Per-Agent Execution Capsule milestone (Milestone 3), and the
protocol's `output.*` release events feed the release dimension when the
Aquala Trace ledger lands (Milestone 4).

## Compact UI projection (`status-projection.ts`)

`projectAqualaStatus(status, policy)` is a PURE read-model producing four
ALL-CAPS chips (existing workspace idiom), a one-line headline
(`RUNNING · OUTCOME UNKNOWN · UNVERIFIED · NOT ELIGIBLE`), and derived
flags (`blocked`, `awaitingHumanApproval`, release-gate state). It is
intentionally NOT wired into the Live Terminal or the Demo Simulation:
broad UI integration during this milestone would risk the original,
authoritative interface. The future Mission Operations interface
(Milestone 6) consumes it.

## What is deterministic / mock here

Everything. This milestone contains no live integration, no provider calls,
no process control, no storage, no network, and no React. Events carry ids
and timestamps supplied by callers — the domain never reads a clock.

## Future integration boundaries

- **Milestone 2 — Mission Command Protocol**: validated commands emit status
  transitions through `applyStatusTransition`; rejected commands must leave
  status untouched (the engine already guarantees this).
- **Milestone 3 — Execution Capsules**: per-agent run state adapts
  `RunStatus`/`TaskStatus` into the execution dimension at capsule scope.
- **Milestone 4 — Aquala Trace**: `AqualaStatusTransitionEvent` gains hash
  chaining and durable append-only storage; reconstruction becomes the
  ledger's integrity check.
- **Milestone 5 — Mission Economics**: release policy gains budget gates.
- **Milestone 6 — Mission Operations Interface**: renders
  `projectAqualaStatus` output.
