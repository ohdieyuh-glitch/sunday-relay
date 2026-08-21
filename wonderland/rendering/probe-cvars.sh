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
[ -n "${APP:-}" ] && [ -x "$APP" ] \
  || { echo "no packaged Wonderland.sh found; build it first, or set WL_APP" >&2; exit 2; }

LOG="$(mktemp -d)/probe.log"
EXEC="$(paste -sd, "$NAMES_FILE"),quit"

# -nullrhi would be faster but a null RHI does not register renderer console
# variables, so a probe under it reports every r.* name as missing. That is a
# wrong answer delivered quickly, which is worse than a slow right one.
set +e
"$APP" -RenderOffscreen -Unattended -stdout -FullStdOutLogOutput \
       -ExecCmds="$EXEC" -ResX=320 -ResY=240 >"$LOG" 2>&1
set -e

python3 "$HERE/parse-cvar-probe.py" "$NAMES_FILE" "$LOG" "$OUT"
echo "wrote $OUT"
