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

  # THE NODE IS VERIFIED, NOT ASSUMED. A wrong node fails deep inside a
  # dependency and reads as a networking problem — an expensive way to learn a
  # version number on a GPU. wl_require_node compares against the checkout's
  # own NODE_VERSION and fails closed before Wilbur is launched.
  local node nodedir
  node="$(wl_require_node)"
  nodedir="$(dirname "$node")"
  PATH="$nodedir:$PATH"; export PATH
  command -v npm >/dev/null 2>&1 || wl_die "no npm alongside $node; Wilbur cannot start"

  wl_say "signalling: $WL_PS_SIG ($WL_PS_VERSION)"
  wl_say "node:       $node ($("$node" -v 2>/dev/null || echo '?'), required $(wl_ps_required_node))"

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

  # ---------------------------------------------------- the rendering profile
  #
  # THIS BLOCK USED TO BE A COMMENT AND NOTHING ELSE. The note below said the
  # AutoExposure bias is the only exposure control that reaches the packaged
  # render and that it is read from the LOOK table — and then the command line
  # carried no -ExecCmds at all, so the bias was never applied on this host.
  # The older vast/ and gcp/ launchers do pass it; the Lightning one was
  # written without it and the comment came along anyway. Every frame streamed
  # from Lightning has been rendered at the engine's default exposure.
  #
  # So the settings are now RESOLVED, from wonderland/rendering/profiles.json,
  # and the resolver refuses any console variable the engine has been probed
  # for and does not have. WL_RENDER_PROFILE picks the tier; WL_EXEC_CMDS
  # overrides the whole payload for a one-off experiment.
  local render_dir profile exec_cmds profile_args
  render_dir="$HERE/../../rendering"
  profile="${WL_RENDER_PROFILE:-BALANCED}"
  profile_args=()
  if [ -r "$render_dir/render-profile.py" ]; then
    if [ -n "${WL_EXEC_CMDS:-}" ]; then
      exec_cmds="$WL_EXEC_CMDS"
      wl_say "render: -ExecCmds from WL_EXEC_CMDS (profile bypassed)"
    else
      exec_cmds="$(python3 "$render_dir/render-profile.py" emit "$profile")" \
        || wl_die "rendering profile $profile did not resolve"
      # Word-split ON PURPOSE and only here: these are separate switches with
      # no spaces inside them, and an array keeps the -ExecCmds payload — which
      # DOES contain spaces — a single argument.
      # shellcheck disable=SC2207
      profile_args=($(python3 "$render_dir/render-profile.py" args "$profile"))
      wl_say "render: profile $profile, ${#profile_args[@]} stream args"
    fi
  else
    exec_cmds="${WL_EXEC_CMDS:-}"
    wl_warn "no rendering profile resolver at $render_dir — launching with engine defaults"
  fi
  local exec_arg=()
  [ -n "${exec_cmds:-}" ] && exec_arg=(-ExecCmds="$exec_cmds")

  # -RenderOffscreen because there is no display; the stream IS the display.
  # THE VULKAN ENVIRONMENT IS APPLIED HERE AND NOWHERE ELSE. wl_vulkan_env
  # wraps this one process with env(1); nothing is exported into the Studio,
  # because a global VK_DRIVER_FILES on a shared machine would silently
  # redirect every other GPU program on it.
  # THE HERO CAMERA. -CinematicView pins the view to a placed CameraActor so two
  # runs of the bench frame the identical shot; without it the capture is
  # whatever the possessed pawn happened to face and a before/after compares
  # two different pictures.
  local cam_args=()
  if [ -n "${WL_HERO_CAM:-}" ]; then
    cam_args=(-CinematicView "-HeroCam=$WL_HERO_CAM")
  fi

  setsid nohup env $(wl_vulkan_env_pairs) "$APP" \
    -PixelStreamingURL="ws://127.0.0.1:$WL_STREAMER_PORT" \
    -RenderOffscreen -ForceRes -ResX="$WL_RES_X" -ResY="$WL_RES_Y" \
    -Unattended -stdout -FullStdOutLogOutput \
    -PixelStreamingEncoderCodec=H264 \
    "${profile_args[@]+"${profile_args[@]}"}" \
    "${exec_arg[@]+"${exec_arg[@]}"}" \
    "${cam_args[@]+"${cam_args[@]}"}" \
    ${WL_EXTRA_ARGS:-} \
    >>"$WL_LOG/app.log" 2>&1 </dev/null &
  # Record exactly what was launched. A rendering result that cannot name the
  # arguments that produced it is an anecdote.
  { printf 'profile=%s\n' "$profile"
    printf 'exec_cmds=%s\n' "${exec_cmds:-}"
    printf 'stream_args=%s\n' "${profile_args[*]-}"
    printf 'hero_cam=%s\n' "${WL_HERO_CAM:-none}"; } > "$WL_RUN/render-launch.txt"
  wl_say "waiting for the streamer to join signalling"
  local i=0
  while [ "$i" -lt 60 ]; do
    grep -qaE "Local participant joined the room|Streamer .* connected|player connected" \
      "$WL_LOG/app.log" "$WL_LOG/sig.log" 2>/dev/null && { wl_ok "streamer connected"; return 0; }
    grep -qa "Fatal error" "$WL_LOG/app.log" 2>/dev/null && {
      tail -25 "$WL_LOG/app.log" >&2; wl_die "the client crashed on start"; }
    sleep 3; i=$((i + 1))
  done
  # NAME THE TWO DIFFERENT FAILURES. "No join line" reads the same whether the
  # streamer could not reach Wilbur or the build has no streamer in it, and
  # those need opposite responses. Zero PixelStreaming lines of ANY kind means
  # the runtime is not in the package — the exact "No streamer available" case.
  if grep -qaiE "PixelStreaming|WebRTC|Streamer" "$WL_LOG/app.log" 2>/dev/null; then
    wl_warn "the streamer started but never joined Wilbur after 3 min — check $WL_LOG/sig.log"
  else
    wl_warn "app.log contains NO PixelStreaming/WebRTC/Streamer lines at all."
    wl_warn "That is not a connection problem: this package has no Pixel Streaming"
    wl_warn "runtime in it, so there is nothing to connect. The browser will say"
    wl_warn "'No streamer available'. Enable the plugin and repackage."
    wl_die "no streamer in the packaged build"
  fi
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
wl_require_node >/dev/null
wl_ok "node $(wl_ps_required_node) verified for Wilbur"
# BEFORE TURN, not after. Wilbur's node_modules went missing across a CPU->L4
# machine switch and MODULE_NOT_FOUND on require("express") surfaced only once
# coturn was already up — which leaves the machine half-started for the next
# attempt to clean up.
wl_require_wilbur_modules
# AND BEFORE THE CLIENT IS LAUNCHED AT ALL. The packaged Wonderland starts,
# reaches RHIInit, and dies on VK_ERROR_INCOMPATIBLE_DRIVER when Vulkan cannot
# see the NVIDIA device. Launching into that costs the whole stack coming up
# first and reports as a mysterious "streamer never joined".
wl_require_vulkan
# THE PACKAGE MUST CONTAIN A STREAMER. Wonderland ran on the L4, Wilbur served,
# the player page loaded, and the browser said "No streamer available" — the
# build had no Pixel Streaming runtime in it, and an unknown command-line
# switch is not an error to Unreal, so nothing said so. app.log held the
# -PixelStreamingURL line and not one streamer, WebRTC or encoder line.
if [ -r "$HERE/../build/verify-packaged-streamer.py" ]; then
  python3 "$HERE/../build/verify-packaged-streamer.py" || {
    [ "$?" = 2 ] || wl_die "the packaged build contains no Pixel Streaming runtime; repackage after enabling the plugin (see the report above)"; }
fi
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
