# Julius: the reviewer's envelope was three understatements deep

The deadline policy has been passing an affordability check built on numbers
none of which described the running system — and each understatement is what
kept the next one invisible.

No provider was contacted. No mission spent anything. **The review itself is not
made smaller anywhere**; its deadline goes up.

---

## 1. Three numbers, none of them true

| | said | actually |
|---|---|---|
| `requestsPerReview` | 2 | at least **5** |
| `MAX_REVIEWER_ATTEMPTS` | 6, "plan plus build" | enforced by **nothing**; six stages registered |
| bootstrap's engine model | `x 2` | its own copy of the same asserted 2 |

**The request count.** Paid Mission 4's `review:plan` attempt 2 **COMPLETED in
381,880 ms**, at a commit where the bootstrap wrote `request_timeout_seconds: 90`
and `api_max_retries: 0` into the engine profile, with an isolated `HERMES_HOME`
that leaves the model no toolset at all. Two requests can account for at most
`18,000 + 2 × 90,000 = 198,000 ms`. The review took nearly twice that.

**Why nobody noticed.** `analyticalWorstCaseMs` came to 360,000 — *below* the
400,093 ms longest observed duration — so `basis` read `OBSERVED_CENSORED` and
the analytical number never bound anything. A model too small to bind is a model
nothing checks.

**The attempt ceiling.** Its own comment called it "the retry ceiling on
`review:plan` plus the one on `review:build`" — two stages. The reviewer
registers six. And nothing outside that file and its mirror ever read the
constant: what actually bounded attempts was `MAX_TASK_ATTEMPTS` in the
pipeline. The denominator of the affordability check described a system that had
not existed for some time, and the check passed because of it.

## 2. Both numbers are now derived

`impliedRequestsPerReview` reads a **floor** off the durations we have watched.
Censored durations count too — a review Relay stopped needed at least that long,
so it made at least that many requests.

It subtracts the **measured** 18 s startup rather than the padded 180,000 ms
envelope, and the difference is deliberate: the inference removes wall clock
that was certainly *not* spent waiting on a provider, so using the larger
padding would credit the engine with time it may never have taken and understate
the count — the exact error being repaired.

`MAX_REVIEWER_ATTEMPTS` is now the product of the two numbers the dispatch path
enforces: the review stages a normal mission runs × the attempts the pipeline
grants each one. The bootstrap reads the derived request count from the same
policy instead of keeping a `2` of its own.

## 3. One pipeline attempt per review stage

`MAX_TASK_ATTEMPTS` gives every task three, which for a review is three provider
calls against the same packet, the same engine deadline and the same prompt. The
reviewer's observed failure is a request that outran the engine's own
per-request timeout; repeating it verbatim reaches the same wall and spends the
job's reviewer share doing it. That is a blind retry.

**A repair is not a retry**, and the distinction is the point. A reviewer that
returns `changes_required` has *reviewed*: the adapter returns `SUCCEEDED` with
failing evidence, and Julius routes a repair from that evidence. The repair is a
new task with its own id, its own parent and its own ceiling. Counting it as a
further attempt at the review would make a reviewer doing its job
indistinguishable from a reviewer failing at it.

## 4. What is not reduced

The envelope was corrected by telling the truth about the engine, not by asking
the reviewer for less:

| | before | after |
|---|---|---|
| per-attempt deadline | 480,112 ms | **756,000 ms** |
| engine room per request | 90 s | 90 s |
| in-adapter correction | bounded, 2 | bounded, 2 |
| review stages served | 6 | 6 |
| engine worst case vs Relay's window | *apparently* inside | 450,000 vs 756,000, genuinely inside |

Three attempts at 756,000 ms is 37.8 minutes inside the reviewer's 50-minute
share.

## 5. Also repaired, same family

`scripts/julius-reviewer-deadline.mjs` took `(model, observations,
headroomRatio)` positionally while `reviewer-deadline.ts` took one object. The
parity test compared only the default-argument output, so a mirror that "cannot
drift from the TypeScript derivation" agreed on the single call nobody
parameterises and diverged on every other.

## 6. Evidence

- **8 proofs** for the envelope, one per required property: one attempt per
  review stage *and the pipeline asking for it*; three attempts across a normal
  run; a repair minted as its own task; `changes_required` as a verdict rather
  than a failure; a deterministic timeout not repeating; the 50-minute share
  admitting the normal path; both constants derived and the bootstrap reading
  the derivation; and the review's own depth untouched.
- The **displaced deadline cases were repaired, not deleted**. The censoring
  rule is now proven against a model small enough for an observation to bind —
  the only arrangement in which that rule is observable at all — and the default
  case asserts the new ANALYTICAL basis with the reason it changed.
- **11 adversarial mutations, 11 killed, 0 survivors**: a review handed the
  generic three attempts again; the attempt ceiling and the request count each
  restated as a literal; the inference subtracting the padded overhead instead
  of the measured startup; the repair stages budgeted into the normal path; the
  pipeline no longer asking for the per-stage ceiling; the bootstrap modelling
  two requests again; the mirror's positional signature returning; and **three
  that make the arithmetic fit by shrinking the review** — less room per
  request, no in-adapter correction, and a review stage dropped.

## 7. Three existing cases changed, and one is a real trade

The live-mission drive encoded the old policy. Each was repaired rather than
deleted, and the safety property every one of them protects — *a reviewer that
cannot answer must never become a build that runs* — is unchanged and still
asserted.

- **"hangs on every attempt"** now asks once instead of three times. The
  coordinator still writes one `retry.scheduled`, because classifying the error
  is its job and a timeout genuinely is retryable; the pipeline declines, which
  is the same division that already let a SUPERVISED run stop on a retryable
  error. The terminal `task.failed` carries `RETRY_ATTEMPTS_EXHAUSTED`.
- **"hangs once and then answers still completes the run"** is the trade, and it
  is given up on purpose. That recovery is real — paid run 34306850331 is exactly
  it — but the retry that recovered 34306850331 is the same retry that spent
  three paid cuts on 34311556047 without learning anything, and the two are
  indistinguishable in advance. What replaces it is a deadline large enough that
  the first ask should not have to be lucky, plus the reviewer's own bounded
  in-adapter correction, which is untouched.
- **"the retried review is asked the same question"** kept the half that
  survives: no packet the reviewer is ever handed may contain Relay's own
  telemetry, now asserted over every packet rather than over a pair.

`JULIUS_HARNESS_MANIFEST.md` records one new edge — the bridge's provider stack
importing the kernel — which is `reviewer-deadline.ts` reading the domain's
enforced numbers, in the allowed direction.

- Full suite on the frozen tree: **10,344 passed, 0 failed**, 530 files passed
  (3 skipped files, 30 todo). Four-pass typecheck, `build`, `relay:build`,
  `relay:bridge:build`, repository boundary, parity, strict surface parity,
  `julius:harness:check`, six drills and `git diff --check` — all clean.
