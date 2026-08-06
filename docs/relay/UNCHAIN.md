# Unchain

**Status: SPECIFIED. THE GATE IS IMPLEMENTED AND A RECHAINING PLANNER EXISTS
BUT IS UNWIRED. THE METER, SESSION LIFECYCLE, UNCHAINED FORM, RECHAINING
EXECUTION AND S-LOOP RUNTIME ARE NOT IMPLEMENTED.**

No session can exist in this build: there is no meter, no session store, no
activation path, no Unchained Form, and no skin that grants anything.
`src/relay/mission/loop/loop-availability.ts` models the *gate* and refuses
every S-Loop with a truthful reason. `src/relay/mission/loop/unchain/
rechaining.ts` DECIDES what a collapse would do — and nothing calls it. A
planner with no caller collapses nothing, so Rechaining as a behaviour does
not exist; only the decision it would need does.

This document exists because the founder's Unchain direction lived outside the
repository, which meant the locked decisions could not be checked against code
or cited in review. It records them. **Documentation is not implementation, and
a decision written here is not a feature that exists.**

---

## What Unchain is

Unchain is a **temporary capacity expansion**. It makes Relay able to do more
work at once, for a bounded time. It does not make Relay allowed to do more.

That single distinction — capacity, not authority — is the whole design, and
every rule below follows from it.

## What Unchain grants

| Grant | Detail |
|---|---|
| Temporary agent slots | **Exactly two.** Not configurable. |
| Temporary plugin capacity | Configurable bonus; exact value is an open founder decision |
| S-Loop eligibility | `/sloop` is unavailable without an active session |
| Unchained Form | Visual transformation of the Relay Dog |
| Unchain Meter | Server-authoritative remaining-capacity indicator |

`UNCHAIN_TEMPORARY_SLOTS` is written as a literal `2` with a literal type, so
changing it is a visible type change in review rather than a configuration
drift nobody notices.

## What Unchain does NOT do

It does not:

- grant new permissions;
- expand workspace access;
- bypass human approvals;
- bypass spending controls;
- bypass enterprise policies;
- bypass MCP permissions;
- bypass plugin permissions;
- bypass provider restrictions;
- disable verification;
- allow unverified completion.

A temporary agent operates under **exactly** the permission system an ordinary
agent operates under. It has the same tool grants, the same approval
requirements, the same budget, the same reviewer independence rules, and the
same 17 `AUTONOMOUS_STOP_ACTIONS` that stop even Autonomous mode.

`src/relay/mission/modes.ts` is **not** an authority-expansion mechanism and
must never be used as one. Mode policy is a ceiling. Unchain does not raise it.

## Skins grant nothing

The Unchained Form is a visual state. A skin, theme, colourway or animation
never grants capacity, eligibility, permission or entitlement. Any code path
where a cosmetic field can influence a capacity decision is a bug, and the
current tests assert that no capacity function reads one.

## Server authority

The Unchain Meter is **server-authoritative**. A client may display it and may
ask about it; it can never assert it.

Concretely, and enforced today in `loop-availability.ts`:

| Condition | Result |
|---|---|
| No session record | Refused — *"Unchain is specified but not yet implemented in this build, so no session can exist."* |
| Session not granted over an operator credential | Refused |
| `lastAttestedAt` is `null` (never re-verified) | Refused — Unknown never grants |
| Meter reads `expired` | Refused |
| Session claims other than two temporary slots | Refused |
| Meter reads `active`, `low` or `critical` | Grants, because Rechaining is a controlled collapse rather than an instant cut |

There is deliberately **no builder** for an `UnchainSessionRecord` in the
domain. It is evidence, and evidence is produced by whatever actually observed
it. A browser session — read-only by construction, see the pairing-grant design
in `relay-bridge/browser-session/` — can pass anything it likes and the worst it
achieves is being told no.

## Rechaining

When a session becomes low, critical or expired, Relay **Rechains**: a
controlled collapse back to base capacity.

1. stop creating new branches;
2. stop assigning new tasks to temporary slots;
3. identify safe checkpoints;
4. persist current files, branches and evidence;
5. write structured Project Brain handoffs;
6. revoke temporary MCP and plugin access;
7. cancel unsafe or unnecessary speculative branches;
8. converge completed branches where possible;
9. re-plan remaining work for base slots;
10. queue work exceeding base capacity;
11. transition the parent S-Loop to a normal Loop when possible;
12. never report interrupted work as complete;
13. never allow temporary agents to continue invisibly.

**User work, evidence, branches and handoffs never disappear because Unchain
expired.** A collapse preserves; it does not discard.

Rechaining is monotonically downward. It can never raise capacity.

## The relationship

```
Relay Dog   →  the normal compound AI identity
Unchain     →  a temporary capacity-expansion system
S-Loop      →  swarm orchestration mode that uses the expanded capacity
```

An S-Loop is not cosmetic. It is the reason the capacity exists.

## Open founder decisions

These are genuinely unresolved and are **not** guessed anywhere in code:

| # | Question |
|---|---|
| 1 | Exact Unchain duration |
| 2 | Exact temporary plugin-capacity bonus |
| 3 | Base slot capacity per plan tier (the `+2` is a delta from an unstated base) |
| 4 | Whether expiry pauses a running Loop or only prevents new branches |
| 5 | Whether Relay Cubs are the temporary slots, a separate nested-agent tier, or unrelated — `RelayCubsUsage` already models `concurrentLimit` and reports `not_enabled` |
| 6 | Where the Meter's authority lives (bridge, Alcatraz, or a new service) |
| 7 | Scheduled S-Loop policy — see `CRON_LOOPS.md`; default is **unavailable** |

## What exists today

| Piece | State |
|---|---|
| `UnchainSessionRecord` type | Declared, observation-only |
| `unchainSessionProblem()` | Implemented — every branch refuses with a reason |
| `evaluateLoopAvailability()` | Implemented — S-Loops blocked, capacity granted only when nothing blocks |
| `UNCHAIN_TEMPORARY_SLOTS` | Declared as literal `2` |
| `planRechaining()` | Implemented as a PURE PLANNER with **no caller**. Decides three of the thirteen steps' worth of dispositions: preserves before it cancels (an unpersisted branch is REFUSED, including a speculative one), reports interrupted work as interrupted and never as converged, and accounts for every temporary slot. Targets the BASE slot count unconditionally, so it can never promote. It NAMES what it does not decide — steps 1, 3 and 11, plus every owed handoff — rather than omitting them. It answers none of the open decisions below: base capacity is an argument, and the plan is identical for every meter state. |
| Meter | **Not implemented** |
| Session issue / verify / revoke | **Not implemented** |
| Unchained Form | **Not implemented** |
| Rechaining (the behaviour) | **Not implemented** — `planRechaining()` decides; nothing executes, and nothing calls it |
| S-Loop runtime | **Not implemented** |
