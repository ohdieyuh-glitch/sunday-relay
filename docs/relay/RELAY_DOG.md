# Sunday Relay — Relay Dog Activity Engine (authoritative)

> Added in Prompt 8.2 (2026-07-22). The Relay Dog is a **deterministic,
> event-driven activity indicator** — a truthful projection of real run
> state, never decoration and never a fabricated animation. Source:
> `src/relay/mission/dog.ts`; pure and browser-safe (boundary-tested).

## What the dog is

The dog is a read-model over the canonical event stream. Its state and speed
are **computed** from what Relay is actually doing, so a viewer can trust that
a running dog means real coordinated work is happening and a sleeping dog
means nothing is. It is an honest status surface, not a game.

## States

`DOG_STATES` (16), resolved by `computeDogActivity(input)` in priority order:

1. **Terminal / boundary first:** `complete`, `failed`, `stopped_safely`,
   `waiting_for_user` (a Manual Task or checkpoint is pending — the dog waits,
   it does not run).
2. **Phase states:** `repairing`, `reviewing`, `verifying`,
   `carrying_handoff` (a handoff is in the recent window), `blocked`.
3. **Speed states**, chosen by `activityLevel` + `synchronizationLevel`:
   `asleep` → `idle` → `wandering` → `walking` → `trotting` → `running` →
   `sprinting`.

`sprinting` is special: it requires **sustained architect + coding-agent
coordination** — `architectAndCoding && activityLevel ≥ 70 &&
synchronizationLevel ≥ 60` (SYNC HIGH). Sprinting is the visible signature of
two roles working in tight lockstep; it cannot appear otherwise.

## How speed is derived (and how it is NOT)

Speed comes only from **meaningful** normalized events in a bounded recent
window (default 8). `MEANINGFUL` excludes bookkeeping noise — `ledger.*`,
`file_claim.*`, `usage.*`, and `run.phase_changed` never raise the dog's
speed. Speed is **never**:

- tied to a token stream or output rate (a chatty agent is not a fast dog);
- set by an adapter or the UI (the port carries no dog channel);
- fabricated, random, or time-based (`computeDogActivity` is a pure function
  of the event projection — same events, same dog).

Boundary tests assert the connectors directory never calls
`computeDogActivity`, so no adapter can drive the dog.

## Reduced motion

`reducedMotion: true` is honored: the dog renders its **state label and
frame without animation**. `renderDogFrames` returns the frames; the React
`RelayDog` component drops the `relay-dog--moving` class and the CSS honors
`prefers-reduced-motion`. The information (what Relay is doing) is identical
in both modes — only the motion differs.

## Rendering

`DOG_FRAME` holds a small ASCII frame per state for the terminal; the
graphical `RelayDog.tsx` renders the same canonical state with an
`aria-label` of `Relay Dog: <STATE>` so assistive tech reads the real status.
Each dog carries `provenance` (`simulated` in the demo, `live` for a live
run) verbatim from the source events — a simulated run never shows a live
dog.

## CLI

`/dog` prints the current state, speed inputs, and reason; `/dog motion
on|off` toggles reduced motion for the session. The mission-control demo
shows the dog moving through waiting_for_user → sprinting → verifying →
reviewing → repairing → complete as the competitive run progresses.

## Truthfulness — status of each part

- **Functional now:** the full deterministic state/speed engine, the
  meaningful-event filter, sprinting's coordination requirement, reduced
  motion, ASCII + React rendering, provenance carry-through, CLI.
- **Uses live events:** in a live run the dog projects real normalized events
  (e.g. the Prompt-8 Claude adapter), so it is a truthful live indicator.
- **Simulated in the demo:** the mission-control/competitive demo drives the
  dog from the deterministic simulated scenario — labeled SIMULATED.
- **Unavailable until persistence:** dog history is volatile; it reflects the
  current process only.

See MISSION_CONTROL.md for placement and MODES.md for how the mode is one of
the dog's inputs.
