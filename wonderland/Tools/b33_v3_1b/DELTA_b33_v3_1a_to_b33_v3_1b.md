# DELTA b33_v3_1a -> b33_v3_1b (WONDERLAND_DEV, 2026-10-21; reviewer message 30877f)

`tools\b33_v3_1a` (SUMS `75cbc30d85b3bd6225c6edabc9bed3099a3863a716335a55dfa41f1cc26c590d`, 63 files, mailed) stays FROZEN. `tools\b33_v3_1b` is a byte copy of those 63 files (checked with `sha256sum -c` against the 1a SUMS: 63/63 OK before the two edits below) EXCEPT:

| File | v3.1a sha256 | v3.1b sha256 | Change |
|---|---|---|---|
| `CANDIDATE.json` | `9be2b062b12e7c47ff068843ea727dda7cc39f1c8a7cdfe8efae5836c84de5a5` | `f4521fbbc738f7bb166cee776feac932d59c4bf04ad368ca84aaa3cbbc754930` | status `PENDING r16reh18` -> `READY`; commit, tree, game_exe_sha256, boot_exe_sha256, package_folder filled; extra informational fields added (zip_sha256, zip, branch, build_record(+sha), governed_record(+sha), governed_build_record_md_sha256, reviewer_baseline(+list sha, file count)); `pending_note` replaced by `status_note` |
| `RELAY_PIN.json` | `1f9138f684bfca2dbb83e98b7a0c0e95d1ee4c6ff2ae378608a885465f11cc80` | `0dca429651ee2aa99a3af69ce1b47b6ab935ff967341060c87a740468b92b51c` | the B35 v5.3.3 approach: commit `3f20fc1ace7b157d4ff2673959c98998564ef43b`, tree `75a61ea2721429a4c7f0849ecc6fffec9e8f6e7f`, parent `2528ac5c0f0d4303051123a7592ef18e3552ba74` filled; status STAYS `PENDING` (only the reviewer sets PINNED after the O1 post-deploy gate) |

`ROUTE_PIN.json` is UNCHANGED (PENDING, empty route fields). No tool, test, route, or output file was edited.

New files: this DELTA, `DIFF_b33_v3_1a_to_b33_v3_1b.diff` (exactly the two files above), `README_b33_v3_1b.md`, `SHA256SUMS.txt`.

Fields of CANDIDATE.json the launcher/judge read (b33_launch.ps1 lines 102-122; b33_judge.py lines 193-206, 888-940): `status` (must be exactly `READY`), `label`, `commit`, `game_exe_sha256`, `boot_exe_sha256`, `package_folder`. The tool defines no other status word; READY is its own word. The rest is for the reviewer's exact-field check.
