# CLIENT PACKAGE SPEC r1: in-world paid Julius missions (Wonderland side, W1/W4)

Author: JUDEV subagent (work package 4), 2026-10-22. DEVELOPMENT-SIDE SPEC. Nothing here spends money, edits a Wonderland repo, builds, or changes a gate. No mailbox or cross-session message was sent.

Sources read in full: `PLAN_INWORLD_PAID_MISSIONS_r2.md`; `wonderland_ask_client_juju2_20261019\CLIENT_DESIGN_AND_RISKS.md` (CDR); `MAIL_TO_WONDERLAND_DEV_client_package.md`; `j1\DESIGN.md` (sections 5 and 6 are the bridge-side message contract this spec adapts) and `j1\OPEN_ITEMS.md`.

Code citations: `C:\dev\iwonder\wonderland-task3\wonderland\Source\Wonderland\` (shortened `SRC\`). The worktree is branch `local/r16reh16w`, HEAD `aa930c26` (r16reh18 reviewer NITs), with a dirty tree (Tools/_channel and Tools/captures only; I did not look further). Every `file:line` below is a line I opened in this session. CDR line numbers for `WonderlandUiSubsystem.cpp` are STALE (about +35 now): use the numbers in this document.

---

## 0. Scope and shape

Two player-visible features, one new module-local file pair, one tiny branch in the UI subsystem:

| Feature | Bridge route | Status of route |
|---|---|---|
| `/mission` (the requirement: a frozen 3-role chain, observed in-world) | J1: `POST /relay-api/wonderland/julius/dispatch`, `GET .../dispatch/events`, `GET .../dispatch/result` (j1 DESIGN section 5) plus the existing `POST .../julius/missions` | J1 built with fakes only, unreviewed; mounted UNCOMPOSED (j1 DESIGN section 7) |
| `/ask` (optional Phase A, one architect Q&A) | `POST /relay-api/wonderland/julius/ask` (CDR section 1) | Unlanded on `work/ask` 167a3581; reviewer-cleared for one local smoke only (plan section 1) |

The mission package MUST NOT depend on `/ask`. `/ask` is specified here only by reference to CDR plus the log format in 4.5. If the owner wants a smaller first build, ship `/mission` alone.

New files: `WonderlandJuliusMission.h/.cpp` (and, if `/ask` is included, `WonderlandJuliusAsk.h/.cpp` per CDR 2a). Names are a proposal.

Constraints inherited from CDR 2a, repeated because they fail CI if missed: no USTRUCT/UENUM in the new headers (cpp-parity test), `git add -N` the new files, none of the retired word matched by `/\bPSPs?\b/i` in any `.h/.cpp`, and no provider name in any client string or log format (CDR R5; list in 4.6).

Existing code facts the spec relies on:

- A slash line is consumed by `HandleTerminalCommand` (`SRC\WonderlandUiSubsystem.cpp:4295-4306`: `Command` is lower-cased, `Argument` trimmed). An unknown slash command ends at `:4618-4622` ("is not a Wonderland command"), so a `/mission` branch placed after that is dead. `HandleTerminalSubmit` calls `HandleTerminalCommand` first (`:4642`), then the draft-tab path (`:4653-4694`), then the "Not sent: Julius is not part of this beta build" fall-through (`:4701-4705`).
- The branch point is directly after the `/brain` block (`:4530-4547`) and before `/card` (`:4549`), the same place CDR 2b chose (its numbers were 4512/4514). `/help` text is at `:4605-4616` (optional edit).
- `UWonderlandJuliusStreamSubsystem::NewBridgeRequest(Verb, PathAndQuery)` (`SRC\WonderlandJuliusStream.h:284`, impl `.cpp:502-510`) returns null when the bridge URL is empty or the client is unpaired, else `NewRequest` (`.cpp:482-500`) which attaches `Authorization: Relay-Session <token>` and NO Origin, and calls `FWonderlandMissionHandoff::NoteMutation` for every non-GET (`.cpp:485-488`). Do not add a second `NoteMutation`.
- `GetPairedProjectId()` (`.h:370`), `GetBridgeUrl()` (`.h:236`), `GetBridgeProblem()` (`.h:378`), `IsPaired()` (`.h:277`), `NoteSessionRefused()` (`.h:290`, impl `.cpp:512-519`) are public.
- `ResolveBridgeUrl` accepts https to ANY host and plain http to loopback only (`.cpp:174-191`). The J1 route refuses anything non-loopback, and CDR/J1 N6 requires the client to refuse a non-loopback bridge for `/mission`. That check does not exist yet: it is new client code (3.3 step 2).
- `CreateMission` exists (`.h:360-363`, impl `.cpp:855-1000`) but has NO caller outside its own file that I could find (grep of `CreateMission(` in `SRC\*.cpp` other than the stream file returned nothing; the only `wl.Julius.*` commands I saw are `Pair`, `Follow`, `ContractFollow`). On 201 it calls `Follow(Project, Run)` (`.cpp:969`), which starts hydration/events polling against `GET /wonderland/julius/{hydrate,events,result}`. Those routes are NOT on main 3f20fc1a (j1 OPEN_ITEMS 2). See 3.2 and U1.
- The paired participant id is parsed into a LOCAL variable and only logged (`.cpp:580-587`); there is no getter. `player_hash` therefore needs a small additive getter on the stream subsystem (U3).
- `IsDeveloperSession()` is `GIsEditor || -wldev` (`SRC\WonderlandBeta.cpp:54-58`). Build identity text is `BuildLabel()` = first line of `<ProjectDir>\BuildInfo\BuildInfo.txt`, trimmed, max 120 chars, else "Development build" (`WonderlandBeta.cpp:66-85`).
- No engine SHA-256 is usable: `WonderlandEosVoice.cpp:82-85` states `FPlatformMisc::GetSHA256Signature` is `checkf(false)` on UE 5.8 and the module uses `FSHA1` only (also `WonderlandSocialLive.cpp:101-114`). The client carries its own FIPS 180-4 SHA-256 (CDR 2f).
- Rows: `SWonderlandLiveTerminal::AddJuliusRow(Role, Headline, Detail)` (`SRC\WonderlandLiveTerminal.h:122`, impl `WonderlandLiveTerminal.cpp:717-732`) masks Headline and Detail with `FWonderlandCardStore::MaskForDisplay` ONLY when Role is "You" (`:722-724`). Answer-side rows must be masked by the caller (`MaskForDisplay`, `WonderlandCard.h:249`) after digest verification.
- Log name collision: the string `WLMISSION` is ALREADY used by existing code (`WonderlandMissionOrb.cpp:129,313,343`, `WonderlandMissionSubsystem.cpp:115`, `WonderlandHudPanels.cpp:252`, `WonderlandMissionEvent.cpp:36`). The J1 contract fixes the prefix `WLMISSION` for the new lines (j1 DESIGN 5.5). Resolution in 4.1: the new lines are distinguished by their second token (`trigger|chain|result|refused|build|roleinfo`) and every parser and the QA script MUST match `^.*WLMISSION (trigger|chain|result|refused|build|roleinfo) ` and never a bare `WLMISSION`. Whether to rename to a unique prefix is U2 (it needs a one-line change in j1 DESIGN 5.5 and the reviewer's crosscheck).

---

## 1. (a) Terminal command grammar

All commands are handled inside `WonderlandJuliusMission::HandleTerminalLine(UGameInstance*, TSharedPtr<SWonderlandLiveTerminal>, Line, Argument)`, called from ONE new branch in `HandleTerminalCommand`:

```
if (Command == TEXT("/mission") || Command == TEXT("/ask")) { return WonderlandJuliusMission::HandleTerminalLine(<instance as at :4535>, Terminal, Line, Command, Argument); }
```
placed between `:4547` and `:4549`, plus one `#include`. The free-text path (`:4701-4705`) stays unchanged: a non-slash line is NEVER sent to Julius, and no code path makes a typed line into a paid call (CDR R4).

Grammar (case-insensitive command and verb; `Argument` is everything after the first space):

```
/mission                    status (same as /mission status)
/mission status             one row: gate state, paired y/n, bridge loopback y/n, last run id (short), last state
/mission run                STEP 1 of 2. Prints the registered mission id and the first 12 hex of its contract sha256,
                            prints a one-time confirm word, and sends NOTHING. Valid 60 s, one use.
/mission go <word>          STEP 2 of 2. Only if <word> equals the pending confirm word (case-sensitive) and 60 s have not
                            passed: runs the sequence in 3.1. Any other word: "Not sent: that is not the confirm word.", clears it.
/mission more               pages the stored artifact rows locally (no network, no bill)
/mission result             re-reads GET .../dispatch/result for the last run (a read; no bill) and re-renders after verification
/mission cancel             clears a pending confirm word only. There is NO stop for a running chain (no bridge cancel;
                            the founder kills the bridge process - j1 OPEN_ITEMS 12). The row says so.
/ask <question>             optional Phase A, per CDR sections 1 and 2 (1..2000 chars, one in flight, no auto-retry)
/ask more                   pages the stored last answer locally
```

Rules:

1. The mission is PRE-REGISTERED. `/mission run` takes NO player text. The objective, requirements, constraints and criteria come from one frozen record shipped in the build (see U4 for where it lives and how it is bound to the bridge's `contractSha256`). A player cannot edit the mission. A typed argument after `run` is refused: "`/mission run` takes no text; the mission is registered."
2. Two-step trigger. `/mission run` then `/mission go <word>` makes the paid action deliberate and puts the typed trigger in the capture (the evidence that a human typed it). The confirm word is 6 characters from `[A-HJ-NP-Z2-9]`, generated with `FMath::Rand` seeded by `FGuid::NewGuid()`; it is not a secret and it is written in the log line of 4.2 line 0 ONLY as its length, not its value.
3. Run 2 (plan criterion e) is the same two commands again: it creates a NEW run (new `POST .../missions` with a NEW idempotency key), then dispatches with ANOTHER new key. The client never reuses a dispatch key across runs (j1 DESIGN 5.1; the bridge answers 409 `julius_dispatch_key_reused`).
4. One chain in flight per client (`bInFlight`). A second `/mission go` while a chain runs: "Julius is still working on the last mission." Nothing is sent. (The bridge also enforces concurrency 1; do not rely on 429 alone: CDR R9.)
5. Gates, checked in this order BEFORE anything is sent; each ends the command with its own row and `WLMISSION refused ... kind=<local kind>` (4.4):
   - CVar `wl.Julius.Mission` is 0 (default) -> `Julius missions are not part of this build.` kind `local_off`.
   - not `WonderlandBeta::IsDeveloperSession()` (`WonderlandBeta.cpp:54`) -> same row, kind `local_not_developer`.
   - `UE_LOG_ACTIVE(LogHttp, VeryVerbose)` or higher header-printing verbosity (the engine can print the Authorization header: CDR R1, `CurlHttp.cpp:739-781` as cited there; I did not open that file) -> `Not sent: HTTP logging is too verbose and could print your session.` kind `local_http_verbose` (J1 D3/N8).
   - `GetBridgeUrl()` empty -> `Julius cannot be reached: no server is set for this game.` kind `local_no_bridge` (and `GetBridgeProblem()` non-empty -> kind `local_bridge_refused`).
   - bridge URL not loopback (`http://127.0.0.1[:port]`, `http://localhost[:port]`, `http://[::1][:port]`, parsed as exactly as `IsLoopbackAuthority`, `Stream.cpp:~140-153`) -> `Not sent: missions only run against a bridge on this PC.` kind `local_not_loopback` (N6). https is NOT accepted for `/mission`.
   - `!IsPaired()` -> `Sign in to Wonderland to start a mission.` kind `local_not_paired`.
   - `GetPairedProjectId()` empty -> kind `local_not_paired_for_a_project`.
   - SHA-256 known-answer self-test failed at start -> `Not sent: this build cannot check Julius's answers.` kind `local_sha_selftest` (D2).
6. The echo row is always `AddJuliusRow("You", Line, ...)`; masking of "You" rows is automatic (`LiveTerminal.cpp:722-724`). The confirm word is not secret but `/mission go <word>` is echoed as typed.

---

## 2. (b) Message contract with the bridge

Base = `GetBridgeUrl()` (loopback only for `/mission`). All routes under `/relay-api`. Every request is created ONLY by `NewBridgeRequest` (token attached in one place, never returned, no Origin, mutation spy counted once). Content-Type `application/json` on POSTs. Threading: keep `CompleteOnGameThread`, `BindWeakLambda`, `Unbind()+CancelRequest()` in `Deinitialize` (as `Stream.cpp:432-449` does; CDR 2g). Bodies built with `FJsonObject` + condensed writer, never hand-escaped (CDR 2d).

### 2.1 Create the run (existing route, reused)

```
POST /relay-api/wonderland/julius/missions?projectId=<GetPairedProjectId(), url-encoded>
x-relay-idempotency-key: <fresh key A>
{"objective":..., "requirements":[...], "constraints":[...], "acceptanceCriteria":[{"id","text","blocking"}]}   (exactly the frozen text)
-> 201 {"data":{"runId":"run:<hex>","missionId":"..."}}
```
Same body shape and secret screen as `CreateMission` (`Stream.cpp:893-935`). Do NOT call `UWonderlandJuliusStreamSubsystem::CreateMission` as is, because it calls `Follow(...)` on 201 (`:969`), which starts hydrate/events polling on routes the J1 bridge does not serve (U1). The new code sends the same request itself with `NewBridgeRequest` and does not follow. 401 -> `NoteSessionRefused()` (`.h:290`). Whether the bridge's mission lookup reports a `contractSha256` equal to the frozen one is j1 OPEN_ITEMS 4/19, UNVERIFIED.

### 2.2 Dispatch (J1 DESIGN 5.1/5.2, verbatim)

```
POST /relay-api/wonderland/julius/dispatch?projectId=<PairedProjectId, url-encoded>
Authorization: Relay-Session <token>        (no Origin)
x-relay-idempotency-key: <fresh key B>      (^[A-Za-z0-9_-]{8,80}$; FGuid::NewGuid().ToString(EGuidFormats::Digits); NEW per run)
{"runId":"<from 2.1>","clientTriggerId":"<^[A-Za-z0-9_-]{8,64}$ nonce>","clientLogSha256":"<64 lowercase hex>"}
-> 202 {"data":{"runId","dispatchId","mode","state":"ACCEPTED","replayed":false,"ledgerRef":"julius-j1-ledger:<dispatchId>"}}
-> 200 same with "replayed":true (same key resent; never a second chain)
-> error {"error":{"kind","message"}}
```
`clientLogSha256` = sha256 (UTF-8) of the EXACT message string of the trigger line (4.2 line 1), without the UE timestamp/category prefix. The line must be flushed to the log file BEFORE `ProcessRequest()` (U5: which UE call guarantees this). `clientTriggerId` = `trig_` + 16 hex of a fresh GUID.

The client branches on `error.kind` only and never on `message`. A non-object `error` (a string; CDR section 1 / Doc:27-28) is a generic failure. No automatic retry of the dispatch on no-response (CDR R6): a bridge restart forgets keys, and a replay is a human decision.

### 2.3 Events (poll; J1 DESIGN 5.3)

```
GET /relay-api/wonderland/julius/dispatch/events?projectId=<p>&runId=<raw run id>&cursor=<last nextCursor, start 0>&mode=page
-> {"data":{"runId","mode":"fake|live","state":"ACCEPTED|RUNNING|COMPLETED|FAILED|HALTED|ORPHANED",
            "events":[{"sequence":n,"type":"...","at":"ISO", ...}],"nextCursor":n,"terminal":bool}}
```
The run id is sent RAW (it contains a colon; same rule as `RunQuery`, `Stream.cpp:472-480`). Poll every `wl.Julius.Mission.PollSeconds` (default 1.0, as `Stream.cpp:33`), 15 s request timeout, ONE request in flight, stop when `terminal:true`. Event types and fields (the client reads only these):

| `type` | fields read |
|---|---|
| `chain.accepted` | none |
| `role.started` | `role`, `phase` |
| `role.completed` / `role.failed` | `role`, `phase`, `outcome`, `responseIdTail`, `responseIdSha16`, `usage{input,output,total}` or null, `failure` or null |
| `checker.started` / `checker.completed` | `role:"checker"`, `phase`, `outcome` (`pass|fail`) |
| `chain.refused` | `role`, `phase:"refused"`, `failure:"budget_refused"` |
| `chain.completed` / `chain.failed` | `outcome`, `failure`, `resultSha256` |

Sequence handling: apply events in `sequence` order; ignore any `sequence` <= last applied (log `dup`); a gap (sequence > last+1) is logged `WLMISSION refused ... kind=local_event_gap` and the render continues but the result is still hash-checked. `role` is one of `architect|coder|reviewer|checker`; any other value is rendered as `a step` and logged (never invented). `usage` is NOT shown to the player (CDR rule: no token figure on a player row) but IS logged in the optional `roleinfo` line (4.2 line 5, PROPOSED). The wire carries no provider or model name (bridge-enforced); the client must still not log any it sees (4.6).

### 2.4 Result (J1 DESIGN 5.4)

```
GET /relay-api/wonderland/julius/dispatch/result?projectId=<p>&runId=<raw>
-> 200 {"data":{"runId","state","resultText":"<JSON text>","resultSha256":"<hex>"}}
-> 409 julius_dispatch_result_not_ready   (retry the read after the next poll; do not treat as failure)
```
`resultText` parses to `{runId, dispatchId, missionId, state, failure, mode, roles:[{role, outcome, responseIdTail, responseIdSha16, usage, outputSha256, outputChars, toolCalls}], reviewerVerdict, checkerPass, artifactSha256, artifactText}`. The client:

1. takes the JSON string value of `data.resultText` EXACTLY as decoded from the received body (not re-serialised); `body_sha256` = SHA-256 of `FTCHARToUTF8(resultText)`;
2. also logs `http_sha256` = SHA-256 of `Response->GetContent()` raw bytes, taken before `GetContentAsString` (CDR 2f; `IHttpBase.h:167` as CDR cites it, not opened by me);
3. `digest_ok=1` iff `body_sha256 == data.resultSha256` AND the SHA-256 self-test passed; also check `parsed.runId == the run asked for` and `parsed.mode == top-level mode`; any mismatch is `digest_ok=0` or a `refused kind=local_result_mismatch`;
4. on `digest_ok=0` NOTHING of the result is drawn except `Julius's answer arrived damaged and is not shown.` (J1 D2 / N7; CDR [ADD] row);
5. optionally recompute `sha256(artifactText)` and compare with `artifactSha256` and `sha256(roles[i].output)` is not possible (outputs are not on the wire); log `artifact_ok=0|1`.

R15 (CDR): a lone surrogate in `resultText` could make `FTCHARToUTF8` differ from Node's UTF-8 and show a false "damaged". Safe direction; recorded as U8.

### 2.5 Error kinds the client must name (j1 DESIGN 5.2) and what the player sees

Branch on `kind`; the row text is the client's own. All rows use role "Julius".

| kind (HTTP) | Player row | Client action |
|---|---|---|
| `julius_dispatch_not_loopback` (403) | `The server is not on this PC, so it refused.` | no retry |
| `julius_dispatch_disabled` (503) | `Missions are switched off on the server.` | no retry |
| `julius_dispatch_not_configured`, `julius_dispatch_providers_not_composed` (503) | `The server is not set up to run missions yet.` | no retry |
| `julius_dispatch_founder_only`, `julius_dispatch_wrong_project`, `julius_dispatch_second_pairing`, `julius_dispatch_operator_is_not_the_game`, `julius_dispatch_browser_refused` (403) | `This account may not start that mission here.` | no retry; log the kind |
| `sign_in_required` (401) | `Sign in to Wonderland to start a mission.` | `NoteSessionRefused()` |
| `julius_dispatch_client_log_binding_required`, `julius_dispatch_idempotency_key_invalid`, `julius_dispatch_run_invalid` (400) | `That did not send properly.` | log at Error: a client bug |
| `julius_dispatch_run_not_found` (404), `julius_dispatch_run_unknown` (404 on events/result; also after a bridge restart) | `The server does not know that run any more. Start a new one.` | stop polling |
| `julius_dispatch_run_not_ready`, `julius_dispatch_already_dispatched`, `julius_dispatch_key_reused` (409) | `That run cannot be started again.` | no retry; run 2 needs a new run |
| `julius_dispatch_run_lookup_unavailable` (503) | `The server could not look up that run. Try again in a moment.` | same key may be re-sent BY HAND |
| `julius_dispatch_mission_not_frozen`, `julius_dispatch_mission_not_frozen_mission`, `julius_dispatch_reviewer_not_independent` (503/409) | `The server refused: the registered mission is not in place.` | no retry |
| `julius_dispatch_busy` (429) | `Julius is already running a mission.` | no auto retry |
| `julius_dispatch_cap_reached`, `julius_dispatch_mission_cap_reached` (429) | `Julius has run all the missions he can for now.` | no retry |
| `julius_dispatch_ledger_unavailable` (503) | `Julius could not start that mission. Try again in a moment.` | same key may be re-sent BY HAND |
| `julius_dispatch_result_not_ready` (409) | none (internal) | read again after next poll |
| 404 route unknown / non-JSON | `This server does not offer missions.` | stop |
| no response (network, timeout) on dispatch | `No answer arrived. The mission may or may not have started; check the status before starting another.` | NO auto retry; keep the key; `/mission status` shows `unknown` |
| 200/202 that cannot be parsed | `Julius gave an answer we could not read.` | show no text |

Chain terminal states (from `state`/`failure` in events or result; rendered by 3.4): `COMPLETED`; `FAILED` with `failure` such as `reviewer_rejected`, `checker_failed`, `*_response_identity_missing`; `HALTED` with `kill_switch_flipped`, `ledger_write_failed`, `ledger_write_failed_after_call`; `ORPHANED`; `budget_refused`. A failure the client does not recognise is shown as `The mission stopped: <failure>.` only if the string matches `^[a-z0-9_]{1,64}$`, else `The mission stopped.`

---

## 3. (c) Result-render rows and flow

### 3.1 Flow on `/mission go <word>`

1. Gate checks (1.5). 2. Echo the line as typed. 3. Generate key A, key B, `clientTriggerId`; compute `key_hash`, `player_hash`. 4. Send 2.1 (with `Asking Julius to set up the mission...` row). 5. On 201 write the trigger line (4.2 line 1) naming the NEW run id, flush, hash it, send 2.2. 6. On 202/200 start the poll loop (2.3). 7. On `terminal:true` read 2.4. 8. Verify, render, log.

Note on ordering (U6): the J1 contract says the trigger line is written BEFORE the request is built and the run id comes from the mission POST. Spec resolution: line 1 is written after 2.1 returns (so it carries the real run id) and before 2.2, and a separate line 0 (`WLMISSION build ...` at subsystem init) and the `/mission run` row precede 2.1. If the reviewer insists the line precede 2.1, then `run=` is `pending` and a second `trigger2` line is needed; flagged.

### 3.2 No Follow

The new subsystem never calls `Follow()`. The world's existing Julius state strip (hydrated through `UWonderlandJuliusSubsystem`) therefore keeps showing what it showed; the mission lives only in terminal rows. If the owner wants the strip/orb to react (a real "in-world" effect), that needs the real hydrate/events/result routes and is outside this spec (U1).

### 3.3 Subsystem and logic split (as CDR 2a)

`UWonderlandJuliusMissionSubsystem : UGameInstanceSubsystem` (InitializeDependency on the stream subsystem, as `Stream.cpp:425` does for its dependency). Pure logic in `namespace WonderlandJuliusMissionLogic` (no UObject): `Sha256Hex`, `ParseDispatchAck`, `ParseEventsPage`, `ParseResult`, `PlayerLineForKind`, `SplitForRows`, `IsLoopbackBridge`, `KeyShapeOk`. The branch passes `TWeakPtr<SWonderlandLiveTerminal>` into callbacks (the UI keeps a `TSharedPtr`). Rows are written only if the weak pointer resolves; otherwise log `shown=0 (no terminal)`.

### 3.4 Rows (all via `AddJuliusRow`; role string `Julius`; headline = text, detail = sub-line; sub-line shows on the newest row only per CDR 2i, `WonderlandJuliusWorkLog.cpp:405-412` as CDR cites it, not opened by me)

When `mode == "fake"` (any answer), EVERY row headline is prefixed `REHEARSAL (fake provider) - ` and no row says a model "did" anything real. A `live` row has no such prefix.

| When | Headline | Sub-line |
|---|---|---|
| `/mission run` | `Registered mission <missionId> - contract check <first 12 of frozen contract sha256>.` | `Type /mission go <WORD> within 60 s to start. This uses real paid services.` (for a fake-mode rehearsal build: `This rehearsal uses a fake provider.` - determined only after the first answer, so the first row always shows the paid warning; see U7) |
| run created | `Mission created: run <short 8 of runId>.` | `Starting the chain...` |
| dispatch accepted | `Julius accepted the mission.` | `Dispatch <short 8 of dispatchId>` |
| `role.started` | `<Role> is working...` | |
| `role.completed` | `<Role> finished.` | `ref <first 8 of responseIdSha16>` |
| `role.failed` | `<Role> could not finish: <outcome or failure>.` | |
| `checker.completed` | `The hidden check: <passed|failed>.` | |
| `chain.refused` | `Stopped before the next step: budget limit.` | |
| result header | `Mission <COMPLETED|FAILED|HALTED>. Reviewer: <approve|reject|none>. Checker: <pass|fail|none>.` | `Julius mission - check <first 12 of resultSha256> - run <short 8>` |
| one row per role (from `roles[]`) | `<Role>: <outcome>, <outputChars> characters<, N tool calls for coder>` | `check <first 12 of outputSha256>` |
| artifact | `artifactText` word-wrapped to the row width, each line masked by `MaskForDisplay` AFTER the digest check; at most `VisibleRows` rows (measure in PIE; `GetSectionVisibleRows`, `LiveTerminal.h:196`; `WorkLog.h:104-105`) | |
| overflow | `(artifact continues: N more characters - /mission more)` | |
| digest bad | `Julius's answer arrived damaged and is not shown.` | |

`<Role>` is the capitalised wire role (`Architect`, `Coder`, `Reviewer`, `Checker`): roles are not provider names. `responseIdSha16` is a hash, `responseIdTail` is the last 8 chars of a provider response id; neither is printed on a row, and the tail only goes in the `roleinfo` log line.

HUD rule (CDR R11; memory entry `wonderland-preserve-hud-layout`): four sections, no new panel, strip or scroll; all of this is content in the existing JULIUS 3.3 section. Prove with a before/after PIE or packaged screenshot at the same resolution. Do NOT render in the sidekick Say path (CDR 2i trap).

Unbounded growth (CDR R10): rows only ever grow; the artifact cap plus `/mission more` bounds one run, and the 2-run cap bounds a session.

---

## 4. (d) Client log lines

Category: new `LogWonderlandJuliusMission` (static, `DEFINE_LOG_CATEGORY_STATIC` as `Stream.cpp:26` does for its category). Verbosity `Display` so lines reach the packaged log. Time field `utc=` is `FDateTime::UtcNow().ToIso8601()` extended to milliseconds (`YYYY-MM-DDTHH:MM:SS.mmmZ`), explicit UTC regardless of the PC clock zone. Values contain NO spaces (j1 DESIGN 5.5). Never `WLBRAIN`, never `JULIUS STREAM:` (proof jobs parse the latter, `Stream.cpp:1184` shows its format).

### 4.1 Definitions

- `key_hash` = first 16 lowercase hex of SHA-256(UTF-8 of the dispatch idempotency key B). It equals the ledger `keyHash` (j1 DESIGN 6). The mission-create key A gets `create_key_hash` the same way (4.2 line 2).
- `player_hash` = first 16 hex of SHA-256(UTF-8 of the paired participant id exactly as the bridge sees it as `participantId`). Needs a getter (U3).
- `build` = sanitised `WonderlandBeta::BuildLabel()` (spaces and any non `[A-Za-z0-9._-]` -> `_`, max 64). The owner must make `BuildInfo\BuildInfo.txt` line 1 a single token that names the package, e.g. `wl-inworld-c1-<commit8>` (U9: how the file is generated is not something I checked).
- Parsers match `WLMISSION (trigger|chain|result|refused|build|roleinfo) ` only (collision with existing `WLMISSION` text in 0).

### 4.2 Formats

```
0  WLMISSION build id=<build> commit=<8hex|unknown> sha256_selftest=<PASS|FAIL> loopback_only=1 gate=<0|1> dev=<0|1> utc=<ISO>
1  WLMISSION trigger run=<runId> mission=<missionId> key_hash=<16hex> player_hash=<16hex> build=<build> utc=<ISO>[ rehearsal=fake]
2  WLMISSION create run=<runId> mission=<missionId> create_key_hash=<16hex> http=<code> utc=<ISO>          (PROPOSED, additive)
3  WLMISSION chain run=<runId> seq=<n> role=<architect|coder|reviewer|checker> phase=<started|done|refused> utc=<ISO>
4  WLMISSION result run=<runId> body_sha256=<64hex> result_sha256=<64hex> digest_ok=<0|1> rows=<n> masked=<0|1> utc=<ISO>
5  WLMISSION roleinfo run=<runId> seq=<n> role=<r> outcome=<o> resp_tail=<8> resp_sha16=<16hex> in=<n> out=<n> total=<n> utc=<ISO>   (PROPOSED, additive)
6  WLMISSION refused run=<runId|none> kind=<kind> utc=<ISO>
7  WLMISSION verify run=<runId> http_sha256=<64hex> artifact_ok=<0|1|na> mode=<fake|live> shown=<0|1> utc=<ISO>                    (PROPOSED, additive)
```
Lines 1, 3, 4, 6 are the exact formats of j1 DESIGN 5.5 (lines 1-4 there). Lines 0, 2, 5, 7 are PROPOSED additions; consumers must ignore unknown line types. `rehearsal=fake` appears iff the `mode` field of the dispatch/events/result answers is `fake`; for line 1 (written before any answer) the client cannot know the mode, so `rehearsal=fake` is emitted on line 1 only when the build itself is a rehearsal build (CVar `wl.Julius.Mission.Rehearsal` = 1, set by the QA script, and not otherwise settable from the terminal); the bridge's `mode` stays authoritative on lines 4 and 7, and a mismatch (`rehearsal=fake` on line 1 but `mode=live`, or the reverse) is logged as `refused kind=local_mode_mismatch` and the result is not shown.

`rows` on line 4 is the number of `roles[]` entries. `masked=1` iff `MaskForDisplay` changed at least one artifact row. `kind` for local refusals is `local_*` (1.5) so a reviewer can tell client refusals from bridge refusals (`julius_dispatch_*`, `sign_in_required`). If the reviewer's N1 wording `kind=unauthorized` is wanted, map 401/403 kinds to it (j1 DESIGN 5.5 line 4); U10.

### 4.3 What is NEVER logged

Idempotency keys, the token, any URL or bridge address (`Describe` prints `BridgeUrl()` at `Stream.cpp:1184-1189`: do not copy it), the confirm word value, question or answer or result or artifact text, any `message` string from the bridge, `budget`, `maxOutputTokens`, and any name in the 4.6 list. Log `status`, `kind`, ids, lengths and hashes only (CDR R7/R8).

### 4.4 Join keys for the independent check

Client line 1 `key_hash` == ledger `run_start.keyHash` == every `pre_call.keyHash`; line 1 `run=` == ledger `runId`; line 4 `result_sha256` == ledger final-row `resultSha256`; line 1 `utc` earlier than the first `pre_call.at` (crosscheck C1); sha256 of the exact line 1 message == the dispatch body's `clientLogSha256` == `run_start.clientLogSha256`.

### 4.5 `/ask` log lines (only if `/ask` ships; from CDR T4, prefix `WLASK`)

```
WLASK sent ask (question <N> chars, key_hash <16hex>)
WLASK answered askId=<ask_...> ledgerRef=<...> chars=<N> body_sha256=<64> answer_sha256=<64> digest_ok=<0|1> rows=<K> masked=<0|1>
```
Per CDR section 1 and 2f the client reads only `answer, answerDigest, answerChars, askId, ledgerRef`, never `provider, model, usage, responseId`.

### 4.6 Provider-name ban (applies to both features)

No client string literal, row, log format or QA output contains: `openai, anthropic, claude, gpt, xai, grok, gemini, hermes, codex, llama, mistral, sonnet, opus, haiku` (CDR R5). Do not put that list in runtime code; the QA script (5) greps for it in the log, and the repo test scan list in CDR R5 does NOT cover new files, so the grep is the only guard. The artifact text itself could contain a provider name; the client cannot rewrite it without breaking the digest: founder/owner ruling needed (U11).

---

## 5. (e) Capture / QA script outline (W4)

Owner: Wonderland dev. Heavy (needs a packaged build and the RAM/disk window). I did not look at the existing capture tooling for this build (`wonderland\Tools\captures` shows in `git status`; the plan says the capture script for this build is UNVERIFIED), so this is an outline of what the script must do, not an adaptation of an existing script. Reuse the house practices recorded in memory entries (`filming-the-game-window`, `core-drive-real-input-harness`): DPI-aware, TOPMOST game window, real-input drive for the typed commands (a shell window in front voids the drive).

Environment: SEPARATE package from a task3 branch with its own identity (plan section 5), standalone, `-wldev -wllocalai`-style flags only as the owner decides (U12), bridge on 127.0.0.1, one paired session, no Railway or live store, no multiplayer. The r16reh18 package (game exe df6b70c8 per plan section 5) is the BASELINE reference only.

Per run (rehearsal first, then live):

1. Pre-flight (no game): record `git rev-parse HEAD` of the build branch, `BuildInfo.txt`, sha256 of the packaged exe and of `BuildInfo.txt`; confirm bridge process is on loopback and `JULIUS_J1_ENABLED` state; copy the bridge ledger file size/sha256 BEFORE; free disk and RAM figures.
2. Start the game with `-LogCmds` NOT raising LogHttp; start timestamped screen capture (ddagrab crop of the game window) and keep the `Saved\Logs\Wonderland.log` path. Take the "before" screenshot of the HUD at the fixed resolution.
3. Boot assertions from the log: line 0 present with `sha256_selftest=PASS`, `loopback_only=1`, the expected `build=`; no `Relay-Session`/`Authorization` anywhere yet.
4. Pair (outside the script: founder / paired token). Script waits for the paired line (`JULIUS STREAM: paired as ... for ...`, `Stream.cpp:586` - NOTE that this line prints the participant id in clear; the QA grep for secrets must not treat it as a leak but the evidence folder should redact it).
5. Typed drive: `/mission` (status), `/mission run`, read the confirm word from the screenshot/OCR or have the founder type it; `/mission go <word>`. The script records the wall-clock time of each keypress batch and screenshots the rows at each stage: accepted, each role started/finished, result header, artifact rows.
6. Log assertions (regexes on the 4.2 formats): exactly one line 1; line 3 sequence numbers contiguous from 1 with all four roles `started` before `done`; exactly one line 4 with `digest_ok=1`; `body_sha256 == result_sha256`; the screenshot's `check <12>` equals `result_sha256[:12]`; the line 1 `utc` precedes the first ledger `pre_call.at`; sha256 of the line 1 message equals the ledger `clientLogSha256`.
7. Post (no game): copy the bridge ledger; run the reviewer's crosscheck (it exists on the reviewer side: I did not find `INWORLD_ACCEPTANCE_PROTOCOL` or `crosscheck.py`; names come from j1 DESIGN 6/6.1) against log + ledger; compute `sha256sum` of every artifact file and write a manifest.
8. Leak sweep over the whole client log: must NOT match `Relay-Session`, the token, `Authorization`, the confirm word, the idempotency key values, any URL, `budgetBasis`, `maxOutputTokens`, any 4.6 name. Only `WLMISSION`/`WLASK` lines carry ids and hashes. (Allowed: the existing `JULIUS STREAM:` lines.)
9. HUD sameness: after-screenshot vs before-screenshot silhouettes identical (no new panel/strip/scroll).
10. Close; "after" log copy; freeze the folder with a hash list; never edit a submitted file in place (memory entry `never-edit-submitted-files-in-place`).

Run 2: repeat 5-10 with a fresh key and a fresh run id; assert the second `key_hash` differs and a third dispatch is refused by the bridge cap (`julius_dispatch_mission_cap_reached` row).

QA console command `wl.Qa.JuliusMission` (no network), style of `wl.Qa.BridgeUrl` (`Stream.cpp:1294-1361`, prints `WLQA BRIDGEURL <id> PASS|FAIL` and an END line): prints `WLQA JULIUSMISSION <id> PASS|FAIL -- <what>` and `END pass=N fail=0`. Cases: SHA-256 known answers (empty string `e3b0c442...b855`, `abc` `ba7816bf...15ad`, a multi-block message, a UTF-8 two-byte and a 4-byte message); key regex; loopback parser (`http://localhost:80@evil.example/` must be REFUSED, the class `Stream.cpp:180-182` documents); parser keeps only the fields in 2.3/2.4; one player row per kind in 2.5; rows for every terminal state; digest mismatch refuses display; `rehearsal=fake` label logic; row splitting; confirm-word expiry; no provider name in any player string (iterate the table and test against the 4.6 list built in the TEST only).

---

## 6. (f) Failure-state controls and the fake-provider negative control

Zero-spend. Run first, in a packaged build, against the J1 bridge in FAKE mode (the bridge supports `mode: fake`, `julius_dispatch_mode_mismatch`, j1 DESIGN D11). A fake run is never evidence (crosscheck C0); it exists to prove the client and the capture script.

### 6.1 Fake-provider negative control (the labelled control)

- N0 Positive fake: full chain in `fake` mode. Expect: every row prefixed `REHEARSAL (fake provider) - `; line 1 `rehearsal=fake`; lines 4 and 7 `mode=fake`; QA script marks the run `NOT EVIDENCE`. Then prove the label cannot be dropped: a fake answer that arrives on a build with `wl.Julius.Mission.Rehearsal=0` -> `refused kind=local_mode_mismatch`, nothing shown.
- N0b The reverse: a `live` answer on a rehearsal build -> same refusal.

### 6.2 Failure-state controls (each ends in exactly one `WLMISSION refused` line or a labelled terminal row; none may draw a result)

| # | Control | Expected |
|---|---|---|
| F1 | `wl.Julius.Mission 0`, then `/mission run` | `not part of this build`, `kind=local_off`, bridge ledger gains NO row |
| F2 | not a developer session (no `-wldev`, no editor) | `kind=local_not_developer`, nothing sent |
| F3 | `LogHttp VeryVerbose` active | `kind=local_http_verbose`, nothing sent |
| F4 | no bridge URL / refused URL / https remote / `http://localhost:80@evil.example` | `local_no_bridge` / `local_bridge_refused` / `local_not_loopback`, nothing sent |
| F5 | unpaired; paired without project | `local_not_paired` / `local_not_paired_for_a_project` |
| F6 | SHA-256 self-test forced to fail (QA CVar in the TEST build only) | `local_sha_selftest`, nothing sent |
| F7 | wrong/stale confirm word; word after 60 s; `/mission go` with no pending; `/mission run extra text` | row refusals, nothing sent |
| F8 | second `/mission go` while a chain is in flight | local refusal, no second HTTP request (count requests) |
| F9 | bridge kill switch off (`JULIUS_J1_ENABLED` unset) | 503 `julius_dispatch_disabled` row, no ledger row |
| F10 | kill switch flipped mid-chain | next role never starts; HALTED `kill_switch_flipped` row; chain stops |
| F11 | dispatch with the operator bearer / with an Origin (curl, outside the game; confirms bridge side) | `julius_dispatch_operator_is_not_the_game` / `_browser_refused` |
| F12 | second pairing (another session id) | `julius_dispatch_second_pairing` row |
| F13 | ledger write failure (bridge-side fault injection) | before the call: 503 `ledger_unavailable` row; after a call: HALTED `ledger_write_failed_after_call`, response id remains in an event |
| F14 | reviewer rejects (fake) / checker fails (fake) | `FAILED`, rows say rejected/failed, NO "success" row |
| F15 | **digest mismatch**: fake bridge returns a `resultSha256` that differs by one hex digit | `digest_ok=0`, `damaged`, no artifact row. This is THE negative control (CDR R12 3) |
| F16 | `resultText` mutated after hashing (one byte) | same as F15 |
| F17 | event `sequence` duplicate / gap / out of order; unknown `role`; `terminal:true` never arrives | dup ignored; gap logged; unknown role rendered `a step`; client gives up at the local cap (below) with `kind=local_poll_timeout`, shows `Julius has not finished; the mission may still be running`, and never says it failed |
| F18 | bridge restart mid-chain / after chain | events 404 `julius_dispatch_run_unknown` -> `The server does not know that run any more`; `ORPHANED` -> row |
| F19 | 401 mid-chain | `NoteSessionRefused()`; link shows "pair again"; polling stops |
| F20 | connection refused / timeout on each of the four calls | each own row; dispatch no-response does NOT auto-retry |
| F21 | HTTP 200 that is not JSON; a body whose `data` is missing; `error` as a string | `could not read` / generic row; no crash |
| F22 | terminal closed or rebuilt before the result | `shown=0 (no terminal)` in line 7; `/mission result` redraws later |
| F23 | oversize `artifactText`, markup, control characters, a key-shaped string inside the artifact | rows capped; `/mission more` pages; key-shaped text masked (`masked=1`); control characters not drawn |
| F24 | two `/mission go` typed fast (double Enter) | exactly one POST dispatch |
| F25 | run 3 | bridge cap row; client makes no further attempt |

Local poll cap: the bridge role timeout default is 10 minutes per role (j1 OPEN_ITEMS 13), so the client cap is `wl.Julius.Mission.MaxWaitSeconds` default 2100 (35 min) and is stated as a client constant to revisit (U13).

### 6.3 Repo-test controls (T8 of CDR)

`wonderland-cpp-parity.test.ts` and `wonderland-card-vocabulary.test.ts` stay green with the new files `git add -N`'d (CDR 2a). These are Julius-repo tests run by the owner; I did not run them.

---

## 7. (g) What must NOT touch the r16reh18 scored line

The scored line is the governed r16reh18 package (plan section 5: game exe df6b70c8; HEAD `aa930c26` is "r16reh18 reviewer NITs") and any R16 scored window (plan: "reviewer A2/A3"). Rules:

1. Branch from `aa930c26` ONLY into a NEW branch (name chosen by the owner; I did not list branches beyond the first 20). Do not commit on `local/r16reh16w`, do not move it, do not merge the package branch into it or into task3's integration refs. The worktree currently has uncommitted changes under `wonderland/Tools` (status above): the owner must decide whether to branch from a clean checkout in a separate worktree; the package branch must not carry those changes along silently.
2. The only edits to existing files: one `#include` and one branch block in `WonderlandUiSubsystem.cpp` (between `:4547` and `:4549`), the optional `/help` string (`:4605-4616`), and the small additive getter in `WonderlandJuliusStream.h/.cpp` for the participant id (U3). Nothing else in `WonderlandProjectBrain*`, `WonderlandCard*`, `WonderlandMission*` (existing), `WonderlandSocial*`, `WonderlandWorld*`, Sidekicks, or any Config/ini (a new CVar is a code default, not an ini).
3. Separate package output directory and separate `BuildInfo.txt` identity; never overwrite, repackage into, or reuse the staging directory of the r16reh18 package or the `_wonderland_beta_release*` / `_wonderland_package_*` folders.
4. No ask or mission code reaches any build used for R16 scoring, the multiplayer two-client runs, or the 0.75 line. The new CVars default to 0, and the package must not be installed over a laptop's R16 install.
5. No effect on the Julius strip/orb/hydration path: the client does not call `Follow()` (3.2), does not call `CreateMission` (which follows), does not touch `JULIUS STREAM:` log formats, does not change `UWonderlandJuliusSubsystem`, the decoder, or the wire fixtures.
6. No scheduling inside an R16 scored window: heavy build/capture runs obey the 10-16 RAM rule (plan W2: 1.9 GB short at the time; C: about 4.6 GB free) and wait for the owner's clear window; the plan notes WDev 250ee365 is on the R16 75% sprint with a 2026-10-31 deadline (plan W3), so ownership and timing are an owner decision (U14).
7. No edits to the r16reh18 evidence, pins, or any submitted file (memory entry: never edit submitted files in place).
8. The bridge runs on the founder's laptop loopback with no Railway/live store (plan section 5), so no hosted deploy or multiplayer path is touched.

---

## UNVERIFIED / open questions

U1. Hydrate/events/result routes: `CreateMission` ends in `Follow()` which polls `/wonderland/julius/{hydrate,events,result}`; these are NOT on main 3f20fc1a and J1 serves only its own `/dispatch/*` GETs (j1 OPEN_ITEMS 2). This spec avoids `Follow()`; whether the founder requires the world strip/orb to react (needs the integration branch + a Postgres-backed run) is unresolved. I did not verify that the bridge's `POST .../missions` route exists on the bridge that will run (it is on the unlanded integration branch, per OPEN_ITEMS 2), which is also where the run id for a dispatch would come from. If the J1 bridge has no `POST /wonderland/julius/missions`, the sequence in 2.1 cannot work.
U2. `WLMISSION` prefix collides with existing client lines (0). Rename (and update j1 DESIGN 5.5 and the reviewer crosscheck) or keep and anchor on the second token. Needs a JUDEV + reviewer decision.
U3. `player_hash` needs the participant id; the stream subsystem only logs it (`Stream.cpp:580-587`). A getter edit in `WonderlandJuliusStream.h/.cpp` is required; I did not check whether the bridge's `participantId` equals `Parsed->participantId` exactly (same string) and the paired line prints the id in clear.
U4. The frozen mission record (text, contract sha256, mission id) and how the client holds it. The existing mission POST sends objective/requirements/constraints/criteria, not a pre-hashed contract (j1 OPEN_ITEMS 19). The bridge's `RunLookup` returning `contractSha256` is unverified (OPEN_ITEMS 4). No frozen mission exists yet (OPEN_ITEMS 5).
U5. Log flush: which UE call guarantees the trigger line is on disk before `ProcessRequest()` (e.g. `GLog->Flush()`) was not checked. The `clientLogSha256` binding proves ordering of claims only, not human typing (j1 DESIGN 4).
U6. Order of trigger line vs run creation (3.1): J1 says the line is written "BEFORE the request is built" but it needs the run id that the mission POST returns. My resolution (write after 2.1, before 2.2) needs the reviewer's agreement.
U7. The paid-warning row cannot know `mode` before the first answer; a fake-mode rehearsal therefore shows the paid warning too. Whether a `GET` mode probe is acceptable is open.
U8. Lone-surrogate / UTF-8 equality between `FTCHARToUTF8` and Node (CDR R15) was not tested. A false "damaged" is the safe failure.
U9. How `BuildInfo\BuildInfo.txt` is generated in the Wonderland packaging flow, and how a commit id gets into line 0 (`commit=` is a hole). Not checked.
U10. The reviewer's `INWORLD_ACCEPTANCE_PROTOCOL` (D1-D12, N1-N9, C1 crosscheck) was NOT found by a filename search under `_qa_handoff`; I relied on j1 DESIGN 6.1/6.2 for its content. Wording such as `kind=unauthorized` is unconfirmed.
U11. A provider name inside the artifact text (the client cannot rewrite it). Ruling needed.
U12. Which launch flags the standalone package uses (`-wldev` gives `IsDeveloperSession()`; `-wllocalai` is `UseLocalAiServices()`; `WonderlandBeta.cpp:54-64`). The plan says "local-AI mode"; whether a packaged non-editor build honours `-wldev` was not tested here, and `LockDownPlayer` (`WonderlandBeta.cpp:90-`) removes the console keys for non-developer sessions.
U13. The 35-minute client wait cap is my estimate from the bridge's 10-minute-per-role default (OPEN_ITEMS 13), not a measured figure; the real chain duration is unknown (no live run exists).
U14. Ownership and timing: whether WDev 250ee365 or another session owns W1-W4, the earliest heavy window, and which commit to branch from (the three questions of the mail) are unanswered; I did not read any reply. The worktree's dirty state at `aa930c26` needs the owner's decision.
U15. Which HTTP backend Windows uses (Curl or WinHttp) and therefore whether the `LogHttp VeryVerbose` header-print risk applies exactly as CDR R1 reads (`CurlHttp.cpp` not opened by me; also not opened: `IHttpBase.h`, `IHttpRequest.h`, `BaseEngine.ini` timeouts). The default activity timeout (30 s per CDR) is irrelevant to the J1 calls (each answers quickly), but matters for `/ask` (150 s timeout per CDR 2h).
U16. JULIUS 3.3's runtime `VisibleRows` and characters per row (must be measured in PIE); `WonderlandJuliusWorkLog.cpp` sub-line behaviour is cited from CDR, not opened by me.
U17. Whether `/ask` and the J1 route share a bridge process on the founder laptop (the ask route is unlanded; J1 does not import ask code per j1 DESIGN 1). Packaging `/ask` is optional and reviewer-gated (F4-F8 open).
U18. Nothing in this spec was compiled or run. Class and function names are proposals. UE 5.8 API details (FSHA1 only; `UE_LOG_ACTIVE`; `GLog->Flush`) beyond what is cited above were not verified against the engine source.
