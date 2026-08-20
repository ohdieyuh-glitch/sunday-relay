#!/usr/bin/env bash
# Wonderland on Lightning — bring up the live stream.
#
# The stack, in the order it has to start:
#   1. coturn        TURN relay. The single fact that made the media path work
#                    last time was ADVERTISING this to the browser through the
#                    signalling server's peer options. Without it the page
#                    connects, negotiates, and stays black.
#   2. Wilbur        PixelStreaming2's signalling server, from the SEPARATE
#                    PixelStreamingInfrastructure checkout on persistent
#                    storage — NOT from inside the engine. On Lightning the
#                    engine is a Docker image, so there is no engine tree to
#                    search and the old lookup could never succeed. Launch it
#                    with the infrastructure's OWN NODE; the system node on
#                    these images is typically ancient and fails in ways that
#                    look like a network problem.
#   3. Wonderland    the packaged client, pointed at signalling.
#   4. cloudflared   a public https URL over outbound 443 only, so it does not
#                    matter which ports the provider exposes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

wl_mkdirs
STAGED="$WL_OUT/Linux"
APP="$(wl_find_first "$STAGED" -maxdepth 3 -name 'Wonderland.sh' -type f)"
[ -n "$APP" ] || wl_die "no packaged Wonderland.sh under $STAGED — run build-render.sh first"

PUBLIC_MODE="${WL_PUBLIC:-tunnel}"        # tunnel | lightning | none

# ------------------------------------------------------------------ 1. TURN
#
# THE CONTAINER, NOT A HOST BINARY. There is no `turnserver` on the Lightning
# image and no root to install one, so the old `command -v turnserver` check
# took the "coturn absent, same-host only" branch on every run — a warning,
# not an error, which is how a stream reaches a browser and stays black.
start_turn() {
  wl_ensure_turn_image
  if wl_turn_container_running; then
    wl_ok "turn container $WL_TURN_CONTAINER already running"
    return 0
  fi
  # A stopped container of ours keeps the name and blocks `docker run`. Remove
  # only the one we own, by exact name.
  docker rm -f "$WL_TURN_CONTAINER" >/dev/null 2>&1 || true

  cat > "$WL_RUN/turnserver.conf" <<TURNEOF
listening-port=$WL_TURN_PORT
fingerprint
lt-cred-mech
user=$WL_TURN_USER:$WL_TURN_PASS
realm=$WL_TURN_REALM
no-tls
no-dtls
no-multicast-peers
TURNEOF

  # --network host so the relay's advertised address is the machine's own and
  # the allocated media ports need no mapping; a bridged coturn hands the
  # browser an address inside Docker that nothing outside can reach.
  docker run -d --name "$WL_TURN_CONTAINER" --network host \
    -v "$WL_RUN/turnserver.conf:/etc/coturn/turnserver.conf:ro" \
    "$WL_TURN_IMAGE" -c /etc/coturn/turnserver.conf \
    >"$WL_LOG/turn.container" 2>>"$WL_LOG/turn.log" \
    || wl_die "docker run failed for $WL_TURN_IMAGE; see $WL_LOG/turn.log"

  # RUNNING IS NOT LISTENING. A container that exits immediately still leaves
  # a zero exit from `docker run -d`, so both facts are checked.
  local i=0
  while [ "$i" -lt 15 ]; do
    wl_port_listening "$WL_TURN_PORT" && break
    sleep 1; i=$((i + 1))
  done
  wl_turn_container_running || {
    docker logs "$WL_TURN_CONTAINER" >>"$WL_LOG/turn.log" 2>&1 || true
    wl_die "the TURN container exited; see $WL_LOG/turn.log"; }
  wl_port_listening "$WL_TURN_PORT" \
    || wl_die "TURN container is up but nothing is listening on $WL_TURN_PORT; see $WL_LOG/turn.log"
  wl_ok "turn listening on $WL_TURN_PORT (container $WL_TURN_CONTAINER)"
}

