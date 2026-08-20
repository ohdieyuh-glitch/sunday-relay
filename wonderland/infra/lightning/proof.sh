#!/usr/bin/env bash
# ONE COMMAND: turn a Wonderland run into a founder proof report.
#
#   bash wonderland/infra/lightning/proof.sh
#
# Reads what the run actually left behind — packaged build, logs, hero frames,
# the URL file, live ports, nvidia-smi — and reports PASS / FAIL / UNVERIFIED
# for each item, then the highest assurance rung the EVIDENCE supports.
#
# UNVERIFIED IS A FIRST-CLASS ANSWER and most of the value of this file. "We did
# not measure it" and "it failed" are different facts, and collapsing them is
# how a report becomes a story. Nothing here infers a value from configuration:
# if the runtime did not expose an FPS counter, this says so rather than
# quoting a number from somewhere else.
#
# Runs on CPU. Needs no GPU. Safe to run while a stream is up.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUTDIR="${WL_PROOF:-$WL_ROOT/proof}"
mkdir -p "$OUTDIR" 2>/dev/null || true
REPORT="$OUTDIR/proof-$STAMP.txt"

PASS_N=0; FAIL_N=0; UNV_N=0
declare -a LINES=()

# item <PASS|FAIL|UNVERIFIED> <name> <detail...>
item() {
  local v="$1"; shift
  local name="$1"; shift
  local detail="$*"
  case "$v" in
    PASS)       PASS_N=$((PASS_N + 1)) ;;
    FAIL)       FAIL_N=$((FAIL_N + 1)) ;;
    *)          UNV_N=$((UNV_N + 1)); v="UNVERIFIED" ;;
  esac
  LINES+=("$(printf '  %-11s %-26s %s' "$v" "$name" "$detail")")
}

# Substring test without a pipe: `grep -q` in a pipeline under pipefail reports
# the writer's SIGPIPE as failure and inverts the answer.
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# Newest file matching a glob, or empty. Avoids `ls | head`, which is both
# fragile on odd names and a pipefail hazard.
newest() {
  local best="" f
  for f in $1; do
    [ -e "$f" ] || continue
    if [ -z "$best" ] || [ "$f" -nt "$best" ]; then best="$f"; fi
  done
  printf '%s' "$best"
}

# Seconds between two log lines' mtimes is meaningless; durations come from the
# run's own markers where it wrote them, and are UNVERIFIED otherwise.
dur_from() {   # $1 = file with a single integer of seconds
  [ -f "$1" ] || return 1
  local v; v="$(cat "$1" 2>/dev/null)"
  case "$v" in ''|*[!0-9]*) return 1 ;; esac
  printf '%s' "$v"
}

# ------------------------------------------------------------ provenance
GIT_SHA="unknown"
if command -v git >/dev/null 2>&1 && [ -d "$WL_SRC/.git" ]; then
  GIT_SHA="$(git -C "$WL_SRC" rev-parse HEAD 2>/dev/null || echo unknown)"
elif command -v git >/dev/null 2>&1 && git -C "$HERE" rev-parse HEAD >/dev/null 2>&1; then
  GIT_SHA="$(git -C "$HERE" rev-parse HEAD)"
fi
if [ "$GIT_SHA" = "unknown" ]; then
  item UNVERIFIED "git sha" "no git checkout found"
else
  item PASS "git sha" "$GIT_SHA"
fi

# ------------------------------------------------------------ the engine
UE_VER="unknown"
BV="$WL_UE/Engine/Build/Build.version"
if [ -f "$BV" ]; then
  _maj="$( ( set +o pipefail; grep -o '"MajorVersion"[[:space:]]*:[[:space:]]*[0-9]*' "$BV" | grep -o '[0-9]*$' | head -1 ) || true)"
  _min="$( ( set +o pipefail; grep -o '"MinorVersion"[[:space:]]*:[[:space:]]*[0-9]*' "$BV" | grep -o '[0-9]*$' | head -1 ) || true)"
  [ -n "${_maj:-}" ] && [ -n "${_min:-}" ] && UE_VER="${_maj}.${_min}"
