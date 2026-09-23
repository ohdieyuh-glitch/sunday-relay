# Julius PR 12: the bodies a mission is judged on now outlive the process

**This is the wiring #285 deliberately left undone.** #285 built the durable
home, the schema, the identity rule and the three restart proofs, and wired
none of it to the live mission — the exchange was still a `Map<string,string>`
in one process, keyed per RUN. The harness manifest recorded that gap in those
words. This closes it.

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind. The attempt ceiling is untouched and no
paid-qualification parameter moved.

---

## Reads are attempt-exact. There is no "latest" on the live path.

That is the whole design, and it is worth saying why, because "give me the
newest diff for this run" is the obvious API and it is wrong:

```
attempt 1   captures DIFF A, is reviewed, is sent back for repair
attempt 2   runs, and its `git diff` capture FAILS
```

A reader asking for the latest DIFF — **in the run, or in the TASK, which has
the same hole** — is handed DIFF A. The reviewer then judges attempt one while
believing it judged attempt two, and records an approval that names the wrong
bytes. Nothing about that is visible: both artifacts are real, both digests
verify, and the answer is simply about the wrong round.

The per-run map bought its way out of this with `clear()`: a coder dispatch
erased the run's diff and test output before it ran, so a failed capture left
NOTHING rather than the previous round's body beside this round's test. That
is also precisely why a repair round destroyed the evidence explaining why the
repair was needed.

An append-only store cannot erase, so the guarantee is re-earned on the READ
side — and earned more strongly. A body this attempt never wrote resolves to
null, the existing `reviewer_implementation_absent` refusal fires unchanged,
and round one survives. **Absence and history stop being a trade.**

`clear()` is gone, not ported. `JuliusDurableArtifacts.latest()` survives for
what #285 built it for and the live port does not expose it, so no later edit
can reach for it by accident.

## Which attempt, and how it is known

`JuliusDispatchInput.reads` names the subject and the plan in force.
`juliusDispatchReadsFor` resolves both from the task graph, exactly as
`juliusContractSubjectTaskId` resolves a contract:

* the **SUBJECT** is the nearest ancestor in a DIFFERENT ROLE, so a review that
  paused to research still reaches the work rather than stopping at its own
  continuation;
* the **PLAN IN FORCE** is the last architect round that wrote one and
  succeeded.

`reviewSubjectTaskId` is not used. Slicing `:review` off a string names a task
and never an attempt, and turns a rename into a review of nothing that still
returns a verdict.

**Only a SUCCEEDED task is nameable**, and that is what makes its generation
safe to use as a name: claims take RUNNABLE work and recovery re-claims expired
ACTIVE leases, so nothing re-claims a task that has succeeded and its
`leaseGeneration` cannot move underneath a reader.

**No migration.** `julius_tasks.lease_generation` has existed since migration
011 and nothing surfaced it; `tasksForRun` now returns `JuliusTaskRecord`,
which carries it. `addTask` still takes a `JuliusTask` that cannot set one —
the store owns it.

## Evidence now points at something

All four `artifactRef: null` sites carried a comment explaining that a body's
only name was a key into a dying map, and that `plan:<runId>` would have told a
later reader "look here" for something they would never find. They carry the
durable reference now, **attempt-scoped**, so the next repair round cannot take
it over.

## Where the bytes go, stated rather than implied

`JULIUS_WORK_ARTIFACT_ROOT` when the operator mounts durable storage;
otherwise a per-mission directory under the system temp root. That survives a
PROCESS restart on this host — the restart `reviewer_plan_absent` was about —
and **does not** survive a host that is torn down. Not the workspace: bodies
written there would appear in the coder's own `git diff` and become part of the
change under review.

The preflight, which dispatches nothing, now holds an exchange that **throws**
rather than one that works, so "the preflight reaches no body" is structural
instead of incidental.

## The harness manifest is the record of the wiring

`local-artifact-store.ts` stops being declared "not composed", and
`durable-artifacts.ts`, `artifact-exchange.ts` and
`julius-work-artifact-postgres.ts` stop being kernel-dependant exclusions,
because the trace now reaches all four from the live root. That is generated
evidence that this PR did what it says, not prose.

---

## Mutation testing

Eight mutations, **8 killed** — but six on the first run and **two survivors**,
both guarantees this description already claimed. The second commit exists
entirely to close them, because the code was right and nothing would have
noticed it becoming wrong.

| Mutation | Result |
|---|---|
| `attemptOf` stops refusing a dispatch that cannot name its attempt | **survived**, now killed |
| the reviewer reads its subject at a FIXED generation | **survived**, now killed |
| the subject's attempt is hardcoded rather than the task's own | killed (7 tests) |
| a subject that has not SUCCEEDED becomes nameable | killed |
| the plan in force becomes the EARLIEST round | killed |
| the coordinator silently drops `reads` | killed (28 tests) |
| the exchange ignores the attempt when scoping | killed |
| the subject is the first parent, not the nearest in another role | killed |

**Fixing the reviewer's subject generation to a constant passed the whole
suite**, because every existing reviewer case happened to use generation 1 — so
"reads the exact attempt" and "reads any attempt" were indistinguishable, and
the exact-attempt read is the entire correction this PR exists to make.

---

## Proofs

**`julius-dispatch-reads.test.ts` (9)** — the subject is the subject's own
generation; a task id no convention would parse still resolves; a review's
research continuation climbs to the work; a subject that has not SUCCEEDED is
named as nothing rather than as something plausible; a missing parent and a
cycle name nothing; a revision supersedes the plan it revised; a guidance task
is not mistaken for a plan.

**`artifact-exchange.test.ts` (5)**, against the REAL content store on a real
directory — a body resolves in a process that never wrote it; a neighbouring
attempt, task, run or kind is not it; a failed capture is ABSENT while the
round that explains the repair is still readable; the cap is unchanged; and the
in-memory exchange adapter proofs use is keyed by the same identity, so a proof
cannot pass on a body the durable one would refuse.

**`julius-live-composition.test.ts` (+3)** — the subject at generation TWO with
generation ONE still present: the packet carries round two; an attempt whose
capture failed is REFUSED rather than answered with round one, while round one
stays readable; a review told no subject at all is refused rather than finding
one.

**`coding-agent-port.test.ts`** — the stale-diff case now asserts BOTH halves
(this round absent, round one intact); a dispatch with no attempt is refused as
`dispatch_attempt_absent` and stores nothing under generation 0, 1 or 2; and
the evidence case asserts a reference that RESOLVES where it used to assert
none.

---

## Not in this PR

* **REVIEW_PACKET and RESEARCH** have kinds and a durable home, and nothing on
  the live path writes them yet.
* The temp-root default is a real limit, not a durability claim. A host with
  mounted storage should set `JULIUS_WORK_ARTIFACT_ROOT`.
* The attempt ceiling (2 declared vs 3 operative) remains the founder's
  decision. The job stays 120 minutes with the coder's share at 40.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01WnXYV8DotyoRMAzyY9R62A
