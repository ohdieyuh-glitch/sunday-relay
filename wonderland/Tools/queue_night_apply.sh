#!/usr/bin/env bash
# APPLY THE THREE NIGHT-CORRECTION LAMP LAYERS, PREVIEW ONLY.
#
# SAVE=False on all three. The map is shared and a save writes EVERY unsaved change in it, not only the
# layer being applied -- the other lane hit exactly that today and correctly refused to clear a dirty flag
# by committing someone else's unknown in-memory actor to disk. These exist in memory for the after
# captures and nothing is written.
#
#   NQ06  Noctis avenue   15 lanterns   worst lamp-to-lamp gap 115 m -> 43 m
#   IQ06  Icarus avenue   21 lanterns   65 m -> 30 m
#   GA08  Golden Arrival  18 lanterns   78.3% of walkable ground beyond 15 m of a light -> 0.0%
#
# All three validated: every mesh and material resolves, batch ids present, only the stone post collides.
set -euo pipefail
WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"
JOBS="$WT/Tools/editor_jobs"
# Staged inside the inbox under a non-.py name and renamed in place: the runner skips anything not ending
# .py, so it cannot pick the file up mid-write, and a same-directory rename is atomic by construction.
ST="$CH/inbox/._stage_apply.staging"

HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat" >&2; exit 1; }
N=$(powershell.exe -NoProfile -Command "@(Get-Process UnrealEditor -ErrorAction SilentlyContinue).Count" 2>/dev/null | tr -d '\r\n ')
[ "$N" = "1" ] || { echo "editor count '$N', expected 1" >&2; exit 1; }
AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
[ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale" >&2; exit 1; }
BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
[ "$BUSY" = "0" ] || { echo "a job is running" >&2; exit 1; }

queue() {  # queue <name> <spec-path>
  printf 'SPEC = r"%s"\nSAVE = False\n\n' "$2" > "$ST"
  cat "$JOBS/apply_layer.py" >> "$ST"
  python -c "import py_compile,sys;py_compile.compile(sys.argv[1],doraise=True)" "$ST" \
    || { echo "STAGED $1 DOES NOT COMPILE" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"
  echo "queued $1"
}

queue zzA1_apply_nq06.py "$WT/WorldDesign/Nations/nq06_noctis_lamps.json"
queue zzA2_apply_iq06.py "$WT/WorldDesign/Nations/iq06_icarus_lamps.json"
queue zzA3_apply_ga08.py "$WT/WorldDesign/GoldenArrival/ga08_arrival_lamps.json"
echo
echo "Read save_refused and map_dirty_before on each: SAVE is False so nothing should be written, and"
echo "map_dirty_before names anything already unsaved that is not mine."
