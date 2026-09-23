#!/usr/bin/env bash
# Queue the SECOND CIVILIZATION BAND: apply, save, audit, measure, and walk the three gates.
#
# Written 2026-09-23 while Internal Development held the editor, so that regaining the editor costs no
# thinking time. Run it once the editor is up from THIS worktree and the channel runner is live.
#
# WHAT LANDS. 9,797 instances over six passes, validated offline and clean on three independent gates:
#   IC03 2,044 (700 collide)   NC03 2,167 (693)   TQ03 2,284 (717)      -- the bands
#   IC04 1,044 (0)             NC04 1,142 (0)     TQ04 1,116 (0)        -- their detail
# Band radius 818.5..1158.3 m. 18 GVE anchors, six per nation, each from its own canonical gve_spaces.
#
# THE FIRST APPLY DOES NOT OVERRIDE THE DIRTY CHECK, ON PURPOSE. apply_layer refuses to save when the map
# already had unsaved changes before it touched anything, because a save writes EVERY unsaved change in the
# map and not only this layer's. That guard matters more here than usual: wonderland-proof/wonderland/Content
# is a junction onto this worktree's Content, so both worktrees are one physical map file. If step 10 refuses,
# another lane left work unsaved -- STOP and find out whose it is. Do not add MAP_WAS_DIRTY_OK to step 10.
# Steps after it set MAP_WAS_DIRTY_OK because by then the dirt is this script's own.
#
# ORDER. Bands before their detail, because the detail decorates the bands' walls. A checkpoint audit runs
# between the two halves rather than at the end only -- the founder's "independent checks between meaningful
# boundaries" -- so a bad band is caught before 3,302 pieces of trim are hung on it.
#
# MEASUREMENT BEFORE, NOT AFTER. Step 00 measures the world WITHOUT the band. There is no way to recover a
# baseline once the band is in, and "it feels fine" is not a frame time.
#
# TRAVERSAL. Each gate sits at r=824 m, at the inner edge of its own band, and its yaw is the outward radial:
# ICARUS 90 deg at (0, 82380), NOCTIS 210 deg at (-71343, -41190), TARTARUS 330 deg at (71343, -41190). The
# walks cross each gate from the first band into the second -- 10 m in, 10 m out, deliberately short, because
# walk_route has hung this editor twice on long routes. A profile and a walk are NOT the same test: a profile
# answers "is there a surface", a walk answers "can a player get through", and a gatehouse that is a wall with
# a doorway painted on it passes the first and fails the second. This project has already shipped that bug once.
set -euo pipefail

CH="C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/channel"
TMP="C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp"
JOBS="C:/dev/iwonder/wonderland-task3/wonderland/Tools/editor_jobs"
WD="C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign"
ST="$TMP/_stage_job.py"

# LIVENESS, NOT EXISTENCE. An inbox directory outlives the editor that made it: this channel's last entry
# was a zzQ80_quit from the night before. Testing for the directory let a dry run stage three real jobs --
# including an apply -- into an inbox nobody was watching, where the next editor to attach would have run
# them unasked, against a map another lane shares through a Content junction. The runner writes
# heartbeat.json every 2 s, so that, and its freshness, is the only honest proof someone is listening.
HB="$CH/heartbeat.json"
if [ ! -f "$HB" ]; then
  echo "no heartbeat at $HB -- no channel runner is listening. Start the editor from THIS worktree first." >&2
  exit 1
fi
AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
if [ "$AGE" -gt 30 ]; then
  echo "heartbeat is ${AGE}s stale -- the editor that wrote it is gone. Refusing to queue into a dead channel." >&2
  exit 1
fi
echo "channel runner alive (heartbeat ${AGE}s old)"

queue() {  # queue <name> <header> <job file>
  printf '%s\n\n' "$2" > "$ST"
  cat "$JOBS/$3" >> "$ST"
  if [ "$(grep -c '^def job' "$ST")" != "1" ]; then echo "BAD JOB $1" >&2; return 1; fi
  mv "$ST" "$CH/inbox/$1"          # staged then MOVED: the runner polls the inbox and will happily
  echo "queued $1"                 # pick up a file that is still being written
}

# ---- 00  baseline, before anything lands ---------------------------------------------------------------
queue zzB00_perf_before.py "LABEL = \"world before the second band\"
SECONDS = 12.0
WARM = True
OUT = r\"$TMP/band_perf_before.json\"" perf_frames.py

# ---- 05..08  the FIRST band's collision fix, which the live world does not have yet -----------------
# 262697fc removed 101 nested collision bodies from IC01/IC02/NC01/TQ01 by consolidating a rule that had been
# copied into four generators and drifted in three. Those are APPLIED passes: the spec is fixed on disk and
# the world is not, until each is re-applied. apply_layer deletes a pass's own actors before rewriting them,
# so re-applying is exact rather than additive. Doing it BEFORE the second band keeps one save boundary
# between "the world as it was" and "the world with 9,797 new instances".
queue zzB05_reapply_ic01.py "SPEC = r\"$WD/Nations/ic01_march.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

queue zzB06_reapply_ic02.py "SPEC = r\"$WD/Nations/ic02_district.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

queue zzB07_reapply_nc01.py "SPEC = r\"$WD/Nations/nc01_quarter.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

queue zzB08_reapply_tq01.py "SPEC = r\"$WD/Nations/tq01_quarter.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

