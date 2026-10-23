# Evidence: Wonderland B33 survey rehearsal REHEARSAL_NOT_PREREG_b33_survey_20261023T093602Z

**NOT-PREREG. NOT COUNTED. Not a readiness gate.** This branch is a byte-exact backup of developer evidence from Kaisin so that a ROUTE_PIN proposal can quote hashes that live on GitHub. The judge ruled the run VOID (exit 4). Wonderland readiness stays 56.25%.

Parentless docs-only commit. Nothing here is code, and nothing here is merged anywhere.

## What ran

- Role: `REHEARSAL_NOT_PREREG`, scenario `survey`, `counted: false`, `prereg_launch: false`.
- Game build commit: `aa930c269c43a52fc31c785f7bdcc231c8af6cf0` (tree `ea35bd37142f671817fa9262fbad7981de45b5f5`). **This commit exists only on Kaisin (local, not pushed to GitHub at the time of writing).** Game exe sha256 `df6b70c832f8983a30d09d814092d7839df467232f760694e2723987669b658d`, boot exe `aca06a168f64470e24473b05257ee81d1b546d58282b8e273418a59d9cbb1edd` (both = `tools\b33_v3_1b\CANDIDATE.json`).
- Tool / relay commit: `3f20fc1ace7b157d4ff2673959c98998564ef43b` (tree `75a61ea2721429a4c7f0849ecc6fffec9e8f6e7f`), on GitHub `sunday-relay` main. The relay ran from `git archive` of that commit via `-RelaySource` from a clean detached worktree (`C:\dev\iwonder\_b33_relay_wt_3f20fc1a_20261023`).
- Route: `routes/b33_route_v11.json`, sha256 `7de04985b6db89989b5ed8063972c2b143f3c45b4be8577d8c3b9917c390405b` (copied from `tools\b33_v3_1b\routes\`; byte-equal to the drive's own copy `drive_survey_20261023T093723Z/route.json`).
- Survey record: `SURVEY_RECORD.md` sha256 `f783ad773d17250522fced4d4d890a75af814977d1ad6f0f46e6f12c33a1f185`, ROUTE OK. 141 frames captured.

## Layout

- `routes/b33_route_v11.json` - the route the drive used.
- `run/REHEARSAL_NOT_PREREG_b33_survey_20261023T093602Z/` - the run folder, byte-exact, all 141 frames included (~16.2 MB of JPGs), minus 2 excluded files (below).
- `run/.../SHA256SUMS_AT_CLOSE.txt` - the launcher's ORIGINAL close-time sums (12 entries), **byte-unchanged** (sha256 `705502ecf56a949b06edd2b3fc621236c02814fb40b07acf3a8fd28a1b414f20`).
- `run/.../SHA256SUMS_runfolder_WRITTEN_AFTER_CLOSE_20261023T100521Z.txt` - sha256 `aa66b7167f1684d7f66a73995aad8cc098a31c89eaab5f145e6771d6992c48e4`. **Written AFTER close** (timestamp in its name and header line); it is **not** close-time coverage. It covers ALL 174 files of the run folder on Kaisin, frames and `SURVEY_RECORD.md` included. Its first line is a `#` header; use `grep -v '^#' FILE | sha256sum -c` (forward-slash paths, run from the run folder).
- `scratch_run2/` - the agent's scratch for this run: `JUDGE.txt`, `JUDGE.json`, `JUDGE.err`, `commands.log`, `RAM_TIMELINE_cosmo.tsv`, `ram_precheck.tsv`, console logs, and an older post-close `SHA256SUMS_runfolder.txt` (174 entries, unnamed predecessor of the file above).
- `prelaunch_T090738Z/` - the earlier DryChecks folder and the RAM blocker record (F4).
- `SHA256SUMS.txt` - sums over every other file on this branch.

## Excluded (by path only)

- `run/.../observer/Saved/Config/CrashReportClient/UECC-Windows-5F9A4079426046932C6B15A30D0D70D9/CrashReportClient.ini` (Config folder rule)
- `run/.../sender/Saved/Config/CrashReportClient/UECC-Windows-FC52EDF54E4AD36EFCD9AEB6C5D453D5/CrashReportClient.ini` (Config folder rule)

Both are still hashed in the post-close run-folder sums. The secret scan (private keys, sk-/xai-/gh*_/AKIA/JWT/Bearer, key=value password/secret/token/api-key, Authorization/Cookie, .env-style lines, and secret file names) found no matches in any included file. Only path names in `relay_archive_files.txt` contain words such as "secret", and those are file names, not values.

## Notes (Skywalker's findings F1-F5, stated honestly)

- **F1 - close-time coverage is partial.** `SHA256SUMS_AT_CLOSE.txt` (written 2026-10-23T09:42:21.8Z) covers only 12 files. It does NOT cover the 141 frames or `SURVEY_RECORD.md`. `SURVEY_RECORD.md` was written at 09:42:27.5Z, about 6 s after close, even though it says it was "hashed with the run". The frames and the record are covered only by sums written after close (`SHA256SUMS_runfolder_WRITTEN_AFTER_CLOSE_20261023T100521Z.txt` here and `scratch_run2/SHA256SUMS_runfolder.txt`). `JUDGE.*` exists only in scratch.
- **F2 - not the pinned relay. The judge's three VOID reasons, verbatim:**
  1. `RUN.json prereg_launch is false: the launch is not the PREREG B33 v3.1 launch (b33_launch.ps1 printed a NOTE; R7-03)`
  2. `NOT-PREREG server (b33_launch.ps1 -ServerTree / -RelaySource): the loopback server is not the pinned relay's own dev-social-server.ts`
  3. `RELAY_PIN.json (C:\dev\iwonder\_qa_handoff\integration\r16reh16w_submission_20261020\tools\b33_v3_1b\RELAY_PIN.json) is not PINNED with a 40-hex commit and tree (status 'PENDING'): no run is judged against a pending relay pin`

  The server was `3f20fc1a`'s own `relay-bridge/dev-social-server.ts`, launched through `-RelaySource` while `RELAY_PIN.json` is PENDING. `RUN.json`'s `label` still says `server override -ServerTree` even though the run used `-RelaySource` (a wording defect in the launcher; `server.kind` says `-RelaySource` correctly).
- **F3 - 2 files not copied.** The 2 `CrashReportClient.ini` files were not copied to scratch (172 of 174), and they are excluded here as well (Config rule). They are hashed in the post-close sums.
- **F4 - an earlier pre-launch refusal.** `REHEARSAL_NOT_PREREG_b33_survey_20261023T090738Z` (09:07:38Z) is a DryChecks folder ("inputs valid; nothing started"). The launch after it was withheld because free RAM was under the founder's 6.5 GB condition (5.83-5.97 GB free, `prelaunch_T090738Z/scratch/BLOCKER_RAM.txt`). The aborted live attempt `...T091807Z` (input-guard abort, 0 frames) is preserved on Kaisin and is not copied here.
- **F5 - build commit local only.** `aa930c269c43a52fc31c785f7bdcc231c8af6cf0` exists only on Kaisin. Counted B33 runs also need `RELAY_PIN.json` moved to PINNED by the reviewer.