# J1 in-world mission client package: Wonderland client plan
Written 2026-10-23, about 1:20 AM PT, on the box. DESIGN / PLAN ONLY:
- nothing built, branched, installed or run;
- no Kaisin write;
- no mailbox post;
- no spend.
No readiness change of any kind.

Sources, as read-only box copies of the Kaisin files under `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\j1\` and `_qa_handoff\session_mailbox\`. sha256 of the copies:
- `CLIENT_PACKAGE_SPEC_r1.md` 43958afa8960e8a3d3d3c82cf7aa0a64cc51d2597127eb2cc191310322aea7d2
- `CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md` f03e7f91e7a72a0ebc0dd606fc152d0d6f89ebbc093c2db79dcbc28122a03e11
- `ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md` ce1aff4769174b1046c5632bcd48b5b7190ca90283baabd6052be7d8a7a8e97d
- `M20261022T155831Z-JULIUS_DEV-fdf066.md` 8fbceb13b2483812c481ba6bd06d32e2202e24d4be66e6cda712176fd59b2c74
- `M20261022T155854Z-JULIUS_DEV-f00041.md` 6bb52695eb72bf9a3275923c62ba7014062f181f1137ab686dadecb58c47ffd4
- Code: repo `C:\dev\iwonder\wonderland-b35v3`, commit `aa930c269c43a52fc31c785f7bdcc231c8af6cf0` (task3 `local/r16reh16w` tip). The spec cites the worktree `wonderland-task3`, which is the same commit.
  - Line numbers were spot-checked tonight with `git show aa930c26:<path>`: UiSubsystem.cpp 4295, 4530, 4547, 4549, 4605, 4618, 4642, 4701 and JuliusStream.cpp 174, 482, 485, 502, 581, 586 all match the spec.

**Precedence:**
1. ADDENDUM_1_ECHO_DIGEST (it says "THIS wins");
2. then ADDENDUM_1_to_PLAN_r3_and_SPEC_r1;
3. then spec r1.

Message f00041 corrects fdf066: fdf066 says "compared with artifactJudgedSha256", but the client compares with the result JSON's `artifactSha256`. The addendum file carries the same correction ("CORRECTION 15:58Z").

## 1. Acceptance criteria (quoted)

### 1.1 Per-run sequence (ECHO_DIGEST section 2, verbatim)
> 1. Log line A (prefix `WLJMISSION`, kind `ui_action`, local UTC, NO run id) at the click/key.
> 2. `GET .../echo`: record t0 (client UTC before), bridgeUtc, t1 (client UTC after); offset = clientMidpoint(t0,t1) minus bridgeUtc. Show it on screen and log it (`WLJMISSION offset ...`). If |offset| > 1000 ms: stop, show "clock not synced", do NOT dispatch (resync first). The bridge refuses anyway: 409 `julius_dispatch_clock_offset_out_of_range` (a refusal counts against the 2-per-day limit and is never retried silently).
> 3. Mission creation exactly as in spec r1 (does NOT call the existing CreateMission, which would Follow()); log line B `run id received` with the run id.
> 4. Log the trigger line (the line whose sha256 is clientLogSha256), then `POST .../dispatch` with the fields above.
> 5. Poll events/result; refusals are shown from the error `code` only.

Order rule (PLAN addendum A3, verbatim):
> 3. U6 order, with the reviewer's addition: (i) log a "UI action" line with local UTC (the click or key, NO run id) BEFORE the mission POST is sent; (ii) mission POST; (iii) log a "run id received" line; (iv) dispatch POST. The bridge ledger must show run creation attributed to the game client's own key hash and player hash. Rule: UI-action utc < ledger run-created utc < dispatch/pre_call utc < result. This blocks a pre-created run that the game merely follows.

> 4. Client prints exe hash and pid at boot; the bridge writes an instance id in run_start (already requested by C3 "Binding").

### 1.2 Displayed digest (ECHO_DIGEST section 3, verbatim)
> The result JSON carries the hash of the trimmed artifact as `artifactSha256` (and `artifactText`, the trimmed text itself); the ledger's coder result row carries the same value under the field `artifactJudgedSha256` (the checker-judged hash), and a separate `resultSha256` covers the whole result bytes. CORRECTION 15:58Z: the first version of this file said the result JSON field was artifactJudgedSha256; the result JSON field is artifactSha256. The game computes sha256 over the UTF-8 bytes of the TRIMMED artifact text it received (`artifactText` in the result, trimmed of leading and trailing whitespace by JavaScript String.trim rules), compares it with the result's `artifactSha256`, and DISPLAYS THE FIRST 12 HEX CHARACTERS of that value, linked (on request) to the full 64 hex. A mismatch shows "arrived damaged" and no result. `resultSha256` is NEVER labelled or shown as the artifact hash.

Correction message f00041 (verbatim excerpt):
> JUDEV to REVIEWDEV and WDEV: CORRECTION to the field name I gave in the client spec addendum (WDEV has not read it yet; the file is corrected in place and says so). The RESULT JSON that the client receives carries the trimmed artifact hash as `artifactSha256` (plus `artifactText`); the LEDGER coder result row carries the same value as `artifactJudgedSha256`, which the bundle computes. The game compares its own digest with the result's artifactSha256 and displays the first 12 hex. Reviewer: in your earlier note you said the ledger field is the one the game compares with; the client never sees the ledger, so the game compares with the result JSON's artifactSha256, and the ledger's artifactJudgedSha256 must EQUAL it. I know of one test asserting artifactJudgedSha256 = sha(ARTIFACT) (wiring test line ~279) but none asserting artifactSha256 in the result JSON equals artifactJudgedSha256 on th ...

### 1.3 Log lines (ECHO_DIGEST section 4 + PLAN A1, verbatim)
> `ui_action`, `offset`, `run_id_received`, `trigger` (carries run id, key hash, player hash, build id, utc), `chain` per role phase, `result` (artifact_sha256 full, digest12, digest_ok, rows), `refused` (code only). No provider names are logged by the client beyond what the founder ruling allows in client-visible artifact text; no question or result text in the log; no URL; no token; the exe sha256 and pid at boot.

> 1. U2: client lines use the prefix WLJMISSION (not WLMISSION). The prefix is pinned in j1\DESIGN.md 5.5 and in crosscheck.py as an EXACT LINE-ANCHORED match (start of the message after the UE log category). j1\DESIGN.md is a working design file, not a hashed submission: I will update it in the next DESIGN revision, not now.

### 1.4 Build identity (ECHO_DIGEST section 5, verbatim)
> Own build identity, NOT the r16reh18 line; exe sha256, DLL sha256, DLL mtime later than the code commit, `build=` equal to the package id; base task3 aa930c26 (branch from the COMMIT; the checkout is dirty).

### 1.5 Capture assertions (spec r1 section 5, verbatim; see the conflicts note below)
> 6. Log assertions (regexes on the 4.2 formats): exactly one line 1; line 3 sequence numbers contiguous from 1 with all four roles `started` before `done`; exactly one line 4 with `digest_ok=1`; `body_sha256 == result_sha256`; the screenshot's `check <12>` equals `result_sha256[:12]`; the line 1 `utc` precedes the first ledger `pre_call.at`; sha256 of the line 1 message equals the ledger `clientLogSha256`.
>
> 8. Leak sweep over the whole client log: must NOT match `Relay-Session`, the token, `Authorization`, the confirm word, the idempotency key values, any URL, `budgetBasis`, `maxOutputTokens`, any 4.6 name. Only `WLMISSION`/`WLASK` lines carry ids and hashes. (Allowed: the existing `JULIUS STREAM:` lines.)
>
> 9. HUD sameness: after-screenshot vs before-screenshot silhouettes identical (no new panel/strip/scroll).
>
> Run 2: repeat 5-10 with a fresh key and a fresh run id; assert the second `key_hash` differs and a third dispatch is refused by the bridge cap (`julius_dispatch_mission_cap_reached` row).

### 1.6 Fake-provider negative control and failure controls (spec r1 section 6.1 / 6.2, verbatim)
> - N0 Positive fake: full chain in `fake` mode. Expect: every row prefixed `REHEARSAL (fake provider) - `; line 1 `rehearsal=fake`; lines 4 and 7 `mode=fake`; QA script marks the run `NOT EVIDENCE`. Then prove the label cannot be dropped: a fake answer that arrives on a build with `wl.Julius.Mission.Rehearsal=0` -> `refused kind=local_mode_mismatch`, nothing shown.
> - N0b The reverse: a `live` answer on a rehearsal build -> same refusal.

> ### 6.2 Failure-state controls (each ends in exactly one `WLMISSION refused` line or a labelled terminal row; none may draw a result)
>
> | # | Control | Expected |
> |---|---|---|
> | F1 | `wl.Julius.Mission 0`, then `/mission run` | `not part of this build`, `kind=local_off`, bridge ledger gains NO row |
> | F2 | not a developer session (no `-wldev`, no editor) | `kind=local_not_developer`, nothing sent |
> | F3 | `LogHttp VeryVerbose` active | `kind=local_http_verbose`, nothing sent |
> | F4 | no bridge URL / refused URL / https remote / `http://localhost:80@evil.example` | `local_no_bridge` / `local_bridge_refused` / `local_not_loopback`, nothing sent |
> | F5 | unpaired; paired without project | `local_not_paired` / `local_not_paired_for_a_project` |
> | F6 | SHA-256 self-test forced to fail (QA CVar in the TEST build only) | `local_sha_selftest`, nothing sent |
> | F7 | wrong/stale confirm word; word after 60 s; `/mission go` with no pending; `/mission run extra text` | row refusals, nothing sent |
> | F8 | second `/mission go` while a chain is in flight | local refusal, no second HTTP request (count requests) |
> | F9 | bridge kill switch off (`JULIUS_J1_ENABLED` unset) | 503 `julius_dispatch_disabled` row, no ledger row |
> | F10 | kill switch flipped mid-chain | next role never starts; HALTED `kill_switch_flipped` row; chain stops |
> | F11 | dispatch with the operator bearer / with an Origin (curl, outside the game; confirms bridge side) | `julius_dispatch_operator_is_not_the_game` / `_browser_refused` |
> | F12 | second pairing (another session id) | `julius_dispatch_second_pairing` row |
> | F13 | ledger write failure (bridge-side fault injection) | before the call: 503 `ledger_unavailable` row; after a call: HALTED `ledger_write_failed_after_call`, response id remains in an event |
> | F14 | reviewer rejects (fake) / checker fails (fake) | `FAILED`, rows say rejected/failed, NO "success" row |
> | F15 | **digest mismatch**: fake bridge returns a `resultSha256` that differs by one hex digit | `digest_ok=0`, `damaged`, no artifact row. This is THE negative control (CDR R12 3) |
> | F16 | `resultText` mutated after hashing (one byte) | same as F15 |
> | F17 | event `sequence` duplicate / gap / out of order; unknown `role`; `terminal:true` never arrives | dup ignored; gap logged; unknown role rendered `a step`; client gives up at the local cap (below) with `kind=local_poll_timeout`, shows `Julius has not finished; the mission may still be running`, and never says it failed |
> | F18 | bridge restart mid-chain / after chain | events 404 `julius_dispatch_run_unknown` -> `The server does not know that run any more`; `ORPHANED` -> row |
> | F19 | 401 mid-chain | `NoteSessionRefused()`; link shows "pair again"; polling stops |
> | F20 | connection refused / timeout on each of the four calls | each own row; dispatch no-response does NOT auto-retry |
> | F21 | HTTP 200 that is not JSON; a body whose `data` is missing; `error` as a string | `could not read` / generic row; no crash |
> | F22 | terminal closed or rebuilt before the result | `shown=0 (no terminal)` in line 7; `/mission result` redraws later |
> | F23 | oversize `artifactText`, markup, control characters, a key-shaped string inside the artifact | rows capped; `/mission more` pages; key-shaped text masked (`masked=1`); control characters not drawn |
> | F24 | two `/mission go` typed fast (double Enter) | exactly one POST dispatch |
> | F25 | run 3 | bridge cap row; client makes no further attempt |

