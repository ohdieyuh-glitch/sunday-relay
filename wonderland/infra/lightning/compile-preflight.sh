#!/usr/bin/env bash
# COMPILE THE C++ AND NOTHING ELSE. Runs on CPU. No GPU required.
#
#   bash wonderland/infra/lightning/compile-preflight.sh
#
# WHY THIS EXISTS
#
# The first build of new Wonderland C++ against real UE 5.8 headers is where
# compiler errors live, and it is pure compilation — UnrealBuildTool driving
# clang. It needs no graphics device, no display and no shader work. Paying for
# an L4 to discover a missing include is paying a GPU to run a compiler.
#
# So this is the cheap half of `launch-wonderland.sh` stage 4, split out:
# verify the source, make sure the engine is here, run `RunUAT BuildEditor`,
# stop. It deliberately does NOT generate the level, does NOT cook, does NOT
# package and does NOT stream — those are the parts that want the editor
# running with an RHI, and they stay on the GPU path.
#
# WHAT IT WILL NOT DO. It will not pretend a green compile means the world is
# right. It compiles. That is the whole claim.
#
# WHAT WAS VERIFIED, AND WHAT WAS ONLY REASONED  (checked 2026-08-21 against
# Epic's UE 5.8 container documentation)
#
#   SOURCED. Epic's requirements and quick-start pages for the dev container
#   images contain ZERO mentions of gpu / nvidia / cuda / vulkan / opengl /
#   driver. Every GPU sentence Epic writes concerns the RUNTIME images and
#   Pixel Streaming — "an environment configured for running containers with
#   GPU acceleration" appears on the linear-media page, next to `--gpus all`,
#   and the runtime images "currently only support GPU acceleration on machines
#   using NVIDIA GPUs". Building is not in that set.
#
#   SOURCED. Editor automation inside a GPU-less container needs `-nullrhi`:
#   "(Note the use of the -nullrhi flag to disable rendering, which allows this
#   to work in containers without GPU access)". That is why LEVEL GENERATION
#   stays on the GPU path here — the generator creates textures and materials
#   through the editor, and -nullrhi is not a free substitute for a device.
#
#   REASONED, NOT SOURCED. The only in-container build command Epic documents
#   for these images is `RunUAT.sh BuildCookRun`. `BuildEditor` is not named
#   anywhere. Nothing in the documented requirements implies it needs a GPU —
#   it invokes a compiler — and the dev images are an Installed Build, which is
#   exactly the configuration in which a project's own modules are compiled.
#   But no page says so, and this comment is here rather than a confident claim
#   in a report. If BuildEditor turns out to be unavailable in the image, the
#   fallback is the full `launch-wonderland.sh` on the GPU machine, and this
#   file should record that it was tried and failed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

wl_mkdirs
SKIP_PREPARE="${SKIP_PREPARE:-0}"

banner() { printf '\n\033[1;35m========== %s ==========\033[0m\n' "$1"; }

banner "1/4  MACHINE (no GPU needed)"
if wl_have_gpu; then
  nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | sed 's/^/  GPU present: /'
  wl_warn "a GPU is present but will not be used — this step is compilation only."
  wl_warn "If you are paying for it, this is the wrong machine for this command."
else
  wl_ok "no GPU, and none is needed"
fi
DISK_GB=$(df -BG --output=avail "$WL_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
RAM_GB=$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null || echo 0)
echo "  disk free: ${DISK_GB} GB    RAM: ${RAM_GB} GB    cpus: $(nproc)"
# A C++ build is RAM- and core-hungry rather than disk-hungry, but the engine
# itself is ~69 GB and has to be here. This is a smaller floor than the cook's.
[ "${DISK_GB:-0}" -ge 25 ] \
  || wl_die "only ${DISK_GB} GB free under $WL_ROOT; the engine plus intermediates need more"
[ "${RAM_GB:-0}" -ge 8 ] \
  || wl_warn "only ${RAM_GB} GB RAM; a UE editor build may thrash or be OOM-killed"

banner "2/4  SOURCE"
if [ "$SKIP_PREPARE" = "1" ]; then
  wl_say "SKIP_PREPARE=1 — using whatever is already at $WL_SRC"
  wl_verify_source "compile-preflight"
else
  # prepare.sh does far more than fetch (packages, textures, audio, gates), and
  # all of it is CPU work that this machine can do. Running it here means the
  # GPU session starts with everything already staged.
  bash "$HERE/prepare.sh"
  [ -f "$WL_RUN/prepared.stamp" ] || wl_die "prepare.sh did not complete"
  wl_verify_source "compile-preflight"
fi

banner "3/4  ENGINE"
# Idempotent, restores from the persistent archive, never reaches the network.
wl_ensure_ue_image
MODE=""
if [ -x "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" ]; then
  MODE=native
elif wl_ue_image_present; then
  MODE=container
else
  wl_die "no Unreal Engine 5.8 found. Run prepare.sh and read its readiness block."
fi
wl_ok "engine mode: $MODE"

banner "4/4  COMPILE"
PROJECT="$WL_SRC/wonderland/Wonderland.uproject"
[ -f "$PROJECT" ] || wl_die "no project at $PROJECT"
SHA="$(wl_source_sha)"
LOG="$WL_LOG/compile-preflight.log"
: > "$LOG"
printf 'compiling %s on branch %s\n' "$SHA" "$(wl_source_branch)" | tee -a "$LOG"

RC=0
if [ "$MODE" = native ]; then
  set +e
  "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" BuildEditor \
      -project="$PROJECT" -notools 2>&1 | tee -a "$LOG"
  RC="${PIPESTATUS[0]}"
  set -e
else
  # NO --gpus. This is the point of the script: the container runs a compiler,
  # and the NVIDIA container toolkit is not part of that. build-render.sh
  # already adds the flag only when a GPU is present, so a CPU Studio was
  # always able to run this image — it was just never asked to.
  set +e
  docker run --rm \
    -v "$WL_ROOT:$WL_ROOT" \
    -e UE_ROOT=/home/ue4/UnrealEngine \
    -w "$WL_SRC" \
    "$WL_UE_IMAGE" \
    bash -lc '/home/ue4/UnrealEngine/Engine/Build/BatchFiles/RunUAT.sh BuildEditor \
                -project="'"$PROJECT"'" -notools' 2>&1 | tee -a "$LOG"
  RC="${PIPESTATUS[0]}"
  set -e
fi

# A NON-ZERO EXIT IS NOT THE ONLY FAILURE. UAT has historically exited zero on
# a failed build; build-wonderland.sh already carries this tripwire and the
# reason it exists applies exactly as much here.
if [ "$RC" -ne 0 ] \
   || grep -Eq 'AutomationTool exiting with ExitCode=[1-9]|BUILD FAILED|error:' "$LOG"; then
  echo
  wl_warn "the first compiler errors, in order:"
  grep -E 'error:|Error:' "$LOG" | head -25 | sed 's/^/    /'
  echo
  wl_die "COMPILE FAILED for $SHA. Full log: $LOG
No GPU time was spent. Fix the errors and run this again on the same CPU machine."
fi

printf '%s\n' "$SHA" > "$WL_RUN/compiled-preflight.sha"
echo
wl_ok "COMPILED CLEAN: $SHA"
echo "  log: $LOG"
echo
echo "  What this proves: the C++ builds against UE 5.8."
echo "  What it does NOT: that the world generates, cooks, packages or streams."
echo "  Next, on a GPU machine:"
echo "      SKIP_PREPARE=1 bash wonderland/infra/lightning/launch-wonderland.sh"
