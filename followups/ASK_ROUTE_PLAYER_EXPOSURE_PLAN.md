# Ask-Julius route: what must change before real players can reach it (F4-F8)

Status: plan only, no code. Scope of the route today (branch dev/julius-ask-route): a single-operator smoke path, off unless `JULIUS_ASK_ENABLED=1`, one ask in flight, small daily cap. Everything below is about widening it to players. None of it is needed for one founder-supervised smoke; all of it is needed before a player-facing release.

## F4. Per-process state resets on restart or replica
Today the daily cap, the in-flight count, the idempotency map and (for pairing) the native sessions are all in process memory. A restart, a Railway redeploy or a second replica resets the cap to zero and forgets every stored answer, so a client retry after a restart is a second paid call, and N replicas allow N times the cap.
- Move the cap counter and the idempotency table to the Julius Postgres pool (new migration, numbered in order): `julius_ask_calls(ask_id pk, caller_hash, key_hash, question_hash, day, state, created_at, result_json)` with a UNIQUE (caller_hash, key_hash).
- Reserve the slot with one `INSERT ... ON CONFLICT DO NOTHING` plus a `SELECT count(*)` for the day inside one transaction (serializable or advisory lock per day), so the reservation is atomic across replicas, exactly as the in-process reservation is atomic across awaits now.
- Until then: run exactly one replica and treat a restart as resetting the cap (document it in the smoke runbook).

## F5. No per-caller cap
The cap is global per process. One player can use the whole day's budget and lock out everyone else.
- Add a per-caller daily cap (default 3) and a per-caller in-flight limit of 1, keyed by `callerHash`, in the same table as F4.
- Keep the global cap as the hard ceiling. Surface a distinct code (`julius_ask_caller_cap_reached`, 429) so a client can say "you are out for today" rather than "Julius is out".

## F6. The stdout fallback ledger is not durable and cannot fail closed
With no state root the ledger writes `[julius-ask-ledger] {...}` to stdout. That cannot fail, so the pre-call "write must succeed" control is vacuous there, and Railway log retention is not a financial record.
- The pre-call row must go to a durable store that can refuse: the same Postgres table as F4 (the row IS the reservation). If that insert fails, the route returns 503 `julius_ask_ledger_unavailable` and does not call the provider (the controller already does this for any ledger that throws).
- Remove the stdout fallback for player-facing use: with no database the route should answer 503 naming the missing configuration, like the other Julius families do.
- The result row (failure class, incomplete reason, provider status, HTTP status, FULL provider response id, usage, attempts) is an UPDATE of the same row, so reconciliation against the provider dashboard is one query.

## F7. No moderation, minors or PII policy, no safety identifier
The question goes to the provider verbatim, and the route knows nothing about who is asking.
- Decide the policy before exposure (founder + counsel): minimum age, whether a minor may ask at all, whether questions may contain personal data, retention of the ledger (the ledger deliberately holds no question or answer text).
- Send an OpenAI `safety_identifier` per request: a stable salted hash of the player id, never the raw id or an email. The runner has no field for it today; add an optional one defaulting to absent, as was done for `maxRetries`.
- Consider the provider moderation endpoint on the question before the paid call, with a fixed refusal code, and a refusal path for the answer that is more than the key/path scrub the terminal sanitizer gives today.
- Instruction-injection is not a data-exfiltration risk here (no tools, no files, no memory), but the system prompt should say the model must not claim abilities Julius does not have; review that wording with the product owner.

## F8. Idempotency key semantics, failure caching and the client
Fixed now (with tests): a key is bound to a hash of the trimmed question, so the same key with a different question is refused with 409 `julius_ask_idempotency_key_reused`; the Node client has a request timeout (`JULIUS_ASK_TIMEOUT_MS`, default 120 s) and never prints the idempotency key.
Still open:
- Failures are cached for the life of the process: a provider failure may have been billed, so the same key replays the failure and the player must choose a new key to retry. With durable storage (F4) add an expiry (for example 24 hours) and a "retryable" flag the client can read, so the Unreal client can retry a transient 502 deliberately without an unbounded replay.
- The idempotency map is unbounded in memory. Add a size bound or a TTL sweep until F4 replaces it.
- The Unreal client (phase B) must generate a fresh key per question, persist it across a retry of the SAME question only, and handle 409/429/503 distinctly. It must not log the Relay-Session token.
- The client has no way to learn the key after the fact because it no longer prints it: a caller that wants to retry passes `--key` itself.

## Order of work
F6 and F4 together (one migration, one table), then F5, then F7 (needs a founder/counsel decision), then the F8 remainder with the phase B client.
