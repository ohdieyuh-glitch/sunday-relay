# Controlled Public Beta Wave 0 — the founder definition

**Status: DEFINED. NOT BUILT, NOT OPENED, NOBODY ADMITTED.**

This document records what Wave 0 *is*, so the work has something authoritative
to be measured against. Wave 0 previously had **zero specification anywhere in
this repository** — 0 files, 0 mentions — and was blocking the roadmap because
admitting who a beta serves, under what cap, is a product decision and not an
engineering inference. These are the founder's words, recorded on 2026-08-08.

---

## What Wave 0 is

**A publicly discoverable, open-signup beta whose actual product access remains
admission-controlled.**

Both halves are load-bearing. Anyone may reach the public Relay site and request
or join beta access — that is the "public" part. Reaching the site is not the
same as being admitted to run anything — that is the "controlled" part, and it
is what the access decision in `BETA_WAVES.md` exists to answer.

| Rule | |
|---|---|
| Admission cap | **At most 100 active beta users** initially |
| Raising the cap | **Not part of this goal.** It is not raised automatically. |
| Anonymous execution | **None.** No unauthenticated run, ever. |
| Public compute or spending | **Never uncapped.** |
| Scale | Wave 0 does **not** require unlimited scale or general-availability readiness. |

Existing Relay authentication, permissions, Mission controls, compute and usage
limits, security boundaries and verification requirements **remain enforced**.
Wave 0 admits people to the product Relay already is; it does not relax it.

## What an admitted user must be able to do

- Create and use a **Compound PSP Agent**
- Create **projects**
- Create and run **Missions**
- Use **Project Brain**
- Use the capabilities the roadmap marks required for Wave 0

**Complex Missions continue to require Prompt Architect + Coding Agent + an
independent Harnessing Reviewer.** Wave 0 does not create a cheaper path through
verification for beta users.

## When Wave 0 is "deployed and proven"

Only when **both** hold:

1. The production deployment is **healthy**, and
2. The admission-controlled public-beta path has been **verified end to end with
   real production evidence**, under Relay's existing verification standards.

Not when the code exists. Not when a wave is opened in a config file. The path a
real person walks — arrive, request access, be admitted or truthfully refused,
and then operate the product under the limits above — is what has to be shown
working in production.

## What this does not license

Wave 0 is a cap and a gate, not a relaxation. Nothing here authorizes raising
the admission cap, admitting anonymously, uncapping spend, or skipping the
independent Reviewer for a Mission that requires one.

---

## Where this stands

`src/relay/mission/beta/` holds the **access decision** — the five distinct ways
to refuse, and the rule that unknown occupancy refuses rather than admits. See
`BETA_WAVES.md` for what that module does and, more importantly, what it does
not: there is no store, no route, no enrolment path, and no enforcement, and all
four waves are `not_open`.

Recording this definition is the first requirement it closes. Everything else
above is still to build.
