#!/usr/bin/env bash
# P0 TEST A' runner: the editor commandlet renders the diagnostic scene to a
# render target and exports a PNG. No compile, no cook, no game launch.
# Mirrors build-render.sh's container invocation (GPU + Vulkan ICD mounted).
#
#   bash wonderland/v2/diag/run_editor_diag.sh   (on the Studio)
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/../../infra/lightning/common.sh"
SCRIPT="${1:-$WL_SRC/wonderland/v2/diag/editor_capture_diag.py}"
PROJECT="$WL_SRC/wonderland/Wonderland.uproject"
OUT="$WL_ROOT/proof/diag"; mkdir -p "$OUT"
LOG="$WL_LOG/editor-diag.log"
gpuflag=""
if wl_have_gpu; then
  gpuflag="--gpus all -e NVIDIA_DRIVER_CAPABILITIES=all"
  [ -f "$WL_RUN/nvidia_icd.json" ] && gpuflag="$gpuflag -v $WL_RUN/nvidia_icd.json:/etc/vulkan/icd.d/nvidia_icd.json:ro -e VK_ICD_FILENAMES=/etc/vulkan/icd.d/nvidia_icd.json -e VK_DRIVER_FILES=/etc/vulkan/icd.d/nvidia_icd.json"
fi
wl_say "editor diag: $SCRIPT -> $OUT (log $LOG)"
# shellcheck disable=SC2086
docker run --rm $gpuflag -v "$WL_ROOT:$WL_ROOT" -e WLV2_DIAG_OUT="$OUT" -w "$WL_SRC" "$WL_UE_IMAGE" \
  /home/ue4/UnrealEngine/Engine/Binaries/Linux/UnrealEditor-Cmd "$PROJECT" -run=pythonscript -script="$SCRIPT" \
  -AllowCommandletRendering -RenderOffscreen -unattended -nop4 -stdout -FullStdOutLogOutput > "$LOG" 2>&1
RC=$?
wl_say "editor diag exit $RC"
grep -E "DIAG |LogVulkanRHI: Display: Vulkan RHI ShaderPlatform|Vulkan device|VK_ERROR|Fatal|SDL" "$LOG" | sed 's/.*LogPython: Warning: //' | tail -14 | cut -c1-200
ls -la "$OUT"/*.png 2>/dev/null | awk '{print $5" "$9}'
for f in "$OUT"/*.png; do [ -f "$f" ] && python3 "$WL_SRC/wonderland/infra/lightning/frame-check.py" "$f" | grep -E "^(verdict|luma_mean|distinct)" | tr '\n' ' '; echo " <- $(basename "$f")"; done
