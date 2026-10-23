# Wonderland control path recovery (Claude Code workflow on Kaisin) — 2026-10-23 ~01:35 PDT
Read-only discovery. Nothing launched/built/moved/pushed. Only writes on Kaisin: %TEMP%\cosmo_cc_scan.txt and %TEMP%\cosmo_cc_cmds.txt (transcript grep output, <1 MB). Times are PDT unless marked Z.

## 0. State right now
- RAM free 2.27 GB of 15.7 GB. heavy-lease.py status: free_gb=2.24, lease=null. No Wonderland/UnrealEditor/node processes running.
- The largest consumer is Cosmo's own `git push ... 02c712d0:refs/heads/backup/wonderland/ledger-task3-be4af87f` (pid 43560, about 2.2 GB working set, started 01:19).
- C: free is about 17.4 GB.
- Every runtime tool gates on the shared heavy lease `C:\dev\iwonder\_qa_handoff\julius_readiness\landing\heavy-lease.py`: 3.0 GB for one-client runs, 5.0 GB for two-client runs, 6.5 GB "practice" for the B33 survey. **RAM is the only hard blocker today.**

## 1. Tools by category (all exist on disk)
### Launch
- Editor: `C:\dev\iwonder\wonderland-task3\wonderland\Tools\LaunchWonderlandEditor.ps1` (and `PlayWonderland.bat`, which uses an older channel path).
  - Launches `C:\Program Files\Epic Games\UE_5.8\Engine\Binaries\Win64\UnrealEditor.exe` (EXISTS) with the task3 `Wonderland.uproject`, map `/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2`.
  - Arguments: `-ForceEnablePython "-ExecCmds=r.Streaming.PoolSize 400, py Tools\editor_channel.py Tools\_channel" -nosplash -NoLiveCoding -ABSLOG=C:\dev\iwonder\recovery\_manifests\wl-live-editor-104.log`.
  - It first MOVES `Saved\Autosaves` into `C:\dev\iwonder\recovery\_autosave_quarantine`.
  - task3 Intermediate, DerivedDataCache and Binaries\Win64\UnrealEditor-Wonderland.dll are all still present.
  - The last `_channel` heartbeat is from 2026-09-30, so the editor path has not been used since about 09-30.
  - Claude Code command (2026-09-30 09:42 PDT): `Invoke-CimMethod Win32_Process Create CommandLine='powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\dev\iwonder\wonderland-task3\wonderland\Tools\LaunchWonderlandEditor.ps1"'` (detached through WMI).
- Packaged builds (no build needed), with both exe hashes re-verified today:
  - Governed candidate: `C:\dev\iwonder\_wonderland_beta_release\Wonderland_PrivateBeta_0.1.0-r16reh18` (790 MB, 91 files). Commit aa930c26. Game exe `Wonderland\Binaries\Win64\Wonderland.exe` sha256 df6b70c8… matches CANDIDATE.json. Boot exe `Wonderland.exe` aca06a16… matches.
  - Dev harness (accepts -wldev, wl.Social.Dev, wl.Dev.CmdFile): `C:\dev\iwonder\_wonderland_beta_release_wdev\Wonderland_PrivateBeta_0.1.0-wdevcmd2`. Its game exe was swapped per rehearsal; the ring rehearsal used a1bfc556 (c23h, commit 1599aa0c).
  - Older: `_wonderland_package_20260929\Windows\Wonderland.exe`, `C:\WLBetaClean\Wonderland_PrivateBeta_0.1.0-rc2`, and many r16rehNN packages under `_wonderland_beta_release`.
- Boot smoke: `wonderland-task3\wonderland\Tools\boot_test_package.ps1 -Exe <pkg>\..\Wonderland.exe -Out <dir>`.
  - Launches with `-windowed -ResX=1600 -ResY=900 -nosound -log -ExecCmds="wp.Runtime.ToggleDrawRuntimeHash2D"`, waits 75 s, takes a PrintWindow PNG, then kills the game.
  - It takes no lease.
  - Variants: `boot_test_package_qa.ps1`, `boot_test_package_perf.ps1`, and `_wonderland_beta_release\core_tools\core_qa_boot.ps1 -Pkg -EvDir -Suites ...` (in-game QA suites, no -wldev; Claude Code ran its `-SelfTest` on 10-12).

