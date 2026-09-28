#!/usr/bin/env bash
# THE FOUNDER'S "AFTER", on a world that has actually changed.
#
# Everything under the night correction has landed since the last reading: NightShadowLift at 0.65 (body
# 99.9% -> 29.5% crushed, ground 99.1% -> 47.3%, night still 59% of noon), the practical pool ranking by
# significance instead of distance, 479 more light definitions from fixtures that were standing dark, and
# three new lamp layers applied in memory -- NQ06 45 instances, IQ06 63, GA08 54.
#
#   zzQ1  NIGHT. The founder's priorities 1 and 2, re-read on all of that. Carries N_SCALE (the world's own
#         lamps must show Emissive x EmissiveStrength near the scene's white, now that its actor lookup is
#         fixed), N_NOON_DARK with a trace down each view, N_HOLD (EV100 14.2 and the other lane's 24/8 must
#         come out unchanged, as a red gate rather than my intention), the dusk ladder at ten-minute steps
#         through the 67-minute transition, and the architecture_noctis view moved out of the foliage it was
#         buried in.
#
#   zzQ2  TRAVERSAL. W0B has never run: it is the discriminator between "the WORLD went away" and "the DOG
#         was destroyed", which the old message conflated and blamed the world for both. All three nations
#         walked 4.5 to 19.4 m of a 485 m route and vanished; if W0B says the pawn went, with a last-known z
#         far under the leg's floor, that is the Dog falling through unstreamed ground -- which the other
#         lane hit independently by teleporting to an unloaded place. Their fix was to move the pawn to the
#         SUBJECT rather than wait longer.
#
# Neither saves the map. Both restore every cvar they touch.
set -euo pipefail
WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"; JOBS="$WT/Tools/editor_jobs"
ST="$CH/inbox/._stage_after.staging"
HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat" >&2; exit 1; }
N=$(powershell.exe -NoProfile -Command "@(Get-Process UnrealEditor -ErrorAction SilentlyContinue).Count" 2>/dev/null | tr -d '\r\n ')
[ "$N" = "1" ] || { echo "editor count '$N', expected 1" >&2; exit 1; }
AGE=$(( $(date +%s) - $(date -r "$HB" +%s) )); [ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale" >&2; exit 1; }
BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
[ "$BUSY" = "0" ] || { echo "a job is running" >&2; exit 1; }

queue() {
  cat "$JOBS/$2" > "$ST"
  [ "$(grep -c '^def job' "$ST")" = "1" ] || { echo "BAD JOB $1" >&2; return 1; }
  python -c "import py_compile,sys;py_compile.compile(sys.argv[1],doraise=True)" "$ST" \
    || { echo "STAGED $1 DOES NOT COMPILE" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"; echo "queued $1"
}
queue zzQ1_night_sweep.py zc_night_sweep.py
queue zzQ2_nation_walk.py zc_nation_walk.py
echo
echo "zzQ1: read N_HOLD and N_SCALE before any night number. zzQ2: read W0B before W00/W01 --"
echo "a destroyed pawn is a streaming finding about the avenue, not a harness failure."
