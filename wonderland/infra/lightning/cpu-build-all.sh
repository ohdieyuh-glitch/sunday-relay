#!/usr/bin/env bash
# EVERYTHING EXCEPT THE STREAM, ON A MACHINE WITH NO GPU. Opt-in, unproven here.
#
#   bash wonderland/infra/lightning/cpu-build-all.sh
#
# WHY THIS MIGHT WORK, WITH SOURCES
#
# compile-preflight.sh moves only the C++ compile off the GPU. This goes
# further, and the reason is that Epic documents nearly the whole pipeline as
# container work with no graphics device anywhere in the requirements:
#
#   * "Hardware and Software Requirements for Container Deployments" (UE 5.8)
#     lists what is needed to BUILD AND RUN the Linux images: a 64-bit CPU with
#     SLAT, hardware virtualisation, and 4 GB of RAM. No GPU, no driver, no
#     Vulkan, no NVIDIA Container Toolkit, no display — the words do not appear.
#
#   * Epic's own Quick Start recipe is a plain `docker run` with NO `--gpus`,
#     running `RunUAT.sh BuildCookRun ... -cook -build -stage -pak -archive`,
#     described as "The C++ code modules for the project will be compiled ...
#     and the project's assets will then be cooked and packaged."
#
#   * Shader compilation is CPU work: "the actual compiling work is done in
#     helper processes called the Shader Compile Workers", cached to the DDC.
#
#   * `-run=pythonscript` is documented headless: "can even run your scripts in
#     headless mode without opening the Editor UI."
#
#   * The dev images list graphics support as OPTIONAL, and name "Build and
#     package Unreal projects", "Run commandlets to ... cook content" and "Run
#     Python scripts or other Editor automation utilities inside a container"
#     as things you use a dev image FOR.
#
# WHAT STILL NEEDS THE L4, AND IS NOT NEGOTIABLE
#
#   Pixel Streaming. "The computer that runs the Unreal Engine application with
#   the Pixel Streaming plugin must have ... NVIDIA GPU hardware that supports
#   Hardware-Accelerated Video Encoding (NVENC)" or AMD AMF or VideoToolbox.
#   And `-RenderOffScreen` is a NO-WINDOW mode, not a no-GPU mode: "running the
#   application in a headless mode without any visible window."
#
# WHAT IS UNPROVEN, HERE, IN THIS PROJECT
#
#   The level generator creates materials and imports textures through the
#   editor. Epic's documentation says that class of work runs in a container;
#   it does not say THIS generator does. And this project has a record of
#   editor features behaving differently headless — the engine's own screenshot
#   path returns success and writes an empty buffer, and Niagara templates cook
#   and place correctly while drawing nothing.
#
#   So this script runs the generator with -nullrhi and then CHECKS the world it
#   produced, rather than trusting that it worked. If the piece count comes out
#   short, build-wonderland.sh already refuses to cook it.
#
#   Treat a green run here as a cost saving to be verified on the stream, not as
#   proof. If it fails, nothing is lost but CPU minutes.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

wl_mkdirs
SKIP_PREPARE="${SKIP_PREPARE:-0}"
banner() { printf '\n\033[1;35m========== %s ==========\033[0m\n' "$1"; }

banner "1/4  MACHINE (no GPU needed)"
if wl_have_gpu; then
  wl_warn "a GPU is present. This script does not use it — if it is metered, this is the wrong machine."
else
  wl_ok "no GPU, and none is needed for anything below"
fi
DISK_GB=$(df -BG --output=avail "$WL_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
RAM_GB=$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null || echo 0)
echo "  disk free: ${DISK_GB} GB    RAM: ${RAM_GB} GB    cpus: $(nproc)"
# The cook writes real intermediates; this is the same floor the GPU path uses.
[ "${DISK_GB:-0}" -ge "$WL_MIN_DISK_GB" ] \
  || wl_die "only ${DISK_GB} GB free under $WL_ROOT; a UE 5.8 cook needs ${WL_MIN_DISK_GB}+ GB"

banner "2/4  SOURCE + ASSETS"
if [ "$SKIP_PREPARE" = "1" ]; then
  wl_say "SKIP_PREPARE=1 — using what is already staged"
else
  bash "$HERE/prepare.sh"
  [ -f "$WL_RUN/prepared.stamp" ] || wl_die "prepare.sh did not complete"
fi
wl_verify_source "cpu-build-all"

banner "3/4  ENGINE"
wl_ensure_ue_image
if [ -x "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" ]; then
  wl_ok "engine mode: native"
elif wl_ue_image_present; then
  wl_ok "engine mode: container"
else
  wl_die "no Unreal Engine 5.8 found. Run prepare.sh and read its readiness block."
fi

banner "4/4  BUILD + GENERATE + COOK + PACKAGE (cpu)"
# build-render.sh already drops --gpus when no GPU is present, so it is the
# CPU path as well as the GPU one. Reimplementing it here would mean
# maintaining a second copy and having the second copy be worse.
#
# WL_GENERATOR_EXTRA=-nullrhi is the one difference: the editor commandlet has
# no device to talk to on this machine.
WL_GENERATOR_EXTRA="${WL_GENERATOR_EXTRA:--nullrhi}" bash "$HERE/build-render.sh"

# WHAT THE WORLD ACTUALLY CAME OUT AS. build-wonderland.sh already refuses to
# cook a world below the piece floor, so reaching here means it passed — but the
# number belongs in this script's own output, because the whole question being
# answered is "did headless generation produce the same world".
# build-wonderland.sh puts its step logs in $OUT/logs, and build-render.sh
# passes OUT="$WL_OUT". Naming that once beats guessing at three paths.
GEN_LOG="$WL_OUT/logs/generate-hub-level.log"
if [ -f "$GEN_LOG" ]; then
  PIECES="$( ( set +o pipefail
               grep -ao 'INSTANCED_PIECES=[0-9]*' "$GEN_LOG" | tail -1 | cut -d= -f2 ) || true)"
  echo
  wl_ok "headless generation produced ${PIECES:-unknown} instanced pieces"
else
  wl_warn "could not find the generator log to report a piece count"
fi

echo
wl_ok "BUILT AND PACKAGED ON CPU: $(wl_source_sha)"
echo
echo "  What this proves: the C++ compiled, the world generated headless, and"
echo "  the project cooked and packaged — with no GPU anywhere."
echo "  What it does NOT: that the world LOOKS right. Nothing rendered."
echo
echo "  The stream needs NVENC and cannot move off the L4. There:"
echo "      SKIP_PREPARE=1 SKIP_BUILD=1 bash wonderland/infra/lightning/launch-wonderland.sh"
