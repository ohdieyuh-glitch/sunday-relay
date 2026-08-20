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
# The hero-frame capture toolchain, installed on CPU and kept on persistent
# storage. Local rather than global: a global npm install needs root the Studio
# may not give, and pins the capture to whichever node happens to be first on
# PATH. A directory beside the engine survives a Studio stop like everything
# else here.
export WL_TOOLS="${WL_TOOLS:-$WL_ROOT/tools}"
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
# Machine floors the launcher refuses to start below. A UE 5.8 cook genuinely
# needs this much — a 261 GiB sparse intermediate killed an export once — but
# they live here as overridable constants rather than as literals inside an
# `if`, so the launcher can be smoke-tested on a machine that has neither.
export WL_MIN_DISK_GB="${WL_MIN_DISK_GB:-60}"
export WL_MIN_RAM_GB="${WL_MIN_RAM_GB:-16}"

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

# THE SIGNALLING SERVER'S OWN NODE.
#
# It lives in the PixelStreamingInfrastructure checkout, NOT in the engine.
# This searched $WL_UE, which on Lightning is a Docker image and therefore an
# empty or absent directory — so the search always came back empty and the
# fallback quietly used whatever system node was on PATH. The system one on
# these images is typically far too old for Wilbur, and it fails in a way that
# looks like a networking problem rather than a version problem. $WL_UE is
# still searched second so a native-engine host keeps working.
wl_bundled_node() {
  # Same hazard as everywhere else: `| head -1` hands find a SIGPIPE it cannot
  # survive under pipefail, and run-stream.sh assigns straight from this call
  # at stage 5. Found by the regression test rather than by reading.
  #
  # (Definition order does not matter: common.sh is sourced whole, so
  # wl_find_first exists by the time anything calls this.)
  local n
  n="$(wl_find_first "$WL_PS_INFRA" -path "*node/bin/node" -type f)"
  [ -n "$n" ] || n="$(wl_find_first "$WL_UE" -path "*platform_scripts/bash/node/bin/node" -type f)"
  printf '%s' "$n"
}

# FIRST MATCH WITHOUT A PIPE.
#
# `find ... | head -1` is the shape that has now silently killed two paid GPU
# runs, by two different mechanisms. head exits as soon as it has its line, find
# is still walking a 69 GB tree, find takes a SIGPIPE and dies 141, `pipefail`
# hands that to the command substitution and `set -e` ends the script with no
# message. Reproduced here at exit 141 before this was written.
#
# `-print -quit` makes find stop itself at the first hit. No pipe, no signal,
# nothing for pipefail to propagate. `|| true` covers the no-match case, where
# find legitimately exits non-zero on some builds.
wl_find_first() {   # $1 = root, rest = find predicates
  local root="$1"; shift
  [ -d "$root" ] || return 0
  find "$root" "$@" -print -quit 2>/dev/null || true
}

# WHO HOLDS A PORT. wl_port_listening answers "is something there", which is
# the wrong question before we start: if a FOREIGN process already holds 8080,
# our signalling server fails to bind, and every later check that only asks "is
# the port listening" then passes — on someone else's service. The stream would
# be reported up while nothing of ours is running.
wl_port_owner_pid() {
  local port="$1"
  command -v ss >/dev/null 2>&1 || return 1
  ss -lptnH "sport = :$port" 2>/dev/null | grep -oE 'pid=[0-9]+' | head -1 | cut -d= -f2
}