### Screenshot / frame capture
- `b33_frames.ps1`: CopyFromScreen JPEGs of the observer client while a CAPTURE flag exists, with `frames\index.csv`. Started by b33_launch.
- `core_tools\r16_075\core_r16_shot_r16v075.ps1 -Step S22 [-Client A|B|All] [-Burst 3] [-IntervalMs 2000] [-EvDir ...]`.
  - Uses `r16v075_frames_lib.ps1`: PrintWindow PW_RENDERFULLCONTENT from outside the game, no input or focus change, and `frames\FRAMES_LOG.txt` with a sha256 per frame.
  - This is the scored-run (prereg S-steps) frame tool. `r16v075_redact_frame.ps1` handles redaction.
- PrintWindow PNG inside `boot_test_package.ps1`. In-game `-wlframes` flag plus WLFRAME log lines (run_live_smoke and run_one_client_qa).
- Editor-side: `Tools\editor_jobs\offscreen_shots.py`, `camera_shots.py`, `zc_capture_anywhere.py` and others (462 jobs). You drop them into `Tools\_channel\inbox\`.

### Input / player control (real OS input)
- `tools\b33_v3_1b\b33_drive.ps1 -Run <folder> -Mode jumps|m4|survey|calibrate|all [-SurveyReturn] -Route routes\b33_route_v11.json`.
  - Drives the SENDER through SendInput (`b33_native.cs`), with mouse calibration, route following and drop/off-path guards.
  - It starts only after 60 s without human input and aborts on any real input.
- `tools\b35_v5_3_3\b35v4_drive.ps1 -Run <folder> [-Cases H,BV,BO] [-Cells ...]`. Uses SendInput through `win_input.psm1`, with OCR target finding and console typing. Covers the privacy cells.
- `core_tools\core_drive.ps1 -Exe -Out -Plan <plan.txt> -UserDir -EndWaitSec`. Generic SendInput plan driver with injected-flag detection of human input. Used for R3/R4/R5 and hub exploration (Claude Code, 10-06: `& .\core_drive.ps1 -Exe ...r16reh8\Wonderland.exe -Out ...r16_reh8_core\hub_explore_signed_out -Plan plan_r16reh_hub_explore_signed_out.txt -UserDir ... -EndWaitSec 60`).
- `_qa_handoff\integration\r16reh15_20261016\mp_conductor.ps1 -Direction 1|2 -Out <csv>`. An on-screen phase strip for HUMAN-driven two-client sessions; it sends no input.

### Unreal automation / console / runtime control
- Editor: `Tools\editor_channel.py` is a persistent channel. Any `<channel>\inbox\<name>.py` runs on the game thread (job() generators supported). Results land in `<channel>\done\<name>.json` and a `heartbeat.json`. `editor_jobs\quit_editor.py` closes it.
- Packaged dev harness: `-ExecCmds="scalability 0,wl.Social.Dev <id> http://127.0.0.1:<port>,wl.Dev.CmdFile <cmds.txt>"`. Lines you append to cmds.txt run as console commands, e.g. `wl.Social.Hub recent`, `quit`. QA commands: `wl.Qa.SocialGate`, `wl.Qa.SocialLive`, `wl.Qa.Social player`.

### Two-client / multiplayer / party-join
- `tools\run_two_client_smoke.ps1 [-Label] [-GateGB 5] [-Port 8797] [-Package wdevcmd2] [-ServerTree C:\dev\iwonder\wonderland-integration-sprint]`.
  - Runs a lease, bundles `relay-bridge\dev-social-server.ts` with esbuild, and runs it on 127.0.0.1.
  - Launches two wdevcmd2 clients side by side (940x1031) with userdirs inside the run folder.
  - Waits for `WLWORLD joined` on both, sends quit, then writes KEY_LINES and SHA256SUMS.
  - It is DIAGNOSTIC, never evidence.
  - Claude Code ran it on 2026-10-20 at 2:43 PM PDT: `Start-Process powershell -ArgumentList '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','"...\tools\run_two_client_smoke.ps1"','-Label','two_client_c15_a82b2a5d','-RunRoot','"...\dev_notes\c6_logs"' -WindowStyle Hidden`.
- `tools\run_live_smoke.ps1` (one client plus the dev server, with a StepsFile of `<console>|<wait>`) and `tools\run_one_client_qa.ps1 -Label -Cmd "wl.Qa.SocialGate"`.
- B33 two-client movement conductor: `tools\b33_v3_1b\b33_launch.ps1`. It holds the lease, refuses unless CANDIDATE.json is READY and the exe hashes match, runs a git-archived relay, launches SENDER and OBSERVER, places the windows, starts the frames, and writes RUN.json. It is paired with `b33_stop.ps1 -Run` and `b33_judge.py`. `b33_survey_record.py <run> --route-new routes\b33_route_v11.json` checks the route.
- B35 privacy two-client conductor: `tools\b35_v5_3_3\b35v4_launch.ps1 -Case <c> [-Mutation] -FounderAck <ack file>`. It needs a founder ack no older than 30 min for each launch. It runs the RTT proxy and budgeted social server, and is paired with `b35v4_stop.ps1` and `b35v4_judge.py`.
- Older scripts:
  - `_qa_handoff\social\run_social_two_clients.ps1 -Sha <..> [-Bed C:\WLBetaClean\...rc2] [-Durable]` (wl.Qa.SocialLive kai/nova, with PostgreSQL restart mode).
  - The r16reh15 mp_* set (`mp_launch_client.ps1`, `mp_launch_client_low.ps1`, `mp_tile.ps1`, `mp_judge.py`).
  - The scored-run client launcher `core_tools\r16_075\r16v075_launch_client_r3_2.py` (TF-5, MEM_RESERVE gate, current Windows account).
- Rehearsal copies actually used on 10-21: `dev_notes\REHEARSAL_NOT_PREREG_b33_tools\` and `dev_notes\REHEARSAL_NOT_PREREG_b35_tools\`.

### Evidence hashing / packaging
- Every runner writes `SHA256SUMS.txt` / `SHA256SUMS_AT_CLOSE.txt`, plus RUN.json and RUN_CLOSE.json with log sha256s.
- `tools\hash_folder.sh`.
- `core_tools\r16_075\core_r16_final_manifest_r16v075_r3_1.py` and `SC6_prereg\tools\tf4_r3_4a\core_r16_final_manifest_r16v075_r3_4a.py` (final manifest), and `r16_step_judge_r16v075_r3_4a.py` (step judge).
- Reviewer tools: `_independent_review_20261020\R16_LOOP_20261020\tools_reviewer\rv_r16_ringrecord_v3.py`.
- Package baseline: `R16_LOOP_20261020\REVIEWER_BASELINE_r16reh18_PACKAGE.sha256` (91 files, list 775ce9a5).
- `core_tools\r16_075\r16v075_ram_clearance_r2_1.ps1` and `r16v075_ram_monitor_*_r2_1.ps1` (RAM gates).

### Secret-referencing paths (noted, NOT opened)
- `_wonderland_beta_release\o1_hosted\windows_kit_r2_2\w5_secrets_stdin.py`
- `o1_hosted\deploy_*\e2_token*`
- `GO_SECRETS_W5_DRAFT*`
- `~\.claude\settings.local.json`

## 2. Most recent successful runtime runs
- **B35 dry rehearsal 19.** 2026-10-21, 1:44–2:14 PM PDT, on the GOVERNED r16reh18 package (df6b70c8) with the ring relay 98a674bd.
  - Result: 39/39 cells clean, 0 backfill hits. The package matched the baseline 91/91 before and after.
  - Folder: `_qa_handoff\integration\r16reh16w_submission_20261020\dev_notes\REHEARSAL_NOT_PREREG_b35_runs\DIAGNOSTIC_b35v5_dry19_NOTPREREG_20261021T204410Z` (336 MB).
  - Record: `..\REHEARSAL_DRY19_RECORD.md`. SUMS sha256 94288901….
- **B33 ring composition.** 2026-10-21, 07:50–08:07 PDT, two wdevcmd2 clients (c23h).
  - STAND/WALK/RUN/M4 shown as PASS, 8 of 10 M4 attempts qualifying. VOID as NOT-PREREG.
  - 946 frames. Closed cleanly and the lease was released.
  - Folder: `dev_notes\REHEARSAL_NOT_PREREG_b33_runs\DIAGNOSTIC_NOTPREREG_b33_all_20261021T145001Z` (121 MB).
  - Records: `RING_REHEARSAL_1_RECORD.md` and `B33_REHEARSALS_RECORD.md`.
- **SURVEY r18 (b33_v3_1b on r16reh18): NOT STARTED.** On 10-21 at 3:29 PM PDT it was stopped by the RAM precondition (5.09 GB free against the 6.5 GB practice gate). See `dev_notes\REHEARSAL_NOT_PREREG_b33_runs\SURVEY_r18_RECORD.md`.

## 3. Gate mapping (R16_075_ACCEPTANCE_CHECKLIST_v1 / READINESS_GAPS)
- b33_* (launch, drive, frames, judge, survey_record) → B33 (the peer moves on the viewer's screen) and B32 (see each other), which is gap step 5 (M2c) and SC3 (control plus 2 judged runs). Next on the critical path: SURVEY r18, then ROUTE_PIN, then the RELAY_PIN PINNED after the O1 post-deploy gate.
- b35v4_* → B35 privacy enforced, B36 block, P1–P5 (section D). Gap steps 5 and 8 (the B35 judge pin) and SC4 (run1, run2, mutant). Each launch needs a founder ack.
- b14b18 rehearsal (`rehearse_b14b18_diag.ps1`, `b14b18_judge.py`, `FOUNDER_CLICK_SCRIPT_B14_B18.md`) → presence states B12–B22 (B14, B18).
- run_two_client_smoke / run_live_smoke / run_one_client_qa → B31 (same context, `WLWORLD joined`), B41 (hub), SC2 (world report fields). These are DIAGNOSTIC only.
- core_r16_shot / frames_lib / r16v075_launch_client_r3_2 / final_manifest / step_judge / ram_clearance → the scored run itself (A5, A8, A13, the S-steps), gap steps 11–14.
- core_qa_boot / boot_test_package_qa → package boot, R3/R5 QA, PR-2 boots.
- core_drive → R3, R4, R5 player-path gates.
- Editor channel → content/world work (R1–R15 era); not an R16 gate.

## 4. Minimal next run (no build)
Do this in order:
1. **Now (no RAM needed, starts nothing, takes no lease):** from `tools\b33_v3_1b`, run
   `powershell -NoProfile -ExecutionPolicy Bypass -File b33_launch.ps1 -Scenario survey -Package C:\dev\iwonder\_wonderland_beta_release\Wonderland_PrivateBeta_0.1.0-r16reh18 -Commit aa930c26 -RelaySource <clean worktree at 3f20fc1a> -RelayCommit 3f20fc1ace7b157d4ff2673959c98998564ef43b -RenderCvars 'scalability 0' -DryChecks`
   Then re-check the package against the baseline: 91 files, 775ce9a5.
2. **SURVEY r18** (reviewer conditions in `README_b33_v3_1b.md`, ruling 30877f). Use the same command without -DryChecks, then:
   - `b33_drive.ps1 -Run <abs folder> -Mode survey -SurveyReturn -Route routes\b33_route_v11.json` (about 4 min, after 60 s idle);
   - `b33_stop.ps1 -Run <folder>`;
   - `python -I -B b33_survey_record.py <folder> --route-new routes\b33_route_v11.json`.
   - Output goes to `NOT_COUNTED_b33\REHEARSAL_NOT_PREREG_b33_survey_<utc>`.
   - Needs: lease ≥5.0 GB and about 6.5 GB of free RAM (two clients at about 2–3 GB each plus node); about 0.15–0.35 GB of disk; about 10 min of wall time; no human touching the mouse or keyboard.
- Fallback smoke if RAM stays low: `tools\run_one_client_qa.ps1 -Label <x> -Cmd "wl.Qa.SocialGate"` (lease 3.0 GB, one wdevcmd2 client). It is diagnostic only.

## 5. Real blockers
1. **RAM.** 2.27 GB free now, against 5.0/6.5 GB needed. Cosmo's own git push holds about 2.2 GB, so wait for it to finish; OneDrive, Edge and the Grok processes also use some.
2. **A clean worktree at 3f20fc1a is needed for -RelaySource.** Creating one is a git write; the README calls it a founder/lead action. Seven detached 3f20fc1a worktrees exist under `_qa_handoff\julius_readiness\followon_100\p3_dev_20261020\wt_*`, but they are YUJI's and their cleanliness was not checked. The `_wdev_r18_ring_relay` worktree exists, but it is at 98a674bd (the PR head), which is not legal for the survey.
3. RELAY_PIN.json is PENDING. COUNTED B33 runs are refused until the reviewer pins it after the O1 post-deploy gate. ROUTE_PIN is PENDING until the survey.
4. B35 counted runs need a founder ack (R12-05) no older than 30 min for each launch. The SendInput drives need the founder away from the PC.
5. None of the scripts are missing or broken. UE 5.8, both packages, node, python, esbuild, heavy-lease.py and pristine node_modules are all present.
