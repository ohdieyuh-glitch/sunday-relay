#!/usr/bin/env bash
# One gauntlet ROUND from the laptop: capture on the Studio (GPU), pull each
# pass, build its side-by-side and measured diff. One command per round so the
# REFERENCE -> RENDER -> COMPARE loop costs a minute of attention, not ten.
#
#   bash wonderland/v2/tools/round.sh                 # kit, cam 0
#   WL_CAMS="0 1" bash wonderland/v2/tools/round.sh   # kit, cams 0 and 1
#   WL_MARBLE_VIEWS=1 WL_CAMS="2 5" bash .../round.sh # per cam: the MARBLE MESH alone
#                                                     # (reference) THEN the kit, compared to it
#
# Marble views use the packaged game's tag switches (C++): the Marble world
# shown, the authored kit hidden -- the "additional views of the same world",
# rendered in Unreal from the mesh we own, zero credits.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="${WL_STUDIO_HOST:-wonderland-l4}"
OUT="${1:-$HOME/wonderland-v2-renders}"
CAMS="${WL_CAMS:-0}"
SRC=/teamspace/studios/this_studio/wonderland/src
MARBLE_ARGS='-WLShowTags=MARBLE_REFERENCE_ONLY -WLHideTags=UNREAL_PRODUCTION,MARBLE_DISTANT_SCENIC'
say() { printf '\033[1;36m[round]\033[0m %s\n' "$*"; }
shoot() {  # cam, extra-args
  local cam="$1" extra="${2:-}"
  ssh "$HOST" "cd $SRC && WL_V2_CAM=$cam WL_EXTRA_ARGS='$extra' bash wonderland/infra/lightning/v2-shot.sh" 2>&1 \
    | grep -v hostkeys | grep -E "V2_PASS|performance|FPS|wl_die|FAIL|ERROR|HERO_CAM|WL_TAG" || true
}
for CAM in $CAMS; do
  REF=""
  if [ "${WL_MARBLE_VIEWS:-0}" = "1" ]; then
    say "cam $CAM: the Marble mesh alone (reference render)"
    shoot "$CAM" "$MARBLE_ARGS"
    bash "$HERE/pull_render.sh" "$OUT" >/dev/null
    REF="$(ls -t "$OUT"/V2_PASS_*_cam${CAM}_*.png 2>/dev/null | grep -v _vs_ | head -1)"
    [ -n "$REF" ] && cp "$REF" "$OUT/marble_view_cam${CAM}.png" && say "marble view -> $OUT/marble_view_cam${CAM}.png"
  fi
  say "cam $CAM: the authored kit"
  shoot "$CAM"
  WL_REF_IMAGE="${REF:+$OUT/marble_view_cam${CAM}.png}" bash "$HERE/pull_render.sh" "$OUT"
done
say "renders in $OUT"
ls -t "$OUT"/V2_PASS_*_vs_reference.png 2>/dev/null | head -3
