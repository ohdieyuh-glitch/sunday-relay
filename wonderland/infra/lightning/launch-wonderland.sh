#!/usr/bin/env bash
# ONE COMMAND. Lightning GPU on -> Wonderland open in the founder's browser.
#
#   bash wonderland/infra/lightning/launch-wonderland.sh
#
# Everything is idempotent and re-runnable. If prepare.sh already ran, the
# expensive CPU work is skipped; if the build inputs have not changed, the cook
# is skipped too. Re-running after a crash costs seconds, not a rebuild.
#
# It refuses to burn GPU time on avoidable work: the gates, the textures and
# the audio all run on CPU first, and if any of them fail it stops BEFORE the
# cook rather than after it.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

# WHEN THIS RUN STARTED. Stage 7 uses it to refuse a hero frame that predates
# the run — a previous run's PNG sitting in $WL_PROOF would otherwise satisfy
# VERIFY and let 8/8 announce a stream that never rendered anything today.
RUN_STARTED_EPOCH="$(date +%s)"
SKIP_BUILD="${SKIP_BUILD:-0}"
# Set by compile-preflight.sh's suggested follow-up: the CPU machine already
# fetched the source, installed the packages and generated the textures and
# audio, so the GPU session does not have to pay for any of it again.
SKIP_PREPARE="${SKIP_PREPARE:-0}"
SKIP_SHOT="${SKIP_SHOT:-0}"
START=$(date +%s)

banner() { printf '\n\033[1;35m========== %s ==========\033[0m\n' "$1"; }

# ------------------------------------------------------------ 1. the machine
banner "1/8  MACHINE"
if ! wl_have_gpu; then
  wl_warn "nvidia-smi reports no GPU."
  wl_warn "Switch the Lightning Studio to a GPU machine, then re-run this."
  exit 2
fi
nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | sed 's/^/  GPU: /'
wl_mkdirs

DISK_GB=$(df -BG --output=avail "$WL_ROOT" 2>/dev/null | tail -1 | tr -dc '0-9' || echo 0)
RAM_GB=$(awk '/MemTotal/ {printf "%d", $2/1048576}' /proc/meminfo 2>/dev/null || echo 0)
echo "  disk free: ${DISK_GB} GB    RAM: ${RAM_GB} GB    cpus: $(nproc)"
# A cook needs real room. The last host lost an export to a 261 GiB sparse
# intermediate, so this is a hard floor rather than a suggestion.
[ "${DISK_GB:-0}" -ge "$WL_MIN_DISK_GB" ] \
  || wl_die "only ${DISK_GB} GB free under $WL_ROOT; a UE 5.8 cook needs ${WL_MIN_DISK_GB}+ GB"
[ "${RAM_GB:-0}"  -ge "$WL_MIN_RAM_GB" ] \
  || wl_warn "only ${RAM_GB} GB RAM; shader compilation may thrash"

# ------------------------------------------------------------ 2. the engine
banner "2/8  UNREAL 5.8"
# BEFORE prepare.sh, deliberately. Lightning has already discarded the local
# Docker image once across a machine change, and prepare.sh would otherwise
# report the engine unavailable and send the founder to relink Epic and
# re-download 69 GB — with a verified archive sitting on the same disk.
#
# This never reaches the network. A missing image plus a missing archive is a
# failure to report, not a problem to solve by downloading Unreal onto a
# running GPU.
wl_ensure_ue_image

# ------------------------------------------------- 3. source, gates, assets
banner "3/8  PREPARE (cpu)"
if [ "$SKIP_PREPARE" = "1" ]; then
  wl_say "SKIP_PREPARE=1 — using the source and assets already staged"
  [ -f "$WL_RUN/prepared.stamp" ] || wl_die "SKIP_PREPARE=1 but nothing has been prepared here"
else
  bash "$HERE/prepare.sh"
  [ -f "$WL_RUN/prepared.stamp" ] || wl_die "prepare.sh did not complete"
fi
# SAY WHAT IS ABOUT TO BE BUILT, at the top, in full.
#
# The regression this closes: prepare.sh silently reset the source to a stale
# default branch, so an L4 session compiled, packaged, streamed and MEASURED a
# world whose source did not contain the code under test — and every stage
# reported success. The number a session produces has to be attributable to a
# commit, and the only way that holds is if the commit is printed before the
# work rather than reconstructed afterwards.
wl_verify_source "launch"

# ------------------------------------------------------------- 3. the build
banner "4/8  BUILD + COOK"
if [ "$SKIP_BUILD" = "1" ]; then
  wl_say "SKIP_BUILD=1 — using whatever is already staged"
else
  bash "$HERE/build-render.sh"
fi

# ------------------------------------------------------------ 4. the stream
banner "5/8  STREAM UP"
bash "$HERE/stop-wonderland.sh" --quiet >/dev/null 2>&1 || true
bash "$HERE/run-stream.sh"

