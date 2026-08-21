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
# `Help` FIRST. Typing a console variable's name echoes its value through
# LogConsoleResponse at Display verbosity — and a real probe run came back with
# 44 of 44 names `silent`, because that never reached the packaged log. `Help`
# asks the engine to write its own console registry to a FILE instead, which no
# log verbosity setting can filter. Whether this build writes one is NOT assumed
# here: the file is searched for afterwards and its absence is reported, not
# papered over.
EXEC="Help,$(paste -sd, "$NAMES_FILE"),quit"
# A HARD CEILING. The exec list ends in `quit`, but a build that dies before it
# reaches a console, or one that decides to wait for a Pixel Streaming
# connection that will never come, hangs here forever — on a GPU that is being
# paid for by the minute. Two minutes is many times what this needs.
PROBE_TIMEOUT="${WL_PROBE_TIMEOUT:-120}"

# -nullrhi would be faster but a null RHI does not register renderer console
# variables, so a probe under it reports every r.* name as missing. That is a
# wrong answer delivered quickly, which is worse than a slow right one.
set +e
# -LogCmds RAISES THE VERBOSITY OF THE CATEGORY THAT CARRIES THE ANSWER.
# The echo a console variable prints goes out under LogConsoleResponse, and the
# previous probe's total silence is consistent with that category being filtered
# out of the packaged log. Asking for it explicitly costs nothing and is the
# cheapest possible explanation to eliminate.
timeout "$PROBE_TIMEOUT" \
  "$APP" -RenderOffscreen -Unattended -stdout -FullStdOutLogOutput \
         -LogCmds="LogConsoleResponse Verbose, LogConsoleManager Verbose" \
         -ExecCmds="$EXEC" -ResX=320 -ResY=240 >"$LOG" 2>&1
APP_RC=$?
set -e
if [ "$APP_RC" = "124" ]; then
  # Not fatal on its own: the log may already hold every answer, and
  # parse-cvar-probe.py refuses to call anything absent when nothing answered.
  echo "the build did not exit within ${PROBE_TIMEOUT}s and was stopped." >&2
  echo "reading whatever it logged before that; check the verdicts." >&2
fi

# THE SECOND CHANNEL. Find the registry the engine may have written, without
# claiming to know where it lands: search the packaged tree and the newest match
# wins, so a stale file from an earlier probe cannot be mistaken for this run's.
APP_DIR="$(dirname "$APP")"
REGISTRY=""
for root in "$APP_DIR" "$HOME/.config/Epic" "$HOME/Documents/Unreal Engine"; do
  [ -d "$root" ] || continue
  found="$(find "$root" -name 'ConsoleHelp.html' -type f -newermt '-10 minutes' \
             -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)"
  if [ -n "$found" ]; then REGISTRY="$found"; break; fi
done
if [ -n "$REGISTRY" ]; then
  echo "console registry written by the engine: $REGISTRY"
else
  echo "no ConsoleHelp.html was written by this build — the registry channel is" >&2
  echo "unavailable and every verdict rests on the log echo alone." >&2
fi

python3 "$HERE/parse-cvar-probe.py" "$NAMES_FILE" "$LOG" "$OUT" "$REGISTRY"
echo "wrote $OUT"
