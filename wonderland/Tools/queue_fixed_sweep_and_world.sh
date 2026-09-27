#!/usr/bin/env bash
# THE EYE RUNS AGAIN ON THE FIXED ANCHOR, THEN THE WORLD LANE'S OWN THREE.
#
# WHY THE NAMES CHANGE. zzM1 and zzM2 already landed, clean, with died_at null and a table measured at a
# 24.7 uu anchor that is a component pivot rather than an eye -- every patch on a torso. Reusing those names
# would leave two results on disk that look equally valid and differ only by mtime, and reading a stale result
# as a fresh one has already cost this project an hour today. zzM5/M6/M7 are the post-fix eye runs and
# zzM1/zzM2 stay on disk as the pre-fix evidence they are.
#
#   zzM5  eye axis, DAY     8 skins x 7 levels
#   zzM6  eye axis, DUSK
#   zzM7  eye axis, NIGHT
#
# then the founder's priorities 1, 2 and 3, which are this lane's and have not been measured once:
#
#   zzN1  NIGHT READABILITY -- seven named places over nine moon/sky/practical combinations, plus a 25-hour
#         ladder. Now reads the SAME composited viewport frame it saves as a JPEG; the previous version
#         measured a SceneCapture actor nobody had posed while photographing the viewport, which is why noon
#         came back at 0.0118 in a world the viewport reads at 0.17-0.34.
#   zzN2  WATER -- nine founder views and the M_WL_RealWater parameter inventory, with A03 now gating the
#         crushed fraction instead of a mean that let a 99%-black pond pass.
#   zzN3  TRAVERSAL -- the Dog driven along each nation avenue, with peak speed separating a blocked start
#         from a harness that never drove.
#
# None of the six saves the map. All restore every cvar they touch -- and the sweep's restore is now the
# round-3 pair, 24/8, not the two-build-stale 18/5 it used to put back.
set -euo pipefail

WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"
TMP="C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/5b20cf79-e51b-4532-902f-47c18f55e76d/scratchpad"
JOBS="$WT/Tools/editor_jobs"
ST="$TMP/_stage_fx.py"
mkdir -p "$TMP"

HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat -- no runner listening" >&2; exit 1; }

# ONE EDITOR. Two processes on one channel cost an hour today: they ate the same inbox, alternated the same
# heartbeat so it read as a crash loop, and put two writers on one .umap.
N=$(powershell.exe -NoProfile -Command "@(Get-Process UnrealEditor -ErrorAction SilentlyContinue).Count" 2>/dev/null | tr -d '\r\n ')
[ "$N" = "1" ] || { echo "editor count is '$N', expected exactly 1 -- refusing to queue" >&2; exit 1; }

# WAIT FOR IDLE rather than refusing. A job of mine is finishing; there is nothing to decide here.
for i in $(seq 1 90); do
  AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
  [ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale -- dead channel" >&2; exit 1; }
  BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
  LEFT=$(ls -1 "$CH/inbox" 2>/dev/null | wc -l | tr -d ' ')
  [ "$BUSY" = "0" ] && [ "$LEFT" = "0" ] && { echo "channel idle after ${i} check(s)"; break; }
  [ "$i" = "90" ] && { echo "still busy after 90 checks (job=$BUSY inbox=$LEFT) -- not queueing" >&2; exit 1; }
  sleep 10
done

queue() {   # queue <name> <job-file> <header>
  printf '%s\n\n' "$3" > "$ST"
  cat "$JOBS/$2" >> "$ST"
  [ "$(grep -c '^def job' "$ST")" = "1" ] || { echo "BAD JOB $1" >&2; return 1; }
  python -c "import ast,sys;ast.parse(open(sys.argv[1],encoding='utf-8').read())" "$ST" \
    || { echo "STAGED $1 DOES NOT PARSE -- not queueing it" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"
  echo "queued $1"
}

queue zzM5_eye_day.py   zc_mascot_knee.py 'AXIS = "eye"
HOUR = 12.0
HOUR_LABEL = "day"'
queue zzM6_eye_dusk.py  zc_mascot_knee.py 'AXIS = "eye"
HOUR = 18.8
HOUR_LABEL = "dusk"'
queue zzM7_eye_night.py zc_mascot_knee.py 'AXIS = "eye"
HOUR = 23.5
HOUR_LABEL = "night"'
queue zzN1_night_sweep.py zc_night_sweep.py ''
queue zzN2_water_audit.py zc_water_audit.py ''
queue zzN3_nation_walk.py zc_nation_walk.py ''

echo
echo "queued 6. On zzM5-M7 read anchor_how and anchor_candidates FIRST: 'mesh:bounds' with a value near the"
echo "upper part of the figure means the patch is on a face, and anything else means the eye table is a torso"
echo "reading again regardless of how the gates score. On zzN1 read N_SANITY first -- if noon is still dark"
echo "through the viewport path then the problem was never the capture route."
