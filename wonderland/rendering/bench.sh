#!/usr/bin/env bash
# Before/after evidence for a rendering change. Runs on the GPU box.
#
#   bash wonderland/rendering/bench.sh --label before --profile BALANCED
#   bash wonderland/rendering/bench.sh --label after  --profile BALANCED --cameras 0,2,4
#
# For each deterministic hero camera it brings the stream up under one named
# profile, measures what the BROWSER receives, samples the GPU, captures the
# frame, and writes one JSON row. Nothing here interprets the numbers; a report
# that scored itself would be the second untruthful channel this project has
# had to remove.
#
# WHAT IS MEASURED, AND BY WHAT
#
#   fps / bitrate / resolution / freezes   measure.cjs, from WebRTC getStats in
#                                          a real Chrome. This is the founder's
#                                          experience, not the engine's opinion
#                                          of it.
#   GPU utilisation / VRAM / clocks        nvidia-smi, sampled once a second for
#                                          the whole window.
#   the frame itself                       shot.cjs, the existing capture, which
#                                          exists because the engine's own
#                                          screenshot path returns success and
#                                          writes an empty buffer here.
#
# The cameras are HeroCam0..5, already placed by the level generator and already
# selectable with -CinematicView -HeroCam=N. Reusing them is what makes a
# before/after comparable: same transform, same FOV, same frame, every time.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LIGHTNING="$HERE/../infra/lightning"
# shellcheck source=../infra/lightning/common.sh
. "$LIGHTNING/common.sh"

LABEL=""
PROFILE="BALANCED"
CAMERAS="0,1,2,3,4,5"
SECONDS_PER_CAM="${WL_MEASURE_SECONDS:-30}"

while [ $# -gt 0 ]; do
  case "$1" in
    --label)    LABEL="$2"; shift 2 ;;
    --profile)  PROFILE="$2"; shift 2 ;;
    --cameras)  CAMERAS="$2"; shift 2 ;;
    --seconds)  SECONDS_PER_CAM="$2"; shift 2 ;;
    -h|--help)  sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[ -n "$LABEL" ] || { echo "--label is required (e.g. 'before', 'after-tsr')" >&2; exit 2; }

wl_mkdirs
BENCH_DIR="$WL_PROOF/bench/$LABEL"
mkdir -p "$BENCH_DIR"

# PROBE FIRST. A bench run costs minutes of GPU and produces a number that gets
# quoted afterwards; a number produced by settings the engine silently ignored
# is worse than no number, because it looks like evidence. So if the engine has
# never been asked which console variables it has, ask it now — the probe is
# seconds and needs no cook.
if [ ! -f "$HERE/engine-cvars.5.8.json" ]; then
  echo "no engine probe yet — asking the engine which CVars it has"
  bash "$HERE/probe-cvars.sh" || {
    echo "the probe failed; refusing to bench against unverified settings" >&2
    exit 2; }
fi

# --strict: after a probe exists, an unverified name is a refusal, not a
# warning. This is the line that stops a measurement being attributed to a
# setting that never took effect.
EXEC_CMDS="$(python3 "$HERE/render-profile.py" --strict emit "$PROFILE")" || {
  echo "refusing to bench: the profile did not resolve (see above)" >&2; exit 2; }
STREAM_ARGS="$(python3 "$HERE/render-profile.py" args "$PROFILE")"
echo "profile $PROFILE"
echo "  cvars: $EXEC_CMDS"
echo "  args:  $STREAM_ARGS"

REPORT="$BENCH_DIR/report.json"
python3 - "$REPORT" "$LABEL" "$PROFILE" "$EXEC_CMDS" <<'PY'
import io, json, os, subprocess, sys
path, label, profile, execcmds = sys.argv[1:5]
def sh(cmd):
    try:
        return subprocess.run(cmd, shell=True, capture_output=True, text=True,
                              timeout=30).stdout.strip()
    except Exception:
        return ""
os.makedirs(os.path.dirname(path), exist_ok=True)
json.dump({
    "label": label,
    "profile": profile,
    "exec_cmds": execcmds,
    "gpu": sh("nvidia-smi --query-gpu=name,memory.total,driver_version "
              "--format=csv,noheader"),
    "host": sh("uname -a"),
    "commit": sh("git -C '%s' rev-parse HEAD" % os.path.dirname(os.path.abspath(__file__))),
    "runs": [],
}, io.open(path, "w", encoding="utf8"), indent=2)
PY

IFS=',' read -r -a CAM_LIST <<< "$CAMERAS"
for CAM in "${CAM_LIST[@]}"; do
  echo
  printf '\033[1;35m===== profile %s · HeroCam%s =====\033[0m\n' "$PROFILE" "$CAM"

  bash "$LIGHTNING/stop-wonderland.sh" --quiet >/dev/null 2>&1 || true
  # Passed as NAMED variables, not as one WL_EXTRA_ARGS string: the -ExecCmds
  # payload contains spaces, and an unquoted expansion in the launcher would
  # split it into a dozen switches Unreal ignores without complaint — the
  # precise silent failure this whole directory exists to prevent.
  WL_RENDER_PROFILE="$PROFILE" WL_HERO_CAM="$CAM" \
    bash "$LIGHTNING/run-stream.sh"

  URL="http://127.0.0.1:${WL_HTTP_PORT}/"
  GPU_CSV="$BENCH_DIR/gpu-cam$CAM.csv"
  # Sample for the whole measurement window plus the settle time, then stop.
  nvidia-smi --query-gpu=timestamp,utilization.gpu,utilization.memory,memory.used,temperature.gpu,clocks.sm \
             --format=csv -l 1 > "$GPU_CSV" 2>/dev/null &
  SMI_PID=$!

  STATS="$BENCH_DIR/stream-cam$CAM.json"
  set +e
  WL_MEASURE_SECONDS="$SECONDS_PER_CAM" \
    node "$HERE/measure.cjs" "$URL" "$STATS" "$SECONDS_PER_CAM"
  MEASURE_RC=$?
  set -e
  kill "$SMI_PID" 2>/dev/null || true
  wait "$SMI_PID" 2>/dev/null || true

  SHOT="$BENCH_DIR/hero-cam$CAM.png"
  set +e
  node "$LIGHTNING/shot.cjs" "$URL" "$SHOT"
  SHOT_RC=$?
  set -e

  python3 "$HERE/bench-row.py" "$REPORT" "$CAM" "$STATS" "$GPU_CSV" "$SHOT" \
          "$MEASURE_RC" "$SHOT_RC"
done

bash "$LIGHTNING/stop-wonderland.sh" --quiet >/dev/null 2>&1 || true
echo
python3 "$HERE/bench-row.py" --summary "$REPORT"
echo "report: $REPORT"