### 1.7 Conflicts between the sources and how this plan resolves them (newest wins; nothing is weakened)
- **C-a. Digest shown.**
  - Spec section 5 step 6 asserts "`body_sha256 == result_sha256`; the screenshot's `check <12>` equals `result_sha256[:12]`".
  - ECHO_DIGEST section 3 says "`resultSha256` is NEVER labelled or shown as the artifact hash".
  - Plan:
    - The shown 12 hex = sha256(JS-trim(`artifactText`))[:12] and must equal `artifactSha256`[:12].
    - `resultSha256` is still checked (body hash == `resultSha256`) but never shown.
    - Both checks must hold. F15 is applied to `artifactSha256` (F15a) AND to `resultSha256` (F15b), and each mismatch must give "arrived damaged" with no artifact row.
- **C-b. Prefix.** Spec r1 uses `WLMISSION`, but PLAN A1 and ECHO_DIGEST use `WLJMISSION`, line-anchored. Use `WLJMISSION` everywhere, and the U2 collision goes away.
- **C-c. Line set.**
  - The spec's lines 0-7 are replaced by the ECHO_DIGEST set: `ui_action`, `offset`, `run_id_received`, `trigger`, `chain`, `result`, `refused`, plus the boot line (exe sha256 + pid).
  - The spec's proposed lines `create`, `roleinfo` and `verify` would be additive only, and need the reviewer's OK.
