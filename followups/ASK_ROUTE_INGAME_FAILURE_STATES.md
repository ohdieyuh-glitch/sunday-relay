# Ask-Julius route: every failure state, as the Wonderland client will see it

Status: plan only, no code. This is the contract the in-game client (phase B) renders from. Source of truth: `relay-bridge/julius-ask.ts` (`handleJuliusAskRoute`, `createJuliusAsk`) and the bridge's outer handler in `relay-bridge/server.ts`.

## How a failure arrives
Route and controller refusals are HTTP `status` with body `{ "error": { "kind": "<code>", "message": "<fixed text>" } }`. The message is the same fixed sentence for every ask-level refusal ("Julius could not answer this question."), so the client MUST branch on `error.kind`, never on the message, and must show its own player-facing line from the table. A success is HTTP 200 with `{ "data": { askId, answer, answerDigest, answerChars, role, provider, model, usage, costBasis, billingPath, responseId, ledgerRef } }`.

The ledger-only failure detail (failure class, incomplete reason, provider HTTP status, provider response id) is deliberately NOT in any response. A player sees only the code below; an operator reconciles from the ledger by `askId`.

## The table
| HTTP | `error.kind` | When | Player-facing line (one short line) | Client action |
|---|---|---|---|---|
| 200 | (success) | answered | (the answer) plus a small line: `Julius (architect) - N tokens - check <first 12 of answerDigest>` | Render `answer` exactly as received; the digest lets a verifier recompute sha256 of the displayed text. |
| 503 | `julius_ask_disabled` | `JULIUS_ASK_ENABLED` is not `1` | `Asking Julius is switched off right now.` | Do not retry; hide the ask prompt for this session. |
| 503 | `julius_ask_not_configured` | provider key, model or live mode missing on the bridge | `Julius cannot answer yet - he is not set up on this server.` | Do not retry for a while (minutes); not the player's fault. |
| 503 | `julius_ask_ledger_unavailable` | the pre-call ledger line could not be written; nothing was sent to the provider and nothing was spent | `Julius could not start that question. Try again in a moment.` | The SAME idempotency key may be retried (the refusal is not remembered). |
| 429 | `julius_ask_cap_reached` | today's global ask cap is used up | `Julius has answered all the questions he can today. Try tomorrow.` | No retry today; the same key works after the UTC day rolls. |
| 429 | `julius_ask_busy` | another ask is in flight (default limit 1) | `Julius is answering someone else. Try again in a few seconds.` | Retry with the same key after a short delay (the refusal is not remembered). |
| 409 | `julius_ask_idempotency_key_reused` | same key, different question | `That question did not send properly. Ask again.` | Client bug: generate a fresh key for a new question. Never retry with the same key. |
| 400 | `julius_ask_question_invalid` | not a string, empty, or over 2000 characters | `Type a question between 1 and 2000 characters.` | Fix input; the client should enforce 1..2000 before sending. |
| 400 | `julius_ask_idempotency_key_invalid` | key missing or not 8..80 of `A-Za-z0-9_-` | `That question did not send properly. Ask again.` | Client bug: regenerate the key. |
| 401 | `julius_ask_caller_required` | the controller got no caller (should not happen through the route) | `You need to be signed in to ask Julius.` | Re-pair or sign in. |
| 401 | `sign_in_required` | no operator bearer and no valid native Relay-Session, or a browser Origin was present | `Sign in to Wonderland to ask Julius.` | Re-pair the desktop client; do not retry blindly. |
| 405 | `method_not_allowed` | not a POST | `That did not work.` | Client bug. |
| 502 | `julius_ask_provider_failed` | the provider call failed, was refused, timed out, ran out of output budget (incomplete), or the SDK threw. It may have been billed. | `Julius could not answer that one. Ask a shorter or simpler question, or try again later.` | Do NOT reuse the key: the failure is remembered for the key. A deliberate retry is a new question send with a fresh key, and it spends another cap slot. |
| 502 | `julius_ask_provider_malformed` | the provider answered but not in the `{answer}` shape, or with an empty answer | `Julius gave an answer we could not read.` | Same as above: fresh key to retry. |
| 400 / 500 | (bare `{ "error": "request body too large" }`, `{ "error": "invalid JSON body" }` or `{ "error": "internal error" }`) | bridge-level body or internal failure, outside the ask controller; note `error` is a string here, not an object | `That did not work. Try again.` | Treat a non-object `error` as a generic failure. |
| 403 | (bare `{ "error": "origin not allowed" }`) | a browser Origin the bridge does not admit | `That did not work.` | A native desktop client sends no Origin; this means the client is misconfigured. |
| - | (no HTTP response) | network error, DNS, TLS, or the client's own timeout | `Julius cannot be reached right now.` | Keep the SAME key and question for an automatic retry, because the server may have answered; a repeat returns the stored answer instead of a second paid call. |

## Notes for the client author
1. "Incomplete" is a provider failure the client cannot tell apart from other provider failures: it arrives as `julius_ask_provider_failed` (502). The ledger records `failureClass: incomplete_response` and `incompleteReason: max_output_tokens`. If the product wants a distinct line ("that question needs a longer answer than I may give") the route would have to expose a coarse, fixed `reason` field on the 502 body; that is a deliberate change and needs reviewer sign-off, since today no provider detail leaves the ledger.
2. The cap, busy and key refusals cost nothing and are not remembered, so the same key and question are safe to resend once the condition clears. A 502 is remembered and was possibly billed; do not loop on it.
3. The bridge is a single process today: a restart forgets stored answers and resets the cap, so a "retry after reconnect" can become one more paid call. See ASK_ROUTE_PLAYER_EXPOSURE_PLAN.md (F4).
4. The success line must show only a prefix of `answerDigest` (12 hex characters). The full digest is in the response and the ledger row (`answerSha256`) for a verifier; the answer text itself is never in the ledger.
5. The player-facing lines above are proposals for the Wonderland owner; wording is theirs. The codes and the retry rules are the contract.
