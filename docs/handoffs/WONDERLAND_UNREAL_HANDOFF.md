# Wonderland ↔ Unreal — the integration handoff

**Audience: the Wonderland World stream (Session 2).** This is written so you
never have to read Session 3's source to build the receiving side. Everything
below is either a contract you can import or a rule you can implement against.

**Status of the sending side:** the contracts exist, are tested and are
mirrored into `wonderland/Source/Wonderland/*.h`. **No live Julius mission has
ever driven any of it** — see "What is and is not real" at the end. Build
against this expecting real events later; do not describe it as connected.

---

## 1. The event schema

One shape crosses the boundary: `WonderlandEnvelope`, in
`src/relay/mission/wonderland/wonderland-envelope.ts`.

| field | type | note |
|---|---|---|
| `schemaVersion` | `'relay-wonderland-envelope.v1'` | bump = breaking change |
| `eventId` | string | stable; the same delivery twice carries the same id |
| `projectId` | string | **the only never-null identifier** |
| `worldSessionId` | string \| null | the viewing session |
| `juliusInstanceId` | string \| null | WHICH Julius |
| `missionId` | string \| null | |
| `runId` | string \| null | the ordering scope — see §4 |
| `taskId` | string \| null | |
| `workerRole` | enum \| null | see below |
| `state` | `JuliusVisualState` | one of 11, see §2 |
| `stateSource` | enum | `julius_run_state` \| `relay_phase` \| `event_type` |
| `sourceState` | string \| null | the upstream word, so the collapse loses nothing |
| `terminal` | boolean | set only by a real ending |
| `sequence` | number | per **run**, monotonic |
| `revision` | number | `julius_runs.version`, per run |
| `occurredAt` | ISO string | |
| `metadata` | `Record<string, string\|number\|boolean\|null>` | sanitised, bounded |
| `metadataDropped` | number | entries removed; never what they were |

**`workerRole`** is `PROMPT_ARCHITECT` \| `CODING_AGENT` \| `INDEPENDENT_REVIEWER`
\| `SPECIALIST` \| null. The first three are derived from Julius's own
`JULIUS_DEFAULT_ROLES`. A specialist's run-time NAME never crosses — Julius
names specialists freely and letting the name through would make it a de-facto
vocabulary.

**Nothing else crosses.** `metadata` admits primitives only, ≤120 chars per
string, ≤16 entries, with secret-shaped keys dropped. A prompt, a completion, a
stack trace and an API key are structurally unable to travel. **Do not add a
field for provider output.**

---

## 2. The state enum

`JuliusVisualState`, 11 members, mirrored as `EWonderlandJuliusState` in
`WonderlandJuliusState.h` with `Unobserved` at ordinal 0:

`idle` · `attention` · `prompt_architect` · `coding` · `handoff` ·
`independent_review` · `repair` · `verifying` · `complete` · `blocked` · `error`

**Ordinal 0 is `Unobserved`, not `Idle`.** A zero-filled struct means Relay has
not spoken. Never render it as an idle agent.

Each maps to exactly one `EWonderlandDogActivity` (a bijection), then to one
motion, then to one clip. `WonderlandAnimationForJuliusState` composes the
chain — do not add a fourth table.

---

## 3. Legal transitions

`JULIUS_VISUAL_TRANSITIONS` in `wonderland-visual-transitions.ts` is **derived
from Julius's own guard**, not declared. The rules you can rely on:

- `complete` → nothing. `error` → nothing.
- **`blocked` → `complete` is NOT reachable.** A blocked run must be observed
  recovering (→ `coding`, `repair` or `handoff`) and then verified.
- No kernel state maps to `idle` at all. A Julius *run* is never idle; a
  *mission* is. `idle` arrives only from the Relay phase `ready`.
- `repair` is its own state, so a repaired run never looks like one that never
  failed.

**Only readings whose `stateSource` is `julius_run_state` are held to that
table.** The other two sources are coarser and legitimately produce e.g. `error`
mid-run without the kernel being FAILED.

Two rules hold at every source and you should implement them too, as belt and
braces: nothing un-completes a completed mission, and a second *different*
ending never replaces the first.

---

## 4. Ordering — read this before writing a receiver

**`sequence` is per RUN, not per project.** `stream_id` is the run id on every
Julius write path, so two runs in one project both count 1, 2, 3. **A
project-wide cursor is wrong**, not merely imprecise.

Two axes, and neither subsumes the other:

- `sequence` orders **events** within one run.
- `revision` orders **states**. Several events share one revision; a snapshot
  carries a revision and no sequence at all.

`wonderlandOrderingVerdict` checks in this order, and the order matters:

