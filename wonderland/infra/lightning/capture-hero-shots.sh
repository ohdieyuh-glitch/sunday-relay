#!/usr/bin/env bash
# Fixed-camera hero frames, each one carrying the build it came from.
#
# The goal asks for "fixed-camera screenshots against the founder reference" and
# for every iteration to report FPS/VRAM and a SHA. A loose PNG in a proof
# directory satisfies none of that: this project has already compared two
# captures that turned out to be the same binary, and a frame that cannot be
# attributed to a build is a picture, not evidence.
#
# So every capture here writes a PNG and a JSON sidecar recording the compiled
# SHA, the branch, the render profile, the generator knobs, the hero camera, and
# the world-proof lines the packaged build printed for that run. If the SHA
# cannot be established, nothing is captured.
#
#   WL_HERO_CAMS=0 bash wonderland/infra/lightning/capture-hero-shots.sh
#   WL_HERO_CAMS="0 3" ... (each camera is a RELAUNCH — that is metered GPU time)
#
# ONE CAMERA BY DEFAULT, and that is deliberate. -CinematicView pins the view at
# launch, so seven hero shots are seven relaunches. HeroCam0 is the arrival
# composition and the only one WorldDesign/visual-target.json judges.
#
# WL_HERO_CAMS="0 6" is the pair worth spending GPU time on. HeroCam6 is the
# same POINT as HeroCam0 aimed wider and 17 degrees higher, and offline
# measurement says that is the difference between 0.9% and 29.9% of the Marble
# castle city being inside the frame -- HeroCam0 is pitched down to hold the
# hero Dog, and the skyline sits above it. Capturing both is how the founder
# compares the arrival they have against the arrival the backdrop was bought
# for, in one session.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

CAMS="${WL_HERO_CAMS:-0}"
SETTLE="${WL_SETTLE_MS:-12000}"
OUTDIR="${WL_CAPTURE_DIR:-$WL_PROOF/captures}"
mkdir -p "$OUTDIR"

# THE SHA IS NOT OPTIONAL. build-wonderland.sh writes compiled.sha next to the
# build logs; without it there is no way to say which code produced a frame, and
# a capture that cannot be attributed is worth less than no capture because it
# looks like evidence.
SHA_FILE="$WL_OUT/logs/compiled.sha"
if [ ! -f "$SHA_FILE" ]; then
  wl_die "no $SHA_FILE — the packaged build does not record which commit compiled it.
Run a build before capturing. Nothing was captured."
fi
BUILD_SHA="$(tr -d '[:space:]' < "$SHA_FILE")"
[ -n "$BUILD_SHA" ] || wl_die "$SHA_FILE is empty. Nothing was captured."

APP="$(wl_find_first "$WL_OUT/Linux" -maxdepth 3 -name 'Wonderland.sh' -type f)"
[ -n "${APP:-}" ] || wl_die "no packaged Wonderland.sh under $WL_OUT/Linux. Nothing was captured."

# CHECKED HERE, BEFORE THE FIRST LAUNCH. prepare.sh installs the capture
# toolchain, but that ran on a different day and possibly a different machine
# type, and this project has already had node_modules disappear from
# /teamspace while package.json stayed behind looking healthy. Every launch
# below costs metered GPU time; discovering there is no browser AFTER the app
# is up wastes all of it.
CAPTURE_NODE="$(wl_bundled_node 2>/dev/null || command -v node || true)"
if [ -z "$CAPTURE_NODE" ] \
   || ! "$CAPTURE_NODE" -e "require('$WL_TOOLS/node_modules/playwright').chromium" >/dev/null 2>&1; then
  wl_die "playwright will not load from $WL_TOOLS/node_modules — there is no browser to
capture with, and every hero launch after this line costs GPU time. Install it first:
  cd $WL_TOOLS && npm install playwright && npx playwright install --with-deps chrome
Nothing was captured."
fi

wl_say "capturing hero cameras: $CAMS"
wl_say "build $BUILD_SHA"

