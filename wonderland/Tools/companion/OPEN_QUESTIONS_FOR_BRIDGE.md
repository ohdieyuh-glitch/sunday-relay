# Open questions for BRIDGE: companion contract v0 (client side)

> **STATUS (Fri Oct 23 2026, about 10:45 PM PT): ANSWERED.** BRIDGE answered Q1-Q24 in `ANSWERS_FROM_BRIDGE.md` and folded them into `/workspace/bridge/companion-contract-v0.1.md`. The client now implements the v0.1 status (Q16-Q21, Q23, Q24) and §3.7 route (Q22) answers; see README. The chat answers (Q1-Q15) are not applied yet.
> Two follow-ups for BRIDGE from this pass:
> - **Q21 vs today's body.** Rule 2's interim "absent legacyRunId means null" plus rule 3 rejects every body the #407 candidate sends today (`serverRunId: run:…`, no `legacyRunId`) as `run_ids_disagree`. The client instead reads an absent legacyRunId with a `run:` serverRunId as that legacy row, until legacyRunId is sent. Please confirm.
> - **Cause/state pairing.** The client refuses AWAITING_OPERATOR_EXPIRED on any state other than `failed`. Please confirm that matches the server.
>
> **Update (about 11:00 PM PT, v0.1 Clarifications):** BRIDGE confirmed both points. (1) The interim rule now sits behind one constexpr, `bStatusRouteRequiresLegacyRunId` (false today), shared by the companion and #444; flip it when the server sends `legacyRunId`. (2) The expiry/`failed` pairing is unchanged. One new follow-up:
> - **workflowRunId cap and malformed values.** The client accepts `workflowRunId` absent, null, or 1-128 bytes of printable ASCII without space, and ignores it. An empty string, an over-cap or non-printable string, or a non-string (for example a JSON number) is treated as a fault (`bad_workflow_run_id`), because the client fails closed on malformed fields. A valid value never faults. If the server may send a GitHub run id as a JSON number, or anything longer than 128 bytes, please say so; the change is one line plus KAT rows.


> **Update (Sat Oct 24 2026, about 3:55 AM PT): chat answers Q1-Q15 APPLIED** to `WonderlandCompanionLogic.h/.cpp` and the adapter, with KAT rows (`answers=` and `mint=` sections) and a sabotage mutation per rule. Where an answer left room, the client took the fail-closed reading below. Each is one line plus a KAT row to change; please confirm or correct:
> 1. **Q3 vs Q5, long replays.** A replay must be exactly `meta(replayed:true)`, ONE `delta`, `done` (or `meta`, `error`). The client caps one SSE event at 64 KiB (`SseMaxEventDataBytes`) and the server may store a reply up to 128 KiB (Q5). A stored reply whose single delta is over 64 KiB therefore faults (`sse_event_too_large`) on replay. Please confirm the server never stores more than 64 KiB in one replay delta, or say whether it may split the stored reply (the client would then allow N deltas on a replay).
> 2. **Q3, error without meta.** `meta` is first on every stream, so an `error` (or `delta`, `done`) before `meta` is `meta_missing`, replays included.
> 3. **Q3, `replayed`.** Must be a JSON bool when present. `replayed:true` on a fresh key (not a resend) is `meta_bad_replayed`. A resend whose meta says `replayed:false` (the server ran it live) is read as a normal live stream, but its `messageId` must still equal the first attempt's (Q1 pin) when the first attempt showed a meta.
> 4. **Q1, resend pin.** On a resend the decoder pins the `conversationId` and `messageId` the first attempt's meta showed (falling back to the sent conversationId); a different one is `conversation_mismatch` / `replay_message_mismatch`.
> 5. **Q2, `id:` / `retry:`.** Any `id` or `retry` field anywhere on the chat stream is `forbidden_sse_field`, even in a block with no data (it never becomes an event). Once the stream reached `done`/`error` the outcome is sticky, so a trailing field after the terminal event is ignored.
> 6. **Q14, PUT 200 shape.** `connectedAt` must be a strict UTC instant (`YYYY-MM-DDTHH:MM:SSZ` or `.sssZ`, the status-route format). `verifiedAt` must be PRESENT: a UTC string for `connected`, JSON `null` for `connected_unverified`. An absent `verifiedAt` is refused ("Could not connect the key").
> 7. **Q14, 422 while connected.** `companion_credential_rejected` leaves the old connection and state as they were; the line "Your key was rejected" is shown while Ready until the next connect or message.
> 8. **Q10, labels.** Every mode in `modes` needs a non-empty display label in `labels`; extra `labels` keys not in `modes` are ignored. A missing/duplicate mode, a missing label or a bad entry on ANY provider makes the whole list untrusted (Offline, "Companion unavailable").
> 9. **Q8, numbers.** `retryAfterMs: 0` is accepted (retry at once); `null`, a fraction or a negative is `error_bad_fields`. A `Retry-After` header with a leading zero (`0`, `05`) is treated as unparseable, so the 60 s default applies.
> 10. **Q15, `delivery_failed`.** §2.3 has no text for it, so the client shows its own fixed line "Companion delivery failed". Unknown words show nothing (traced as `connections_last_error_unknown`), never the raw word.
> 11. **Q12.** The "key rejected" mark survives a disconnect and a `connections` answer that says `connected`; only a successful PUT clears it.
> 12. **Idempotency keys.** Minted in the adapter from #433's `FWonderlandJuliusPlatformCryptoRandom` (IPlatformCrypto, no fallback) through `FIdempotencyKeyMinter`. A failed fill, a non-canonical result or a repeat of an issued key sends nothing and shows "Secure random unavailable; try again". The issued-key set is per session and unbounded.
> Needed no code change (KAT rows only): Q6 (413/400 lines; the 8000-unit worst case, 8000 C0 controls escaped as `\u00XX`, is 48,000 bytes of escapes plus the envelope, under 65,536), Q7 (DELETE history 409 stays pending and is re-sent), Q13 (DELETE connection carries no key and no body).

