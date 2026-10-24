# Wonderland ChatGPT side-companion: client logic (box-only work, not pushed, no PR)

Cosmo. First written Fri Oct 23 2026, about 10:20 PM PT, against BRIDGE's draft `companion-contract-v0.md`. **Updated Fri Oct 23 2026, about 10:45 PM PT, to `/workspace/bridge/companion-contract-v0.1.md`**, using BRIDGE's answers in `ANSWERS_FROM_BRIDGE.md` (checked against the #407 candidate patch and #444 on GitHub where code exists). **Updated Sat Oct 24 2026, about 3:55 AM PT: BRIDGE's chat answers Q1-Q15 are applied, and idempotency keys are minted for real** (UUIDv4 from a caller-injected 16-byte source; see "Idempotency keys" below). The fail-closed readings taken where an answer left room are listed at the top of `OPEN_QUESTIONS_FOR_BRIDGE.md`.

It follows the house style:
- a pure C++17 core with no engine includes;
- a thin Unreal adapter seam;
- a standalone known-answer test (KAT) with sabotage checks.

Nothing here has been committed, pushed or opened as a PR. The founder asked for no new PRs unless one fixes a real blocker.

## Files

| Path | What |
|---|---|
| `wonderland/Source/Wonderland/WonderlandCompanionLogic.h` / `.cpp` | Pure core (described below). |
| `wonderland/Source/Wonderland/WonderlandCompanionClient.h` / `.cpp` | UE adapter seam: a `UGameInstanceSubsystem` over `FHttpModule`. **NOT COMPILED. UE APIs UNVERIFIED.** |
| `wonderland/Source/Wonderland/WonderlandJuliusMission{Logic,Progress}.{h,cpp}` | Copies of the #444 files (361edf58), with `Progress.h` replaced by the v0.1 re-pin (`/workspace/cosmo-checkpoint/wlj-v01-repin.patch`, blob `3aa4c941`). Logic.h/.cpp and Progress.cpp blobs are unchanged from #444 (`c0f7fca6`, `0ce9f30a`, `e09bba0d`). The companion core does not read the re-pinned constants. |
| `wonderland/Tools/j1_companion_kat.cpp` | Standalone KAT. |
| `build_and_test.sh` | Builds and runs the KAT four ways: g++ and clang++, each at -O2 and with ASan+UBSan. |
| `sabotage.py` | 148 single-rule mutations (80 from the v0 / v0.1 passes, two retargeted for Q10 / Q11, 55 for the chat answers Q1-Q15 and the key minter, 8 for #444 dispatchedAt parity, plus 5 for absent / null dispatchedAt on `dispatched`, with `status_dispatched_at_unchecked` and `dispatched_at_unconfirmed_meaning_ignored` retargeted), applied to a temp copy. The KAT must fail on every one. |
| `test-output.txt` | Exact output of both scripts. |
| `OPEN_QUESTIONS_FOR_BRIDGE.md` | Q1-Q24, all answered in `ANSWERS_FROM_BRIDGE.md` and all applied; status notes and the fail-closed readings at the top. |

### What the pure core does

**SSE parser.** It follows the WHATWG text/event-stream rules:
- CR, LF and CRLF line endings, including a CRLF split across two chunks;
- a BOM, stripped at the start of the stream only;
- `:` comment lines, and multi-line `data` joined with LF;
- a 64 KiB cap on each line and on each event. Going over a cap fails the parser, and the failure is sticky.

**JSON.** A strict RFC 8259 reader:
- depth cap of 16;
- duplicate keys refused;
- strict UTF-8.

`SanitizeUntrustedText` cleans text for display:
- it drops C0 controls (except LF and TAB), DEL, C1 controls and bidi controls;
- it rejoins surrogate pairs that were split across deltas.

**Chat stream decoder.** It applies the meta / delta / done / error grammar:
- `meta` must name provider `openai` and mode `api_key`;
- the `cnv_` id must match the request;
- the model is whatever the server reports;
- `messageId` is `msg_` + canonical lowercase UUIDv4 in `meta` and `done`, and `done` must repeat meta's id (Q1);
- `simulated` must be a bool when present, and `simulated:true` is a protocol fault: v0 never simulates a chat reply (Q11);
- any SSE `id` or `retry` field is a protocol fault (Q2);
- `meta` is first on every stream, replays included (Q3). A resend pins the conversation and message ids the first attempt's meta showed. A replay (`replayed:true`, only legal on a resend) is exactly meta, one delta, done, or meta, error;
- `finishReason:"max_length"` is a complete reply, flagged on the turn and shown as "The reply reached the length limit" (Q5);
- `retryAfterMs` is an integer >= 0 or absent; `null` is a fault (Q8);
- the reply is capped at 256 KiB (the server's own cap is 128 KiB, Q5).

The draft's own rules ("no error ever falls back to another key or provider" plus fail-closed handling) add five more:
- an unknown event is a protocol fault;
- a stream that ends early is Truncated;
- events after a terminal event are ignored;
- a broken stream never displays a partial reply;
- error kinds map to the §2.3 states.

**Session** (`FOpenAiCompanionSession`). It is BYOAI only and Offline until the player connects their own key. There is no i.Wonder key, URL or fallback anywhere.

The state comes out as `Offline`, `Connecting`, `Ready`, `Streaming`, `RetryLater`, `SlowDown`, `OutOfCredit`, `Refused` or `Error`. The status lines are the §2.3 texts.

How it behaves:
- **Provider label:** `labels[mode]` from `GET /companions/providers`, verbatim; the deprecated `label` is never read. Every listed mode needs a label, and one bad entry makes the whole list untrusted (Q10). The view's label is never hardcoded.
- **Relay origin (Q9):** the J1 relay endpoint with at most one trailing `/` removed (`RelayOriginFromJ1Endpoint`), then the loopback check.
- **SIMULATED banner:** shown whenever there is no real `connected` or `connected_unverified` connection.
- **Key rejected:** `provider_auth_failed` marks the key rejected. That survives a disconnect; only a successful PUT clears it (Q12).
- **Connect answers (Q14):** a 200 needs a UTC `connectedAt`, and `verifiedAt` as a UTC string (`connected`) or `null` (`connected_unverified`). A 422 `companion_credential_rejected` shows "Your key was rejected" and leaves the old connection unchanged. `DELETE` of the connection carries no idempotency key (Q13).
- **lastErrorKind (Q15):** shown only as its fixed line (`View().LastErrorLine`); an unknown word shows nothing and is traced, never displayed.
- **Rate limits:** `Retry-After` (on our 429, positive delta-seconds, no leading zero) and `retryAfterMs` (from the provider) block sending until the stated time; when either is missing or unparseable the wait is 60 s (Q8). A 409 `companion_message_in_progress` backs off 2 s, then resends with the same key (Q4). 413 is "Message too long", 400 is "Companion error" (Q6). A DELETE history 409 stays pending and is re-sent (Q7).
- **Requests:** idempotency keys must be canonical UUIDv4 and are never reused. The client never sends a `model` field. Messages are capped at 8000 UTF-16 units. The `wljRunId` must be empty or a canonical `wlj_` id; a legacy `run:` id is refused.
- **Resend:** after a broken or unanswered stream, the message is resent with the same key, in replay mode.

**API key handling:**
- `FMaskedKeyField` is a fixed buffer. Its mask is the same 8 bullets whatever the key's length.
- `BeginConnect` wipes the field on every path, success or failure.
- `FKeyHandoff` is move-only and is the only object that ever holds the key. Its body is wiped by `MarkSent` and by the destructor.
- The relay origin must be `http://127.0.0.1:<port>` or `http://[::1]:<port>`; `localhost` is refused.
- A 200 answer that echoes any key, hint or last-4 field is refused.
- The KAT runs a sentinel key through the whole flow and checks it never appears in the trace, the view or the history.

**Idempotency keys** (`FIdempotencyKeyMinter`):
- `Mint(IRandomBytes16&, OutKey)` takes 16 bytes from the CALLER's source and formats them with J1's `FormatUuidV4FromBytes` (version nibble 4, variant 8/9/a/b). The core never seeds or owns an RNG;
- it fails closed: a failed fill, a non-canonical result or a key it already issued leaves `OutKey` empty (`RandomUnavailable` / `RandomRepeated`), and the bytes are wiped;
- the adapter mints from #433's `FWonderlandJuliusPlatformCryptoRandom` (IPlatformCrypto `CreateRandomBytes`, no fallback). On failure it calls `ApplyKeyMintFailure()` ("Secure random unavailable; try again"), wipes the key field on connect, and sends nothing.

**Turn history:**
- the last 20 turns are kept;
- the player can delete history; the local copy is cleared at once, and the server `DELETE` is retried until it answers 204 or 404;
- delete is refused while a reply is streaming.

**Status parser and pin, contract v0.1 §4.2** (`ParseMissionStatus`, `FStatusPin`, `StatusMeaning`, `MissionStatusRequest`):
- the body is top-level; a `data` wrapper or a `phase` key is `bad_phase` (a fault, never a synonym);
- `state` comes from a closed list: held, awaiting_operator, reserved, dispatched, unknown, ledger_unwritten, interrupted, failed, dispatch_failed, already_spent. `running`, `completed` and `expired` are refused;
- terminal: ledger_unwritten, interrupted, failed, dispatch_failed, already_spent. `unknown` and `held` are not terminal;
- `cause` omitted or null means none; otherwise one of RUN_ID_ALREADY_SPENT, SPENT_TAG_UNVERIFIED, gh_workflow_run_failed, AWAITING_OPERATOR_EXPIRED. `operator_window_expired` is refused, and so is AWAITING_OPERATOR_EXPIRED on any state but `failed`;
- run ids (Q21): `wljRunId` is a canonical `wlj_`; `legacyRunId` is null or `run:<24 hex>`; a non-null legacyRunId needs serverRunId == legacyRunId, a null one needs serverRunId == wljRunId; no serverRunId skips the check. **Interim:** an absent legacyRunId key with a `run:` serverRunId (today's #407 candidate body) reads as that legacy row;
- **v0.1 Clarification 1 (legacy-key switch):** the interim rule above is gated by one constexpr, `WonderlandJuliusMissionLogic::bStatusRouteRequiresLegacyRunId` in `WonderlandJuliusMissionProgress.h` (false today), shared with #444's progress parser. When it is set to true (once the server sends `legacyRunId`), an absent key is `bad_legacy_run_id`. `ParseMissionStatus(Body, Out, bRequire)` lets the KAT check both settings;
- **v0.1 Clarification 3 (`workflowRunId`):** optional and opaque. Absent or null is fine; a string of 1-128 bytes of printable ASCII without space (`StatusRouteWorkflowRunIdMaxBytes`, the same cap as #444) is accepted and dropped, never stored, shown or logged. Anything else (empty, over the cap, space, control or non-ASCII bytes, a non-string) is `bad_workflow_run_id`. See the open note in OPEN_QUESTIONS;
- `WonderlandJuliusMissionProgress.h/.cpp` are synced to the #444 series commit 2 (blobs e8083657 / 93b5a8aa), which maps the status route's lowercase states;
- `dispatchedAt` matches #444's P9 / P10: absent or null is no dispatch time, and on `dispatched` that is `DispatchUnconfirmed` (BRIDGE follow-up, approved Sat Oct 24 ~4:16 AM PT; it was "Dispatched; run status not yet reported" before); a non-string (number, bool, object) is `bad_dispatched_at`; a string that `ParseBridgeUtcTimestampMs` does not accept (it takes only 0 or exactly 3 fraction digits, so a 1-2 or 4-9 digit fraction, an offset, or empty text) is **not a fault**: the answer parses Ok with `bDispatchedAtUnconfirmed`, `dispatched` then means `DispatchUnconfirmed` (#444's text, "Can't confirm when the run was started — still checking with the bridge"), other states ignore it, and the pin neither compares nor stores it (a recorded good dispatchedAt stays; a later good one confirms an unconfirmed dispatch). `updatedAt` is strict UTC; `seq`, `progress`, `companion` are ignored;
- `StatusMeaning`: expiry is "Not started: the operator window expired (unpaid)", never a failure or spend; `dispatched` is "Dispatched; run status not yet reported" only with a well-formed dispatchedAt (applied or kept by the pin), otherwise "Can't confirm when the run was started — still checking with the bridge". The pin never treats a missing value as confirmed; a later good time confirms it, and a later absent / null / unparseable one keeps the recorded time.

The pin applies #444's rule (the client's own `wlj_` id, byte for byte), then: the legacy id and a non-null dispatchedAt are pinned once and a change is a sticky mismatch (identity is checked before ordering); a terminal state is sticky; an earlier `updatedAt` is stale (equal is re-applied); `unknown` never overwrites a known state; after `dispatched` only dispatched / dispatch_failed / already_spent apply.

**Grok Bot result and provenance:**
- a result is capped at 256 KiB before parsing and is always marked untrusted;
- its `wljRunId` must be the client's own;
- the summary is capped at 4 KiB;
- `simulated:true` must go with `source:"simulated"`, and a simulated result can never carry `verifiedBy`.

**Grok Bot result read route, contract v0.1 §3.7** (`CompanionMissionRequest`, `ParseCompanionMission`):
- `GET /relay-api/wonderland/julius/missions/{wljRunId}/companion?projectId=…`, loopback origin only, `wlj_` only (a `run:` id sends nothing), projectId 1-64 of `[A-Za-z0-9_-]`;
- any status other than 200 is "no companion result" (this includes today, when the route does not exist);
- the 200 body must carry our own `wljRunId`; `taskId` null or `cmp_`; `companion.state` from the closed v0.1 list including `no_result`;
- `result` is null or `{untrusted:true, summary ≤ 4 KiB, artifact:{kind, sha256, byteLength}}` with no `content`; result and provenance are only allowed in result_received, integrated or rejected;
- "verified" is shown only for a non-simulated provenance with `verifiedBy:"task_token_round_trip"`. Every failed check leaves the view empty.

## Build commands (box: g++ 14.2.0, clang 19.1.7)

```
wonderland/Tools/companion/build_and_test.sh      # FLAGS: -std=c++17 -Wall -Wextra -Werror -pedantic -Wshadow -I wonderland/Source/Wonderland
                         # each of g++ / clang++:  -O2   and   -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all
python3 wonderland/Tools/companion/sabotage.py      # CXX=g++ by default
```

## Exact test output

The full output, including compiler versions and every sabotage line, is in `test-output.txt`.

```
J1 COMPANION KAT PASS json=27 sse=27 chat=43 session=102 key=35 status=143 pin=51 history=33 result=25 route=91 answers=151 mint=17
```
That line is printed by all four builds (g++ 14.2.0 -O2, g++ ASan+UBSan, clang++ 19.1.7 -O2, clang++ ASan+UBSan), followed by `ALL BUILDS PASS`. Sabotage: `SABOTAGE RESULT PASS caught=148/148`.

## What is NOT done

- **No Unreal compile.** There is no engine on the box, so `WonderlandCompanionClient.*` has never been compiled. These API names are UNVERIFIED for the project's engine version and need checking in the editor:
  - `SetResponseBodyReceiveStreamDelegateV2`
  - `BindWeakLambda`
  - `AsyncTask`
  - `FTCHARToUTF8`
  - UHT acceptance of a non-UPROPERTY `FMaskedKeyField` member
- **Depends on #433, which is not merged.** #433's `Wonderland.Build.cs` (blob bc070d53e2e7) already adds `HTTP`, `Json`, `UMG`, `Slate`, `SlateCore` and private `PlatformCrypto`, `PlatformCryptoTypes`, `PlatformCryptoContext`, so no further Build.cs change is expected, but nothing in the module references the companion files yet (UE picks up source files in the module folder, but no game code calls the subsystem).
- **Include-path style differs from #433.** The companion uses flat includes (`"WonderlandCompanionLogic.h"`, `"WonderlandJuliusMissionLogic.h"`); #433 uses `"Wonderland/WonderlandJuliusMissionLogic.h"` and `"Wonderland/Julius/WonderlandJuliusRandomBytes.h"`. The adapter includes the #433 random header by its #433 path. Which style the module's include paths accept is UNVERIFIED until a UE compile; the files may need moving under `Wonderland/` or their includes rewritten.
- **No UMG widget assets.** There is no terminal widget, key-entry widget or HUD panel. The adapter only exposes a view plus Blueprint-callable functions.
- **Two known adapter weak spots:**
  - The engine `FHttpRequest` keeps its own copy of the PUT body, and the core cannot wipe that copy.
  - `KeyFieldAppend` builds a short-lived UTF-8 temporary. Feeding single key events from the widget would avoid it.
- **Contract v0.1 points that are still SPEC / CHANGE on the server** (the client is ready, the server is not): `legacyRunId`, `serverRunId = wlj_`, `dispatchedAt`, the `wlj_` status query, the §3.7 route and `no_result`. Until they land, the client reads today's body through the Q21 interim rule and shows "no companion result".
- **Q3 vs Q5 open point:** a replay over 64 KiB in one delta would fault on the client's event cap (see OPEN_QUESTIONS, item 1).
- **Not covered:** the status SSE stream (§4.3) client, the Grok Bot invite (§3.1) client, and `GET` of stored conversation turns (§2.2).
- **Nothing committed, pushed or PR'd.**