# ------------------------------------------------------ 5. the hero frame
banner "6/8  HERO FRAME"
SHOT="$WL_PROOF/hero-$(date -u +%Y%m%dT%H%M%SZ).png"
if [ "$SKIP_SHOT" = "1" ]; then
  wl_say "SKIP_SHOT=1"
else
  # PICK A NODE THAT CAN ACTUALLY LOAD PLAYWRIGHT.
  #
  # The engine's bundled node is the right choice for the SIGNALLING server —
  # the system one is usually too old for it. It is the wrong choice here:
  # playwright is installed into $WL_TOOLS by the system npm, and loading it
  # under a different node build fails on native bindings. Two jobs, two
  # answers, and taking the signalling answer for the capture is how stage 6
  # fails on a machine where everything is installed correctly.
  #
  # So: ask each candidate whether it can require playwright, and believe the
  # answer rather than assuming one.
  NODE=""
  for _cand in "$(command -v node || true)" "$(wl_bundled_node)"; do
    [ -n "$_cand" ] || continue
    if "$_cand" -e "require('${WL_TOOLS}/node_modules/playwright')" >/dev/null 2>&1 \
       || "$_cand" -e "require('playwright')" >/dev/null 2>&1; then
      NODE="$_cand"; break
    fi
  done
  # Nothing could load it — fall back so the failure comes from shot.cjs, which
  # explains what to do, rather than from an empty variable here.
  [ -n "$NODE" ] || NODE="$(command -v node || true)"
  [ -n "$NODE" ] || NODE="$(wl_bundled_node)"
  if [ -z "$NODE" ]; then
    wl_warn "no node available; cannot capture the hero frame"
  else
    ( cd "$HERE" && "$NODE" shot.cjs "http://127.0.0.1:$WL_HTTP_PORT/" "$SHOT" ) \
      && wl_ok "hero frame: $SHOT" \
      || wl_warn "capture reported a problem — the stream may still be fine for a human"
    [ -f "$SHOT" ] && ln -sf "$SHOT" "$WL_PROOF/hero-latest.png"
  fi
fi

# --------------------------------------------------- 6. is it really drawing
banner "7/8  VERIFY"
# "It is running" is not "it is rendering". A packaged client with a dead
# renderer holds the port open and logs nothing wrong, so check the frame
# itself: a real Wonderland frame is neither uniformly black nor uniformly one
# colour. This is the cheapest honest test available without a human eye.
# FRESHNESS FIRST. A frame from an earlier run is not evidence about this one,
# and it is exactly what would be lying around after a capture failure.
if [ -f "$SHOT" ]; then
  _shot_mtime="$(stat -c %Y "$SHOT" 2>/dev/null || echo 0)"
  if [ "${_shot_mtime:-0}" -lt "$RUN_STARTED_EPOCH" ]; then
    wl_warn "hero frame $SHOT predates this run — refusing to verify a stale artifact"
    SHOT=""
  fi