# Pull the packaged build's own report out of the app log. These are the facts
# the frame has to be read WITH: a beautiful frame with MARBLE_ACTORS=0 is a
# frame of a different world than the one being discussed.
# ONLY THIS RUN'S LINES. run-stream.sh APPENDS to app.log, so a file that has
# already held a HeroCam0 launch still holds it when HeroCam6 launches. Reading
# the whole file put both runs' HERO_CAM_SERVED lines into both sidecars, and a
# proof block that describes two cameras describes neither. Worse, the fallback
# detector below would keep reporting a fallback that happened three captures
# ago. Each capture records the byte offset before it launches and reads only
# from there.
log_offset() {
  [ -f "$1" ] && wc -c < "$1" | tr -d '[:space:]' || echo 0
}

run_slice() {
  # $1 log, $2 byte offset recorded before the launch.
  #
  # AND THE OFFSET IS ONLY VALID IF THE FILE STILL GREW FROM IT. run-stream.sh
  # TRUNCATES app.log at each launch (`: > "$WL_LOG/app.log"`), so an offset
  # taken from the previous, larger file points past the end of the new one and
  # `tail -c` returns NOTHING. That does not bound the slice to one run, it
  # deletes the run entirely -- both sidecars came back with an empty proof
  # block and the comparison correctly refused two perfectly good frames.
  #
  # A file smaller than the offset can only mean it was truncated, and a
  # truncated log already contains exactly one run, so the whole file IS the
  # slice.
  local log="$1" from="${2:-0}" size
  [ -f "$log" ] || return 0
  size="$(wc -c < "$log" 2>/dev/null | tr -d '[:space:]')"
  [ "${size:-0}" -lt "$from" ] && from=0
  tail -c "+$(( from + 1 ))" "$log" 2>/dev/null || true
}

proof_lines() {
  local log="$1"
  [ -f "$log" ] || return 0
  local from="${2:-0}"
  run_slice "$log" "$from" \
  | grep -aoE '(WORLD|ACTORS|RELAY_DOGS|COMPOUND_AGENTS|BATCHES|INSTANCED_PIECES|LOOSE_PIECES|VISIBLE_PIECES|MARBLE_ACTORS|MARBLE_TWO_SIDED_COMPONENTS|MARBLE_COLLIDING_COMPONENTS|RUNTIME_RELAY_DOGS|RUNTIME_COMPOUND_AGENTS|RUNTIME_INSTANCES_BUILT|RUNTIME_BLOCKING_PRIMITIVES|RUNTIME_GROUNDED_DOGS|RUNTIME_GROUNDED_PLAYER_STARTS|RUNTIME_WORLD_HAS_NO_GAMEPLAY_COLLISION|RUNTIME_DOGS_OK|WORLD_OK|HERO_CAM_REQUESTED|HERO_CAM_SERVED|HERO_CAM_FELL_BACK|HERO_CAM_MISSING|HERO_CAM_LOC|HERO_CAM_ROT|HERO_CAM_FOV)=[^ ]*' \
    | sort -u || true
}

# GPU alongside the picture, from the same run. Sampled WHILE the app is up and
# rendering, because a reading taken after it exits is a reading of an idle
# card. Best effort: no nvidia-smi means the fields are absent, never zero.
gpu_sample() {
  command -v nvidia-smi >/dev/null 2>&1 || { echo '{}'; return 0; }
  nvidia-smi --query-gpu=name,utilization.gpu,utilization.memory,memory.used,memory.total,temperature.gpu,clocks.sm \
             --format=csv,noheader,nounits 2>/dev/null \
  | head -1 \
  | awk -F', *' '{printf "{\"name\":\"%s\",\"gpu_util_pct\":%s,\"mem_util_pct\":%s,\"vram_used_mib\":%s,\"vram_total_mib\":%s,\"temp_c\":%s,\"sm_clock_mhz\":%s}", $1,$2,$3,$4,$5,$6,$7}' \
  || echo '{}'
}

