# Julius PR 8: a decision and the history that explains it commit together

The PR #280 residual, audited on trusted main `3203b6d7` — and the audit did not
end where it started. What follows says what was looked for, what was actually
found, and what turned out not to matter.

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind. The attempt ceiling is untouched, and no
paid-qualification parameter moved.

---

## What the residual was NOT

The reported residual was that live operational event ids are random UUIDs, so a
replayed operation might mint a new row instead of reaching PR #280's idempotent
append. Four provider-free crash probes were written before any code changed.

**Crash at every durable write, four run shapes, resume each time.** 86 to 270
durable writes per shape; **435 crash points reached**; every resume driven to
terminal. **Zero duplicate semantic events.** The claim, the lease and the
result idempotency key already stop a resumed process re-entering work it
finished. Making every operational event id deterministic would have been a
large change chasing a consequence that does not occur, so it was not made.

**A material challenge nobody resolves** concludes correctly — a REPAIR decision
and an honest stall. No defect.

## What it WAS: a decision no history could explain

A verification writes its decision FIRST and the events that explain it after.
Killing the process in between leaves, **permanently**:

| | |
|---|---|
| the decision | present |
| the release of the dependent task | present — same write |
| `verification.decided`, `task.runnable`, the peer transitions | **gone** |

The next resume writes nothing, because the stranded sweep skips a task that
already has a decision. There is no second chance, and nothing detects it.

The behaviour is right and the **record** is wrong: a run's own history cannot
say that a verification was decided, or that a build became claimable, while the
rows saying exactly that stand beside it. That is what a ledger exists to
prevent.

**The fix is what the port already claimed for the release.** `appendDecision`
documented "the decision and its release are one write … so no crash can leave
an accepted plan with a build that nothing will ever release". The events
explaining both now go in that same write — one PostgreSQL transaction (already
`SERIALIZABLE`, so no guarantee moved), one synchronous call in memory. An
event the write cannot accept takes the decision and the release down with it.

## Where deterministic identity actually earned its place

**Not** in preventing duplicates. A duplicate decision writes nothing at all, so
its events cannot be written twice whatever they are called — the first mutation
run proved it: replacing the derived id with a minted one killed no test.

It earns its place in being **askable**. `juliusDecisionEventId` derives an
event's id from the decision's own idempotency key, so a reader holding a
decision row can compute the id of the event that must explain it and go and
look for it. With `${kind}:${randomUUID()}` there is no question to ask — the id
is a fact about whichever process happened to write it. An unexplained decision
is the state this PR makes impossible; being able to ask is what makes that
checkable rather than merely intended, and there is a proof that fails without
it.

## The second defect, found by the same probe

`advanceRun` had **no terminal-run guard**. Work whose review FAILED is
SUCCEEDED-and-undecided for good — no review can conclude now — so the stranded
sweep found it on every pass and wrote another `review.started` each time:
**80 of them under 80 different ids**, growing a finished run's ledger without
bound for as long as anything advanced it.

The live driver returns as soon as a run is terminal, which is why nothing had
run into it — a property of one caller, not of the run. A finished run is now
swept by nobody, and the terminal vocabulary is exported from one place instead
of being restated.

---

## Proofs

**New proofs (33: 25 offline, 8 on real PostgreSQL)**

- `julius-decision-history.test.ts` (12) — the six contract cases on the
  in-memory store; **the invariant swept**: every point a process could die,
  asking each time "if the decision is there, is its history there too?"; the
  cases run against a store that loses events, because a case that cannot fail
  proves nothing; what makes an event's derived name the same and what makes it
  different; and a structural check that the decision path still validates.
- `julius-decision-history.e2e.test.ts` (7) — through the real pipeline: a
  resumed verification that dies the instant after its decision lands still
  explains itself; the history goes in **through** the decision, not as separate
  appends after it (asserted by watching the event port); a reader finds the
  explaining event from the decision row alone; three replays leave one decision
  and one announcement; one decision releasing two tasks announces both under
  names of their own; **the FAILED-run livelock, reproduced and closed**; and a
  COMPLETED run that ten advances cannot grow.
- `julius-decision-write-postgres.test.ts` (6) — the PostgreSQL half without a
  database: the shared append writes the event and its outbox row and opens no
  transaction of its own, is idempotent for a replay, raises the typed conflict
  for a rewrite, refuses a run this project does not own, and validates before
  it writes anything; plus a structural check that the decision's transaction is
  what calls it.
