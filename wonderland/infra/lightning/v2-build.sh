#!/usr/bin/env bash
# WONDERLAND V2 — build the NEW level on CPU: run build_v2.py in the editor
# commandlet, then cook and package the V2 map. GPU OFF for all of it.
#
#   bash wonderland/infra/lightning/v2-build.sh
#
# What it pins: the branch (relay/wonderland-v2), the generator (build_v2.py),
# the cook map (WL_V2_GoldenArrival), the Marble world's HQ mesh and panorama
# if they are on this Studio, and the manifest path the build writes.
#
# The first lines to read afterwards:
#   grep -E "V2 (SUMMARY|EMPTY MAP|ASSETS|MESH BACKEND)|GS CAPABILITY|MARBLE" <log>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

export WL_BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
export WL_GENERATOR="${WL_GENERATOR:-wonderland/v2/build_v2.py}"
export WL_COOK_MAP="${WL_COOK_MAP:-/Game/WonderlandV2/Maps/WL_V2_GoldenArrival}"
export WLV2_MANIFEST="${WLV2_MANIFEST:-$WL_RUN/wlv2-manifest.json}"
export WL_BUILD_HLOD="${WL_BUILD_HLOD:-1}"      # World Partition HLODs (INSTANCING, CPU)

# THE MARBLE WORLD. The 3,500-credit textured mesh was downloaded on this
# Studio (manifest: "Downloaded on the L4"); it is not in git. Find it, or say
# plainly that the build will run without it.
WORLD="wonderland/marble/worlds/royal-garden-backdrop"
for cand in "$WL_SRC/$WORLD/assets/mesh_hq.glb" "$WL_ROOT/marble/royal-garden-backdrop/mesh_hq.glb" \
            "$WL_ROOT/$WORLD/assets/mesh_hq.glb" "${WLV2_MARBLE_GLB:-}"; do
  if [ -n "$cand" ] && [ -f "$cand" ]; then export WLV2_MARBLE_GLB="$cand"; break; fi
done
if [ -n "${WLV2_MARBLE_GLB:-}" ]; then
  wl_say "Marble world mesh: $WLV2_MARBLE_GLB ($(du -h "$WLV2_MARBLE_GLB" | cut -f1))"
else
  wl_warn "Marble HQ mesh NOT FOUND on this Studio; V2 builds the castle kit + panorama dome instead"
fi
if [ -f "$WL_SRC/$WORLD/assets/panorama.jpg" ]; then
  export WLV2_MARBLE_PANO="$WL_SRC/$WORLD/assets/panorama.jpg"
  wl_say "Marble panorama: $WLV2_MARBLE_PANO"
else
  wl_warn "Marble panorama not in the checkout; no skyline dome"
fi

wl_say "V2 BUILD: branch=$WL_BRANCH generator=$WL_GENERATOR map=$WL_COOK_MAP"
# The C++ hover component and prop have never been compiled; a compile
# failure must be the first thing this run reports, not something found
# after a 40-minute cook.
if [ -x "$HERE/compile-preflight.sh" ] && [ "${SKIP_COMPILE_PREFLIGHT:-0}" != "1" ]; then
  bash "$HERE/compile-preflight.sh" || wl_die "C++ compile preflight failed -- fix Source/ before building V2"
fi
# THE V2 TEXTURE SET. Neutral detail maps (textures_v2.py) — the shared V1 set
# carries its own colour and would turn the cream plaza brown under the tint.
# Written next to the V1 set (distinct T_V2_ stems) and gated before the build.
export WONDERLAND_TEXTURE_DIR="${WONDERLAND_TEXTURE_DIR:-$WL_ROOT/textures}"
if [ "${SKIP_V2_TEXTURES:-0}" != "1" ]; then
  wl_say "V2 textures -> $WONDERLAND_TEXTURE_DIR"
  ( cd "$WL_SRC" && python3 wonderland/v2/textures_v2.py "$WONDERLAND_TEXTURE_DIR" ) \
    || wl_die "textures_v2.py failed"
  ( cd "$WL_SRC" && python3 wonderland/v2/verify_v2_textures.py "$WONDERLAND_TEXTURE_DIR" ) \
    || wl_die "V2 texture gate failed -- not building on a broken set"
fi
bash "$HERE/cpu-build-all.sh"

LOG="$(ls -t "$WL_OUT"/logs/generate-hub-level.log 2>/dev/null | head -1 || true)"
if [ -n "$LOG" ]; then
  wl_say "V2 build log lines:"
  grep -E "V2 (SUMMARY|EMPTY MAP|ASSETS|MESH BACKEND|MAP|WORLD PARTITION|COMPOSITION|GROUND|ASSET .*FAILED)|GS CAPABILITY|MARBLE" "$LOG" | tail -40 || true
fi
[ -f "$WLV2_MANIFEST" ] && wl_say "manifest: $WLV2_MANIFEST" || wl_warn "no manifest written -- the generator did not reach its end"
