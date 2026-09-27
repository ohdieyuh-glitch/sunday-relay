#!/usr/bin/env bash
# THE MASCOT RESPONSE SWEEP, in four short runs instead of one long one.
#
# The first attempt swept three hours and both axes in a single PIE session, needed ten minutes, and PIE was
# torn down underneath it at 1m43s -- after which it "measured" a dead world for two more minutes and
# published the luma of a black viewport through nine gates. Two things came out of that: the job now
# asserts the world and the pawn before every reading and aborts if either is gone, and the sweep is split
# so no PIE session has to live longer than about four minutes.
#
#   M1  eye axis, DAY     8 skins x 5 levels = 40 captures
#   M2  eye axis, DUSK    40
#   M3  eye axis, NIGHT   40
#   M4  knee axis, noon   8 skins x 7 knees = 56
#
# Each run restores every cvar it touched (GlowKnee 700, EyeGlowDay 18, EyeGlowNight 5, FlameDim 0.40,
# NightGlow 0.20) so the other lane's gates behind it start from the shipped state.
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
ST="$CH/inbox/._stage_ms.staging"
mkdir -p "$TMP"

HB="$CH/heartbeat.json"
[ -f "$HB" ] || { echo "no heartbeat -- no runner listening" >&2; exit 1; }
AGE=$(( $(date +%s) - $(date -r "$HB" +%s) ))
[ "$AGE" -le 30 ] || { echo "heartbeat ${AGE}s stale -- dead channel" >&2; exit 1; }
BUSY=$(python -c "import json,sys;print(len(json.load(open(sys.argv[1]))['jobs']))" "$HB")
[ "$BUSY" = "0" ] || { echo "a job is running ($BUSY) -- wait" >&2; exit 1; }
echo "channel alive (heartbeat ${AGE}s, idle)"

queue() {   # queue <name> <header>
  printf '%s\n\n' "$2" > "$ST"
  cat "$JOBS/zc_mascot_knee.py" >> "$ST"
  [ "$(grep -c '^def job' "$ST")" = "1" ] || { echo "BAD JOB $1" >&2; return 1; }
  mv "$ST" "$CH/inbox/$1"
  echo "queued $1"
}

queue zzM1_eye_day.py   'AXIS = "eye"
HOUR = 12.0
HOUR_LABEL = "day"'
queue zzM2_eye_dusk.py  'AXIS = "eye"
HOUR = 18.8
HOUR_LABEL = "dusk"'
queue zzM3_eye_night.py 'AXIS = "eye"
HOUR = 23.5
HOUR_LABEL = "night"'
queue zzM4_knee.py      'AXIS = "knee"
HOUR = 12.0
HOUR_LABEL = "day"'

echo
echo "queued 4. Read each result together with its WLCHANNEL finished line, and check died_at is null"
echo "before believing any number -- a run that aborted reports where, and its table is incomplete by design."
