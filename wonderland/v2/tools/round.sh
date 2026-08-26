#!/usr/bin/env bash
# One gauntlet ROUND from the laptop, through the capture path that is TRUE on
# this box: the Pixel-Streaming frame captured in real Chrome
# (capture-hero-shots.sh -> shot.cjs). HighResShot is a phantom here (all-zero
# frames, measured 2026-08-26), so v2-shot/native-shot are not used for frames.
#
#   bash wonderland/v2/tools/round.sh                    # kit, cam 0
#   WL_CAMS="0 1" bash wonderland/v2/tools/round.sh      # kit, cams 0 and 1
#   WL_MARBLE_VIEWS=1 WL_CAMS="2 5" bash .../round.sh    # per cam: the MARBLE MESH alone
#                                                        # (reference) THEN the kit, compared to it
#   WL_EXEC_CMDS="..." ...                               # console commands for a diagnostic pass
#
# Each capture is a numbered V2_PASS in the Studio's history (run/v2-pass.counter),
# copied to packaged/shots/, frame-checked (verdict must not be FAIL), pulled,
# compared and diffed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
HOST="${WL_STUDIO_HOST:-wonderland-l4}"
OUT="${1:-$HOME/wonderland-v2-renders}"
CAMS="${WL_CAMS:-0}"
R=/teamspace/studios/this_studio/wonderland
SRC=$R/src
MARBLE_ARGS='-WLShowTags=MARBLE_REFERENCE_ONLY -WLHideTags=UNREAL_PRODUCTION,MARBLE_DISTANT_SCENIC'
say() { printf '\033[1;36m[round]\033[0m %s\n' "$*"; }
SHA="$(ssh "$HOST" "cat $R/packaged/packaged.sha 2>/dev/null | head -1" 2>/dev/null | grep -v hostkeys | tr -dc 'a-f0-9')"
[ -n "$SHA" ] || { echo "no packaged.sha on $HOST -- nothing to capture from"; exit 1; }
say "packaged build $SHA"
shoot() {  # cam, extra-args, label -> registers a pass; prints its name
  local cam="$1" extra="${2:-}" label="${3:-kit}"
  ssh "$HOST" "cd $SRC && WL_HERO_CAMS=$cam WL_RES_X=${WL_RES_X:-1920} WL_RES_Y=${WL_RES_Y:-1080} WL_BRANCH=relay/wonderland-v2 \
      WL_REQUIRE_SHA=$SHA SKIP_PREPARE=1 SKIP_BUILD=1 WL_EXTRA_ARGS='$extra' WL_EXEC_CMDS='${WL_EXEC_CMDS:-}' \
      bash wonderland/infra/lightning/capture-hero-shots.sh 2>&1 | grep -E 'captured|could not be measured|ERROR|wl_die' | tail -2;
    F=\$(ls -t $R/proof/captures/hero${cam}-*.png 2>/dev/null | head -1); [ -n \"\$F\" ] || { echo NO-FRAME; exit 0; };
    V=\$(python3 wonderland/infra/lightning/frame-check.py \"\$F\" | grep -E '^(verdict|luma_mean)=' | tr '\\n' ' ');
    N=\$(( \$(cat $R/run/v2-pass.counter 2>/dev/null || echo 0) + 1 )); echo \$N > $R/run/v2-pass.counter; P=\$(printf 'V2_PASS_%03d' \$N);
    mkdir -p $R/packaged/shots; D=$R/packaged/shots/\${P}_cam${cam}_${label}.png; cp \"\$F\" \"\$D\";
    echo \"\$P \$D\" >> $R/run/v2-render-history.txt; echo \"REGISTERED \$P \$V\"" 2>&1 | grep -v hostkeys
  if [ "${WL_V2_FPS:-1}" != "0" ] && [ "$label" = "kit" ]; then
    ssh "$HOST" "cd $SRC && WL_REQUIRE_SHA=$SHA WL_HERO_CAM=$cam WL_FPS_FRAMES=${WL_FPS_FRAMES:-300} bash wonderland/infra/lightning/measure-fps.sh 2>&1 | tail -3 | tr '\\n' ' '; echo" 2>&1 | grep -v hostkeys | sed 's/^/  fps: /' \
      | tee -a /dev/stderr | sed 's/^  fps: //' | xargs -I{} ssh "$HOST" "echo 'FPS cam${cam} {}' >> $R/run/v2-render-history.txt" 2>/dev/null || true
  fi
}
for CAM in $CAMS; do
  REF=""
  if [ "${WL_MARBLE_VIEWS:-0}" = "1" ]; then
    say "cam $CAM: the Marble mesh alone (reference render)"
    shoot "$CAM" "$MARBLE_ARGS" marble
    bash "$HERE/pull_render.sh" "$OUT" >/dev/null || true
    REF="$(ls -t "$OUT"/V2_PASS_*_cam${CAM}_marble.png 2>/dev/null | head -1)"
    [ -n "$REF" ] && cp "$REF" "$OUT/marble_view_cam${CAM}.png" && say "marble view -> $OUT/marble_view_cam${CAM}.png"
  fi
  say "cam $CAM: the authored kit"
  shoot "$CAM" "" kit
  WL_REF_IMAGE="${REF:+$OUT/marble_view_cam${CAM}.png}" bash "$HERE/pull_render.sh" "$OUT" || true
done
say "renders in $OUT"
ls -t "$OUT"/V2_PASS_*_vs_reference.png 2>/dev/null | head -3