# ------------------------------------------------------------- 2. signalling
start_signalling() {
  # Version, dist/ and www/ all proven before anything is started. Each of the
  # three fails differently and none of them announces itself at run time: the
  # wrong branch ignores unknown flags, a missing dist has no entry point, a
  # missing www serves 404 on the page the founder was handed.
  wl_require_ps_infra

  # The infrastructure ships the node Wilbur was built against (v22.14.0 on
  # the UE5.8 branch). Prefer it over anything on PATH — this is the same
  # class of bug as the engine's bundled node, and the symptom is identical:
  # a syntax error deep in a dependency that reads as a network failure.
  local node npm_bin nodedir
  node="$(wl_bundled_node)"
  if [ -n "$node" ]; then
    nodedir="$(dirname "$node")"
    PATH="$nodedir:$PATH"
    export PATH
  else
    wl_warn "no bundled node found under $WL_PS_INFRA; falling back to $(command -v node || echo none)"
  fi
  npm_bin="$(command -v npm || true)"
  [ -n "$npm_bin" ] || wl_die "no npm available to start Wilbur"

  wl_say "signalling: $WL_PS_SIG ($WL_PS_VERSION)"
  wl_say "node:       $(command -v node || echo '?') ($(node -v 2>/dev/null || echo '?'))"

  # THE MEDIA-PATH FIX. peerConnectionOptions carries the ICE servers the
  # BROWSER will use. A stun-only list works on the same host and fails across
  # a network, which is the exact shape of "it worked locally" bugs here.
  #
  # PASSED AS A FILE, not as inline JSON. UE5.8's Wilbur recommends
  # --peer_options_file, and the inline form loses its quoting through the
  # `npm start --` boundary — the server then starts with DEFAULT ICE servers
  # and no TURN, silently, which is indistinguishable from success until a
  # remote browser tries to play.
  local host peer
  host="$( ( set +o pipefail; hostname -I 2>/dev/null | awk '{print $1}' ) || true)"
  [ -n "$host" ] || host="127.0.0.1"
  peer='{"iceServers":[{"urls":["stun:stun.l.google.com:19302"]},'
  peer+='{"urls":["turn:'"$host"':'"$WL_TURN_PORT"'"],'
  peer+='"username":"'"$WL_TURN_USER"'","credential":"'"$WL_TURN_PASS"'"}]}'
  printf '%s\n' "$peer" > "$WL_RUN/peer_options.json"

  : > "$WL_LOG/sig.log"
  # UE5.8 Wilbur flags, exactly: --player_port (not --http_port), --serve with
  # an explicit --http_root, and the peer options from a file.
  ( cd "$WL_PS_SIG" && setsid nohup npm start -- \
      --streamer_port "$WL_STREAMER_PORT" \
      --player_port "$WL_HTTP_PORT" \
      --serve \
      --http_root "$WL_PS_SIG/www" \
      --peer_options_file "$WL_RUN/peer_options.json" \
      >>"$WL_LOG/sig.log" 2>&1 </dev/null & )

  wl_wait_port "$WL_HTTP_PORT" 60 \
    || { tail -20 "$WL_LOG/sig.log" >&2; wl_die "signalling never listened on $WL_HTTP_PORT"; }
  # BOTH ports. The streamer socket is the one the packaged client connects
  # to; a Wilbur serving the page while that socket never opened would pass
  # every HTTP check and never receive a single frame.
  wl_wait_port "$WL_STREAMER_PORT" 30 \
    || { tail -20 "$WL_LOG/sig.log" >&2; wl_die "signalling never listened on the streamer port $WL_STREAMER_PORT"; }
  # And the page must ANSWER, not merely be bound. --serve with a wrong
  # --http_root binds happily and 404s every request.
  wl_http_ok "http://127.0.0.1:$WL_HTTP_PORT/" 15 \
    || { tail -20 "$WL_LOG/sig.log" >&2; wl_die "the player page at 127.0.0.1:$WL_HTTP_PORT did not answer; check --http_root"; }
  wl_ok "signalling http $WL_HTTP_PORT, streamer $WL_STREAMER_PORT, player page answering"
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
    # NO MATCH IS THE NORMAL CASE HERE — the loop polls until the tunnel
    # prints its URL, so grep exits 1 on nearly every early pass. Under
    # pipefail that status reaches the assignment and `set -e` kills the
    # script on the FIRST poll, before the tunnel could ever have been ready.
    url="$( ( set +o pipefail
              grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$WL_LOG/tunnel.log" \
                | tail -1 ) || true)"
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

# PRE-FLIGHT: a port someone else already holds.
#
# stop-wonderland.sh has just run, so anything of ours is gone. Whatever is
# still on these ports belongs to something else, and starting into that
# collision is the quiet failure: our server fails to bind, and every later
# check that merely asks "is the port listening" passes on the intruder.
for _p in "$WL_HTTP_PORT" "$WL_STREAMER_PORT" "$WL_TURN_PORT"; do
  if wl_port_listening "$_p"; then
    _owner="$(wl_port_owner_pid "$_p" || true)"
    wl_die "port $_p is already in use${_owner:+ by pid $_owner} — Wonderland cannot bind it. Free it, or set WL_HTTP_PORT / WL_STREAMER_PORT / WL_TURN_PORT."
  fi
done

# PRE-FLIGHT: everything that can be known before anything is started.
#
# Each of these used to be discovered mid-launch, after a TURN server or a
# signalling process was already running, which leaves the machine in a half-up
# state that the next run then has to clean up. They are also all cheap, and
# every one of them has an unambiguous answer on CPU — so the GPU is never the
# thing that finds out.
wl_require_ps_infra
case "$(wl_turn_status)" in
  READY)      wl_ok "coturn image present: $WL_TURN_IMAGE" ;;
  RESTORABLE) wl_say "coturn image absent; will restore from $WL_TURN_ARCHIVE" ;;
  MISSING)    wl_die "no coturn image and no archive at $WL_TURN_ARCHIVE. Save it on CPU first; this launcher will not download it on a GPU machine." ;;
esac

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
