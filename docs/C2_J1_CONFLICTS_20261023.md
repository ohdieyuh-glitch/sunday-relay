# C2 acceptance protocol vs J1 client addenda: 7 conflicts (2026-10-23, Wonderland dev agent "Cosmo")

Revision 2: follows Skywalker's review of ae67f50a (PASS WITH FINDING). Corrections to conflicts 4-7 and four missed conflicts (M1-M4, Skywalker's findings) are added. Every new J1 citation was re-read with `git show 22a0a9cb:<path>`.

Revision 3: follows Skywalker's review of rev 2 at ab26e15e (PASS WITH FINDING, minor). It fixes the M3 SPEC line (171) and gives a per-kind reachability statement, removes an unresolved label from M4 and cites J1:29-35 and :782-826 directly, and closes the 1254b0d1 open item per Skywalker.

Revision 4: follows Skywalker's review of rev 3 at 8f312b32 (blob f7af3ee9; PASS WITH FINDING). The previous revision is rev 3 (8f312b32), not rev 2: Cosmo mislabelled it as rev 2 in places. Rev 4 adds only Skywalker's findings: the bridge target is now confirmed (Sources notes; Missing or unverifiable citations); M5 (medium, `artifactSha256` vs `artifactJudgedSha256`, which also amends conflict 4); M6 (low, no bridge instance id in `run_start`); SPEC:293 in M4; and a terminology note on "C2". Every rev 4 J1 citation was re-read with `git show 31bfc58b:<path>`. Rev 4 proposes no new resolutions; YUJI owns those.

Status: documentation only. Changes nothing, awards nothing, makes no readiness claim (readiness stays 56.25% verified; R16 credit 0 of 18.75). No criterion is weakened here; every resolution is a PROPOSAL for the protocol owner (JUDEV2/C2) and the client owner (WDEV) to accept or reject.

Line numbers are 1-based and were read from the exact bytes whose sha256 is listed below. Quotes are short excerpts.

## Terminology: "C2" (rev 4; Skywalker's finding)
"C2" now means three different things. From rev 4 on, this doc cites by path and sha256, not by the label alone.
- The in-world acceptance protocol: JUDEV2 `_independent_review_judev2_20261021\C2\INWORLD_ACCEPTANCE_PROTOCOL.md`, sha256 `58ba107e0fa1dc4858c075f396c9ae4cef686646bb27005ffcfb026b8d0aa2db` (tag PROT). On GitHub it exists only as the byte copy on this docs branch. **Skywalker has never certified the protocol's content.** Skywalker's reviews of this doc check that citations match the cited bytes; they do not make the protocol correct.
- J1's frozen-brief test: `relay-bridge/julius-dispatch.test.ts:1063` at 31bfc58b (J1T, `describe('C2: the brief hash equals the frozen contract hash, ...')`), with the refusal `julius_dispatch_brief_not_frozen_contract` at J1:733.
- The "C2" label in this doc's title and file name, which means the protocol in the first bullet.

## Sources (sha256 of the exact bytes cited)

