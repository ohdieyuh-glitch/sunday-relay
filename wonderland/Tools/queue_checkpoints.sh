#!/usr/bin/env bash
# Queue CP01-CP05: the five TERRITORY CHECKPOINTS -- apply, save, and prove them as places.
#
# WHAT LANDS. 3,023 instances over five passes, 49 of them colliding, ~1.6 M triangles -- 1.5% of the
# world's 114.6 M. Validated offline against mesh_inventory and the Materials/Instances folder: every mesh
# and every material resolves, and the nested-collision gate is clean.
#
#   CP01 arrival       23 instances   a fingerpost only; the arrival court is accepted work and is not paved
#   CP02 ICARUS       872             bay, court plate, fingerpost, 74 m tower, lanterns, overlook
#   CP03 NOCTIS       872             the same, in obsidian, with the luminous accent on the glass
#   CP04 TARTARUS     874             the same, in crimson; its own chain stacks to 53 m, not 74
#   CP05 DUBEL        382             a clearing, a fingerpost, and a tower that clears the canopy
#
# THE MAP IS CHECKPOINTED FIRST AND THAT IS NOT A FORMALITY. Content/ is untracked by git and shared between
# every worktree by junction, so the only rollback a save has is a file copy. The newest existing checkpoint
# holds the PRE-CONVERSION 46 MB monolith -- restoring it would undo the World Partition conversion as well
# as this pass. checkpoint_map.sh takes the post-conversion shape: the stub, its ini, its HLOD layers, and
# the 177 MB of external actors that are where the world actually lives.
#
# THE FIRST APPLY DOES NOT OVERRIDE THE DIRTY CHECK, ON PURPOSE. apply_layer refuses to save when the map
# already had unsaved changes before it touched anything, because a save writes EVERY unsaved change and not
# only this layer's. If step 10 refuses, another lane has unsaved work in this map -- STOP and find out
# whose. Do not add MAP_WAS_DIRTY_OK to step 10. The later steps set it because by then the dirt is ours.
#
# MEASUREMENT BEFORE, NOT AFTER. Step 00 measures the world without the checkpoints. There is no way to
# recover a baseline once they are in, and "it still feels fine" is not a frame time.
set -euo pipefail

WT="C:/dev/iwonder/wonderland-task3/wonderland"
CH="$WT/Tools/_channel"
TMP="C:/Users/Kaisi/AppData/Local/Temp/claude/C--Users-Kaisi/5b20cf79-e51b-4532-902f-47c18f55e76d/scratchpad"
JOBS="$WT/Tools/editor_jobs"
WD="$WT/WorldDesign"
ST="$TMP/_stage_job.py"
mkdir -p "$TMP"

# LIVENESS, NOT EXISTENCE. An inbox directory outlives the editor that made it. The runner writes
# heartbeat.json every 2 s, so its freshness is the only honest proof that someone is listening -- and
# queueing an APPLY into an unwatched inbox means the next editor to attach runs it unasked.
HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat at $HB -- no channel runner is listening." >&2; exit 1; }
AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
[ "$AGE" -le 30 ] || { echo "heartbeat is ${AGE}s stale -- refusing to queue into a dead channel." >&2; exit 1; }
BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
[ "$BUSY" = "0" ] || { echo "a job is running right now ($BUSY). Wait for the channel to go quiet." >&2; exit 1; }
echo "channel runner alive (heartbeat ${AGE}s old, no job running)"

queue() {   # queue <name> <header> <job file>
  printf '%s\n\n' "$2" > "$ST"
  cat "$JOBS/$3" >> "$ST"
  [ "$(grep -c '^def job' "$ST")" = "1" ] || { echo "BAD JOB $1" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"        # staged then MOVED: the runner polls every 0.25 s and would happily
  echo "queued $1"               # pick up a file that is still being written
}

# ---- 00  the world before the checkpoints ---------------------------------------------------------------
queue zzC00_perf_before.py "LABEL = \"world before the territory checkpoints\"
SECONDS = 12.0
WARM = True
OUT = r\"$TMP/cp_perf_before.json\"" perf_frames.py

# ---- 10..14  the five passes ----------------------------------------------------------------------------
queue zzC10_cp01.py "SPEC = r\"$WD/Districts/cp01_arrival_checkpoint.json\"
SAVE = True" apply_layer.py

for n in 02:11:icarus 03:12:noctis 04:13:tartarus 05:14:dubel; do
  CP="${n%%:*}"; REST="${n#*:}"; STEP="${REST%%:*}"; NAME="${REST#*:}"
  queue "zzC${STEP}_cp${CP}.py" "SPEC = r\"$WD/Districts/cp${CP}_${NAME}_checkpoint.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py
done

# ---- 20  are they PLACES? floor, flatness, the march, the landmark, and the night -----------------------
# A count of instances applied proves none of what matters. This is the gate.
queue zzC20_checkpoints.py "" zc_checkpoints.py

# ---- 30  the world after ---------------------------------------------------------------------------------
queue zzC30_perf_after.py "LABEL = \"world with the territory checkpoints\"
SECONDS = 12.0
WARM = True
OUT = r\"$TMP/cp_perf_after.json\"" perf_frames.py

echo
echo "queued 8 jobs. Results land in $CH/done/ ; captures in $WT/Tools/captures/zc/checkpoints/"
echo "Read zzC20_checkpoints.json together with the WLCHANNEL finished line that produced it --"
echo "a green can outlive its run."
