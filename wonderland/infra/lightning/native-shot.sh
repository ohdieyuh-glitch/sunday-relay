#!/usr/bin/env bash
# A frame that NEVER TOUCHED THE STREAM, for the blur question.
#
# THE DIAGNOSIS THIS EXISTS FOR
#
# "Wonderland is too soft" has two completely different causes and they need
# opposite fixes:
#
#   A. the RENDERER is soft — TSR history, screen percentage, texture mips,
#      fog, DOF, the Marble mesh's own texture resolution;
#   B. the STREAM is soft — H264 quantisation, bitrate ceiling, encoder
#      preset, the decode path in the browser.
#
# Every sharpness measurement this project has taken came off a Pixel Streaming
# capture, which cannot tell them apart. Turning renderer knobs to fix an
# encoder problem is work that cannot succeed, and a whole session has already
# gone into sweeping sharpen values against a frame that had been through H264.
#
# So: the same camera, the same build, the same world, rendered to a PNG by the
# engine itself with no encoder anywhere in the path. Compare it with the
# streamed frame and the answer is arithmetic instead of opinion.
#
# WHY NOT THE ENGINE'S OWN SCREENSHOT REQUEST
#
# FScreenshotRequest in this configuration is a PHANTOM: it returns success and
# writes an empty buffer. That cost a session. HighResShot is a different path
# (it goes through the movie-scene capture pipeline) and it does write — but it
# is trusted here exactly as far as the file it produces, which is checked for
# real image structure before anything is claimed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

CAM="${WL_HERO_CAM:-6}"
RES_X="${WL_RES_X:-1920}"
RES_Y="${WL_RES_Y:-1080}"
# WL_EXTRA_EXEC prepends console commands to the capture. It exists for ONE
# purpose nothing else in this project can serve: separating "the material is
# wrong" from "the material is right and the lighting or post is eating it".
#
# The runtime probe in WonderlandInstancedBatch.cpp can prove what BaseColor the
# component's bound material reports. It cannot prove what the renderer did with
# it afterwards. `ShowFlag.Lighting 0` renders BaseColor with no lighting at all,
# so a frame captured that way is the albedo the renderer actually holds -- and
# comparing it against the lit frame turns a fourteenth hypothesis into
# arithmetic.
#
#   WL_EXTRA_EXEC="ShowFlag.Lighting 0, ShowFlag.Fog 0, ShowFlag.Bloom 0"
OUT_DIR="${WL_NATIVE_DIR:-$WL_PROOF/native}"
mkdir -p "$OUT_DIR"

SHA_FILE="$WL_OUT/logs/compiled.sha"
[ -f "$SHA_FILE" ] || wl_die "no $SHA_FILE — a native frame that cannot be attributed to a build is a picture, not evidence."
BUILD_SHA="$(tr -d '[:space:]' < "$SHA_FILE")"
SHORT="${BUILD_SHA:0:7}"

APP="$(wl_find_first "$WL_OUT/Linux" -maxdepth 3 -name 'Wonderland.sh' -type f)"
[ -n "${APP:-}" ] || wl_die "no packaged Wonderland.sh under $WL_OUT/Linux"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SHOT_DIR="$WL_OUT/Linux/Wonderland/Saved/Screenshots"
rm -rf "$SHOT_DIR"

wl_say "native capture: HeroCam$CAM at ${RES_X}x${RES_Y}, build $SHORT, NO stream in the path"

# -RenderOffscreen so it runs headless; NO PixelStreamingURL, so nothing is
# encoded. HighResShot fires after a settle, then the app is told to quit.
# THE VULKAN ENVIRONMENT MUST BE APPLIED HERE TOO. It was not, and that is a
# real defect this path hit on a real machine: after a CPU -> L4 switch the
# Studio had the NVIDIA userspace driver but no ICD manifest anywhere, so the
# loader reported VK_ERROR_INCOMPATIBLE_DRIVER and Unreal segfaulted inside
# RHIInit before a single frame existed. run-stream.sh survived it because it
# wraps its launch in wl_vulkan_env_pairs; this script did not, so the ONE
# capture path with no encoder in it -- the path the look is actually judged
# on -- was the only one that could not start.
#
# Wrapped with env(1) around this process alone, never exported, for the same
# reason run-stream.sh gives: a global VK_DRIVER_FILES on a shared machine
# redirects every other GPU program on it.
setsid nohup env $(wl_vulkan_env_pairs) "$APP" \
  -RenderOffscreen -ForceRes "-ResX=$RES_X" "-ResY=$RES_Y" \
  -Unattended -stdout -FullStdOutLogOutput \
  -CinematicView "-HeroCam=$CAM" \
  "-ExecCmds=${WL_EXTRA_EXEC:+$WL_EXTRA_EXEC, }r.HighResScreenshotDelay 180, HighResShot ${RES_X}x${RES_Y}" \
  >"$WL_LOG/native-$CAM.log" 2>&1 </dev/null &
APP_PID=$!

# Wait for a PNG to appear, then a moment more so it is fully written.
FOUND=""
for _ in $(seq 1 90); do
  FOUND="$( ( set +o pipefail; find "$SHOT_DIR" -name '*.png' -size +10k 2>/dev/null | head -1 ) || true)"
  [ -n "$FOUND" ] && break
  sleep 2
done
sleep 3
kill "$APP_PID" 2>/dev/null || true
pkill -f 'Wonderland/Binaries/Linux/Wonderland' 2>/dev/null || true

if [ -z "$FOUND" ]; then
  wl_die "no native PNG appeared under $SHOT_DIR after 180s.
HighResShot may be a phantom in this configuration too — see $WL_LOG/native-$CAM.log.
NOTHING was captured; no native/stream comparison can be made from this run."
fi

DEST="$OUT_DIR/native-hero$CAM-$SHORT-$STAMP.png"
cp "$FOUND" "$DEST"

# A FILE IS NOT A FRAME. The phantom screenshot path returns success and writes
# an empty buffer, so the only way to know this is a picture of Wonderland is to
# look at its structure.
if ! python3 "$HERE/frame-check.py" "$DEST" >/dev/null 2>&1; then
  wl_warn "frame-check could not validate $DEST — treating it as SUSPECT"
  mv "$DEST" "$DEST.suspect"
  wl_die "the native frame has no real image structure. It is $DEST.suspect and must not be compared against anything."
fi

wl_ok "native frame (no encoder in the path): $DEST"
printf '%s\n' "$DEST"
