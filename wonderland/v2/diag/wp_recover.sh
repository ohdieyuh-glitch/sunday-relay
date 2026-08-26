#!/usr/bin/env bash
# P0 WORLD PARTITION RECOVERY (CPU work; the conversion commandlet needs a
# rendering-capable RHI but does no GPU art work).
#
# 1. build the SAME deterministic V2 world into a NEW CLASSIC staging map
#    (WLV2_MAP_NAME, WLV2_PARTITIONED=0), reusing the 83 meshes already on disk
# 2. validate it (actors, tags, camera, umap size) -- STOP if empty
# 3. convert it with Unreal's official WorldPartitionConvertCommandlet
# 4. validate the converted world (WP object, external actor packages)
#
# The broken WL_V2_GoldenArrival is never opened, mutated or deleted.
#
#   bash wonderland/v2/diag/wp_recover.sh            # all four steps
#   WP_STEP=convert bash .../wp_recover.sh           # one step
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../infra/lightning/common.sh"
MAPNAME="${WLV2_MAP_NAME:-WL_V2_GoldenArrival_WP2}"
MAP="/Game/WonderlandV2/Maps/$MAPNAME"
PROJECT="$WL_SRC/wonderland/Wonderland.uproject"
STEP="${WP_STEP:-all}"
gpuflag=""
if wl_have_gpu; then
  gpuflag="--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all"
  # -AllowCommandletRendering NEEDS a Vulkan driver ("Failed to load Vulkan
  # Driver which is required to run the engine", 2026-08-26 16:46Z). The
  # container toolkit injects the library but no ICD manifest; ask common.sh
  # for the host's manifest (generating it if this host has none) and mount it.
  ICD="$(wl_vulkan_icd_files 2>/dev/null | head -1)"
  [ -n "${ICD:-}" ] && [ -f "$ICD" ] || ICD="$WL_RUN/nvidia_icd.json"
  if [ -f "$ICD" ]; then
    gpuflag="$gpuflag -v $ICD:/etc/vulkan/icd.d/nvidia_icd.json:ro -e VK_ICD_FILENAMES=/etc/vulkan/icd.d/nvidia_icd.json -e VK_DRIVER_FILES=/etc/vulkan/icd.d/nvidia_icd.json"
    wl_say "Vulkan ICD for the container: $ICD"
  else
    wl_warn "no Vulkan ICD manifest on this host; a rendering commandlet will refuse to start"
  fi
fi
ue() {  # log-name, then the editor arguments
  local name="$1"; shift
  local log="$WL_LOG/wp-$name.log"
  # shellcheck disable=SC2086
  docker run --rm $gpuflag -v "$WL_ROOT:$WL_ROOT" \
    -e WLV2_MAP_NAME="$MAPNAME" -e WLV2_PARTITIONED="${WLV2_PARTITIONED:-1}" \
    -e WLV2_REUSE_ASSETS="${WLV2_REUSE_ASSETS:-1}" -e WLV2_REBUILD="${WLV2_REBUILD:-}" \
    -e WLV2_ALL_ALWAYS_LOADED="${WLV2_ALL_ALWAYS_LOADED:-}" -e WLV2_CHECK_MAP="${WLV2_CHECK_MAP:-$MAP}" \
    -e WLV2_MARBLE_GLB="${WLV2_MARBLE_GLB:-}" -e WLV2_MARBLE_PANO="${WLV2_MARBLE_PANO:-}" \
    -e WONDERLAND_TEXTURE_DIR="${WONDERLAND_TEXTURE_DIR:-$WL_ROOT/textures}" \
    -e WLV2_MANIFEST="$WL_RUN/wlv2-manifest-$name.json" \
    -w "$WL_SRC" "$WL_UE_IMAGE" \
    /home/ue4/UnrealEngine/Engine/Binaries/Linux/UnrealEditor-Cmd "$PROJECT" "$@" \
    -unattended -nop4 -stdout -FullStdOutLogOutput > "$log" 2>&1
  local rc=$?
  wl_say "step $name exit $rc (log $log)"
  return $rc
}
if [ "$STEP" = all ] || [ "$STEP" = build ]; then
  wl_say "1/4 building the V2 world into CLASSIC staging map $MAP"
  # NOT -nullrhi: materials created without an RHI are saved with no shadermap
  # and the cook then falls back to the DEFAULT GREY MATERIAL for the whole
  # world (measured 2026-08-26: "Failed to compile Material for platform
  # SF_VULKAN_SM5, Default Material will be used in game").
  WLV2_PARTITIONED="${WLV2_PARTITIONED:-0}" ue build "-run=pythonscript" "-script=$WL_SRC/wonderland/v2/build_v2.py" -AllowCommandletRendering -RenderOffscreen
  grep -E "V2 (ASSETS|SAVE|SUMMARY|MAP)" "$WL_LOG/wp-build.log" | sed 's/.*LogPython: Warning: //' | sort -u | tail -8 | cut -c1-200
fi
if [ "$STEP" = all ] || [ "$STEP" = validate-staging ]; then
  wl_say "2/4 validating the staging map"
  ue validate-staging "-run=pythonscript" "-script=$WL_SRC/wonderland/v2/diag/validate_map.py" -nullrhi
  grep "VALIDATE " "$WL_LOG/wp-validate-staging.log" | sed 's/.*LogPython: Warning: //' | sort -u | cut -c1-220
  if ! grep -q "SUMMARY .*production=[1-9]" "$WL_LOG/wp-validate-staging.log"; then
    wl_die "staging map has no production actors -- not converting"
  fi
fi
if [ "$STEP" = all ] || [ "$STEP" = convert ]; then
  # the conversion is IN PLACE: back the staging map up first, so a bad
  # conversion costs a copy rather than a 10-minute regeneration
  _umap="$WL_SRC/wonderland/Content/WonderlandV2/Maps/$MAPNAME.umap"
  [ -f "$_umap" ] && cp -f "$_umap" "$WL_RUN/$MAPNAME.umap.classic-backup" && wl_say "staging map backed up to $WL_RUN/$MAPNAME.umap.classic-backup"
  wl_say "3/4 converting $MAPNAME with WorldPartitionConvertCommandlet (in place; the broken map is untouched)"
  ue convert "-run=WorldPartitionConvertCommandlet" "$MAPNAME" -AllowCommandletRendering -RenderOffscreen -Verbose
  grep -iE "LogWorldPartitionConvert|converted|actors|error|warning: .*partition" "$WL_LOG/wp-convert.log" | tail -12 | cut -c1-200
fi
if [ "$STEP" = all ] || [ "$STEP" = validate-wp ]; then
  wl_say "4/4 validating the converted world"
  ue validate-wp "-run=pythonscript" "-script=$WL_SRC/wonderland/v2/diag/validate_map.py" -nullrhi
  grep "VALIDATE " "$WL_LOG/wp-validate-wp.log" | sed 's/.*LogPython: Warning: //' | sort -u | cut -c1-220
fi
wl_ok "recovery chain done"
