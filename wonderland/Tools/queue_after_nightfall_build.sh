#!/usr/bin/env bash
# THE THREE THAT PROVE TODAY'S TWO SOURCE CHANGES, IN THE ORDER THAT FAILS CHEAPEST.
#
#   zzU1  dusk_closed      -- does the hole at 18:00 actually close? Re-runs zzT2's nine rungs at the same
#                             pose against zzT2's recorded numbers, plus zzT1's noon as a control. C_CURVE
#                             reads Nightfall back from the engine FIRST, so a build that did not pick up
#                             d21c2213 voids itself instead of failing in a way that looks like the fix not
#                             working. That makes this the build canary as well as the result, which is why
#                             it runs first.
#   zzU2  wrap_step        -- is the midnight snap gone? Three clusters: across the wrap and across BOTH
#                             joins, since a piecewise curve can tear where its pieces meet as well as
#                             where the clock rolls over. W_BEARING reads the bearing back and voids on a
#                             build without e6761abf.
#   zzU3  practical_budget -- what does the light budget buy and cost at the densest spot in the world?
#                             Moves the PAWN, because Assign() takes its Eye from the pawn and not the
#                             camera. Counts spawned actors, because BuildPool does not run from Tick and a
#                             cvar readback cannot see that. Reads cost from the RAW accessor.
#
# Longest last. If the build is wrong, zzU1 says so in about three minutes rather than after twenty.
#
# None of the three saves the map. All restore what they touch: hour, span, and PracticalCount back to 48
# with a reload behind it.
set -uo pipefail

WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"
JOBS="$WT/Tools/editor_jobs"
# Staged INSIDE the inbox under a non-.py name and renamed in place. editor_channel skips anything that
# does not end in .py, so a .staging file is invisible to the runner until the rename makes it a job, and
# the rename is same-directory by construction rather than by assuming one volume.
ST="$CH/inbox/._stage_nb.staging"

[ -f "$CH/heartbeat.json" ] || { echo "no heartbeat -- no runner listening" >&2; exit 1; }

# ONE EDITOR. Two processes on one channel cost an hour on 2026-09-27: they ate the same inbox, alternated
# the same heartbeat so it read as a crash loop, and put two writers on one .umap.
N=$(powershell.exe -NoProfile -Command "@(Get-Process UnrealEditor -ErrorAction SilentlyContinue).Count" 2>/dev/null | tr -d '\r\n ')
[ "$N" = "1" ] || { echo "editor count is '$N', expected exactly 1 -- refusing to queue" >&2; exit 1; }

# WAIT FOR IDLE rather than refusing: the other lane may still be finishing something.
for i in $(seq 1 90); do
  AGE=$(( $(date +%s) - $(date -r "$CH/heartbeat.json" +%s) ))
  [ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale -- dead channel" >&2; exit 1; }
  BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$CH/heartbeat.json")
  LEFT=$(ls -1 "$CH/inbox" 2>/dev/null | grep -cv '__pycache__' || true)
  if [ "$BUSY" = "0" ] && [ "$LEFT" = "0" ]; then echo "channel idle after ${i} check(s)"; break; fi
  [ "$i" = "90" ] && { echo "still busy (job=$BUSY inbox=$LEFT) -- not queueing" >&2; exit 1; }
  sleep 10
done

queue() {   # queue <queued-name> <job-file>
  cp "$JOBS/$2" "$ST"
  COUNT=$(grep -c '^def job' "$ST" || true)
  [ "$COUNT" = "1" ] || { echo "BAD JOB $1: $COUNT 'def job'" >&2; rm -f "$ST"; return 1; }
  # PY_COMPILE, NOT AST.PARSE AND NOT NOTHING. ast.parse ACCEPTS a repeated keyword argument where the
  # compiler rejects it -- exactly how zzN3 reached the editor and errored on load with zero gates after a
  # check of mine waved it through. A job that fails to load looks identical to one that ran and found
  # nothing.
  python -c "import py_compile,sys;py_compile.compile(sys.argv[1],doraise=True)" "$ST" \
    || { echo "STAGED $1 DOES NOT COMPILE -- not queueing it" >&2; rm -f "$ST"; return 1; }
  mv "$ST" "$CH/inbox/$1"
  echo "queued $1"
}

queue zzU1_dusk_closed.py      zc_dusk_closed.py
queue zzU2_wrap_step.py        zc_wrap_step.py
queue zzU3_practical_budget.py zc_practical_budget.py

echo
echo "Read in this order and stop at the first red that voids the rest:"
echo "  zzU1  C_CURVE FIRST. If the readback did not find the complement curve, the build is not carrying"
echo "        d21c2213 and nothing below it means anything -- the status line says EVIDENCE rather than"
echo "        measured when the curve could not be read at all. Then C_DAY (my day-untouched claim,"
echo "        measured against zzT1's noon rather than asserted a third time), then C_CLOSED, then C_NOREG"
echo "        -- a fix that lifted 18:00 by darkening its neighbours would pass C_CLOSED and fail C_NOREG."
echo "  zzU2  W_BEARING FIRST for the same reason. A worst arc near 144 means the old sun is running."
echo "  zzU3  B_WHERE and B_POOL before any brightness number. If the pawn did not arrive, the pool was"
echo "        selected somewhere else; if the counts do not track, the pool never resized and the four"
echo "        rungs are one setting measured four times."