# What the GPU is doing with no Wonderland on it. Without this baseline a
# 3 GB reading proves nothing: the card may have been holding that before the
# app started.
GPU_IDLE="$(gpu_sample)"

# THE FALLBACK IS A LIE DETECTOR, NOT A CONVENIENCE. The player controller falls
# back to the legacy arrival camera when the requested HeroCamN is not in the
# level -- which is exactly what happens when the package is older than the
# camera. The run succeeds, the PNG is named for the camera that was asked for,
# and it is a picture of a different one.
fell_back() {
  # $1 log, $2 offset. Bounded to this run for the reason above.
  run_slice "$1" "$2" | grep -aq 'HERO_CAM_FELL_BACK=1\|HERO_CAM_MISSING='
}

CAPTURED=0
for cam in $CAMS; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  base="$OUTDIR/hero${cam}-${BUILD_SHA:0:7}-${stamp}"
  wl_say "--- hero camera $cam -> $base.png"

  # Stop anything already streaming: two streamers on one port is how a capture
  # ends up showing the PREVIOUS build.
  bash "$HERE/stop-wonderland.sh" >/dev/null 2>&1 || true

  # Where this run's log begins. Taken AFTER the stop, so a shutdown line from
  # the previous camera cannot land inside this camera's slice.
  APP_LOG_FROM="$(log_offset "$WL_LOG/app.log")"

  if ! WL_HERO_CAM="$cam" SKIP_PREPARE=1 SKIP_BUILD=1 SKIP_SHOT=1 \
       bash "$HERE/launch-wonderland.sh" >"$WL_LOG/capture-$cam.log" 2>&1; then
    wl_warn "launch failed for hero camera $cam — see $WL_LOG/capture-$cam.log"
    tail -20 "$WL_LOG/capture-$cam.log" >&2 || true
    continue
  fi

  NODE="$(wl_bundled_node 2>/dev/null || echo node)"
  if ! ( cd "$HERE" && WL_SETTLE_MS="$SETTLE" "$NODE" shot.cjs \
           "http://127.0.0.1:$WL_HTTP_PORT/" "$base.png" ) >>"$WL_LOG/capture-$cam.log" 2>&1; then
    wl_warn "capture failed for hero camera $cam — see $WL_LOG/capture-$cam.log"
    continue
  fi
  [ -s "$base.png" ] || { wl_warn "hero camera $cam produced an empty PNG"; continue; }

  if fell_back "$WL_LOG/app.log" "$APP_LOG_FROM"; then
    wl_warn "hero camera $cam DID NOT EXIST in this level — the view fell back to the
legacy arrival camera, so $base.png is a picture of a DIFFERENT camera. Deleting it
rather than filing it as evidence. The package is older than the camera; rebuild."
    rm -f "$base.png"
    continue
  fi

  GPU_LOADED="$(gpu_sample)"

  # Performance alongside the picture, from the same run — the goal asks for
  # both and measuring them separately means measuring two different states.
  #
  # READ THE FILE, NOT STDOUT. measure.cjs writes its JSON to the path given as
  # its SECOND argument and prints a one-line human summary to stdout. Capturing
  # stdout and testing it for a leading brace therefore discarded every
  # measurement it ever took: the guard rewrote a perfectly good run to "{}" and
  # the capture filed a frame with no FPS in it, silently, every time.
  STATS="{}"
  MEASURE="$HERE/../../rendering/measure.cjs"
  STATS_FILE="$base.stream.json"
  if [ -f "$MEASURE" ]; then
    if ( cd "$HERE" && "$NODE" "$MEASURE" "http://127.0.0.1:$WL_HTTP_PORT/" \
           "$STATS_FILE" ) >>"$WL_LOG/capture-$cam.log" 2>&1 && [ -s "$STATS_FILE" ]; then
      STATS="$(cat "$STATS_FILE")"
      case "$STATS" in '{'*) : ;; *) STATS='{}' ;; esac
    else
      # Loud, because "no FPS" and "0 FPS" are different claims and only one of
      # them is true here.
      wl_warn "hero camera $cam: the stream could not be measured — the frame is