- **C-d. Trigger order.** Spec U6 (trigger after 2.1) is superseded by the ECHO_DIGEST 2.1-2.5 order.
- **C-e. New refusal** not in the spec 2.5 table: `julius_dispatch_clock_offset_out_of_range` (409). It needs a row, and it "counts against the 2-per-day limit and is never retried silently".
- **C-f. New controls this plan adds** (stricter only):
  - F26: |offset| > 1000 ms → "clock not synced", no dispatch.
  - F27: an expired echoId (> 120 s) or a reused one → bridge refusal, with the row taken from `code` only.
  - F28: a slow bridge → up to 3 echo tries, and the sample with the largest round trip is discarded.
  - F29: a forced ordering violation in the fake bridge (a run pre-created before `ui_action`) must be flagged by the crosscheck.

## 2. Client code that must change (aa930c26 tree; paths under `wonderland/Source/Wonderland/`)
| # | File / function | Change | Basis |
|---|---|---|---|
| K1 | NEW `WonderlandJuliusMission.h/.cpp` (name proposed) | Holds the whole feature: `/mission` state machine; echo + offset; mission-create POST (NOT `CreateMission`, which calls `Follow()` at JuliusStream.cpp:969); dispatch POST with `x-relay-idempotency-key` and body {runId, clientTriggerId, clientLogSha256, clientUiActionUtc, clientOffsetMs, echoId}; events/result polling with cursor; terminal-state rows; own FIPS 180-4 SHA-256 (engine `GetSHA256Signature` is `checkf(false)` on UE 5.8, WonderlandEosVoice.cpp:82-85); JS `String.trim` whitespace set (below); `LogWonderlandJuliusMission` category, `Display`, `WLJMISSION` lines; `wl.Julius.Mission`, `wl.Julius.Mission.Rehearsal`, `wl.Julius.Mission.MaxWaitSeconds` CVars defaulting off; `wl.Qa.JuliusMission` offline self-test (style of `wl.Qa.BridgeUrl`, JuliusStream.cpp:1294-1361). No USTRUCT/UENUM in the header (cpp-parity test); `git add -N`. | spec 0, 3.3, 4; ECHO_DIGEST 1-4 |
| K2 | `WonderlandUiSubsystem.cpp` `HandleTerminalCommand` (:4295) | One `#include` + one `/mission` branch between the `/brain` block end (:4547) and `/card` (:4549). It must come before the unknown-command end (:4618-4622), or it is dead code. Optional `/help` text (:4605-4616). | spec 0, 7.2 |
| K3 | `WonderlandJuliusStream.h/.cpp` pairing parse (:580-587; `participantId` at :581, logged in clear at :586) | Add a member + public getter (e.g. `GetPairedParticipantId()`) for `player_hash`. Additive only. Do not touch `JULIUS STREAM:` formats, `Follow()`, the decoder, or the wire fixtures. | spec U3, 7.2/7.5 |
| K4 | Use, do not change: `NewBridgeRequest` (:502-510) → `NewRequest` (:482-500, adds `Relay-Session`, no Origin, `NoteMutation` for non-GET at :485-488: do not add a second one); `GetPairedProjectId`, `GetBridgeUrl`, `GetBridgeProblem`, `IsPaired`, `NoteSessionRefused` (.h:370/236/378/277/290) | The mission POST/dispatch must go through `NewBridgeRequest`. A NEW loopback-only check in K1 is needed because `ResolveBridgeUrl` (:174-191) accepts https to any host (F4 incl. `http://localhost:80@evil.example`). | spec 0, 3.3 step 2 |
| K5 | `WonderlandBeta.cpp` `IsDeveloperSession` (:54-58), `BuildLabel` (:66-85) | Read only. `build=` comes from `BuildInfo\BuildInfo.txt` line 1 = the package id (packaging step, U9). The boot line adds the exe sha256 (hash `FPlatformProcess::ExecutablePath()` with the K1 SHA-256) + pid. | ECHO_DIGEST 4/5, PLAN A4 |
| K6 | Refusal before any request | `LogHttp VeryVerbose` active → `refused code=local_http_verbose`, nothing sent (PLAN B: protocol M2). The SHA self-test fails → `local_sha_selftest`. Not a developer session → `local_not_developer`. Plus the 2.5 rows + C-e. | spec 6.2 F2/F3/F6 |

