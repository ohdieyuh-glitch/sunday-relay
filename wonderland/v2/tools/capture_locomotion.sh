#!/usr/bin/env bash
# THE FOUNDER-REVIEW LOCOMOTION VIDEO: one continuous take, not a contact sheet.
#
#   bash wonderland/v2/tools/capture_locomotion.sh [seconds] [fps]
#
# The founder asked to SEE the movement — idle and its head behaviour, idle to
# walk, walk to jog, jog to the arms-back run, the sustained run, run to stop,
# turns both ways, stairs, and a side view that proves the elbow is a joint.
# Frames cannot show any of that: at a running speed of 520 uu/s the Dog covers
# most of a stride between two screenshots, so every gait looks like teleporting
# and a real snap would be indistinguishable from the capture rate. This records
# the PAINTED FRAMES of the live Pixel Streaming session instead, through
# Chrome DevTools' screencast, which is dense enough to see a foot leave a
# flagstone.
#
# THE DOG DRIVES ITSELF HERE. The route in ARelayDogCharacter::BuildDefaultRoute
# hits every gait in the order above, so two captures a week apart are the same
# take and can be compared honestly. It is switched on by the -wldemo launch
# flag, so this needs no rebuild and no separate cook — the package the founder
# plays is the package that is filmed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
LIGHTNING="$HERE/../../infra/lightning"
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
# shellcheck source=../../infra/lightning/common.sh
. "$LIGHTNING/common.sh"

# WHICH ROUTE. `gait` is the locomotion demo (idle, walk, jog, run, the
# arms-back sprint, stop, turns, stairs); `explore` is the district tour the
# founder specified for world review. They are different films answering
# different questions, and the same package produces both.
ROUTE="${WL_ROUTE:-gait}"
case "$ROUTE" in
  gait) ROUTE_FLAG="-wldemo" ;;
  explore) ROUTE_FLAG="-wlexplore" ;;
  *) wl_die "WL_ROUTE must be gait or explore, not '$ROUTE'" ;;
esac

SECONDS_TO_FILM="${1:-75}"
FPS="${2:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$WL_ROOT/proof/locomotion/${ROUTE}-$STAMP"
mkdir -p "$OUT"

# A capture must know WHAT it filmed. The packaged sha and the route the Dog
# was given go in beside the frames, because a video of an unnamed build is an
# anecdote.
SHA="$(head -1 "$WL_OUT/logs/packaged.sha" 2>/dev/null || echo unknown)"

wl_say "filming the $ROUTE route: ${SECONDS_TO_FILM}s at ${FPS} fps into $OUT (build $SHA)"

# A PLAY SESSION IS NOT A CAPTURE SESSION. Restarting the stream underneath a
# founder who is mid-playtest is rude and, worse, silently films their session
# instead of the scripted route. Refuse unless told to take the GPU.
if pgrep -f "Binaries/Linux/Wonderlan[d]" >/dev/null 2>&1 && [ "${WL_TAKE_STREAM:-0}" != "1" ]; then
  wl_die "a Wonderland stream is already running -- someone may be playing. Re-run with WL_TAKE_STREAM=1 to restart it for the capture."
fi

# 1. THE GAME, DRIVING ITSELF. Restart the stream with the demo flag so the
#    take is the scripted route rather than whatever the last player left.
WL_MAP_ARG="${WL_MAP_ARG:-/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2}" \
WL_EXTRA_ARGS="${WL_EXTRA_ARGS:-} $ROUTE_FLAG" \
  bash "$LIGHTNING/run-stream.sh"

# FILM FROM LOCALHOST, NOT THROUGH THE TUNNEL.
#
# The screencast runs ON this box, so the public cloudflared URL buys nothing
# and costs plenty: it adds DNS (which failed outright once --
# ERR_NAME_NOT_RESOLVED on a tunnel that had just been created), a round trip
# to Cloudflare and back, and the bitrate ceiling meant for a viewer on the
# other side of the world. The player page is served on 8080 right here.
LOCAL_URL="http://127.0.0.1:${WL_HTTP_PORT:-8080}/"
PUBLIC_URL="$(cat "$WL_RUN/player-url.txt" 2>/dev/null || true)"
URL="$LOCAL_URL"
wl_say "filming from $URL (public URL for a human viewer: ${PUBLIC_URL:-none})"

# 2. THE FRAMES. shot.cjs's sibling: one JPEG per painted frame, with the CDP
#    timestamp, so a gap in the output can be told from a gap in the stream.
NODE="$(wl_bundled_node 2>/dev/null || command -v node || true)"
[ -n "$NODE" ] || wl_die "no node; run after-restart.sh first"
"$NODE" "$LIGHTNING/screencast.cjs" "$URL" "$OUT" "$SECONDS_TO_FILM" "$FPS" \
  || wl_die "screencast failed; see $OUT"

COUNT="$(ls "$OUT"/*.jpg 2>/dev/null | wc -l)"
[ "$COUNT" -gt 0 ] || wl_die "the screencast wrote no frames"

# 3. THE VIDEO. ffmpeg when the box has it; the frames and their timing sidecar
#    are the deliverable either way, and saying which happened matters more
#    than quietly producing half of it.
if command -v ffmpeg >/dev/null 2>&1; then
  ffmpeg -y -loglevel error -framerate "$FPS" -pattern_type glob -i "$OUT/*.jpg" \
    -c:v libx264 -pix_fmt yuv420p -crf 20 "$OUT/$ROUTE-$STAMP.mp4" \
    && wl_ok "video: $OUT/$ROUTE-$STAMP.mp4 ($COUNT frames)"
else
  wl_warn "no ffmpeg on this box: $COUNT frames written to $OUT, not encoded"
fi

# 4. WHAT THE DOG WAS ACTUALLY DOING, from its own log, so the video can be
#    read against the arithmetic rather than only watched.
grep -a "WLDOG " "$WL_LOG/app.log" 2>/dev/null | tail -60 | sed 's/.*LogTemp: //' > "$OUT/dog-state.txt" || true
printf '%s\n' "$SHA" > "$OUT/packaged.sha"
wl_ok "$COUNT frames, state log $OUT/dog-state.txt, build $SHA"
printf '%s\n' "$OUT"
