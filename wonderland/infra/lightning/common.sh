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
# Where these scripts live, so helpers can reach sibling tools (the Vulkan
# probe) without every caller passing a path.
export WL_LIGHTNING_DIR="${WL_LIGHTNING_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
# WHICH BRANCH GETS COMPILED, AND WHY THIS IS NOT JUST A DEFAULT.
#
# prepare.sh fetches, checks out and `reset --hard`s $WL_SRC to $WL_BRANCH.
# $WL_SRC is a checkout of its OWN, under $WL_ROOT — it is NOT the operator's
# working directory. So `git checkout <branch>` in a shell has no effect
# whatsoever on what is built, and a stale default here silently compiled the
# wrong branch while every log line said "OK". That is exactly what happened:
# the L4 measured a package with RELAY_DOGS=1 because the source it compiled
# did not contain AWonderlandStrollingDog, on a run that reported success end
# to end.
#
# The default moved, but the default is not the fix — the next stale default
# would do the same thing. The fix is wl_require_source_branch below, which
# REFUSES to silently switch an existing checkout, and wl_verify_source, which
# prints the full SHA and fails closed unless it is the head of the branch that
# was asked for.
export WL_BRANCH="${WL_BRANCH:-relay/wonderland-marble}"
export WL_REPO="${WL_REPO:-https://github.com/ohdieyuh-glitch/sunday-relay.git}"
# Optional exact pin. Set it and nothing compiles unless $WL_SRC is at exactly
# this commit. Belt to wl_verify_source's braces, for a run whose result is
# going to be quoted.
export WL_REQUIRE_SHA="${WL_REQUIRE_SHA:-}"

# ---------------------------------------------------- source identity
wl_source_sha() {
  git -C "$WL_SRC" rev-parse HEAD 2>/dev/null || echo "unknown"
}

