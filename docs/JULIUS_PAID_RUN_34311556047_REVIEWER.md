# Paid run 34311556047 — the Independent Reviewer timed out three times, and the evidence could not say why

**Trusted main:** `755d9d2222d4990ed6d57ad621552ccef57910f1` (PR #237, squash
merged at the reviewed head `ebcebe18`).
**Mission:** `julius-live-mission-2` — `mission:julius-live-2`, project
`prj-julius-live-2`.
**Control:** run 34306850331 on the same commit, which COMPLETED.
**Provider calls in this investigation: zero.** Everything below was measured
against a locally installed Hermes at the workflow's own pinned commit, pointed
at endpoints this repository controls. No credential for xAI exists in the
environment that produced these numbers.

This is the durable per-run record and the reasoning behind the repair that
accompanies it. It exists because run 34311556047 produced a failure the
uploaded evidence could not explain — the same reason `JULIUS_PAID_RUNS_2026_09_08.md`
exists, one role along.

---

## What the run did

| Stage | Outcome |
|---|---|
| Prompt Architect / `plan` | SUCCEEDED — artifact ARTIFACT/PASSED, 13,881 chars, `sha256:1979f450657aee9e…` |
| Independent Reviewer / `review:plan` | FAILED — TIMEOUT ×3, terminal `RETRY_ATTEMPTS_EXHAUSTED` |
| Coding Agent / `build` | **BLOCKED — never dispatched** |
| Verification | no decisions, 0 findings |
| Run | FAILED after 4 ticks |

**The safety behaviour was correct.** A review that did not happen did not
become a build that ran, and nothing in the repair below changes that.

The three failures are 180.183 s and 180.081 s apart. `RELAY_HERMES_TIMEOUT_MS`
defaulted to 180,000 ms, so each attempt consumed its entire window and the next
began roughly a tenth of a second later — `nextAttemptAt` is `now()`, with no
backoff. Every one of the three rows reads identically:

```
timed_out=true  output_bytes_observed=0  output_byte_limit=524288
process_exit_code=(null)  json_detected=false  verdict_present=false
failure_shape=review_timeout  julius_code=TIMEOUT  retryable=true
provider_http_status=(null)  served_model=(null)
```

## The first meaningful divergence from the control

Both runs are the same commit, the same workflow, the same pinned Hermes, the
same models. The architect leg is the same to within three seconds — 46.5 s in
the control, 49.6 s here, from run-accept to the first review dispatch.

The divergence is the reviewer's SECOND attempt. The control's first plan review
also timed out, at 03:27:44.952, with the identical zero-byte shape; its second
attempt answered, and the mission completed. Here the second and third attempts
produced nothing either.

And the control bounds how long a working review takes: everything after its
timeout — the successful plan review, the entire Coding Agent build with three
executor invocations, and the build review — fits in the 246 s between
03:27:45 and the step ending at 03:31:51. **A review that works finishes far
inside 180 s.** So this is not a review that needed 200 seconds. It is a review
where nothing arrived at all.

## Why the evidence could not distinguish the causes

Measured against the real Hermes v0.18.2 at the workflow's pinned commit
`2ea39da`, spawned exactly as `runHermesReview` spawns it (`env {PATH, HOME}`,
stdin ignored, `-z … --safe-mode --usage-file`):

| Probe | Endpoint behaviour | First stdout byte | Exit | Bytes |
|---|---|---|---|---|
| A | accepts, never answers | — | killed by SIGTERM in ~10 ms | 0 |
| B | accepts, never answers, left alone | **never** (killed at 420 s) | never | 0 |
| C | answers, stream unusable | 197.7 s | 0 | 142 |
| D | streams 8 tokens over 16 s | 34.7 s, **all at once** | 0 | 60 |
| D′ | as D, on a cold profile | 34.5 s | 0 | 60 |
| E | as B, with `request_timeout_seconds: 30` | **127 s** | 0 | 52 |
| E′ | as B, with `request_timeout_seconds: 80` | **227 s** | 0 | 52 |

Three things follow.

