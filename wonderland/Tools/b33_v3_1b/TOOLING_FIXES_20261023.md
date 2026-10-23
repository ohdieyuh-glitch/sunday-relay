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
