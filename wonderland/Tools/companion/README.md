# Wonderland BYOAI companion: client logic, provider-agnostic (box-only work, not pushed, no PR)

Cosmo. First written Fri Oct 23 2026, about 10:20 PM PT, against BRIDGE's draft `companion-contract-v0.md`. **Updated Fri Oct 23 2026, about 10:45 PM PT, to `/workspace/bridge/companion-contract-v0.1.md`**, using BRIDGE's answers in `ANSWERS_FROM_BRIDGE.md` (checked against the #407 candidate patch and #444 on GitHub where code exists). **Updated Sat Oct 24 2026, about 3:55 AM PT: BRIDGE's chat answers Q1-Q15 are applied, and idempotency keys are minted for real** (UUIDv4 from a caller-injected 16-byte source; see "Idempotency keys" below). The fail-closed readings taken where an answer left room are listed at the top of `OPEN_QUESTIONS_FOR_BRIDGE.md`.

**v0.2 refactor, Sat Oct 24 2026 (after the 4:53 AM PT founder ruling): provider-agnostic BYOAI.** One universal route, with no provider in the core: provider auth and protocols live in server-side adapters. Each agent has its own identity, capabilities, authorization and session, and many can be connected at once. An unsupported or disconnected agent never breaks the others, and a generic model is never shown as the player's agent. **Aligned with BRIDGE's companion route code at 7e5e1e30 (about 6:30 AM PT)**: see the section of that name below. What the code does not settle is listed, open items only, in `OPEN_QUESTIONS_FOR_BRIDGE.md`.

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
| `build_and_test.sh` | First lints the four core companion files for provider literals (`grok\|chatgpt\|openai\|claude\|anthropic\|gemini\|xai`, case-insensitive; allowed only between `// BEGIN PROVIDER-ADAPTER` and `// END PROVIDER-ADAPTER`, none today; an open or nested block fails), with a 4-case self-test. Then builds and runs the KAT four ways: g++ and clang++, each at -O2 and with ASan+UBSan. |
| `sabotage.py` | 228 single-rule mutations, applied to temp copies 4 at a time (`SABOTAGE_JOBS`). The KAT must fail on every one. A mutation that does not compile counts as a BROKEN target, not as caught. 7e5e1e30 alignment: 189 → 228. 22 mutations whose code changed (the key field and handoff are gone, new agentId/providerId/displayName rules, `verified` refused, the v0.1 422 path gone) were rewritten as 38, covering the new connect body, publish invariants, the JS-trim set and mission `verified`. 23 more were added for projectId, the chat-route switch, GET/DELETE answers, mission provenance and credential names at any depth and case. One candidate, clearing capabilities on a forced disconnect, was dropped as equivalent: the view never shows capabilities for an agent that is not connected. |
| `test-output.txt` | Exact output of both scripts. |
| `OPEN_QUESTIONS_FOR_BRIDGE.md` | Open questions only (O1-O12). What was settled is in "Aligned with BRIDGE 7e5e1e30" below. |

## Aligned with BRIDGE 7e5e1e30 (Sat Oct 24 2026, about 6:30 AM PT)

The client now follows BRIDGE's actual companion route code, not the A1-A20 guesses. It was read with read-only access on branch `bridge/wonderland-julius-companion-route-20261024`. The head is `7e5e1e306be1b3f155e7066221f1ca177f46fc33`, SSH-signed and verified, parent `5242ebc1`, tree `cf15fe68`, committed 5:17 AM PT.

| Short name | Repo path | Blob |
|---|---|---|
| route.ts | `relay-bridge/wonderland-companion-route.ts` | `d0f5bae171c452d3c143f3f7ab27da44d160c42f` |
| registry.ts | `relay-bridge/wonderland-companion-registry.ts` | `6cc93aa168c6b7e61bdeb94d81e01881ed71843e` |
| admission-route.ts | `relay-bridge/wonderland-admission-route.ts` | `7790dfd9be63539e35d1fd10318dd0d6bc4a2279` |
| contract | `docs/companion/universal-companion-contract-v0.2.md` | `2d52744bb03f90f8a0cc67f45bacae446e4f609f` |

Whatever the code did not settle is still a fail-closed guess and is listed in `OPEN_QUESTIONS_FOR_BRIDGE.md` (O1-O12).

| Item | What BRIDGE's code says | Client now |
|---|---|---|
| A1 connect | route.ts:288-319. Body `{providerId, displayName?, wljRunId?}`. `apikey`/`token`/`password` at any depth (case-insensitive) is `400 companion_credentials_rejected` (:58, :288-290, :367-375). The answer is `201` + one AgentDescriptor (:319). No idempotency key is read, and every POST mints a new `agt_` id (:318 passes no agentId; registry.ts:246, :353). | `BeginConnect(providerId, wljRunId, displayName, out)` sends exactly that body to `POST …/companions/agents?projectId=…`, with no key and no idempotency key. Only 201 is a success. `503` → "Retry later"; any other status → "Could not connect the agent", and every agent stays unchanged. The answer must be for the requested providerId. Credential names are refused in every answer, at any depth, case-insensitively. |
| A2 routes | route.ts:55-57, :255-273; contract:44-46, :139-141. Only `POST …/agents`, `GET`/`DELETE …/agents/{agentId}` and `GET …/missions/{wljRunId}/companion` are served. | GET agent: `BeginReadAgent`/`ApplyReadAgentAnswer` (200 applies a descriptor for THAT agent; 404 → disconnected). DELETE: 200 + descriptor → disconnected for good (contract:139; registry.ts:272-283); 404 → disconnected; anything else changes nothing. Chat/history: **open (O1)**, switched off by `bChatRouteServed=false`. |
| projectId | admission-route.ts:282-288. The guard on every agent route (route.ts:258) needs `?projectId=` equal to the paired project, or it answers 403 `julius_dispatch_wrong_project`. | `FCompanionSession(origin, projectId, bChatRouteServed)`. Every agent URL carries `?projectId=`. With no query-safe projectId (1-64 of `[A-Za-z0-9_-]`) nothing is sent ("Companion needs a paired project"). |
| A4 agentId | registry.ts:21: `agt_` + lowercase UUIDv4. route.ts:267: any other id is 404. A reconnect is a new id. | `IsAgentId` = `agt_` + canonical UUIDv4. |
| A5 providerId | route.ts:60, :295: any string, non-blank after JS `trim()`, `.length` ≤ 200. registry.ts:24-26: "not parsed". | `IsProviderId` = valid UTF-8, 1-200 UTF-16 units, not all JS-trim whitespace. Still opaque, never in a URL. |
| A6 authorized ⊆ declared | registry.ts:153-163 clamps authorized to declared. | Unchanged: an undeclared authorized word faults the slot. |
| A8 provenance source | route.ts:107-112, :593-611; contract:26. `source` is `companion_port` or `simulated`. | Both parsers take exactly those two words. A provider name is refused. |
| A9 agents[] | route.ts:212-250. The mission body always carries `agents` (empty on error, :195-206). | Unchanged (an absent key still reads as none). The mission body must now carry `verified:false` (:249). |
| A10 displayName | registry.ts:31, :194: string or null, never blank. route.ts:59, :298-303: a requested name is ≤ 200 `.length`, blank → null. | Server names: null, or 1-200 UTF-16 units that are not blank, sanitized for display. The label sent on connect must be non-blank and ≤ 200 units (the client refuses a blank label rather than sending one the server would null). |
| A11 field set | registry.ts:28-37: kind/displayName/adapterVersion nullable, no `verified`. publishAgentDescriptor :189-214: `connected` has a name and a kind; `unsupported`/`error` carry no kind and no capabilities; `unsupported` has a null adapterVersion. | Nullable fields read. Kind null → Unknown. A descriptor that breaks a publish rule is `inconsistent_connection`. adapterVersion bounds are **open (O8)**. |
| A12 verified | registry.ts:28-37 (no field); route.ts:249 `verified: false`; provenanceOf refuses `verified`/`verifiedBy` (:593-611). | Any `verified` key on a descriptor is `bad_verified`. The mission's `verified` must be the literal false. Provenance with `verified`/`verifiedBy` is refused. `bShowVerified` is always false. `bVerifiedClaim` and `bAgentVerificationAvailable` are gone. |
| A13 unknown provider | registry.ts:221: no adapter → `unsupported`, returned as 201. | As before: an unsupported slot, never a fault. |
| A14 connect errors | route.ts:280-319, :360-365; admission-route.ts:255-292. The statuses are 400 `companion_request_invalid` / `companion_credentials_rejected` / `julius_dispatch_run_invalid`, 401 `sign_in_required`, 403 guard kinds, 405 and 503. | 503 → "Retry later"; the rest → "Could not connect the agent". The v0.1 422 `companion_credential_rejected` path is gone. |
| A16 duplicate ids | registry.ts:301-306: slots live in a Map keyed by agentId. | Unchanged: a duplicate in one list faults every copy. |
| A17 identity | registry.ts:244-259: providerId is fixed when the slot is minted. | Unchanged (permanent for the session). |
| A18 list | route.ts:55-57: no list route. registry.ts:284-297 lists per mission. | The client learns agents from connect answers, `GET` of one agent (`RefreshAgent` in the adapter) and the mission route. |
| Mission provenance | route.ts:107-112, :246, :593-611: `{source, wakeId, bodyDigest, contentSha256}`. All keys are required. `contentSha256` must equal the row's sha (:603). Provenance comes only with a result. | `ParseMissionProvenance` follows that shape. Provenance without a result, or with a different sha, is `bad_provenance`. wakeId is sanitized (its format is **open, O11**). |

Still open: A3 (O2), A7 (O3), A15 (O9), A19 (O4), A20 (O10). The key flow (O5), Relay-Session (O6) and Origin (O7) are also open.


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
- `meta` must name this agent's `providerId` (opaque, byte for byte, A7) and mode `api_key`;
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

**Agents (v0.2)** (`ParseAgentDescriptor`, `ParseAgentList`, `FCompanionSession`):
- `GET …/julius/missions/{wljRunId}/companion` returns the v0.1 shape plus `agents[]`, read into `FCompanionMissionView::Agents` with `AgentsParse` (`ok` / `absent` / `not_array`). Every entry is parsed on its own and fails closed per slot (`EAgentSlotFault`: not_object, bad_agent_id, bad_provider_id, bad_display_name, bad_kind, bad_adapter_version, bad_declared/authorized_capabilities, authorized_not_declared, bad_connection, bad_verified, inconsistent_connection, duplicate_agent_id, too_many). One bad entry never poisons the rest, and agents[] never changes the v0.1 result;
- AgentDescriptor (registry.ts:28-37): `agentId` (`agt_` + UUIDv4), opaque `providerId` (never in a URL, never switched on), `displayName` (string or null, sanitized), `kind` single | compound | null, `adapterVersion` (string or null), `declaredCapabilities`, `authorizedCapabilities`, `connection` connected | disconnected | unsupported | error. There is no `verified` field: a descriptor that has one is refused;
- `FCompanionSession` is a registry keyed by agentId (max 32): `ApplyAgentSlots` upserts. A slot with no id, or past the cap, is counted in `SessionView().UnreadableSlots` and touches nobody. `View(agentId)`, `History(agentId)`, `ConversationId(agentId)`, `ProviderIdOf`, `AgentIds`, `LastConnectedAgentId`;
- connect: `BeginConnect(providerId, wljRunId, displayName, out)` → `POST …/companions/agents?projectId=…` `{providerId[, wljRunId][, displayName]}`. It carries no credential and no idempotency key. The answer is `201` + one descriptor for the requested providerId. `connection:"unsupported"` gives an unsupported slot ("This agent is not supported yet"; cannot send or reconnect), never a fault;
- per agent: read `GET …/agents/{agentId}?projectId=`, disconnect `DELETE …/agents/{agentId}?projectId=` (served), and chat `POST …/agents/{agentId}/chat?projectId=` / history `DELETE …/agents/{agentId}/conversations/{cnv}?projectId=` (not served at 7e5e1e30; gated by `bChatRouteServed`). Each agent has its own decoder, stream, retry wait, sticky key rejection (Q12), history and conversation id. Chat idempotency keys are session-wide;
- **capabilities:** the view carries `AuthorizedCapabilities` only, and only while the agent is really connected; declared-only words are never shown. Chat needs the exact authorized word `chat` (open, O2), a paired project, and a relay that serves the chat route. Nothing is inferred from kind, name, provider or the declared list. Connected without authorized chat is Offline "This agent has not authorized chat". Connected and authorized on a relay without the chat route is Offline "Chat with agents is not available on this relay yet";
- **verified** is never shown: no descriptor carries it (registry.ts:28-37) and the mission route sends the literal `false` (route.ts:249);
- **isolation:** a malformed slot ("Agent details could not be read"), a connection error, a 409 not_connected, an auth failure, a disconnect, a rate limit or a history delete affects only that agent. An agentId that later claims another providerId is never shown as the player's agent and stays unusable for the session (A17);
- the SIMULATED banner shows per agent unless it is really connected, and session-wide unless at least one agent is.

**Session states.** It is BYOAI only, and every agent is Offline until the player connects their own agent. There is no i.Wonder key, URL or fallback anywhere. Notices from connect answers and key-mint failures are session-level (`SessionView().StatusLine`); agent views carry the agent's own state.

Each agent's state is one of `Offline`, `Ready`, `Streaming`, `RetryLater`, `SlowDown`, `OutOfCredit`, `Refused` or `Error`; `Connecting` is session-wide. The status lines are the §2.3 texts, made provider-neutral ("Connect your agent", "Your provider account is out of credit").

How it behaves:
- **Relay origin (Q9):** the J1 relay endpoint with at most one trailing `/` removed (`RelayOriginFromJ1Endpoint`), then the loopback check.
- **Key rejected:** `provider_auth_failed` marks that agent's key rejected. That survives a disconnect and any agent list; only a successful connect answer for that agent clears it (Q12).
- **Connect answers (route.ts:280-319):** anything but 201 leaves every agent unchanged and shows "Could not connect the agent" (503: "Retry later"). `DELETE` of an agent carries no idempotency key and no body (Q13).
- **Rate limits:** `Retry-After` (on our 429, positive delta-seconds, no leading zero) and `retryAfterMs` (from the provider) block that agent's sending until the stated time; when either is missing or unparseable the wait is 60 s (Q8). A 409 `companion_message_in_progress` backs off 2 s, then resends with the same key (Q4). 413 is "Message too long", 400 is "Companion error" (Q6). A DELETE history 409 stays pending and is re-sent (Q7).
- **Requests:** idempotency keys must be canonical UUIDv4 and are never reused. The client never sends a `model` field. Messages are capped at 8000 UTF-16 units. The `wljRunId` must be empty or a canonical `wlj_` id; a legacy `run:` id is refused.
- **Resend:** after a broken or unanswered stream, the message is resent to the same agent with the same key, in replay mode.

**API key handling (BYOAI):**
- At 7e5e1e30 no companion route takes a credential: route.ts refuses `apikey`/`token`/`password` at any depth (route.ts:58, :367-375). The client therefore collects and sends **no key**. The connect body is providerId, wljRunId and displayName only, and the KAT checks it byte for byte and for every credential word.
- `FKeyHandoff` was removed (nothing produced one any more). `FMaskedKeyField` is kept, unused by the session, for the adapter auth flow BRIDGE has not specified (O5). It is still a fixed buffer, masked as 8 bullets, wiped on destruction, never logged or traced.
- The relay origin must be `http://127.0.0.1:<port>` or `http://[::1]:<port>`; `localhost` is refused.
- Every agent answer (connect, GET, DELETE) that carries a key, hint, last-4 or credential name at any depth, in any ASCII case, is refused.
- The KAT types a sentinel key into the field and checks that the mask never shows it. Because no session path takes a key now, the KAT instead checks that the connect body carries no `apiKey`/`key`/`token`/`password`/`secret` name, and that answers with such a name at any depth or in any case are refused.

**Idempotency keys** (`FIdempotencyKeyMinter`):
- `Mint(IRandomBytes16&, OutKey)` takes 16 bytes from the CALLER's source and formats them with J1's `FormatUuidV4FromBytes` (version nibble 4, variant 8/9/a/b). The core never seeds or owns an RNG;
- it fails closed: a failed fill, a non-canonical result or a key it already issued leaves `OutKey` empty (`RandomUnavailable` / `RandomRepeated`), and the bytes are wiped;
- the adapter mints from #433's `FWonderlandJuliusPlatformCryptoRandom` (IPlatformCrypto `CreateRandomBytes`, no fallback). On failure it calls `ApplyKeyMintFailure(agentId or "")` ("Secure random unavailable; try again") and sends nothing. Keys are minted only for chat messages; connect needs none.

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

**Agent result and provenance** (`ParseAgentResult`, `ParseAgentProvenance`):
- a result is capped at 256 KiB before parsing and is always marked untrusted;
- its `wljRunId` must be the client's own;
- the summary is capped at 4 KiB;
- `source` is `"simulated"` or `"companion_port"` (route.ts:108); `simulated:true` must go with `source:"simulated"`, and a simulated result can never carry `verifiedBy`.

**Mission companion read route, contract v0.1 §3.7 + v0.2 `agents[]`** (`CompanionMissionRequest`, `ParseCompanionMission`):
- `GET /relay-api/wonderland/julius/missions/{wljRunId}/companion?projectId=…`, loopback origin only, `wlj_` only (a `run:` id sends nothing), projectId 1-64 of `[A-Za-z0-9_-]`;
- any status other than 200 is "no companion result" (this includes today, when the route does not exist);
- the 200 body must carry our own `wljRunId`; `taskId` null or `cmp_`; `companion.state` from the closed v0.1 list including `no_result`;
- `result` is null or `{untrusted:true, summary ≤ 4 KiB, artifact:{kind, sha256, byteLength}}` with no `content`; result and provenance are only allowed in result_received, integrated or rejected;
- `provenance` is null or `{source, wakeId, bodyDigest, contentSha256}` (route.ts:107-112): source `companion_port` | `simulated`, wakeId null or a string, bodyDigest null or 64 lower hex, contentSha256 64 lower hex and equal to the artifact's sha256 (route.ts:603), only alongside a result (route.ts:246), never with `verified`/`verifiedBy`;
- the body's `verified` must be the literal `false` (route.ts:249), else `bad_verified`. "verified" is never shown. Every failed check leaves the view empty.

## Build commands (box: g++ 14.2.0, clang 19.1.7)

```
wonderland/Tools/companion/build_and_test.sh      # FLAGS: -std=c++17 -Wall -Wextra -Werror -pedantic -Wshadow -I wonderland/Source/Wonderland
                         # each of g++ / clang++:  -O2   and   -O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all
python3 wonderland/Tools/companion/sabotage.py      # CXX=g++ by default
```

## Exact test output

The full output, including compiler versions and every sabotage line, is in `test-output.txt`.

```
LINT PROVIDER-LITERALS PASS files=4 hits=0 (selftest 4/4)
J1 COMPANION KAT PASS json=27 sse=27 chat=46 session=104 key=55 status=143 pin=51 history=33 result=33 route=121 answers=148 mint=17 agents=93 multi=22 unsupported=15 isolation=23 caps=13 verified=10 bridge=80
```
That line is printed by all four builds (g++ 14.2.0 -O2, g++ ASan+UBSan, clang++ 19.1.7 -O2, clang++ ASan+UBSan), followed by `ALL BUILDS PASS`. Sabotage: `SABOTAGE RESULT PASS caught=228/228`, no survivors, no BROKEN targets. The new `bridge=80` section checks the 7e5e1e30 behaviour: projectId on every agent URL, the chat-route switch, GET/DELETE answers, mission provenance and credential names at any depth.

## What is NOT done

- **No Unreal compile.** There is no engine on the box, so `WonderlandCompanionClient.*` has never been compiled. These API names are UNVERIFIED for the project's engine version and need checking in the editor:
  - `SetResponseBodyReceiveStreamDelegateV2`
  - `BindWeakLambda`
  - `AsyncTask`
  - `FTCHARToUTF8`
- **Depends on #433, which is not merged.** #433's `Wonderland.Build.cs` (blob bc070d53e2e7) already adds `HTTP`, `Json`, `UMG`, `Slate`, `SlateCore` and private `PlatformCrypto`, `PlatformCryptoTypes`, `PlatformCryptoContext`, so no further Build.cs change is expected, but nothing in the module references the companion files yet (UE picks up source files in the module folder, but no game code calls the subsystem).
- **Include-path style differs from #433.** The companion uses flat includes (`"WonderlandCompanionLogic.h"`, `"WonderlandJuliusMissionLogic.h"`); #433 uses `"Wonderland/WonderlandJuliusMissionLogic.h"` and `"Wonderland/Julius/WonderlandJuliusRandomBytes.h"`. The adapter includes the #433 random header by its #433 path. Which style the module's include paths accept is UNVERIFIED until a UE compile; the files may need moving under `Wonderland/` or their includes rewritten.
- **No UMG widget assets.** There is no terminal widget, agent-connect widget or HUD panel. The adapter only exposes a view plus Blueprint-callable functions.
- **Relay-Session header not set (O6).** BRIDGE's guard needs `authorization: Relay-Session <token>` (admission-route.ts:272-274). The core's `FRelayRequest` has no auth field and the seam sets no header, so every companion request would be 401 `sign_in_required` until the seam reuses #433's paired session.
- **Contract v0.1 points that are still SPEC / CHANGE on the server** (the client is ready, the server is not): `legacyRunId`, `serverRunId = wlj_`, `dispatchedAt`, the `wlj_` status query, the §3.7 route and `no_result`. Until they land, the client reads today's body through the Q21 interim rule and shows "no companion result".
- **Chat is off.** BRIDGE serves no chat or history route at 7e5e1e30 (O1), so the session is built with `bChatRouteServed=false` and no agent can send. The chat decoder, its v0.1 rules and the Q3 vs Q5 point (O4) are kept and tested with the switch on.
- **Not covered:** the status SSE stream (§4.3) client, the agent invite (§3.1) client, and `GET` of stored conversation turns (§2.2). BRIDGE has no mission-independent agent list.
- **HUD:** the adapter exposes `GetAgentIds` / `GetAgentView(agentId)` (authorized capabilities only) and `GetSessionView`; there is still no widget.
- **Nothing committed, pushed or PR'd.**
