#!/usr/bin/env bash
# ONE COMMAND, FROM A COLD STUDIO TO A URL THE FOUNDER CAN PLAY.
#
#   bash wonderland/v2/tools/playtest.sh              # on the Studio, in $WL_SRC
#
# The founder's ask (2026-08-29) is that entering Wonderland costs them one
# link and nothing else — no paths, no logs, no dependency repair. Everything
# between a Studio that has just come back and a playable Golden Arrival is
# here, in order, and each step is skipped when it is already done:
#
#   1. after-restart.sh   the UE image, the bundled node's npm, Wilbur's
#                         workspace node_modules, playwright/chrome, the
#                         runtime libs, the TURN image — all of which a
#                         Lightning machine change discards
#   2. build + cook       only if the packaged build is not already the
#                         checkout's HEAD (a rebuild costs ~40 minutes and a
#                         playtest that did not need one should not pay it)
#   3. run-stream.sh      the packaged game with Pixel Streaming, the
#                         signalling server, coturn and a cloudflared tunnel
#   4. the URL            printed alone on the last line, and left in
#                         run/player-url.txt
#
# WHY IT IS NOT launch-wonderland.sh. That script is the capture pipeline: it
# ends by taking a hero frame and verifying the world against the proof, which
# is the right thing for a render and the wrong thing for a play session — it
# spends GPU minutes on a screenshot the founder did not ask for and can fail
# the run over a frame. This one stops at "there is a URL and the game is up".
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LIGHTNING="$HERE/../../infra/lightning"
# THE BRANCH IS DECIDED BEFORE common.sh IS SOURCED, and this is not a style
# choice. common.sh exports WL_BRANCH=relay/wonderland-marble as its default;
# once it has, every `${WL_BRANCH:-relay/wonderland-v2}` further down the chain
# resolves to MARBLE, because the variable is set. So a V2 script that sources
# common.sh and then relies on a :- default silently asks prepare.sh to switch
# the checkout to the marble branch, and prepare.sh (rightly, loudly) refuses.
# Setting it first makes every later default agree.
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
# shellcheck source=../../infra/lightning/common.sh
. "$LIGHTNING/common.sh"

banner() { printf '\n\033[1;35m========== %s ==========\033[0m\n' "$1"; }

banner "1/4  WHAT THE RESTART TOOK"
bash "$LIGHTNING/after-restart.sh"

banner "2/4  IS THE PACKAGE THE CODE"
HEAD_SHA="$(git -C "$WL_SRC" rev-parse HEAD)"
PACKAGED="$(cat "$WL_OUT/logs/packaged.sha" 2>/dev/null | head -1 | tr -dc 'a-f0-9' || true)"
APP="$(wl_find_first "$WL_OUT/Linux" -maxdepth 3 -name 'Wonderland.sh' -type f || true)"
if [ -n "${APP:-}" ] && [ "$PACKAGED" = "$HEAD_SHA" ]; then
  wl_ok "the packaged build IS $HEAD_SHA — no rebuild needed"
else
  if [ -z "${APP:-}" ]; then
    wl_say "no packaged build on disk; building and cooking (about 40 minutes)"
  else
    wl_say "packaged ${PACKAGED:-none} != checkout ${HEAD_SHA}; rebuilding and cooking (about 40 minutes)"
  fi
  # The same chain the render passes use, so a playtest and a capture are
  # always looking at the same world.
  # WL_COOK_MAP NAMES THE CLASSIC MAP, ALWAYS. Two maps exist under
  # WonderlandV2/Maps and only one of them is Wonderland: WL_V2_GoldenArrival
  # is the empty World Partition level the generator creates and immediately
  # stops using (14 KB), and WL_V2_GoldenArrival_WP2 is the world (1.4 MB).
  # The cook's default is the FORMER, so a cook that does not name the map
  # packages an empty world -- and it does it silently, because an empty level
  # cooks perfectly well. Caught by a profiling run that could not load the map
  # it asked for, one step before the founder would have opened an empty
  # Wonderland.
  WLV2_PASS02=1 WLV2_PASS03=1 WLV2_PASS05=1 \
    WL_COOK_MAP="${WL_COOK_MAP:-/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2}" \
    bash "$HERE/pass_chain.sh"
  PACKAGED="$(cat "$WL_OUT/logs/packaged.sha" 2>/dev/null | head -1 | tr -dc 'a-f0-9' || true)"
  [ "$PACKAGED" = "$HEAD_SHA" ] || wl_die "the chain finished but the package is ${PACKAGED:-none}, not $HEAD_SHA"
  wl_ok "packaged $HEAD_SHA"
fi

banner "3/4  THE STREAM"
# THE MAP MUST BE NAMED. The package boots the engine's empty World Partition
# GameDefaultMap unless the classic Golden Arrival map is passed on the command
# line — a founder dropped into an empty grey world would reasonably conclude
# Wonderland was gone.
export WL_MAP_ARG="${WL_MAP_ARG:-/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2}"
# 720p FOR A PLAY SESSION, not 1080p. The founder plays from the other side of
# the world; halving the pixels halves what has to cross it, and a locomotion
# review is about how the Dog moves rather than how many pixels it moves in.
# Renders and captures still run at whatever they ask for.
export WL_RES_X="${WL_RES_X:-1280}"
export WL_RES_Y="${WL_RES_Y:-720}"
bash "$LIGHTNING/run-stream.sh"

banner "4/4  THE LINK"
URL="$(cat "$WL_RUN/player-url.txt" 2>/dev/null || true)"
if [ -z "$URL" ]; then
  wl_die "the stream is up but no public URL was published; see $WL_LOG/tunnel.log"
fi
cat <<EOF

  Wonderland V2 — Golden Arrival, playable.

    $URL

  Click the page once so it takes the keyboard, then:
    W A S D / arrows   move        mouse   look
    shift (hold)       run         ctrl (hold)   walk

    SPACE              the LIVE TERMINAL
    ESC                back to the world

  The Relay Dog does not jump. Space is the front door: it opens the terminal
  over the live world, and inside it Space types a space like anywhere else.

EOF
printf '%s\n' "$URL"
