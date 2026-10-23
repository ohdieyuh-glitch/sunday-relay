# C2 acceptance protocol vs J1 client addenda: 7 conflicts (2026-10-23, Wonderland dev agent "Cosmo")

Status: documentation only. Changes nothing, awards nothing, makes no readiness claim (readiness stays 56.25% verified; R16 credit 0 of 18.75). No criterion is weakened here; every resolution is a PROPOSAL for the protocol owner (JUDEV2/C2) and the client owner (WDEV) to accept or reject.

Line numbers are 1-based and were read from the exact bytes whose sha256 is listed below. Quotes are short excerpts.

## Sources (sha256 of the exact bytes cited)

| Tag | Original path on Kaisin (C:\dev\iwonder\...) | Copy in this commit | sha256 |
|---|---|---|---|
| PROT | `_independent_review_judev2_20261021\C2\INWORLD_ACCEPTANCE_PROTOCOL.md` (74 lines) | `docs/sources/_independent_review_judev2_20261021/C2/INWORLD_ACCEPTANCE_PROTOCOL.md` | `58ba107e0fa1dc4858c075f396c9ae4cef686646bb27005ffcfb026b8d0aa2db` |
| SPEC | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\j1\CLIENT_PACKAGE_SPEC_r1.md` (380 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/j1/CLIENT_PACKAGE_SPEC_r1.md` | `43958afa8960e8a3d3d3c82cf7aa0a64cc51d2597127eb2cc191310322aea7d2` |
| ECHO | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\j1\CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md` (20 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/j1/CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md` | `f03e7f91e7a72a0ebc0dd606fc152d0d6f89ebbc093c2db79dcbc28122a03e11` |
| PLANADD | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md` (17 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md` | `ce1aff4769174b1046c5632bcd48b5b7190ca90283baabd6052be7d8a7a8e97d` |
| J1 | sunday-relay `relay-bridge/julius-dispatch.ts` at commit `22a0a9cb2cc93f64929f1dd855aa242936f739e9` (blob `018fb582b427ad4fc884b9965d8bd3d8080ebf5b`, 1050 lines; read with `git show 22a0a9cb:relay-bridge/julius-dispatch.ts`) | not copied: it is already readable at that fixed commit | `0a29be76e58fae6a9938a33704434ff6ffdc8df406007918d0c5a12ee6588fe6` |

