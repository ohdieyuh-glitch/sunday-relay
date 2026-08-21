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
# launch, so six hero shots are six relaunches. HeroCam0 is the arrival
# composition and the only one WorldDesign/visual-target.json judges.
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

wl_say "capturing hero cameras: $CAMS"
wl_say "build $BUILD_SHA"

# Pull the packaged build's own report out of the app log. These are the facts
# the frame has to be read WITH: a beautiful frame with MARBLE_ACTORS=0 is a
# frame of a different world than the one being discussed.
proof_lines() {
  local log="$1"
  [ -f "$log" ] || return 0
  grep -aoE '(WORLD|ACTORS|RELAY_DOGS|COMPOUND_AGENTS|BATCHES|INSTANCED_PIECES|LOOSE_PIECES|VISIBLE_PIECES|MARBLE_ACTORS|MARBLE_TWO_SIDED_COMPONENTS|MARBLE_COLLIDING_COMPONENTS|RUNTIME_RELAY_DOGS|RUNTIME_COMPOUND_AGENTS|RUNTIME_INSTANCES_BUILT|RUNTIME_BLOCKING_PRIMITIVES|RUNTIME_GROUNDED_DOGS|RUNTIME_GROUNDED_PLAYER_STARTS|RUNTIME_WORLD_HAS_NO_GAMEPLAY_COLLISION|RUNTIME_DOGS_OK|WORLD_OK)=[^ ]*' "$log" \
    | sort -u || true
}

CAPTURED=0
for cam in $CAMS; do
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"
  base="$OUTDIR/hero${cam}-${BUILD_SHA:0:7}-${stamp}"
  wl_say "--- hero camera $cam -> $base.png"

  # Stop anything already streaming: two streamers on one port is how a capture
  # ends up showing the PREVIOUS build.
  bash "$HERE/stop-wonderland.sh" >/dev/null 2>&1 || true

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

  # Performance alongside the picture, from the same run — the goal asks for
  # both and measuring them separately means measuring two different states.
  STATS="{}"
  if [ -f "$HERE/../../rendering/measure.cjs" ]; then
    STATS="$( ( cd "$HERE" && "$NODE" "$HERE/../../rendering/measure.cjs" \
                 "http://127.0.0.1:$WL_HTTP_PORT/" ) 2>>"$WL_LOG/capture-$cam.log" || echo '{}')"
    case "$STATS" in '{'*) : ;; *) STATS='{}' ;; esac
  fi

  # Passed through the environment rather than as arguments: the proof block is
  # multi-line and the stats are JSON, and both would need quoting that is easy
  # to get subtly wrong on a machine that costs money per minute.
  WL_PROOF_LINES="$(proof_lines "$WL_LOG/app.log")" \
  WL_STREAM_STATS="$STATS" \
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
