# motion_diag.py -- adoption record (W2DEV, 2026-10-20)

DIAGNOSTIC tool, W2DEV, not evidence by itself.

| Item | Value |
|---|---|
| File | `b33_analyser\motion_diag.py` in this folder |
| sha256 | `4dee34d04a36ae0f9a8e0e7f5f925fa4eca371ce498927c1cce16b1d27f8ad29` |
| Source | `C:\dev\iwonder\_qa_handoff\integration\r16reh16w_dev_20261019\motion_diag\motion_diag.py` (mtime 2026-10-19 12:08 local) |
| Identity check | byte-identical: `cmp` exit 0; both sha256 above (run 2026-10-20 by W2DEV) |
| Registered by | PREREG_B33_MOTION_v1.md (sha256 `c73022b4ebdd6b6b29ef4a56c037c47f6a49b91cf4e1ff3508086d68f9c91a76`), "the existing motion_diag analyser as already registered"; M2 checklist B2 |
| Recusal | not on the reviewer's recusal list (00_REVIEWER_ROLE_AND_RECUSAL.md lists `motion_diag\slice_phases.py`, which is NOT used here; the slicer is W2DEV's own `b33_slicer.py`) |
| Use | the judge imports it unmodified (`motion_diag.parse_sender`, `parse_viewer`, `analyse`, all at shift 0) and refuses to run if the file's sha256 differs |
| Its own self-test | `r16reh16w_dev_20261019\motion_diag\test_motion_diag.py` (sha256 `6cd75eb3...`), re-run read-only with `python -I -B`: output in `..\b6_b33a_reanalysis\registered_selftest_output.txt` |

How it aligns time (read from the code, lines cited from this file):
- `parse_sender` (L27-43) places each sender sample at its own UE **log stamp** (`use_stamps=True`); the docstring at L6 ("first stamp + cumulative period") is stale.
- `parse_viewer` (L46-57) places each drawn sample at the **log stamp of the motion line** and takes `delayMs` from the latest fig line.
- `analyse` (L67-111): truth time = viewer stamp - delayMs + shift (L82); the gap is the drawn z minus the linear interpolation of the two bracketing sender samples (L85-88).
- So it compares two processes' **file stamps**. A UE stamp is taken when the line is formatted for the file, after the lines queued before it, so it can only be late, and it compresses under load. The measured consequences and the listed diff are in `MOTION_DIAG_W2_DIFF.md`.
