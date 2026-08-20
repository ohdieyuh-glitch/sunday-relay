#!/usr/bin/env bash
# Wonderland on Lightning — bring up the live stream.
#
# The stack, in the order it has to start:
#   1. coturn        TURN relay. The single fact that made the media path work
#                    last time was ADVERTISING this to the browser through the
#                    signalling server's peer options. Without it the page
#                    connects, negotiates, and stays black.
#   2. Wilbur        PixelStreaming2's signalling server. Launch it with the
#                    ENGINE'S OWN NODE. The system node on these images is
#                    typically ancient and fails in ways that look like a
#                    network problem.
#   3. Wonderland    the packaged client, pointed at signalling.
#   4. cloudflared   a public https URL over outbound 443 only, so it does not
#                    matter which ports the provider exposes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

wl_mkdirs
STAGED="$WL_OUT/Linux"
APP="$(find "$STAGED" -maxdepth 3 -name 'Wonderland.sh' -type f 2>/dev/null | head -1)"
[ -n "$APP" ] || wl_die "no packaged Wonderland.sh under $STAGED — run build-render.sh first"

PUBLIC_MODE="${WL_PUBLIC:-tunnel}"        # tunnel | lightning | none

# ------------------------------------------------------------------ 1. TURN
start_turn() {
  command -v turnserver >/dev/null 2>&1 || { wl_warn "coturn absent; the stream will only work same-host"; return; }
  pgrep -x turnserver >/dev/null && { wl_ok "turn already up"; return; }
  cat > "$WL_RUN/turnserver.conf" <<TURNEOF
listening-port=$WL_TURN_PORT
fingerprint
lt-cred-mech
user=wonderland:wonderland
realm=wonderland
no-tls
no-dtls
no-multicast-peers
TURNEOF
  setsid nohup turnserver -c "$WL_RUN/turnserver.conf" >"$WL_LOG/turn.log" 2>&1 </dev/null &
  sleep 1
  wl_port_listening "$WL_TURN_PORT" && wl_ok "turn listening on $WL_TURN_PORT" \
    || wl_warn "turn did not come up; see $WL_LOG/turn.log"
}

# ------------------------------------------------------------- 2. signalling
start_signalling() {
  local sigdir node
  sigdir="$(find "$WL_UE" -type d -name 'SignallingWebServer' 2>/dev/null | head -1)"
  [ -n "$sigdir" ] || sigdir="$(find "$WL_UE" -type d -name 'Wilbur' 2>/dev/null | head -1)"
  [ -n "$sigdir" ] || wl_die "no signalling server found under $WL_UE (PixelStreaming2 plugin missing?)"

  node="$(wl_bundled_node)"
  if [ -z "$node" ]; then
    wl_warn "engine-bundled node not found; falling back to system node ($(node -v 2>/dev/null || echo none))"
    node="$(command -v node || true)"
    [ -n "$node" ] || wl_die "no node at all; signalling cannot start"
  fi
  wl_say "signalling: $sigdir"
  wl_say "node:       $node ($("$node" -v 2>/dev/null || echo '?'))"

  # THE MEDIA-PATH FIX. peerConnectionOptions carries the ICE servers the
  # BROWSER will use. A stun-only list works on the same host and fails across
  # a network, which is the exact shape of "it worked locally" bugs here.
  local peer
  peer='{"iceServers":[{"urls":["stun:stun.l.google.com:19302"]},'
  peer+='{"urls":["turn:'"$(hostname -I 2>/dev/null | awk '{print $1}')"':'"$WL_TURN_PORT"'"],'
  peer+='"username":"wonderland","credential":"wonderland"}]}'
  printf '%s\n' "$peer" > "$WL_RUN/peer_options.json"

  local entry=""
  for cand in "$sigdir/dist/index.js" "$sigdir/build/index.js" "$sigdir/index.js" "$sigdir/cirrus.js"; do
    [ -f "$cand" ] && { entry="$cand"; break; }
  done
  : > "$WL_LOG/sig.log"
  if [ -n "$entry" ]; then
    setsid nohup "$node" "$entry" \
      --http_port "$WL_HTTP_PORT" --streamer_port "$WL_STREAMER_PORT" \
      --peer_options "$peer" \
      >>"$WL_LOG/sig.log" 2>&1 </dev/null &
  elif [ -x "$sigdir/platform_scripts/bash/start.sh" ]; then
    # The shipped launcher; pass the same options through.
    setsid nohup "$sigdir/platform_scripts/bash/start.sh" \
      --http_port "$WL_HTTP_PORT" --streamer_port "$WL_STREAMER_PORT" \
      --peer_options "$peer" \
      >>"$WL_LOG/sig.log" 2>&1 </dev/null &
  else
    wl_die "found $sigdir but no entry point in it"
  fi

  wl_wait_port "$WL_HTTP_PORT" 60 && wl_ok "signalling http on $WL_HTTP_PORT" \
    || { tail -20 "$WL_LOG/sig.log" >&2; wl_die "signalling never listened on $WL_HTTP_PORT"; }
}

