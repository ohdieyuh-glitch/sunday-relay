#!/usr/bin/env bash
# Wonderland on Lightning — generate the world, cook, package. GPU phase.
#
# Assumes prepare.sh has already run: source cloned, textures and audio
# synthesised, engine obtained. This script does the part that genuinely needs
# the machine, and nothing else.
#
# Works with EITHER a native engine install at $WL_UE or Epic's container
# image, chosen automatically. The container path bind-mounts persistent
# storage so a cook survives the Studio stopping.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

wl_mkdirs
PROJECT="$WL_SRC/wonderland/Wonderland.uproject"
[ -f "$PROJECT" ] || wl_die "no project at $PROJECT — run prepare.sh first"

FORCE="${FORCE_REBUILD:-0}"
WL_UE_IMAGE="${WL_UE_IMAGE:-ghcr.io/epicgames/unreal-engine:dev-5.8}"

# ------------------------------------------------------- choose an engine path
MODE=""
if [ -x "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" ]; then
  MODE=native
elif command -v docker >/dev/null 2>&1 && docker image inspect "$WL_UE_IMAGE" >/dev/null 2>&1; then
  MODE=container
else
  wl_die "no Unreal Engine 5.8 found. Run prepare.sh and follow its FOUNDER ACTION block."
fi
wl_say "engine mode: $MODE"

# The real build logic already exists and is hardened — version pin, content
# hash idempotence, fail-closed step checking, a refusal to package a
# contentless level. Reimplementing it here would mean maintaining two of them
# and having the second one be worse, so this drives that script and only
# supplies the paths.
BUILD_SH="wonderland/infra/build/build-wonderland.sh"
[ -f "$WL_SRC/$BUILD_SH" ] || wl_die "missing $BUILD_SH in the checkout"

run_native() {
  UE_ROOT="$WL_UE" OUT="$WL_OUT" FORCE_REBUILD="$FORCE" \
    bash "$WL_SRC/$BUILD_SH" 2>&1 | tee "$WL_LOG/build.log"
  return "${PIPESTATUS[0]}"
}

run_container() {
  # --gpus all so the cook can use the GPU where it helps (shader compilation
  # is CPU, but the editor still wants a device present). Persistent storage is
  # mounted at the same path inside so every artifact lands on the volume, not
  # in a layer that vanishes with the container.
  local gpuflag=""
  wl_have_gpu && gpuflag="--gpus all"
  # shellcheck disable=SC2086
  docker run --rm $gpuflag \
    -v "$WL_ROOT:$WL_ROOT" \
    -e UE_ROOT=/home/ue4/UnrealEngine \
    -e OUT="$WL_OUT" \
    -e FORCE_REBUILD="$FORCE" \
    -w "$WL_SRC" \
    "$WL_UE_IMAGE" \
    bash "$WL_SRC/$BUILD_SH" 2>&1 | tee "$WL_LOG/build.log"
  return "${PIPESTATUS[0]}"
}

wl_say "building and cooking (this is the long one; logs -> $WL_LOG/build.log)"
if [ "$MODE" = native ]; then run_native; else run_container; fi
RC=$?

# Announce the fact, not the intention: the build script's own guard already
# refuses to claim success without a staged directory, and this is the second
# check because a packaged build that is not there is the failure that wastes
# a whole GPU session.
if [ "$RC" -ne 0 ]; then
  wl_warn "build exited $RC. Last failure lines:"
  grep -aE "ERROR|BUILD FAILED|Fatal error" "$WL_LOG/build.log" | tail -15 >&2 || true
  wl_die "build failed — see $WL_LOG/build.log"
fi

STAGED="$WL_OUT/Linux"
if [ ! -d "$STAGED" ] || [ -z "$(ls -A "$STAGED" 2>/dev/null || true)" ]; then
  wl_die "build reported success but nothing is staged at $STAGED"
fi

# Surface the generator's own warnings. These are how the world tells you a kit
# silently did nothing, and they scroll past in a multi-thousand-line log.
if grep -qa "LogPython: Warning" "$WL_LOG/build.log"; then
  wl_say "generator warnings (unique, first 15):"
  grep -a "LogPython: Warning" "$WL_LOG/build.log" \
    | sed 's/^.*LogPython: //' | cut -c1-140 | sort -u | head -15 | sed 's/^/    /'
fi

wl_ok "packaged -> $STAGED"
du -sh "$STAGED" 2>/dev/null | awk '{print "[wonderland] staged size: " $1}'
