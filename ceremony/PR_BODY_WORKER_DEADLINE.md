# Julius: the deadline a worker declares is now the deadline it gets

Frozen candidate `relay/julius-worker-deadline`, 1 commit(s) over trusted main `0845c593`, authored and committed by `julius-worker[bot]`.

Step 7 of the nine-candidate path: the Julius-owned watchdog around dispatch (explicit TIMEOUT, AbortSignal forwarded, late results unable to reach mission state, settlement exactly once). Originally frozen at `79824e98`, stacked on reviewer-envelope; rebased onto `0845c593` after #256–#262, re-authored as `julius-worker[bot]`, and patch-identical to `79824e98` (`git patch-id --stable`).

`JuliusWorker.timeoutMs` was read in exactly one place — `register`, which
checks it is a positive integer — and consulted nowhere else. The dispatch path
did `await router.dispatch(...)` with no watchdog of its own.

Every adapter bounds ITSELF: the OpenAI client's `timeout`, the hosted runner's
abort timer, `runHermesReview`'s window. So the declared number was a MIRROR of
adapter behaviour, true for exactly as long as each adapter's own timer kept
working, with nothing standing behind it. A worker whose timer never fires, or
whose promise never settles, held the dispatch open until the lease expired and
took the job's wall clock with it.

That is the arrangement `reviewer-deadline.ts` was written about — "a reader of
the composition root learned a number that bound nothing" — and it was repaired
there by making the declared and the operative number come from one derivation.
This is the other half: something that ENFORCES the declaration. Adapter
self-enforcement is not authority for a deadline Julius declares.

TWO MECHANISMS, BECAUSE ONE IS NOT ENOUGH. The signal is forwarded so a
well-behaved adapter is told to stop and can release what it holds; the race is
what actually returns, because an adapter that ignores the signal is precisely
the case this exists for. Correctness never depends on the adapter honouring
cancellation.

THE CUT IS RETRYABLE AND ITS HOLD IS NOT FREED. `runtimeStarted: true` is the
literal truth and it is load-bearing: the release frees a reservation only when
nothing can have been spent, and a dispatch cut mid-flight had already reached a
provider. Reporting it as a clean nothing would hand the mission that money a
second time. The declared deadline travels beside the elapsed time, so the row
says WHICH limit was reached rather than merely that one was.

A LATE RESULT IS HARMLESS BECAUSE OF WHERE THE CODE IS, not because a flag says
so. Every step that touches mission state — `persistEvidence`, `acceptResult`,
`commit` — is below the awaited deadline, so a promise settling afterwards has
already lost the race and nothing reads it. A guard asserting the same thing was
written and REMOVED: it could never fire, and it would not have survived the one
edit that can actually break this, which is moving a line above the await. The
ordering is pinned by a test instead.

REACHING THIS LIMIT IS ITSELF THE FINDING. Every adapter is configured to stop
first, so a healthy run never touches it. It is the layer beneath them.

Eighteen proofs, provider-free. Four drive an adapter that never settles and
never looks at its signal. Seven more are falsification: an adapter resolving
one tick late, an adapter REJECTING after the deadline, an adapter throwing on
exactly the scheduled tick the watchdog fires, a cancellation racing the
deadline, and a replay of the durable rows that finds no completion to mistake
for work. Three hold the settlement to exactly once. One pins the ordering that
makes all of it true, and one pins that a zero, negative or fractional deadline
is refused at construction so it never reaches the dispatch path at all.

Eleven adversarial mutations, eleven killed, no survivors: the deadline not
enforced at all; a literal replacing the worker's own number; the hold freed as
if nothing was spent; the cut reported as final rather than retryable; the row
no longer naming which limit was reached; the adapter abandoned without being
told to stop; the caller's abort no longer forwarded; a real provider failure
reclassified as a deadline cut; the failure class dropped; the dispatch awaited
instead of raced; and a mission-state step moved above the await.

No provider was contacted. No mission spent anything.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
