> **This PR targets Sunday Relay only.**
> **This PR must be squash-merged.**
> **Do not merge without founder authorization.**

Base SHA: `ca77604a7197be0937c0ae82f968987496c82513`
Head SHA: `(one commit stale by construction — this body cannot name the commit that contains it)`

## Relay Product Scope

Relay bridge mission authority. No Alcatraz/Fusion implementation is included.
No Julius kernel file, Mission Contract, C.A.R.D., Project Brain or research
path is touched — `JULIUS_HARNESS_MANIFEST.md` is unchanged, which is the
mechanical proof of that.

## Milestone / Capability

**A mission belongs to the participant who started it, on every route — not
only in the history list.**

`listForParticipant` has scoped a participant's history since it was written.
The per-mission routes did not. `GET /relay-api/mission/:id`,
`POST /relay-api/mission/:id/cancel` and `POST /relay-api/mission/:id/retry`
reached the registry carrying nothing but a mission id, and
`POST /relay-api/mission/start` returned an existing mission's full view to
anyone who named its id.

**Mission ids are caller-chosen** (`body.missionId`), so naming one proves
nothing about who owns the mission behind it.

### The vulnerability on `ca77604a`, precisely

Participant **B**, holding a valid browser session and never paired to
participant **A**, could:

| | Route | Registry | Effect |
|---|---|---|---|
| read | `GET /mission/:id` | `registry.get(id)` — `mission.ts:436` | A's full mission view: objective, state, phase, events, config |
| cancel | `POST /mission/:id/cancel` | `registry.cancel(id)` — `:478` | A's running mission cancelled |
| retry | `POST /mission/:id/retry` | `registry.retry(id)` — `:479` | A's mission re-driven — **a retry spends** |
| collide | `POST /mission/start` | `start()` returned `toView(existing)` | A's full mission view, through a write endpoint |

`visibleTo` appeared **0 times** in `relay-bridge/mission.ts`. The
authentication gate above these routes was doing its job — every caller was
authenticated — but authentication is not authorization, and nothing downstream
asked whose mission it was.

This is the still-live half of historical PR #143. Its other half — identity
from the session rather than the request body — **had already landed**: `start`
already stamped `startedByParticipant` from the verified session. That is why
the fix is small: the owner was already recorded, and nothing read it.

### The fix

One pure predicate, and the four call sites that were missing it.

```ts
export function missionOwnerAdmits(ownerParticipant: string | null, caller: MissionCaller): boolean {
  if (caller.kind === 'operator') return true;
  return ownerParticipant === caller.participantId;
}
```

- **The operator's authority is deliberately unchanged.** An operator may act on
  any mission; that is canonical and is proven by its own test.
- **`participantId: null` is an identity, not a wildcard.** The unbound caller —
  a read-only session, or a control session paired before a participant was
  bound — owns exactly the missions started with a null owner. It can still read
  back what it started; it can never reach a named participant's mission.
- **`caller` is a REQUIRED argument**, not an optional one defaulting to
  operator. A default would mean a future call site inherits full authority by
  omitting a parameter. Making it required is what turned the compiler into the
  audit: every existing call site was enumerated by `tsc`, not by grep.
- **Not-found and not-yours are ONE answer.** A foreign mission and a mission
  that does not exist return byte-identical responses, so the refusal cannot be
  read as "this id exists, it just is not yours".
- **A collision refuses the id** with `409 mission_id_unavailable`, and the
  refusal deliberately does not say the mission exists — that sentence is itself
  the leak. Same-caller idempotency, which is what `start` promises, is
  preserved.

### What was deliberately NOT changed

The **ship surface** (`shipContext`, `beginShip`, `endShip`,
`recordShipOutcome`) is gated by **repository-registration ownership** in
`ship-route.ts` — `registrationOwnerAdmits`, read from the registration and
never from the request. That is a different and stronger authority than mission
ownership: the repository is the thing that receives the write. Substituting
mission ownership there would have *removed* a real capability (a participant
shipping an operator-started mission into a repository they own), so it stays.

One residual is recorded rather than silently changed: `handleShipRoute` reads
`shipContext` **before** the ownership check, so a foreign caller can tell
`409 mission_not_shippable` from `403 repository_not_yours` and thereby learn
whether a mission is shippable. That leaks one bit and no content, and closing
it needs the target's repository key before the mission is read — a reordering
that belongs in its own change.

## Website Impact

None. No file under `src/relay/ui` is touched.

## CLI Impact

None. No `relay mission <x>` or `relay reviewer <x>` action is added, so the
action-list assertion in `src/relay/cli/mission-economics.test.ts` is unchanged.

## Website/CLI Parity Impact

None — no surface capability added or removed.
`npm run relay:surface-parity:check:strict` passes.

## Mission Operations Impact

