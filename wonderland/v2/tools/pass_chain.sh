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