# --------------------------------------------------------------------- 3. app
start_app() {
  : > "$WL_LOG/app.log"
  # -RenderOffscreen because there is no display; the stream IS the display.
  # The AutoExposure bias is the ONLY exposure control that reaches the
  # packaged render — the PostProcessVolume and camera grade were both proven
  # not to. It is read from the LOOK table's documented default.
  setsid nohup "$APP" \
    -PixelStreamingURL="ws://127.0.0.1:$WL_STREAMER_PORT" \
    -RenderOffscreen -ForceRes -ResX="$WL_RES_X" -ResY="$WL_RES_Y" \
    -Unattended -stdout -FullStdOutLogOutput \
    -PixelStreamingEncoderCodec=H264 \
    ${WL_EXTRA_ARGS:-} \
    >>"$WL_LOG/app.log" 2>&1 </dev/null &
  wl_say "waiting for the streamer to join signalling"
  local i=0
  while [ "$i" -lt 60 ]; do
    grep -qaE "Local participant joined the room|Streamer .* connected|player connected" \
      "$WL_LOG/app.log" "$WL_LOG/sig.log" 2>/dev/null && { wl_ok "streamer connected"; return 0; }
    grep -qa "Fatal error" "$WL_LOG/app.log" 2>/dev/null && {
      tail -25 "$WL_LOG/app.log" >&2; wl_die "the client crashed on start"; }
    sleep 3; i=$((i + 1))
  done
  wl_warn "no explicit join line after 3 min — continuing, but suspect"
}

# ------------------------------------------------------------------ 4. public
start_public() {
  case "$PUBLIC_MODE" in
    none)      wl_say "public URL disabled (WL_PUBLIC=none)"; return ;;
    lightning)
      wl_say "expose port $WL_HTTP_PORT from the Lightning Studio's own Ports panel."
      wl_say "That gives a *.lightning.ai URL; paste it to the founder."
      return ;;
  esac
  local cf; cf="$(command -v cloudflared || echo "$WL_RUN/cloudflared")"
  [ -x "$cf" ] || { wl_warn "cloudflared missing; use the Lightning Ports panel instead"; return; }
  : > "$WL_LOG/tunnel.log"
  setsid nohup "$cf" tunnel --no-autoupdate --url "http://127.0.0.1:$WL_HTTP_PORT" \
    >>"$WL_LOG/tunnel.log" 2>&1 </dev/null &
  local i=0 url=""
  while [ "$i" -lt 40 ]; do
    url="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$WL_LOG/tunnel.log" | tail -1)"
    [ -n "$url" ] && break
    sleep 2; i=$((i + 1))
  done
  if [ -n "$url" ]; then
    printf '%s\n' "$url" > "$WL_RUN/player-url.txt"
    wl_ok "public URL: $url"
  else
    wl_warn "no tunnel URL after 80s; see $WL_LOG/tunnel.log"
  fi
}

start_turn
start_signalling
start_app
start_public

echo
wl_say "--- listening ---"
for p in "$WL_HTTP_PORT" "$WL_STREAMER_PORT" "$WL_TURN_PORT"; do
  wl_port_listening "$p" && echo "    tcp $p LISTEN" || echo "    tcp $p --"
done
wl_have_gpu && nvidia-smi --query-gpu=name,utilization.gpu,memory.used --format=csv,noheader | sed 's/^/    gpu: /'
[ -f "$WL_RUN/player-url.txt" ] && wl_ok "player: $(cat "$WL_RUN/player-url.txt")"
