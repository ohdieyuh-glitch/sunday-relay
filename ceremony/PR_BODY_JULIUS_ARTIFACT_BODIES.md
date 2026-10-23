# Julius PR 11: the durable home a mission's bodies will live in

**Read this first: this does not yet change what the live mission does.** The
live exchange still holds bodies in memory. This lands the durable home, the
schema, the record, and the attempt seam the wiring needs — with the three
restart proofs demanded of it — and the wiring follows as its own PR. The
reason is in "Why this is not one PR" below, and it is the lesson #284 taught.

No provider was called and no credential was read. There was no Anthropic,
OpenAI or xAI spend of any kind. The attempt ceiling is untouched, and no
paid-qualification parameter moved.

---

## The defect

A plan, a diff, the test output, the packet a reviewer was shown: Julius
produced all of them, decided on them, and kept **none** of them. They lived in
a `Map<string,string>` in one process, keyed per RUN. Two consequences:

- a restart lost every body, so a resumed run could not be reviewed at all —
  Julius refuses (`reviewer_plan_absent`) rather than approving nothing, which
  is right, and also means the mission simply stops;
- **a repair round overwrote the round before it.** A repair exists because
  something was wrong, and the evidence of what was wrong was destroyed by the
  attempt to fix it.

Meanwhile a complete, hash-verified, content-addressed store already existed —
staged-then-finalize, digest checked on write **and on read**, cross-tenant
refusal, path safety — wired to nothing.

## Identity is the attempt

`project / run / task / lease generation / kind`.

The lease generation is the fencing token that already separates attempts
everywhere else in this schema. `julius_tasks.attempt` is deliberately **not**
the discriminator: it counts execution admissions and can stall across a retry,
so two different attempts would collide on it.

Migration **024** adds `julius_work_artifacts`: append only, no UPDATE path at
all, `UNIQUE(run_id, task_id, lease_generation, kind)`, a 64-character content
hash, and indexes for the only two questions anyone asks — *the latest PLAN for
this task* and *everything this run produced*. Migration 019's
`julius_artifacts` is not reused: its scope is an executor invocation and its
foreign key requires one, which a worker attempt does not have.

`durable-artifacts.ts` composes the store with the record and **invents no
storage** — the bytes take the path tool artifacts already take, with the same
guarantees. It adds the one check a content store cannot make for itself: that
the bytes match the digest the RECORD carries, so a row and a body that
disagree are refused rather than reconciled in favour of whichever was read
last.

`JuliusDispatchInput` now carries the attempt, populated by the coordinator
from the claim it already holds. Without it an adapter cannot say which attempt
produced a body, which is precisely why every repair round overwrote the last.

---

## Proofs

**New proofs (26)** — written against the REAL content store on a real
directory. A "restart" means a new composition over the same durable stores,
which is what a restarted process finds.

`durable-artifacts.test.ts` (11) — **the three you asked for**:

1. a plan is written, the process dies, and it **resolves by its durable
   reference in a process that never wrote it**;
2. a diff and a test output are written, the process dies, and a reviewer
   retrieves **exactly the bytes Julius recorded**, byte for byte;
3. attempt 1 writes diff A and tests A, attempt 2 writes diff B and tests B —
   and afterwards **A still resolves**, while "the diff" means the latest round.

Plus what the store refuses: a second, different body under one attempt is a
typed conflict rather than a replacement; the same body twice is idempotent; a
body whose digest disagrees with its record is refused rather than returned; a
read naming the wrong attempt is refused by the content store's own scope; and
one tenant asking for another tenant's body is told **nothing at all** — null
rather than an error, because an error is an existence oracle.

`julius-work-artifact.test.ts` (15) — what makes one artifact a different
artifact (attempt, task, kind, run), what a record must say to be recordable
(a digest it could verify, a real size, a defined kind, an id that names its
own scope — the one a caller could forge), and the record's own rules:
idempotent for the same body, a typed conflict for a different one, no answers
across projects, and `latest` meaning the newest attempt **while the earlier
one stays**.

`julius-evidence-artifact.e2e.test.ts` (+1) — a retried task's two dispatches
are told **different** fencing tokens, which is the property the per-run key
could not express.

## Mutation testing

| Set | Run | Killed |
|---|---|---|
| PR 11 — identity, validation, the record, the composition, the seam | 13 | **13** |

Seven survivors on the first run, every one a real gap rather than a weak
mutant: the domain's validation was entirely untested, the memory store's
conflict rule and project scoping were only exercised through a path that
checked first, two tasks sharing an attempt number would have collided, the
content store's own scope was unasserted, and nothing pinned the attempt
reaching the adapter. All are now tests.

## Gates at the frozen head

Frozen head `c60b9d71aa4c32e66cce7ec0dc4f23dcde567203`, tree `6cabf65c624fb675fe9dc5d473158c09c15ca39e`, on trusted main
`c0bafdaee40d7a650d7c07109cfd1fdb8b719c9b`.

- `npm run typecheck` (four passes) — exit 0
- `julius:harness:check` — OK; `git diff --check` — clean; no NUL byte in any
  tracked source file (the gate from #284)
- `relay-repository-boundary.mjs`, `build`, `relay:build`, `relay:bridge:build`,
  `relay:hermes:build`, `relay-parity-gate.mjs`, `relay:surface-parity:check`
  and `:strict`, `relay:yc-demo:check`, `relay:cli:contract-verify` — all exit 0
- Julius kernel + bridge + persistence — **2 565 tests, 12 failing**: the eleven
  Windows file-mode/permission failures verified identical on an untouched
  baseline earlier in this sequence, plus the `julius-slot-envelope` dynamic
  import that times out at 5 s under load and passes alone.

**CI on the frozen head, all green:** Verify Relay (10m58s),
`first-live-topology` both jobs, `sibling-control-plane`, and the Vercel builds.

**The first push failed Verify Relay, and the reason is worth keeping.**
`julius:harness:check` verifies the manifest is CURRENT;
`export-julius-harness.test.ts` additionally asserts that every included file
maps to a subsystem the export DECLARES. The two new kernel files were filed
under an inverted name no subsystem carries, so the manifest regenerated
cleanly and only the test refused it — a local gate that passes is not the same
as the suite that guards it. A third commit files them under
`ARTIFACTS / EVIDENCE`, which is where they belong.

## Why this is not one PR

Wiring the live exchange converts `LiveArtifactExchange` to async across **56
call sites outside `live-workers.ts`** plus 16 inside it. Landing that in the
same change would bury the thing worth reading — the schema, the identity rule
and the three restart proofs — under several hundred mechanical `await`
insertions. #284 was about exactly this: a change nobody can read is a change
nobody reviewed.

So the sequence is deliberate and stated rather than hidden: the harness
manifest records `durable-artifacts.ts` and the PostgreSQL record as **not yet
reached by the live composition**, in those words, so the gap is in the
generated record and not only in this description.

## Not in this PR

- **The live exchange still holds bodies in memory.** Next PR.
- The attempt ceiling (2 declared vs 3 operative) remains the founder's
  decision. The job stays 120 minutes with the coder's share at 40.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
