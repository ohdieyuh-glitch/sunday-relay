# Controlled beta waves

**Status: THE DECISION, THE DURABLE STORE AND THE ADMISSION ROUTES ARE
IMPLEMENTED AND WIRED INTO THE BRIDGE. NO WAVE HAS BEEN OPENED IN PRODUCTION
AND NOBODY HAS BEEN ADMITTED TO ANYTHING.**

Those are six different claims and this file keeps them apart. The last one is
the honest limit: this module decides, and nothing yet records, serves or
enforces the decision. The status line is pinned by
`documentation-contract.test.ts`, so it fails the day it stops being true —
which it previously had no way to do.

---

## What a wave is

A **named, capped, explicitly-opened cohort.** Wave 0 is the controlled public
beta; waves 1–3 are the private waves that follow.

A wave is not a date and not a feature flag. It is a decision someone made,
recorded durably, with a seat count that can run out.

## Why this is a domain and not a boolean

"Is this person in the beta?" has **seven** answers, and a boolean collapses all of
them into "no". (This document said "five" and its table listed five while the
type had six — the omitted one being `unknown_wave`, the only refusal that fires
on data from a newer build.)

| Refusal | What it actually means |
|---|---|
| `not_enrolled` | We hold no record for them. A fact about our records, not a judgement about them. |
| `wave_not_open` | Enrolled in a wave nobody has opened. |
| `wave_closed` | Enrolled in a wave that has been closed. Reopening is an explicit act. |
| `wave_full` | Their enrollment is beyond the wave's seats. |
| `occupancy_unknown` | We cannot count the seats taken — or the count contradicts our records — so we will not admit against a number we do not have. |
| `unknown_wave` | The enrollment names a wave this build does not have. |
| `wave_misconfigured` | A stored record or the wave's own cap is malformed. A config bug, not an uncountable cohort — different things to go and fix. |

An operator who cannot tell *"we never invited them"* from *"we invited them and
ran out of seats"* cannot run a beta. The first is a to-do; the second is a
capacity decision; the third — an uncountable cohort — is a bug to fix before
inviting anyone else.

## The rules it holds itself to

- **Unknown is not denied.** No enrollment is `not_enrolled`, and the wording
  says so: *"a fact about our records, not a decision about them."*
- **Unknown occupancy is not zero.** If the seats taken cannot be counted,
  admission is **refused**. Reading an uncountable cohort as empty is how a
  capped beta silently becomes an uncapped one — the same shape as the
  provider-call cap that could never fire, which `#57` existed to remove.
- **Announce facts, not intentions.** `admitted` is returned only for an
  enrollment that **already exists**. Deciding to admit and having admitted are
  different events, and this module performs only the first.
- **A closed wave stays closed.** Reopening is an act, not the absence of one.
- **`seatsRemaining` is `null`, never `0`, when occupancy is unknown.** "The wave
  is full" and "we cannot tell" are different facts, and only one of them is a
  reason to stop inviting people.

## Seats go by enrolment TIME, and this was wrong once

A participant admitted on Tuesday does not lose their seat because someone else
opened the app first on Wednesday. The queue is ordered by `enrolledAt`, with
`participantId` as a total tie-break, so two enrolments sharing a timestamp
still resolve one stable way.

**The first version claimed exactly this and did not do it.** Position came from
the array index, so review reordered the same two records and watched alice lose
her seat to bob — a `SELECT` without `ORDER BY` would have done it. `enrolledAt`
was carried on every record and never read.

The queue is also **deduplicated by participant**, keeping the earliest record.
A retried enrolment write with no store-side idempotency — and there is no store
— used to consume a second seat, evict a real participant, and report a false
ordinal to the operator.

## Occupancy and the records must agree

`occupancy` is not a null-check. A reported count **higher than the enrollments
Relay can see** proves the list is partial, and a partial list makes every queue
position meaningless — so that refuses too.

This closed the way the cap could actually vanish. The natural caller
optimisation — "fetch just this participant's enrollments" — admitted everyone
while occupancy reported 1000 against 10 seats, because `occupancy` was read
once for `null` and then never used again.

