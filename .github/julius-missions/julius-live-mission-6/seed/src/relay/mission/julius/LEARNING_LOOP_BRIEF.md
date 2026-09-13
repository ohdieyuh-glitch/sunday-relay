# Mission 6 brief — the learning loop

## What this mission builds, and what it does not claim

This mission builds Julius's learning loop in its kernel and proves it through
the in-memory harness. It does **not** claim that paid runs already learn. The
PostgreSQL store behind paid runs gains finding resolution in a later change.
Until then a paid run must say, on the record, that it could not learn.

## Where the kernel stands

Mission 4 gave Project Brain memory a trust standing. Mission 5 made context
construction consume it. Nothing produces verified memory. Read these places in
`julius-task-pipeline.ts` before planning:

- `repairContextFindings` compiles a repair round with the OPEN blocking
  findings on its immediate subject only. The second round of a repair repairs
  the first round's work and is never told what the first round was fixing.
- Findings are recorded from a reviewer's FAILED `REVIEW_FINDING` evidence in
  `verifyExecutedTask`, and nothing ever changes their status.
- The accepting decision of a repair lineage is recorded, and the dependent work
  is released, in the `ACCEPT` / `COMPLETE` branch of `verifyExecutedTask`.
- A verification `DECISION` is appended to Project Brain scoped to the decided
  task, which is never dispatched again.
- `compileJuliusContext` in `julius-runtime.ts` packs entries in array order and
  stops at the first that does not fit.
- The run loop's `advanceRun` re-verifies finished work on every pass through
  `resumeUnverifiedTasks`, including reviewer tasks, which never receive a
  decision of their own. Anything that changes what verification counts changes
  what those passes decide.

## The loop

1. **Lineage.** A repair round, and the re-review of a repair round, is compiled
   with every OPEN blocking finding recorded on any task of its repair lineage:
   the lineage root and every repair between the root and the round. Root first,
   then by recording time, then by finding id. The existing refusal
   `repair_context_findings_dropped` covers all of them.
2. **Resolution.** When a decision makes a lineage effectively accepted (the rule
   in `effectivelyAcceptedTaskIds`), every OPEN blocking finding recorded on a task
   of that lineage becomes RESOLVED, attributed to the repair whose ACCEPT closed
   it. Record `finding.resolved` once per finding with `findingId`,
   `resolvedByTaskId` and `stage`.
3. **A verdict is never rewritten.** Resolution records what the lineage achieved.
   It does not make the work that was sent back acceptable on its own: that task's
   current decision stays REPAIR however many times the run loop re-verifies it.
4. **Lesson.** Each resolution appends one Project Brain entry with
   `juliusLessonAppend`: run-level, kind `REPAIR`, id `brain:lesson:<findingId>`.
   Record `lesson.recorded` with `entryId`, `findingId` and `resolvedByTaskId`
   when the entry was actually written.
5. **Delivery.** When a compiled context's run holds any learning entry,
   `context.compiled` carries `lessonsDelivered` and `lessonsWithheld`, counted by
   `juliusLessonDelivery`. A lesson the character budget cannot fit is counted as
   withheld. It does not refuse the dispatch, and it is never silently absent.
6. **Recurrence.** When a newly recorded blocking finding repeats a RESOLVED
   finding of another lineage (`juliusRecurrenceOf`), append
   `brain:lesson-not-held:<findingId>` with `juliusLessonNotHeldAppend` and record
   `lesson.recurred` with `findingId`, `recurrenceOf` and `entryId`. The repeat is
   still an ordinary blocking finding and is repaired as one.
7. **A store that cannot resolve.** `resolveFindings` is an optional store method.
   When a decision would resolve findings and the store has no such method, record
   `learning.unavailable` once for that lineage with `reason:
   'STORE_CANNOT_RESOLVE_FINDINGS'` and `resolvable` (the count), and learn
   nothing. Accepting a different lineage later does not report it again.
8. **Replay.** Every write is keyed. A replayed tick, a re-verification or a
   second pass writes no second entry, event or status change, and the Project
   Brain revision counts entries exactly.

## The recurrence key

A record of repetition, never a judgement of similarity. The key is the base
stage (`repair:repair:build` folds to `build`) plus the claim after removing only
presentation: letter case, runs of whitespace, one leading bracketed tag such as
`[blocking]`, and trailing punctuation. Word order and punctuation inside the
claim are part of what it says.

## What the repository expects of the change

The sandbox runs these tests without type-checking. The repository type-checks
with `exactOptionalPropertyTypes`, and event facts must be
`Record<string, string | number | boolean | null>`. Write code that would pass.

The new event types belong in `JULIUS_OPERATIONAL_EVENT_TYPES` beside
`finding.recorded`. No existing type is renamed or removed.
