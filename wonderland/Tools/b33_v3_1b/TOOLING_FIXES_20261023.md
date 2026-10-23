# B33 v3.1b tooling fixes, 2026-10-23 (Cosmo, WONDERLAND_DEV)

DIAGNOSTIC tools, not evidence by itself. These fixes answer PILOT's read-only QA defects of 2026-10-23
(S-01, S-03, S-06 in PILOT's `results_safe_checks.md`). They change no run, no run folder and no earlier commit.
CANDIDATE.json, RELAY_PIN.json and ROUTE_PIN.json are unchanged (READY / PENDING / PENDING). Readiness is unchanged.

| ID | Defect | Status here |
|---|---|---|
| D-1 | `SHA256SUMS.txt` stale since 73c46791 (8 of 66 entries bad) | Regenerated from the files in this folder. See "SHA256SUMS changes" below. |
| D-2 | six `b6_b33a_reanalysis/slices/*.log` dropped by `.gitignore` `*.log` | Narrow `.gitignore` exception for exactly that folder, and the six logs added (byte copies of the submission copy; sha256 = the entries both SHA256SUMS files already listed; secret scan 0 hits). |
| D-3 | T091807Z / T093602Z RUN.json say "server override -ServerTree" for a -RelaySource run | The label was already fixed in git by 73c46791 (W3). Those two runs were launched from the UNFIXED submission copy (`_qa_handoff\...\tools\b33_v3_1b`, b33_launch.ps1 f20b5fb5). Their RUN.json files are not changed. **Erratum:** in both runs the server was the -RelaySource ring relay (RUN.json `server.kind` says so); the `label` string is wrong. Launch future runs from the git copy, or a copy whose SHA256SUMS.txt checks clean. |
| D-4 | LAUNCH_LOG line 1 says `role=JUDGED` for survey and rehearsal runs | Line 1 now prints `$runRole` (the value RUN.json and DRYCHECKS.json already record); the CONTROL wording is unchanged. Past LAUNCH_LOG files are not changed: their line 1 role is wrong, and their RUN.json `role` is right. |
| D-5 | RAM_LOG.json has only a summary | The in-run loop also writes `RAM_TRACE.csv` (`utc,elapsed_s,free_gb,below_guard`, one row per 3 s reading, a failed read keeps an empty row). RAM_LOG.json gains `in_run_trace_file` and `in_run_trace_sha256`. A trace write error never stops a run. Descriptive only: no verdict reads it. |
| D-7 | `Pins.test_shipped_candidate_relay_and_route_slots_are_pending` fails because CANDIDATE.json is READY | The test is renamed `test_shipped_candidate_ready_relay_and_route_slots_pending`. It requires CANDIDATE `READY` exactly, and RELAY_PIN / ROUTE_PIN still PENDING. |
| D-8 | stored test output is v3.1a | `tests/TEST_OUTPUT_python.txt` and `tests/TEST_OUTPUT_powershell.txt` are kept byte-for-byte and are **v3.1a** outputs (2026-10-21). `tests/TEST_OUTPUT_v3_1b_box_linux_20261023.txt` holds the v3.1b runs made on a Linux box, with its limits stated. A Windows v3.1b run is still owed. |
| dry example | `b33_drive.ps1 ... -Mode m4 -DryRun` aborts with the defaults | Documentation only: the example now passes `-SimAccel 900`, as the test script does. The `-SimAccel 0` default is unchanged so existing dry-run tests keep their model. |

Also new: `tests/test_b33_tooling_fixes.py` (D-1, D-2, D-4, D-5 regressions).

## SHA256SUMS changes (D-1)
Old file: 66 entries (in git since 2efbe8a0). New file: 72 entries. Every new entry was hashed from the file in this folder.

**Old entries that no longer matched the tree before this change (the 8 PILOT found):**
- `b33_launch.ps1`: listed `f20b5fb52cf2f4c2`, in git `2cd0bdcdf591d88b` (changed by 73c46791)
- `b33_survey_record.py`: listed `c2adf105ba1d0783`, in git `3cb23e3cbeb7bb50` (changed by 73c46791)
- `b6_b33a_reanalysis/slices/STANDING_span1_sender.log`: listed `bde9ad2e4b795285`, absent from git (D-2)
- `b6_b33a_reanalysis/slices/STANDING_span1_viewer.log`: listed `186404288250a51b`, absent from git (D-2)
- `b6_b33a_reanalysis/slices/WALKING_span1_sender.log`: listed `47e0796fdf5f3216`, absent from git (D-2)
- `b6_b33a_reanalysis/slices/WALKING_span1_viewer.log`: listed `9d43eebfedb080b4`, absent from git (D-2)
- `b6_b33a_reanalysis/slices/WALKING_span2_sender.log`: listed `05992491f31a7acf`, absent from git (D-2)
- `b6_b33a_reanalysis/slices/WALKING_span2_viewer.log`: listed `c33696671c68b1c2`, absent from git (D-2)

**Entries whose hash changed (old listed -> new):**
- `b33_drive.ps1`: `a1fa03037b05c639` -> `123170fecd1a15bd` (dry-run example comment)
- `b33_launch.ps1`: `f20b5fb52cf2f4c2` -> `beb4ed60bd4d5492` (73c46791 W3 + D-4 + D-5)
- `b33_survey_record.py`: `c2adf105ba1d0783` -> `3cb23e3cbeb7bb50` (73c46791 W1)
- `tests/test_b33.py`: `9d00b9c1fee53bdc` -> `38ca7e3f23d9a84f` (D-7)

**Entries added:**
- `TOOLING_FIXES_20261023.md`
- `tests/TEST_OUTPUT_v3_1b_box_linux_20261023.txt` `89c5281ba2faa6c5`
- `tests/fixtures/T091807Z_aborted_survey/drive_survey_20261023T092018Z/route.json` `7de04985b6db8998`
- `tests/fixtures/T091807Z_aborted_survey/drive_survey_20261023T092018Z/timeline.csv` `4b73e90cd2df48e1`
- `tests/test_b33_tooling_fixes.py` `ad4d4a83fe167783`
- `tests/test_b33_wording.py` `b2d39246c59bea0e`

**Entries removed:** none

The six slice logs keep the hashes the old file already listed, so their entries are unchanged.

## Follow-up: Skywalker rulings on 3c040da4 (2026-10-23)
Skywalker's exact-head review of 3c040da4 gave PASS WITH FINDINGS. This commit applies the 4 rulings. CANDIDATE, RELAY_PIN and ROUTE_PIN are unchanged, and readiness is unchanged.

| Ruling | Finding | Change here |
|---|---|---|
| 1 | F1: RAM_LOG.json and RAM_TRACE.csv were not in the close sums | `b33_stop.ps1` adds `RAM_LOG.json` and `RAM_TRACE.csv` to its fixed hash list. Like every entry there, it hashes a file only if it exists (`Test-Path`), so a missing file is skipped and is never a close error. The false comment at `b33_launch.ps1:467` is corrected; that is a comment-only change in the launcher. No suite counted close-sum entries, so no count check needed updating. Runs closed before this change keep their unhashed RAM files. |
| 2 | Judge line 339 (P-1) | **Not changed.** `b33_judge.py` stays byte-identical (sha256 `4caddf0b…`). The 25 POSIX-only failures in test_b33.py remain, and they are documented in the box test outputs. |
| 3 | F6: DRIVE_RECORD did not log `SimAccel` | DRIVE_RECORD.txt line 3 gains `sim_accel=<value>` at the end. The `-SimAccel` default stays 0. `SimAccel` is still read only in the dry-run model. |
| 4 | F3: 2 expected FAILED lines were undocumented | `b6_b33a_reanalysis/SHA256SUMS.txt` is kept byte for byte. The new `b6_b33a_reanalysis/SHA256SUMS_EXPECTED_FAILURES.md` records that `../CANDIDATE.json` (9be2b062) and `../b33_judge.py` (2ecc8b73) fail on purpose. They equal the `JUDGE_b33a_v3_1.txt:95,105` and `JUDGE_b33a_v3_1.json:19,43` hashes, so verify them against `tools/b33_v3_1`. |

F2: for runs closed after D-5, the judge's report embeds 2 more RAM_LOG.json keys (`in_run_trace_file` and `in_run_trace_sha256`). The judge code is unchanged and so is verdict logic; record this alongside ruling 30877f. F5 is corrected: at f539cab2, 9 of the first 11 fix tests fail, not 8.

New tests in `tests/test_b33_tooling_fixes.py` (now 19):
- R1 has 4 tests. b33_stop.ps1 `-FromLauncher` runs on a fixture run folder with no processes and no lease, and the tests check: both files present means both hashed; both missing means skipped with no close error; trace missing means RAM_LOG still hashed; and the launcher comment is fixed.
- R2 pins the judge sha256.
- R3 has 2 tests. A `-DryRun` calibrate records `sim_accel=0` by default and `sim_accel=900` when given.
- R4 checks that exactly the 2 documented entries fail, and that they match JUDGE_b33a_v3_1.json and the note.

Box results are in `tests/TEST_OUTPUT_v3_1b_box_linux_20261023_followup.txt`. A Windows run is still owed (D-8, F4).

**SHA256SUMS changes (follow-up), old listed -> new:**
- `b33_drive.ps1`: `123170fecd1a15bd` -> `b928139a464a3318` (R3)
- `b33_launch.ps1`: `beb4ed60bd4d5492` -> `5ddab9455f036793` (R1 comment)
- `b33_stop.ps1`: `c30f3b80348e1d1e` -> `8cad9b31087cbb5b` (R1)
- `tests/test_b33_tooling_fixes.py`: `ad4d4a83fe167783` -> `252c062e763dbc0d`
- `TOOLING_FIXES_20261023.md`: changed (this section)
- added: `b6_b33a_reanalysis/SHA256SUMS_EXPECTED_FAILURES.md` `379b5c36cc0eb1c6`, `tests/TEST_OUTPUT_v3_1b_box_linux_20261023_followup.txt` `330584ab1bc5c78f`
- removed: none. The new total is 74 entries.

## Follow-up 2: -ObserverFollow (OBSERVER_FOLLOW.md, launcher half) and Skywalker's e1285752 findings (2026-10-23)
Skywalker's review of e1285752 gave PASS WITH FINDINGS. This commit adds the launcher half of OBSERVER_FOLLOW.md and fixes findings F-A, F-D, F-E and F-F. `b33_judge.py` is byte-identical (sha256 `4caddf0b…`, blob `651e33e9`). CANDIDATE, RELAY_PIN and ROUTE_PIN are unchanged, and readiness is unchanged. The client command `wl.Qa.FollowRemote` is FORGE's (#416, `024a0d57`) and is not added here.

| Item | Change here |
|---|---|
| OBSERVER_FOLLOW.md | `b33_launch.ps1 -ObserverFollow <first\|displayName\|userId>`, default OFF. When given, the OBSERVER's `-ExecCmds` ends with `wl.Qa.FollowRemote <who>`; the sender is unchanged. It is disclosed in RUN.json / DRYCHECKS.json as `disclosed.qa_cmds_observer` and `disclosed.observer_follow` (`counted=false`), logged as an `OBSERVER FOLLOW:` line in LAUNCH_LOG.txt, and makes `prereg_launch` false. `b33_drive.ps1` copies it into DRIVE_RECORD.txt as an `observer_follow=<who> qa_cmds_observer=<cmds> source=<file>` line. Without the flag, nothing changes: no key, no line, and the same client arguments (proved against e1285752's frozen fragment). |
| Role gate | The flag is REFUSED (exit 2, before any run folder is made) unless the role is SURVEY or REHEARSAL_NOT_PREREG. The judge's `exec_exact` VOIDs any extra observer command, so a follow run is never counted. JUDGED and CONTROL are refused. |
| Values (FORGE #416 `024a0d57`) | The client reads only the FIRST token and accepts first\|<displayName>\|<userId>\|off (`first` and `off` case-insensitive, display name case-insensitive, user id exact). The launcher passes the value through unchanged. A value with whitespace, a quote, a semicolon or a comma (which would be cut at the first token or break `-ExecCmds`) is REFUSED, and the error tells the user to pass the player's user id instead. **`off` is REFUSED at launch, in any case:** the observer starts unfollowed, so `off` would change nothing, and the error says to omit the flag. Empty values, any other character outside `A-Z a-z 0-9 _ . @ : -`, and values over 64 characters are refused, also pointing to the user id. |
| F-A | `b33_stop.ps1` writes `optional_close_files` = {expected, found, missing, note} to RUN_CLOSE.json for `RAM_LOG.json`, `RAM_TRACE.csv`, `RAM_GUARD_TRIP.txt` and `STOP_LOG.txt`. It is computed with Test-Path before hashing, so a run with all of them missing still leaves a record. A missing file is never a close error. This is descriptive only: the judge reads only `sums_sha256` from RUN_CLOSE.json. |
| F-E | `RAM_GUARD_TRIP.txt` and `STOP_LOG.txt` join the stop script's fixed close-hash list and are skipped when missing, like the RAM files. `RAM_GUARD_TRIP.txt` exists only after a guard trip. `STOP_LOG.txt` is normally **missing** at close, because the conductor writes it from the stop script's own output after the close. It is hashed only if an earlier stop already left one, and `optional_close_files.missing` records its absence. |
| F-D | `tests/TEST_OUTPUT_v3_1b_box_linux_20261023_followup.txt`: the `sha256sum -c` line now reads 74 OK at e1285752, with a one-line note that the old 73 was counted before the file's own entry was added. Box results for this head are in the new `tests/TEST_OUTPUT_v3_1b_box_linux_20261023_observer_follow.txt`. Its `sha256sum -c` count (75) was checked after the final regeneration. |
| F-F | The SHA256SUMS.txt header line 2 now names every 2026-10-23 regeneration: D-1, e1285752 and this head. Line 1 (the original 2026-10-21 header) is kept. |

New tests:
- `tests/test_b33_tooling_fixes.py` (now 42 tests):
  - OF0 pins e1285752's frozen fragment.
  - OF1 (9 tests): refusal for JUDGED, CONTROL, and empty on JUDGED; refusal comes before New-Item; an empty value; whitespace, quotes, semicolons and commas get the user-id pointer; off/OFF/Off are refused at launch; other characters or more than 64 characters get the user-id pointer; first, display names and user ids pass unchanged.
  - OF2 (2 tests): byte-identical arguments and disclosed block across 5 configs; off by default.
  - OF3: survey, rehearsal user id, logged and not prereg, no client command.
  - OF4 (2 tests): DRIVE_RECORD with and without a follow.
  - FA (3 tests): all missing, a found/missing split, all found.
  - FE (2 tests): hashed when present, skipped when missing.
- `tests/test_drive_and_stop.ps1` C13 (end to end under `-DryChecks`):
  - Survey with `first`, survey without the flag (exactly C8's arguments), and a `-ServerTree` rehearsal with `wlautoA`.
  - Refusals for JUDGED, CONTROL, `a,b`, `Off` and `two words`.

Box results are in `tests/TEST_OUTPUT_v3_1b_box_linux_20261023_observer_follow.txt`. On Linux, test_drive_and_stop.ps1 stops at the Win32 ClipRect call before C13, so C13 runs only on Windows. The Kaisin run of this head (a clean `git archive`, `python -I -B`, no client, no build) happens after the commit exists, so its outputs are reported outside the commit.

**SHA256SUMS changes (follow-up 2), old listed -> new:**
- `b33_launch.ps1`: `5ddab9455f036793` -> `a8161cab25477c7d` (-ObserverFollow)
- `b33_drive.ps1`: `b928139a464a3318` -> `6d2f6ecc2a0767b1` (DRIVE_RECORD observer_follow line)
- `b33_stop.ps1`: `8cad9b31087cbb5b` -> `36030f9934650168` (F-A, F-E)
- `tests/test_b33_tooling_fixes.py`: `252c062e763dbc0d` -> `61b23480d1c49e45`
- `tests/test_drive_and_stop.ps1`: `ddeadc7e4181737b` -> `dd87a5d6f4a25c66` (C13)
- `tests/TEST_OUTPUT_v3_1b_box_linux_20261023_followup.txt`: `330584ab1bc5c78f` -> `eb84f407e526b8dc` (F-D)
- `TOOLING_FIXES_20261023.md`: changed (this section)
- added: `tests/TEST_OUTPUT_v3_1b_box_linux_20261023_observer_follow.txt` `2cc8e21f838c104a`
- removed: none. The new total is 75 entries.