- `julius-decision-history.real-postgres.test.ts` (8, CI `first-live-topology`)
  — the same six cases on the real schema, plus the two only a database can
  show: **an event that cannot be written rolls the decision and the release
  back with it**, and a release and the row announcing it are visible together
  or not at all (outbox included).

## Mutation testing

| Set | Run | Killed | Equivalent |
|---|---|---|---|
| PR 8 — the decision write, both stores, the id, the terminal guard | 20 | 20 | 0 |
| PR 1 - PR 7 regression, at this head | 243 | 239 | 4 |

Two PR 8 survivors on the first run, both closed rather than argued away:
`compose` losing its validation (no proof that the decision path still refuses a
fact nothing may record), and only COMPLETED counting as finished (the FAILED
half — the very livelock this PR closes — was untested). The second survivor is
why the FAILED-run reproduction is in the suite.

**The four regression mutants this head does not kill, each measured rather than
asserted.** Eight more needed re-anchoring, not excusing: PR 7's five carry a
killing proof that arrived in its third commit after the mutants were written,
and three name lines this PR MOVED when the in-memory append became shared with
the decision write. Re-anchored and re-run, all eight are killed here, as is
C2-M17 with the PR 4 proof that closed it at #277.

| mutant | why it is not killed |
|---|---|
| C3-M16, P3-M15 | the equivalents documented at #270 and #275 |
| **C3-M14** — held work waits for the idle sweep | killed at the PR 7 head by a SECOND `verification.decided` event. The store had refused that decision as a duplicate, so the old code was announcing a decision it had not recorded — exactly what this PR stops. The detector was the defect. Verified by applying the mutant on a pristine `3203b6d7`: the assertion that failed reads `verification.decided` **events**, not decision rows, and the duplicate row never existed. |
| **P4-M23** — the research-failure reason on every advance | killed at the PR 7 head by advancing a run that had already FAILED. A finished run now writes nothing at all, which is strictly stronger than writing the reason once. Confirmed by re-running the mutant with the terminal guard disabled: it is killed again. The `!recorded` guard itself is untouched. |

Neither is a protection removed; both are detectors that depended on behaviour
this PR corrects. They are recorded here because a survivor that used to die is
the one thing a regression sweep must never wave through.

## Gates at the frozen head

Frozen head `43d1463011d83de578ef9f1c3f8efebcf267802c`, tree `27ae987e8b9cdbe9a4b89387a6b24f0399598ce3`, on trusted main
`3203b6d7f75ea9d286066f96bb47a9e7b9e9300a`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK; `git diff --check` — clean
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check`
  and `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Julius kernel suite — 87 files, 1 717 tests, 1 failing: the
  `julius-slot-envelope` dynamic import that times out at 5 s under load and
  passes alone, seen on every recent head.
- Broad `vitest run`, whole suite, compared failure by failure against trusted
  main in a separate worktree: **12 003 tests on the branch against 11 969 on
  main** (the 34 new proofs), 278 failing against 175. **No main-only failure.**
  The 103 branch-only failures are all in the load-sensitive
  `ship-runner` / `ship-route` / `ship-mission` / `repository-source` group that
  spawns git and processes; re-run alone, 100 of them pass, and the remaining
  three (`ship-route`) **fail identically on the untouched baseline**. Nothing
  branch-only survives isolation.

**CI on the frozen head, all green:** Verify Relay (11m01s), `first-live-topology`
both jobs — host-visible and executor-private — `sibling-control-plane`, and the
Vercel builds.

**The real-PostgreSQL job earned its place immediately.** The first push failed
all eight of its cases in setup: the suite seeded `julius_tasks` with a
`mission_id` and a `dependency_ids` column, and the real table has neither — the
run carries the mission, and dependencies are their own table. A laptop with no
PostgreSQL cannot find that, and a suite that only ran in memory would have
shipped it. The fourth commit seeds the columns that exist; nothing in the
production change moved.

## Not in this PR

- **Operational event ids outside the decision path remain random UUIDs.** The
  probes show this costs nothing on the crash paths that exist today, and every
  event written inside a durable operation now takes its identity from that
  operation. Extending derived identity to the rest of the ledger is available
  and is not justified by any defect yet found — reported, not hidden.
- The attempt ceiling (2 declared vs 3 operative) remains the founder's
  decision. The job stays 120 minutes with the coder's share at 40.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
