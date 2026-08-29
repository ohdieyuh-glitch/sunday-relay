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

SECS="${1:-60}"
FRAMES=$(( SECS * 60 ))
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$WL_ROOT/proof/perf/$STAMP"
mkdir -p "$OUT"
SHA="$(head -1 "$WL_OUT/logs/packaged.sha" 2>/dev/null || echo unknown)"

if pgrep -f "Binaries/Linux/Wonderlan[d]" >/dev/null 2>&1 && [ "${WL_TAKE_STREAM:-0}" != "1" ]; then
  wl_die "a Wonderland stream is already running -- someone may be playing. WL_TAKE_STREAM=1 to take it."
fi

wl_say "profiling $SECS s of the Dog's own route on build $SHA"

# `stat unit` puts the four numbers on screen for the capture to show, and the
# CSV profiler writes them per frame for the arithmetic. -csvCaptureFrames
# starts the capture at launch, so the whole route is covered without a console.
WL_MAP_ARG="${WL_MAP_ARG:-/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2}" \
WL_EXTRA_ARGS="${WL_EXTRA_ARGS:-} -wldemo -csvCaptureFrames=$FRAMES -csvGpuStats -statnamedevents" \
WL_EXEC_CMDS="${WL_EXEC_CMDS:-stat unit}" \
  bash "$LIGHTNING/run-stream.sh"

wl_say "letting the Dog run its route for ${SECS}s"
sleep "$SECS"
sleep 12   # the CSV is flushed when the capture ends, not while it runs

CSV="$(wl_find_first "$WL_ROOT" -name '*.csv' -newermt "-$((SECS + 300)) seconds" -path '*Profiling*' || true)"
if [ -z "${CSV:-}" ]; then
  CSV="$(wl_find_first "$WL_SRC/wonderland/Saved" -name '*.csv' -path '*CSV*' || true)"
fi
if [ -z "${CSV:-}" ]; then
  wl_warn "no CSV profile found; falling back to the app log's own frame timings"
  grep -aE "FrameTime|GameThread|RenderThread|GPU " "$WL_LOG/app.log" | tail -40 > "$OUT/frames.txt" || true
else
  cp "$CSV" "$OUT/frames.csv"
  wl_ok "profile: $OUT/frames.csv"
fi
printf '%s\n' "$SHA" > "$OUT/packaged.sha"
grep -a "WLDOG " "$WL_LOG/app.log" 2>/dev/null | tail -40 | sed 's/.*LogTemp: //' > "$OUT/dog-state.txt" || true
printf '%s\n' "$OUT"
