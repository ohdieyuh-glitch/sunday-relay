#!/usr/bin/env bash
# Pull the latest V2 pass render from the Studio and build the side-by-side
# against the reference view -- run on the laptop after v2-shot.sh.
#
#   bash wonderland/v2/tools/pull_render.sh [OUT_DIR]
#
# scp DOWNLOADS work from this box (uploads silently do not -- see memory);
# the render history file names the pass.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HOME/wonderland-v2-renders}"
mkdir -p "$OUT"
HOST="${WL_HOST:-wonderland-l4}"
ROOT="${WL_REMOTE_ROOT:-/teamspace/studios/this_studio/wonderland}"
# the history also carries "PASS FPS ..." lines (v2-shot.sh); the render line is the one with a path
LINE="$(ssh "$HOST" "grep -v ' FPS ' $ROOT/run/v2-render-history.txt 2>/dev/null | tail -1" 2>/dev/null | grep -v hostkeys || true)"
FPS_LINE="$(ssh "$HOST" "grep ' FPS ' $ROOT/run/v2-render-history.txt 2>/dev/null | tail -1" 2>/dev/null | grep -v hostkeys || true)"
[ -n "$LINE" ] || { echo "no V2 render history on $HOST"; exit 1; }
PASS="${LINE%% *}"; REMOTE="${LINE#* }"
scp -q "$HOST:$REMOTE" "$OUT/$PASS.png" 2>/dev/null
[ -s "$OUT/$PASS.png" ] || { echo "download failed for $REMOTE"; exit 1; }
CAM=0; case "$REMOTE" in *cam1*) CAM=1;; esac
python3 "$HERE/compare_v2.py" "$OUT/$PASS.png" "$OUT/${PASS}_vs_reference.png" "--pass=$PASS" "--cam=$CAM"
# the MEASURED diff against the same reference view compare_v2 just used
REFVIEW="$OUT/reference_view_cam${CAM}.png"
if [ ! -s "$REFVIEW" ]; then
  # the same camera as the capture: yaw relative to +Y forward, pitch, fov from v2_config
  read -r YAW PITCH FOV < <(cd "$HERE/.." && python3 -c "import v2_config as C; c=C.HERO_CAMS[$CAM]; print(c['rotation'][1]-90.0, c['rotation'][0], c['fov'])")
  python3 "$HERE/reproject_reference.py" "$REFVIEW" "--yaw=$YAW" "--pitch=$PITCH" "--fov=$FOV" --size=1920x1080 >/dev/null
fi
if [ -s "${REFVIEW:-/nonexistent}" ]; then
  python3 "$HERE/diff_v2.py" "$OUT/$PASS.png" "$REFVIEW" "--json=$OUT/${PASS}_diff.json" | tee "$OUT/${PASS}_diff.txt"
fi
[ -n "$FPS_LINE" ] && echo "$FPS_LINE" | tee -a "$OUT/${PASS}_diff.txt"
echo "$OUT/${PASS}_vs_reference.png"