1. `foreign_project` — another world. Not late, misrouted.
2. `foreign_julius` — a different Julius instance. Never merge two streams.
3. `foreign_run` — a run this cursor is not following.
4. `malformed` — unusable sequence/revision/eventId.
5. `duplicate` — the same `eventId` again.
6. `stale_revision` — **checked before sequence.** A stale replica can deliver
   an event whose sequence is genuinely ahead on its own stream while the run
   has moved on; the sequence check alone would accept it and the world would go
   backwards.
7. `stale_sequence`.

Count each refusal **separately**. Forty stale sequences is a chatty replay and
is fine; one `foreign_project` is a routing bug and is not.

---

## 5. Rehydration — joining mid-mission

Take the **snapshot first**, then replay. Never the other way round.

1. `inspectRun` → state + `revision`. **Set** the visual state from it. Do not
   replay the transitions that led there; they happened while nobody was
   watching and performing them now is theatre presented as observation.
2. Then ask the timeline for **everything** (`afterSequence: 0`). A snapshot has
   no sequence, so any other cursor would either skip events or claim to have
   applied events never seen.

That full replay is safe **because** every event carries its revision and
anything below the snapshot's is refused. The world holds COMPLETE and watches
its whole history arrive without moving.

**One subtlety you must implement:** an event at the snapshot's *own* revision
is also stale. A snapshot is the run's row at that revision and is strictly
newer than any event of its generation. Without this, a replayed revision-6
CODING event overwrites a COMPLETE recovered at revision 6. Two *events* at one
revision are peers; a snapshot outranks its generation. `revisionFromSnapshot`
on the cursor carries this, and an accepted event clears it.

---

## 6. Transport

Use the smallest seam that exists; do not build a second one.

- `GET /wonderland/events` (`relay-bridge/wonderland-routes.ts`) — SSE,
  `?projectId&cursor`, replays then subscribes, `id: <sequence>` per frame.
- **There are no Julius HTTP routes on the bridge.** `JuliusRuntimeApi` is not
  mounted anywhere. Snapshot access needs that route to be added — it is not
  yours or mine unilaterally; raise it with the Julius stream.
- **The replay query does not filter `event_type`.** Julius rows land in the
  same table prefixed `julius.`. Use `readWonderlandLedgerBatch`
  (`wonderland-ledger-adapter.ts`) — it refuses non-Julius rows by default and
  handles **both** persisted payload shapes. Reading the rows directly will
  silently lose run-state precision; see §9.

Reconnect backoff: double from 1s to a 30s ceiling, no jitter
(`wonderlandReconnectDelayMs`).

---

## 7. Animation intents

`planWonderlandAnimation` (`wonderland-julius-animation.ts`) returns a
`WonderlandAnimationPlan`, mirrored as `FWonderlandAnimationPlan`:

| transition | blend | when |
|---|---|---|
| `Hold` | 0 | same clip — **do not restart it** |
| `Wake` | 260ms | from `Dormant` |
| `CrossFade` | 180ms | ordinary work → work |
| `Interrupt` | **0 — a cut** | a state that needs a human |
| `Settle` | 420ms | into a real ending |
| `Dormant` | 520ms | back to no observation |

**The one rule that is not aesthetic: a state that needs a human CUTS.** A
failure that is also an ending still cuts — the person outranks the ceremony.
Ordinal 0 is `Hold`, so a zero-filled plan says "keep playing".

Eleven states need **nine clips plus `dormant`** — ten slots total
(`WONDERLAND_REQUIRED_CLIPS`). There is no smaller honest first set: a state
shown by a clip that means something else is worse than a placeholder.
`attention`, `verifying` and `complete` all share `stand_still`, which is why
`terminal` and `attentionRequired` travel *with* the plan and must not be read
off the clip.

---

## 8. HUD bindings — THE GEOMETRY IS FROZEN

The founder has settled the usage HUD and declared it permanent. **Do not
redesign it, do not reintroduce the crossing variant, do not change its
geometry.** `wonderland-hud-canon.test.ts` pins every control point by digest.

- GREEN = Compound AI Agent. BLUE = single agent. Top-left.
- Green is the outer ring/swoop; blue is the concentric inner hook at ~⅔ radius.
- **Zero overlap, zero occlusion.** Blue is readable across its whole range.
- Tail rises to the right. Viewport `{x:0, y:0.06, w:1, h:0.88}`, derived from
  the measured extent of both strokes.

Data bindings per channel: `current` (the **remainder**, never the spend),
`maximum`, `reference` (per-channel ladder ceiling), `tierId`, `tierLabel`,
`unitLabel`. Readings: `not_reported` (ordinal 0) · `known` · `stale` ·
`unavailable`.

**UNKNOWN IS NOT ZERO.** Every figure is a carrier (`known`/`value`/`reason`),
never a bare number. Never draw a missing authority as an empty valid meter.