fi
if [ "$UE_VER" = "unknown" ] && command -v docker >/dev/null 2>&1 \
   && docker image inspect "$WL_UE_IMAGE" >/dev/null 2>&1; then
  UE_VER="image:$WL_UE_IMAGE"
fi
case "$UE_VER" in
  5.8|image:*5.8*) item PASS "unreal version" "$UE_VER" ;;
  unknown)         item UNVERIFIED "unreal version" "no Build.version and no loaded image" ;;
  *)               item FAIL "unreal version" "$UE_VER (expected 5.8)" ;;
esac

# ---------------------------------------------------------------- the gpu
if wl_have_gpu; then
  GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"
  item PASS "gpu" "${GPU_NAME:-present}"
  VRAM="$(nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader 2>/dev/null | head -1)"
  if [ -n "${VRAM:-}" ]; then item PASS "vram" "$VRAM"; else item UNVERIFIED "vram" "nvidia-smi gave no memory line"; fi
  UTIL="$(nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader 2>/dev/null | head -1)"
  [ -n "${UTIL:-}" ] && item PASS "gpu utilisation" "$UTIL" || item UNVERIFIED "gpu utilisation" "not reported"
else
  item UNVERIFIED "gpu" "nvidia-smi absent or reports none (expected when on CPU)"
  item UNVERIFIED "vram" "no GPU to measure"
  item UNVERIFIED "gpu utilisation" "no GPU to measure"
fi

if [ -r /proc/meminfo ]; then
  MEMT="$(awk '/MemTotal/{printf "%.1f GB", $2/1048576}' /proc/meminfo 2>/dev/null)"
  MEMA="$(awk '/MemAvailable/{printf "%.1f GB", $2/1048576}' /proc/meminfo 2>/dev/null)"
  item PASS "host ram" "${MEMA:-?} available of ${MEMT:-?}"
else
  item UNVERIFIED "host ram" "/proc/meminfo unreadable"
fi