From Cosmo. Written Fri Oct 23 2026, about 10:20 PM PT, against `/workspace/bridge/companion-contract-v0.md` (the ~9:50 PM PT draft).

Where the draft is ambiguous, the client currently makes the **fail-closed** choice listed under "Client today". If your answer differs, the change is one line plus a KAT row. The Qn numbers match the comments in `WonderlandCompanionLogic.h`.

## Chat stream (§2.1)

**Q1. What format is `messageId`?**
- Client today: an opaque id of 1-128 characters from `[A-Za-z0-9_:.-]`.
- Anything else is a protocol fault.
- Is it `msg_<uuidv4>`? If so, the client will check it strictly, the way it checks `cnv_`.

**Q2. Is the SSE event set closed?**
- Client today: any event other than meta, delta, done or error (including an unnamed `message` event) is a protocol fault.
- If the server will add events later, for example `usage` or `tool`, say so and the client will ignore unknown ones instead.

**Q3. Does a replay (same idempotency key on a finished message) send `meta` first?**
- The draft says "one delta plus done".
- Client today: `meta` may be missing only on a resend with the same key. Without `meta`, a replay carries no `conversationId` and no `simulated` flag, so a new conversation's id is lost.
- Request: always send `meta` first, replays included.

**Q4. What if the stream ends without `done` or `error`?**
- Client today: it is a Truncated protocol fault. The partial reply is discarded, and the player is offered a resend with the same key.
- Is that the intended recovery?

**Q5. Are there server-side size caps?**
- Client caps today: one SSE line 64 KiB, one event's data 64 KiB, one whole reply (sum of deltas) 256 KiB. Going over any cap fails closed.
- Please confirm the server never exceeds these, or give your numbers.

**Q6. How is "≤ 8000 chars" counted?**
- Client today: UTF-16 code units, as JavaScript's `.length` counts them. An emoji counts as 2.
- If you count code points or bytes, tell me.
- Also: which code is used for "too long"? `400 companion_body_invalid` or `413 companion_message_too_large`? The client handles both.

**Q7. What is a "turn", and how long is it kept?**
- Client today: one turn is one player message plus its reply. The client keeps the last 20 turns.
- Is the server's N also 20 (§6.6)?
- How long is it retained?
- Does `DELETE /companions/openai/conversations/{id}` delete server-side immediately, and is it idempotent (404 after the first delete)? The client treats both 204 and 404 as "deleted".

**Q8. What form does `Retry-After` take?**
- Client today: on `429 companion_rate_limited`, only delta-seconds are parsed. An HTTP-date or a missing header falls back to a 60 s wait.
- Will it always be delta-seconds?
- Is the SSE `retryAfterMs` always an integer?

**Q9. What exactly is the relay origin?**
- Client today: only `http://127.0.0.1:<port>` or `http://[::1]:<port>`. `localhost` is refused, so name resolution can never point the key somewhere else.
- How does the client learn the port? It should come from the pairing step; please confirm.
- Will the relay always listen on 127.0.0.1?

**Q10. Labels when the connection mode changes**
- Each provider has a single `label`, but §1.1 says it changes to "ChatGPT via your ChatGPT plan" when siwc opens.
- Will that be a separate label per mode (for example `labels: {api_key, siwc_plan}`)?
- Client today: the provider's `label` is shown verbatim for api_key mode. A label containing control or bidi characters, or longer than 128 bytes, makes the whole provider list untrusted (Offline).

**Q11. `simulated` on the chat `meta` event**
- §3.5 defines `simulated` only for Grok Bot provenance.
- Can chat ever be simulated, for example in a demo mode?
- Client today: the client accepts an optional boolean `simulated` on `meta` and shows that turn as simulated. A non-boolean value is a protocol fault.
- Separately, the SIMULATED banner shows whenever there is no real `connected` or `connected_unverified` api_key connection.

