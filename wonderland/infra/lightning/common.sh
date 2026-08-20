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
# GENERATED ASSETS. Synthesised on CPU before the engine starts, imported from
# disk by the level generator. Exported under the names the generator and the
# two synthesis tools actually read, so there is ONE place that decides this
# and no way for the writer and the reader to disagree — which is exactly what
# happened on the first real Lightning run: prepare.sh wrote to the Studio and
# the generator read /opt/wonderland.
export WONDERLAND_TEXTURE_DIR="${WONDERLAND_TEXTURE_DIR:-$WL_ROOT/textures}"
export WONDERLAND_AUDIO_DIR="${WONDERLAND_AUDIO_DIR:-$WL_ROOT/audio}"
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-ca-fixes}"
export WL_REPO="${WL_REPO:-https://github.com/ohdieyuh-glitch/sunday-relay.git}"

# ------------------------------------------------------- the UE engine
# ONE definition of the image and its persistent archive. These were inlined in
# two scripts with two different defaults-in-place, which is how the launcher
# and the readiness report can disagree about whether an engine exists.
export WL_UE_IMAGE="${WL_UE_IMAGE:-ghcr.io/epicgames/unreal-engine:dev-5.8}"
# Lightning has already discarded the local Docker image once across a
# machine/session change. The image is ~69 GB, so re-acquiring it over the
# network on a GPU machine would burn credits doing a download — the archive on
# persistent storage exists precisely so that never happens.
export WL_UE_ARCHIVE="${WL_UE_ARCHIVE:-$WL_ROOT/ue58-dev.tar}"
# A docker save of UE 5.8 is tens of gigabytes. Anything far below this is a
# truncated or aborted export, and loading it would fail late and confusingly.
export WL_UE_ARCHIVE_MIN_GB="${WL_UE_ARCHIVE_MIN_GB:-20}"

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

wl_mkdirs() {
  mkdir -p "$WL_ROOT" "$WL_SRC" "$WL_OUT" "$WL_LOG" "$WL_PROOF" "$WL_RUN" \
           "$WONDERLAND_TEXTURE_DIR" "$WONDERLAND_AUDIO_DIR"
}

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

# ------------------------------------------------- the UE engine, ensured
#
# Three outcomes and no fourth. In particular there is NO branch that reaches
# the network: a `docker pull` here would spend GPU time downloading ~69 GB,
# which is the exact cost this whole mechanism exists to avoid. If neither the
# image nor the archive is present, that is a failure to report, not a problem
# to solve by fetching.

# Cheap archive validation. Deliberately does NOT hash 69 GB — that would cost
# minutes of GPU time every launch to re-learn something a successful
# `docker load` proves anyway. It checks the three things that are nearly free
# and that catch the failures that actually happen: the file is there, it is
# plausibly large rather than a truncated export, and it is a readable tar.
wl_archive_looks_valid() {
  local a="${1:-$WL_UE_ARCHIVE}"
  [ -f "$a" ] || return 1
  local bytes gb
  bytes="$(stat -c %s "$a" 2>/dev/null || echo 0)"
  gb=$(( bytes / 1073741824 ))
  if [ "$gb" -lt "$WL_UE_ARCHIVE_MIN_GB" ]; then
    wl_warn "archive $a is ${gb} GB, below the ${WL_UE_ARCHIVE_MIN_GB} GB floor — truncated export?"
    return 1
  fi
  # Reads only the leading blocks: `head -1` closes the pipe almost at once.
  # Assigned rather than tested inline so a SIGPIPE on tar cannot be mistaken
  # for an invalid archive under `set -o pipefail`.
  local first
  first="$(tar -tf "$a" 2>/dev/null | head -1)"
  [ -n "$first" ] || { wl_warn "archive $a is not a readable tar"; return 1; }
  return 0
}

wl_ue_image_present() {
  command -v docker >/dev/null 2>&1 || return 1
  docker image inspect "$WL_UE_IMAGE" >/dev/null 2>&1
}

# READY | RESTORABLE | MISSING — for reporting, without changing anything.
wl_ue_status() {
  if [ -x "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" ]; then echo READY; return; fi
  if wl_ue_image_present; then echo READY; return; fi
  if wl_archive_looks_valid; then echo RESTORABLE; return; fi
  echo MISSING
}

# Make the engine available, or fail closed. Idempotent: a present image is
# left alone and the archive is not touched.
wl_ensure_ue_image() {
  if [ -x "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" ]; then
    wl_ok "native Unreal Engine present at $WL_UE"
    return 0
  fi
  if wl_ue_image_present; then
    wl_ok "UE image already present: $WL_UE_IMAGE (archive not touched)"
    return 0
  fi
  command -v docker >/dev/null 2>&1 || {
    wl_die "no docker and no native engine; cannot obtain Unreal 5.8"
  }
  if wl_archive_looks_valid; then
    wl_say "UE image absent; restoring from persistent archive"
    wl_say "  $WL_UE_ARCHIVE  ($(du -h "$WL_UE_ARCHIVE" 2>/dev/null | cut -f1))"
    if ! docker load -i "$WL_UE_ARCHIVE"; then
      wl_die "docker load failed from $WL_UE_ARCHIVE"
    fi
    # Announce the fact, not the intention: a zero exit from docker load is not
    # proof the image we need is the one that landed.
    if wl_ue_image_present; then
      wl_ok "restored $WL_UE_IMAGE from persistent storage"
      return 0
    fi
    wl_die "docker load succeeded but $WL_UE_IMAGE is still not present — the archive holds a different image"
  fi
  wl_die "no UE image and no usable archive at $WL_UE_ARCHIVE. This launcher will NOT download Unreal on a GPU machine; obtain it on CPU first (see prepare.sh)."
}