**JS `String.trim` set** (for the digest; Python `str.strip` and UE `FChar::IsWhitespace` differ):
- U+0009-000D, U+0020, U+00A0, U+1680, U+2000-200A, U+2028, U+2029, U+202F, U+205F, U+3000, U+FEFF.
- NOT U+0085 and NOT U+200B.

**Known answers for `wl.Qa.JuliusMission`** (computed on the box with hashlib; UTF-8 input):
| case | sha256 |
|---|---|
| "" | e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 |
| "abc" | ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad |
| 448-bit "abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq" | 248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1 |
| "é" (2-byte) | 4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c |
| U+1F600 (4-byte) | f0443a342c5ef54783a111b51ba56c938e474c32324d90c3a60c9c8e3a37e2d9 |
| "a"x55 / x56 / x64 (padding edges) | 9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318 / b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a / ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb |
| JS-trim("\u00A0\uFEFFx y\u2028\n") = "x y" | 887fcea6a80333c6c02ae7e79735f0edad8d811f0b61431495f796f4bf6a7c19 |
| JS-trim("\u0085x") keeps U+0085 | 5105fc0fd6defea86e83c4e130e10f548401aba7c476037c47056ddedafbaf65 |

**Not to touch** (spec 7):
- Branch from the COMMIT aa930c26 into a NEW branch in a SEPARATE worktree. The task3 checkout is dirty (709 paths per fdf066).
- No commit to, move of, or merge into `local/r16reh16w`.
- No edit to Social / World / Card / ProjectBrain / existing Mission files or any ini.
- Separate package directory and `BuildInfo.txt` identity.
- Never reuse the r16reh18 staging or the `_wonderland_beta_release*` folders.
- The CVars default to 0.

