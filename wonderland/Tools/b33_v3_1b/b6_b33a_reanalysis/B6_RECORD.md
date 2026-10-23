# B6: the hashed analyser FAILS b33a at shift 0 (re-analysis on a read-only source; W2DEV, 2026-10-20; v3 basis = the drive's blocks)

DIAGNOSTIC record, W2DEV, not evidence by itself. b33a is an OLD-exe run: exe F2476B47..., commit 40102b69. It is NOT the candidate. This record only shows that the instrument can FAIL (M2 checklist B6). It says nothing about the candidate.

## Inputs (read-only, not modified)

| sha256 | file in `r16reh16w_dev_20261019\r16_repair_loop\b33_runs\run_20261020T071219Z_b33a` |
|---|---|
| `013be7a738f06afdfa20220c19583cfa1ceeb9eb6362224d35068da4755945b9` | `clientA\Saved\Logs\Wonderland.log` (the SENDER) |
| `928319af92cd987df3e15b0ab1368de2dfe9960d90974d7c9dae6619f8b99a9d` | `clientB\Saved\Logs\Wonderland.log` (the OBSERVER) |
| `e9b580d1e75ed25fb744fd688fc8a7bfa35c219a1e0095da480d45432e416110` | `RUN.json` (its exe hash is under the older key `sha256`) |
| `b0b81fa0b5b53b3514c1fc5040bcff2fef950d3822bbf887b25fb8ed7052c0f1` | `ANALYSER_OUTPUT_shift0.txt` (the original record) |
| `0735ddf2f189444f274dc5275afedffb8d1256ef646884d930a9480dbb39b4a1` | `jump_A.csv` (the drive's phases) |

## v3 basis (M2 ruling a185b283 B-4): the scenarios are the drive's blocks

b33a's drive (mp_auto_jump_v3.ps1) wrote phases, not a b33_drive timeline. `make_b33a_timeline.py` (in this folder) maps them 1:1 into `b33a_timeline.csv`, from `jump_A.csv` and `jump_A.csv.log`:

| b33a phase | Block |
|---|---|
| JUMP IN PLACE | STAND |
| WALK JUMP | WALK |
| RUN JUMP | RUN |

Each logged jump becomes a SPACE key down/up. Nothing else is added.

## Commands (from `tools\b33`)

```
python -I -B b6_b33a_reanalysis\make_b33a_timeline.py <b33a> b6_b33a_reanalysis\b33a_timeline.csv
python -I -B b33_judge.py <b33a> --sender-log <clientA log> --viewer-log <clientB log> --timeline b6_b33a_reanalysis\b33a_timeline.csv
   --no-require-frames --historical --expect-exe F2476B479C2D4B6338E350AE16EB3F38826138605AA39F0D0EF352AC92835983
   --allow-launch-cmds "scalability 0;r.ScreenPercentage 50" --allow-switches "-forcelogflush" --json JUDGE_b33a.json > JUDGE_b33a.txt
python -I -B C:\dev\iwonder\_qa_handoff\integration\r16reh16w_dev_20261019\motion_diag\test_motion_diag.py      -> registered_selftest_output.txt
```

The `--historical` and `--allow-*` options are disclosed in the report:
- b33a's exe predates ReportTimeSamples;
- it ran with -forcelogflush and two rendering commands;
- it captured no frames.

## Result at shift 0 (judge v3; both analysers' dicts unedited in JUDGE_b33a.txt)

| Block (scenario) | REGISTERED motion_diag.py: air / landing p95 | W2: air / landing p95 | Verdict |
|---|---|---|---|
| STAND (STANDING): 6 counted jumps + 1 unclassified (in the block, analysed) | **22.502854324814127 / 2.86** | 18.20 / 2.86 | **FAIL** (registered bar) |
| WALK (WALKING): 4 counted jumps; every sample of the block analysed | **11.74 / 1.67** | 11.09 / 1.67 | **FAIL** (registered bar) |
| RUN (RUNNING): 0 counted jumps, 0 air episodes (the sender was pinned at a wall) | 1.29 / 1.76 | 0.84 / 1.25 | INCONCLUSIVE |
| M4 | no block | -- | INCONCLUSIVE |

RESULT: **FAIL**. These equal the original b33a record (`ANALYSER_OUTPUT_shift0.txt`) for both air and landing: STANDING 22.50 / 2.86, WALKING 11.74 / 1.67, RUNNING 1.29 / 1.76 with 0 episodes. They also equal the reviewer's R4 reproduction.

R4-14 is corrected here. The v2 record said "matching the original record exactly". That held for the STANDING air value only, because v2 used the slicer's spans (landing 3.52, walking 12.93/13.29).

**Kept on record from v2.** The registered analyser's CLI was run on the v2 slicer-span slice files (`slices\`), and its outputs are `REGISTERED_CLI_*_shift0.txt` and `W2_CLI_*.txt`. STANDING span 1 gave air 22.502854324814127, FAIL, exit 1. Those slices are the v2 basis and are kept unchanged. The v3 basis is the judge above.

**v3.1 re-run (2026-10-20, judge with CANDIDATE.json and the exact prereg ExecCmds rule).** JUDGE_b33a.txt and JUDGE_b33a.json were regenerated with the same command. The numbers and verdicts are unchanged. Against the v3 output, three things differ: the printed algebra, a new CANDIDATE line (expect_exe_override = b33a's exe) and the judge's sha256. --historical skips the exact-ExecCmds rule, because b33a ran with scalability 0, r.ScreenPercentage 50 and -forcelogflush, all disclosed above. The --expect-exe override skips the candidate status, boot and commit checks.

**v3.1 re-run (2026-10-20, judge v3.1: M2b ruling fea3fb7f R7-01..R7-08).** JUDGE_b33a.txt and JUDGE_b33a.json were regenerated with the same command. From the SLICER section on, the output is byte-identical to the v3 output: the same numbers and the same RESULT FAIL (exit 1). Only the header changed: the v3.1 algebra, the overrides line (R7-07), the console-set echoes (b33a: `wl.Remote.LogPeriod = "0.1"` on both clients) and the close-hash line ("no SHA256SUMS_AT_CLOSE.txt", historical: recorded, not required). `--allow-*` remain legal here because the run is `--historical`.

The registered analyser's own self-test passes on the same bytes (`registered_selftest_output.txt`: ALL OK, exit 0).

## Deliberate-FAIL / INCONCLUSIVE fixtures (SYNTHETIC; `..\tests\test_b33.py`, output `..\tests\TEST_OUTPUT_python.txt`)

- **air +12 uu: FAIL.** The registered bar decides it.
- **landing +3 uu: FAIL.**
- **sinking -3 uu: FAIL,** including 1.7-1.95 s after touchdown (B-8).
- **5 standing jumps: INCONCLUSIVE.**
- **registered FAIL with W2 PASS: FAIL** (B-2).
- **air +12 uu under a log backlog: FAIL** (B-3).
- **no timeline: INCONCLUSIVE** (B-4).
- **-wlframes on the command line: VOID** (B-5).

`SHA256SUMS.txt` here lists the tools by paths relative to THIS folder (`..\b33_judge.py` ...), so `sha256sum -c` works from inside this folder (R4-15).

**B33 v3.1 re-run (2026-10-21, `tools\b33_v3_1`: Q-B33-2 per-block sinking, the pins, P82 behind its flag).** The same command, run from `tools\b33_v3_1`, wrote `JUDGE_b33a_v3_1.txt` / `JUDGE_b33a_v3_1.json` (the v3 / v3.1k files stay as they were). Every number and verdict is unchanged: STANDING FAIL (registered air 22.50, landing 2.86), WALKING FAIL (air 11.74), RUNNING INCONCLUSIVE, M4 INCONCLUSIVE (no block), RESULT FAIL, exit 1. The differences are the printed algebra (B-8 per block, the two new VOID lines), the per-block sinking line (each scenario is one block here, so its numbers equal the joined ones), the RING EVIDENCE block (descriptive) and the relay / route pin records (`--historical`: not checked).
