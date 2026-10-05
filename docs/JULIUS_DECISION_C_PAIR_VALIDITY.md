# Decision C: will a WITHOUT arm give its WITH arm anything to learn?

**Status:** evidence for the founder and SECOND, who own C's mission design.

Nothing here chooses a mission, changes a contract, or changes what a paid run does.

## Why it matters

The pair rule is strict:
- A WITH arm is valid only if its paired WITHOUT arm leaves at least one **VERIFIED_REPAIR_FINDING**.
- That means a blocking finding an independent reviewer raised, a repair addressed, and a re-review resolved.

If the WITHOUT arm leaves none:
- The WITH arm is refused **for free**, in its preflight (`CARRY_SOURCE_NOT_A_VALID_PAIR`, #326).
- The WITHOUT arm's own spend has still bought no valid pair.

Whether a real reviewer raises a repairable blocking finding depends on the mission, so it is a design question.

## What the paid record says

Every paid run in this repository's retained history (90-day artifacts, read 2026-10-04) was checked.

**How it was read:**
- Each bundle was fetched by its workflow run.
- Each archive's sha256 matched the `digest` GitHub recorded for it, 5 of 5.
- Each bundle's findings and their lifecycle were replayed through the carry's own eligibility rule.

| Workflow run | Mission (lane) | Julius run | State | Findings | Blocking | Repair tasks | Would carry (VERIFIED_REPAIR_FINDING) |
|---|---|---|---|---|---|---|---|
| 37222057584 | julius-live-mission-2 (regression), Decision A's evidence | `run:4bf13d0e…` | COMPLETED | 2 plan-review warnings (`review_warning`), OPEN | 0 | 0 | **0** |
| 37039013641 | julius-live-mission-6 (lab), a3 | `run:efb6e20f…` | COMPLETED | 0 | 0 | 0 | **0** |
| 36915013287 | julius-live-mission-6 (lab), a2 | `run:efb6e20f…` | COMPLETED | 0 | 0 | 0 | **0** |
| 36568129865 | julius-live-mission-6 (lab), a1 | none in bundle | failed before a run | n/a | n/a | n/a | **0** |
| 34995797200 | julius-continuous-1 (qualification) | none in bundle | failed before a run | n/a | n/a | n/a | **0** |

Four more paid runs (2026-09-13, continuous-1) and one first-live run (2026-10-02) kept only their attempt markers: no bundle.

**Result:**
- **0 of 5** retained paid bundles would have been a valid WITHOUT arm.
- All 3 completed runs passed review without a single blocking finding.
- M2's two warnings were retained, not promoted (`warningsPromoted: 0`), and nothing resolved them.

A mission that real workers complete cleanly is a good mission and a useless WITHOUT arm.

## Two facts the design must respect

1. **The same contract gives the same Julius run id.** Mission 6's a2 and a3 are both `run:efb6e20f…`, on two fresh databases.
   - So under the frozen order WITHOUT-1 → WITH-1 → WITHOUT-2 → WITH-2, the two WITHOUT runs share one run id, and so do the two WITH runs.
   - Their finding ids are derived from task ids, so they can match too.
   - This is why the carry records the **workflow run, commit and export digest** of the bundle it learned from: they are what distinguish WITHOUT-1's lesson from WITHOUT-2's (#326).
2. **Warning promotion was unreachable, twice over** (both found 2026-10-04; option B's PR addresses both).
   - The verification policy has `promotedWarningCategories`: a reviewer warning in a named category becomes a blocking finding, and the work is repaired.
   - **No contract field reached it.** The live composition set `reviewerRequired` and `maxRepairRounds` and never set it. A contract that wrote the key anyway was parsed without it, silently.
   - **No real warning had a kind for it to name.** The reviewer's JSON schema never asked a finding for a `category`. A real reviewer's minor finding therefore reached Julius as a warning of no kind (`null`), which no policy can promote. Wiring the field alone would have been inert on every paid review.
   - **So whether M2's two warnings would have been promoted is UNKNOWN.** Their findings record `review_warning`, the fallback for a warning of no kind, and the bundle kept no declared kinds.

## Options (for the founder and SECOND; none is chosen here)

- **A. Design the WITHOUT mission to be caught.**
  - The workspace seed holds a latent defect the change must touch.
  - An acceptance criterion makes a correct reviewer check exactly that.
  - Mission 5's "every seed must fail at start" guard is the existing pattern for a seed with a known starting defect.
- **B. Make warnings repairable for the pair.** Prepared on its own reviewed branch (`relay/julius-c-warning-promotion`, stacked on #326). Choosing it is still the founder's and SECOND's.
  - **The reviewer is asked for each finding's kind**, from the closed list the escalation already uses (`juliusReviewFindingCategoryGuidance`). The reviewer is told what a kind is, never what Julius does with one.
    - This changes the instruction text of **every** paid review.
    - It changes no behavior unless a contract promotes something: a kind on a blocking finding names its repair and changes no route.
  - **A contract may name the kinds it promotes** (`promotedWarningCategories`). The field is closed-list, refused rather than dropped when wrong, and part of the mission's identity.
    - The live composition passes it to the verification policy.
    - The run states it before any spend.
    - No committed contract declares it. The four frozen missions' binding digests are pinned, and unchanged.
  - **The bundle says what kind each warning was, and whether Julius promoted it** (`review-warnings.tsv`, tokens only). A WITHOUT arm's suitability is therefore readable from its own bundle before its WITH arm spends anything.
  - **Rehearsed on real PostgreSQL**, both arms real runs:
    - A WITHOUT arm whose contract promotes `contract_drift` turns the plan review's warning of that kind into a repair and a resolved re-review: one VERIFIED_REPAIR_FINDING. The bundle admits the pair, and the WITH planner receives it.
    - The same review under a contract that promotes nothing is refused for free (`CARRY_SOURCE_NOT_A_VALID_PAIR`).
  - **What it cannot promise:** that a real reviewer names a kind, or names one the contract promotes. That is the model's to do. The bundle will show it after each WITHOUT run, and `verify-carry` refuses a pair that taught nothing.
- **C. Decide the protocol for an empty WITHOUT arm before any spend.** For example:
  - re-run the WITHOUT arm under a pre-registered limit; or
  - count the pair as failed.

  "No early stop" fixes the order. It does not say what an invalid pair means.

Until one is chosen, C's four paid runs should not be dispatched. On today's record, the first WITH arm would almost certainly be refused.
