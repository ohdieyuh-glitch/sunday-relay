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
# CAPTURED BEFORE common.sh, WHICH ALREADY DEFAULTED IT.
#
# common.sh exports WL_BRANCH=relay/wonderland-marble, so the
# `${WL_BRANCH:-relay/wonderland-v2}` that used to stand below the source
# could never fire: the variable was always already set. This script's own
# header says it pins the branch, and for as long as that line stood the
# header was false -- every v2-build refused at the branch gate with
# "asked for relay/wonderland-marble" while the checkout was correct.
#
# The gate was right to refuse; it is the reason this was a stopped build and
# not a marble package labelled as V2. Keeping the distinction between "the
# caller asked for a branch" and "common.sh filled one in" is what makes the
# default reachable again.
_WL_BRANCH_ASKED="${WL_BRANCH:-}"
# shellcheck source=common.sh
. "$HERE/common.sh"

export WL_BRANCH="${_WL_BRANCH_ASKED:-relay/wonderland-v2}"
export WL_GENERATOR="${WL_GENERATOR:-wonderland/v2/build_v2.py}"
# THE CLASSIC MAP IS THE WORLD. WL_V2_GoldenArrival is the empty World
# Partition level the generator creates and abandons (14 KB on disk);
# WL_V2_GoldenArrival_WP2 is Golden Arrival (1.4 MB). Defaulting to the former
# packages an empty world and cooks it without a single warning, which is
# exactly what happened on 2026-08-29 when a cook ran with the generate
# skipped. The default is the world now; the empty one has to be asked for.
export WL_COOK_MAP="${WL_COOK_MAP:-/Game/WonderlandV2/Maps/WL_V2_GoldenArrival_WP2}"
export WLV2_MANIFEST="${WLV2_MANIFEST:-$WL_RUN/wlv2-manifest.json}"
export WL_BUILD_HLOD="${WL_BUILD_HLOD:-1}"      # World Partition HLODs (INSTANCING, CPU)
# A V2 build regenerates the world from source every time; the shared build
# script's idempotence stamp skipped an entire rebuild on 2026-08-26 after
# the generator changed, leaving the previous (empty) package in place.
export FORCE_REBUILD="${FORCE_REBUILD:-1}"

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
# marble/worlds/*/assets/ is gitignored (the export dir), so a fresh checkout
# has no panorama there; V2's byte-identical reference copy IS tracked.
for cand in "$WL_SRC/$WORLD/assets/panorama.jpg" \
            "$WL_SRC/wonderland/v2/reference/marble-royal-garden-backdrop-panorama.png" "${WLV2_MARBLE_PANO:-}"; do
  if [ -n "$cand" ] && [ -f "$cand" ]; then export WLV2_MARBLE_PANO="$cand"; break; fi
done
if [ -n "${WLV2_MARBLE_PANO:-}" ]; then
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
# compile-preflight.sh has just run prepare.sh (checkout, gates, V1 textures,
# engine image); running it again inside cpu-build-all cost ~5 min per build.
SKIP_PREPARE="${SKIP_PREPARE:-1}" bash "$HERE/cpu-build-all.sh"

LOG="$(ls -t "$WL_OUT"/logs/generate-hub-level.log 2>/dev/null | head -1 || true)"
if [ -n "$LOG" ]; then
  wl_say "V2 build log lines:"
  grep -E "V2 (SUMMARY|EMPTY MAP|ASSETS|MESH BACKEND|MAP|WORLD PARTITION|COMPOSITION|GROUND|ASSET .*FAILED)|GS CAPABILITY|MARBLE" "$LOG" | tail -40 || true
fi
[ -f "$WLV2_MANIFEST" ] && wl_say "manifest: $WLV2_MANIFEST" || wl_warn "no manifest written -- the generator did not reach its end"