Accounting rule (`wonderland-usage-accounting.ts`): **attribution follows the
orchestrator, not the worker.** Every worker slot's spend inside a run is
COMPOUND. An agent working alone is SINGLE. Anything unattributable is reported
and never assigned, and makes the account `partial` — in which case **both**
channels read UNKNOWN rather than showing subtotals whose meaning depends on
what was left out.

---

## 9. Failure behaviour you must reproduce

| situation | required behaviour |
|---|---|
| duplicate event | refused, counted, state unchanged |
| late / out-of-order | refused on sequence, counted |
| stale replica ahead on sequence | refused on **revision** |
| wrong project / run / Julius | refused, counted **separately** |
| unknown event type | ignored, counted; never rendered |
| disconnect mid-CODING/REVIEW/REPAIR | state unchanged, `terminal` unchanged, usage figures unchanged, cursor unchanged. **A disconnection is never a completion.** |
| reconnect after COMPLETE | recover COMPLETE; replay moves nothing |
| usage source stale | `stale` + last-reported figures, labelled |
| usage source unavailable | `unavailable` + the reason; figures UNKNOWN |
| blocked / error | never silently become COMPLETE |

---

## 10. Acceptance tests

The sending side's suites are the specification. Mirror their intent:

| suite | proves |
|---|---|
| `wonderland-envelope.test.ts` | no provider payload can cross |
| `wonderland-ordering.test.ts` | a stale CODING event cannot overwrite COMPLETE |
| `wonderland-rehydration.test.ts` | reconnect-after-COMPLETE replays nothing |
| `wonderland-visual-transitions.test.ts` | `blocked`/`error` never reach `complete` |
| `wonderland-usage-accounting.test.ts` | the arithmetic closes; partial ⇒ UNKNOWN |
| `wonderland-ledger-adapter.test.ts` | both persisted payload shapes read correctly |
| `wonderland-hud-canon.test.ts` | the frozen geometry, by digest |
| `wonderland-cpp-parity.test.ts` | every struct and enum, bidirectionally |

`wonderland-cpp-parity.test.ts` walks the real `.h` files, so **a field you add
on the C++ side without a TypeScript counterpart fails the suite**, and vice
versa. That is deliberate: it is how the two sides stay honest without a
meeting.

---

## 10b. The composed fold — start here

`wonderland-session.ts` is the one place the layers compose, and a receiver
should mirror its shape rather than re-composing them differently.

```
openWonderlandSession({ projectId })
  → recoverWonderlandSession(session, snapshot)   // sets the state, no plan
  → applyWonderlandEnvelope(session, envelope)    // ordering → legality → plan
```

`applyWonderlandEnvelope` returns `{ session, ordering, legality, plan, reason }`.

- `plan` is **null** when nothing was applied — not a `hold`. A hold is a real
  instruction ("keep playing, do not restart"); returning one for a refused
  event would say a decision was made about it.
- Recovery returns **no plan** either: arriving at a state you were never
  watching is not a transition, and a `wake` into the middle of a mission would
  perform an entrance that never happened. Show the clip; do not play into it.
- A refusal at any stage leaves the visual state exactly where it was.

**Two paths that are not what you would guess**, both enforced by the derived
table:

- `prompt_architect → coding` is **not** a move. Planning hands off first
  (PLANNING → READY → EXECUTING), so the real path passes through `handoff`.
- `coding → complete` is **not** a move. Verification stands between them.

And one consequence worth knowing before you tune blends: **`settle` never fires
on a kernel-path completion.** `complete`'s only kernel predecessor is
VERIFYING, and both draw `stand_still`, so the plan holds. The ending is told by
the readout and `terminal`, not by the body.

---

## 11. Recorded-real samples

**None exist.** No real Julius event has ever been captured
(`wonderland-evidence.ts` enforces this: `verifyWonderlandCapture` cannot return
`real` for any input, by construction).

The machinery to grade one is built and waiting. When a live run happens,
`wonderlandCapture({ origin: 'recorded_from_live_run', sourceRunId,
capturedAtIso, events })` produces a capture that can be graded. **A capture
claiming a live origin without both a run id and a capture time is silently
downgraded to `synthesised`** — at construction, so a file on disk cannot sit
there lying.

Until then, the only Julius event stream in the repository is
`WONDERLAND_JULIUS_DEV_SCRIPT`, hard-labelled `DEVELOPMENT FIXTURE · NOT A
MISSION`.

---

## What is and is not real

| level | what is at it |
|---|---|
| REAL — a live run drove the world | **nothing** |
| RECORDED-EVENT VERIFIED | **nothing** — no capture has ever been taken |
| INTEGRATION-READY | the envelope, ordering, rehydration, state machine, ledger adapter, accounting, animation plan, entry contract, HUD contract |
| SIMULATED | the dev script |
| NOT BUILT | the Unreal client, a world-snapshot route, any renderer at all |

**Do not describe this as "Julius is connected."** Build the receiver; the
sending side is ready for events it has never seen.
