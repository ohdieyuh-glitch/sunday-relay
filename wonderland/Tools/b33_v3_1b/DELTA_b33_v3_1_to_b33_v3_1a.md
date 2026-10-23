# DELTA: tools\b33_v3_1 (B33 v3.1, mailed, FROZEN) -> tools\b33_v3_1a (B33 v3.1a)

DIAGNOSTIC, W2DEV, written 2026-10-21T13:53:32Z by make_delta_v31a.py (computed from the files, not transcribed). Offline: no run was made with v3.1a.

- Ruling: M20261021T133546Z-INDEPENDENT_REVIEW-7a7faf (HOLD, narrow). The judge carried the rulings; v3.1a adds P87 (P2-1 (a)), P88 (P2-2),
  P89 (P2-4) and P90 (the NITs). Every item: `PATCH_LIST_v3.1.md`, section v3.1a.
- `tools\b33_v3_1` (SHA256SUMS 4f4ae6fe) and `tools\b33` (fa748d6d) are unchanged. v3.1's prereg draft (c0f0e255) is unchanged; v3.1a's is
  `M2c\PREREG_B33_PRECONDITION_v3_1a_DRAFT.md`.
- No bar, window, threshold, analyser or slicer changed: 10 / 2 / -2.0, 1.6 s, 7 jumps, 3 episodes, 5 falls, the gates.

## Every file

