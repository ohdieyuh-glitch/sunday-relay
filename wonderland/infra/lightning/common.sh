#!/usr/bin/env bash
# Shared paths, detection and logging for the Lightning Wonderland runner.
#
# Sourced by every script here. It DETECTS rather than assumes: the old Vast
# path hardcoded /opt/wonderland and /home/ue4/wonderland-src throughout, and
# that is exactly why none of it transfers. Everything below is an env var with
# a detected default, so the same scripts run in a Lightning Studio, in a
# container, or on a plain box.
#
# Nothing here starts a GPU, downloads anything, or costs money.

# ---------------------------------------------------------------- storage
# Lightning Studios keep persistent state under /teamspace; everything outside
# it is lost when the Studio stops. That distinction is the whole reason this
# file exists — putting a 100 GB engine on ephemeral disk means paying to
# download it again every session.
if [ -z "${WL_ROOT:-}" ]; then
  if [ -d /teamspace/studios/this_studio ]; then
    WL_ROOT=/teamspace/studios/this_studio/wonderland
  elif [ -d /teamspace ]; then
    WL_ROOT=/teamspace/wonderland
  else
    WL_ROOT="$HOME/wonderland"
  fi
fi
export WL_ROOT

export WL_SRC="${WL_SRC:-$WL_ROOT/src}"                 # the git checkout
export WL_UE="${WL_UE:-$WL_ROOT/UnrealEngine}"          # UE 5.8 install root
export WL_OUT="${WL_OUT:-$WL_ROOT/packaged}"            # cooked/staged build
export WL_LOG="${WL_LOG:-$WL_ROOT/logs}"
export WL_PROOF="${WL_PROOF:-$WL_ROOT/proof}"           # hero frames
export WL_RUN="${WL_RUN:-$WL_ROOT/run}"                 # pids, urls, scratch
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-ca-fixes}"
export WL_REPO="${WL_REPO:-https://github.com/ohdieyuh-glitch/sunday-relay.git}"

# ---------------------------------------------------------------- ports
# 8080 player web page, 8888 streamer websocket, 3478 TURN.
export WL_HTTP_PORT="${WL_HTTP_PORT:-8080}"
export WL_STREAMER_PORT="${WL_STREAMER_PORT:-8888}"
export WL_TURN_PORT="${WL_TURN_PORT:-3478}"
export WL_RES_X="${WL_RES_X:-1280}"
export WL_RES_Y="${WL_RES_Y:-720}"

# ---------------------------------------------------------------- logging
wl_say()  { printf '\033[1;36m[wonderland]\033[0m %s\n' "$*"; }
wl_ok()   { printf '\033[1;32m[wonderland]\033[0m %s\n' "$*"; }
wl_warn() { printf '\033[1;33m[wonderland]\033[0m %s\n' "$*" >&2; }
wl_die()  { printf '\033[1;31m[wonderland] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

wl_mkdirs() { mkdir -p "$WL_ROOT" "$WL_SRC" "$WL_OUT" "$WL_LOG" "$WL_PROOF" "$WL_RUN"; }

# `ss` is not installed on every image and reports "nothing listening" when
# something is — that cost an hour on the Vast box. /proc/net/tcp is always
# there. Handles both IPv4 and IPv6 tables.
wl_port_listening() {
  local port="$1" hex
  hex="$(printf '%04X' "$port")"
  grep -qE "^\s*[0-9]+: [0-9A-F]{8,32}:$hex .* 0A " /proc/net/tcp /proc/net/tcp6 2>/dev/null
}

wl_wait_port() {
  local port="$1" secs="${2:-60}" i=0
  while [ "$i" -lt "$secs" ]; do
    wl_port_listening "$port" && return 0
    sleep 1; i=$((i + 1))
  done
  return 1
}

# The engine ships its own Node. The system one on these images is often far
# too old for the Wilbur signalling server, and using it fails in a way that
# looks like a networking problem rather than a version problem.
wl_bundled_node() {
  find "$WL_UE" -path "*platform_scripts/bash/node/bin/node" -type f 2>/dev/null | head -1
}

wl_have_gpu() {
  command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1
}
