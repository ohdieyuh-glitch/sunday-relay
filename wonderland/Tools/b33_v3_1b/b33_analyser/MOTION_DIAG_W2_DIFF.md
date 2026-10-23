# motion_diag_w2.py: the listed diff from the registered analyser (M2 checklist B2)

DIAGNOSTIC tool, W2DEV, not evidence by itself. Written 2026-10-20 by W2DEV before any data of the r16reh16w/x candidate exe.

- Registered analyser: `motion_diag.py`, sha256 `4dee34d04a36ae0f9a8e0e7f5f925fa4eca371ce498927c1cce16b1d27f8ad29` (byte-identical copy in this folder).
- Derivative: `motion_diag_w2.py`. The mechanical record is `motion_diag_w2.diff` (`diff -u motion_diag.py motion_diag_w2.py`).
- Both files' hashes are in `..\SHA256SUMS.txt`.
- The judge (`..\b33_judge.py` v3) runs BOTH on every scenario and prints both outputs unedited.
- **v3 role (M2 ruling a185b283 B-2):** the REGISTERED analyser at raw stamps and shift 0 is the bar. W2 re-times samples, so it is never the basis of a PASS: it may only ADD a FAIL or an INCONCLUSIVE. The reviewer's R4 measured W2's re-timing on b33a as about -7 ms median, about -13 ms equivalent on STANDING. That is the sign of the banned fit; under `both` it can only make a verdict stricter.

## 1. Why a diff is needed: file-stamp compression biases the registered analyser

**How the registered analyser aligns time.**
- It places the sender's samples at their UE log stamps (`parse_sender`, `use_stamps=True`).
- It places the viewer's drawn samples at the log stamp of the motion line (`parse_viewer`).
- It compares the drawn z with the sender at viewer stamp - delayMs.
- So the alignment depends on two processes' file stamps.

**Why the stamps are wrong.** A UE stamp is taken when the line is formatted for the file, after every line queued before it has been written. It is never early, and it lags by the queue wait. With `-forcelogflush` every line is flushed, about 10 ms per line.

**Measured:**

| Log | What the file stamps did |
|---|---|
| b33a sender | 70 s behind the game's own `period=` clock at boot; caught up about 75 s later |
| b33a observer | 44 s behind at boot |
| b33a drive window | lag p50 2 ms, p95 19-20 ms, max 28 ms. A viewer motion line is stamped p50 7 ms, max 13 ms after the fig line written in the same tick. |
| live smoke 10-20 (d29ea734) | the stamps advanced about 11 ms per line while the periods said 107-280 ms. Lag p50 23.8 s, max 45.5 s. |

**Bias.**
- The error in truth time is (viewer lag) - (sender lag). At 300-420 uu/s vertical speed, 10 ms of error is 3-4 uu of apparent height error.
- A backlog makes the comparison meaningless.

**Shown on a synthetic fixture** (tests `test_steady_log_load_w2_recovers`): a perfect observer, with a 9 ms per line write cost and 40 filler lines/s per log.
- The registered analyser scores air p95 6.54 standing, 6.02 walking, 5.27 running and 5.75 for M4. That is pure instrument error.
- `motion_diag_w2` scores 0.04 on all four.

## 2. The diffs

Each diff is marked `W2 Dn` in the code. Constants are fixed before data.

| # | What changes | Registered behaviour | W2 behaviour | Why it is not a loosening |
|---|---|---|---|---|
| D1 | sender sample time | log stamp of the `send motion` line | the game's own clock (see note D1) | It removes only the file writer's wait, measured from the game's own clock. The analyser still compares drawn z with the sender at viewer time - delayMs, shift 0. |
| D2 | viewer sample time | log stamp of the `motion` line | the time of the same tick's `fig` line, from the game's own numbers (see note D2) | The same argument as D1. Where the exact chain is missing, the fallback is the anchor-lag interpolation, never a free parameter. |
| D3 | timing report | none | per-log anchor lag, backlog indicator, fig-line correction and how it was obtained, cross-log link latency with causality violations (see note D3) | Report only. The judge turns it into an INCONCLUSIVE gate (never a PASS). |
| D4 | no-sinking test | not computed (only `land_min_gap` and `ground_p50` are printed) | `settle_n`, `settle_min_gap`, `pass_no_sink` (see note D4); PASS also needs `pass_no_sink` | A bar the registered analyser did not test. Stricter. v3 (B-8): no upper cap on the window. |
| D5 | time shift | `--shift-ms` accepted; `best_shift` printed (a fit) | `--shift-ms` refused; `best_shift` never run or printed | B2: shift = 0 ms, fixed; the fit is not used |

**Note D1 (sender clock).**
- The game clock is the cumulative `period=` of the `send motion` lines (FPlatformTime differences, WonderlandSocialLive.cpp).
- It is placed on the wall clock by the lower envelope of (stamp - game clock), taken within ±2.0 s of game time.
- The envelope runs over the log's own anchors:
  - the `send motion` lines;
  - the `send soles` lines, at game time g + rtt, logged in the same answer's callback.

