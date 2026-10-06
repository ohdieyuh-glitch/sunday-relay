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
2. **Warning promotion is not reachable from a contract.**
   - The verification policy has `promotedWarningCategories`: a reviewer warning in a named category becomes a blocking finding, and the work is repaired.
   - The live composition (`relay-bridge/julius/live-composition.ts`) sets `reviewerRequired` and `maxRepairRounds` and never sets it.
   - No contract field reaches it.

## Options (for the founder and SECOND; none is chosen here)

- **A. Design the WITHOUT mission to be caught.**
  - The workspace seed holds a latent defect the change must touch.
  - An acceptance criterion makes a correct reviewer check exactly that.
  - Mission 5's "every seed must fail at start" guard is the existing pattern for a seed with a known starting defect.
- **B. Make warnings repairable for the pair.**
  - Wire `promotedWarningCategories` from the contract into the live composition. It is small, opt-in and absent by default; the WITHOUT arm (and only it) would declare it.
  - M2's reviewer produced two plan warnings. Under promotion, those would have become a plan repair and a re-review.
  - This changes what a paid mission does, so it needs its own reviewed change.
- **C. Decide the protocol for an empty WITHOUT arm before any spend.** For example:
  - re-run the WITHOUT arm under a pre-registered limit; or
  - count the pair as failed.

  "No early stop" fixes the order. It does not say what an invalid pair means.

Until one is chosen, C's four paid runs should not be dispatched. On today's record, the first WITH arm would almost certainly be refused.
