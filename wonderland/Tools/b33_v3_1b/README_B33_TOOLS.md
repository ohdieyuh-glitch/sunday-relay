# B33 package-precondition tools, v3.1 (SC3; Stage 1 ruling Q4; M2 checklist C0 + B1-B8; M1 ruling R-5; M2 ruling a185b283 B-1..B-10; M2b ruling fea3fb7f R7-01..R7-10, R8-04)

**THIS FOLDER IS B33 v3.1a (`tools\b33_v3_1a`, built 2026-10-21 offline, no run), from v3.1 (`tools\b33_v3_1`, SHA256SUMS 4f4ae6fe, mailed and frozen) with ruling 7a7faf: P2-1 (a) (M4 replacement only for 'fewer than 5 qualifying falls'), P2-2 (runs that are never counted are written outside the counted folder: SURVEY_b33_* / REHEARSAL_NOT_PREREG_b33_* under NOT_COUNTED_b33, roles SURVEY / REHEARSAL_NOT_PREREG; the run listing excludes them), P2-4 (the lease gate >= 5.0 GB enforced; RUN.json / RAM_LOG.json readings copied into the judge report; the in-run RAM guard 1.1 GB, a stop that never decides a verdict) and the NITs (these command lines; the DELTA's own row; the (iv) limit). Its delta from v3.1: `DELTA_b33_v3_1_to_b33_v3_1a.md`; the prereg: `M2c\PREREG_B33_PRECONDITION_v3_1a_DRAFT.md`.** The text below is v3.1's, with its file names.

**v3.1 WAS B33 v3.1 (`tools\b33_v3_1`, built 2026-10-21 offline, no run).** `tools\b33` (v3, SHA256SUMS fa748d6d) stays FROZEN and is never edited. What is new against it is listed file by file in `DELTA_b33_to_b33_v3_1.md`; every item has its reason and evidence in `PATCH_LIST_v3.1.md` (P1-P86) and `REHEARSAL_FINDINGS.md` (F1-F60). The prereg text is `M2c\PREREG_B33_PRECONDITION_v3_1_DRAFT.md`.
- **Pins (PENDING slots that refuse a counted run):**
  - `CANDIDATE.json` = 0.1.0-r16reh18, status `PENDING r16reh18`: the launcher refuses, the judge VOIDs, until the lead fills it from the governed build;
  - `RELAY_PIN.json` (the B35 v5.3.2 pattern): the counted loopback relay IS the pin (status PINNED + 40-hex commit and tree, the commit resolving to that tree); PENDING = the launcher refuses before anything is made and the judge VOIDs; `-RelaySource` / `-ServerTree` runs are NOT-PREREG and VOID;
  - `ROUTE_PIN.json`: a live `-Mode m4` / `-Mode all` drive is refused unless it is PINNED and `-Route` hashes to it; the judge VOIDs a run with M4 blocks whose drive route differs or while it is PENDING. The two options (v10 + survey 12's record, or v11 + a fresh survey) are named in it; the lead chooses on a SURVEY ONLY, before data.
- **Q-B33-2 (392923 (b)):** the sinking test runs PER BLOCK (each M4 attempt its own block): a touchdown never opens a settle window in another block; samples before a block's first touchdown are not covered (a known limit, stated in the prereg). Bars unchanged.
- **Rehearsal fixes promoted:** P75 (burst arrival), P76 (pass-through waypoint), P77 (On-Kerb pending report), P78 (the block gap in the drive + the judge's contamination rule: INCONCLUSIVE, never erasing a FAIL), P79 (route v11), P80 (an aborted drive asks the conductor to close), P81 (a descent's corner stop), P83 (`-RelaySource` / `-RelayCommit`, NOT-PREREG).
- **P82 (descriptive ring evidence, `WLREMOTE trail` lines; a read, not a bar; T1 d63c15 Q14)** is carried behind `RING_EVIDENCE`; the test `ZRingNoVerdictChange` judges every fixture and every rehearsal run on disk with it on and off and finds the reports byte-equal apart from the ring block.
- **Not promoted (copy-only):** the rehearsal `CANDIDATE.json` (c19 harness), `REHEARSAL_README.md`, `PLAN_B_M4_LEDGES.md`, `RING_REHEARSAL_PLAN.md`, `dev_model\`, `dev_hygiene\`, and the launcher's `DIAGNOSTIC_NOTPREREG_b33_*` naming (8805ec). The line below about the copy's naming describes the copy only.


**v3.1 (M2b ruling fea3fb7f, review R7; the batched delta; every change is listed with reason and evidence in `PATCH_LIST_v3.1.md`, the rehearsal findings in `REHEARSAL_FINDINGS.md`):**
- **R7-01 run composition.** A JUDGED run is ONE launch `-Scenario all` with ONE drive `-Mode all` (the jump blocks, then the M4 blocks), so every judged run carries all four scenarios and the control's condition (b) is reachable. The CONTROL is one launch `-Scenario jumps -Control` with `-Mode jumps`.
- **R7-02 precedence.** VOID > FAIL > INCONCLUSIVE (an INCOMPLETE block included) > timing gate > PASS, printed at the top of the algebra. A bar violation in an aborted block stays FAIL.
- **R7-03 switches.** The judge holds the PREREG switch list itself (`-userdir -windowed -ResX -ResY -WinX -WinY -wldev -ExecCmds`) and checks each client's OWN `LogInit: Command Line` against it. RUN.json's list is printed only. `-forcelogflush` is VOID even when RUN.json lists it, and a RUN.json `prereg_launch` that is not true is VOID. `--allow-switches` / `--allow-launch-cmds` work only with `--historical`.
- **R7-04 clearance (a).** Only a REGISTERED-analyser bar FAIL (shift 0) of a non-VOID control counts; a W2-only FAIL or a missing air label does not.
- **R7-05 clearance (c).** `--p7a` takes a RECORD: one line `DECISION: APPROVED` (or `REJECTED`) and a non-empty `VERBATIM:` text (the founder's own words). APPROVED meets (c); REJECTED means NOT cleared (revert: a new governed build and fresh SC3 runs); anything else is INVALID. The reviewer judges (c); the tool line is advisory.
- **R7-06 control values from the log.** Every `-ExecCmds` CVar echoes in the client's own log as a bare `wl.X = "v"` line. A CONTROL observer must show exactly one echo each of `wl.Remote.InterpEaseZ = "30"`, `wl.Remote.ReportTimeSamples = "0"` and `wl.Remote.RttClock = "0"`. Any other `wl.*` echo on any client (except `wl.Remote.LogPeriod = "0.1"`) is VOID.
- **R7-07 overrides.** Each JUDGE.json records the overrides it was judged with. `--pair` and `--control-vs` refuse a JSON judged with any override (input paths, `--no-require-frames`, `--expect-exe`, `--candidate-file`, `--allow-*`, `--historical`) or by a judge before v3.1.
- **R7-08 VOID shows the bars.** A VOID run is still analysed; its per-scenario verdicts are printed (marked "[VOID run, not a result]") so a bar FAIL stays visible. They are never a result, and a pair with a VOID run is VOID.
- **R7-09 survey bounds.** The baseline is the PINNED route v1 (sha256 788f2015..., checked), never the route the survey drove. A survey that drove another route (route v2) is recorded as a survey of a PROPOSED route and must itself stay inside the v1 bounds. Field names match exactly or as `<prefix>.`.
- **R7-10.** This README (z is READY at a82b2a5d; the server wording below); test C6 is no longer vacuous with a READY file. The STAND +1.6 s tail that overlaps the WALK start is kept (harmless per R7; changing it would move the recorded b33a numbers).
- **R8-04 cursor clip (rehearsal finding).** Before the click the drive releases a stale cursor clip (ClipCursor(NULL), verified, NOTEd; no input event), verifies that the absolute jump arrived, and requires the sender to own the foreground after the click.
- **R8-05 analog (close hashes).** The judge checks every file it reads (RUN.json, both logs, every drive timeline, frames\index.csv) against the run's `SHA256SUMS_AT_CLOSE.txt` and `RUN_CLOSE.json` (b33_stop.ps1). A changed file, or a run that was never closed, is VOID (a `--historical` re-analysis records the check only).
- **Route following (rehearsal survey 1).** CORNER: a leg that needs a turn sharper than `-TurnStopDeg` (35) starts standing. LEFT-THE-PATH: a fall of more than `-DropAbortUu` (40) uu within 1 s on any walked leg aborts at once. Mount: the drive gives up only inside the kerb box near the target, or within 8 uu of it. **Route v2** (`routes\b33_route_v2.json`, `verified: false`, inside the v1 bounds) is the PROPOSED approach and return; the official route is fixed only by the B-9 survey addendum on the candidate.

**v3.1b (rehearsal survey 2; PATCH_LIST P19-P26; REHEARSAL_FINDINGS F13-F18):**
- **Drive:**
  - PRECISE arrival at corners and at the last waypoint (`-PreciseUu` 120: release early, then taps);
  - the corner turn computed after the stop;
  - OFF-PATH (`-FloorTolUu` 15: the soles z stays within 15 uu of the leg's highest z at any speed; a waypoint may carry its expected z as `[x, y, z]`);
  - heading hold on the leg line (carrot 250 uu; a large error is turned standing);
  - a two-pass calibration (`-CalPasses` 2; the mean; refuse above `-CalSpreadMaxPct` 8);
  - dry-run lag and counts/deg fixtures (`-SimLagMs`, `-SimCpd2`).
- **Route v3** (`routes\b33_route_v3.json`, PROPOSED, `verified: false`): the path centre line x 0 north, a precise corner east at y 4380, the mount NE.
- **PLAN_B_M4_LEDGES.md:** the candidate M4 ledges for a possible location ruling. Nothing is changed.

**v3.1c (rehearsal survey 3 + the jumps rehearsal; PATCH_LIST P27-P35; REHEARSAL_FINDINGS F19-F25):**
- **Mount deeper:** within `-MountTolUu` 15 of mount.to's y; route v4 targets (148, 4476), inside the ruled box.
- **Camera estimate:** re-anchored on the actor's logged yaw after each mount tap, and on the walk-off's own heading afterwards.
- **WALKOFF-HEADING:** probe taps until the actor stops turning; then its yaw must be within 5 deg of walk_off.yaw, or the drive aborts with no walk-off.
- **Corners** are probed the same way.
- **Calibration** (both modes): the actor yaw, walks of at least 1.2 / 1.4 s, 3 passes, the median, a spread of 10 % at most with ONE re-run, then abort.
- **The model** has an actor that turns only while moving, acceleration and an input asymmetry.
- **Route v4** (`routes\b33_route_v4.json`, PROPOSED): the eastward mount and a return on the slab east of the terraces.
- **Routes v1-v3** mount at x 163, which leaves no room for the walk-off probes, so their M4 walk-off is refused by default.

**v3.1d (rehearsal survey 4; PATCH_LIST P36-P46; REHEARSAL_FINDINGS F26-F30):**
- **Calibration is a starting gain, not a gate:** three passes out and back (+ / - / +, a standing 180-deg turn before each later pass), blocked passes skipped, separate + / - gains (medians) clamped to 3.5..9.0, the spread logged. The drive aborts only for broken input (a turn under 5 deg, the wrong way, or no pass measurable).
- **Paced mouse:** 1 count every 2 ms from C# (`RelPaced`), every count checked against the guard, the foreground and the cursor's window. The game smooths the mouse (`bEnableMouseSmoothing=True`); a model of UE 5.8's `SmoothMouse` shows the pinned pacing over-turning 0.97..1.60 x and this pacing within 0.98..1.01 x (`dev_model\`, copy-only).
- **Warm-up:** +/-200 counts standing before the first pass (`CAL_WARMUP`).
- **Fresh readings:** heading probes and re-anchors read only samples stamped after the last release of W; the movement-heading re-anchor uses only samples after the last mouse move.
- **Probes:** up to 8 for the walk-off and for corners (the Dog turns 260 deg/s, only while W is held: <= ~16 deg per 60-ms tap).
- **The model** follows the game's source (260 deg/s while W is held, acceleration 900, yaw -180..180).
- **Route v4's return** now starts (380,4455) and goes straight south to (380,4130), east of the step.

**v3.1e (rehearsal survey 5; reviewer ruling 8805ec; PATCH_LIST P47-P55; REHEARSAL_FINDINGS F31-F35):**
- **Route v5** (`routes\b33_route_v5.json`, PROPOSED): onto the strip at its small step near y 4400 (where rehearsal 3 stepped up 18.7 uu), then the mount taps north on the strip top to (155,4470). It avoids the trough that stopped rehearsal 5.
- **Walk-off heading by displacement:** three 30-ms taps per round; the bearing of the Dog's own displacement is the camera yaw. Within 5 deg it walks off; otherwise it turns the error out (at most 3 rounds). It never taps within 14 uu of the box's east side.
- **MOUNT-DOWN:** a mount tap that goes down more than 15 uu aborts at once.
- **Fresh samples:** Wait-Idle counts only samples stamped after W's release. Corner probes count only taps that moved the Dog.
- **Copy only (8805ec):** the rehearsal copy names its run folders `DIAGNOSTIC_NOTPREREG_b33_<scenario>_<utc>`; the pinned launcher keeps its names.
- **Close sums:** the conductor writes the stop's report to `STOP_LOG.txt`, never into `LAUNCH_LOG.txt` after it was hashed.

**v3.0.1 changes** (lead 10-20; no data exists; nothing launched):
- **ONE pinned candidate: `CANDIDATE.json`.** It holds label, commit, game exe sha256, boot exe sha256 and package folder, and it is the only place any tool takes the candidate from. Both `b33_launch.ps1` and `b33_judge.py` read it. **It holds the candidate 0.1.0-r16reh16z, status READY** (commit a82b2a5d40ecdead8c1e2d2dad37106d066b934c, game exe 18e16ff9..., boot exe aca06a16..., filled by the lead from the governed build record). It shipped as "PENDING z" until then (R7-10).
  - **The launcher refuses unless `status` is exactly `READY`.** The refusal comes before anything is made: no run folder, no lease, no server, no client, and it applies under `-DryChecks` too. It also refuses:
    - a `-Package` other than `package_folder`;
    - a `-Commit` that is neither `commit` nor a prefix of it of at least 7 characters;
    - a game exe or boot exe whose sha256 differs from the file's.
  - **The judge VOIDs** every run unless `status` is `READY`, and also VOIDs:
    - a RUN.json `exe_sha256`, `boot_sha256` or `commit` that differs from the file's;
    - a run launched with a non-default candidate file.
  - **To arm:** the lead writes z's values and sets `"status": "READY"`. The new hash of the file then goes into the prereg pin.
  - `-CandidateFile` (launcher) and `--candidate-file` (judge) point at another file. They are for the tests only: the launcher accepts another file only with `-DryChecks`.
  - The old `-ExpectExeSha256` parameter and the judge's hardcoded constant are gone. A test checks that no `.py`, `.ps1` or `.cs` file under `tools\b33` contains the candidate hashes.
- **The prereg ExecCmds set (lead 10-20).** The PREREG B33 v3 judged launch is `-Package <pkg> -Commit <sha> -Scenario jumps|m4|survey -RenderCvars 'scalability 0'` (a CONTROL adds `-Control`).
  - Each client's `-ExecCmds` must be EXACTLY `wl.Social.Dev <its identity> http://127.0.0.1:<port>`, `wl.Remote.LogPeriod 0.1` and `scalability 0`. Order does not matter. A CONTROL observer also gets exactly the three old values.
  - **The judge VOIDs** any other command (an extra `wl.Remote.*` or `r.*`, disclosed or not), a missing or repeated command, an empty command, a non-loopback dev URL, another identity or port, and a RUN.json `disclosed.render_cvars` other than `["scalability 0"]`. A `--historical` re-analysis is exempt.
  - `-DryChecks` now records the PLANNED client arguments and the very `disclosed` block that RUN.json will carry.
  - The launcher prints a NOTE when a launch is not the prereg one.
- **Defect fixed (found by test C8).** On every JUDGED run, the observer's `-ExecCmds` used to end in a trailing comma (`...,wl.Remote.LogPeriod 0.1,"`). The cause: `$(if ($Control) {...} else { @() })` passes `$null`, which becomes one empty entry. The launcher now passes an explicit array and drops empty entries.
- **b33a re-run (B6)** with this judge: the same numbers and the same FAIL. Only the printed algebra, the CANDIDATE line and the judge's hash changed.

**v3 changes** (B33 v3; v2 stays on record; no data exists):
- **Judge:**
  - the verdict is BOTH analysers, and the REGISTERED one is the bar (B-2);
  - a bar FAIL beats every timing gate (B-3);
  - the scenarios are the drive's blocks, and no timeline means INCONCLUSIVE (B-4);
  - the full launch switch list is checked, and an undisclosed switch is VOID (B-5);
  - M4 must PASS in both runs of a pair (B-6), and is judged under the bars (B-7);
  - the sinking window runs to the next takeoff with no cap (B-8);
  - pair() refuses a CONTROL, and `--control-vs` prints the three clearance conditions (B-10);
  - the control's values are confirmed from the observer log (B-10).
- **Launcher:** no `-wlframes` (B-5); refuses a non-candidate exe (R4-13).
- **Survey:** the drive's survey mode adds a runway leg, and `b33_survey_record.py` writes the survey record and checks any proposed route against the B-9 bounds.
- **P2s:** M4 drop = min(median, last) - landing (R4-11); a speed-bound teleport rule and an observer-log WLDEV scan (R4-12); the judge checks the exe sha256 (R4-13).

**These are DIAGNOSTIC tools, written by W2DEV. They are not evidence by themselves.** Every run they produce is DEV loopback with dev identities. Those runs are development corroboration for the package precondition and are never scoring evidence (C0.5).

Folder: `C:\dev\iwonder\_qa_handoff\integration\r16reh16w_submission_20261020\tools\b33_v3_1a\`. Every file's sha256 is in `SHA256SUMS.txt`. The prereg must pin those hashes before any data (C0.1). That includes the **M4 reader**, which is `b33_slicer.py` (`m4_fall`, the RULES in its header) plus the M4 section of `b33_judge.py`. It is new and was written before any M4 data. In v3 a fall qualifies on min(median, last ground sample) - landing >= 100.0, and both drops are printed (R4-11). The survey's `read_survey*.py` is not used.

## Files

| File | What it is |
|---|---|
| `CANDIDATE.json` | THE ONE pinned candidate (label, commit, game/boot exe sha256, package folder, status). Read by the launcher and the judge. Holds **0.1.0-r16reh16z, READY** (a82b2a5d). |
| `routes\b33_route_v2.json` | v3.1 PROPOSED route (`verified: false`): the M4 approach north on the kerb strip x 150..161 and a return along the slab corridor, from rehearsal survey 1 and the DEV kerb survey; inside the B-9 bounds of the pinned v1. Passed with `-Route`; the default stays v1 until the survey addendum is ruled. |
| `PATCH_LIST_v3.1.md`, `REHEARSAL_FINDINGS.md` | v3.1: every change (item, file, change, reason, evidence/test) and every rehearsal finding. |
| `b33_analyser\motion_diag.py` | The REGISTERED analyser, a byte-identical copy (sha256 `4dee34d0...`). See `PROVENANCE_motion_diag.md`. |
| `b33_analyser\motion_diag_w2.py` | The listed diff: game-clock timing (D1/D2), timing report (D3), numeric no-sinking test (D4), shift refused (D5). See `MOTION_DIAG_W2_DIFF.md` and `motion_diag_w2.diff`. |
| `b33_slicer.py` | W2DEV's own slicer. It splits a run into STANDING / WALKING / RUNNING jumps by the sender's own labels and speeds. It also lists walk-off falls (the M4 reader) and teleports. |
| `b33_judge.py` | v3. Runs the slicer (counts only) and BOTH analysers over the drive's blocks. The registered analyser is the bar; W2 may only add FAIL/INCONCLUSIVE. Prints the verdicts with the algebra up front, the M4 falls, the launch/server/exe checks and VOID. Has a pair mode (JUDGED runs only) and the R-5 `--control-vs` mode (three conditions). |
| `b33_survey_record.py` | B-9: turns a `-Mode survey` run into a fixed `SURVEY_RECORD.md` (rows, runway, mounts; the SURVEY_WALKOFF fall printed, never counted) and checks a proposed route file against the bounds (waypoints, arrive points, taps and calibration only). |
| `b33_launch.ps1` | Takes the lease, builds and starts the loopback dev server from cbe584be's own code, starts two packaged clients (sender and observer), PLACES and verifies both game windows, writes RUN.json, then conducts until stopped. `-Control` = R-5 CONTROL. `-DryChecks` = input checks only. |
| `relay_import_closure.py` | Read-only check (git show only) that cbe584be's `relay-bridge/dev-social-server.ts` imports nothing outside the archived paths, and that its packages exist in the pinned node_modules. |
| `server_check\` | The route verification (cbe584be's dev server vs the client at 1e7cdebb) and the import-closure output. |
| `b33_stop.ps1` | Kills ONLY the run's own pids (checked by pid + start time), hashes everything after close, releases the lease. |
| `b33_drive.ps1` | The real-OS-input driver for the SENDER (SendInput only). Modes: `jumps`, `m4`, `survey`, `calibrate`. `-DryRun` sends nothing. |
| `b33_native.cs` | The C# that the PowerShell scripts compile: SendInput, low-level hooks, window checks and placement (physical pixels through a PER_MONITOR_AWARE_V2 thread context), live log tail, and the dry-run Dog model. |
| `b33_layout.ps1` | Pure window-layout helpers shared by the launcher and the drive: targets, 2 px comparison, overlap, click point. |
| `b33_frames.ps1` | Captures the observer window during the drive's blocks (B7). It sends no input. |
| `routes\b33_route_v1.json` | Waypoints: runway, M4 approach, kerb, return. **`verified: false`** (see the assumptions section). |
| `tests\test_b33.py`, `tests\b33_synth.py` | Python unit tests on SYNTHETIC run folders (one deliberate fixture per v3 rule), plus the b33a shift-0 FAIL check on its drive blocks. |
| `tests\test_drive_and_stop.ps1` | Drive dry runs (no input), two must-abort cases, the window-layout checks (L1-L4), the real-mode drive refusing before any hook or input without a verified layout or game window (L5/L6), the launcher's server-input checks under `-DryChecks` (C1-C3), the exe refusal and switch list (C4/C5), **the PENDING marker refusing** (C6), the boot/commit/folder/test-file refusals (C7), the prereg ExecCmds from `-RenderCvars 'scalability 0'` (C8), launcher-to-judge on those planned command lines (C9), the survey record and its route bounds (V1-V3), and the stop script's own-pid rule (S1). v3.1: `-Mode all` (D6), route v2 survey + return (D7), the rehearsal-1 failure reproduced in the model and fixed by the CORNER rule (D8), a survey that drove route v2 (V4); `-SkipS1` leaves S1 (two sleeping processes) out. |
| `tests\TEST_OUTPUT_*.txt` | The last test outputs (hashed). |
| `b6_b33a_reanalysis\` | B6: the hashed analyser on b33a at shift 0 = FAIL. Outputs and hashes. |

## Exact command lines

Run them from any folder. Use Windows PowerShell 5.1 and Python 3 with `-I -B`.

**0. Before data: the tests.** They write only under `tests\`.
```
python -I -B C:\dev\iwonder\_qa_handoff\integration\r16reh16w_submission_20261020\tools\b33_v3_1a\tests\test_b33.py
powershell -NoProfile -ExecutionPolicy Bypass -File C:\dev\iwonder\_qa_handoff\integration\r16reh16w_submission_20261020\tools\b33_v3_1a\tests\test_drive_and_stop.ps1
```

**1. Launch.** Run it in the background. It holds the lease and stays alive until step 3. `<PKG>` is the unpacked governed package folder (it holds `Wonderland.exe` and `Wonderland\Binaries\Win64\Wonderland.exe`). `<SHA>` is its client commit. `<PKG>` must be `CANDIDATE.json`'s `package_folder`, and `<SHA>` its `commit` (z: `a82b2a5d40ecdead8c1e2d2dad37106d066b934c`). A launch is refused unless `CANDIDATE.json` is READY. These are the prereg's command lines (v3.1, R7-01: each JUDGED run is ONE `-Scenario all` launch; run from PowerShell or bash; from cmd.exe write `-RenderCvars "scalability 0"` with double quotes):
```
powershell -NoProfile -ExecutionPolicy Bypass -File ...\tools\b33_v3_1a\b33_launch.ps1 -Package <PKG> -Commit <SHA> -Scenario all -RenderCvars 'scalability 0'              (each JUDGED run, x2)
powershell -NoProfile -ExecutionPolicy Bypass -File ...\tools\b33_v3_1a\b33_launch.ps1 -Package <PKG> -Commit <SHA> -Scenario jumps -RenderCvars 'scalability 0' -Control   (the CONTROL)
powershell -NoProfile -ExecutionPolicy Bypass -File ...\tools\b33_v3_1a\b33_launch.ps1 -Package <PKG> -Commit <SHA> -Scenario survey -RenderCvars 'scalability 0'   (v3.1a: written to NOT_COUNTED_b33\SURVEY_b33_<utc>, role SURVEY)           (the B-9 survey)
```
- **The client arguments these produce** (sender; the observer is the same with wlautoB and `-WinX=960`): `-userdir="<run>\sender" -windowed -ResX=940 -ResY=1031 -WinX=0 -WinY=0 -wldev -ExecCmds="wl.Social.Dev wlautoA http://127.0.0.1:8796,wl.Remote.LogPeriod 0.1,scalability 0"`. With `-Control`, the observer's list goes on `,wl.Remote.InterpEaseZ 30,wl.Remote.ReportTimeSamples 0,wl.Remote.RttClock 0`. RUN.json `disclosed.render_cvars` = `["scalability 0"]`; `prereg_launch` = true.
- It prints `READY` and the run folder: `...\diagnostics\DIAGNOSTIC_b33_<scenario>_<utc>`, or `DIAGNOSTIC_b33_CONTROL_<scenario>_<utc>`.
- Defaults: lease 5.0 GB; port 8796; identities wlautoA (sender) and wlautoB (observer); `wl.Remote.LogPeriod 0.1` (logging only, disclosed); no gameplay CVar.
- **Switches (B-5).** The clients get exactly `-userdir -windowed -ResX -ResY -WinX -WinY -wldev -ExecCmds`, plus `-forcelogflush` only with `-ForceLogFlush`. There is **no `-wlframes`**. RUN.json `disclosed.launch_switches` records the list, and the judge VOIDs any other switch in a client's own Command Line.
- **Candidate (R4-13; `CANDIDATE.json`).** Before anything is made, the launcher refuses in any of these cases:
  - the file's `status` is not `READY` (it shipped as `PENDING z` until the lead filled it);
  - `-Package` is not its `package_folder`;
  - `-Commit` is not its `commit`, or a prefix of it of 7+ characters;
  - the game or boot exe sha256 differs from the file's.

  RUN.json `candidate` records the file, its sha256, `default` (true unless `-CandidateFile` was used, which is allowed only with `-DryChecks`) and the values used.
- **The loopback server runs the deployed commit's own ROUTE code** (PREREG_B33_PRECONDITION_v2 section 3; wording per R7-10 / R7 section 6): cbe584be's `relay-bridge/dev-social-server.ts` ("Loopback only; never deployed") calls the same `handleSocialRoute` that production calls, so the 100 ms coalescing, the server-stamped reportedAtMs/ageMs and the ordering are shared; it is not the deployed program (no presence lease or budgets, an in-memory store, loopback RTT). Loopback is the best case for delay and jitter. It is built the way the B35 launcher builds its relay:
  - `git archive cbe584be relay-bridge src package.json` of `C:\dev\iwonder\sunday-relay`, unpacked into the run folder.
  - NODE_PATH = `C:\dev\iwonder\_r16fix_relay_pristine_20261020\node_modules`. **The launcher refuses** unless that tree's package-lock.json is byte-identical to cbe584be's blob (`c44cfffc…`). The check runs before the lease.
  - esbuild bundles cbe584be's own `relay-bridge/dev-social-server.ts`, unchanged, to `<run>\dev-social.mjs` (the name its entry check needs). Node serves it on 127.0.0.1:<Port>, in memory, with dev sessions.
  - RUN.json `server` records: repo; full commit `cbe584becf417c48cc4de8efe8a2fa16f404c0bf`; tree `490a5432…`; the archived file list (path and blob, `relay_archive_files.txt`: 1769 files) and its sha256 (`f6c9a44c…`); the tar's sha256; the entry's sha256; the lockfile check; the bundle's sha256; `prereg: true`.
  - Parameters: `-SundayRelay -RelayCommit -NodeModulesFrom`.
  - `-ServerTree <dir>` remains only as an explicit override. It bundles that tree instead and marks the run NOT-PREREG (`server.prereg: false`); **the judge VOIDs such a run.**
- `-DryChecks` runs every input check (candidate, package, cbe584be, lockfile, archive list) and writes `<run>\DRYCHECKS.json`. That file holds the planned client arguments (`planned.sender/observer.args`), the `disclosed` block RUN.json will carry, `server_port` and `prereg_launch`. It takes no lease and starts nothing.
- **Window layout.** The packaged clients IGNORE -ResX/-ResY (lead's B35 v4 shakedown: client areas came up 1600x1000), so the launcher places the windows itself after both clients joined.
  - It finds each client's GAME process (`Wonderland\Binaries\Win64\Wonderland.exe` with that `-userdir`, never the boot stub) and waits for a stable client rect.
  - It calls `SetWindowPos(hwnd, 0, x, y, w, h, SWP_NOZORDER|SWP_NOACTIVATE)` from a PER_MONITOR_AWARE_V2 thread.
  - Defaults: frames 960x1080 at x 0 (sender) and x 960 (observer), y 0. The lead verified that this gives about 940x1031 client areas, re-rendered by the game. Parameters: `-FrameW -FrameH -FrameY -SenderX -ObserverX -LayoutTolPx`.
  - It re-reads the frame and client rects (up to 3 tries). If a frame is more than 2 px off its target, or the frames or client areas overlap, the layout is REFUSED: RUN.json records it, no READY is written and the run is closed.
  - RUN.json records `layout` (targets, ok, why, the rects before placement) plus `frame_rect`, `client_rect` and `game_pid` per client.
- `-forcelogflush` is OFF. Pass `-ForceLogFlush` to restore it (disclosed).
- `-RenderCvars` adds rendering commands, disclosed, and the default is none. **The prereg fixes `-RenderCvars 'scalability 0'`.** Any other set, including none, makes the launcher print `NOTE: NOT the PREREG B33 v3 judged launch`, and the judge VOIDs the run.
- With `-Control`, the observer also gets exactly `wl.Remote.InterpEaseZ 30,wl.Remote.ReportTimeSamples 0,wl.Remote.RttClock 0`.

**2. Drive** (after READY). The M4 blocks need the route verified first (step 5). Pass the ruled route with `-Route` (the default is the pinned v1).
```
powershell -NoProfile -ExecutionPolicy Bypass -File ...\tools\b33_v3_1a\b33_drive.ps1 -Run <judged run folder> -Mode all [-Route <ruled route>]     (each JUDGED run: jumps, then M4)
powershell -NoProfile -ExecutionPolicy Bypass -File ...\tools\b33_v3_1a\b33_drive.ps1 -Run <control run folder> -Mode jumps                         (the CONTROL)
```
- v3.1 route following: CORNER (`-TurnStopDeg`, default 35: a sharper turn is made standing), LEFT-THE-PATH (`-DropAbortUu`, default 40: a larger drop within 1 s on a walked leg aborts), and the mount give-up only inside the kerb box (or within 8 uu of the target). v3.1b adds the following:
  - PRECISE arrival (`-PreciseUu` 120);
  - OFF-PATH (`-FloorTolUu` 15);
  - heading hold on the leg line;
  - the two-pass calibration (`-CalPasses` 2, `-CalSpreadMaxPct` 8).
- Defaults: 12 standing, 12 walking and 12 running jumps; 5 walk-offs in M4; 60 s presence gate.
- The drive calibrates the mouse first by walking about 500 uu from spawn.
- Timeline: `<run>\drive_<mode>_<utc>\timeline.csv`.
- **The drive refuses to start (before any hook or input)** unless RUN.json has `layout.ok` AND its own re-read of both GAME windows (frame and client rects, physical pixels) matches RUN.json within 2 px with no overlap. While driving, it re-reads the sender's frame rect once a second and aborts if the window moved or resized.
- **Input checks:**
  - The click point comes from the re-read client rect (50%, 72%, then three fallback points).
  - The sender is raised TOPMOST (z-order only, never activated) before the click and for the whole drive.
  - The window under the point must be the sender before the cursor moves there and again right before the click.
  - The window under the cursor must be the sender before every relative mouse move.
  - The foreground must be the sender before every key.
  - These matter because the founder's desktop has terminals over the game windows; a covered point or cursor aborts the drive.

**3. Stop.** It closes the run, hashes the logs and releases the lease.
```
powershell -NoProfile -ExecutionPolicy Bypass -File ...\tools\b33_v3_1a\b33_stop.ps1 -Run <run folder>
```

**4. Judge (v3.1).** Exit codes: 0 PASS, 1 FAIL, 3 INCONCLUSIVE, 4 VOID, 5 pair REFUSED.
```
python -I -B ...\tools\b33_v3_1a\b33_judge.py <run folder> --json <run folder>\JUDGE.json > <run folder>\JUDGE.txt
python -I -B ...\tools\b33_v3_1a\b33_judge.py --pair <judged run 1>\JUDGE.json <judged run 2>\JUDGE.json
python -I -B ...\tools\b33_v3_1a\b33_judge.py --control-vs <control run>\JUDGE.json <judged run 1>\JUDGE.json <judged run 2>\JUDGE.json --p7a <founder's P7a RECORD>
```
- **Verdict (fixed by the M2 ruling):**
  - BOTH analysers, and the registered one (raw stamps, shift 0) is the bar;
  - precedence (R7-02): VOID > FAIL > INCONCLUSIVE (INCOMPLETE included) > timing gate > PASS: registered bar FAIL, then W2 bar FAIL, then missing observation INCONCLUSIVE, then timing gate INCONCLUSIVE (gates only demote a PASS), then PASS;
  - a VOID run is still analysed and its verdicts printed, never counted (R7-08);
  - the scenarios are the drive's blocks, each block + 1.6 s, and no timeline means INCONCLUSIVE;
  - the v2 options `--verdict-analyser` and `--m4-bars` are refused.
- **Pair:** JUDGED runs only (a CONTROL is REFUSED); a JSON judged with any override is REFUSED (R7-07); a VOID run makes the pair VOID; every scenario must PASS in both runs, M4 included.
- **`--control-vs`:** prints the three R-5 conditions. (a) The control (not VOID) FAILs at least one jump scenario by a REGISTERED bar at shift 0 (R7-04). (b) Both judged runs PASS that scenario and their whole runs. (c) The founder's P7a look is recorded verbatim as an APPROVAL in the `--p7a` RECORD (`DECISION: APPROVED` + `VERBATIM: ...`); a recorded REJECTION is NOT cleared (R7-05). The defaults clear only with all three; the reviewer judges (c).
- **Options:**
  - `--no-require-frames`;
  - the expected exe comes from `CANDIDATE.json` (`game_exe_sha256`, `boot_exe_sha256`, `commit`; VOID unless `status` is `READY`). `--candidate-file <json>` is for tests only. `--expect-exe <sha256>` is a printed OVERRIDE for historical re-analyses and synthetic tests: it skips the status, boot and commit checks, and is never used on SC3 data;
  - **ExecCmds:** each client's set must be exactly the prereg one (`wl.Social.Dev <identity> http://127.0.0.1:<port>`, `wl.Remote.LogPeriod 0.1`, `scalability 0`, plus the three old values on a CONTROL observer). Anything else is VOID;
  - for historical runs only, all printed: `--historical` (an exe older than 8c5c62cb; needs `--expect-exe`), `--allow-launch-cmds "a;b"`, `--allow-switches "-x;-y"` (both refused without `--historical`, R7-03). See `b6_b33a_reanalysis\B6_RECORD.md`.

**5. Route survey** (a declared DIAGNOSTIC addendum, M2 ruling B-9). It runs after Q11 and before any jump or M4 data, and the reviewer rules on it.
```
powershell -NoProfile -ExecutionPolicy Bypass -File ...\tools\b33_v3_1a\b33_drive.ps1 -Run <run folder> -Mode survey -SurveyReturn [-Route routes\b33_route_v2.json]
python -I -B ...\tools\b33_v3_1a\b33_survey_record.py <run folder> [--route-new <proposed route json>]      (bounds always against the pinned v1, R7-09)
```
- **Order:** calibrate; the jump runway (approach, walk to y_hi, turn, walk back to y_lo, in a SURVEY_RUNWAY block, no jump); the M4 approach and mount; with `-SurveyReturn`, a walk-off in a **SURVEY_WALKOFF** block, the return route, the approach again, and a second mount.
- **Outputs:** `b33_survey_record.py` writes `<run>\SURVEY_RECORD.md`, a fixed, hashable record:
  - the drive rows;
  - the runway and mount results;
  - the SURVEY_WALKOFF fall, **printed and never counted**;
  - ROUTE OK or NOT OK.
- **Bounds on a changed route:** if the route must change, write a new route file and check it with `--route-new`. It may change only waypoints, arrive points, taps and calibration. Changing the location (x=+163, y 4450..4505), the kerb box, kerb_z or the walk-off yaw/hold is REFUSED. The judge never counts a survey fall (it is not in an M4 block).
Offline check of the plan (no game, no input, writes under the given folder): `... b33_drive.ps1 -Run <scratch folder> -Mode jumps -DryRun`.

## What a person must do (the tools never do these)

1. **Firewall prompt.** A new exe path may raise a Windows Defender Firewall "Windows Security Alert" when a client starts. The launcher detects it and says so in `LAUNCH_LOG.txt`. A PERSON closes it with the **X** button. **Never Allow.** The tools never click it.
2. **Hands off.** The drive waits for 60 s with no key or mouse event from anyone. It aborts at the first key or mouse event that is not its own, whether from a person or other software, and releases its keys. Nobody may type or move the mouse while it runs.
3. **Focus.** Leave an ordinary window focused before the drive starts, not the taskbar or Quick settings. The drive never forces focus past a shell surface.
4. **Frames (B7).** View each scenario's frames (`<run>\frames\f_<utc_ms>.jpg`; the judge lists each scenario's count and first and last file). Write what was SEEN per scenario next to the judge output. Check every frame for anything private, such as a system flyout, before it is kept.
5. **RAM.** The lease checks free RAM against 5.0 GB plus the reserve. Close other heavy apps.

## Rulings the tools implement (M2 ruling a185b283), and what the prereg still fixes

1. **Verdict analyser: BOTH (B-2), fixed.** The registered analyser is the bar.
2. **M4 under the bars (B-7), fixed:** air, landing and sinking over the whole M4 blocks.
3. **Rendering CVars and -forcelogflush.** The prereg fixes `-RenderCvars 'scalability 0'` and no -forcelogflush. The judge VOIDs any other ExecCmds set, and any undisclosed switch (B-5).
4. **Number of commanded jumps.** The default is 12 per scenario. The pass rule needs >= 7 counted jumps and >= 3 air episodes.
5. **Two fresh runs (B-6), fixed.** Every scenario, M4 included (5 qualifying falls under the bars), must PASS in BOTH runs.
6. **The route file and its hash,** after the survey addendum is ruled (B-9).
7. **The CONTROL (R-5, B-10).** The defaults clear only if (a) the control FAILs a jump scenario by a bar, (b) both judged runs PASS it, and (c) the founder's P7a look is recorded. Otherwise: revert, then a new governed build and fresh SC3 runs.
8. **The candidate (`CANDIDATE.json`).** The lead fills in z's governed-build values and sets `READY`. The file's new sha256 then goes into the prereg pin. Until then, nothing can launch and every judged run is VOID.

## Limits

- **Loopback only.** Both clients are on one machine; the timing assumes one wall clock.
- **The truth is the sender's ~7 Hz report chord**, as registered.
- **The loopback server is cbe584be's dev server.** It serves every route the client's world presence and dev session use. At 1e7cdebb these are: `/dev/session`, `/world/join`, `/world/state` (population and avatars in the answer), `/world/leave`, `/snapshot`, `/events`, `/presence`, `/voice/eos-client-config` (503: no EOS config), and `/profiles/:id`. See `server_check\ROUTES_cbe584be_vs_client_1e7cdebb.md`. It does NOT serve the 11 LFF 037 routes (`/lff/...`): they would answer 404. They are called only from the Social Hub's LFF view and the LFF QA module, which B33 never opens.
- **The drive never ran against the game.** It was checked in dry runs against a kinematic model: 12/12/12 jumps and five falls of 111.3 uu by the slicer's own rules, and the must-abort cases. The real-mode drive was run only to show that it refuses before any hook or input when the layout is missing or the game window is absent (tests L5/L6). The launcher's placement, the frames capture and the real-input path are parse-checked only; the layout checks are unit-tested (L1-L4).
- **The stop script's own-pid rule** was tested with two harmless sleeping processes.
- **Teleport detection** catches > 150 uu at > 2000 uu/s, or > 60 uu at > 1200 uu/s (R4-12). A smaller teleport would come from `wl.Dev.Tp`, which logs a WLDEV line, and that is VOID in either client's log.
- **ReportTimeSamples evidence** comes from the observer's own log (B-10). With 1, it writes a `rep` line for every newer report of a standing sender (a repeated position); with 0 it never does.
  - A CONTROL with such lines is VOID.
  - A JUDGED run without them, although the sender stood >= 2 s, is VOID.
  - v3.1 (R7-06): all three control values are also confirmed from the observer's own log by their bare `wl.X = "v"` echoes (exactly one each); any other `wl.*` echo is VOID.

## Assumptions not verifiable without the game (UI, keys, route)

**Keys** (RelayDogCharacter.cpp at 8c5c62cb/6347e19b):
- W = MoveForward plus OnForwardWPressed. LeftShift = run while held. SpaceBar = Jump.
- A second W press within 0.32 s starts a run, so the drive keeps presses >= 0.45 s apart.
- SendInput with scan codes reached the game in b33a.

**Mouse.**
- Mouse X = AddControllerYawInput. Assumed: positive dx turns right (yaw up). The calibration verifies the sign and measures the scale (v3.1d: it aborts only on a turn under 5 deg or the wrong way; the gains are clamped to 3.5..9.0).
- The prior of 4.207 counts/deg is from another build. The engine's constant factors give 6.86 counts/deg before smoothing (REHEARSAL_FINDINGS F28).
- The game must capture the mouse after the one click at the sender's client point (50%, 72% of the re-read client rect) or a fallback point. The drive checks that the cursor's window is the sender before every move.
- Pacing (v3.1d): moves are sent as 1 count every 2 ms, for calibration and for use alike, because the game smooths the mouse (F28). Assumed: the game reads raw-input deltas, so Windows pointer acceleration does not apply. The engine learns the mouse sample rate once per session, so nobody moves a mouse in the game window before the drive (a slow mouse's history makes the paced turns come out short until it relearns), and the pacing is not changed within a session.

**Movement.**
- While W is held, the movement direction is the control yaw (MoveForwardAxis). The logged yaw is the actor's (bOrientRotationToMovement).
- The drive steers by the measured movement heading. While standing, it turns only the camera.

**Spawn and runway.**
- Spawn is assumed at (-330,-650), yaw 56, as in b33a. The calibration walk assumes about 500 uu of open ground ahead.
- Runway x = 0, y 100..1900, is assumed clear. That is the research corridor, of recused-hint origin. A wall gives NO-PROGRESS: abort, no blind input.

**M4 approach.** v1 (research section 5): (0,1000) -> (0,2600) -> (0,3300) -> (180,3450) -> (180,4380). Rehearsal survey 1 (DEV harness, NOT-PREREG) walked v1 up to (0,3300) (the flight: z 9.4 -> 76.1) and to (149,3440) (z 91.5), then, turning while walking, swung east off the path's edge to the plaza slab (z -11.8): v1's corner fails. **Route v2 (PROPOSED, unverified between y 3447 and 4005):** (0,3300) -> (150,3440) -> (156,3700) -> (161,4005) -> (161,4380), every sharp corner taken standing; x ~161 is walkable from y 4005 to 4505 (DEV kerb survey, z 106 -> 113).

**Kerb** (survey v2, DEV teleports):
- Soles z 113.0 at x +163 (pawn x 161), y 4450..4505. A +x walk falls off it.
- The drive mounts by W taps from the south (a 17 uu step-up; MaxStepHeight 30).
- ON the kerb = 3 newest sender reports IDLE, z 106..121, x 140..186, y 4445..4505, from the sender's own `send motion ... z=` and `send soles` lines.
- If it is inside the kerb box within 30 uu of (163, 4468), or within 8 uu of it, without being ON the kerb, it stops: MOUNT-FAILED (v3.1: the old 30 uu rule also fired just outside the box).
- Walk-off: turn to yaw 0, hold W 1.2 s, never Space.

**Return route:** v1 (320,4300) -> (350,3400) -> (350,2600) -> (0,2600); v2 (315,4300) -> (318,3600) -> (350,3400) -> (350,2600) -> (0,2600), then the approach from (0,3300). The slab corridor x ~307-321 for y 3557..4264 was walked in rehearsal survey 1 (a wall to its west at x ~307); the rest is **a guess that nobody has walked.** Verify it with `-Mode survey -SurveyReturn -Route routes\b33_route_v2.json`.

**Observer frames.** The observer's camera at spawn is assumed to face the runway. The sender's figure may be small at 1-2.5 k uu. The capture reads the client rect every frame (about 940x1031 with the default layout).

**Window layout.** The default 960x1080 split assumes a primary desktop at least 1920x1080 physical pixels with its origin at (0,0) (the laptop is 1920x1200 at 125 %), and that the game keeps the size it is given (the lead verified it re-renders at 940x1031). If the game resizes itself later, the drive's once-a-second check aborts.

**Logs.**
- Without `-forcelogflush`, the log file is assumed to be flushed often enough (about 0.2 s) for the drive's 1.5 s freshness check (rehearsal survey 1: no STALE-LOG). `-ForceLogFlush` makes a run NOT the prereg launch, so the judge VOIDs it (R7-03); a STALE-LOG abort is a finding for the reviewer, not a reason to add the switch.
- The boot stub is assumed to start the game exe with the same command line (the `-userdir` match finds both pids). The judge reads `-ExecCmds` from the GAME's own `LogInit: Command Line:`. If the stub re-quoted or reordered it, the exact-set check would VOID the run. Test C9 proves the check only on the launcher's planned string fed in verbatim.
- An empty `-ExecCmds` entry (the old trailing comma) is assumed harmless in-game, but the judge now VOIDs it. The launcher no longer produces one (C8).
- The firewall prompt's title is assumed to be "Windows Security Alert" (English Windows).