# ---- 10..12  the three bands --------------------------------------------------------------------------
# NOTE: step 10 deliberately omits MAP_WAS_DIRTY_OK. See the header.
queue zzB10_apply_ic03.py "SPEC = r\"$WD/Nations/ic03_band.json\"
SAVE = True" apply_layer.py

queue zzB11_apply_nc03.py "SPEC = r\"$WD/Nations/nc03_band.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

queue zzB12_apply_tq03.py "SPEC = r\"$WD/Nations/tq03_band.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

# ---- 20  checkpoint: are the bands right BEFORE trim is hung on them? ---------------------------------
queue zzB20_collision_mid.py "OUT = r\"$TMP/band_collision_mid.json\"" collision_audit.py

# ---- 30..32  their detail -----------------------------------------------------------------------------
queue zzB30_apply_ic04.py "SPEC = r\"$WD/Nations/ic04_band_detail.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

queue zzB31_apply_nc04.py "SPEC = r\"$WD/Nations/nc04_band_detail.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

queue zzB32_apply_tq04.py "SPEC = r\"$WD/Nations/tq04_band_detail.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

# ---- 40..41  what actually landed ---------------------------------------------------------------------
queue zzB40_collision_after.py "OUT = r\"$TMP/band_collision_after.json\"" collision_audit.py
queue zzB41_world_audit.py "OUT = r\"$TMP/band_world_audit.json\"" world_audit.py

# ---- 50  the same measurement, with the band in -------------------------------------------------------
queue zzB50_perf_after.py "LABEL = \"world with the second band\"
SECONDS = 12.0
WARM = True
OUT = r\"$TMP/band_perf_after.json\"" perf_frames.py

# ---- 60..62  the three gate seams: is there a surface? ------------------------------------------------
queue zzB60_profile_ic_gate.py "LINE = [0.0, 81880.0, 0.0, 82880.0]
SAMPLES = 60
Z_TOP = 400.0
Z_BOTTOM = -400.0
OUT = r\"$TMP/band_profile_icarus_gate.json\"" floor_profile.py

queue zzB61_profile_nc_gate.py "LINE = [-70477.0, -40690.0, -72209.0, -41690.0]
SAMPLES = 60
Z_TOP = 400.0
Z_BOTTOM = -400.0
OUT = r\"$TMP/band_profile_noctis_gate.json\"" floor_profile.py

queue zzB62_profile_tq_gate.py "LINE = [70477.0, -40690.0, 72209.0, -41690.0]
SAMPLES = 60
Z_TOP = 400.0
Z_BOTTOM = -400.0
OUT = r\"$TMP/band_profile_tartarus_gate.json\"" floor_profile.py

# ---- 65  the plaza medallion: is its paving a surface, or is the ground under it? --------------------
# The one nested-collision case left open by 262697fc. IC02 and NC01 let the medallion's paving layers
# collide; the second band treats the same medallion as flat inlay and does not. One of them is wrong. These
# are 1.8-6 cm discs a player walks ON, so the risk of guessing is a hole in a plaza floor, and disk cannot
# tell a flush inlay from a proud one. This line crosses the IC02 medallion at (0, 79450), 844 cm across.
# Continuous floor either way -> the second band's non-colliding treatment is right and IC02/NC01 follow it.
# A dip where the medallion sits -> that collision is load-bearing and stays.
queue zzB65_profile_medallion.py "LINE = [-700.0, 79450.0, 700.0, 79450.0]
SAMPLES = 70
Z_TOP = 300.0
Z_BOTTOM = -300.0
OUT = r\"$TMP/band_profile_medallion.json\"" floor_profile.py

# ---- 70..72  the same three seams: can a player get THROUGH? -----------------------------------------
queue zzB70_walk_ic_gate.py "ROUTE = [[\"GateMouth\", 0.0, 82380.0], [\"InsideBand\", 0.0, 82880.0]]
START = [0.0, 81880.0, 90.0]
TAG = \"ic03_gate\"
REACH_CM = 120.0
LEG_TIMEOUT = 40.0" walk_route.py

queue zzB71_walk_nc_gate.py "ROUTE = [[\"GateMouth\", -71343.0, -41190.0], [\"InsideBand\", -72209.0, -41690.0]]
START = [-70477.0, -40690.0, 210.0]
TAG = \"nc03_gate\"
REACH_CM = 120.0
LEG_TIMEOUT = 40.0" walk_route.py

queue zzB72_walk_tq_gate.py "ROUTE = [[\"GateMouth\", 71343.0, -41190.0], [\"InsideBand\", 72209.0, -41690.0]]
START = [70477.0, -40690.0, 330.0]
TAG = \"tq03_gate\"
REACH_CM = 120.0
LEG_TIMEOUT = 40.0" walk_route.py

echo
echo "Queued 22 jobs. What each answer should look like:"
echo "  B10 REFUSING TO SAVE is not a bug -- it means the map was already dirty when this started, and"
echo "      another lane's unsaved work is in it. Stop and find out whose. Do NOT add MAP_WAS_DIRTY_OK."
echo "  B20 vs B40  colliding instances should rise by about 2,110 across the three bands and NOT rise"
echo "      again for the detail: IC04/NC04/TQ04 are trim and must contribute zero."
echo "  B50 vs B00  the cost of 9,797 instances. Judge the delta, never the absolute."
echo "  B60-62  a surface the whole way, no rise over 45 cm at the gate mouth."
echo "  B70-72  BOTH waypoints reached at all three gates. A profile that passes and a walk that stalls"
echo "      means the gate is a wall with a doorway painted on it -- exactly the d164a56b regression."
