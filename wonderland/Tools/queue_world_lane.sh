#!/usr/bin/env bash
# THE WORLD LANE'S OWN FOUNDER ITEMS, none of which has a single measurement yet.
#
# The mascot cluster has taken most of today, and it is now substantially answered by the other lane's
# visual read: on the scene-units build the eyes render. What has NOT been measured even once is the work
# the founder listed as priorities 1, 2 and 3, all of which are this lane's:
#
#   1 & 2  NIGHT READABILITY AND CITY NIGHT LIGHTING.  zc_night_sweep -- the founder's seven named places
#          (city, major path, plaza, territory entrance, water, architecture, mascot at spawn) over nine
#          moon / sky-light / practical combinations, scored READABLE (crushed <= 0.60, luma >= 0.06) and
#          STILL NIGHT (<= 0.38 x that place's own noon), plus a 25-hour ladder for the largest
#          hour-to-hour jump. Saves nothing; every knob is a cvar on the PIE copy.
#
#   3      WATER.  zc_water_audit -- the founder's nine views (day/dusk/night x close/shoreline/elevated)
#          and the first inventory of what M_WL_RealWater actually exposes. "Audit and improve the existing
#          implementation" has had no parameter list to work from; this is that list.
#
#   QA-8   TRAVERSAL.  zc_nation_walk -- the Dog driven along each nation's avenue by AddMovementInput, with
#          the actuator probe that the first version lacked. A red on W0A withholds the route result
#          instead of reporting a traversal failure, because the last run could not tell a blocked route
#          from a Dog it never drove.
#
# WHY THIS ORDER. Night first: it is priority 1, it is the least measured, and the other lane's asset scale
# change means the figures' contribution to world light has just moved -- so this is the moment to read it.
# Water second, traversal third.
#
# All three hold world exposure's PINNED range and restore every cvar they touch. None of them saves the
# map. Each asserts world and pawn before every reading and aborts with died_at rather than measuring a
# world that is gone.
set -euo pipefail

WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"
TMP="C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/5b20cf79-e51b-4532-902f-47c18f55e76d/scratchpad"
JOBS="$WT/Tools/editor_jobs"
# STAGED INSIDE THE INBOX, UNDER A NON-.py NAME, AND RENAMED IN PLACE.
#
# Writing a job straight into the inbox is a RACE, and it fails silently in the worst possible way: the
# runner polls every 0.25 s and can pick a file up MID-WRITE. A truncated source still compiles, `job` is
# then defined without ever reaching a yield, so it is a plain function rather than a generator, `_start`
# finds no __next__ and finishes the job with status "running" and no error. Nothing logs, nothing raises.
# (Cost the other lane a whole capture run on 2026-09-27.)
#
# A rename is atomic; a copy is not. Staging under the scratchpad and moving into the inbox relies on both
# being the same volume -- true here today, and an assumption nobody would notice breaking. Staging INSIDE
# the inbox removes it: editor_channel skips any entry that does not end in .py, so a ".staging" file is
# invisible to the runner until the rename makes it a job, and the rename is same-directory by construction.
ST="$CH/inbox/._stage_wl.staging"
mkdir -p "$TMP"

HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat -- no runner listening" >&2; exit 1; }
AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
[ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale -- dead channel" >&2; exit 1; }
BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
[ "$BUSY" = "0" ] || { echo "a job is running ($BUSY) -- wait" >&2; exit 1; }

# ONE EDITOR, CHECKED. Two processes on one channel cost this project an hour today: they ate the same
# inbox, alternated the same heartbeat so it read as a crash loop, and put two writers on one .umap.
N=$(powershell.exe -NoProfile -Command "@(Get-Process UnrealEditor -ErrorAction SilentlyContinue).Count" 2>/dev/null | tr -d '\r\n ')
[ "$N" = "1" ] || { echo "editor count is '$N', expected exactly 1 -- refusing to queue" >&2; exit 1; }
echo "channel alive (heartbeat ${AGE}s, idle), exactly one editor"

queue() {   # queue <name> <header> <job>
  printf '%s\n\n' "$2" > "$ST"
  cat "$JOBS/$3" >> "$ST"
  [ "$(grep -c '^def job' "$ST")" = "1" ] || { echo "BAD JOB $1" >&2; return 1; }
  # PY_COMPILE, NOT AST.PARSE AND NOT NOTHING. ast.parse ACCEPTS a repeated keyword argument where the
  # compiler rejects it -- exactly how zzN3 reached the editor and errored on load with zero gates after
  # my own check waved it through. Anything that merely parses, or is not checked at all, is not known to
  # run; and a job that fails to load looks identical to a job that ran and found nothing.
  python -c "import py_compile,sys;py_compile.compile(sys.argv[1],doraise=True)" "$ST" \
    || { echo "STAGED $1 DOES NOT COMPILE -- not queueing it" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"
  echo "queued $1"
}

queue zzN1_night_sweep.py "" zc_night_sweep.py
queue zzN2_water_audit.py "" zc_water_audit.py
queue zzN3_nation_walk.py "" zc_nation_walk.py

echo
echo "queued 3. Check died_at is null on each before believing any number, and read zzN1's practicals line:"
echo "if it says the reporting path failed, the subsystem is still fine -- grep WLLIGHT in the editor log."
