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

# VERIFIED AGAIN, HERE. prepare.sh already checked, but the thing being guarded
# against is the source being different at COMPILE time from what was verified
# at fetch time — a second prepare, a manual checkout, a resumed session. This
# is the last point before the compiler runs.
wl_verify_source "build-render"

FORCE="${FORCE_REBUILD:-0}"

# ------------------------------------------------------ the Marble mesh files
# Only matters when WONDERLAND_MARBLE_IMPORT names a world, but it is cheap and
# idempotent so it runs unconditionally: prepare.sh links these, and a session
# that skipped prepare (SKIP_PREPARE=1, a resumed box) would otherwise reach the
# import step with a manifest pointing at a file that is not there.
wl_link_marble_assets

MARBLE_SLUG="${WONDERLAND_MARBLE_IMPORT:-}"
if [ -n "$MARBLE_SLUG" ]; then
  _mworld="$WL_SRC/wonderland/marble/worlds/$MARBLE_SLUG"
  [ -f "$_mworld/manifest.json" ] || wl_die \
    "WONDERLAND_MARBLE_IMPORT=$MARBLE_SLUG but no manifest at $_mworld/manifest.json"
  # Resolved by the IMPORTER'S OWN choose_mesh, not by a second implementation
  # here. A preflight that picks a different file from the thing it is
  # preflighting is worse than no preflight: it passes and the build still dies.
  if ! _mmesh="$(python3 "$WL_SRC/wonderland/marble/resolve-mesh.py" \
                   --slug "$MARBLE_SLUG" \
                   --root "$WL_SRC/wonderland/marble/worlds" 2>&1)"; then
    wl_die "no Marble visual mesh on disk for '$MARBLE_SLUG':
$_mmesh
The meshes live outside the checkout under $(wl_marble_assets_root)/$MARBLE_SLUG
and are linked in by wl_link_marble_assets. Refusing to start a build that would
fail at the import step."
  fi
  wl_ok "Marble mesh for $MARBLE_SLUG: $(du -h "$_mmesh" | cut -f1) at $_mmesh"
fi

# ------------------------------------------------- generated-asset preflight
# The level generator IMPORTS textures and audio from disk. If those
# directories are empty or invisible it does not fail — it logs a warning and
# packages a world with no texture maps and no sound, which looks like an art
# problem and is not. Checking costs nothing here and a whole GPU session
# later.
_ntex=$(find "$WONDERLAND_TEXTURE_DIR" -type f -name '*.png' 2>/dev/null | wc -l)
_naud=$(find "$WONDERLAND_AUDIO_DIR" -type f -name '*.wav' 2>/dev/null | wc -l)
wl_say "assets: $_ntex textures in $WONDERLAND_TEXTURE_DIR"
wl_say "        $_naud wavs in $WONDERLAND_AUDIO_DIR"
if [ "$_ntex" -eq 0 ] || [ "$_naud" -eq 0 ]; then
  wl_die "generated assets missing — run prepare.sh before spending GPU time"
fi
# WL_UE_IMAGE and WL_UE_ARCHIVE come from common.sh. This file used to define
# the image with its own default-in-place, which is how the launcher and the
# readiness report end up disagreeing about whether an engine exists.

# ------------------------------------------------------- choose an engine path
# Ensure the engine is here BEFORE choosing a mode. Idempotent, restores from
# the persistent archive if the image was discarded across a session, and never
# reaches the network.
wl_ensure_ue_image
MODE=""
if [ -x "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" ]; then
  MODE=native
elif wl_ue_image_present; then
  MODE=container