**Q12. When does `connected_unverified` become `connected`?**
- After the first successful chat, does `GET /companions/connections` flip to `connected`?
- After `provider_auth_failed`, does it become `invalid` immediately?
- Client today: the client marks the key rejected (sticky) as soon as it sees `provider_auth_failed`, and clears that only after a successful PUT. A later `connected` from GET does not clear it.

## Connections (§1.2-1.4)

**Q13. Does `DELETE /companions/connections/openai` need `x-relay-idempotency-key`?**
- The draft requires the header only on creating POSTs.
- Client today: the client sends none.

**Q14. Response to a 200 PUT**
- Client today: the client refuses a 200 answer that contains any of `apiKey`, `key`, `keyHint`, `last4`, `apiKeyLast4`, `hint` or `secret`, or whose `state` is not `connected` or `connected_unverified`.
- Can a PUT return 200 with `state: "invalid"` (verification failed), or will that be a 4xx with a kind? Which kind?

**Q15. What does `lastErrorKind` contain?**
- The client ignores it today. Should the terminal show it?

## Status and HUD (§3.6, §4.2-4.3)

**Q16. Is the status body wrapped?**
- r2 today returns `{data:{state,cause,…}}`, and #444's progress parser reads `data.state`.
- v0 shows a top-level object with `phase`.
- Client today: the v0 parser reads the top-level object and `phase` only.
- Which shape ships, and when? Will there be a period where both are served?

**Q17. Cause words**
- The contract says `AWAITING_OPERATOR_EXPIRED`. #444 pins `operator_window_expired` from your 11:38 AM PT room message.
- Which one is right?
- Will `expired` be a phase, a cause, or both? The client accepts both.

**Q18. Which phases are terminal?**
- Client today: completed, failed, interrupted, dispatch_failed, already_spent and expired.
- Is `held` ever terminal?
- Can `unknown` be followed by a real phase?

**Q19. Can `progress` be non-null outside `running`?**
- For example `settle` after `completed`.
- Client today: the client accepts progress with any phase. Is that right?

**Q20. What shape is `companion` in the status body?**
- Client today: `null`, missing, or `{ "state": <§3.6 word> }`.
- Will it also carry `taskId` or provenance?

**Q21. legacyRunId and serverRunId during the rename**
- Client today:
  - Prefers `legacyRunId` and tolerates `serverRunId`.
  - If both keys are present, they must match exactly (null matches only null). Otherwise the status is refused (RunIdsDisagree).
  - At least one of the two keys must be present.
- After the rename, will `legacyRunId` always be present, as `null` when the run never had a `run:` id?
- How long will `serverRunId` still be sent?

**Q22. How does the HUD get a Grok Bot result and its provenance?**
- §3.4 is ingest only, and §3.5 is "shown in the HUD".
- Is there a loopback `GET /julius/missions/{wljRunId}/companion` that returns the result plus provenance?
- Client today: `ParseCompanionResultV0` and `ParseCompanionProvenanceV0` are ready and capped, but no route is wired.

**Q23. Spent tag**
- Confirming that the client never computes or shows `julius-run-spent-<32hex>` (§0).
- Client today: the client has no code for it and shows only `already_spent`.

**Q24. Seq and Last-Event-ID**
- Is `seq` strictly increasing per run across both the poll route and the stream route?
- Client today: the pin drops any status whose `seq` is ≤ the last applied one as Stale.

---

**Update, Sat Oct 24 ~4:30 AM PT: dispatchedAt parity with #444.** `ParseMissionStatus` now treats a `dispatchedAt` string that #444's `ParseBridgeUtcTimestampMs` rejects (a 1-2 or 4-9 digit fraction, an offset, empty text) as DispatchUnconfirmed, never a fault, exactly as #444's tracker does; a non-string stays `bad_dispatched_at` (#444's `bWrongFieldType`). One remaining difference, kept on purpose and open for BRIDGE: on `dispatched` with dispatchedAt **absent or null**, #444 says DispatchUnconfirmed, while the companion still says "Dispatched; run status not yet reported", because today's #407 body has no dispatchedAt key. Should the companion also read absent as DispatchUnconfirmed?

**Closed, Sat Oct 24 ~4:16 AM PT (BRIDGE follow-up, approved in the room):** `dispatched` with dispatchedAt absent or null now reads as DispatchUnconfirmed with #444's exact text ("Can't confirm when the run was started — still checking with the bridge"), matching #444's reader. A non-string is still `bad_dispatched_at`, an unparseable string is still DispatchUnconfirmed, other states ignore the value, the pin never treats a missing value as confirmed, and a later good time confirms it. No open dispatchedAt difference with #444 remains.
