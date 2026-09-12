# Julius: the reviewer's envelope was three understatements deep

Frozen candidate `relay/julius-reviewer-envelope`, 1 commit(s) over trusted main `74b9ee52`, authored and committed by `julius-worker[bot]`.

Step 6 of the nine-candidate path. Originally frozen at `8b294c48` on `9f155b91`; rebased onto `74b9ee52` after #256–#261 and re-authored as `julius-worker[bot]`. Patch-identical to `8b294c48` in every file except the GENERATED `JULIUS_HARNESS_MANIFEST.md`, which was regenerated with `npm run julius:harness:export` on the new base: it records the same one new edge (the bridge provider stack reading the kernel), counted from 3 to 4 instead of 2 to 3. This is the candidate that sets one pipeline attempt per normal review stage (plan, build, guidance: 3 × 1).

The deadline policy has been passing an affordability check built on numbers
none of which described the running system, and each understatement is what kept
the next one invisible.

FIRST, THE REQUEST COUNT. `DEFAULT_ANALYTICAL_MODEL` asserted that a review
makes two upstream requests. Paid Mission 4 falsifies it: its `review:plan`
attempt 2 COMPLETED in 381 880 ms at a commit where the bootstrap wrote
`request_timeout_seconds: 90` and `api_max_retries: 0` into the engine profile,
with an isolated `HERMES_HOME` that leaves the model no toolset at all. Two
requests can account for at most 18 000 + 2 x 90 000 = 198 000 ms. The review
took nearly twice that, so it made at least five.

Nothing caught it because the understatement hid behind the observation that
should have exposed it. `analyticalWorstCaseMs` came to 360 000, BELOW the
longest duration ever observed (400 093 ms), so `basis` read `OBSERVED_CENSORED` and the analytical
number never bound anything. A model too small to bind is a model nothing
checks.

SECOND, THE ATTEMPT CEILING. `MAX_REVIEWER_ATTEMPTS = 6` was described in its
own comment as "the retry ceiling on `review:plan` plus the one on
`review:build`" — two stages. The reviewer registers six. And nothing outside
this file and its mirror ever read the constant: the ceiling that actually
bounded attempts was `MAX_TASK_ATTEMPTS` in the pipeline. So the denominator of
the check described a system that had not existed for some time, and the check
passed because of it.

THIRD, THE BOOTSTRAP'S OWN COPY. `.github/julius-live-hermes.sh` computed
`HERMES_REQUEST_TIMEOUT_SECONDS * 2 * 1000` and compared it against Relay's
window. Same asserted 2. Its ordering check passed with 300 s of margin that did
not exist.

BOTH NUMBERS ARE NOW DERIVED.

`impliedRequestsPerReview` reads a FLOOR off the durations we have watched.
Censored durations count too — a review Relay stopped needed at least that long,
so it made at least that many requests. It subtracts the MEASURED 18 s startup
rather than the padded 180 000 ms envelope, and the difference is deliberate:
the inference removes wall clock that was certainly not spent waiting on a
provider, so using the larger padding would credit the engine with time it may
never have taken and understate the count — the exact error being repaired.

`MAX_REVIEWER_ATTEMPTS` is now the product of the two numbers the dispatch path
enforces: the review stages a normal mission runs, and the attempts the pipeline
grants each one. The bootstrap reads the derived request count from the same
policy instead of keeping a `2` of its own.

AND THE PIPELINE GRANTS A REVIEW ONE ATTEMPT.

`MAX_TASK_ATTEMPTS` gives every task three, which for a review is three provider
calls against the same packet, the same engine deadline and the same prompt. The
reviewer's observed failure is a request that outran the engine's own
per-request timeout; repeating it verbatim reaches the same wall, so the second
and third attempts buy nothing and spend the job's reviewer share doing it. That
is a blind retry.

A REPAIR IS NOT A RETRY, and the distinction is the point. A reviewer that
returns `changes_required` has REVIEWED: the adapter returns SUCCEEDED with
failing evidence and Julius routes a repair from that evidence. The repair is a
new task with its own id, its own parent and its own ceiling. Counting it as a
further attempt at the review would make a reviewer doing its job
indistinguishable from a reviewer failing at it.

WHAT IS NOT REDUCED. The envelope was corrected by telling the truth about the
engine, not by asking the reviewer for less. Every review stage survives; the
engine keeps its 90 s per request; the reviewer keeps its bounded in-adapter
correction; and the deadline each review gets went UP, from 480 112 ms to
756 000 ms. Three attempts at 756 000 ms is 37.8 minutes inside the reviewer's
50-minute share, with the engine's real worst case — 450 000 ms — now genuinely
inside Relay's window instead of apparently so.

ALSO REPAIRED, same family: `scripts/julius-reviewer-deadline.mjs` took
`(model, observations, headroomRatio)` positionally while `reviewer-deadline.ts`
took one object. The parity test compared only the default-argument output, so a
mirror that "cannot drift from the TypeScript derivation" agreed on the single
call nobody parameterises and diverged on every other.

Eight proofs for the envelope, and the displaced deadline cases repaired rather
than deleted: the censoring rule is now proven against a model small enough for
an observation to bind, which is the only arrangement in which that rule is
observable at all.

Eleven adversarial mutations, eleven killed, no survivors: a review handed the
generic three attempts again; the attempt ceiling and the request count each
restated as a literal; the inference subtracting the padded overhead instead of
the measured startup; the repair stages budgeted into the normal path; the
pipeline no longer asking for the per-stage ceiling; the bootstrap modelling two
requests again; the mirror's positional signature returning; and three that make
the arithmetic fit by shrinking the review — less room per request, no in-adapter
correction, and a review stage dropped.

THREE EXISTING CASES CHANGED, and one is a real trade. "A reviewer that hangs
once and then answers still completes the run" is given up deliberately: that
recovery is real — paid run 34306850331 is exactly it — but the retry that
recovered 34306850331 is the same retry that spent three paid cuts on
34311556047 without learning anything, and the two are indistinguishable in
advance. Each case was repaired rather than deleted, and the safety property
every one of them protects — a reviewer that cannot answer must never become a
build that runs — is unchanged and still asserted.

`JULIUS_HARNESS_MANIFEST.md` records one new edge, the bridge's provider stack
importing the kernel: `reviewer-deadline.ts` reading the domain's enforced
numbers, in the allowed direction.

No provider was contacted. No mission spent anything.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