| Tag | Original path on Kaisin (C:\dev\iwonder\...) | Copy in this commit | sha256 |
|---|---|---|---|
| PROT | `_independent_review_judev2_20261021\C2\INWORLD_ACCEPTANCE_PROTOCOL.md` (74 lines) | `docs/sources/_independent_review_judev2_20261021/C2/INWORLD_ACCEPTANCE_PROTOCOL.md` | `58ba107e0fa1dc4858c075f396c9ae4cef686646bb27005ffcfb026b8d0aa2db` |
| SPEC | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\j1\CLIENT_PACKAGE_SPEC_r1.md` (380 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/j1/CLIENT_PACKAGE_SPEC_r1.md` | `43958afa8960e8a3d3d3c82cf7aa0a64cc51d2597127eb2cc191310322aea7d2` |
| ECHO | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\j1\CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md` (20 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/j1/CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md` | `f03e7f91e7a72a0ebc0dd606fc152d0d6f89ebbc093c2db79dcbc28122a03e11` |
| PLANADD | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md` (17 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md` | `ce1aff4769174b1046c5632bcd48b5b7190ca90283baabd6052be7d8a7a8e97d` |
| J1 | sunday-relay `relay-bridge/julius-dispatch.ts` at commit `22a0a9cb2cc93f64929f1dd855aa242936f739e9` (blob `018fb582b427ad4fc884b9965d8bd3d8080ebf5b`, 1050 lines; rev 4: the same blob at the bridge target `31bfc58b`; read with `git show 22a0a9cb:relay-bridge/julius-dispatch.ts`) | not copied: it is already readable at that fixed commit | `0a29be76e58fae6a9938a33704434ff6ffdc8df406007918d0c5a12ee6588fe6` |
| J1A | sunday-relay `relay-bridge/julius-dispatch-adapters.ts` at 22a0a9cb (617 lines; same blob `579f513a` at 31bfc58b) | not copied (fixed commit) | see `git show` |
| J1W | sunday-relay `relay-bridge/julius-dispatch-wiring-core.ts` at 22a0a9cb (282 lines; same blob `6c1fe492` at 31bfc58b) | not copied (fixed commit) | see `git show` |
| J1B | sunday-relay `relay-bridge/julius-dispatch-bundle.ts` at 31bfc58b (blob `3770e76b`, same at 22a0a9cb) | not copied (fixed commit) | see `git show` |
| J1WT | sunday-relay `relay-bridge/julius-dispatch-wiring.test.ts` at 31bfc58b (blob `a5e2861a`, same at 22a0a9cb) | not copied (fixed commit) | see `git show` |
| J1T | sunday-relay `relay-bridge/julius-dispatch.test.ts` at 31bfc58b (blob `91a8ff80`, same at 22a0a9cb) | not copied (fixed commit) | see `git show` |

