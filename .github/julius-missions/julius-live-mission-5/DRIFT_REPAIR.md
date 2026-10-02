# Mission 5: drift repair, 2026-10-02 (founder-approved)

## What drifted

- Mission 5 was a SLICE mission. Its deliverables were copied from `main` at whatever revision a run dispatched from.
- On 2026-09-28, #288 (`c833e268`) implemented `julius-context-integrity.ts` by hand and wired it into `julius-runtime.ts` and `julius-context-snapshot.ts`.
- From then on the slice handed the coder a solved mission: the declared test passed 21/21 before any edit.
- Nothing caught it. `scripts/julius-first-live-mission.test.ts` ran the "seed must FAIL" check on throwaway-tree missions only. Mission 4 drifted the same way.

## The founder's decision (2026-10-02)

Restore the ORIGINAL intended starting state ONLY as documented mission-drift repair. Specifically:
- restore the historical intended starting state;
- do not make the task easier;
- do not weaken the acceptance criteria;
- do not alter the objective;
- prove the declared test genuinely fails before Julius edits anything;
- freeze the repaired definition before any paid dispatch.

## What "original" means, in bytes

All four 2026-09-10 paid attempts were handed the same blobs. The table lists the blob ids; their GitHub `julius-live-mission-5-attempted` markers name the runs:
- 34485676189 at `bc32385e` (#248, the fixture commit);
- 34504244415 at `5909ae00`;
- 34515588859 at `ed81b12e`;
- 34529874100 at `ed81b12e`, COMPLETED.

| `workspace/` path | blob | what it is |
|---|---|---|
| `src/relay/mission/julius/julius-context-integrity.ts` | `7e09bf6d5c20b92672b921f76900a2d804a31994` | the deliverable: five functions throwing `context_integrity_not_implemented` |
| `src/relay/mission/julius/julius-runtime.ts` | `615a0d824c648992f40e60700bfb2b35c729e8ab` | a deliverable, NOT integrated. Its compile loop `break`s at the first overflow, which is the behaviour REQ 3 describes as "today" |
| `src/relay/mission/julius/julius-context-snapshot.ts` | `3b4b0a7ad75a969bb87d53ae39b5969c1bfb28da` | a deliverable, NOT integrated |
| `src/relay/mission/julius/julius-memory-trust.ts` | `6b6e5628f2ffaa42a592d817d11782b187560eb7` | read-only; Mission 4's STUB, so a call into it throws (REQ 13 is enforced mechanically) |
| `src/relay/mission/julius/julius-repair-lineage.ts` | `ff1ce20f7e102c98a53ca07d34f5f2286e5fd354` | read-only import closure |
| `src/relay/mission/julius/julius-context-integrity.test.ts` | `77dc2a44cb7145e1124b29e9ea4cf1e514aa97af` | the specification, unchanged since #248 |
| `.julius/loader.mjs`, `.julius/resolve.mjs` | `b811ab9107dbe59b25e0d92a84ff5ffd5e6c1ccd`, `c222c8c51867ffd31b66b6713dbcd11b92535fff` | the slice harness, byte-identical to `.github/julius-mission-slice/` (unchanged since #244) |

**`contract.json` is restored to its original bytes, blob `056b2425`.**
- It differs from the #288 contract (`72b9961a`) by ONE constraint sentence, which names `julius-segment-lineage.ts`, a file the original state does not contain.
- The objective, the 17 requirements, the 12 acceptance criteria, the limits ($30, 3 cycles, architect 20,000) and the test command are byte-identical to both.

## Why the whole slice, and not just the stub

- Putting the stub back over today's runtime and snapshot would hand the coder the INTEGRATE half of the objective, already done.
- Using the last unsolved `main` instead (`c833e268~1`) would hand over the compiler's skip-not-stop behaviour, which arrived on 09-15 (#269), and make REQ 3's "today" false.
- Only the 09-10 slice is the state the mission was written against and attempted from.

## Mechanism

- The workflow slices at the dispatched SHA, from a depth-1 checkout, and a seed overlay may never shadow a sliced file. So the original bytes cannot come through slice mode.
- The mission is therefore a throwaway tree (`workspace/`), with the harness vendored into `workspace/.julius/`.
- `slice.txt` and `seed/` are removed, because the rig requires exactly one mode.

## A property this repair gives up

`slice.txt` promised that a Mission 5 diff "applies straight back to the repository". It no longer does. **A Mission 5 diff is a patch against the 2026-09-10 source and must NEVER be applied to `main`.** What the mission measures is Julius, not this code.

## Proof before any spend: `dryrun/dryrun.sh` (zero spend)

1. Every workspace file hashes to the table above.
2. **UNFIXED:** the declared test exits 1, with 21 tests: 3 pass and 18 fail.
   - The 3 that pass are by design: the closed vocabularies, and the two backward-compatibility guards.
   - Every one of the 18 failures names `context_integrity_not_implemented`. There are 0 load errors.
3. **HALF FIX** (#288's module, nothing wired): **passes 21/21.** REQ 11 (INTEGRATION) is enforced by NO test and by NO acceptance criterion; only the Independent Reviewer enforces it.
   - On 2026-09-10 the reviewer did exactly that. The plan review raised `[major] INTEGRATION …`, and Julius ran one plan repair before the build.
   - The scorers check REQ 11 on `workspace.diff`. That scores the contract as written; it adds nothing to it.
4. **FULL FIX** (the module, the qualified compile path, and a snapshot that records the decision): 21/21. The no-claims path is byte-identical to 09-10 (REQ 12).

## Freeze

`.github/julius-mission-pins.txt` pins this directory's tree. The pin is changed only by a recorded founder decision.
