#!/usr/bin/env bash
# WONDERLAND V2 — capture a hero camera from the packaged V2 build, as a
# numbered PASS in the render history. NEEDS THE GPU (offscreen render on the
# L4): say SWITCH LIGHTNING TO L4 NOW before, SAFE TO SWITCH LIGHTNING BACK
# TO CPU after the last capture of the session.
#
#   bash wonderland/infra/lightning/v2-shot.sh            # HeroCam_V2_MarbleReference (cam 0)
#   WL_V2_CAM=1 bash .../v2-shot.sh                       # HeroCam_V2_GateView
#   -> $WL_OUT/shots/V2_PASS_003_cam0_<sha>.png  (the pass number increments per capture)
#
# Then on the laptop:  python3 wonderland/v2/tools/compare_v2.py <png> <out> --pass=V2_PASS_003
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/common.sh"
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
export WL_HERO_CAM="${WL_V2_CAM:-0}"
export WL_RES_X="${WL_RES_X:-1920}"
export WL_RES_Y="${WL_RES_Y:-1080}"
COUNTER="$WL_RUN/v2-pass.counter"
N=$(( $(cat "$COUNTER" 2>/dev/null || echo 0) + 1 ))
echo "$N" > "$COUNTER"
PASS="$(printf 'V2_PASS_%03d' "$N")"
wl_say "$PASS: capturing HeroCam$WL_HERO_CAM"
bash "$HERE/native-shot.sh" "$@"
LATEST="$(ls -t "$WL_OUT"/shots/*.png 2>/dev/null | head -1 || true)"
if [ -n "$LATEST" ]; then
  DST="$WL_OUT/shots/${PASS}_cam${WL_HERO_CAM}_$(basename "$LATEST")"
  cp "$LATEST" "$DST"
  wl_say "$PASS -> $DST"
  echo "$PASS $DST" >> "$WL_RUN/v2-render-history.txt"
fi
