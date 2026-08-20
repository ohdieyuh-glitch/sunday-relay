#!/usr/bin/env bash
# Stop everything GPU-intensive, cleanly, and say when it is safe to switch the
# Studio back to CPU or let it sleep.
#
# Credits are the constraint. The expensive thing is not the Studio existing,
# it is the GPU being attached — so this exists to make "I am done" a single
# command rather than a memory test about which four processes are running.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

QUIET=0
[ "${1:-}" = "--quiet" ] && QUIET=1
say() { [ "$QUIET" = 1 ] || wl_say "$*"; }

stopped=0
kill_match() {
  local label="$1" pat="$2" pids
  pids="$(pgrep -f "$pat" 2>/dev/null || true)"
  [ -n "$pids" ] || return 0
  say "stopping $label ($(echo "$pids" | tr '\n' ' '))"
  # TERM first so the engine flushes its log; KILL only what refuses.
  echo "$pids" | xargs -r kill 2>/dev/null || true
  sleep 3
  pids="$(pgrep -f "$pat" 2>/dev/null || true)"
  [ -n "$pids" ] && echo "$pids" | xargs -r kill -9 2>/dev/null || true
  stopped=1
}

# ONLY WHAT IS OURS.
#
# These patterns used to be bare process names — cloudflared, turnserver,
# anything matching "signalling". On a shared Studio that is indiscriminate: a
# founder's own tunnel or another project's TURN server matches just as well as
# ours, and "stop Wonderland" would take them down without a word.
#
# Every pattern below is anchored to something this deployment owns — the
# packaged build, our infrastructure checkout, our HTTP port, our container
# name — so a process that merely shares a binary name is left alone.
kill_match "Wonderland client" "[W]onderland.*PixelStreamingURL"
kill_match "signalling"        "${WL_PS_INFRA//\//\/}.*(SignallingWebServer|Wilbur|signalling)"
kill_match "tunnel"            "[c]loudflared.*127\.0\.0\.1:${WL_HTTP_PORT}"

# TURN IS A CONTAINER NOW, and it is removed BY NAME.
#
# The old line killed any host process matching turnserver. There is no host
# turnserver on Lightning, so it did nothing; the danger is the shape it would
# have taken next — `docker rm $(docker ps -q --filter ancestor=coturn)` would
# stop every coturn on a shared Studio, including one that is not ours. Only
# the exact name this deployment created is touched.
if command -v docker >/dev/null 2>&1; then
  if [ -n "$(docker ps -aq --filter "name=^/${WL_TURN_CONTAINER}$" 2>/dev/null || true)" ]; then
    say "stopping turn container $WL_TURN_CONTAINER"
    docker rm -f "$WL_TURN_CONTAINER" >/dev/null 2>&1 || true
    stopped=1
  fi
fi

sleep 2
echo
if [ "$QUIET" = 1 ]; then exit 0; fi

wl_say "--- ports ---"
for p in "$WL_HTTP_PORT" "$WL_STREAMER_PORT" "$WL_TURN_PORT"; do
  wl_port_listening "$p" && echo "    tcp $p STILL LISTENING" || echo "    tcp $p closed"
done

if wl_have_gpu; then
  wl_say "--- gpu ---"
  nvidia-smi --query-gpu=utilization.gpu,memory.used --format=csv,noheader | sed 's/^/    /'
  # Anything still holding VRAM means something survived, and switching the
  # Studio down with a live process is how a "stopped" session keeps billing.
  BUSY="$(nvidia-smi --query-compute-apps=pid,process_name --format=csv,noheader 2>/dev/null || true)"
  if [ -n "$BUSY" ]; then
    wl_warn "processes STILL on the GPU:"
    echo "$BUSY" | sed 's/^/    /'
    wl_warn "do not switch the Studio down until these are gone"
    exit 1
  fi
fi

wl_ok "nothing is holding the GPU."
echo
echo "  Artifacts kept on persistent storage (a rebuild will not be needed):"
echo "    engine   $WL_UE"
echo "    packaged $WL_OUT"
echo "    frames   $WL_PROOF"
echo
wl_ok "SAFE to switch the Lightning Studio back to CPU, or let it sleep."
[ "$stopped" = 1 ] || wl_say "(nothing was running to begin with)"