Notes on the sources:
- **Path discrepancy.** The protocol is NOT under `...\inworld_missions_20261022\`. That folder holds only `j1\` and the PLAN addendum. The protocol was found at the PROT path above (mtime 2026-10-22 01:05 PT). SPEC line 372 (U10) also records that a filename search under `_qa_handoff` did not find it.
- The PLAN addendum lives one level above `j1\`, not inside it. Its title calls it an addendum to SPEC r1, so it is cited and copied. The `PREREG_v*_ADDENDUM_*_DRAFT.md` files in `j1\` are pre-registration addenda. None of the 7 conflicts depends on them, so they are neither cited nor copied.
- Precedence: ECHO line 1 says "Where it differs from spec r1 and from ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md, THIS wins." So the order is ECHO > PLANADD > SPEC.
- Commit 22a0a9cb (committer time 2026-10-23 01:09 PT) is contained in the remote-tracking branch `origin/judev/j1-combined-ceiling` (`git branch -a --contains`). There is no local branch of that name. **The tip in rev 1 is stale.** The local remote-tracking ref shows `126b3713`, but `git ls-remote` (2026-10-23 ~01:5x PT) shows origin `judev/j1-combined-ceiling` = `1254b0d1fee745ea5998898e4d0f111c5cf74558`. That object is not in the local repo (no fetch was done). **Rev 3:** per Skywalker, 1254b0d1 builds on 22a0a9cb. It is 4 commits ahead and 0 behind, with linear history, and the 4 commits touch only the reviewer prompt and evidence. Cosmo did not re-verify this locally, because the object is absent and fetching was out of scope. **Rev 4:** the objects are now present on Kaisin, so Cosmo re-verified. `git ls-remote` (2026-10-23 04:08 PT) shows origin `judev/j1-combined-ceiling` = `71d9f6f82aa6a99d0f3f655e7e021ee92ef88436`. Its parent is `1254b0d1`, whose parent is the target `31bfc58b` (3 commits ahead of `22a0a9cb`). `git diff --name-only 31bfc58b 71d9f6f8` lists only 10 files, all under `.github/julius-missions/review-evidence/j1-combined-ceiling/31bfc58b/`.
- ECHO line 1 says its bridge contract was read at `judev/inworld-dispatch` tip 2f8c346a. The `run_created` code cited here comes from a different branch/commit (22a0a9cb). **Rev 4 (Skywalker's finding):** the bridge target is confirmed as `31bfc58b89de137670e5dbaf752c3328b31163f7` (tree `46744fc1`), per YUJI. Skywalker confirmed that the cited J1 files are byte-identical at `31bfc58b` and `22a0a9cb` (`julius-dispatch.ts` blob `018fb582`), so the J1 line numbers in this doc hold at the target. Cosmo re-checked the blobs of all six `relay-bridge/` files in Sources at both commits; they match. `1254b0d1` and `71d9f6f8`, the only commits after the target, add only evidence files. 2f8c346a (ECHO:1) is an older ancestor of `31bfc58b` (20 commits back) and is not the target.

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
  - ECHO:14 also says the ledger coder row "carries the same value under the field `artifactJudgedSha256`". **Rev 4 (M5, Skywalker):** at 31bfc58b this holds only under conditions; see M5.
  - ECHO:16 result line is "`result` (artifact_sha256 full, digest12, digest_ok, rows)". The client result line no longer carries `result_sha256` (or `body_sha256`).
  - SPEC:211 ("`check <first 12 of resultSha256>`") and SPEC:287 ("the screenshot's `check <12>` equals `result_sha256[:12]`") are superseded by ECHO. So are SPEC:243 (line 4 carries `result_sha256`) and SPEC:258.
- **Conflict:**
  - C5 compares a client field that the ECHO result line no longer emits.
  - The by-eye check compares the screen against the wrong hash: the screen shows `artifactSha256[:12]`.
- **Proposal:**
  - C5 becomes: client `artifact_sha256` == the result JSON `artifactSha256`, with `digest_ok=1` and `digest12` == `artifact_sha256[:12]`. **Rev 4 (M5, Skywalker):** rev 1-3 also required "== the ledger coder row `artifactJudgedSha256` (ECHO:14)". That part is withdrawn: at 31bfc58b the two are equal only under the conditions in M5. How C5 should treat the ledger value is left to YUJI's resolutions.
  - The by-eye check compares on-screen `check <12>` with `artifact_sha256[:12]`.
  - The ledger `final.resultSha256` stays checked bridge-side (whole result bytes) but is not compared with the screen.
  - **Correction (rev 2):** the f00041 equality test already exists. It is commit `5eb51efbaaa47952b848877642ac121ccf05d29b` (2026-10-22 08:59 PT, "the artifact hash the client receives equals the ledger artifactJudgedSha256"), which adds a test to `relay-bridge/julius-dispatch-wiring.test.ts` asserting `result.artifactSha256 == sha(artifactText.trim())` and `== coder.artifactJudgedSha256`. `git merge-base --is-ancestor 5eb51efb 22a0a9cb` is true. Rev 1 wrongly said it was pending. **Rev 4 (M5, Skywalker):** that test (J1WT:281-292 at 31bfc58b) shows equality only for its fixture, a bundled coder leg whose text has no key and is at most 8,000 chars. It does not show that the two values are equal in general.

## Conflict 5: N9 bridge restart mid-run: J1 can only take the refuse branch
- **Protocol:** PROT:68 N9 "client shows disconnected; on resume either same run completes from ledger or refuses; no duplicate pre_call for a finished leg".
- **J1 side:**
  - PLANADD:12 "J1 refuses a repeat (not resumable, j1 OPEN_ITEMS 8), so J1 can only satisfy the refuse branch; it must not claim recovery."
  - SPEC:329 F18 "bridge restart mid-chain / after chain | events 404 `julius_dispatch_run_unknown` -> `The server does not know that run any more`; `ORPHANED` -> row".
  - SPEC:165 maps `julius_dispatch_run_unknown` "also after a bridge restart".
  - ECHO:4: the echoId is "forgotten on bridge restart".
- **Conflict:** N9 as written accepts "completes from ledger", which J1 cannot do. A J1 run must never be credited as a recovery.
- **Severity (rev 2, Skywalker):** this is a NARROWING, not a contradiction. PROT:68 already allows "or refuses", so J1 can pass N9 through the refuse branch alone.
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
  - ECHO:16 says `refused` carries "(code only)", and ECHO:12 says "refusals are shown from the error `code` only". SPEC:74 and PROT:60 use `kind=`.
  - **Expanded (rev 2, Skywalker):** the bridge's HTTP error body has no `code` field. It is `{ error: { kind, message } }` (J1:952 `const err = (status, kind, message) => ({ status, body: { error: { kind, message } } })`). A client built literally to ECHO:12/:16 would read a field the bridge does not send. The field name must be pinned to `kind` (as SPEC:155 and :157 say), or the addendum must say that "code" means `error.kind`.
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
- **Impact narrowed (rev 2, Skywalker):** a fake run is still caught by C0 without the client token. PROT:32 C0 also rejects `mode=fake` anywhere. The J1 ledger writes `mode: ctx.mode` on every `pre_call` (J1:500-501) and on the final `result` row (J1:638). The remaining gap is B4's client-side label check (PROT:19), not fake-run detection.
- **Proposal:**
  - ECHO §4 `trigger` (and `result`) must carry `rehearsal=fake` whenever mode is fake.
  - The screen prefix "REHEARSAL (fake provider) - " stays as the player-visible label.
  - C0 matches the log token. M1/video review checks the screen prefix.

## Missed conflicts found by Skywalker (M1-M4 added in rev 2, M5-M6 in rev 4; all attributed to Skywalker; M1-M4 citations re-read by Cosmo at 22a0a9cb, rev 4 citations at 31bfc58b)

### M1: no run-creating route; the run lookup is a frozen stub
- J1:846-847 "this route creates the run's dispatch in ONE authenticated flow (there is no separate creator route in this branch)".
- J1A:567-582 `createFrozenRunLookup`: "J1 creates its own run ... so there is no Julius store row to read. The lookup answers, for the ONE configured project, with the frozen mission record ... in state READY; any other project is "no such run". It proves nothing about the run id" (J1A:568-571). It returns `{ missionId, contractSha256, state: 'READY' }` for any query on the configured project (J1A:578-579).
- **Conflict:**
  - PROT:24 ("no pre-created run") and the PLANADD:6 / ECHO:10 sequence ("mission POST ... run id received") assume a mission/run is created and its id is returned.
  - In J1, run existence comes only from the dispatch itself.
- **Status:** CONFIRMED. The acceptance record must state: "run lookup is a frozen stub; run existence is not evidence of mission creation". See the run-id section.

### M2: N1 `kind=unauthorized` vs the bridge's actual refusals
- PROT:60 N1 "refusal row in game, `WLMISSION refused kind=unauthorized`, NO ledger pre_call".
- The bridge has no `unauthorized` kind:
  - J1:983 `err(401, 'sign_in_required', ...)` for no session;
  - J1:707 `refuse(403, 'julius_dispatch_founder_only')`;
  - J1:709 `refuse(403, 'julius_dispatch_second_pairing')`.
- SPEC:162-163 map those kinds.
- **Conflict:** N1 as written can never match literally.
- **Proposal:** N1 accepts exactly the set {`sign_in_required`, `julius_dispatch_founder_only`, `julius_dispatch_second_pairing`, `julius_dispatch_wrong_project`}, with no ledger `pre_call`.
- **Status:** CONFIRMED.

### M3: SPEC r1 error table (SPEC:157-175) is missing kinds the bridge emits; recovery is lazy
- **Missing kinds:** the following `julius_dispatch_*` string literals appear in J1 at 22a0a9cb but not in SPEC:157-175 (found by literal search, Cosmo):
  - `body_invalid`, `brief_not_frozen_contract`;
  - `clock_binding_invalid`, `clock_binding_required`, `clock_echo_unknown`, `clock_offset_out_of_range`;
  - `cursor_invalid`, `final_row_unwritten`, `key_store_required`, `mode_mismatch`, `provider_key_in_env`;
  - `repeat_above_per_run`, `repeat_already_used`, `repeat_combined_ceiling`, `repeat_receipt_missing`, `repeat_spend_unknown`;
  - `result_lost_on_restart`, `reviewer_config_mismatch`, `run_creator_mismatch`, `run_order_violation`, `run_orphaned`.
  - **Rev 3: all 21 are code-confirmed, not run-confirmed.** Each reaches an HTTP response through one of three paths, each re-read at 22a0a9cb.
  - **Path 1: `refuse()` → J1:1027.** `refuse()` (J1:420, `({ ok: false, status, code })`) and `refuseRepeat()` (J1:789-796, which calls `refuse`) return an outcome. J1:1027 turns it into `err(outcome.status, outcome.code, ...)`.
    - `brief_not_frozen_contract` (J1:733), `key_store_required` (J1:735), `mode_mismatch` (J1:727, :729), `provider_key_in_env` (J1:737), `reviewer_config_mismatch` (J1:722), `run_creator_mismatch` (J1:748, :774), `run_order_violation` (J1:770).
    - The clock kinds `clock_binding_required`, `clock_echo_unknown` and `clock_offset_out_of_range` (J1:834-836, returned at J1:844).
    - `repeat_already_used` (J1:797), `repeat_receipt_missing` / `repeat_spend_unknown` (J1:799), and `repeat_above_per_run` / `repeat_combined_ceiling` (J1:811-814).
  - **Path 2: `err()` directly** (J1:952): `body_invalid` (J1:1010), `cursor_invalid` (J1:1002), `clock_binding_invalid` (J1:1020).
  - **Path 3: direct `{ error: { kind, ... } }` bodies:** `run_orphaned` (J1:902), `final_row_unwritten` (J1:905), `result_lost_on_restart` (J1:908).
  - None of these has been observed in a real run.
- **Lazy recovery:** J1W:256-270. "recover() must finish before the first dispatch (OPEN_ITEMS 21). A failed recovery refuses every dispatch". `ready()` runs `inner.recover()` lazily on the first `dispatch` (J1W:258-264). If recovery fails, every dispatch returns `503 julius_dispatch_ledger_unavailable` (J1W:267).
  - SPEC:171 (rev 2 said :170; corrected and re-checked) does list `julius_dispatch_ledger_unavailable` as "Try again in a moment", which is misleading when recovery has permanently failed for that process.
- **Status:** CONFIRMED (code-confirmed, not run-confirmed).

### M4: ACCEPT needs run 2, but J1 refuses a repeat without run-1 receipts
- PROT:71/:74 require run 2 to pass C0-C12 for ACCEPT-FOR-ROW-12.
- J1:29-35 (header): "julius-inworld-data-1 also refuses a repeat unless run-1 has a verified provider dollar receipt ... The wired coder is CLAUDE_SUBSCRIPTION and does not produce a dollar receipt, so a real-shaped repeat stays refused."
- J1:782-826 "COMBINED CEILING: a repeat of julius-inworld-data-1 reads run-1's provider receipts. Fail closed." It refuses with:
  - `julius_dispatch_repeat_receipt_missing` / `_spend_unknown` (J1:798-799), when run-1 spend is unverified;
  - `julius_dispatch_repeat_already_used` (J1:797);
  - `_repeat_above_per_run` / `_repeat_combined_ceiling` (J1:810-814).
- **Rev 4 (Skywalker's finding): SPEC:293.** "Run 2: repeat 5-10 with a fresh key and a fresh run id; assert the second `key_hash` differs and a third dispatch is refused by the bridge cap (`julius_dispatch_mission_cap_reached` row)." So in SPEC it is the **third** dispatch that the cap refuses, not the second: run 2 is expected to be dispatched. The cap is J1:781 (`refuse(429, 'julius_dispatch_mission_cap_reached')` once the mission has `missionCap` `run_start` rows), with `J1_DEFAULT_MAX_RUNS_PER_MISSION = 2` (J1:53) read at J1:765. The receipt refusals above are a separate gate that can refuse run 2 itself.
- **Conflict:** run 2 is blocked unless run-1 provider receipts reach the ledger. The protocol does not list this precondition, and a refused run 2 means no ACCEPT.
- **Status:** CONFIRMED.

### M5 (medium; Skywalker's finding, rev 4): ECHO:14 says `artifactJudgedSha256` is "the same value" as `artifactSha256`; in J1 code it is not
- ECHO:14: "The result JSON carries the hash of the trimmed artifact as `artifactSha256` ...; the ledger's coder result row carries the same value under the field `artifactJudgedSha256` (the checker-judged hash)". Conflict 4 (rev 1-3) assumed this.
- **`artifactSha256` (client-visible), at 31bfc58b:**
  - J1:529-530: `const scrubbed = scrubKeys(out.text, secrets);` then, for the coder, `scrubbed.trim()`.
  - `scrubKeys` (J1:333-337) replaces every key value of 8+ chars with `[redacted]`, then cuts the text to `J1_TEXT_MAX_CHARS` (J1:55, `8_000`). So the order is: scrub, then the 8,000-char cut, then trim.
  - J1:598 stores that text as `coderArtifact`. J1:627 sets `artifactSha256: coderArtifact === null ? null : sha256(coderArtifact)`, where `sha256` is the UTF-8 hex helper at J1:328.
  - It exists only as a field inside `resultText`. The result route returns `{ data: { runId, state, mode, resultText, resultSha256 } }` (J1:913).
- **`artifactJudgedSha256` (ledger-only), at 31bfc58b:**
  - J1A:386 passes the coder session's raw `outcome.finalText` (not scrubbed, not cut) to `bundleStep` as `judgedMessage`.
  - J1B:25-42: `compareJudgedToFile` hashes `trimmedBytes(judgedMessage)` (strict UTF-8 decode, `String.trim`, re-encode; J1B:26-29, :42).
  - J1:556 writes it to the ledger coder `result` row only: `artifactJudgedSha256: role === 'coder' ? (out.bundle?.judgedSha256 ?? null) : null`. It is not in the result JSON (J1:624-628) or the result body (J1:913), so the client never receives it.
- **When they are equal:** only when no key was scrubbed, the text is at most 8,000 chars, and the bundle step ran. J1WT:281-292 asserts the equality (`expect(result.artifactSha256).toBe(coder!.artifactJudgedSha256)`, J1WT:291) for a fixture that meets all three conditions.
- **When they differ:** the coder text contained a key value (scrubbed only on the client-visible side), or was over 8,000 chars (cut only on the client-visible side), or there was no bundle (`artifactJudgedSha256` is null, J1:556). A failed coder leg breaks at J1:596 before J1:598, so its `artifactSha256` is null.
- **Conflict:** a C5 that requires client `artifact_sha256` == ledger `artifactJudgedSha256` would fail a run whose coder text was scrubbed or cut, and the client cannot check the ledger value itself. Conflict 4 is amended in rev 4 so that it no longer assumes equality.
- **Status:** CONFIRMED (code-confirmed at 31bfc58b, not run-confirmed). No resolution is proposed here; YUJI owns resolutions.

### M6 (low; Skywalker's finding, rev 4): PLANADD:7 expects a bridge instance id in `run_start`; J1 writes none
- PLANADD:7: "4. Client prints exe hash and pid at boot; the bridge writes an instance id in run_start (already requested by C3 "Binding")."
- At 31bfc58b the only `run_start` write is J1:853-863 (`deps.ledger.append({ phase: 'run_start', ... })`). Its fields are `dispatchId`, `runId`, `missionId`, `frozenSha256`, `contractSha256`, `briefSha256`, `checkerSha256`, `preregId`, `budgetCapUsd`, `legEstimateUsd`, `authorizedPlayerHash`, `mode`, `at`, the repeat-ceiling fields (J1:858), `projectHash`, `sessionHash`, `keyHash`, `clientTriggerId`, `clientLogSha256`, `runOrdinal` and the three role providers. None of them is a bridge instance id.
- `git grep -n -i "instanceId\|instance_id\|bridgeInstance" 31bfc58b -- relay-bridge` finds nothing.
- **Status:** CONFIRMED (code-confirmed at 31bfc58b), low severity. No resolution is proposed here.

### Low: N5 idempotency semantics (Skywalker)
- PROT:64 N5 "reuse same key, different mission | 409-style refusal; same key + same mission returns stored result without a new pre_call".
- J1 keys idempotency on runId + creator:
  - J1:744-745: same runId with the same caller and key → replay (200, `replayed: true`);
  - J1:748: same runId with another caller or key → 403 `julius_dispatch_run_creator_mismatch`;
  - J1:750-751: the same key on ANY other run → 409 `julius_dispatch_key_reused`.
- With one frozen mission, "same key + same mission" but a new runId is refused 409, not replayed.
- **Status:** CONFIRMED, low severity.

### Low: stale bridge tip
- The rev 1 tip `126b3713` is stale. Origin is now `1254b0d1`. Per Skywalker it builds linearly on 22a0a9cb: 4 ahead, 0 behind, touching only the reviewer prompt and evidence (see Sources). CLOSED. **Rev 4:** origin is now `71d9f6f8`, and the bridge target is `31bfc58b` (see Sources).

## Also noticed (not one of the 7; not counted)
- PROT:60 N1 expects `kind=unauthorized`, but ECHO:16 says `refused (code only)`. This is the same field-name question as in conflict 6.

## Client run-id under option (a) (pending founder decision)
Option (a) vs (b) is pending the founder's ruling. **Rev 2:** the run-id FORMAT is now fixed in `docs/j1_client_plan.md` §5a: `wlj_` prefix plus a BCryptGenRandom UUIDv4 formatted from the raw bytes, strict regex, with a 10,000-id test. That section supersedes the format text below where they differ. This section states what the client must do IF option (a) is chosen.

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
- Bridge tip actually to be run: **rev 4: confirmed** as `31bfc58b89de137670e5dbaf752c3328b31163f7` (tree `46744fc1`), per YUJI. Skywalker confirmed the cited J1 files are byte-identical at `31bfc58b` and `22a0a9cb` (`julius-dispatch.ts` blob `018fb582`). `1254b0d1` and `71d9f6f8` only add evidence files. (Rev 1-3 said "unconfirmed": ECHO:1 cites 2f8c346a, the J1 citations were at 22a0a9cb, and the origin tip was 1254b0d1.)
- Rev 3: CLOSED. Per Skywalker, 1254b0d1 builds on 22a0a9cb (4 ahead, 0 behind, linear; touches only reviewer prompt + evidence). This was not re-verified locally because the object is absent. M3 per-kind reachability is now code-confirmed (not run-confirmed). **Rev 4:** now re-verified locally: `1254b0d1` and `71d9f6f8` are present on Kaisin, and their parent chain is checked in Sources.