# Is an HTTP endpoint actually answering? "A URL exists" and "a browser can open
# it" are different claims and only the second one is worth printing.
wl_http_ok() {
  local url="$1" timeout="${2:-10}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time "$timeout" -o /dev/null "$url" 2>/dev/null
    return $?
  fi
  # No curl is NOT a pass. Report unknown by failing; the caller decides how to
  # describe it rather than assuming the best.
  return 2
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

# ------------------------------------- Pixel Streaming infrastructure (UE5.8)
#
# THE ARCHITECTURE THAT WAS PROVEN WRONG. run-stream.sh used to search $WL_UE
# for a SignallingWebServer directory, because on the old host the plugin's
# copy shipped inside the engine tree. On Lightning the engine is a Docker
# image, not a directory, so that search finds nothing no matter how healthy
# the stack is. The infrastructure is a SEPARATE checkout on persistent
# storage, cloned and built on CPU, and that is what these point at.
export WL_PS_INFRA="${WL_PS_INFRA:-$WL_ROOT/pixel-streaming-infra}"
# EXACT, not minimum. The UE5.8 branch of PixelStreamingInfrastructure changed
# Wilbur's command line — --player_port and --peer_options_file replaced the
# older --http_port and inline --peer_options JSON. A UE5.5 checkout would
# start, ignore the flags it does not know, and serve nothing on the port we
# then report as up. Matching the string exactly is the only check that
# separates those two outcomes before a GPU is attached.
export WL_PS_VERSION="${WL_PS_VERSION:-UE5.8}"
export WL_PS_SIG="${WL_PS_SIG:-$WL_PS_INFRA/SignallingWebServer}"

# ------------------------------------------------------------------- coturn
# The host `turnserver` binary does not exist on the Lightning image and
# installing one needs root the Studio may not grant. The proven path is the
# official container, saved to persistent storage on CPU exactly like the
# engine, and restored — never pulled — when a GPU is already attached.
export WL_TURN_IMAGE="${WL_TURN_IMAGE:-coturn/coturn:4.17.0-r0-debian}"
export WL_TURN_ARCHIVE="${WL_TURN_ARCHIVE:-$WL_ROOT/coturn-4.17.0-r0-debian.tar}"
# A NAME THIS DEPLOYMENT OWNS. Cleanup removes containers by this exact name
# and nothing else: a Studio may be shared, and `docker rm` against anything
# merely running coturn would take down someone else's relay without a word.
export WL_TURN_CONTAINER="${WL_TURN_CONTAINER:-wonderland-turn}"
export WL_TURN_USER="${WL_TURN_USER:-wonderland}"
export WL_TURN_PASS="${WL_TURN_PASS:-wonderland}"
export WL_TURN_REALM="${WL_TURN_REALM:-wonderland}"

# WHICH UE VERSION THE CHECKOUT IS. Empty when it cannot be determined, which
# callers must treat as a failure rather than as "probably fine".
#
# The value lives in a shell file inside the infrastructure checkout, and its
# exact path has moved between UE releases — so this searches for the
# assignment rather than hardcoding a location that a future branch would
# invalidate silently. The whole pipeline runs inside a subshell with pipefail
# disabled: no match is the ordinary answer here, and under the callers'
# `set -euo pipefail` a bare grep miss would end the script with no message.
wl_ps_version() {
  local root="${1:-$WL_PS_INFRA}"
  [ -d "$root" ] || return 0
  ( set +o pipefail
    grep -rhoE '^[[:space:]]*(export[[:space:]]+)?DOWNLOAD_VERSION=[A-Za-z0-9._-]+' \
      "$root" 2>/dev/null | head -1 | sed 's/.*DOWNLOAD_VERSION=//' ) || true
}

# READY | WRONG_VERSION | NOT_BUILT | MISSING. Reporting only; changes nothing.
wl_ps_status() {
  [ -d "$WL_PS_SIG" ] || { echo MISSING; return; }
  local v; v="$(wl_ps_version)"
  [ "$v" = "$WL_PS_VERSION" ] || { echo WRONG_VERSION; return; }
  # BOTH halves, because they fail independently and for different reasons:
  # dist/ is Wilbur compiled from TypeScript, www/ is the player frontend
  # bundled separately. A checkout with one and not the other starts a server
  # that answers 404 for the page a founder was told to open.
  [ -d "$WL_PS_SIG/dist" ] || { echo NOT_BUILT; return; }
  [ -d "$WL_PS_SIG/www" ]  || { echo NOT_BUILT; return; }
  echo READY
}

# Fail closed with a message that names the one thing to do about it.
wl_require_ps_infra() {
  case "$(wl_ps_status)" in
    READY) wl_ok "pixel streaming infrastructure $WL_PS_VERSION at $WL_PS_INFRA"; return 0 ;;
    MISSING)
      wl_die "no SignallingWebServer at $WL_PS_SIG. Clone the ${WL_PS_VERSION} branch of PixelStreamingInfrastructure to $WL_PS_INFRA and build it on CPU (see prepare.sh); this launcher will not fetch it on a GPU machine." ;;
    WRONG_VERSION)
      wl_die "the checkout at $WL_PS_INFRA is DOWNLOAD_VERSION='$(wl_ps_version)', not $WL_PS_VERSION. Wilbur's command line differs between branches, so the wrong one starts and serves nothing. Check out the $WL_PS_VERSION branch on CPU." ;;
    NOT_BUILT)
      wl_die "$WL_PS_SIG is present but not built (need both dist/ and www/). Run the CPU build before attaching a GPU." ;;
  esac
}

wl_turn_image_present() {
  command -v docker >/dev/null 2>&1 || return 1
  docker image inspect "$WL_TURN_IMAGE" >/dev/null 2>&1
}

# READY | RESTORABLE | MISSING, same three answers as the engine.
wl_turn_status() {
  if wl_turn_image_present; then echo READY; return; fi
  if [ -f "$WL_TURN_ARCHIVE" ]; then
    local first
    first="$( ( set +o pipefail; tar -tf "$WL_TURN_ARCHIVE" 2>/dev/null | head -1 ) || true)"
    [ -n "$first" ] && { echo RESTORABLE; return; }
  fi
  echo MISSING
}

# Make coturn available, or fail closed. NO BRANCH REACHES THE NETWORK — the
# cost invariant that governs the engine governs this too, and a `docker pull`
# here would spend GPU time on a download the archive exists to prevent.
wl_ensure_turn_image() {
  if wl_turn_image_present; then
    wl_ok "coturn image already present: $WL_TURN_IMAGE (archive not touched)"
    return 0
  fi
  command -v docker >/dev/null 2>&1 || wl_die "no docker; cannot start the TURN relay"
  [ -f "$WL_TURN_ARCHIVE" ] || wl_die \
    "no coturn image and no archive at $WL_TURN_ARCHIVE. This launcher will NOT download it on a GPU machine; save it on CPU first (see prepare.sh)."
  wl_say "coturn image absent; restoring from $WL_TURN_ARCHIVE"
  docker load -i "$WL_TURN_ARCHIVE" || wl_die "docker load failed from $WL_TURN_ARCHIVE"
  # Announce the fact, not the intention: docker load exits 0 having loaded
  # whatever the archive happened to contain.
  wl_turn_image_present && { wl_ok "restored $WL_TURN_IMAGE"; return 0; }
  wl_die "docker load succeeded but $WL_TURN_IMAGE is still absent — the archive holds a different image"
}

# Is OUR container running? Named exactly, never matched by pattern.
wl_turn_container_running() {
  command -v docker >/dev/null 2>&1 || return 1
  [ "$(docker inspect -f '{{.State.Running}}' "$WL_TURN_CONTAINER" 2>/dev/null || echo false)" = "true" ]
}