wl_source_branch() {
  git -C "$WL_SRC" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# Refuse to move an existing checkout onto a different branch by accident.
#
# The old prepare.sh did `checkout` + `reset --hard` unconditionally, so an
# operator who had deliberately put $WL_SRC on a branch found it silently
# replaced. Switching is still possible — it just has to be asked for.
wl_require_source_branch() {
  [ -d "$WL_SRC/.git" ] || return 0
  local current; current="$(wl_source_branch)"
  [ "$current" = "$WL_BRANCH" ] && return 0
  [ "$current" = "unknown" ] && return 0
  if [ "${WL_ALLOW_BRANCH_SWITCH:-0}" = "1" ]; then
    wl_warn "switching $WL_SRC from '$current' to '$WL_BRANCH' (WL_ALLOW_BRANCH_SWITCH=1)"
    return 0
  fi
  wl_die "REFUSING TO SWITCH BRANCHES SILENTLY.
  $WL_SRC is on '$current'
  WL_BRANCH asks for '$WL_BRANCH'
This used to be a hard reset with no message, and it is how a build compiled
the wrong source while reporting success at every stage. Choose one:
  WL_BRANCH=$current   bash ...          # build what is checked out
  WL_ALLOW_BRANCH_SWITCH=1 bash ...      # move the checkout to $WL_BRANCH"
}

# Print the FULL sha, and fail closed unless it is what was asked for.
#
# Called after prepare and again immediately before the compile, because the
# thing being guarded against is the source changing between those two points.
wl_verify_source() {
  local where="${1:-source}"
  [ -d "$WL_SRC/.git" ] || wl_die "$where: no git checkout at $WL_SRC"
  local sha branch remote
  sha="$(wl_source_sha)"
  branch="$(wl_source_branch)"
  printf '\033[1;36m  SOURCE  %s\n          branch %s (asked for %s)\033[0m\n' \
    "$sha" "$branch" "$WL_BRANCH"

  if [ -n "$WL_REQUIRE_SHA" ] && [ "$sha" != "$WL_REQUIRE_SHA" ]; then
    wl_die "$where: WL_REQUIRE_SHA=$WL_REQUIRE_SHA but the checkout is at $sha"
  fi
  if [ "$branch" != "$WL_BRANCH" ]; then
    wl_die "$where: the checkout is on '$branch' and WL_BRANCH is '$WL_BRANCH'.
Refusing to compile source that is not the branch that was asked for."
  fi
  remote="$(git -C "$WL_SRC" rev-parse "origin/$WL_BRANCH" 2>/dev/null || echo "")"
  if [ -z "$remote" ]; then
    wl_warn "$where: no origin/$WL_BRANCH locally — cannot confirm this is the branch head"
  elif [ "$sha" != "$remote" ]; then
    wl_die "$where: the checkout is at $sha but origin/$WL_BRANCH is at $remote.
The source is NOT the head of the branch that was asked for. Re-run prepare.sh,
or set WL_REQUIRE_SHA=$sha to compile this commit deliberately."
  fi
  return 0
}

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

# --------------------------------------------------------------------------
# The Marble meshes are hundreds of megabytes and are NOT in git — the HQ
# export alone is 141 MB and the full-resolution one 330 MB. They live in
# persistent Studio storage; $WL_SRC is a checkout that gets reset to origin on
# every prepare, so the link has to be re-made rather than assumed. Symlinks,
# not copies: the same half-gigabyte does not need a second home per build, and
# a stale copy that silently differs from the downloaded asset is exactly the
# kind of thing nobody notices until a frame looks wrong.
wl_marble_assets_root() {
  printf '%s\n' "${WL_MARBLE_ASSETS:-$WL_ROOT/marble-assets}"
}

wl_link_marble_assets() {
  local root; root="$(wl_marble_assets_root)"
  if [ ! -d "$root" ]; then
    wl_say "no Marble assets under $root — nothing to link"
    return 0
  fi
  local linked=0 worlds=0 world slug dest file
  for world in "$root"/*; do
    [ -d "$world" ] || continue
    slug="$(basename "$world")"
    if [ ! -f "$WL_SRC/wonderland/marble/worlds/$slug/manifest.json" ]; then
      # An asset directory with no manifest in the checkout cannot be imported,
      # and linking it anyway would leave a pile nobody can trace to a world.
      wl_warn "Marble assets for '$slug' have no manifest in the checkout — skipped"
      continue
    fi
    dest="$WL_SRC/wonderland/marble/worlds/$slug/assets"
    mkdir -p "$dest"
    for file in "$world"/*; do
      [ -f "$file" ] || continue
      ln -sfn "$file" "$dest/$(basename "$file")" && linked=$((linked + 1))
    done
    worlds=$((worlds + 1))
    wl_ok "Marble assets linked for $slug -> $dest"
  done
  if [ "$worlds" = "0" ]; then
    wl_say "no Marble world in $root matched a manifest in the checkout"
  else
    wl_say "Marble: $linked file(s) linked across $worlds world(s)"
  fi
  return 0
}

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
  # ONE RESTORE AT A TIME, AND ONLY WITH ROOM FOR IT.
  #
  # Both of these were learned the same afternoon on the L4. A build was
  # interrupted and its `docker load` child SURVIVED the kill; the replacement
  # build started a second load of the same 69 GB archive, and the two of them
  # took /var/lib/docker to 222 GB on a 369 GB volume shared with /teamspace --
  # 29 GB from full, with both loads still writing. Neither would have finished,
  # and the disk they filled is the one the packaged build lands on.
  #
  # docker load itself has no opinion about either: it will happily start a
  # second copy, and it will happily run until ENOSPC.
  # Match the DOCKER PROCESS, not any process whose command line mentions the
  # archive. `pgrep -f` scans whole command lines, so a shell one-liner that
  # merely names the tar -- an ssh command, this very check written inline --
  # matches it, and the guard would refuse a build for a restore that is not
  # running. `pgrep -a` prints "pid cmdline"; keeping only rows whose first word
  # is the docker binary narrows it to the real thing.
  wl_running_ue_loads() {
    pgrep -a -f "docker load .*$WL_UE_ARCHIVE" 2>/dev/null \
      | awk '$2 ~ /(^|\/)docker$/ { print $1 }'
  }
  local busy
  busy="$(wl_running_ue_loads | tr '\n' ' ')"
  if [ -n "${busy// /}" ]; then
    wl_die "another 'docker load' of $WL_UE_ARCHIVE is ALREADY RUNNING (pid(s): $busy).
Two concurrent restores of a 69 GB archive filled this disk to 92% once already.
Wait for it, or kill it — but do not start a second. Nothing was restored."
  fi
  if wl_archive_looks_valid; then
    local need_gb avail_gb
    # Roughly twice the archive: docker writes the uncompressed layers while the
    # archive is still on the same volume.
    need_gb=$(( $(du -BG "$WL_UE_ARCHIVE" 2>/dev/null | cut -dG -f1 | tr -dc '0-9') * 2 ))
    avail_gb=$(df -BG --output=avail /var/lib/docker 2>/dev/null | tail -1 | tr -dc '0-9')
    if [ -n "${avail_gb:-}" ] && [ -n "${need_gb:-}" ] && [ "$avail_gb" -lt "$need_gb" ]; then
      wl_die "restoring $WL_UE_ARCHIVE needs about ${need_gb} GB free on /var/lib/docker and there is ${avail_gb} GB.
A load that runs out of space leaves orphaned layers behind and no image, which looks
exactly like a corrupt archive. Reclaim first: 'docker system prune -af' returned
118 GB here when the image list was already empty. Nothing was restored."
    fi
    wl_say "UE image absent; restoring from persistent archive"
    wl_say "  $WL_UE_ARCHIVE  ($(du -h "$WL_UE_ARCHIVE" 2>/dev/null | cut -f1)), ${avail_gb:-?} GB free"
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
# WHICH UE VERSION THE CHECKOUT IS. Empty when it cannot be determined, which
# callers must treat as a failure rather than as "probably fine".
#
# ONE AUTHORITATIVE FILE. $WL_PS_INFRA/DOWNLOAD_VERSION holds the bare version
# string and nothing else — it is NOT a shell declaration, which is what the
# two previous attempts assumed. Both searched the tree for an assignment and
# both returned empty on the real checkout, so wl_ps_status answered
# WRONG_VERSION for a correct UE5.8 and stage 5 would have refused to start on
# a healthy machine. Reading the one file that exists cannot go wrong in that
# direction, and a recursive grep is not needed to find a fixed path.
wl_ps_version() {
  local f="${1:-$WL_PS_INFRA}/DOWNLOAD_VERSION"
  [ -r "$f" ] || return 0
  tr -d '\r\n' < "$f" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# The node the signalling server must run under, from the checkout's own
# NODE_VERSION file. Empty when absent — again a failure, never a default.
wl_ps_required_node() {
  local f="${1:-$WL_PS_INFRA}/NODE_VERSION"
  [ -r "$f" ] || return 0
  tr -d '\r\n' < "$f" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
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
      # SHOW THE EVIDENCE. An extraction bug and a genuinely wrong branch both
      # arrive here, and they need opposite responses from the founder — one is
      # "fix the launcher", the other is "check out the right branch". Printing
      # the raw declaration line separates them in one glance instead of a
      # GPU session. This is not hypothetical: the first version of the parser
      # returned empty on a correct UE5.8 checkout.
      wl_warn "$WL_PS_INFRA/DOWNLOAD_VERSION reads '$(wl_ps_version)', expected '$WL_PS_VERSION'"
      wl_die "the checkout at $WL_PS_INFRA is not $WL_PS_VERSION. Wilbur's command line differs between branches, so the wrong one starts and serves nothing. Check out the $WL_PS_VERSION branch on CPU." ;;
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

# THE NODE WILBUR MUST RUN UNDER, verified before it starts.
#
# A wrong node fails deep inside a dependency and reads as a networking
# problem, which is an expensive way to learn a version number on a GPU. The
# required value comes from the checkout's own NODE_VERSION file; the bundled
# node is preferred when one exists, and the host node is accepted only when it
# matches EXACTLY. Nothing here downloads a node — same cost invariant as the
# engine and coturn.
#
# Prints the node binary to use on success. Fails closed otherwise.
wl_require_node() {
  local required actual node
  required="$(wl_ps_required_node)"
  [ -n "$required" ] || wl_die "no $WL_PS_INFRA/NODE_VERSION; cannot know which node Wilbur needs"
  node="$(wl_bundled_node)"
  if [ -n "$node" ]; then
    actual="$("$node" -v 2>/dev/null || true)"
    [ "$actual" = "$required" ] || wl_die \
      "the bundled node at $node is $actual, but this checkout requires $required. Install the matching node on CPU; a GPU launch will not download one."
  else
    node="$(command -v node || true)"
    [ -n "$node" ] || wl_die "no bundled node and no node on PATH; Wilbur cannot start (requires $required)"
    actual="$("$node" -v 2>/dev/null || true)"
    [ "$actual" = "$required" ] || wl_die \
      "no bundled node, and the host node is $actual but this checkout requires $required. Install the matching node on CPU; a GPU launch will not download one."
  fi
  printf '%s' "$node"
}

# INSTALL THE NODE WILBUR NEEDS, ON CPU, ONCE.
#
# wl_require_node's own error message says "Install the matching node on CPU; a
# GPU launch will not download one" — and nothing installed it, so an L4 launch
# reached stage 5 with a cooked 1.1 GB package and died on a missing runtime.
# The advice was right and unimplemented, which is the most expensive kind of
# correct comment.
#
# Installs into $WL_PS_INFRA/node, which is exactly where wl_bundled_node
# already looks, on persistent storage so it survives a Studio stop.
wl_ensure_node() {
  local required node url tmp
  required="$(wl_ps_required_node)"
  [ -n "$required" ] || { wl_warn "no NODE_VERSION in $WL_PS_INFRA; cannot install node"; return 1; }

  node="$(wl_bundled_node)"
  if [ -n "$node" ] && [ "$("$node" -v 2>/dev/null)" = "$required" ]; then
    wl_ok "node $required already bundled at $node"
    return 0
  fi
  node="$(command -v node || true)"
  if [ -n "$node" ] && [ "$("$node" -v 2>/dev/null)" = "$required" ]; then
    wl_ok "node $required already on PATH at $node"
    return 0
  fi

  url="https://nodejs.org/dist/${required}/node-${required}-linux-x64.tar.xz"
  wl_say "installing node $required into $WL_PS_INFRA/node"
  tmp="$(mktemp -d)"
  if ! curl -fsSL --retry 3 -o "$tmp/node.tar.xz" "$url"; then
    rm -rf "$tmp"
    wl_warn "could not download $url"
    return 1
  fi
  mkdir -p "$WL_PS_INFRA/node"
  # --strip-components=1 so the binary lands at $WL_PS_INFRA/node/bin/node,
  # the path wl_bundled_node searches for.
  if ! tar -xJf "$tmp/node.tar.xz" -C "$WL_PS_INFRA/node" --strip-components=1; then
    rm -rf "$tmp"
    wl_warn "could not unpack the node tarball"
    return 1
  fi
  rm -rf "$tmp"
  local got
  got="$("$WL_PS_INFRA/node/bin/node" -v 2>/dev/null || true)"
  if [ "$got" != "$required" ]; then
    wl_warn "installed node reports '$got', expected '$required'"
    return 1
  fi
  wl_ok "node $required installed at $WL_PS_INFRA/node/bin/node"
  return 0
}

# READY | WRONG_VERSION | MISSING, for reporting without failing.
wl_node_status() {
  local required actual node
  required="$(wl_ps_required_node)"
  [ -n "$required" ] || { echo MISSING; return; }
  node="$(wl_bundled_node)"
  [ -n "$node" ] || node="$(command -v node || true)"
  [ -n "$node" ] || { echo MISSING; return; }
  actual="$("$node" -v 2>/dev/null || true)"
  [ "$actual" = "$required" ] && echo READY || echo WRONG_VERSION
}

# ============================================================ GPU / VULKAN
#
# NVIDIA-SMI SUCCESS IS NOT VULKAN SUCCESS, and that distinction cost a GPU
# session: the L4 reported a healthy card and driver, and the packaged client
# died in RHIInit with
#
#   vpCreateInstance(...) failed, VkResult=-9  VK_ERROR_INCOMPATIBLE_DRIVER
#
# nvidia-smi talks to the kernel driver. Vulkan needs three more things — a
# loader, an ICD manifest, and the userspace driver library that manifest names
# — and any of them can be missing on a machine whose nvidia-smi is perfect.
# Everything below reports each layer separately so the failure names itself.

export WL_VULKAN_PROBE="${WL_VULKAN_PROBE:-1}"   # set 0 to skip the live probe
# QUICK OVERRIDE. When the ICD manifest exists but Unreal is not finding it,
# point at the detected file here. It is applied to the Wonderland process
# ALONE — never exported into the Studio's own environment, because a global
# VK_DRIVER_FILES would silently redirect every other GPU program on a shared
# machine. Empty by default and never guessed: see wl_vulkan_icd_files.
export WL_VULKAN_ICD="${WL_VULKAN_ICD:-}"

_WL_ICD_DIRS="/usr/share/vulkan/icd.d /etc/vulkan/icd.d /usr/local/share/vulkan/icd.d /usr/local/etc/vulkan/icd.d"

# Every NVIDIA ICD manifest on the box, newline separated. Empty is a real
# answer and the caller must treat it as one.
wl_vulkan_icd_json() {
  local d
  for d in $_WL_ICD_DIRS; do
    [ -d "$d" ] || continue
    ( set +o pipefail; ls "$d"/*nvidia*.json 2>/dev/null ) || true
  done
}

# The driver library a manifest points at, and whether it actually resolves.
# A manifest naming a library that is not installed is the exact shape of
# VK_ERROR_INCOMPATIBLE_DRIVER, and it is invisible unless you look.
wl_vulkan_icd_library() {
  local json="$1" lib
  [ -r "$json" ] || return 0
  lib="$( ( set +o pipefail
            sed -n 's/.*"library_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$json" \
              | head -1 ) || true)"
  printf '%s' "$lib"
}

wl_vulkan_library_resolves() {
  local lib="$1" json="$2" dir
  [ -n "$lib" ] || return 1
  case "$lib" in
    /*) [ -e "$lib" ] && return 0 ;;
    *)
      # A relative library_path is resolved against the manifest's directory
      # first, then the normal loader search path.
      dir="$(dirname "$json")"
      [ -e "$dir/$lib" ] && return 0
      ( set +o pipefail; ldconfig -p 2>/dev/null | grep -qF "$lib" ) && return 0
      ;;
  esac
  return 1
}

# WHERE THE LOADER IS, or empty. `ldconfig -p` is the fast answer but it is not
# always on PATH for a non-root user — and when it was missing here this line
# printed "NOT FOUND" while the probe on line 10 had just loaded the loader
# successfully. A report that contradicts itself is worse than a short one, so
# an actual dlopen is the fallback and the authority.
wl_vulkan_loader() {
  local p
  p="$( ( set +o pipefail
          ldconfig -p 2>/dev/null | grep -oE '/[^ ]*libvulkan\.so\.1' | head -1 ) || true)"
  if [ -z "$p" ] && command -v python3 >/dev/null 2>&1; then
    python3 - <<'PYLOAD' 2>/dev/null || true
import ctypes
try:
    ctypes.CDLL("libvulkan.so.1")
    print("libvulkan.so.1 (loadable; path not listed by ldconfig)")
except OSError:
    pass
PYLOAD
    return 0
  fi
  printf '%s' "$p"
}

# WHAT TO HAND THE WONDERLAND PROCESS, or empty. Never a hardcoded path: a
# guessed ICD is worse than none, because it turns a clear "no driver" into a
# confusing "wrong driver". WL_VULKAN_ICD is honoured only when the file it
# names actually exists.
wl_vulkan_icd_files() {
  # An explicit override always wins.
  [ -z "$WL_VULKAN_ICD" ] || { printf '%s' "$WL_VULKAN_ICD"; return 0; }
  # A manifest the system already ships is used as-is; generating one on top
  # would override a working configuration for no reason.
  local existing; existing="$(wl_vulkan_icd_json | head -1)"
  [ -z "$existing" ] || return 0
  # No manifest anywhere, but a driver library present: the exact Lightning
  # case. Generate one, scoped to this process.
  [ "$WL_VULKAN_AUTOGEN_ICD" = "1" ] || return 0
  wl_vulkan_generate_icd
}

# VALIDATED BY THE CALLER, NOT INSIDE A SUBSTITUTION.
#
# This check used to live in wl_vulkan_icd_files, which every caller invokes as
# `$(...)`. wl_die there exits only the substitution subshell — the assignment
# still succeeds and the function still returns 0, so a WL_VULKAN_ICD naming a
# file that does not exist was SILENTLY IGNORED and the launch proceeded with
# no override at all. Found by the test asserting it fails closed.
wl_vulkan_icd_check() {
  [ -n "$WL_VULKAN_ICD" ] || return 0
  [ -r "$WL_VULKAN_ICD" ] || wl_die "WL_VULKAN_ICD=$WL_VULKAN_ICD does not exist or is unreadable. Point it at a manifest this machine actually has (line 4 of the vulkan evidence lists them); it is never guessed."
}

# THE WHOLE PICTURE, printed. Ten separate facts, each measured, so a failure
# says which layer broke instead of "GPU failed".
wl_vulkan_report() {
  local gpu driver loader icds icd lib probe_rc probe_out vi
  printf '  --- GPU / VULKAN EVIDENCE ---\n'

  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    gpu="$( ( set +o pipefail; nvidia-smi --query-gpu=name --format=csv,noheader | head -1 ) || true)"
    driver="$( ( set +o pipefail; nvidia-smi --query-gpu=driver_version --format=csv,noheader | head -1 ) || true)"
    printf '  1 gpu                 %s\n' "${gpu:-present but unnamed}"
    printf '  2 nvidia driver       %s\n' "${driver:-unknown}"
  else
    printf '  1 gpu                 NONE (nvidia-smi absent or reports no device)\n'
    printf '  2 nvidia driver       unknown\n'
  fi

  loader="$(wl_vulkan_loader)"
  printf '  3 vulkan loader       %s\n' "${loader:-NOT FOUND (libvulkan.so.1)}"

  icds="$(wl_vulkan_icd_json)"
  if [ -n "$icds" ]; then
    printf '  4 nvidia ICD json     %s\n' "$(printf '%s' "$icds" | tr '\n' ' ')"
    icd="$(printf '%s\n' "$icds" | head -1)"
    lib="$(wl_vulkan_icd_library "$icd")"
    if wl_vulkan_library_resolves "$lib" "$icd"; then
      printf '  5 ICD library        %s (resolves)\n' "${lib:-unnamed}"
    else
      printf '  5 ICD library        %s (DOES NOT RESOLVE - this is what -9 looks like)\n' "${lib:-unnamed}"
    fi
  else
    printf '  4 nvidia ICD json     NONE in %s\n' "$_WL_ICD_DIRS"
    printf '  5 ICD library        n/a (no manifest to read)\n'
  fi

  printf '  6 libvulkan           %s\n' "$([ -n "$loader" ] && echo 'resolves' || echo 'NOT resolvable')"
  printf '  7 VK_ICD_FILENAMES    %s\n' "${VK_ICD_FILENAMES:-(unset)}"
  printf '    VK_DRIVER_FILES     %s\n' "${VK_DRIVER_FILES:-(unset)}"
  printf '    WL_VULKAN_ICD       %s\n' "${WL_VULKAN_ICD:-(unset)}"
  printf '  8 LD_LIBRARY_PATH     %s\n' "${LD_LIBRARY_PATH:-(unset)}"

  if command -v vulkaninfo >/dev/null 2>&1; then
    vi="$( ( set +o pipefail; vulkaninfo --summary 2>&1 | grep -iE 'deviceName|driverVersion' | head -4 ) || true)"
    printf '  9 vulkaninfo          %s\n' "${vi:-installed, but reported no device}"
  else
    printf '  9 vulkaninfo          not installed (not required)\n'
  fi

  if [ "$WL_VULKAN_PROBE" = "1" ] && [ -r "$WL_LIGHTNING_DIR/vulkan-probe.py" ]; then
    probe_out="$(wl_vulkan_env python3 "$WL_LIGHTNING_DIR/vulkan-probe.py" 2>&1)"; probe_rc=$?
    if [ "$probe_rc" = 0 ]; then
      printf ' 10 instance probe      NVIDIA physical device enumerated\n'
    else
      printf ' 10 instance probe      FAILED (no NVIDIA device from a real Vulkan instance)\n'
      printf '%s\n' "$probe_out" | sed 's/^/      /'
    fi
  else
    printf ' 10 instance probe      skipped (WL_VULKAN_PROBE=%s)\n' "$WL_VULKAN_PROBE"
  fi
}

# Run a command with the Wonderland-only Vulkan environment applied. Scoped to
# the child through `env`, so nothing leaks into the Studio.
wl_vulkan_env() {
  wl_vulkan_icd_check
  local icd; icd="$(wl_vulkan_icd_files)"
  if [ -n "$icd" ]; then
    # Both names: VK_ICD_FILENAMES is the older loader's, VK_DRIVER_FILES the
    # current one's, and which is honoured depends on the loader version rather
    # than on anything we can see here.
    env VK_ICD_FILENAMES="$icd" VK_DRIVER_FILES="$icd" "$@"
  else
    "$@"
  fi
}

# Does this machine have a usable Vulkan path? Yes, or a refusal with evidence.
wl_vulkan_ok() {
  [ "$WL_VULKAN_PROBE" = "1" ] || return 0
  [ -r "$WL_LIGHTNING_DIR/vulkan-probe.py" ] || return 0
  wl_vulkan_env python3 "$WL_LIGHTNING_DIR/vulkan-probe.py" >/dev/null 2>&1
}

wl_require_vulkan() {
  if wl_vulkan_ok; then
    wl_ok "vulkan: an NVIDIA physical device is reachable from a real instance"
    return 0
  fi
  wl_warn "Wonderland will not start: Vulkan cannot reach an NVIDIA device on this machine."
  wl_warn "The packaged client dies in RHIInit with VK_ERROR_INCOMPATIBLE_DRIVER (-9) when this is true."
  wl_vulkan_report >&2
  wl_die "no usable Vulkan/NVIDIA path — refusing to launch Wonderland into a crash. If line 4 shows a manifest and line 5 shows it resolving, set WL_VULKAN_ICD to that manifest and retry; do NOT change system drivers from here."
}

# ------------------------------- Wilbur's node dependencies, proven up front
#
# AFTER A CPU -> L4 MACHINE SWITCH, node_modules was gone and Wilbur died with
# MODULE_NOT_FOUND on require("express") — discovered only AFTER coturn was
# already running, which leaves the machine half-up for the next attempt to
# clean. `npm ci` on the L4 fixed it immediately, but that is a network
# acquisition on a billing GPU, so it is offered, never performed silently.
#
# The two names checked are the ones that actually failed: the web framework
# Wilbur serves through, and the signalling library that IS Wilbur.
export WL_WILBUR_MODULES="${WL_WILBUR_MODULES:-express @epicgames-ps/lib-pixelstreamingsignalling-ue5.8}"
# A saved node_modules, restored like the coturn image so a machine switch does
# not mean a download. Absent by default; nothing is created behind your back.
export WL_WILBUR_MODULES_ARCHIVE="${WL_WILBUR_MODULES_ARCHIVE:-$WL_ROOT/wilbur-node-modules.tar}"
# Opt-in only. A GPU launch never reaches the network unless you say so.
export WL_ALLOW_NPM_INSTALL="${WL_ALLOW_NPM_INSTALL:-0}"

# Which of the required modules do NOT resolve, newline separated. Empty is
# the good answer. Resolution is done BY NODE from Wilbur's own directory,
# because that is exactly how Wilbur will look for them — a directory listing
# of node_modules would pass on a half-extracted tree that still cannot load.
wl_wilbur_missing_modules() {
  local node m
  node="$(wl_bundled_node)"
  [ -n "$node" ] || node="$(command -v node || true)"
  [ -n "$node" ] || { printf '%s\n' $WL_WILBUR_MODULES; return 0; }
  [ -d "$WL_PS_SIG" ] || { printf '%s\n' $WL_WILBUR_MODULES; return 0; }
  for m in $WL_WILBUR_MODULES; do
    ( cd "$WL_PS_SIG" && "$node" -e "require.resolve('$m')" >/dev/null 2>&1 ) || printf '%s\n' "$m"
  done
}

# Restore a saved node_modules if one exists. No network, same rule as coturn.
wl_restore_wilbur_modules() {
  [ -f "$WL_WILBUR_MODULES_ARCHIVE" ] || return 1
  wl_say "restoring Wilbur node_modules from $WL_WILBUR_MODULES_ARCHIVE"
  ( cd "$WL_PS_SIG" && tar -xf "$WL_WILBUR_MODULES_ARCHIVE" ) || return 1
  [ -z "$(wl_wilbur_missing_modules)" ]
}

wl_require_wilbur_modules() {
  local missing
  missing="$(wl_wilbur_missing_modules)"
  [ -z "$missing" ] && { wl_ok "wilbur dependencies resolve ($WL_WILBUR_MODULES)"; return 0; }

  wl_warn "Wilbur cannot load: $(printf '%s' "$missing" | tr '\n' ' ')"
  if wl_restore_wilbur_modules; then
    wl_ok "wilbur dependencies restored from persistent storage (no download)"
    return 0
  fi
  if [ "$WL_ALLOW_NPM_INSTALL" = "1" ]; then
    # EXPLICIT OPT-IN ONLY, and `npm ci` rather than `npm install`: ci installs
    # exactly the lockfile and touches nothing else. No audit fix — that
    # rewrites dependencies on a machine that is billing by the minute.
    wl_say "WL_ALLOW_NPM_INSTALL=1 — running npm ci in $WL_PS_SIG"
    ( cd "$WL_PS_SIG" && npm ci ) || wl_die "npm ci failed in $WL_PS_SIG"
    missing="$(wl_wilbur_missing_modules)"
    [ -z "$missing" ] || wl_die "npm ci finished but these still do not resolve: $(printf '%s' "$missing" | tr '\n' ' ')"
    wl_ok "wilbur dependencies installed"
    # Save them so the next machine switch is free.
    ( cd "$WL_PS_SIG" && tar -cf "$WL_WILBUR_MODULES_ARCHIVE" node_modules ) 2>/dev/null \
      && wl_ok "saved node_modules to $WL_WILBUR_MODULES_ARCHIVE for the next machine switch"
    return 0
  fi
  wl_die "Wilbur's dependencies are missing and there is no archive at $WL_WILBUR_MODULES_ARCHIVE. This happens after a CPU->GPU machine switch. Either re-run with WL_ALLOW_NPM_INSTALL=1 (this downloads on the GPU), or run 'cd $WL_PS_SIG && npm ci' on CPU first."
}

# READY | RESTORABLE | MISSING, for the CPU readiness report.
wl_wilbur_modules_status() {
  [ -z "$(wl_wilbur_missing_modules)" ] && { echo READY; return; }
  [ -f "$WL_WILBUR_MODULES_ARCHIVE" ] && { echo RESTORABLE; return; }
  echo MISSING
}

# The Vulkan overrides as KEY=VALUE words, for composing into a setsid/nohup
# launch line where a wrapper function cannot go. Empty when nothing was
# detected — and `env` with no pairs is a no-op, so the launch line is
# unchanged in the ordinary case.
wl_vulkan_env_pairs() {
  wl_vulkan_icd_check
  local icd; icd="$(wl_vulkan_icd_files)"
  [ -n "$icd" ] || return 0
  printf 'VK_ICD_FILENAMES=%s VK_DRIVER_FILES=%s' "$icd" "$icd"
}

# ------------------------------ the ICD Lightning does not ship, generated
#
# PROVEN ON THE REAL L4. There was NO NVIDIA ICD manifest anywhere under
# /etc/vulkan or /usr/share/vulkan — but the userspace driver libraries were
# installed:
#
#   /usr/lib/x86_64-linux-gnu/libEGL_nvidia.so.0
#   /usr/lib/x86_64-linux-gnu/libGLX_nvidia.so.0
#
# The loader therefore had a driver available and no manifest telling it so,
# which is precisely VK_ERROR_INCOMPATIBLE_DRIVER. Writing a manifest that
# points at libGLX_nvidia.so.0 got Unreal past RHIInit and kept the process
# alive on the L4.
#
# Generated into $WL_RUN and handed to the Wonderland process alone. Nothing
# is written under /etc or /usr and no system driver is installed or changed —
# the Studio's global Vulkan configuration is left exactly as found.
export WL_VULKAN_ICD_API="${WL_VULKAN_ICD_API:-1.3.277}"
export WL_VULKAN_AUTOGEN_ICD="${WL_VULKAN_AUTOGEN_ICD:-1}"   # 0 disables

_WL_NV_LIB_DIRS="/usr/lib/x86_64-linux-gnu /usr/lib64 /usr/lib /usr/local/lib/x86_64-linux-gnu"

# The NVIDIA Vulkan-capable driver library, or empty. DETECTED, never assumed:
# writing a manifest that points at a library which is not there would turn a
# clear "no driver" into a confusing "wrong driver".
wl_vulkan_nvidia_lib() {
  local d c
  for d in $_WL_NV_LIB_DIRS; do
    # libGLX_nvidia.so.0 is the one that worked on the real L4. The others are
    # tried only as fallbacks, in the order most likely to carry the ICD.
    for c in libGLX_nvidia.so.0 libGLX_nvidia.so libEGL_nvidia.so.0 libnvidia-vulkan-producer.so; do
      [ -e "$d/$c" ] && { printf '%s' "$d/$c"; return 0; }
    done
  done
  return 0
}

# Write a Wonderland-scoped ICD manifest for a DETECTED library. Prints its
# path. Empty (and no file) when there is nothing to point at.
wl_vulkan_generate_icd() {
  local lib out
  lib="$(wl_vulkan_nvidia_lib)"
  [ -n "$lib" ] || return 0
  mkdir -p "$WL_RUN"
  out="$WL_RUN/wonderland_nvidia_icd.json"
  cat > "$out" <<ICDEOF
{
    "file_format_version": "1.0.0",
    "ICD": {
        "library_path": "$lib",
        "api_version": "$WL_VULKAN_ICD_API"
    }
}
ICDEOF
  printf '%s' "$out"
}
