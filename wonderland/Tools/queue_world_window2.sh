#!/usr/bin/env bash
# WORLD WINDOW 2: the corrected checkpoints, the avenues, and the four proofs the founder asked for.
#
# Runs once the editor is back up on a build that has UWonderlandPracticalLightsSubsystem in it. Order:
#   00  perf baseline
#   10  re-apply CP01-05 on the corrected ground (apply_layer removes a pass's own actors first, so this is
#       exact, not additive) -- CP01 WITHOUT the dirty override so another lane's unsaved work stops it
#   20  apply AV01-03, the gate-to-band avenues
#   30  zc_checkpoints v2      -- floor, flatness at 10 uu, march, landmark, night, WITH streaming polled
#   40  zc_nation_walk         -- the Dog walks each avenue under its own locomotion (QA-8's acceptance)
#   50  zc_night_sweep         -- founder night item: seven places x nine moon/sky/practical settings
#   60  zc_water_audit         -- founder water item: the material's inventory + nine views
#   70  perf after
# Two map saves (after 14 and after 22). The map was checkpointed before window 1
# (recovery/_map_checkpoints/2026-09-27-checkpoints-cp01-05) and that checkpoint still restores to the
# world as it was before any of this.
set -euo pipefail

WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"
TMP="C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/5b20cf79-e51b-4532-902f-47c18f55e76d/scratchpad"
JOBS="$WT/Tools/editor_jobs"
WD="$WT/WorldDesign"
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
ST="$CH/inbox/._stage_job.staging"
mkdir -p "$TMP"

HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat at $HB" >&2; exit 1; }
AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
[ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale -- dead channel" >&2; exit 1; }
BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
[ "$BUSY" = "0" ] || { echo "a job is running ($BUSY). Wait." >&2; exit 1; }
echo "channel alive (heartbeat ${AGE}s old, idle)"

queue() {
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

queue zzW00_perf_before.py "LABEL = \"world before window 2\"
SECONDS = 12.0
WARM = True
OUT = r\"$TMP/w2_perf_before.json\"" perf_frames.py

queue zzW10_cp01.py "SPEC = r\"$WD/Districts/cp01_arrival_checkpoint.json\"
SAVE = False" apply_layer.py
for n in 02:11:icarus 03:12:noctis 04:13:tartarus 05:14:dubel; do
  CP="${n%%:*}"; R="${n#*:}"; STEP="${R%%:*}"; NAME="${R#*:}"
  queue "zzW${STEP}_cp${CP}.py" "SPEC = r\"$WD/Districts/cp${CP}_${NAME}_checkpoint.json\"
SAVE = $([ "$CP" = "05" ] && echo True || echo False)
MAP_WAS_DIRTY_OK = True" apply_layer.py
done

for n in 01:20:icarus 02:21:noctis 03:22:tartarus; do
  AV="${n%%:*}"; R="${n#*:}"; STEP="${R%%:*}"; NAME="${R#*:}"
  queue "zzW${STEP}_av${AV}.py" "SPEC = r\"$WD/Nations/av${AV}_${NAME}_avenue.json\"
SAVE = $([ "$AV" = "03" ] && echo True || echo False)
MAP_WAS_DIRTY_OK = True" apply_layer.py
done

queue zzW30_checkpoints.py "" zc_checkpoints.py
queue zzW40_nation_walk.py "" zc_nation_walk.py
queue zzW50_night_sweep.py "" zc_night_sweep.py
queue zzW60_water_audit.py "" zc_water_audit.py

queue zzW70_perf_after.py "LABEL = \"world after window 2\"
SECONDS = 12.0
WARM = True
OUT = r\"$TMP/w2_perf_after.json\"" perf_frames.py

echo
echo "queued 13 jobs; two saves (after cp05, after av03). Results in $CH/done/zzW*.json"
