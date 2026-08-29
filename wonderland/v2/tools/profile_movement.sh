#!/usr/bin/env bash
# WHERE THE FRAME TIME GOES WHILE THE DOG IS MOVING.
#
#   bash wonderland/v2/tools/profile_movement.sh [seconds]
#
# The founder reports stutter while controlling the Dog. Three things could
# produce that and they need opposite fixes, so this measures rather than
# guesses:
#
#   * the GAME THREAD (movement, the Dog's per-frame pose, collision, ticks)
#   * the RENDER THREAD (draw calls, culling, shadow setup)
#   * the GPU (shading, foliage, Lumen, shadow maps)
#
# and separately the SPIKES, because a smooth-feeling 60 fps and a stuttering
# 60 fps have the same average and completely different frame-time histograms.
# The founder was explicit: movement must FEEL smooth, not average well.
#
# HOW IT GETS A FAIR SAMPLE. The Dog drives its own route (-wldemo), so the
# same movement is profiled every run: idle, walk, jog, run, the arms-back
# sprint, a stop, turns, and the stairs. A profile taken while a human wanders
# is not comparable with the next one.
#
# UE's CSV profiler writes one row per frame with FrameTime, GameThreadTime,
# RenderThreadTime and GPUTime in milliseconds -- exactly the four numbers the
# question needs, and machine-readable, so the before and after are arithmetic
# rather than an impression.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LIGHTNING="$HERE/../../infra/lightning"
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
# shellcheck source=../../infra/lightning/common.sh
. "$LIGHTNING/common.sh"

# WHICH ROUTE THE DOG DRIVES WHILE IT IS MEASURED. `gait` is the locomotion
# demo, `explore` the district tour -- the second costs more because it crosses
# the gardens and the new approach, so both are worth a number.
ROUTE="${WL_ROUTE:-gait}"
case "$ROUTE" in
  gait) ROUTE_FLAG="-wldemo" ;;
  explore) ROUTE_FLAG="-wlexplore" ;;
  *) wl_die "WL_ROUTE must be gait or explore, not '$ROUTE'" ;;
esac

SECS="${1:-60}"
FRAMES=$(( SECS * 60 ))
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$WL_ROOT/proof/perf/$STAMP"
mkdir -p "$OUT"
SHA="$(head -1 "$WL_OUT/logs/packaged.sha" 2>/dev/null || echo unknown)"

if pgrep -f "Binaries/Linux/Wonderlan[d]" >/dev/null 2>&1 && [ "${WL_TAKE_STREAM:-0}" != "1" ]; then
  wl_die "a Wonderland stream is already running -- someone may be playing. WL_TAKE_STREAM=1 to take it."
fi
pkill -f "Binaries/Linux/Wonderlan[d]" 2>/dev/null || true
sleep 2

# OFFSCREEN, WITH NO ENCODER IN THE PATH. This is measure-fps.sh's proven
# launch, which matters: routed through Pixel Streaming with the same CSV flags
# the game exited five seconds after start and wrote an empty capture. The
# question here is what the RENDERER and the GAME THREAD cost while the Dog
# moves, and a browser and an H264 encoder are not part of that question --
# they were measured separately and fixed separately.
APP="$(wl_find_first "$WL_OUT/Linux" -maxdepth 3 -name 'Wonderland.sh' -type f || true)"
[ -n "${APP:-}" ] || wl_die "no packaged build under $WL_OUT/Linux"
CSV_DIR="$(dirname "$APP")/Wonderland/Saved/Profiling/CSV"
rm -rf "$CSV_DIR" 2>/dev/null || true

wl_say "offscreen run: $FRAMES frames while the Dog drives its route"
setsid nohup env $(wl_vulkan_env_pairs) "$APP" \
  "${WL_MAP_ARG:-/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2}" \
  -RenderOffscreen -ForceRes "-ResX=${WL_RES_X:-1280}" "-ResY=${WL_RES_Y:-720}" \
  -Unattended -stdout -FullStdOutLogOutput \
  $ROUTE_FLAG \
  "-csvCaptureFrames=$FRAMES" -csvGpuStats \
  >"$WL_LOG/profile-run.log" 2>&1 </dev/null &
APP_PID=$!

CSV=""
for _ in $(seq 1 120); do
  CSV="$( ( set +o pipefail; find "$CSV_DIR" -name '*.csv' -size +2k 2>/dev/null | head -1 ) || true)"
  [ -n "$CSV" ] && break
  kill -0 "$APP_PID" 2>/dev/null || break
  sleep 5
done
kill "$APP_PID" 2>/dev/null || true
pkill -f "Binaries/Linux/Wonderlan[d]" 2>/dev/null || true

if [ -z "${CSV:-}" ]; then
  wl_warn "no CSV profile found; falling back to the app log's own frame timings"
  tail -40 "$WL_LOG/profile-run.log" > "$OUT/run-tail.txt" || true
else
  cp "$CSV" "$OUT/frames.csv"
  wl_ok "profile: $OUT/frames.csv"
fi
printf '%s\n' "$SHA" > "$OUT/packaged.sha"
grep -a "WLDOG " "$WL_LOG/profile-run.log" 2>/dev/null | tail -40 | sed 's/.*LogTemp: //' > "$OUT/dog-state.txt" || true
printf '%s\n' "$OUT"