**Note D2 (viewer clock).**
- t(fig) = t(the `send soles` line of the world-report answer that delivered the figure's position) + (fig age - rep age)/1000.
- The fig line's `age=` is (tick now - RecvAt) + RecvAgeMs. RecvAt is taken in that answer, right after its `send soles` line. The answer's `rep` line prints RecvAgeMs.
- Guards:
  - the nearest anchor before the rep line must be a soles line;
  - the printed position must match;
  - the ages must only grow;
  - stamp >= time - 5 ms;
  - the time must not be before the arrival.
- Fallback: the fig stamp less the viewer log's queue lag, interpolated by file line between its own anchors.

**Note D3 (timing report).** It reports:
- the per-log anchor lag;
- a backlog indicator: the ±2 s envelope minus a ±30 s envelope;
- the fig-line correction and the method (`age` or `lag`);
- the cross-log link latency: the time from the sender's send to the viewer's answer that delivered the same position, with causality violations below -10 ms.

**Note D4 (no-sinking test).**
- `settle_n` and `settle_min_gap` are taken over the viewer samples whose truth time is more than 0.5 s after the sender's touchdown, and before the next air run or the end of the analysed drive block. **v3 (M2 ruling B-8): no 1.5 s cap** (v2 had one).
- `pass_no_sink` = settle_min_gap >= -2.0 uu (signed, drawn minus sender), over EVERY settled sample, not a percentile.
- The 2.0 uu tolerance is the landing bar's. It absorbs the figure's constant lowestUu sink (-0.24 to -0.29 uu measured).
- settle_n = 0 gives None; the judge then says INCONCLUSIVE.

Unchanged: the AIR set, the landing window (0.5 s after the first ground sample after an air run), the linear interpolation of the bracketing sender samples, the nearest-rank percentile, the air (10.0) and landing (2.0) bars, the air-episode count, and the PASS conditions of the registered analyser.

The registered `parse_sender` and `parse_viewer` are not in `motion_diag_w2.py`. They are replaced by `parse_sender_w2` and `parse_viewer_w2`. The judge uses the registered module for the registered numbers.

## 3. What W2 does on recorded data (b33a, no exe of the candidate)

| b33a scenario (v3: the recorded DRIVE PHASES as blocks, + 1.6 s; shift 0) | registered air / land p95 | W2 air / land p95 |
|---|---|---|
| STANDING (block JUMP IN PLACE; 6 counted + 1 unclassified jump, all analysed) | **22.50** / **2.86**: FAIL | 18.20 / 2.86: FAIL |
| WALKING (block WALK JUMP; 4 counted, all samples analysed) | **11.74** / 1.67: FAIL | 11.09 / 1.67: FAIL |
| RUNNING (block RUN JUMP; 0 counted, 0 air episodes) | 1.29 / 1.76: INCONCLUSIVE | 0.84 / 1.25 |

These equal the original b33a record and the reviewer's R4 numbers exactly. v2 used the slicer's spans instead, which gave 22.50 / 3.52 and 12.93 / 3.59 (R4-04).

**Timing in the b33a drive window (W2 D3).**
- The age chain timed 404 of 562 fig lines.
- The fallback timed the rest. The first arrival came from a join answer during the boot backlog, and some moves were under 0.5 uu: RecvAt was reset with no rep line.
- Link latency: p5 24, p50 64, p95 142, max 168 ms, with 0 causality violations.
- Backlog p95: 3 ms sender, 8 ms viewer.

## 4. Limits (stated before data)

**D1 needs a zero-wait line within ±2 s.** A queue that never empties raises the envelope; the backlog indicator shows that.
- In v3 the judge's gate can only demote a PASS to INCONCLUSIVE (B-3), when any of these holds:
  - backlog p95 > 50 ms;
  - viewer file lag p95 > 100 ms;
  - fewer than 5 cross-log samples;
  - any causality violation;
  - link p95 > 400 ms;
  - raw file lag p95 > 25 ms.
- A bar violated by either analyser is FAIL first, whatever the gate says. Tests: `test_B3_bar_fail_under_a_backlog_is_fail` and `test_B3_gate_only_demotes_a_pass`.

**Clock agreement.** Both clients must run on one machine (one wall clock). On two machines, the clock offset would enter the gap directly. That is not supported here.

**The truth is still the chord.** As registered, the truth is the chord between the sender's ~7 Hz reports, not the true parabola.

**The verdict analyser is fixed in v3 (M2 ruling B-2).** It is BOTH. The registered analyser on raw stamps is the bar, and W2 may only add a FAIL or an INCONCLUSIVE. The v2 options `--verdict-analyser` and `--m4-bars` are removed, and the judge refuses them.
