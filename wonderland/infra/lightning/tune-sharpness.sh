#!/usr/bin/env bash
# Find the resolution and settings that make Wonderland SHARP, from measurements.
#
#   bash wonderland/infra/lightning/tune-sharpness.sh
#
# The founder's note is that the result is "too blurry, too soft, too smeared,
# not 3D enough, not crisp enough for 4K". Every one of those words describes
# the same measurable thing — how much neighbouring pixels differ — and none of
# them can be settled by looking at one frame and forming an impression.
#
# So each candidate is captured and scored by ACUTANCE: the mean absolute luma
# gradient over a fixed region. Blur, soft upscaling and over-smoothed temporal
# AA all lower it; readable edges, distinct tower silhouettes and material
# separation all raise it. Brightness does not move it, which matters because the
# backdrop gain changes brightness a great deal and would otherwise be mistaken
# for detail.
#
# It also records FPS at each step, because "sharper" that cannot hold a frame
# rate is not a presentation, and the goal's floor is 30 FPS.
#
# ONE TRAP, ALREADY PAID FOR: shot.cjs used a hardcoded 1280x720 viewport, so a
# 4K stream was resampled into a 720p PNG. Measuring sharpness off that measures
# the resampler. It now follows WL_RES_X/WL_RES_Y and says so when the stream and
# the viewport disagree.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

CAM="${WL_SHARP_CAM:-6}"
OUT="${WL_SHARP_DIR:-$WL_PROOF/sharpness}"
MEASURE="$HERE/../build/measure-frame-region.py"
RESULTS="$OUT/sharpness.tsv"
# Candidates: "label:resx:resy:execcmds". The exec list is applied live.
CANDIDATES="${WL_SHARP_CANDIDATES:-
720p:1280:720:
1080p:1920:1080:
1440p:2560:1440:
2160p:3840:2160:
}"

mkdir -p "$OUT"
: > "$RESULTS"
printf 'label\tres\tacutance\tluma\tfps_mean\tframe\n' >> "$RESULTS"

for cand in $CANDIDATES; do
  label="${cand%%:*}"; rest="${cand#*:}"
  rx="${rest%%:*}"; rest="${rest#*:}"
  ry="${rest%%:*}"; execs="${rest#*:}"
  [ -n "$label" ] || continue
  wl_say "sharpness candidate $label at ${rx}x${ry}"
  rm -rf "$OUT/$label"
  if ! WL_HERO_CAMS="$CAM" WL_MEASURE_SECONDS=12 WL_CAPTURE_DIR="$OUT/$label" \
       WL_RES_X="$rx" WL_RES_Y="$ry" \
       ${execs:+WL_EXEC_CMDS="$execs"} \
       bash "$HERE/capture-hero-shots.sh" >"$WL_LOG/sharp-$label.log" 2>&1; then
    wl_warn "$label: capture failed, see $WL_LOG/sharp-$label.log"
    continue
  fi
  png="$(wl_find_first "$OUT/$label" -maxdepth 1 -name '*.png' -type f)"
  [ -n "${png:-}" ] || { wl_warn "$label: no frame"; continue; }

  # A resampled PNG measures the resampler, not the renderer. Refuse it.
  if grep -aq "RESAMPLED" "$WL_LOG/sharp-$label.log" 2>/dev/null; then
    wl_warn "$label: the capture was RESAMPLED — not scored"
    continue
  fi

  # The SAME fraction of the frame at every resolution, or acutance is being
  # compared across different crops and means nothing.
  rw=$(( rx * 3 / 8 )); rh=$(( ry * 5 / 12 ))
  rxo=$(( (rx - rw) / 2 )); ryo=$(( ry / 12 ))
  line="$(python3 "$MEASURE" "$png" "$rxo" "$ryo" "$rw" "$rh" 2>/dev/null)" || continue
  acut="$(printf '%s' "$line" | sed -n 's/.*acutance=\([0-9.]*\).*/\1/p')"
  luma="$(printf '%s' "$line" | sed -n 's/.*luma=\([0-9.]*\).*/\1/p')"
  fps="$(python3 - "${png%.png}.stream.json" <<'PY' 2>/dev/null || echo ""
import json, sys
try:
    d = json.load(open(sys.argv[1]))
    print("%.1f" % (d.get("delivered", {}).get("fps_mean") or 0.0))
except Exception:
    print("")
PY
)"
  printf '%s\t%sx%s\t%s\t%s\t%s\t%s\n' "$label" "$rx" "$ry" "$acut" "$luma" "$fps" "$png" >> "$RESULTS"
  printf '  %-8s %-10s acutance %-8s luma %-7s fps %s\n' "$label" "${rx}x${ry}" "$acut" "$luma" "$fps"
done

printf '\n== sharpness ==\n'
column -t "$RESULTS" 2>/dev/null || cat "$RESULTS"
python3 - "$RESULTS" <<'PY'
import io, sys
rows = [l.split('\t') for l in io.open(sys.argv[1], encoding='utf8').read().splitlines()[1:] if l.strip()]
if not rows:
    print("\nVERDICT: nothing scored. The captures failed; the settings are unproven.")
    raise SystemExit
best = max(rows, key=lambda r: float(r[2] or 0))
ok30 = [r for r in rows if r[4] and float(r[4]) >= 30.0]
print()
print("sharpest scored: %s at %s, acutance %s, %s FPS" % (best[0], best[1], best[2], best[4] or "?"))
if ok30:
    keep = max(ok30, key=lambda r: float(r[2] or 0))
    print("sharpest that still holds 30 FPS: %s at %s, acutance %s, %s FPS"
          % (keep[0], keep[1], keep[2], keep[4]))
else:
    print("NOTHING held 30 FPS. Sharper that cannot hold a frame rate is not a presentation.")
PY
