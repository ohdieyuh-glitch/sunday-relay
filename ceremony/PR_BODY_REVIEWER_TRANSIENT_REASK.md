# Julius: a transient provider status reached a pipeline with no attempt left to spend on it

Frozen candidate `relay/julius-reviewer-transient-reask`, one commit over trusted main `9f155b91`, authored and committed by `julius-worker[bot]`.

`review_service_unavailable` is the reviewer's retryable shape: a 429 or a 503,
capacity that clears as runs finish, a drain that ends when the deploy lands.
`relay/julius-reviewer-transient-upstream` made the live path produce it. And
`relay/julius-reviewer-envelope` gives a review stage exactly ONE pipeline
attempt, because a second task attempt re-asks the same packet against the
same wall and that is a blind retry.

Both are right, and together they left a hole: the retryable shape reached a
pipeline with nothing left to spend on it, so on the integrated stack the first
provider hiccup on any review dispatch ended the mission. The qualification's
shape dispatches the reviewer five times, and the transient-upstream candidate
said in its own message that the attempt question was "left alone here rather
than guessed at".

THE ADAPTER ASKS ONCE MORE, INSIDE THE SAME DEADLINE. Not a task retry: the
answer never arrived, so nothing paid for is thrown away. Bounded two ways.
ONCE — `REVIEW_TRANSIENT_REASK_LIMIT` is 1. And only when the declared deadline
still holds a whole review after what the first ask consumed:
`reviewerReaskWithinDeadline` reads the time the asks so far took off the
runner's own two instants, subtracts a fixed 5 s backoff, and allows the re-ask
only if what remains is at least the policy's own floor — the largest duration
it believes a review can need. The second engine run is handed the REMAINING
window, not the full one, so the adapter still stops before the deadline Julius
enforces around the dispatch. A pure function, proven at its boundary.

UNKNOWN IS NOT ZERO. A first ask whose duration cannot be established from its
own instants is refused the re-ask, and the transient failure surfaces exactly
as it did before this existed.

THE RECORD SAYS WHY. `reviewAttempts` already said how many calls a dispatch
bought; a count of two could not say whether the second was a correction of a
malformed answer or a re-ask after a full service. `reviewReaskShape` is the
closed shape token of the answer that caused the second call, on the allowlist,
in the evidence dump as `review_reask_shape`, and null when the dispatch asked
once.

A CANCELLATION WINS. A dispatch already aborted is not re-asked, and one
aborted during the backoff buys nothing more — the wait ends on the signal.

THE LIMIT IS AN INPUT ON THE ADAPTER, production never passes it. Under the
policy's own limit of one, nothing reads the consumed time after the one
backoff, so an accounting error there would have been invisible until the day
the limit changed. A proof drives two re-asks and observes that the third window
is the deadline less every ask AND every backoff.

ONE EXISTING CASE CHANGED, corrected rather than deleted. "A failure that is NOT
a shape defect is never re-asked" listed a 503 on the reasoning that it was
"already retryable at the TASK level, where the attempt ceiling governs". That
ceiling is now one. The timeout and the dead credential keep their single ask;
the 503 is re-asked once and a service still full after that is final, with
both calls on the record. Two other cases now assert the second call as well.

Thirteen proofs. Ten adversarial mutations, ten killed, no survivors: the
deadline check removed; the limit ignored; unknown consumed time read as zero;
the second run keeping the full window; the signal ignored; the backoff not
charged into consumed time; a cancellation during the backoff ignored; the
re-ask shape not recorded; the transient shape
widened to every incomplete review; and the default limit not the policy's
constant.

`JULIUS_HARNESS_MANIFEST.md` records one more edge from the live composition to
the bridge's provider stack: the adapter reading the deadline policy.

No provider was contacted. No mission spent anything.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01KLYuWBeq4erDEd89bec95L
