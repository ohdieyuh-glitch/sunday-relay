#!/usr/bin/env bash
# EVERYTHING THAT THE ADDITIVE x1000 FIX INVALIDATED, PLUS THE RUN THAT NEVER RAN.
#
# The other lane found that RestColourFor was writing a figure's additive Color without the x1000 that
# M_WL_VoxelAdditive and M_WL_EyeHalo cannot supply themselves -- their emissive IS Color -- and the per-tick
# animator replaced the painter's correct value one frame later. Verified on the rebuilt editor: the same
# costume halo that read Color 19.8 now reads 19,089 against a scene white near 25,000.
#
# So every additive surface on every figure was black when I took my readings, and two things follow.
#
#   zzP1  TRAVERSAL, which never ran at all. It errored on load with 0/0 gates because I had left two note=
#         keywords in one record call -- ast.parse accepts a repeated keyword, the compiler does not, and my
#         patch script only ran ast.parse. Now carries the peak-speed discriminator (full walk speed with no
#         advance is BLOCKED GEOMETRY, a peak near zero is the harness) and a sixteen-ray start-clearance probe
#         that names what it hits off the component's static mesh, because this world is instanced and an actor
#         label just names a batch of thousands.
#
#   zzP2  NIGHT, which must be re-read from scratch. mascot_at_spawn read 2.69x its own noon -- already the one
#         place too bright -- while the figure contributed nothing; it now contributes two eye halos at roughly
#         19,000 scene units each. Also newly carries N_SCALE (the world's own lamps must show Emissive x
#         EmissiveStrength landing near the scene's white, not near 1), N_NOON_DARK with a trace down each view
#         (a place dark at MIDDAY is not a night problem, and a trace separates "not drawn at 100-200 m" from
#         "drawn and unlit"), and a dusk ladder at ten-minute steps from 16:00 to 20:00 because Daylight is
#         pinned at exactly 1.0 for 10.7 hours and then falls the whole way in 67 minutes -- three hourly
#         samples cannot describe that.
#
#   zzP3  THE KNEE, low end only in effect. Knees 700/220/64/32/16 are answered by arithmetic and do not need
#         re-measuring: TameGlow acts on the AUTHORED strength (3.3 to 13.2) before the multiply, so anything
#         at or above 16 cannot touch them whatever the render scale. Knees 8, 4 and 2 DO compress, and those
#         are exactly the rows measured while the surfaces they compress were invisible.
#
# Water is NOT re-run: its nine views hold no figures, so the fix cannot have moved them.
set -euo pipefail

WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"
TMP="C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/5b20cf79-e51b-4532-902f-47c18f55e76d/scratchpad"
JOBS="$WT/Tools/editor_jobs"
ST="$TMP/_stage_pf.py"
mkdir -p "$TMP"

HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat -- no runner listening" >&2; exit 1; }

N=$(powershell.exe -NoProfile -Command "@(Get-Process UnrealEditor -ErrorAction SilentlyContinue).Count" 2>/dev/null | tr -d '\r\n ')
[ "$N" = "1" ] || { echo "editor count is '$N', expected exactly 1 -- refusing to queue" >&2; exit 1; }

for i in $(seq 1 90); do
  AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
  [ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale -- dead channel" >&2; exit 1; }
  BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
  LEFT=$(ls -1 "$CH/inbox" 2>/dev/null | wc -l | tr -d ' ')
  [ "$BUSY" = "0" ] && [ "$LEFT" = "0" ] && { echo "channel idle after ${i} check(s)"; break; }
  [ "$i" = "90" ] && { echo "still busy (job=$BUSY inbox=$LEFT) -- not queueing" >&2; exit 1; }
  sleep 10
done

queue() {   # queue <name> <job-file> <header>
  printf '%s\n\n' "$3" > "$ST"
  cat "$JOBS/$2" >> "$ST"
  [ "$(grep -c '^def job' "$ST")" = "1" ] || { echo "BAD JOB $1" >&2; return 1; }
  # PY_COMPILE, NOT AST.PARSE. ast.parse accepts a repeated keyword argument and the compiler rejects it,
  # which is exactly how zzN3 reached the editor and errored on load with zero gates.
  python -c "import py_compile,sys;py_compile.compile(sys.argv[1],doraise=True)" "$ST" \
    || { echo "STAGED $1 DOES NOT COMPILE -- not queueing it" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"
  echo "queued $1"
}

queue zzP1_nation_walk.py  zc_nation_walk.py  ''
queue zzP2_night_sweep.py  zc_night_sweep.py  ''
queue zzP3_knee.py         zc_mascot_knee.py  'AXIS = "knee"
HOUR = 12.0
HOUR_LABEL = "day"'

echo
echo "Read in this order and stop at the first red that voids the rest:"
echo "  zzP2  N_SCALE first -- if the world's lamps do not carry the thousand, nothing else in that job means"
echo "        anything. Then N_SANITY, then N_NOON_DARK's surfaces_in_front for architecture_noctis: a trace"
echo "        that finds nothing at 100-200 m means not drawn, and one that finds it means drawn and unlit."
echo "  zzP1  W0A -- harness_proven_by should name at least one nation, and blocked_at_start is a WORLD"
echo "        finding rather than a harness failure. start_clearance names the obstacle for ICARUS."
echo "  zzP3  the 8/4/2 rows only. Anything at or above 16 is arithmetic and needs no measurement."