# ------------------------------------------------------- the packaged build
STAGED="$WL_OUT/Linux"
APP="$(newest "$STAGED/*/Binaries/Linux/Wonderland")"
[ -n "$APP" ] || APP="$(newest "$STAGED/Wonderland.sh")"
if [ -d "$STAGED" ] && [ -n "$(ls -A "$STAGED" 2>/dev/null || true)" ]; then
  SZ="$(du -sh "$STAGED" 2>/dev/null | cut -f1)"
  item PASS "packaged build" "$STAGED (${SZ:-size unknown})"
else
  item FAIL "packaged build" "nothing staged at $STAGED"
fi

# ------------------------------------------------------------------- logs
BUILD_LOG="$WL_LOG/build.log"
APP_LOG="$WL_LOG/app.log"
SIG_LOG="$WL_LOG/sig.log"

if [ -f "$BUILD_LOG" ]; then
  if grep -qa "packaged Wonderland" "$BUILD_LOG" 2>/dev/null; then
    item PASS "build completed" "build.log reports a packaged Wonderland"
  else
    LASTB="$(tail -1 "$BUILD_LOG" 2>/dev/null | cut -c1-90)"
    item FAIL "build completed" "no completion line; last: ${LASTB:-<empty>}"
  fi
else
  item UNVERIFIED "build completed" "no $BUILD_LOG"
fi

# FATAL SCAN. Deliberately narrow: broad greps for "error" match UE's routine
# chatter and turn a real signal into noise nobody reads.
scan_fatal() {   # $1 = log
  [ -f "$1" ] || { printf 'nolog'; return; }
  local n
  n="$(grep -ac -E 'Fatal error|LogWindows: Error|Assertion failed|BUILD FAILED|AutomationTool exiting with ExitCode=[1-9]' "$1" 2>/dev/null || true)"
  case "$n" in ''|*[!0-9]*) n=0 ;; esac
  printf '%s' "$n"
}
for L in "$BUILD_LOG" "$APP_LOG" "$SIG_LOG"; do
  NAME="$(basename "$L")"
  R="$(scan_fatal "$L")"
  if [ "$R" = "nolog" ]; then
    item UNVERIFIED "fatal scan: $NAME" "log absent"
  elif [ "$R" = "0" ]; then
    item PASS "fatal scan: $NAME" "no fatal signatures"
  else
    item FAIL "fatal scan: $NAME" "$R fatal signature(s) — see $L"
  fi
done

# -------------------------------------------------------------- the stream
if wl_port_listening "$WL_HTTP_PORT"; then
  item PASS "signalling http" "listening on $WL_HTTP_PORT"
else
  item FAIL "signalling http" "nothing listening on $WL_HTTP_PORT"
fi
if wl_port_listening "$WL_STREAMER_PORT"; then
  item PASS "streamer socket" "listening on $WL_STREAMER_PORT"
else
  item FAIL "streamer socket" "nothing listening on $WL_STREAMER_PORT"
fi
if wl_port_listening "$WL_TURN_PORT"; then
  item PASS "turn relay" "listening on $WL_TURN_PORT"
else
  item UNVERIFIED "turn relay" "not listening; same-host viewing may still work"
fi

if [ -f "$APP_LOG" ] && grep -qaE "Local participant joined the room|Streamer .* connected" "$APP_LOG" 2>/dev/null; then
  item PASS "streamer connected" "the client joined signalling"
elif [ -f "$APP_LOG" ]; then
  item UNVERIFIED "streamer connected" "no join line in app.log"
else
  item UNVERIFIED "streamer connected" "no app.log"
fi

URL_FILE="$WL_RUN/player-url.txt"
URL=""
if [ -f "$URL_FILE" ]; then
  URL="$(cat "$URL_FILE" 2>/dev/null)"
fi
if [ -n "$URL" ]; then
  item PASS "browser url" "$URL"
else
  item UNVERIFIED "browser url" "no $URL_FILE (tunnel off, or the Ports panel was used)"
fi

# ---------------------------------------------------------- the hero frame
FRAME="${1:-}"
[ -n "$FRAME" ] || FRAME="$(newest "$WL_PROOF/hero-*.png")"
[ -n "$FRAME" ] || FRAME="$(newest "$WL_PROOF/*.png")"
FRAME_VERDICT="UNVERIFIED"
if [ -n "$FRAME" ] && [ -f "$FRAME" ] && command -v python3 >/dev/null 2>&1; then
  FC="$(python3 "$HERE/frame-check.py" "$FRAME" 2>/dev/null)"
  fv() { case "$FC" in *"$1="*) printf '%s' "${FC#*$1=}" | head -1 ;; esac; }
  W="$(fv width)"; H="$(fv height)"; V="$(fv verdict)"
  LM="$(fv luma_mean)"; LS="$(fv luma_sd)"; NOTE="$(fv note)"
  item PASS "hero frame present" "$FRAME"
  if [ -n "${W:-}" ] && [ -n "${H:-}" ]; then
    item PASS "hero frame size" "${W}x${H}"
  else
    item FAIL "hero frame size" "could not read dimensions"
  fi
  case "$V" in
    STRUCTURED)
      FRAME_VERDICT="STRUCTURED"
      item PASS "hero frame structure" "luma ${LM:-?} sd ${LS:-?} — real image structure"
      ;;
    FAIL)
      item FAIL "hero frame structure" "${NOTE:-no structure}"
      ;;
    *)
      item UNVERIFIED "hero frame structure" "${NOTE:-frame-check gave no verdict}"
      ;;
  esac
elif [ -n "$FRAME" ]; then
  item UNVERIFIED "hero frame present" "$FRAME (no python3 to inspect it)"
else
  item FAIL "hero frame present" "no hero frame under $WL_PROOF"
fi
# NEVER PROVEN FROM NUMBERS. Stated as an item so it appears in the report the
# founder reads, not only in a comment they do not.
item UNVERIFIED "visual vs reference" \
  "requires founder to LOOK at the PNG; luma and variance cannot judge this"

# ---------------------------------------------------------------- the world
ACTORS=""
if [ -f "$BUILD_LOG" ]; then
  ACTORS="$( ( set +o pipefail; grep -ao 'WORLD REPORT[^|]*' "$BUILD_LOG" | tail -1 ) || true)"
fi
if [ -n "${ACTORS:-}" ]; then
  item PASS "world report" "$(printf '%s' "$ACTORS" | cut -c1-90)"
else
  item UNVERIFIED "world report" "no WORLD REPORT line in build.log"
fi

# ------------------------------------------------------------- durations
for pair in "build:build-seconds" "stream:stream-seconds" "startup:startup-seconds"; do
  k="${pair%%:*}"; f="${pair#*:}"
  if D="$(dur_from "$WL_RUN/$f")"; then
    item PASS "$k duration" "${D}s"
  else
    item UNVERIFIED "$k duration" "the run did not record $WL_RUN/$f"
  fi
done

# FPS. Only if the runtime actually exposed it. Wonderland does not currently
# log a frame time, so this is expected to be UNVERIFIED until it does — which
# is a truthful gap, not a failure.
FPS=""
if [ -f "$APP_LOG" ]; then
  FPS="$( ( set +o pipefail; grep -aoE '[0-9]+(\.[0-9]+)? ?(fps|FPS)' "$APP_LOG" | tail -1 ) || true)"
fi
if [ -n "${FPS:-}" ]; then
  item PASS "frame rate" "$FPS (from app.log)"
else
  item UNVERIFIED "frame rate" "the packaged runtime does not log FPS; measure in the browser's stats panel"
fi

# ------------------------------------------------------- the assurance rung
#
# SPECIFIED  designed
# IMPLEMENTED code exists
# COMPILED   it built
# RUNNING    a process is up
# STREAMED   a frame travelled the wire and had structure
# DEPLOYED   a URL a person can open
# PROVEN     a human confirmed it against the reference   <- never automatic
RUNG="SPECIFIED"
[ -f "$WL_SRC/wonderland/Wonderland.uproject" ] || [ -f "$HERE/../../Wonderland.uproject" ] && RUNG="IMPLEMENTED"
if [ -d "$STAGED" ] && [ -n "$(ls -A "$STAGED" 2>/dev/null || true)" ]; then RUNG="COMPILED"; fi
if wl_port_listening "$WL_HTTP_PORT" && wl_port_listening "$WL_STREAMER_PORT"; then RUNG="RUNNING"; fi
if [ "$RUNG" = "RUNNING" ] && [ "$FRAME_VERDICT" = "STRUCTURED" ]; then RUNG="STREAMED"; fi
if [ "$RUNG" = "STREAMED" ] && [ -n "$URL" ]; then RUNG="DEPLOYED"; fi
# PROVEN is deliberately unreachable from here.

# ------------------------------------------------------------------ report
{
  echo "WONDERLAND PROOF  $STAMP"
  echo "root $WL_ROOT"
  echo
  for l in "${LINES[@]}"; do echo "$l"; done
  echo
  printf '  %d PASS   %d FAIL   %d UNVERIFIED\n' "$PASS_N" "$FAIL_N" "$UNV_N"
  echo
  echo "  ASSURANCE: $RUNG"
  echo "  PROVEN is not reachable from this report. It requires the founder to"
  echo "  open the hero PNG and judge it against the reference image."
} | tee "$REPORT"

echo
wl_say "written to $REPORT"
[ "$FAIL_N" -eq 0 ]