else
  wl_die "no Unreal Engine 5.8 found. Run prepare.sh and read its readiness block."
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
    WONDERLAND_TEXTURE_DIR="$WONDERLAND_TEXTURE_DIR" \
    WONDERLAND_AUDIO_DIR="$WONDERLAND_AUDIO_DIR" \
    WONDERLAND_LOOK="${WONDERLAND_LOOK:-}" \
    WONDERLAND_BATCH="${WONDERLAND_BATCH:-1}" \
    WONDERLAND_MARBLE_BACKDROP="${WONDERLAND_MARBLE_BACKDROP:-0}" \
    WONDERLAND_MARBLE_IMPORT="${WONDERLAND_MARBLE_IMPORT:-}" \
    WONDERLAND_COLLIDE="${WONDERLAND_COLLIDE:-}" \
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

  # MOUNT WHAT THE GENERATOR WILL READ. $WL_ROOT is bound at the same path
  # inside, so anything under it is already visible; an asset directory
  # pointed somewhere else needs its own bind or the container sees nothing.
  local extra=""
  case "$WONDERLAND_TEXTURE_DIR" in
    "$WL_ROOT"/*) ;;
    *) extra="$extra -v $WONDERLAND_TEXTURE_DIR:$WONDERLAND_TEXTURE_DIR:ro" ;;
  esac
  case "$WONDERLAND_AUDIO_DIR" in
    "$WL_ROOT"/*) ;;
    *) extra="$extra -v $WONDERLAND_AUDIO_DIR:$WONDERLAND_AUDIO_DIR:ro" ;;
  esac

  # PROVE IT, do not assume it. "The host variable is set" and "the container
  # can read that directory" are different claims, and only the second one
  # matters. This is a two-second container run against the same image, mounts
  # and environment the real build will use.
  # shellcheck disable=SC2086
  if ! docker run --rm $extra -v "$WL_ROOT:$WL_ROOT" \
        -e WONDERLAND_TEXTURE_DIR="$WONDERLAND_TEXTURE_DIR" \
        -e WONDERLAND_AUDIO_DIR="$WONDERLAND_AUDIO_DIR" \
        "$WL_UE_IMAGE" bash -lc '
          t=$(find "$WONDERLAND_TEXTURE_DIR" -name "*.png" 2>/dev/null | wc -l)
          a=$(find "$WONDERLAND_AUDIO_DIR"   -name "*.wav" 2>/dev/null | wc -l)
          echo "in-container: $t textures, $a wavs"
          [ "$t" -gt 0 ] && [ "$a" -gt 0 ]' 2>&1 | tee -a "$WL_LOG/build.log"; then
    wl_die "the UE container cannot see the generated assets. Host paths are set but not visible inside — check the bind mounts above."
  fi

  # shellcheck disable=SC2086
  # THE GENERATOR'S OWN KNOBS HAVE TO CROSS THE CONTAINER BOUNDARY.
  #
  # WONDERLAND_LOOK is the documented way to sweep the art LOOK table without
  # editing code, WONDERLAND_BATCH selects the batched or unbatched world, and
  # WONDERLAND_MARBLE_BACKDROP hands the far distance to Marble, and
  # WONDERLAND_MARBLE_IMPORT=<slug> adds the World Labs mesh itself. None of them
  # were forwarded, so every one of them silently did nothing in container mode
  # — an override that is ignored is worse than one that is unavailable,
  # because the operator believes the sweep happened.
  docker run --rm $gpuflag $extra \
    -v "$WL_ROOT:$WL_ROOT" \
    -e UE_ROOT=/home/ue4/UnrealEngine \
    -e OUT="$WL_OUT" \
    -e FORCE_REBUILD="$FORCE" \
    -e WONDERLAND_TEXTURE_DIR="$WONDERLAND_TEXTURE_DIR" \
    -e WONDERLAND_AUDIO_DIR="$WONDERLAND_AUDIO_DIR" \
    -e WONDERLAND_LOOK="${WONDERLAND_LOOK:-}" \
    -e WONDERLAND_BATCH="${WONDERLAND_BATCH:-1}" \
    -e WONDERLAND_MARBLE_BACKDROP="${WONDERLAND_MARBLE_BACKDROP:-0}" \
    -e WONDERLAND_MARBLE_IMPORT="${WONDERLAND_MARBLE_IMPORT:-}" \
    -e WONDERLAND_COLLIDE="${WONDERLAND_COLLIDE:-}" \
    -e WONDERLAND_GENERATOR_EXTRA="${WL_GENERATOR_EXTRA:-}" \
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
