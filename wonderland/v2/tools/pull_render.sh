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
LINE="$(ssh "$HOST" "tail -1 $ROOT/run/v2-render-history.txt 2>/dev/null" 2>/dev/null | grep -v hostkeys || true)"
[ -n "$LINE" ] || { echo "no V2 render history on $HOST"; exit 1; }
PASS="${LINE%% *}"; REMOTE="${LINE#* }"
scp -q "$HOST:$REMOTE" "$OUT/$PASS.png" 2>/dev/null
[ -s "$OUT/$PASS.png" ] || { echo "download failed for $REMOTE"; exit 1; }
CAM=0; case "$REMOTE" in *cam1*) CAM=1;; esac
python3 "$HERE/compare_v2.py" "$OUT/$PASS.png" "$OUT/${PASS}_vs_reference.png" "--pass=$PASS" "--cam=$CAM"
echo "$OUT/${PASS}_vs_reference.png"
