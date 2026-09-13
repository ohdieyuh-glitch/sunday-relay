# Official Mission 6 — the learning loop

The first mission after the continuous-worker qualification gate. It follows
the canonical roadmap: M1 → M5 (Context Integrity, verified) → qualification
gate → **M6 Learning Loop** → M7 … M12. The fixture is
`.github/julius-missions/julius-live-mission-6/`, and its proof is
`scripts/julius-live-mission-6.test.ts`.

## The rung

Mission 4 gave Project Brain memory a trust standing, and Mission 5 made
context construction consume it. **Nothing produces verified memory.** The
kernel pays an independent reviewer to find a defect, a repair to fix it and a
second review to accept the fix. Then it keeps none of that where later work
can see it. Mission 6 makes Julius produce memory from its own verified
outcomes and carry it to later work in the same run.

## The seams, found rather than invented

These are the facts at `43d8c36e`:

| Seam | What the kernel does today |
|---|---|
| `repairContextFindings` in `julius-task-pipeline.ts` | A repair round sees only its immediate subject's OPEN findings. Round two repairs round one and is never told what round one was fixing. |
| The finding write in `verifyExecutedTask` | Findings are recorded, and no path ever changes their status. |
| The DECISION brain write | It is scoped to the decided task, which is never dispatched again, so no worker reads it. |
| Recurrence | A later review that repeats a fixed finding is not recognised. |
| `resumeUnverifiedTasks`, called on every `advanceRun` | Finished reviewer tasks are re-verified. They never get a decision of their own, so each pass re-derives their subject's verdict from its OPEN findings. |

The last row is the mission's trap. It was found by running the repository's
own suites against a private reference. Resolving a finding without protecting
verdicts makes the next pass record a fresh ACCEPT for work that was sent
back. That rewrites durable history, and
`relay-bridge/julius/julius-live-composition.test.ts` pins that history.

## The loop the mission builds

Full rules are in the seeded `LEARNING_LOOP_BRIEF.md`. In brief:

1. **Lineage.** A repair round and its re-review see every OPEN blocking
   finding of the lineage, root first. The existing dropped-findings refusal
   covers all of them.
2. **Resolution.** An effectively accepted lineage resolves its OPEN blocking
   findings through the store's optional `resolveFindings`. Each resolution is
   attributed to the accepted repair and recorded once with `finding.resolved`.
3. **Verdicts are never rewritten.** The task that was sent back keeps REPAIR,
   however often the run loop re-verifies it.
4. **Lessons.** Each resolution appends `brain:lesson:<findingId>`, a run-level
   `REPAIR` entry, and records `lesson.recorded`.
5. **Delivery.** `context.compiled` carries `lessonsDelivered` and
   `lessonsWithheld` whenever the run holds a learning entry. A withheld lesson
   never refuses a dispatch.
6. **Recurrence.** Repeats are matched by exact key: base stage plus the claim
   with only presentation removed. Similarity never counts. A repeat of a
   RESOLVED finding on another lineage leaves `brain:lesson-not-held:<findingId>`
   and records `lesson.recurred`.
7. **A store that cannot resolve** records `learning.unavailable` once per
   lineage and learns nothing.
8. **Replay** writes nothing twice, and the brain revision counts entries
   exactly.

## Decisions taken, with the formal session's review conditions

- **Within one run only.** Carrying lessons across runs needs a
  project-scoped Project Brain and a persistent store. That is a separate
  architecture decision; see `docs/JULIUS_LAB_PERSISTENT_RIG.md`.
- **The mission builds the module and does not claim paid runs already learn.**
  The objective and the brief both say so.
- **`resolveFindings` is an optional port method.** A store without it is
  reported, never skipped silently. `julius-store-conformance.test.ts` names
  PostgreSQL as a known gap and fails the day the gap closes without its entry
  being removed.
- **The test command passes `--experimental-transform-types`.** Plain type
  stripping refuses the parameter properties in the run loop, router and
  execution coordinator. The sandbox image floats on `node:22-bookworm-slim`,
  so `scripts/julius-live-mission-6-sandbox-proof.sh` runs the contract's own
  command inside that image.
- **The charge is narrow.** Six files are editable: the new module, the
  pipeline, the memory store, the ports, the event vocabulary and the
  verification runtime. The other 36 slice files are read-only kernel closure.
- **Lane and budget.** The mission runs in the `lab` lane, declared
  explicitly, with $60, 3 repair cycles and 20,000 architect output tokens.
  `web/read_item` on `nodejs.org` is granted to all three roles. Research
  observation reported `backend=relay_http_fetch result=observed`. The $60 is
  allocation-v3 input and must be refreshed to funded capacity before the paid
  run.
- **The recurrence key is exact.** The specification includes the negative
  cases: case- and whitespace-only differences are equal, and different words
  are not.

## Measurements

A private reference implementation and a held-out grader were used and are not
committed.

| Workspace | Existing spec | New spec | Held-out grader |
|---|---|---|---|
| Committed slice, stub | 12/12 | 1/20 | 1/12 |
| Private reference | 12/12 | 20/20 | 12/12 |
| Reference without verdict protection | 11/12 | 20/20 | 12/12 |

Every stub failure is intended: the pure cases fail on
`learning_loop_not_implemented`, and the kernel cases fail on missing behaviour,
not on loading. Inside `node:22-bookworm-slim`, digest
`sha256:83f487e0a63425e5b4d146fb5e5be574bcbe1b7b843d3ebafdd95eaf7767a7e5` with
Node v22.23.2:

```
existing specification alone: exit=0 # tests 12 # pass 12 # fail 0
contract test command:        exit=1 # tests 32 # pass 13 # fail 19
reference, contract command:  exit=0 # tests 32 # pass 32 # fail 0
reference, held-out grader:   exit=0 # tests 12 # pass 12 # fail 0
```

The reference was also run against the repository's own suites. Julius
mission, bridge, persistence conformance, live chain and drill suites gave
1,452 passed. The two failures were the known Windows `spawnSync npx ENOENT` and
the PostgreSQL `resolveFindings` gap, which the ratchet now names. Typecheck
reported 0 errors.

## What landing the mission's diff requires

These are formal-lane work, outside the sandbox:

1. Run `npm run julius:harness:export`. The pipeline gains an import, and the
   manifest's first-reach attributions move.
2. Give PostgreSQL parity for `resolveFindings`: `UPDATE julius_reviewer_findings
   SET status='RESOLVED' … AND status='OPEN'`, which needs no migration. Remove
   its `POSTGRES_KNOWN_GAPS` entry, pass it through the live composition's store
   wrapper, and prove it on real PostgreSQL.
3. Extend the evidence dump and Beta Gate to the new events, so a paid bundle
   can show a lesson reaching a worker. Today `project-brain.tsv` exports ids
   but not text, and the gate scores brain writes only.
