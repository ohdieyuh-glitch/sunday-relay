#!/usr/bin/env bash
# Ask the ENGINE which console variables it has. Runs on the GPU box.
#
# WHY THIS EXISTS
#
# Unreal does not complain about a console variable it has never heard of in a
# way anyone notices, and it does not complain about an unknown command-line
# switch at all. This project has already lost a session to exactly that: the
# packaged build was launched with `-PixelStreamingURL` and had no Pixel
# Streaming runtime in it, and nothing said so. A rendering config assembled
# from documentation and pasted into a launcher fails the same silent way —
# the stream comes up, the settings do nothing, and the conclusion drawn is
# "TSR did not help" when TSR was never on.
#
# So the source of truth for "does this setting exist in OUR UE 5.8 build" is
# the build, not a web page. This asks it once and writes down the answer.
#
# HOW IT ASKS
#
# `-ExecCmds` takes a comma-separated list. Typing a console variable's name
# with no argument prints its current value; typing a name the engine does not
# know prints a "not recognized" line. One launch, every name, a definitive
# per-name verdict from the engine that will actually run the world.
#
#   bash wonderland/rendering/probe-cvars.sh
#   -> wonderland/rendering/engine-cvars.5.8.json
#
# It renders nothing and streams nothing: -RenderOffscreen -Unattended and an
# exec list that ends in `quit`. Seconds, not a cook.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="${1:-$HERE/engine-cvars.5.8.json}"
NAMES_FILE="$(mktemp)"
trap 'rm -f "$NAMES_FILE"' EXIT

# Every name any profile mentions, plus the candidates being evaluated. One
# list so a name can never be applied without having been probed.
python3 "$HERE/collect-cvar-names.py" > "$NAMES_FILE"
COUNT=$(wc -l < "$NAMES_FILE")
echo "probing $COUNT console variables against the real engine"

# Find the packaged build the same way run-stream.sh does.
if [ -n "${WL_APP:-}" ]; then
  APP="$WL_APP"
else
  # shellcheck source=../infra/lightning/common.sh
  . "$HERE/../infra/lightning/common.sh"
  wl_mkdirs
  APP="$(wl_find_first "$WL_OUT/Linux" -maxdepth 3 -name 'Wonderland.sh' -type f)"
fi
if [ -z "${APP:-}" ]; then
  echo "no packaged Wonderland.sh found under \$WL_OUT/Linux. Build it first," >&2
  echo "or point WL_APP at one." >&2
  exit 2
fi
if [ ! -x "$APP" ]; then
  # Naming the path matters: "not found" when WL_APP WAS set sends someone
  # looking for a build that is sitting right there without the execute bit.
  echo "$APP is not executable (WL_APP=${WL_APP:-unset})" >&2
  exit 2
fi

LOG="$(mktemp -d)/probe.log"
EXEC="$(paste -sd, "$NAMES_FILE"),quit"
# A HARD CEILING. The exec list ends in `quit`, but a build that dies before it
# reaches a console, or one that decides to wait for a Pixel Streaming
# connection that will never come, hangs here forever — on a GPU that is being
# paid for by the minute. Two minutes is many times what this needs.
PROBE_TIMEOUT="${WL_PROBE_TIMEOUT:-120}"

# -nullrhi would be faster but a null RHI does not register renderer console
# variables, so a probe under it reports every r.* name as missing. That is a
# wrong answer delivered quickly, which is worse than a slow right one.
set +e
timeout "$PROBE_TIMEOUT" \
  "$APP" -RenderOffscreen -Unattended -stdout -FullStdOutLogOutput \
         -ExecCmds="$EXEC" -ResX=320 -ResY=240 >"$LOG" 2>&1
APP_RC=$?
set -e
if [ "$APP_RC" = "124" ]; then
  # Not fatal on its own: the log may already hold every answer, and
  # parse-cvar-probe.py refuses to call anything absent when nothing answered.
  echo "the build did not exit within ${PROBE_TIMEOUT}s and was stopped." >&2
  echo "reading whatever it logged before that; check the verdicts." >&2
fi

python3 "$HERE/parse-cvar-probe.py" "$NAMES_FILE" "$LOG" "$OUT"
echo "wrote $OUT"
