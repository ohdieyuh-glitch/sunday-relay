# B33 tools v3.1b (tools\b33_v3_1b)

DIAGNOSTIC tools, WONDERLAND_DEV, not evidence by itself. Built 2026-10-21 offline (no run, no launch, no network), at the reviewer's request (message 30877f, Q3 ruling). `README_B33_TOOLS.md` is carried byte-identical from v3.1a and still describes every tool; this file only states what v3.1b changes. The file-by-file change is `DELTA_b33_v3_1a_to_b33_v3_1b.md`; the diff is `DIFF_b33_v3_1a_to_b33_v3_1b.diff`.

## What changed

- `CANDIDATE.json` is **READY** for 0.1.0-r16reh18 (the only word the launcher and the judge accept). Values, each re-read from disk/git today (read-only):
  - commit `aa930c269c43a52fc31c785f7bdcc231c8af6cf0`, tree `ea35bd37142f671817fa9262fbad7981de45b5f5` (`git rev-parse <commit>^{tree}`);
  - game exe `Wonderland\Binaries\Win64\Wonderland.exe` sha256 `df6b70c832f8983a30d09d814092d7839df467232f760694e2723987669b658d`;
  - boot exe `Wonderland.exe` sha256 `aca06a168f64470e24473b05257ee81d1b546d58282b8e273418a59d9cbb1edd`;
  - zip sha256 `a5064a814e2344ed90be26d9b8ae96384fcc5890702d71564e609496f4222f50` (informational; no tool reads it);
  - package folder `C:\dev\iwonder\_wonderland_beta_release\Wonderland_PrivateBeta_0.1.0-r16reh18`;
  - reviewer baseline `REVIEWER_BASELINE_r16reh18_PACKAGE.sha256`: 91 files, list sha256 `775ce9a504713a6f224a4c3442df0c7c43ba8ab2f7f66d851f2461319b81e762` (775ce9a5); the package on disk matched 91/91 today.
- `RELAY_PIN.json`: commit `3f20fc1ace7b157d4ff2673959c98998564ef43b` / tree `75a61ea2721429a4c7f0849ecc6fffec9e8f6e7f` / parent `2528ac5c...` filled, status **PENDING** (the B35 v5.3.3 approach; v3.1a has the same slot).

## Offline tests (scratch copy, python -I -B tests\test_b33.py)

99 tests: 97 OK, 1 skipped (no rehearsal runs folder in the scratch copy), 1 FAIL: `Pins.test_shipped_candidate_relay_and_route_slots_are_pending`, which asserts that the shipped CANDIDATE.json status starts with PENDING. That failure is the intended consequence of READY (the test is unchanged and was written for the PENDING slot); no other test is affected. The PowerShell test script was not run (it exercises launcher/stop fixtures).

## Still pending

- `RELAY_PIN.json` PENDING -> PINNED: only the reviewer, after the O1 post-deploy gate. Until then every COUNTED launch is refused and the judge VOIDs every run.
- `ROUTE_PIN.json` PENDING (unchanged): filled after the survey, as a NEW tools folder version plus a new prereg version (never in place). That fill must name the survey record, its role (REHEARSAL_NOT_PREREG), and the reviewer's ruling id 30877f (M20261021T222157Z-INDEPENDENT_REVIEW-30877f).
- The reviewer's exact-field check of CANDIDATE.json against git and the baseline.
- Windows/founder start for the survey (10 min), control (12), judged runs (27 each, x1.25 later): not scheduled here.

## How the -RelaySource route survey is launched (reviewer's 4 conditions, 30877f)

1. **Relay source = the MERGED main commit 3f20fc1a, never the PR branch (98a674bd).** The launcher's `-RelaySource` is a git WORKTREE (it refuses a path without `.git`) and `-RelayCommit` is required with it (`-RelayCommit 3f20fc1ace7b157d4ff2673959c98998564ef43b`). The relay bytes that run are `git archive 3f20fc1a -- relay-bridge src package.json`, never the worktree's working files, but the launcher records `worktree_head`, `head_is_relay_commit` and `worktree_clean` in RELAY_SOURCE.json: so use a clean worktree whose HEAD IS 3f20fc1a (a detached `git worktree add` of that commit; a git write, founder/lead action, not done here), so the record reads head_is_relay_commit true / clean true. The `package-lock.json` blob of 3f20fc1a must also equal the one in `-NodeModulesFrom` (the launcher refuses otherwise).
2. **Governed exe df6b70c8 (boot aca06a16) from the package whose 91 files equal baseline 775ce9a5**: `-Package` must be the `package_folder` above and `-Commit aa930c26` (>= 7 chars); the launcher hash-checks both exes against CANDIDATE.json. Re-check the 91 files against the baseline just before (`sha256sum -c` from inside the package folder). Do the Saved check of SC4 step 3.0 first if the same machine profile is used.
3. **OQ-3 conditions stand**: route v10 -> v11 differs by the single z-hint change ((0,2908) descent z hint 26.8 -> 20.0, P79); survey after the firewall and the reviewer's baseline; outside the counted folder; the route is chosen on the survey only, with the v1 bounds (b33_survey_record.py checks the route against the pinned v1, sha256 788f2015...; `--route-new routes\b33_route_v11.json`).
4. **Role REHEARSAL_NOT_PREREG** (see next section).

Command shape (do not run from here): `b33_launch.ps1 -Scenario survey -Package <package_folder> -Commit aa930c26 -RelaySource <clean worktree at 3f20fc1a> -RelayCommit 3f20fc1ace7b157d4ff2673959c98998564ef43b ...` with the drive `-Mode survey` and the route v11; then `python -I -B b33_survey_record.py <run folder> --route-new routes\b33_route_v11.json`.

## What the pinned b33_survey_record.py does with the REHEARSAL_NOT_PREREG role (read-only check)

- The launcher gives a `-RelaySource` run the role REHEARSAL_NOT_PREREG (b33_launch.ps1 line 150: it wins over SURVEY), writes it to `NOT_COUNTED_b33\REHEARSAL_NOT_PREREG_b33_survey_<utc>`, and the judge's run listing excludes it.
- `b33_survey_record.py` **never reads the role**. It takes the run folder, needs `drive_survey_*\timeline.csv` and `route.json` (non-DRYRUN), reads RUN.json only for `exe_sha256` and the sender log path, and decides ROUTE OK from a completed SURVEY_RUNWAY block, an ON_KERB row, no ABORT (and a second ON_KERB after a SURVEY_WALKOFF). The role, the folder name, RELAY_SOURCE.json and the relay pin are not examined, so it **accepts** the run; it prints no role and does not check the exe against CANDIDATE.json (the launcher already did).
- `ROUTE_PIN.json` consumers (b33_drive.ps1 live m4/all gate; b33_judge.py lines 1007-1014) test only `status == PINNED` and a 64-hex `route_sha256` (the drive also hashes `-Route`). They do **not** open `survey_run` / `survey_record` / `survey_record_sha256`, and nothing validates the survey's role. So a ROUTE_PIN fill naming this survey is accepted mechanically; the role is carried only in the text of the fill, which is why the fill must state it plainly (survey folder name, record sha256, role REHEARSAL_NOT_PREREG, ruling 30877f).
- Consequence for the reviewer's proviso ("PROVIDED the pinned b33_survey_record.py accepts it"): it does, because the tool is role-blind. No tool change is needed or made.
