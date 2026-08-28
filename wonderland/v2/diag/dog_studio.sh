#!/usr/bin/env bash
# THE CANONICAL RELAY DOG: build its assets + BP + the studio map (editor commandlet,
# WITH an RHI so the material instances compile), then cook that map and capture
# the four locked studio cameras. GPU: the commandlet needs the Vulkan ICD like
# wp_recover.sh's build step; the cook is CPU; the capture needs the GPU.
#
#   DOG_STEP=build bash wonderland/v2/diag/dog_studio.sh     # assets + BP + map
#   DOG_STEP=cook  bash wonderland/v2/diag/dog_studio.sh     # cook+package the studio map
#   (capture from the laptop: WL_CAMS="0 1 2 3" WL_V2_FPS=0 WL_RES_X=1280 WL_RES_Y=720 \
#      WL_KIT_ARGS='-WLMap=/Game/WonderlandV2/Maps/WL_V2_RelayDogStudio' bash wonderland/v2/tools/round.sh)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../infra/lightning/common.sh"
STEP="${DOG_STEP:-build}"
PROJECT="$WL_SRC/wonderland/Wonderland.uproject"
gpuflag=""
if wl_have_gpu; then
  gpuflag="--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all"
  ICD="$(wl_vulkan_icd_files 2>/dev/null | head -1)"
  [ -n "${ICD:-}" ] && [ -f "$ICD" ] || ICD="$WL_RUN/nvidia_icd.json"
  if [ -f "$ICD" ]; then
    gpuflag="$gpuflag -v $ICD:/etc/vulkan/icd.d/nvidia_icd.json:ro -e VK_ICD_FILENAMES=/etc/vulkan/icd.d/nvidia_icd.json -e VK_DRIVER_FILES=/etc/vulkan/icd.d/nvidia_icd.json"
  else
    wl_warn "no Vulkan ICD manifest on this host; a rendering commandlet will refuse to start"
  fi
fi
if [ "$STEP" = build ]; then
  wl_say "building the canonical Relay Dog (assets, BP_RelayDog, WL_V2_RelayDogStudio)"
  # shellcheck disable=SC2086
  docker run --rm $gpuflag -v "$WL_ROOT:$WL_ROOT" \
    -e WLV2_DOG_HEAD_WIDTH_UU="${WLV2_DOG_HEAD_WIDTH_UU:-60}" -e WLV2_DOG_SUN_LUX="${WLV2_DOG_SUN_LUX:-5000}" \
    -e WLV2_DOG_EYE_EMISSIVE="${WLV2_DOG_EYE_EMISSIVE:-600}" \
    -w "$WL_SRC" "$WL_UE_IMAGE" /home/ue4/UnrealEngine/Engine/Binaries/Linux/UnrealEditor-Cmd "$PROJECT" \
    -run=pythonscript "-script=$WL_SRC/wonderland/v2/dog_v2.py" -AllowCommandletRendering -RenderOffscreen \
    -unattended -nop4 -stdout -FullStdOutLogOutput > "$WL_LOG/wp-dog.log" 2>&1
  rc=$?
  grep -aoE "LogPython: Warning: DOG [^\r]{0,220}" "$WL_LOG/wp-dog.log" | sed 's/LogPython: Warning: //' | tail -30
  grep -aE "Error:|error:|Traceback" "$WL_LOG/wp-dog.log" | grep -v "LogPython: Warning" | tail -5 | cut -c1-200
  echo "dog build rc=$rc log=$WL_LOG/wp-dog.log"
  exit $rc
fi
if [ "$STEP" = cook ]; then
  # common.sh exports WL_BRANCH=relay/wonderland-marble by default, so a
  # ${WL_BRANCH:-…} fallback never applies and the branch gate refuses
  # (measured 2026-08-28). V2 is the only branch this script may cook.
  wl_say "cooking the studio map"
  cd "$WL_SRC" || exit 1
  WL_COOK_MAP=/Game/WonderlandV2/Maps/WL_V2_RelayDogStudio WL_SKIP_GENERATE=1 SKIP_COMPILE_PREFLIGHT=1 WL_SKIP_BUILD_EDITOR=1 \
    WL_BUILD_HLOD=0 SKIP_V2_TEXTURES=1 FORCE_REBUILD=1 WONDERLAND_MIN_PIECES=0 ALLOW_EMPTY_LEVEL=1 \
    WL_BRANCH=relay/wonderland-v2 WL_REQUIRE_SHA="${WL_REQUIRE_SHA:-$(git rev-parse HEAD)}" \
    bash wonderland/infra/lightning/v2-build.sh
  exit $?
fi
echo "unknown DOG_STEP=$STEP" >&2; exit 2