**1. Zero bytes means nothing on this transport.** `-z` does not stream: Hermes
buffers the whole assistant message and prints it in one write at the end. In
probe D the provider streamed for sixteen seconds and Relay saw its first byte
at 34.7 s, sixty bytes at once. `output_bytes_observed = 0` is therefore the
state of every in-flight review right up to the instant it finishes, and equally
the state of one whose provider was never reached. It was the only field the
bundle had, and it could never have answered the question.

**2. The engine had no deadline, so Relay's cut always came first.**
`get_provider_request_timeout` returns nothing unless `config.yaml` carries a
provider timeout, and `.github/julius-live-hermes.sh` wrote only `.env`. The
reviewer therefore inherited the OpenAI SDK default — 600 s per request,
`api_max_retries: 3` — putting the engine's own give-up around forty minutes
against Relay's three. Probe B is that configuration: 420 s, 30 connection
attempts, not one byte, no exit. Relay's guillotine fell first on every distinct
provider fault, and every one of them reached the record as the same shape.

**3. Cold start is not the explanation** for both runs' first attempt failing.
A fresh profile and a used one reached first output at 34.5 s and 34.6 s.

## The fifteen questions, answered

1. **Configured timeout** — 180,000 ms (`RELAY_HERMES_TIMEOUT_MS` default).
2. **Subprocess launch** — succeeded. A launch failure is a different shape and
   arrives in about a second.
3. **Process lifecycle** — alive for the whole window, ended by Relay.
4. **Provider request started** — *not knowable*; see (1) above. Relay reads a
   pipe, not a socket.
5. **Credential readiness** — resolvable: the bootstrap proves it through
   Hermes's own resolver and that step passed.
6. **Served model** — never knowable on a failure: it is read from the usage
   file, which only exists once a review finishes.
7. **stdout plumbing** — correct. **stderr is discarded entirely**, which is
   where the engine writes launch-level errors.
8. **Alive at timeout** — yes.
9. **Any provider response** — *not knowable*; see (1).
10. **Attempts independent** — yes: a new process and a new empty scratch
    directory each time.
11. **Stale process between attempts** — no. SIGTERM mid-request is honoured in
    about ten milliseconds and the CI wrapper `exec`s, so there is no orphan
    grandchild. The old code neither escalated nor confirmed; it was wrong and
    the binary was forgiving.
12. **Payload size** — 46,256 bytes on the wire, plan 13,881 chars. Not a factor.
13. **Provider latency versus our timeout** — *cannot be separated from (9)*.
14. **Retry changes nothing** — same prompt, same window, same profile, three
    times, about a tenth of a second apart.
15. **Enough diagnostic evidence** — **no.** That is the defect.

## The repair

Nothing about the requirement for independent plan review changes. A reviewer
that cannot answer still leaves the Coding Agent BLOCKED, TIMEOUT stays
retryable, and the ceiling stays at three attempts.

1. **`runHermesReview` records what the process did.** `processStarted`,
   `processPidObserved`, `firstOutputObserved`, `firstOutputAfterMs`,
   `elapsedMs`, `timeoutMs`, `exitObserved`, `signalSent`, `cleanupCompleted`.
   `providerRequestStarted` is always `null` on this transport and says so:
   unknown is not zero. All ten pass the domain allowlist and are dumped into
   `worker-diagnostics.tsv`.
2. **A timeout ends the process and proves it.** SIGTERM, a bounded grace,
   SIGKILL, a second grace, and only then the report — and only then the removal
   of the scratch directory, which used to happen while the child might still be
   running inside it. Once the window closes the timeout owns the outcome: what a
   reviewer flushes while Relay is killing it is never parsed into a verdict.
3. **The engine gets a deadline inside Relay's**, so it fails first and says why.
   `request_timeout_seconds: 90`, `stale_timeout_seconds: 90`,
   `api_max_retries: 0`, with `RELAY_HERMES_TIMEOUT_MS` at 400,000. The bootstrap
   refuses if the two are ever put back in the wrong order, and proves the
   deadline through Hermes's own resolver — a file read, so the preflight's
   zero-provider contract holds.
4. **An engine that reports its OWN timeout stays a timeout.** Its give-up lines
   are prose with no JSON, which classified as `review_json_absent` — a
   WORKER_EXECUTION_FAILURE that is *not* retryable. Without (4), giving the
   engine a voice would have made a transient provider timeout permanent.

