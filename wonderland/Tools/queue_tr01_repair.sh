#!/usr/bin/env bash
# Queue the TR01 repair, in the one order that works, plus the traversal proof that decides whether it worked.
#
# THE REGRESSION. WorldDesign/Nations/tartarus_quarter.py took the pass id TR01, which
# GoldenArrival/tr01_clock_plaza_steps.py has held since the Golden Arrival was built. apply_layer deletes
# everything tagged WL_PASS_<id> before it writes, so applying the Tartarus quarter destroyed the stair.
#
# That stair was not decoration. Its own generator records why it exists: the garden path's flags end at
# y 4498 with their tops at z 92, the Clock Plaza's slabs start there with their tops at z -0.5, and the
# 92.5 cm drop between them is more than double UE's 45 cm max step. Without the stair a visitor who walks
# down from the palace end CANNOT WALK BACK UP to the garden, the arrival, and the map's first place. It was
# logged as private-beta gate item 3: no dead ends, no collision traps.
#
# Proven absent, not assumed: WL_PASS_TR01 counts 97 actors in the live map, and the Tartarus quarter alone
# is 80 batches + 17 anchors = 97. The stair's 2 batch actors are gone.
#
# ORDER MATTERS AND IT IS NOT THE OBVIOUS ONE. The removal is driven by the CLOCK PLAZA spec, because it is
# the file that still declares pass TR01 -- the quarter's own spec has already been renamed to TQ01, so it can
# no longer name the tag that needs clearing. Removing by the steps spec clears all 97 quarter actors; applying
# TQ01 puts the quarter back under its own id; applying the steps spec last restores the stair.
#
#   1  remove   WL_PASS_TR01            (97 actors: the whole Tartarus quarter, wrongly tagged)
#   2  apply    tq01_quarter.json       (the quarter returns as WL_PASS_TQ01)
#   3  apply    tr01_clock_plaza_steps.json   (the stair returns as WL_PASS_TR01, where it belongs)
#   4  profile  the floor across the seam, in PIE
#   5  WALK IT, up the stair, from the plaza to the garden
#
# Steps 4 and 5 are not optional and they are not the same test. The founder was explicit that TR01 is not
# repaired on generation output alone, and this project has already learned that editor-world traces do not see
# WonderlandInstancedBatch collision -- PIE is the only authority for whether a stair is something a player can
# stand on.
#
# But a floor profile only answers "is there a surface here". It samples the floor height at a series of points,
# and three 31 cm risers and one 92 cm wall both come back as a surface at every sample; only the SIZE of the
# rise distinguishes them, and a rise small enough to pass can still be a step UE's character movement refuses
# -- a capsule catches on a nosing, a tread is too shallow to stand on, a kerb wall pinches the flight. So the
# last word is a Dog actually walking UP it, in the direction the regression broke: the visitor at the plaza who
# could not get back to the garden. Short route, on purpose -- walk_route has hung this editor twice on long
# ones, and this one is 2.5 m.
set -euo pipefail

CH="C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp/channel"
TMP="C:/Users/Kaisi/.claude/jobs/ec4f540e/tmp"
JOBS="C:/dev/iwonder/wonderland-task3/wonderland/Tools/editor_jobs"
WD="C:/dev/iwonder/wonderland-task3/wonderland/WorldDesign"
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

queue() {  # queue <name> <header> <job file>
  printf '%s\n\n' "$2" > "$ST"
  cat "$JOBS/$3" >> "$ST"
  if [ "$(grep -c '^def job' "$ST")" != "1" ]; then echo "BAD JOB $1" >&2; return 1; fi
  mv "$ST" "$CH/inbox/$1"          # staged then MOVED: the runner polls the inbox and will happily
  echo "queued $1"                 # pick up a file that is still being written
}

queue zzP00_remove_tr01.py "SPEC = r\"$WD/GoldenArrival/tr01_clock_plaza_steps.json\"
REMOVE_ONLY = True
SAVE = True" apply_layer.py

queue zzP10_apply_tq01.py "SPEC = r\"$WD/Nations/tq01_quarter.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

queue zzP20_apply_steps.py "SPEC = r\"$WD/GoldenArrival/tr01_clock_plaza_steps.json\"
SAVE = True
MAP_WAS_DIRTY_OK = True" apply_layer.py

# The seam runs along Y at x=0: plaza (z about 0) below y 4498, garden path (z about 92) above it. Sampling
# 4700 -> 4380 crosses the whole flight with room either side, so the profile shows the approach, the three
# risers and the path beyond -- not just the fact that something is there.
queue zzP30_profile_steps.py "LINE = [0.0, 4700.0, 0.0, 4380.0]
SAMPLES = 80
Z_TOP = 400.0
Z_BOTTOM = -300.0
OUT = r\"$TMP/tr01_steps_profile.json\"" floor_profile.py

# Up the flight, not along it. Start on the plaza short of the bottom tread, facing -Y (yaw 270) toward the
# garden, and require the Dog to reach a waypoint ON the path above. Reaching it is the repair; failing to is
# the regression still being there, whatever the profile said.
queue zzP40_walk_steps.py "ROUTE = [[\"BottomTread\", 0.0, 4560.0], [\"TopOfFlight\", 0.0, 4470.0], [\"GardenPath\", 0.0, 4380.0]]
START = [0.0, 4660.0, 270.0]
TAG = \"tr01_stair\"
REACH_CM = 90.0
LEG_TIMEOUT = 30.0" walk_route.py

echo
echo "Queued. Expected AFTER the repair:"
echo "  profile  no rise over 45 cm anywhere on that line, and three risers near 31 cm each."
echo "           a single ~92 cm rise at y 4498 means the stair is still missing."
echo "  walk     all three waypoints reached. If the Dog stalls at BottomTread the surface exists but the"
echo "           flight is not climbable, which the profile alone would have called a pass."