Notes on the sources:
- **Path discrepancy.** The protocol is NOT under `...\inworld_missions_20261022\`. That folder holds only `j1\` and the PLAN addendum. The protocol was found at the PROT path above (mtime 2026-10-22 01:05 PT). SPEC line 372 (U10) also records that a filename search under `_qa_handoff` did not find it.
- The PLAN addendum lives one level above `j1\`, not inside it. Its title calls it an addendum to SPEC r1, so it is cited and copied. The `PREREG_v*_ADDENDUM_*_DRAFT.md` files in `j1\` are pre-registration addenda. None of the 7 conflicts depends on them, so they are neither cited nor copied.
- Precedence: ECHO line 1 says "Where it differs from spec r1 and from ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md, THIS wins." So the order is ECHO > PLANADD > SPEC.
- Commit 22a0a9cb (committer time 2026-10-23 01:09 PT) is contained in the remote-tracking branch `origin/judev/j1-combined-ceiling` (`git branch -a --contains`). That branch's local tip is `126b371301288f86676f577cf58f2b54270b291a`. No fetch was done, so this reflects the local remote-tracking ref only. There is no local branch of that name.
- ECHO line 1 says its bridge contract was read at `judev/inworld-dispatch` tip 2f8c346a. The `run_created` code cited here comes from a different branch/commit (22a0a9cb). Which bridge tip will run is still unconfirmed.

## Conflict 1: log prefix `WLMISSION` vs `WLJMISSION`
- **Protocol:** PROT:6 "Client (one line each, prefix `WLMISSION`, never `JULIUS STREAM:` or `WLBRAIN`..."
  - The line formats at PROT:7-10 all start `WLMISSION ...`.
  - N1 expects "`WLMISSION refused kind=unauthorized`" (PROT:60).
- **J1 side:**
  - ECHO:8 "Log line A (prefix `WLJMISSION`, kind `ui_action`...".
  - ECHO:15 "## 4. Log lines (prefix WLJMISSION, line-anchored...".
  - PLANADD:4 "U2: client lines use the prefix WLJMISSION (not WLMISSION)... EXACT LINE-ANCHORED match".
  - SPEC:240-245 still uses `WLMISSION`. SPEC:364 (U2) records the collision: "`WLMISSION` prefix collides with existing client lines".
- **Conflict:** `crosscheck.py` built to PROT:6-10 would match no J1 client line, so C1/C4/C5/C9 could not pass for a reason unrelated to the run. ECHO wins on the client side.
- **Proposal:** the protocol and crosscheck adopt `WLJMISSION`, anchored at line start, as PLANADD:4 asks.

## Conflict 2: one `trigger` line vs `ui_action` / `run_id_received` / `trigger`
- **Protocol:**
  - PROT:7 defines one line, "`WLMISSION trigger run=<id> mission=<id> key_hash=... utc=<ISO8601Z> [rehearsal=fake]`".
  - PROT:33 C1: "exactly one in-game trigger; its utc < first ledger pre_call".
  - PROT:24: "The ledger `pre_call` must be later than the client `trigger` line."
- **J1 side:**
  - ECHO:8 adds line A `ui_action` ("local UTC, NO run id").
  - ECHO:10 adds "log line B `run id received` with the run id".
  - ECHO:16 lists "`ui_action`, `offset`, `run_id_received`, `trigger` ...".
  - PLANADD:6 gives the order "(i) log a "UI action" line ... BEFORE the mission POST is sent; (ii) mission POST; (iii) log a "run id received" line...".
  - PLANADD:10: "C1 ... needs to say which of the two lines it uses and add the new inequality UI-action < ledger run-created."
  - J1 enforces this bridge-side at J1:248 ("THE ORDERING RULE: UI-action < run_created <= first pre_call <= result") and J1:768 ("UI-action < run_created: the client's claimed UI time must parse, and must precede the bridge's own clock reading").
- **Conflict:**
  - C1 does not say which of the J1 lines is "the trigger".
  - The protocol has no `ui_action`-before-`run_created` check.
- **Proposal:**
  - C1 names the `WLJMISSION trigger` line (it carries run, key_hash, player_hash and build, per ECHO:16), with "exactly one" and "utc < first pre_call" kept unchanged.
  - Add rule C1b: exactly one `ui_action` line for the run; its UTC < ledger `run_created.at`; and ledger `run_created.uiActionUtc` equals that line's UTC.
  - Any reorder or extra line is a FAIL. Nothing in C1 is relaxed.

## Conflict 3: J1's `run_created` ledger row is not named in the protocol
- **Protocol:** PROT:11 lists the ledger rows: "`run_start` {runId, missionId, frozenSha256, budgetCapUsd, authorizedPlayerHash}; per leg `pre_call` {...} ... and `result` {...}; a `final` result row {resultSha256}". There is no `run_created`.
- **J1 side:** J1:846-852 (at 22a0a9cb):
  - "RUN_CREATED: this route creates the run's dispatch in ONE authenticated flow (there is no separate creator route in this branch)".
  - It appends `phase: 'run_created', runId, dispatchId, creatorPlayerHash: callerHash, creatorKeyHash: keyHash, uiActionUtc: input.clientUiActionUtc, clientTriggerId, clientLogSha256, at, clientOffsetMs, echoId`.
  - J1:853 "THE RUN_START ROW precedes every pre_call row".
  - J1:254-267 refuse when `run_created_missing`, `ui_action_not_before_run_created` or `row_before_run_created`.
  - PLANADD:11 asks for exactly this as "a named field" and marks it "UNVERIFIED, to be checked against wt_j1". At 22a0a9cb the row exists in code. This is code-level only: no run has produced it under the protocol.
- **Conflict:** crosscheck cannot check creator attribution (creatorPlayerHash/creatorKeyHash vs the client's player_hash/key_hash) or the UI-action ordering, because the protocol does not name the row.
- **Proposal:**
  - Add `run_created` to PROT section 0 with the J1:849-851 fields.
  - Require exactly one per run, before `run_start`.
  - Require `creatorKeyHash` == client `key_hash` and `creatorPlayerHash` == client `player_hash` == `authorizedPlayerHash`.

## Conflict 4: C5 and the on-screen check use `result_sha256[:12]`; ECHO §3 displays `artifactSha256[:12]`
- **Protocol:**
  - PROT:9 result line "`body_sha256=<64> result_sha256=<64> digest_ok=<0|1>`".
  - PROT:37 C5 "client `result_sha256` == ledger final `resultSha256`, `digest_ok=1`".
  - PROT:45 "reviewer compares `check <12>` sub-line to the first 12 hex of result_sha256 by eye".
- **J1 side:**
  - ECHO:1 precedence ("THIS wins").
  - ECHO:14: the game "DISPLAYS THE FIRST 12 HEX CHARACTERS of that value [`artifactSha256`]... `resultSha256` is NEVER labelled or shown as the artifact hash".
  - ECHO:16 result line is "`result` (artifact_sha256 full, digest12, digest_ok, rows)". The client result line no longer carries `result_sha256` (or `body_sha256`).
  - SPEC:211 ("`check <first 12 of resultSha256>`") and SPEC:287 ("the screenshot's `check <12>` equals `result_sha256[:12]`") are superseded by ECHO. So are SPEC:243 (line 4 carries `result_sha256`) and SPEC:258.
- **Conflict:**
  - C5 compares a client field that the ECHO result line no longer emits.
  - The by-eye check compares the screen against the wrong hash: the screen shows `artifactSha256[:12]`.
- **Proposal:**
  - C5 becomes: client `artifact_sha256` == the result JSON `artifactSha256` == the ledger coder row `artifactJudgedSha256` (ECHO:14), with `digest_ok=1` and `digest12` == `artifact_sha256[:12]`.
  - The by-eye check compares on-screen `check <12>` with `artifact_sha256[:12]`.
  - The ledger `final.resultSha256` stays checked bridge-side (whole result bytes) but is not compared with the screen.
  - The f00041 equality test (ECHO:14, PLAN open item) is still pending in J1.

## Conflict 5: N9 bridge restart mid-run: J1 can only take the refuse branch
- **Protocol:** PROT:68 N9 "client shows disconnected; on resume either same run completes from ledger or refuses; no duplicate pre_call for a finished leg".
- **J1 side:**
  - PLANADD:12 "J1 refuses a repeat (not resumable, j1 OPEN_ITEMS 8), so J1 can only satisfy the refuse branch; it must not claim recovery."
  - SPEC:329 F18 "bridge restart mid-chain / after chain | events 404 `julius_dispatch_run_unknown` -> `The server does not know that run any more`; `ORPHANED` -> row".
  - SPEC:165 maps `julius_dispatch_run_unknown` "also after a bridge restart".
  - ECHO:4: the echoId is "forgotten on bridge restart".
- **Conflict:** N9 as written accepts "completes from ledger", which J1 cannot do. A J1 run must never be credited as a recovery.
- **Proposal:**
  - For J1, N9 PASS = refuse branch only: ORPHANED row, a `refused` line, and no new pre_call for any leg after restart.
  - Any "completed after restart" outcome on J1 is a FAIL, not a pass.

## Conflict 6: M2/N8 refuse-to-send while `LogHttp VeryVerbose` is on
- **Protocol:**
  - PROT:51 M2 "even with `LogHttp VeryVerbose` requested (the client must refuse to send while it is on)".
  - PROT:67 N8 "log leak sweep with `-LogCmds="LogHttp VeryVerbose"` | send refused".
- **J1 side:**
  - PLANADD:13 "Spec r1 lists a leak sweep but I have not confirmed that it specifies the refuse-to-send behaviour: UNVERIFIED".
  - ECHO (lines 1-20) does not mention it.
- **Finding:** the conflict as stated ("not in the client spec") is NOT reproduced against SPEC at sha256 43958afa…. SPEC does specify the refusal:
  - SPEC:74 "Gates, checked in this order BEFORE anything is sent".
  - SPEC:77 "`UE_LOG_ACTIVE(LogHttp, VeryVerbose)` ... -> `Not sent: HTTP logging is too verbose...` kind `local_http_verbose` (J1 D3/N8)".
  - SPEC:314 F3 "`LogHttp VeryVerbose` active | `kind=local_http_verbose`, nothing sent".
- **Residual gaps:**
  - PLANADD:13 is stale.
  - ECHO:16 says `refused` carries "(code only)", while SPEC:74 and PROT:60 use `kind=`. The field name for the refusal reason must be pinned.
  - SPEC:377 (U15) leaves open whether the header-print risk applies to the Windows HTTP backend. The client gate is required either way.
- **Proposal:** keep M2/N8 unchanged, and state in the protocol that the expected J1 line is `WLJMISSION refused ... local_http_verbose` with nothing sent and no ledger `pre_call`.

## Conflict 7: rehearsal label `rehearsal=fake` vs "REHEARSAL (fake provider)"
- **Protocol:**
  - PROT:7 trigger "`[rehearsal=fake]`".
  - PROT:19 B4 "trigger line carries `rehearsal=fake`".
  - PROT:32 C0 "no `rehearsal=fake` / `mode=fake` anywhere".
- **J1 side:**
  - PLANADD:14 "Spec r1 uses a "REHEARSAL (fake provider)" row prefix ... format to be aligned to the protocol token `rehearsal=fake`".
  - SPEC:199 "EVERY row headline is prefixed `REHEARSAL (fake provider) - `" (on-screen rows).
  - SPEC:240 line 1 "`utc=<ISO>[ rehearsal=fake]`".
  - SPEC:305 N0 "line 1 `rehearsal=fake`".
  - ECHO:16 (which wins) defines the `trigger` field list as "(carries run id, key hash, player hash, build id, utc)". It does not list `rehearsal=fake`.
- **Conflict:**
  - SPEC carries both forms: the screen prefix and the log token.
  - The governing ECHO line set does not list the token. A literal ECHO implementation could drop it, and C0/B4 would then miss a fake run.
- **Proposal:**
  - ECHO §4 `trigger` (and `result`) must carry `rehearsal=fake` whenever mode is fake.
  - The screen prefix "REHEARSAL (fake provider) - " stays as the player-visible label.
  - C0 matches the log token. M1/video review checks the screen prefix.

## Also noticed (not one of the 7; not counted)
- PROT:60 N1 expects `kind=unauthorized`, but ECHO:16 says `refused (code only)`. This is the same field-name question as in conflict 6.

## Client run-id under option (a) (pending founder decision)
Nothing below is decided. Option (a) is pending the founder's ruling. This section states what the client must do IF option (a) is chosen.

**The client mints the runId:**
- One per run. It is unguessable (Skywalker).
- Format: `[<fixed prefix>]<random part>`.
  - The prefix is OPTIONAL. It is a constant literal fixed in the build (e.g. `wlj_`), the same for every run and every player.
  - The random part is a UUIDv4 from the OS CSPRNG, OR at least 128 bits from the OS CSPRNG, hex-encoded.
- Note: a canonical UUIDv4 carries 122 random bits. If the rule is read strictly as ">= 128 random bits", use 16 CSPRNG bytes as 32 hex characters. The founder/Skywalker should say which reading applies. Neither reading weakens unguessability below 122 bits.
- **No participant id, player hash, key hash, mission id, timestamp, counter, machine name or any other derived data** may appear in the runId.

**Validation:**
- The runId must match `^[A-Za-z0-9:_-]{1,128}$` before use.
- On failure the client refuses locally: nothing is sent, and one `refused` line is logged.
- The same regex is already enforced bridge-side at J1:962 (`const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/;`), with 400 `julius_dispatch_run_invalid` at J1:996 and J1:1012.

**Logged before dispatch:**
- The minted runId is written to the client log (WLJMISSION line, after `ui_action`, flushed) BEFORE the dispatch POST is built.
- The `trigger` line carries it, and the ledger `run_created.runId` (J1:849) must equal it.
- The exact line name for "run id minted" (vs ECHO's `run_id_received`) is not fixed by any source: OPEN.

**Acceptance record:** must state verbatim: **"run lookup is a frozen stub; run existence is not evidence of mission creation"**.
- Context: J1:846-847 says there is no separate creator route in that branch.
- A runId that the bridge "knows" proves only that a dispatch was accepted with that id.

## Missing or unverifiable citations
- The protocol is not at the user-stated folder (see Sources). It was cited from the actual path.
- PROT:5 refers to "section 6 of REPORT_C2" for the format spec. It was not read and is not cited.
- "j1 OPEN_ITEMS 8" (PLANADD:12), "j1 DESIGN 5.5" and `wt_j1` are referenced by the sources but were not opened. They are cited only through the quoting source.
- Bridge tip actually to be run: unconfirmed (ECHO:1 cites 2f8c346a; J1 citations are at 22a0a9cb).
