# Controlled beta waves

**Status: THE DECISION, THE DURABLE STORE, THE ADMISSION ROUTES AND ENFORCEMENT
ON MISSION START ARE IMPLEMENTED AND WIRED INTO THE BRIDGE. NO WAVE HAS BEEN
OPENED IN PRODUCTION AND NOBODY HAS BEEN ADMITTED TO ANYTHING.**

Those are seven different claims and this file keeps them apart. The last one is
the honest limit: Relay decides and records, and no wave has been opened. The status line is pinned by
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

opening a wave (no artifact records any wave's state; there is no default
config, so "all waves are not_open" is true only because nothing configures one)
· invitations · waitlists · per-wave entitlements or spend caps · any UI.

And four more the first version of this list did not disclose, each needed in
week one of a real beta:

**EXPIRY** — no `endsAt`, and
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

**Idempotency is structural, not checked.** The record is written to a temp
file, fsynced, then `linkSync`ed into place — the same all-or-nothing,
exclusive, durable primitive `cron-claim-node.ts` uses. `linkSync` fails
`EEXIST`, so a second enrolment for the same participant *cannot* create a
second record, and the store reports `already_enrolled` **with the original
instant**, because the first instant orders the queue and a retry that replaced
it would move that participant's seat.

The first version created the file with `O_EXCL` and wrote the contents in place
afterwards, fsyncing neither — and review proved the consequence by running it:
**one genuinely failed write left a zero-byte file that permanently blocked that
participant and refused every other member of the wave forever**, with no repair
path anywhere in the product. The name was made durable while the contents were
not, so the crash window was every unflushed write.

**An uncountable directory answers `null`, never `0`.** Only `ENOENT` is
genuinely zero. Swallowing every error and answering zero made the gate's
reconciliation unsatisfiable — proven with `EACCES` and with file-descriptor
exhaustion — and the cap silently stopped existing, which is the exact defect
this store exists to close.

**The directory is contained, not merely well-named**, and a record must be the
one its filename names. A regex on an id is not containment (`cron-schedule-node.ts`
records that lesson from a planted symlink), and without the filename check the
store handed one participant another's identity — free on any case-insensitive
filesystem, where `Alice` and `alice` collide.

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

## Enforcement

`relay-bridge/beta-guard.ts`, called from `POST /relay-api/mission/start`.

**That is where it bites, and only there**, because that is the operation a
controlled beta exists to control: `registry.start` runs the real three-role
pipeline — Prompt Architect, Coding Agent, independent Reviewer — and spends
real money. Gating the API in general would be a different product.

**With the beta off it is not a gate.** The guard returns `null` and the route
behaves exactly as it always did. Turning the beta *on* is what makes admission
required — the only reading of "controlled" that does not silently change an
unrelated deployment.

**It adds a gate and never removes one.** `WAVE_0.md` requires that existing
authentication, permissions, Mission controls, usage limits, security boundaries
and verification all remain enforced; this runs alongside them. Admission is not
permission. A participant who is admitted and not authorised is still refused by
whatever already refuses them.

**No anonymous execution.** With the beta on, a request naming no participant is
refused `beta_admission_required`. One that names an unadmitted participant is
refused with **the gate's own reason** — `not_enrolled`, `wave_full`,
`wave_not_open`, `occupancy_unknown` — because "you never asked", "we are full"
and "it has not opened yet" are three different things for the person being
turned away to do next.

## What stops a stranger consuming the wave

Review filled all one hundred production seats with **anonymous requests in 671
milliseconds**, and found no way back: every real customer was number 101,
forever, and the only remedy was deleting files on the volume by hand. Seats
could even be consumed while the wave was still `not_open`, so the beta would
open already full.

Two things close that, and neither is a complete answer:

**The public route refuses a NEW request once the wave is full** — `429`, and it
records nothing. Someone who already holds a seat is still answered, because
they do hold it and saying otherwise would be false. Permanent destruction
becomes a bounded refusal.

**A seat can be given back, through a route an operator can reach.**
`POST /relay-api/beta/remove` (operator-only) frees one, and `removed: false`
for someone who was never there is the truth rather than a failure — the seat is
free either way. `store.remove` existed for one commit with no caller, which
made this claim true of a function and false of the product.

**The public route is no longer a membership oracle**, including on a full
wave. Its body is identical whether the request was a first or a repeat, and it
echoes the *request's* instant rather than the stored one. A full wave answers
`429` for members and strangers alike — skipping the cap for an existing holder
was kind and re-opened the oracle in the one state an attacker can create in
three seconds. The old body differed on `alreadyRequested`
and returned the stored `enrolledAt` — so anyone could ask "is this id in the
beta, and when did they join?", and since that instant orders the queue, the
answer also leaked their seat position. Probing was not passive either: a miss
created an enrolment, so enumeration *was* the exhaustion attack.

## The rate limit

`relay-bridge/beta-rate-limit.ts`, applied to `POST /beta/request` **before the
body is even read** — so a flood costs a map lookup rather than a volume read.

**Two limits, because one of them can be lied to.** The per-key limit (5 per
minute) rests on `x-forwarded-for`, which is the platform edge's word and not a
fact: a caller reaching the bridge directly can set a fresh value per request
and defeat it entirely. That is precisely why the **global** limit (60 per
minute, against 100 seats) exists — it is the bound that holds when the header
is a lie, and a test sprays 500 distinct keys to prove it stops at exactly the
global figure.

A refused request does **not** extend the window, or a caller who keeps
hammering could never recover — that would be a permanent ban nobody decided to
issue. Key tracking is bounded, so the limiter cannot be turned into the memory
attack it exists to prevent; beyond the bound the per-key limit degrades and the
global limit carries, which is the safe direction.

Neither limit is a security boundary on its own, and this document does not
claim otherwise.

## What a client must send

`participantId`, on `POST /mission/start` and `/mission/<id>/retry`.

Without it, **turning the beta on would not restrict the beta — it would turn
mission start off.** The guard shipped for one commit with no client able to
satisfy it, so every mission start from the website, the founder's included,
would have been refused `403` the instant the flag was set. `StartMissionRequest`
carries it optionally and `live-adapter.ts` sends it when the host supplies one;
a bridge with the beta off never reads it.

Retry is guarded for the same reason `start` is: it re-drives the same
three-role pipeline, so a mission begun while the beta was off could otherwise
be re-driven after it was on, by a caller the gate refuses.

## The blocklist

The one control the cap and the rate limit cannot substitute for: both bound how
much damage a caller can do, and neither lets an operator turn away someone they
have already identified as hostile.

`POST /relay-api/beta/block` and `/beta/unblock` (operator-only).

**Blocking takes the seat back**, in every wave. A block that left the seat held
would stop the caller and keep the damage.

**The block outlives the seat.** It is stored beside the enrolments rather than
inside a wave, so freeing the seat does not quietly let them re-enrol.

**A blocked participant is refused exactly as a full wave refuses** — same
status, same body. A distinct "you are blocked" would be a free oracle telling
someone their id is known and singled out, and it would tell them to come back
under another one. The operator's board still shows the truth.

**A block outranks an enrolment**: someone blocked *after* they were admitted
stops working, not merely stops signing up — the guard checks it before the
gate.

**An unanswerable blocklist blocks.** A store that cannot read its own blocklist
must not answer "not blocked" — that is the same uncountable-reads-as-empty
defect as the seat count, and here it would let through precisely the caller an
operator went out of their way to stop.