`MissionRegistry.get`, `cancel` and `retry` take a `MissionCaller`; `start`
takes one in place of `startedBy` and now returns `LiveMissionUpdate | null`.
Mission state, phases, events, economics, the Trace Ledger and the Execution
Capsule model are untouched.

## Requested vs Actual Agent Identity

Requested: the coding worker. Actual: the same session that performed the
open-PR archaeology this finding came out of. The commits are authored and
committed as `julius-worker[bot]`; the pull request must be OPENED by the App,
per `docs/JULIUS_WORKER_PR_RUNBOOK.md`.

## Files Changed

7 files, +618 / −81.

| File | Why |
|---|---|
| `relay-bridge/mission.ts` | `MissionCaller`, `missionOwnerAdmits`, `MISSION_OPERATOR`; the four scoped methods |
| `relay-bridge/server.ts` | `missionIdentity` derived once from the authenticated decision, fail-closed; passed to the four routes; `409` on a foreign collision |
| `relay-bridge/mission-ownership.test.ts` | **new** — 18 regression proofs |
| `relay-bridge/live-ship-proof.test.ts` | its delegating registry forwards `caller` instead of dropping it |
| `relay-bridge/orchestrator.test.ts`, `mission-gate.test.ts`, `founder-pack-claims.test.ts` | call sites name their caller |

## Tests

`npm test` — **528 files passed, 3 skipped (531). 10,298 tests passed, 30 todo,
0 failed.** Exit 0. Trusted `main` `ca77604a` was 527 files / 10,280 passed; the
difference is exactly this change's one new file and its 18 tests.

### The ten properties, each its own named test

1. the owner may read, cancel and retry their own mission
2. a foreign participant cannot READ another's mission
3. …cannot CANCEL it — and the mission is provably untouched afterwards
4. …cannot RETRY it — the revision is unchanged, so nothing was re-driven
5. a mission-id collision refuses the id instead of returning the mission —
   and same-caller idempotency still works
6. a foreign mission and a nonexistent one are byte-identical answers, for all
   three verbs
7. the operator's authority is unchanged, at the route and in the predicate
8. identity comes from the session: a body claiming `participantId`,
   `startedBy` or `caller: {kind:'operator'}` promotes nobody, and a mission
   started with a forged body participant still belongs to the session
9. no cross-participant metadata leaks — not through the history list, and not
   through any of the four verbs
10. the unbound caller owns null-owner missions and nothing else

Plus the predicate stated directly, including that a trailing space, a case
change and a suffix are all different identities.

### Security falsification — the mutation campaign

Four mutations were applied to the fixed tree and the suite re-run. **All four
were killed**, so these tests fail if the fix is removed:

| Mutation | Tests failed |
|---|---|
| `missionOwnerAdmits` always returns true (whole fix removed) | **12** |
| `get()` unscoped — the original read defect, restored | **6** |
| `start()` collision returns the existing mission — the original leak | **2** |
| the route hands the registry `{kind:'operator'}` regardless of session | **8** |

## Typechecks

`npm run typecheck` — all four projects clean, exit 0.

## Builds

`npm run build`, `npm run relay:build`, `npm run relay:bridge:build` — all pass.

## Gates

`relay-repository-boundary.mjs`, `relay-parity-gate.mjs`,
`relay:surface-parity:check:strict`, `relay:yc-demo:check`,
`relay:cli:contract-verify`, `git diff --check` — all pass.
`julius:harness:check` — **OK**, manifest unchanged.

Drills: `relay:persistence:contract-verify`,
`relay:persistence:recovery-drill`, `relay:workspace:verify`,
`relay:claude:contract-verify` — all pass.

## External Calls

**Provider calls made: zero.** The new suite replaces `fetch` with a spy and
builds the registry with no architect configuration, so every mission fails its
preflight before dispatch. The mission RECORD — and its owner — still exists,
which is all the ownership proofs read.

## Migrations

None.

## Environment Changes

None.

## Deployment Changes

None. No deployment configuration file is added or modified.

## Independent Review

Not yet performed. The change is small and entirely inside the bridge's mission
family, and the mutation campaign above is its adversarial evidence.

## Unresolved Findings

1. The ship-route shippability oracle described above — one bit, no content.
2. `start` necessarily reveals that a mission id is *taken* (409 vs 200). This
   is inherent to id-keyed idempotency and leaks nothing about the mission; an
   id that cannot collide would be a different design.
3. The registry remains **in-memory**, so a bridge restart forgets every mission
   and its owner. Ownership is therefore a property of a running process, not a
   durable one. Unchanged by this PR and already disclosed in the surface.

## Rollback

Revert the squash. The change is additive to one module and four call sites,
with no migration, no persisted state and no deployment configuration, so a
revert restores the prior behaviour exactly — including, deliberately, the
vulnerability.
