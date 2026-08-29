#!/usr/bin/env bash
# ONE PASS, UNATTENDED, ON THE STUDIO: regenerate the recipes a pass changed
# (everything else is reused from disk), cook the classic map, package.
# Capture stays on the laptop (round.sh) because the frame is pulled here.
#
#   ssh wonderland-l4 'cd /teamspace/studios/this_studio/wonderland/src && \
#     WLV2_REBUILD="plaza_slab_0,...,path_flag_0,...,kerb_stone,path_steps" \
#     setsid nohup bash wonderland/v2/tools/pass_chain.sh > ../run/pass.log 2>&1 &'
#
# WLV2_REBUILD names the recipe keys to rebuild (assets_v2.REBUILD_KEYS);
# variant families are listed key by key. The generator runs WITH an RHI (the
# masters must compile) exactly as wp_recover.sh's build step does.
set -uo pipefail
R=/teamspace/studios/this_studio/wonderland
cd $R/src || exit 1
echo "pass start $(date -u +%FT%TZ) head=$(git rev-parse --short HEAD) rebuild=${WLV2_REBUILD:-<none>}"
# THE PANORAMA DOME (PASS 04, 2026-08-28): the Marble export is gitignored, so a
# fresh checkout has none and the generator logged "NO Marble panorama ->
# V2 SKY: dome skipped" in every classic-map render. v2-build.sh falls back to
# the tracked reference copy; this chain must too.
export WLV2_MARBLE_PANO="${WLV2_MARBLE_PANO:-$R/src/wonderland/v2/reference/marble-royal-garden-backdrop-panorama.png}"
[ -f "$WLV2_MARBLE_PANO" ] || echo "WARNING: panorama not found at $WLV2_MARBLE_PANO -- the sky dome will be skipped"

# THE C++ IS COMPILED BEFORE THE WORLD IS GENERATED (2026-08-29).
#
# The generate step runs a Python commandlet INSIDE the editor, and that
# commandlet asks for game classes by path: BP_RelayDog's parent is
# /Script/Wonderland.RelayDogCharacter, the flagstones are batched through
# /Script/Wonderland.WonderlandInstancedBatch. `unreal.load_class` on a class
# whose module has not been compiled returns None -- it does not raise -- so a
# chain that cooks C++ AFTER the generate bakes a world built against the
# PREVIOUS binaries: a Dog with a plain ACharacter parent, canonical and
# completely frozen, in a package whose module contains the animation code
# that never gets a chance to run. That is precisely how this project lost
# eight Dogs to a class nobody had written, and it nearly happened again the
# first time the locomotion module was shipped.
#
# compile-preflight.sh is idempotent and costs seconds when nothing changed,
# so the cheap fix is to always run it first.
if [ "${WLV2_SKIP_COMPILE:-0}" != "1" ]; then
  echo "compile $(date -u +%T): building the game module before the generate"
  # WL_BRANCH IS PASSED, NOT ASSUMED. compile-preflight.sh defaults to the
  # marble branch, and prepare.sh refuses to switch a checkout silently (as it
  # should: a build that compiled the wrong source while reporting success at
  # every stage is why that guard exists). v2-build.sh sets this for the same
  # reason; the chain must set it too rather than inherit a default.
  WL_BRANCH="${WL_BRANCH:-relay/wonderland-v2}" \
    bash wonderland/infra/lightning/compile-preflight.sh > $R/run/compile-preflight.log 2>&1; crc=$?
  echo "compile rc=$crc $(date -u +%T)"
  if [ $crc -ne 0 ]; then
    grep -aE "error:|Error:|wl_die|FAILED" $R/run/compile-preflight.log | tail -5 | cut -c1-200
    echo "pass done $(date -u +%FT%TZ) (compile FAILED -- nothing generated, nothing cooked)"
    exit 1
  fi
fi
WLV2_REUSE_ASSETS=1 WLV2_PARTITIONED=0 WP_STEP=build bash wonderland/v2/diag/wp_recover.sh; rc=$?
echo "generate wrapper rc=$rc $(date -u +%T)"
grep -a "LogPython" $R/logs/wp-build.log | grep -a "V2 \(ASSETS\|SUMMARY\|GROUND\|LIGHT\|SAVE\|MAP\)" | sed 's/.*LogPython: [A-Za-z]*: //' | cut -c1-200 | tail -10
# THE GENERATOR'S OWN VERDICT, not the wrapper's: wp_recover.sh exits 0 after a
# step that exited 255 (2026-08-28: the map could not be recreated and the
# chain went on to cook the old world).
if ! grep -aq "Python script executed successfully" $R/logs/wp-build.log || grep -aq "executed with errors" $R/logs/wp-build.log; then
  echo "generate FAILED (the Python commandlet reported errors) -- not cooking"
  grep -aE "Error: [A-Za-z]+Error|RuntimeError" $R/logs/wp-build.log | tail -3 | cut -c1-200
  exit 3
fi
WL_COOK_MAP=/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2 WL_SKIP_GENERATE=1 SKIP_COMPILE_PREFLIGHT=1 \
  WL_SKIP_BUILD_EDITOR=1 WL_BUILD_HLOD=0 SKIP_V2_TEXTURES=1 FORCE_REBUILD=1 WONDERLAND_MIN_PIECES=0 ALLOW_EMPTY_LEVEL=1 \
  WL_BRANCH=relay/wonderland-v2 WL_REQUIRE_SHA=$(git rev-parse HEAD) \
  bash wonderland/infra/lightning/v2-build.sh > $R/run/v2-build.log 2>&1; rc=$?
echo "cook rc=$rc $(date -u +%T) packaged=$(cat $R/packaged/logs/packaged.sha 2>/dev/null)"
grep -aE "Failed to compile Material|wl_die|FAILED" $R/run/v2-build.log | tail -3
echo "pass done $(date -u +%FT%TZ)"
