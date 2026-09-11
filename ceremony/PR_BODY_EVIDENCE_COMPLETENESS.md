# Julius: five of the paid proof's eight answers never left the database

Follow-up to #253, which closed the five blockers the zero-spend qualification
found and named a sixth as a "secondary instrumentation gap" — the evidence
exporter still sorting by `occurred_at`. Working that gap found it was not
secondary and not only about ordering.

Nothing paid ran. No provider was contacted. No mission authorises research.

---

## The finding

`buildJuliusSlotMissionReport` has **no production caller**.
`.github/julius-live-evidence-dump.sh` is the only hop that survives a paid job
— and it exported none of `julius.worker.effort`, `checkpoint.recorded` /
`checkpoint.verdict`, or `research.retrieved` / `research.refused`, and never
selected `slotRefusal`.

§6.5 of `docs/JULIUS_CONTINUOUS_ARMING.md` names, for each of the eight
questions the paid run exists to answer, the FIELD that answers it. Five of
those fields are carried by those three event types. They were written durably
and destroyed with the database.

A bundle could have been collected, correctly ordered, credential-scanned and
published, and answered none of **A** (did all three work throughout), **C**
(did the coder research independently), **E** (did checkpoint barriers move the
coder) or **G** (was a slot shallow because of architecture or because the
mission needed less). It is the same defect #250 repaired one layer down — six
architect diagnostics allowlisted, five added to no query at all — arriving
again between the runtime and the artifact.

## `occurred_at` is not an ordering

Events of one mission routinely land in the same millisecond and the sort has no
tiebreak, so the tie goes to whatever order the planner returned. Reproduced on
a real, fully migrated PostgreSQL — six settlements sharing one timestamp:

| `ORDER BY e.occurred_at` | `ORDER BY e.stream_id,e.sequence` |
|---|---|
| run-B 3 INDEPENDENT_REVIEWER | run-A 1 PROMPT_ARCHITECT |
| run-A 2 CODING_AGENT | run-A 2 CODING_AGENT |
| run-B 2 CODING_AGENT | run-A 3 INDEPENDENT_REVIEWER |
| run-A 3 INDEPENDENT_REVIEWER | run-B 1 PROMPT_ARCHITECT |
| run-A 1 PROMPT_ARCHITECT | run-B 2 CODING_AGENT |
| run-B 1 PROMPT_ARCHITECT | run-B 3 INDEPENDENT_REVIEWER |

The left column is a bundle any careful reader would take as the reviewer having
worked before the architect.

## What changed

**All seven event dumps** select `e.stream_id AS run_id,e.sequence` and order by
both. `sequence` is the position the ledger ALLOCATES on append, out of
`stream_sequences` inside a SERIALIZABLE transaction, with
`UNIQUE(stream_id,sequence)` behind it — app-allocated rather than a Postgres
SERIAL, so it cannot gap and two events of one run cannot share one. It is the
same column `julius-slot-report.v1` projects its chronology from, so the report
and the bundle cannot disagree about what came first. Both columns are needed: a
sequence is scoped to ONE stream and a Julius event's stream is its run.
`occurred_at` stays exported; it is only no longer the key.

**`effort.tsv`** — what a worker DID: tokens, tool and research calls, active
time, Julius's own `brainRetrievals` and `evidenceInspected`, what was allocated
against what settled, and the settlement basis. Every dimension keeps its own
column because a blank has to be readable as UNKNOWN rather than as zero.

**`participation.tsv`** — whether a worker ever STOPPED, asked, and was made to
wait: both checkpoint rows and the three guidance rows, with the route and its
reason beside the checkpoint that raised it, because a barrier that minted no
continuation is a stall rather than a barrier working. The checkpoint's own
`sequence` is its position within one dispatch and is exported as
`checkpoint_sequence` so it can never be read as the ledger's.

**`research.tsv`** — the research budget's durable truth. The mediator projects
its per-role meter by folding these rows, so the bundle can now show that a
restart remembered what a slot had already spent, and that all three slots could
reach the outside world at all. The eight outcomes stay eight; `counted` says
whether the ask was CHARGED, not whether it succeeded.

**`budget.tsv`** gains `slotRefusal` beside the collapsed `EXHAUSTED`, and keeps
`allocationPolicy` next to it: a run decided under `julius-allocation.v3` and one
decided under v1 are not comparable and the bundle has to say which it was.

## The completeness rule runs from the emission outward

Listing columns and checking they parse proves the columns exist and says
nothing about a key the pipeline writes and nobody exports. The new cases read
the `facts` object out of the production source and require a column for every
key in it, with one written exemption: `worker.effort` writes the same number
twice, as `usdMicros` and as `settledUsdMicros`.

Named fact keys only, as everywhere else here. Every value is a count, a digest,
a closed-union token or one of this repository's own identifiers; no prose, no
packet, no provider text and no whole payload has a column in any of them.

## Two files are NOT moved, and say so

`julius_trajectory_events` is not the event ledger and has no sequence column at
all — it keeps `occurred_at,trajectory_event_id`, deterministic but arbitrary —
and the cost rollup is an aggregate whose order is its grouping. A case fails if
that table ever gains a sequence the dump does not use.

## Two records corrected rather than left standing

§6.5's row A said the report carried no position, and its closing paragraph told
the reader not to dispatch the paid run believing A was answerable. Both were
true when written. What is still true is stated too:
`buildJuliusSlotMissionReport` has no production caller, so the paid job
publishes the rows the report projects from, not the report.

## Evidence

- **16 mutations run, 16 killed.** Among them: one dump quietly returned to the
  wall clock; the position dropped from a SELECT; the run id dropped; a new
  event dump added unordered; `researchCalls`, `trigger`, `outcome` and
  `slotRefusal` each dropped from their dump; the effort dump removed entirely;
  a participation dump pointed at a type nothing emits; and **a new fact key
  added to the `worker.effort` emission and exported nowhere**, which is the
  mutation that proves the completeness rule runs in the direction that matters.
- **One mutation killed the first version of the new guard itself.** It asserted
  `toContain('e.sequence')` against the whole query, which the `ORDER BY` clause
  satisfies while the column is missing from the SELECT. It now reads the select
  list alone.
- **All 18 dump queries executed against a real, fully migrated PostgreSQL** —
  the same thing the `first-live-topology` job does on this PR.
- Full suite on this head: **10,335 passed, 0 failed, 529 files, 3 skipped, 30
  todo**. Four-pass typecheck clean; `build`, `relay:build`,
  `relay:bridge:build` clean.
- `relay-repository-boundary.mjs`, `relay-parity-gate.mjs`,
  `relay:surface-parity:check:strict`, `julius:harness:check` all pass.
- Drills: `relay:cli:contract-verify`, `relay:yc-demo:check`,
  `relay:persistence:contract-verify`, `relay:persistence:recovery-drill`,
  `relay:workspace:verify`, `relay:claude:contract-verify` — all pass, no
  provider call.

## Incidental

Eight fragile finders hardened. Each took the first LINE of the dump script
mentioning a file name, so a prose line naming one was read as SQL — writing the
comment that explains this change broke the cost-rollup case exactly that way.