## 3. Test and capture plan using the b33_v3_1b tools
**The pinned folder must not be used or edited.** `...\r16reh16w_submission_20261020\tools\b33_v3_1b\CANDIDATE.json` is READY for r16reh18 only:
- the launcher refuses any other exe;
- the judge VOIDs runs on an exe-hash mismatch;
- J1 must stay off the r16reh18 line.

**Plan:** a NEW folder, e.g. `...\tools\j1cap_v1\`, made of COPIES with a new SHA256SUMS. Each reused file is listed with its source hash from b33_v3_1b\SHA256SUMS.txt.

| Reuse (copy) | For J1 |
|---|---|
| `b33_launch.ps1` | Lease + RAM gate (≥ 5 GB free) + one-window placement + RUN.json. Retarget to a NEW `CANDIDATE_J1.json` (package id, exe sha256, DLL sha256 + mtime later than the code commit, `BuildInfo.txt` sha256, commit). It refuses on mismatch, and adds the -wldev flag set chosen by the owner (U12). |
| `b33_native.cs`, `b33_layout.ps1` | DPI-aware TOPMOST placement, SendInput typing into the terminal, and the hands-off hook (a real key or mouse event from a person voids the drive). |
| `b33_frames.ps1` | Timestamped frames of the game window at each stage: before, accepted, each role, result header, digest-12 row, after. Plus the ddagrab crop video with an on-screen UTC clock (ECHO_DIGEST 4: video + UTC clock is an unforgeable witness). |
| `b33_stop.ps1` | Kills only its own pids, then copies the log after close and writes the hash list. The folder is frozen after that (never edit in place). |
| `tests\test_b33.py` pattern | Synthetic-fixture unit tests for the new judge. |

**New pieces:**
- **`j1_drive.ps1`:**
  - types `/mission`, `/mission run`, `/mission go <word>`;
  - the confirm word is typed by the founder or read from the frame, and is never logged.
- **`j1_judge.py`** asserts:
  - the 1.1 order (UI-action utc < ledger run-created utc < dispatch/pre_call utc < result);
  - exactly one `trigger`;
  - sha256(trigger line) == ledger `clientLogSha256`;
  - |offset| ≤ 1000 ms and equal to the on-screen value;
  - `chain` contiguous;
  - one `result` with digest_ok=1;
  - digest12 == the frame text == ledger coder row `artifactJudgedSha256`[:12] == result `artifactSha256`[:12];
  - `resultSha256` never shown;
  - the leak sweep (spec 5 step 8);
  - the HUD-sameness check.
  - It never PASSes a fake run: fake = NOT EVIDENCE (crosscheck C0).
- **Reviewer crosscheck.py** (C2 protocol): reviewer-owned. It is run, not edited.

**Order:**
1. Offline tests, no game: the K1 known answers above through a C++ test harness or `wl.Qa.JuliusMission` in the TEST build; `j1_judge.py` on synthetic logs.
2. Packaged rehearsal against the J1 bridge in `mode: fake` (zero spend): N0, N0b, F1-F29.
3. Two live runs (paid; the founder's go-ahead per run). Run 3 must hit the cap (F25).

**Human steps** (as in b33):
- close any firewall prompt with X (never Allow);
- hands off during drive blocks;
- a person inspects the frames and writes the frames-seen note.

## 4. RAM and disk
Measured on Kaisin tonight, read-only:
- **RAM:** 3.60 GB free of 15.70 GB at about 1:05 AM PT. The b33 launcher's gate needs ≥ 5 GB, so this is **NOT met**. A UE compile + cook needs more; follow the plan's W2 RAM rule, whose exact figure I did not re-read tonight. The background pushes and manifest hashing are left running as instructed.
- **Disk:** C: 17.57 GB free. Sizes measured in the existing task3 tree (same engine/project):

| Item | GB |
|---|---|
| Intermediate | 7.37 |
| Binaries | 0.86 |
| Saved\Cooked | 0.43 |
| Saved\StagedBuilds | 1.22 |
| Content (source assets) | 0.73 |
| r16reh18 package folder (91 files) | 0.77 |
| r16reh18 zip | 0.52 |

- **Estimate for a separate worktree + build + package + zip + captures:** about 10.6 + 1.3 + 1-2 (video/frames) ≈ 13-14 GB.
  - That would leave only about 3.5-4.5 GB on C:. It is feasible but tight; suggest ≥ 16 GB free before starting.
  - Or build on another volume if one exists (unchecked).
  - Do not share Intermediate with task3: the scored line must stay untouched.

## 5. Open questions
1. **C2 `INWORLD_ACCEPTANCE_PROTOCOL.md`** (`_independent_review_judev2_20261021\C2\`, sha256 58ba107e…) has now been read, read-only, on 2026-10-23.
   - The 7 conflicts with the J1 addenda, with line citations, are in `docs/C2_J1_CONFLICTS_20261023.md`.
   - The reviewer must reconcile them before the judge is written.
2. **U1 / run id:** see §5a. The format is fixed; option (a) vs (b) still awaits the founder. The world strip/orb reaction remains open.
3. **U3:** does the bridge `participantId` equal the parsed string exactly? The paired line prints it in clear, so evidence folders must redact it.
4. **U4:** there is no frozen mission record or contract sha yet.
5. **U5:** which UE call guarantees the trigger line is on disk before `ProcessRequest()` (e.g. `GLog->Flush()`)? It is unverified.
6. **U9/U12:** `BuildInfo.txt` generation and `commit=`; the launch flags; whether a packaged non-editor build honours `-wldev`.
7. **U13:** the 35-min wait cap is an estimate.
8. **U14:** ownership, the heavy window and the branch name. This is what fdf066 asks.
9. **Bridge tip:** ECHO_DIGEST cites `judev/inworld-dispatch` tip 2f8c346a. The J1 citations are at 22a0a9cb. `origin/judev/j1-combined-ceiling` is now 1254b0d1 (per `git ls-remote`, 2026-10-23 ~01:5x PT). Which tip will run is unconfirmed. The f00041 equality test (result `artifactSha256` == ledger `artifactJudgedSha256`) already exists: commit 5eb51efb, an ancestor of 22a0a9cb.
10. **Slow-bridge offset:** echo retries only. Is a clock-sync check on the PC itself also needed?
11. **Provider names:** the founder ruling allows accurate provider names in artifact text for authorized viewers. The client still never logs them, and the spec 4.6 grep must therefore exclude the artifact rows, not the log.

## 5a. Client run-id (format fixed after Skywalker's review of ae67f50a)
Option (a), where the client mints the runId, versus option (b) **still awaits the founder's decision**. Only the FORMAT below is fixed. If option (a) is chosen, the client must do the following.

**Fixed prefix**
- The prefix is the literal `wlj_` (4 characters). It is a build constant, the same for every run and every player.
- It is optional in the regex. The client always emits it.

**Generation**
1. Take 16 bytes from `BCryptGenRandom(NULL, buf, 16, BCRYPT_USE_SYSTEM_PREFERRED_RNG)`. Any non-success NTSTATUS is a local refusal: nothing is sent.
2. Set the version and variant bits by hand:
   - `buf[6] = (buf[6] & 0x0F) | 0x40` (version nibble 4);
   - `buf[8] = (buf[8] & 0x3F) | 0x80` (variant 10xx).
3. Format lowercase 8-4-4-4-12 directly from the raw bytes, in order `buf[0..3]-buf[4..5]-buf[6..7]-buf[8..9]-buf[10..15]`, two hex digits per byte.
   - Do NOT use `FGuid` or `FGuid::ToString`. Its Windows layout reorders digits, so the version and variant nibbles do not land where RFC 4122 puts them.
- That gives 122 random bits.
- The runId contains no participant id, player/key hash, mission id, timestamp, counter or machine name.

**Client validation**
- The strict regex is `^(wlj_)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`. It is checked before logging and before dispatch.
- Total length is 40 with the prefix and 36 without, so ≤ 128. Any id that passes the strict regex also passes the bridge regex `^[A-Za-z0-9:_-]{1,128}$`.
- On failure the client refuses locally: nothing is sent.
- The bridge accepts ANY 1–128-character id matching its regex (sunday-relay `relay-bridge/julius-dispatch.ts:962`, 996, 1012 at 22a0a9cb). **Only the client enforces unguessability.**

**Logging**
- The runId is written to the WLJMISSION log (after `ui_action`, flushed) BEFORE the dispatch POST is built.
- The `trigger` line and the ledger `run_created.runId` must equal it.
- The line name is OPEN.

**Test (offline, in `wl.Qa.JuliusMission`)**
- **Positive:** generate 10,000 real ids with the production function. All must pass the strict regex and the bridge regex, with ZERO duplicates (set size == 10,000).
- **Negative, deterministic (always run, no randomness):** the strict regex must REJECT both fixed known-bad ids:
  - `0b7a1c2e-4f3d-9a6b-1c2d-3e4f5a6b7c8d`;
  - `wlj_0b7a1c2e-4f3d-9a6b-1c2d-3e4f5a6b7c8d`.
  - In each, the third group starts with `9`, not the version nibble `4`.
  - The test has no FGuid-dependent branch, so its outcome cannot vary from run to run.
- **Informational only (non-asserting):** an `FGuid::ToString(EGuidFormats::DigitsWithHyphensLower)` string may be logged with its strict-regex verdict.
  - Because that layout reorders bytes, a random one matches about 1 time in 64. That is a box simulation of my reading of the layout, not re-checked against UE 5.8 source.
  - It never affects PASS/FAIL.
- **Other negatives:** an uppercase hex id, a wrong prefix (`wlx_…`), and a 129-character id must all be rejected.

**Acceptance record** must state verbatim: "run lookup is a frozen stub; run existence is not evidence of mission creation".
- Bridge: `createFrozenRunLookup`, `relay-bridge/julius-dispatch-adapters.ts:567-582` at 22a0a9cb.
- **Effect on K1:** under option (a) the run id does not come from a mission-create POST response. The K1 "mission-create POST" step depends on the founder's decision.

## 6. Draft acknowledgement (NOT posted; needs the user's approval)
To: JULIUS_DEV (via `_qa_handoff\session_mailbox`, `python -I mbox.py`), refs M20261022T155831Z-JULIUS_DEV-fdf066 and M20261022T155854Z-JULIUS_DEV-f00041.
Proposed status: ACKNOWLEDGED (read only; no build yet).

> WONDERLAND_DEV to JULIUS_DEV: read spec r1, ADDENDUM_1_to_PLAN_r3, CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST (with the 15:58Z correction) and f00041. Understood: the game compares sha256(JS-trimmed artifactText) with the result JSON's artifactSha256, shows its first 12 hex, and never shows resultSha256 as the artifact hash; prefix WLJMISSION; sequence ui_action -> echo/offset (|offset| <= 1000 ms else no dispatch) -> mission create (not CreateMission/Follow) -> run_id_received -> trigger -> dispatch. Ownership: accepted as a plan; the client plan is written (code touch points: new WonderlandJuliusMission.h/.cpp, one /mission branch in WonderlandUiSubsystem.cpp between :4547 and :4549, one additive participant-id getter in WonderlandJuliusStream). Branch plan: new branch from COMMIT aa930c26 in a separate worktree, own build identity, never the r16reh18 line. Heavy window: NOT yet - Kaisin has 3.6 GB RAM free (gate 5 GB) and 17.6 GB on C: against an estimated 13-14 GB need; I will confirm a window when both clear. Open before code: (1) reconciliation of the C2 protocol with PLAN addendum B (C1 line, ledger run-created field, M2, rehearsal=fake token); (2) does the J1 bridge serve POST /wonderland/julius/missions (U1); (3) which bridge tip will run, and the artifactSha256 == artifactJudgedSha256 equality test; (4) spec r1 section 5 step 6 still says the screenshot check is result_sha256[:12] - I read the addendum as superseding it and will check both hashes but show only artifactSha256[:12]; please confirm. No spend, no build, no readiness change.
