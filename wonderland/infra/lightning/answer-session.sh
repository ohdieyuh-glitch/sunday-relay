#!/usr/bin/env bash
# ONE STUDIO SESSION, EVERY OPEN QUESTION.
#
# WHY THIS EXISTS
#
# The GPU box is not always up, and when it is, the expensive thing is not the
# compute -- it is the round trip. Every question that needs a rendered frame
# has been costing its own forty-minute build, and three of them are open at
# once. Asked separately that is three sessions; asked together it is one.
#
# So this runs the whole sequence and leaves every artefact on disk, named, in
# one place. It answers:
#
#   1. WHAT COLOUR DOES THE PACKAGED BUILD ACTUALLY HOLD?
#      Wonderland renders grey and ten mechanisms have been refuted by
#      evidence: specular, fog, the sky's hue, bloom, the ACES shoulder,
#      ambient wash, the batch material path, metal-vs-dielectric, the
#      BaseColor wiring, and emissive/rim defaults. Every one of those checks
#      read the EDITOR's assets or the generator's intent. A cook sits between
#      those and the pixels and nothing has ever read what shipped.
#      WonderlandWorldProof now logs MATERIAL_RUNTIME lines at load; this
#      greps them out. If they disagree with the palette, the cook is the bug.
#
#   2. DO THE UPRIGHT DOGS READ?
#      The standing body plan is proven offline -- 32 assertions, exact foot
#      lock -- and has never been rendered.
#
#   3. IS THE BLUR THE RENDERER OR THE ENCODER?
#      Two captures of the same camera and the same build, one through Pixel
#      Streaming and one with no encoder in the path at all. Every sharpness
#      measurement this project has taken came off a streamed frame, which
#      cannot tell those apart -- and a whole session once went into sweeping
#      renderer values against an H264 artefact.
#
# Nothing here is new capability. It is the existing steps in the order that
# answers the most per session.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
. "$HERE/common.sh"

WL_ANSWERS="${WL_ANSWERS:-$WL_PROOF/answers}"
mkdir -p "$WL_ANSWERS"

wl_say "session start: build, then three answers"

# ---------------------------------------------------------------- 1. build
# CPU-side. The GPU is only needed from the capture onward, which is worth
# saying out loud because it decides how long the L4 has to be on.
SKIP_PREPARE="${SKIP_PREPARE:-1}" FORCE_REBUILD="${FORCE_REBUILD:-1}" \
  bash "$HERE/cpu-build-all.sh"

SHA="$(wl_source_sha 2>/dev/null || echo unknown)"
SHORT="${SHA:0:7}"
wl_ok "built $SHORT"

# ------------------------------------------------- 2. the streamed hero frame
WL_HERO_CAMS="${WL_HERO_CAMS:-6}" SKIP_PREPARE=1 SKIP_BUILD=1 \
  WL_ALLOW_NPM_INSTALL=1 bash "$HERE/capture-hero-shots.sh"

STREAMED="$(wl_find_first "$WL_PROOF/captures" -name "hero6-$SHORT-*.png" | head -1 || true)"
[ -n "${STREAMED:-}" ] && wl_ok "streamed frame: $STREAMED" \
  || wl_warn "no streamed frame for $SHORT"

# ----------------------------------------- 3. the same frame with NO encoder
if WL_HERO_CAM=6 bash "$HERE/native-shot.sh"; then
  NATIVE="$(wl_find_first "$WL_PROOF/native" -name "*$SHORT*.png" | head -1 || true)"
  [ -n "${NATIVE:-}" ] && wl_ok "native frame: $NATIVE" || wl_warn "native shot produced nothing"
else
  wl_warn "native shot failed; the blur question stays open"
  NATIVE=""
fi

# --------------------------------------------------- 4. renderer vs encoder
if [ -n "${NATIVE:-}" ] && [ -n "${STREAMED:-}" ]; then
  python3 "$HERE/../build/compare-native-stream.py" "$NATIVE" "$STREAMED" \
    | tee "$WL_ANSWERS/sharpness-$SHORT.txt" || true
fi

# ------------------------------------- 5. what colour did the COOK ship?
# The one link in the chain nobody has read. Two lines settle it.
RUNLOG="$(wl_find_first "$WL_OUT/Linux/Wonderland/Saved/Logs" -name "Wonderland*.log" | head -1 || true)"
if [ -n "${RUNLOG:-}" ]; then
  grep -E "MATERIAL_RUNTIME|WONDERLAND BATCH" "$RUNLOG" \
    > "$WL_ANSWERS/materials-$SHORT.txt" 2>/dev/null || true
  wl_say "the palette the PACKAGED build carries:"
  grep -E "MATERIAL_RUNTIME" "$RUNLOG" | sed 's/.*MATERIAL_RUNTIME/  /' | head -6 || \
    wl_warn "no MATERIAL_RUNTIME lines - is this build older than the probe?"
else
  wl_warn "no runtime log found; the colour question stays open"
fi

wl_ok "session complete - artefacts under $WL_ANSWERS"
wl_say "  the world's colour   : $WL_ANSWERS/materials-$SHORT.txt"
wl_say "  renderer vs encoder  : $WL_ANSWERS/sharpness-$SHORT.txt"
wl_say "  streamed hero frame  : ${STREAMED:-none}"
wl_say "  native hero frame    : ${NATIVE:-none}"