| file | status | b33_v3_1 sha256 | b33_v3_1a sha256 | what changed |
|---|---|---|---|---|
| `CANDIDATE.json` | same | 9be2b062b12e | 9be2b062b12e |  |
| `DELTA_b33_to_b33_v3_1.md` | not carried | 9c4d8e4e6aa4 | - | v3.1's delta (v3 -> v3.1); it stays in tools\b33_v3_1 (its own row could not match its hash: 7a7faf NIT) |
| `DELTA_b33_v3_1_to_b33_v3_1a.md` | NEW | - | see SHA256SUMS | NEW: this note (its own hash: see SHA256SUMS) |
| `PATCH_LIST_v3.1.md` | CHANGED | f7f1d17ca511 | 12c5937a5bc6 | the v3.1a section: P87-P90 |
| `README_B33_TOOLS.md` | CHANGED | c1062c4f23fa | 16693ce394b3 | P90: the command lines point to tools\b33_v3_1a\; the v3.1a header |
| `REHEARSAL_FINDINGS.md` | same | 23db9a357dea | 23db9a357dea |  |
| `RELAY_PIN.json` | same | 1f9138f684bf | 1f9138f684bf |  |
| `ROUTE_PIN.json` | CHANGED | db9ba9a5eed5 | 311fee13c164 | 7a7faf P2-3: option (a) is acceptable only if the r16reh18 source changes no world or map content (reviewer, T3); filling the slot = a new version |
| `b33_analyser/MOTION_DIAG_W2_DIFF.md` | same | 11aaabe4fc8b | 11aaabe4fc8b |  |
| `b33_analyser/PROVENANCE_motion_diag.md` | same | 748e12d87a8d | 748e12d87a8d |  |
| `b33_analyser/motion_diag.py` | same | 4dee34d04a36 | 4dee34d04a36 |  |
| `b33_analyser/motion_diag_w2.diff` | same | 4ac2d19587c6 | 4ac2d19587c6 |  |
| `b33_analyser/motion_diag_w2.py` | same | 176e273ae38e | 176e273ae38e |  |
| `b33_drive.ps1` | same | a1fa03037b05 | a1fa03037b05 |  |
| `b33_frames.ps1` | same | 3779dcaf0e96 | 3779dcaf0e96 |  |
| `b33_judge.py` | CHANGED | 2ecc8b732dd5 | 4caddf0b34b7 | P87 (M4 replacement only for 'fewer than 5 qualifying falls'), P88 (the run listing excludes never-counted runs), P89 (the RAM record); the algebra no longer names v3's 'PENDING z' and 120/1/1 as current |
| `b33_launch.ps1` | CHANGED | dac4260ad2d1 | f20b5fb52cf2 | P88 (-NotCountedRoot; SURVEY_b33_* / REHEARSAL_NOT_PREREG_b33_* outside the counted folder; role, counted), P89 (lease >= 5.0 enforced; the in-run guard 1.1 GB; RAM_LOG.json) |
| `b33_layout.ps1` | same | 08132896a49c | 08132896a49c |  |
| `b33_native.cs` | same | 4283fed15e2f | 4283fed15e2f |  |
| `b33_slicer.py` | same | 5997f82c5493 | 5997f82c5493 |  |
| `b33_stop.ps1` | same | c30f3b80348e | c30f3b80348e |  |
| `b33_survey_record.py` | same | c2adf105ba1d | c2adf105ba1d |  |
| `b6_b33a_reanalysis/B6_RECORD.md` | same | c7460ebad73b | c7460ebad73b |  |
| `b6_b33a_reanalysis/JUDGE_b33a.json` | same | 79d05e6c32f9 | 79d05e6c32f9 |  |
| `b6_b33a_reanalysis/JUDGE_b33a.txt` | same | 5a7687fac76e | 5a7687fac76e |  |
| `b6_b33a_reanalysis/JUDGE_b33a_v3_1.json` | same | de7e37580d15 | de7e37580d15 |  |
| `b6_b33a_reanalysis/JUDGE_b33a_v3_1.txt` | same | 6d495e6910d5 | 6d495e6910d5 |  |
| `b6_b33a_reanalysis/REGISTERED_CLI_STANDING_span1_shift0.txt` | same | feeef048b473 | feeef048b473 |  |
| `b6_b33a_reanalysis/REGISTERED_CLI_WALKING_span1_shift0.txt` | same | 0ed867af25e4 | 0ed867af25e4 |  |
| `b6_b33a_reanalysis/REGISTERED_CLI_WALKING_span2_shift0.txt` | same | 80b0c31fee85 | 80b0c31fee85 |  |
| `b6_b33a_reanalysis/SHA256SUMS.txt` | same | 1e761875feea | 1e761875feea |  |
| `b6_b33a_reanalysis/W2_CLI_STANDING_span1.txt` | same | f589608e55ec | f589608e55ec |  |
| `b6_b33a_reanalysis/W2_CLI_WALKING_span1.txt` | same | 9172a2b20e27 | 9172a2b20e27 |  |
| `b6_b33a_reanalysis/W2_CLI_WALKING_span2.txt` | same | 4c17700f6416 | 4c17700f6416 |  |
| `b6_b33a_reanalysis/b33a_timeline.csv` | same | 07db29552436 | 07db29552436 |  |
| `b6_b33a_reanalysis/make_b33a_timeline.py` | same | 1007c2965172 | 1007c2965172 |  |
| `b6_b33a_reanalysis/registered_selftest_output.txt` | same | 8ff51d9e18a6 | 8ff51d9e18a6 |  |
| `b6_b33a_reanalysis/slicer_b33a.json` | same | a966a58d3f32 | a966a58d3f32 |  |
| `b6_b33a_reanalysis/slicer_b33a.txt` | same | 31eb809f346a | 31eb809f346a |  |
| `b6_b33a_reanalysis/slices/STANDING_span1_sender.log` | same | bde9ad2e4b79 | bde9ad2e4b79 |  |
| `b6_b33a_reanalysis/slices/STANDING_span1_viewer.log` | same | 186404288250 | 186404288250 |  |
| `b6_b33a_reanalysis/slices/WALKING_span1_sender.log` | same | 47e0796fdf5f | 47e0796fdf5f |  |
| `b6_b33a_reanalysis/slices/WALKING_span1_viewer.log` | same | 9d43eebfedb0 | 9d43eebfedb0 |  |
| `b6_b33a_reanalysis/slices/WALKING_span2_sender.log` | same | 05992491f31a | 05992491f31a |  |
| `b6_b33a_reanalysis/slices/WALKING_span2_viewer.log` | same | c33696671c68 | c33696671c68 |  |
| `relay_import_closure.py` | same | fd2c9c437282 | fd2c9c437282 |  |
| `routes/b33_route_v1.json` | same | 788f201566c3 | 788f201566c3 |  |
| `routes/b33_route_v10.json` | same | 589c57fcc6ba | 589c57fcc6ba |  |
| `routes/b33_route_v11.json` | same | 7de04985b6db | 7de04985b6db |  |
| `routes/b33_route_v2.json` | same | b66ae4717775 | b66ae4717775 |  |
| `routes/b33_route_v3.json` | same | 2ae8c7d62c2a | 2ae8c7d62c2a |  |
| `routes/b33_route_v4.json` | same | cb426fbd64d8 | cb426fbd64d8 |  |
| `routes/b33_route_v5.json` | same | ff9e59ea969d | ff9e59ea969d |  |
| `routes/b33_route_v6.json` | same | 90e6fd265058 | 90e6fd265058 |  |
| `routes/b33_route_v7.json` | same | 2aad991ef35f | 2aad991ef35f |  |
| `routes/b33_route_v8.json` | same | ba6efd7801cc | ba6efd7801cc |  |
| `routes/b33_route_v9.json` | same | d93b17a532b1 | d93b17a532b1 |  |
| `server_check/ROUTES_cbe584be_vs_client_1e7cdebb.md` | same | b766c47e5241 | b766c47e5241 |  |
| `server_check/import_closure_cbe584be.txt` | same | 88798fd6f63b | 88798fd6f63b |  |
| `tests/TEST_OUTPUT_powershell.txt` | CHANGED | 117b671b19ca | 5d08d2aebb3c | 55 OK (ALL OK) |
| `tests/TEST_OUTPUT_python.txt` | CHANGED | 1e326c4aa6e9 | b5667b1b26e0 | 99 OK |
| `tests/b33_synth.py` | same | 4784b7e85a80 | 4784b7e85a80 |  |
| `tests/test_b33.py` | CHANGED | d00ad0b0494b | 9d00b9c1fee5 | V31aRules (6): P87 replaceable / not replaceable (P78, attempt count), P88 the listing fixture, P89 the RAM record |
| `tests/test_drive_and_stop.ps1` | CHANGED | e4f93167d022 | ddeadc7e4181 | the not-counted folder in DryLaunch; C3 / C10 updated; C12 (survey folder, lease gate, root refusal, -Control refusal, the guard function) |
