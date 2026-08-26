#!/usr/bin/env bash
# One gauntlet ROUND from the laptop: capture the hero camera(s) on the Studio
# (GPU), pull each pass, build its side-by-side and measured diff. One command
# per round so the REFERENCE -> RENDER -> COMPARE loop costs a minute of
# attention, not ten.
#
#   bash wonderland/v2/tools/round.sh            # cam 0 only
#   WL_CAMS="0 1" bash wonderland/v2/tools/round.sh
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="${WL_STUDIO_HOST:-wonderland-l4}"
OUT="${1:-$HOME/wonderland-v2-renders}"
CAMS="${WL_CAMS:-0}"
SRC=/teamspace/studios/this_studio/wonderland/src
for CAM in $CAMS; do
  printf '\033[1;36m[round]\033[0m capturing cam %s on %s\n' "$CAM" "$HOST"
  ssh "$HOST" "cd $SRC && WL_V2_CAM=$CAM bash wonderland/infra/lightning/v2-shot.sh" 2>&1 \
    | grep -v hostkeys | grep -E "V2_PASS|performance|FPS|wl_die|FAIL|ERROR|shot" || true
  bash "$HERE/pull_render.sh" "$OUT"
done
printf '\033[1;36m[round]\033[0m renders in %s\n' "$OUT"
ls -t "$OUT"/V2_PASS_*_vs_reference.png 2>/dev/null | head -2
