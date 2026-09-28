#!/usr/bin/env bash
# THE FILL SWEEP, THE NIGHT BASELINE AND THE TRAVERSAL RE-RUN, on the corrected build.
#
# Everything here was measured on a world whose render thread was 350 ms behind, so this is the first night
# reading taken on an honest frame. The sweep now carries five things it did not have this morning:
#
#   NightFill as a swept axis   0.26 / 0.45 / 0.70 / 1.00 alongside the moon/sky/practical range. My
#                               "no combination can reach the ground" swept three knobs and held this one --
#                               the knob aimed at that ground -- constant.
#   N04 tails                   dark + bright, the range that survives. Local exposure opens the dark tail;
#                               fill lifts everything and shrinks both. Luma alone cannot tell them apart,
#                               and the founder ruled out exactly one of them.
#   N05 occlusion, BOTH ways    a 2 m trace catches a camera against a lit wall, which reads bright and
#                               passes any darkness check; a noon-darkness check catches a camera in
#                               foliage, which the trace cannot see because foliage has no collision.
#   N_HOLD                      EV100 14.2 and the other lane's 24/8 must come out unchanged, as a gate.
#   adaptive settling           waits for two consecutive framings within 0.004 luma instead of counting
#                               seconds, because three seconds was 7.7 frames this morning and 95.6 now.
#
# zzR2 re-runs traversal with the self-diagnosing probe: drives until the Dog MOVES rather than for a fixed
# count, and reports time-to-first-movement so frame starvation can be told from geometry.
set -euo pipefail
WT="C:/dev/iwonder/wonderland-task3/wonderland"; CH="$WT/Tools/_channel"; JOBS="$WT/Tools/editor_jobs"
ST="$CH/inbox/._stage_fill.staging"
HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat" >&2; exit 1; }
N=$(powershell.exe -NoProfile -Command "@(Get-Process UnrealEditor -ErrorAction SilentlyContinue).Count" 2>/dev/null | tr -d '\r\n ')
[ "$N" = "1" ] || { echo "editor count '$N', expected 1" >&2; exit 1; }
for i in $(seq 1 120); do
  AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
  [ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale" >&2; exit 1; }
  BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
  # `grep -v` EXITS 1 ON EMPTY INPUT, and with `set -euo pipefail` that kills the script -- so the first
  # version of this waiter died the instant the inbox was clean, which is the exact condition it exists to
  # wait for. A guard that fails when its wait is satisfied is worse than no guard: it reported "armed" and
  # was not. `|| true` on the pipeline, because a count of nothing is zero and not an error.
  LEFT=$( { ls -1 "$CH/inbox" 2>/dev/null || true; } | grep -cv -e staging -e pycache || true )
  LEFT=${LEFT:-0}
  [ "$BUSY" = "0" ] && [ "$LEFT" = "0" ] && { echo "channel idle after ${i} check(s)"; break; }
  [ "$i" = "120" ] && { echo "still busy (job=$BUSY inbox=$LEFT)" >&2; exit 1; }
  sleep 10
done
queue() {
  cat "$JOBS/$2" > "$ST"
  [ "$(grep -c '^def job' "$ST")" = "1" ] || { echo "BAD JOB $1" >&2; return 1; }
  python -c "import py_compile,sys;py_compile.compile(sys.argv[1],doraise=True)" "$ST" \
    || { echo "STAGED $1 DOES NOT COMPILE" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"; echo "queued $1"
}
queue zzR1_night_fill.py  zc_night_sweep.py
queue zzR2_nation_walk.py zc_nation_walk.py
echo
echo "zzR1: read N05 and N_HOLD first, then sky_settled_after_s -- a null there voids the night numbers."
echo "      Then compare the fill family against the moon/sky family on TAILS, not on luma."
echo "zzR2: read probe_moved_after_s. Late or never with few speed samples is frame starvation;"
echo "      prompt speed with no displacement is geometry."
