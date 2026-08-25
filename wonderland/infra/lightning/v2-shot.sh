#!/usr/bin/env bash
# WONDERLAND V2 — capture HeroCam_V2_Arrival from the packaged V2 build.
# NEEDS THE GPU (offscreen render on the L4). Say SWITCH LIGHTNING TO L4 NOW
# before this, and SAFE TO SWITCH LIGHTNING BACK TO CPU after the last capture.
#
#   bash wonderland/infra/lightning/v2-shot.sh            # -> $WL_OUT/shots/v2-<sha>-<n>.png
#   WL_EXTRA_EXEC="r.ScreenPercentage 150" bash ...        # extra console commands
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/common.sh"
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
export WL_HERO_CAM=0          # HeroCam_V2_Arrival carries the HeroCam0 tag for the capture path
export WL_RES_X="${WL_RES_X:-1920}"
export WL_RES_Y="${WL_RES_Y:-1080}"
bash "$HERE/native-shot.sh" "$@"