fi
if [ -n "${SHOT:-}" ] && [ -f "$SHOT" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$SHOT" <<'PYEOF' || wl_warn "frame check inconclusive"
import sys, zlib, struct
p = sys.argv[1]
d = open(p, 'rb').read()
if not d.startswith(b'\x89PNG'):
    print("  frame is not a PNG"); sys.exit(1)
# minimal PNG reader: IHDR + concatenated IDAT, no external deps
i, w, h, idat = 8, 0, 0, b''
while i < len(d):
    ln = struct.unpack('>I', d[i:i+4])[0]; typ = d[i+4:i+8]
    if typ == b'IHDR': w, h, bd, ct = struct.unpack('>IIBB', d[i+8:i+18])
    elif typ == b'IDAT': idat += d[i+8:i+8+ln]
    i += 12 + ln
raw = zlib.decompress(idat)
ch = {0:1, 2:3, 3:1, 4:2, 6:4}[ct]
stride = w * ch
prev = bytearray(stride); vals = []
pos = 0
for y in range(h):
    f = raw[pos]; pos += 1
    line = bytearray(raw[pos:pos+stride]); pos += stride
    for x in range(stride):
        a = line[x-ch] if x >= ch else 0
        b = prev[x]; c = prev[x-ch] if x >= ch else 0
        if   f == 1: line[x] = (line[x] + a) & 255
        elif f == 2: line[x] = (line[x] + b) & 255
        elif f == 3: line[x] = (line[x] + (a + b)//2) & 255
        elif f == 4:
            pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2*c)
            pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
            line[x] = (line[x] + pr) & 255
    if y % 7 == 0:
        vals.extend(line[k] for k in range(0, stride, ch * 11))
    prev = line
mean = sum(vals) / max(1, len(vals))
var = sum((v - mean) ** 2 for v in vals) / max(1, len(vals))
sd = var ** 0.5
print("  frame %dx%d  mean %.1f  sd %.1f" % (w, h, mean, sd))
if mean < 4:
    print("  BLACK FRAME - the stream connected but nothing rendered."); sys.exit(2)
if sd < 6:
    print("  FLAT FRAME - one colour; the renderer is up but drawing nothing."); sys.exit(3)
print("  frame has real structure - Wonderland is rendering.")
PYEOF
  RC=$?
  if [ "$RC" = 0 ]; then
    VERIFY_RESULT="structured"
    wl_ok "verified: the frame carries real image structure"
  else
    VERIFY_RESULT="FAILED (rc=$RC)"
    wl_warn "the captured frame did NOT pass the structure check (rc=$RC)"
  fi
fi

# ----------------------------------------------------------------- 7. the URL
# ---------------------------------------------- 8. earned, or not printed
#
# "WONDERLAND IS OPEN" was printed unconditionally: the launcher reached the end
# and said so. Every stage below it can fail softly — run-stream warns rather
# than dies when no streamer join line appears, the capture warns when it
# produces nothing — so the banner could announce a world that was never
# running to a founder who then opens a dead URL.
#
# Six pieces of evidence, each checked here rather than assumed from having got
# this far. Anything missing and this reports what IS true instead.
OPEN_FAILS=""
_need() { OPEN_FAILS="${OPEN_FAILS}${OPEN_FAILS:+, }$1"; }

[ -d "$WL_OUT/Linux" ] && [ -n "$(ls -A "$WL_OUT/Linux" 2>/dev/null || true)" ]   || _need "no packaged executable"
pgrep -f "[W]onderland.*PixelStreamingURL" >/dev/null 2>&1   || pgrep -x Wonderland >/dev/null 2>&1   || _need "the Wonderland process is not running"
wl_port_listening "$WL_HTTP_PORT" || _need "pixel streaming is not listening on $WL_HTTP_PORT"
if wl_http_ok "http://127.0.0.1:$WL_HTTP_PORT/" 10; then :; else _need "the player page did not answer"; fi
URL="$(cat "$WL_RUN/player-url.txt" 2>/dev/null || true)"
if [ -z "$URL" ]; then
  _need "no browser URL"
elif ! wl_http_ok "$URL" 20; then
  _need "the browser URL $URL is not reachable"
fi
[ -n "${SHOT:-}" ] && [ -f "${SHOT:-}" ] || _need "no hero frame from this run"
[ "${VERIFY_RESULT:-}" = "structured" ] || _need "verification did not pass"

if [ -n "$OPEN_FAILS" ]; then
  banner "8/8  NOT OPEN"
  wl_warn "Wonderland is NOT open. Missing: $OPEN_FAILS"
  wl_say "Logs for diagnosis without re-running the GPU:"
  wl_say "  $WL_LOG/build.log  $WL_LOG/app.log  $WL_LOG/sig.log  $WL_LOG/tunnel.log"
  wl_say "  then: bash $HERE/proof.sh"
else
  banner "8/8  WONDERLAND IS OPEN"
fi
ELAPSED=$(( $(date +%s) - START ))
echo
if [ -n "$URL" ]; then
  printf '\033[1;32m'
  echo "  ┌────────────────────────────────────────────────────────────┐"
  printf  "  │  WONDERLAND: %-45s │\n" "$URL"
  echo "  └────────────────────────────────────────────────────────────┘"
  printf '\033[0m'
else
  wl_warn "no public URL. Either set WL_PUBLIC=lightning and expose port"
  wl_warn "$WL_HTTP_PORT from the Studio's Ports panel, or check $WL_LOG/tunnel.log"
fi
# THE PHASE'S OWN COMPLETION CRITERIA, stated where they cannot be missed.
# A run can reach 8/8 with a URL and no hero frame — the capture only warns —
# and that reads as success while two criteria are unmet. Printing the list
# turns "it finished" into "here is what it actually produced".
echo
echo "  PHASE CRITERIA"
_c() { printf '    %-22s %s\n' "$1" "$2"; }
[ -d "$WL_OUT/Linux" ] && [ -n "$(ls -A "$WL_OUT/Linux" 2>/dev/null || true)" ] \
  && _c "packaged Wonderland" "yes" || _c "packaged Wonderland" "NO"
wl_port_listening "$WL_HTTP_PORT" && _c "pixel streaming" "up on $WL_HTTP_PORT" \
  || _c "pixel streaming" "NO"
[ -n "$URL" ] && _c "browser url" "yes" || _c "browser url" "NO"
[ -n "${SHOT:-}" ] && [ -f "${SHOT:-}" ] && _c "hero frame" "yes" || _c "hero frame" "NO"
_c "verification" "${VERIFY_RESULT:-not run}"
_c "runtime evidence" "run proof.sh for the full report"
echo
echo "  hero frame : ${SHOT:-none}"
echo "  logs       : $WL_LOG"
echo "  elapsed    : $((ELAPSED / 60))m $((ELAPSED % 60))s"
echo
wl_say "When you are done looking, STOP THE GPU:"
echo "     bash $HERE/stop-wonderland.sh"