filed WITHOUT performance numbers rather than with invented ones.
See $WL_LOG/capture-$cam.log"
    fi
  else
    wl_warn "no measure.cjs at $MEASURE — no FPS was recorded for hero camera $cam"
  fi

  # Passed through the environment rather than as arguments: the proof block is
  # multi-line and the stats are JSON, and both would need quoting that is easy
  # to get subtly wrong on a machine that costs money per minute.
  WL_PROOF_LINES="$(proof_lines "$WL_LOG/app.log" "$APP_LOG_FROM")" \
  WL_STREAM_STATS="$STATS" \
  WL_GPU_IDLE="$GPU_IDLE" \
  WL_GPU_LOADED="$GPU_LOADED" \
  python3 - "$base.json" "$cam" "$BUILD_SHA" "$stamp" "$base.png" <<PYEOF
import io, json, os, subprocess, sys
out, cam, sha, stamp, png = sys.argv[1:6]
def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, stdout=subprocess.PIPE,
                              stderr=subprocess.DEVNULL).stdout.decode().strip()
    except Exception:
        return ""
payload = {
    "hero_camera": int(cam),
    "build_sha": sha,
    "branch": os.environ.get("WL_BRANCH", ""),
    "captured_at": stamp,
    "png": os.path.abspath(png),
    "png_bytes": os.path.getsize(png) if os.path.exists(png) else 0,
    "render_profile": os.environ.get("WL_RENDER_PROFILE", ""),
    "generator_knobs": {
        "WONDERLAND_LOOK": os.environ.get("WONDERLAND_LOOK", ""),
        "WONDERLAND_BATCH": os.environ.get("WONDERLAND_BATCH", "1"),
        "WONDERLAND_MARBLE_IMPORT": os.environ.get("WONDERLAND_MARBLE_IMPORT", ""),
        "WONDERLAND_MARBLE_BACKDROP": os.environ.get("WONDERLAND_MARBLE_BACKDROP", "0"),
        "WONDERLAND_COLLIDE": os.environ.get("WONDERLAND_COLLIDE", ""),
    },
    "world_proof": [l for l in os.environ.get("WL_PROOF_LINES", "").split("\n") if l],
    "stream": json.loads(os.environ.get("WL_STREAM_STATS", "{}") or "{}"),
    "gpu": {
        "idle_before_launch": json.loads(os.environ.get("WL_GPU_IDLE", "{}") or "{}"),
        "while_rendering": json.loads(os.environ.get("WL_GPU_LOADED", "{}") or "{}"),
        "note": ("Sampled with nvidia-smi while the packaged app was up and "
                 "streaming, against a baseline taken before it launched. An "
                 "absent field means nvidia-smi did not answer -- it is never "
                 "reported as zero."),
    },
    "what_this_is": (
        "A fixed-camera frame and the build that produced it. The world_proof "
        "lines are what the PACKAGED build printed on this run — read the frame "
        "with them, because a good-looking frame with MARBLE_ACTORS=0 is a frame "
        "of a different world than the one being discussed."),
}
with io.open(out, "w", encoding="utf8") as h:
    json.dump(payload, h, indent=2, sort_keys=True)
    h.write("\n")
print(out)
PYEOF

  CAPTURED=$((CAPTURED + 1))
  wl_ok "hero camera $cam captured"
done

bash "$HERE/stop-wonderland.sh" >/dev/null 2>&1 || true

if [ "$CAPTURED" -eq 0 ]; then
  wl_die "nothing was captured. See $WL_LOG/capture-*.log"
fi
wl_ok "$CAPTURED capture(s) in $OUTDIR"
echo
echo "Next, with NO GPU:"
echo "  python3 wonderland/infra/build/compare-to-reference.py $OUTDIR"
