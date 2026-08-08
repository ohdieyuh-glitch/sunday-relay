# Controlled beta waves

**Status: THE ACCESS DECISION IS IMPLEMENTED AND PURE. NO STORE, NO ROUTE, NO
ENROLMENT PATH, AND NO WAVE HAS BEEN OPENED. NOBODY HAS BEEN ADMITTED TO
ANYTHING.**

Those are four different claims. The last one is the honest limit: this module
decides, and nothing yet records, serves or enforces the decision.

---

## What a wave is

A **named, capped, explicitly-opened cohort.** Wave 0 is the controlled public
beta; waves 1–3 are the private waves that follow.

A wave is not a date and not a feature flag. It is a decision someone made,
recorded durably, with a seat count that can run out.

## Why this is a domain and not a boolean

"Is this person in the beta?" has **five** answers, and a boolean collapses all
of them into "no":

| Refusal | What it actually means |
|---|---|
| `not_enrolled` | We hold no record for them. A fact about our records, not a judgement about them. |
| `wave_not_open` | Enrolled in a wave nobody has opened. |
| `wave_closed` | Enrolled in a wave that has been closed. Reopening is an explicit act. |
| `wave_full` | Their enrollment is beyond the wave's seats. |
| `occupancy_unknown` | We cannot count the seats taken, so we will not admit against a number we do not have. |

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

## Seats are decided by enrolment order

A participant admitted on Tuesday does not lose their seat because someone else
opened the app first on Wednesday. The wave's own enrollment list is the
authority, so a participant's position is stable wherever and whenever they
connect — and a participant beyond the seat count is over the line everywhere,
not merely unlucky about timing.

## Not implemented

The durable enrollment STORE · the enrolment path (nothing can enroll anyone) ·
the bridge route that would answer the decision · enforcement anywhere in the
product (no surface consults this) · opening a wave (all four are `not_open`,
which is the safe default and the current truth) · invitations · waitlists ·
per-wave entitlements or spend caps · any UI.

**No wave has been opened and nobody has been admitted to anything.** This
module is the decision, stated so the rest can be built against something that
already refuses correctly rather than against a boolean that would have to be
un-learned.
