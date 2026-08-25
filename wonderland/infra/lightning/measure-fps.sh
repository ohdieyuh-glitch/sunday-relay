#!/usr/bin/env bash
# REAL FRAME TIMES FROM THE PACKAGED BUILD, WITH NO BROWSER IN THE PATH.
#
# The goal asks for FPS measured before and after the world-motion removal, and
# until now this project has had exactly two ways to get a frame rate: read it
# off a Pixel Streaming client (which measures the STREAM, not the renderer) or
# read it out of app.log, where proof.sh already records that "Wonderland does
# not currently expose an FPS counter". Neither answers "did making 137,123
# primitives static make the renderer faster".
#
# Unreal's CSV profiler does. `-csvCaptureFrames=N` captures N frames and writes
# a CSV of per-frame timings with no interaction, no display and no encoder —
# the same offscreen path native-shot.sh uses for a picture, asked for numbers
# instead. FrameTime is in milliseconds.
#
#   WL_HERO_CAM=6 WL_FPS_FRAMES=600 bash wonderland/infra/lightning/measure-fps.sh
#
# It reports the MEDIAN as well as the mean. A mean over a capture that includes
# level load and shader warm-up is dominated by the first few frames, and this
# has already been a source of numbers nobody could reproduce.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

CAM="${WL_HERO_CAM:-6}"
FRAMES="${WL_FPS_FRAMES:-600}"
RES_X="${WL_RES_X:-1920}"
RES_Y="${WL_RES_Y:-1080}"
# WL_OUT IS ALREADY THE PACKAGED DIRECTORY. common.sh sets it to
# $WL_ROOT/packaged, so "$WL_OUT/packaged/..." looks for it one level too deep.
# Resolved the same way native-shot.sh does, which also survives the staged
# directory moving.
APP="$(wl_find_first "$WL_OUT/Linux" -maxdepth 3 -name 'Wonderland.sh' -type f)"
[ -n "$APP" ] && [ -x "$APP" ] || wl_die "no packaged build under $WL_OUT/Linux"

SHA_FILE="$WL_OUT/logs/packaged.sha"
[ -f "$SHA_FILE" ] || SHA_FILE="$WL_OUT/logs/compiled.sha"
[ -f "$SHA_FILE" ] || wl_die "no packaged.sha or compiled.sha — a frame rate that cannot be attributed to a build is a number, not evidence."
BUILD_SHA="$(tr -d '[:space:]' < "$SHA_FILE")"
SHORT="${BUILD_SHA:0:7}"

CSV_DIR="$(dirname "$APP")/Wonderland/Saved/Profiling/CSV"
rm -rf "$CSV_DIR" 2>/dev/null || true

wl_say "frame timing: HeroCam6=$CAM, $FRAMES frames, build $SHORT, no encoder in the path"
setsid nohup env $(wl_vulkan_env_pairs) "$APP" \
  -RenderOffscreen -ForceRes "-ResX=$RES_X" "-ResY=$RES_Y" \
  -Unattended -stdout -FullStdOutLogOutput \
  -CinematicView "-HeroCam=$CAM" \
  "-csvCaptureFrames=$FRAMES" -csvGpuStats \
  >"$WL_LOG/fps-$CAM.log" 2>&1 </dev/null &
APP_PID=$!

CSV=""
for _ in $(seq 1 90); do
  CSV="$( ( set +o pipefail; find "$CSV_DIR" -name '*.csv' -size +2k 2>/dev/null | head -1 ) || true)"
  [ -n "$CSV" ] && break
  kill -0 "$APP_PID" 2>/dev/null || break
  sleep 5
done
kill -TERM "-$APP_PID" 2>/dev/null || kill -TERM "$APP_PID" 2>/dev/null || true
sleep 2
kill -KILL "-$APP_PID" 2>/dev/null || true

[ -n "$CSV" ] || wl_die "no CSV under $CSV_DIR — the capture produced nothing; see $WL_LOG/fps-$CAM.log"
wl_ok "csv: $CSV"
python3 - "$CSV" "$SHORT" <<'PY'
import csv, statistics, sys
path, sha = sys.argv[1], sys.argv[2]
# UE APPENDS A METADATA ROW WHOSE SINGLE FIELD IS ENORMOUS — the whole command
# line, every cvar and the build config in one cell. Python's csv module
# refuses anything past 131,072 characters, so the first attempt at this died
# with "field larger than field limit" AFTER the profiler had done its job.
csv.field_size_limit(1 << 24)
rows = [r for r in csv.DictReader(open(path, newline="")) if r]
key = next((k for k in (rows[0] if rows else {}) if k.strip().lower() == "frametime"), None)
if not key:
    raise SystemExit("no FrameTime column in %s; columns: %s"
                     % (path, ", ".join(list(rows[0])[:12]) if rows else "none"))
ms = []
for r in rows:
    v = r.get(key)
    if v in (None, ""):
        continue
    try:
        ms.append(float(v))
    except ValueError:
        continue          # the metadata row: not a frame
if not ms:
    raise SystemExit("no numeric FrameTime values in %s" % path)
# DROP THE WARM-UP. The first frames of an offscreen run carry level load and
# shader compilation, and a mean over them describes the loader, not the world.
warm = ms[max(1, len(ms)//10):]
if not warm:
    raise SystemExit("no usable frames in %s" % path)
mean = statistics.fmean(warm)
med = statistics.median(warm)
p95 = sorted(warm)[int(len(warm)*0.95) - 1]
print("  FRAME TIME  build %s   %d frames after warm-up" % (sha, len(warm)))
print("    median  %7.2f ms   = %6.1f fps" % (med, 1000.0/med))
print("    mean    %7.2f ms   = %6.1f fps" % (mean, 1000.0/mean))
print("    p95     %7.2f ms   = %6.1f fps" % (p95, 1000.0/p95))
PY