**The operator board answers from the same queue the gate admits from.** It used
to report `occupancy`, so twelve enrollments against ten seats showed "6 seats
free, admitting" while every one of those six invitations was refused at the
door. A board that disagrees with the gate is worse than no board.

## Not implemented

 enforcement anywhere in the
product (no surface consults this — `mission/beta` is imported by nothing) ·
opening a wave (no artifact records any wave's state; there is no default
config, so "all waves are not_open" is true only because nothing configures one)
· invitations · waitlists · per-wave entitlements or spend caps · any UI.

And five more the first version of this list did not disclose, each needed in
week one of a real beta:

**REVOCATION** — `BetaEnrollment` has no `revoked` state, so removing one
participant means closing the wave for everyone · **EXPIRY** — no `endsAt`, and
no clock to compare one against · **PROVENANCE** — `BetaWaveConfig` records
neither who opened a wave nor when, although this document calls a wave "a
decision someone made" · **a BLOCKLIST**.

Enrolment idempotency WAS on this list and is now closed by the store below.

**No wave has been opened and nobody has been admitted to anything.** This
module is the decision, stated so the rest can be built against something that
already refuses correctly rather than against a boolean that would have to be
un-learned.

## The store

`src/relay/persistence/beta-enrollment-node.ts` — one file per participant per
wave, under `<root>/beta-enrollments/<wave>/<participantId>.json`.

**Idempotency is structural, not checked.** The file is created with `O_EXCL`,
so a second enrolment for the same participant *cannot* create a second record —
the kernel refuses it and the store reports `already_enrolled` **with the
original instant**, because the first instant is what orders the queue and a
retry that replaced it would move that participant's seat. There is no
read-modify-write, and therefore no lock.

**The count is independent of the list**, which is the property the gate's
reconciliation needs and previously could not get. `countFor` is a directory
read: it counts what is *on the volume*, not what a caller assembled. An
`occupancy` derived from the same array passed as `enrollments` would make the
reconciliation a permanent no-op and the cap would silently stop existing.

A corrupt record is **skipped by `list` and still counted by `countFor`** — so
the gate sees more seats taken than records it can read, and refuses. That is
the honest outcome: the volume holds something we cannot order.

Only `RELAY_BETA_WAVES` can name a directory, and a participant id must match
`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` — no dot, so `..` cannot form; no separator,
so no directory can be escaped.

## The routes

`relay-bridge/beta-routes.ts`, and the split between them IS the security shape:

| Route | Who | What it does |
|---|---|---|
| `POST /relay-api/beta/request` | **public** | records a request. Cannot admit. |
| `POST /relay-api/beta/access` | operator | asks the gate about one participant |
| `GET /relay-api/beta/status` | operator | the wave board |

**A request is not an admission**, and the response says so in the same breath
rather than leaving a caller to infer it: it returns `admitted: false` always,
with a note that recording is not granting. A public route that could admit
would make the cap decorative.

**The caller cannot choose their wave.** Naming your own wave means naming the
one with room. Public signup reaches `wave_0` and nothing else; the body is read
for a participant id and for nothing else.

**No anonymous execution.** These routes record and answer. They issue no
session, no token and no capability — what an admitted participant may then *do*
is the existing authentication and permission surface's decision, unchanged.

**Off unless switched on.** `RELAY_BETA_ENABLED=1`, and without a mounted state
root there is no store, so the routes answer `beta_not_ready` rather than
recording an enrolment that would not survive a restart.

## Opening the wave

`RELAY_BETA_WAVE_0_OPEN` — three states from one variable:

- unset, or anything else → **`not_open`** (admits nobody)
- `1` → **`open`**
- `closed` → **`closed`**

An unset variable meaning `not_open` is the only thing a missing decision can
honestly say, so **opening the controlled public beta is a deliberate act by
whoever sets it, never a side effect of deploying.**

Wave 0's cap is **100 seats**, set in `main()` from `WAVE_0.md`, because it is a
deployment decision — the gate does not choose any wave's cap. Waves 1-3 are
deliberately unconfigured, so `/beta/status` reports them as `unconfigured`
rather than showing them merely closed.