### Why those numbers

The engine's give-up is roughly `67 s + 2 × request_timeout` — two measured
points, 127 s at 30 s and 227 s at 80 s — not a fixed multiple; there is a large
constant in its connect-retry loop. The bootstrap's guard uses that slope with
the constant tripled, and it is a floor rather than a proof: the retry behaviour
belongs to the engine and is version-dependent. The guaranteed half is (1) and
(2) — a window Relay closes itself is now diagnosable whether or not the engine
got its word in first.

Relay's 400 s is bounded by the job, not by taste. `timeout-minutes: 60`, and a
run may spend at most six reviewer attempts — three on `review:plan`, three on
`review:build` — so 6 × 400 s is forty minutes and leaves the architect, the
coder and the evidence dump their room. Waiting longer buys no tokens: the
provider bills for what it generates whether or not Relay is still reading, so a
window that cuts early wastes a call that has already been paid for. The attempt
ceiling is untouched. This changes how long a failure takes to become legible,
not what a run may spend.

## What was deliberately NOT changed

**The retry still waits nothing and varies nothing** (question 14).
`nextAttemptAt` stays `now()`. A backoff lives in `julius-task-pipeline.ts` and
applies to every role, and the drive loop claims on that field, so it is a change
to shared sequencing for a marginal gain — with the engine's own deadline in
place, each attempt now spends real time engaging the provider and reports a
classified failure, which is the spacing and the information a backoff was
wanted for. Recorded here so the next reader knows it was weighed rather than
missed.

**The reviewer liveness probe is still not run before a paid mission.**
`hermesPreflight`'s third probe exists precisely to prove the configured provider
answers before the run spends anything upstream of the reviewer, and the live
mission's preflight prints *"no provider contacted"*. Wiring it in would have
caught this failure before the paid architect call — at the cost of one tiny
request, so the preflight would no longer be zero-spend. That is a founder
decision, not this repair's to take.

## What is proven, and what is not

**Proven, provider-free:** the transport's first-byte behaviour; the absence of
an engine deadline and its consequence; that a configured deadline makes the
engine report; that SIGTERM is honoured by this binary; that cold start is not
the cause; that the new lifecycle facts survive to the durable row; that a
reviewer which never answers still leaves the build BLOCKED across the full
three-attempt ceiling; and that a reviewer which answers on a later attempt
still completes the run.

**Not proven:** *why xAI did not answer on 2026-09-09 between 04:38 and 04:47.*
That question was destroyed by the instrument, and no amount of local work can
recover it. It is the question the next paid run can now answer — which is the
justification for one, not a claim that the provider was at fault.

## The six invariants, and the mutation that kills each

These are the properties the reviewer path must keep whatever else changes. Each
line below was verified by making the change and watching the suite go red — not
by reading the code and agreeing with it.

| Invariant | Killing mutation | Result |
|---|---|---|
| a late valid review after a timeout is rejected | remove the `if (timedOut) return;` guard in the close handler | **7 tests fail** |
| a timeout yields no accepted result | *same guard* | *same 7* |
| a timeout attests no served model | `servedModel: null` → `servedModel: cfg.model ?? null` | **3 tests fail** |
| a timeout cannot be charged twice | *same guard* | *same 7* |
| every retry is a fresh process in a fresh directory | share one scratch path across attempts | **1 test fails** — and only that one |
| three exhausted retries leave the build BLOCKED | `MAX_TASK_ATTEMPTS` 3 → 5 | **1 test fails** |

**Three of the six are one mechanism, and that is worth knowing.** "A late review
is rejected", "a timeout yields no accepted result" and "a timeout cannot be
charged twice" are all enforced by the single `timedOut` guard in the `close`
handler: once the window closes, the timeout owns the outcome, so there is no
result to accept and nothing for a second charge to attach to. They are three
readings of one line. Anyone removing that line is removing all three, which is
why the guard carries a comment saying so and why seven tests fall over rather
than one.

The fresh-directory mutation is recorded twice on purpose. The first attempt at
it forgot an import and failed 34 tests on its own breakage, which proves
nothing about the invariant; the second compiles cleanly, typechecks, and fails
exactly the one test that names the property. A mutation that breaks the build
is not evidence.
