#!/usr/bin/env bash
# Find the Marble backdrop's brightness from FRAMES, in one GPU session.
#
#   bash wonderland/infra/lightning/tune-marble-gain.sh
#
# WHY THIS IS A SCRIPT AND NOT A CONVERSATION
#
# The backdrop is present, correctly placed and correctly oriented, and renders
# near-black. Four captures established that it is neither occluded nor missing
# nor mis-placed nor re-lit: with ShowFlag.PostProcessing 0 the castle city is
# plainly visible while the authored world blows out. Marble's texture is an
# already-exposed photograph in roughly 0..1 and the authored world is lit far
# above that, so auto-exposure satisfies the world and crushes the shell.
#
# What is NOT known is the multiplier, and it cannot be reasoned to: brightening
# the shell raises the frame's average luminance, which pulls auto-exposure back
# down. It is a fixed point, so it has to be searched — and every step of that
# search is a GPU minute. Doing it by hand, one ssh command at a time, spends
# more of them on round trips than on rendering.
#
# So: sweep, measure, decide, then capture the pair at the chosen value. One
# command, one session, and a table at the end instead of an impression.
#
# It measures with the SKY BAND, and there is a trap in that. At default
# settings the top of the frame is FOG, not Marble — a 6x gain moved that band
# by 5% because fog is what was in the sample. Each gain is therefore captured
# twice: once as the world really renders, and once with fog off to isolate the
# shell's own contribution. If the fog-off number climbs with gain and the
# fog-on number does not, the answer is not brightness at all — it is that fog
# is painting over a backdrop 615 m away, which is an art decision and not a
# bug, and the report says so rather than turning the gain up further.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

GAINS="${WL_GAIN_SWEEP:-1 20 100 500}"
CAM="${WL_TUNE_CAM:-6}"
OUT="${WL_TUNE_DIR:-$WL_PROOF/gain-sweep}"
# The sky band: upper-middle, clear of the authored gold structures at the sides.
REGION="${WL_TUNE_REGION:-520 40 360 110}"
MEASURE="$HERE/../build/measure-frame-region.py"
RESULTS="$OUT/sweep.tsv"

mkdir -p "$OUT"
: > "$RESULTS"
printf 'gain\tfog\tmean_r\tmean_g\tmean_b\tluma\tframe\n' >> "$RESULTS"

shoot() {                       # $1 gain, $2 fog(on|off)
  local gain="$1" fog="$2" extra="" tag
  tag="g${gain}-fog${fog}"
  [ "$fog" = "off" ] && extra=",ShowFlag.Fog 0,ShowFlag.AtmosphericFog 0,ShowFlag.VolumetricFog 0"
  rm -rf "$OUT/$tag"
  if ! WL_HERO_CAMS="$CAM" WL_MEASURE_SECONDS=5 WL_CAPTURE_DIR="$OUT/$tag" \
       WL_EXEC_CMDS="wonderland.MarbleGain ${gain}${extra}" \
       bash "$HERE/capture-hero-shots.sh" >"$WL_LOG/tune-$tag.log" 2>&1; then
    wl_warn "gain $gain fog $fog: capture failed, see $WL_LOG/tune-$tag.log"
    return 1
  fi
  local png
  png="$(wl_find_first "$OUT/$tag" -maxdepth 1 -name '*.png' -type f)"
  [ -n "${png:-}" ] || { wl_warn "gain $gain fog $fog: no frame"; return 1; }

  # THE COMMAND HAS TO HAVE TAKEN. It reports by readback; a run where it did
  # not is not a data point about brightness, and recording it as one is how a
  # flat sweep gets blamed on the wrong thing.
  if grep -aq "MARBLE_RUNTIME_GAIN_FAILED" "$WL_LOG/app.log" 2>/dev/null; then
    wl_warn "gain $gain fog $fog: the runtime gain did NOT take — not recorded"
    return 1
  fi
  local line rgb
  line="$(python3 "$MEASURE" "$png" $REGION 2>/dev/null)" || return 1
  rgb="$(printf '%s' "$line" | sed -n 's/.*mean_rgb=\([0-9.]*\),\([0-9.]*\),\([0-9.]*\) luma=\([0-9.]*\).*/\1\t\2\t\3\t\4/p')"
  printf '%s\t%s\t%s\t%s\n' "$gain" "$fog" "$rgb" "$png" >> "$RESULTS"
  wl_say "gain %-5s fog %-3s -> %s" >/dev/null 2>&1 || true
  printf '  gain %-5s fog %-3s  %s\n' "$gain" "$fog" "$rgb"
  return 0
}

wl_say "sweeping Marble gain: $GAINS  (camera $CAM, region $REGION)"
for g in $GAINS; do
  shoot "$g" "on"  || true
  shoot "$g" "off" || true
done

printf '\n== sweep ==\n'
column -t "$RESULTS" 2>/dev/null || cat "$RESULTS"

python3 - "$RESULTS" <<'PY'
import io, sys
rows = [l.split('\t') for l in io.open(sys.argv[1], encoding='utf8').read().splitlines()[1:] if l.strip()]
def series(fog):
    return sorted(((float(r[0]), float(r[5])) for r in rows if r[1] == fog), key=lambda t: t[0])
on, off = series('on'), series('off')
def spread(s):
    return (max(v for _, v in s) - min(v for _, v in s)) if len(s) > 1 else 0.0
print()
if not off:
    print("VERDICT: no fog-off samples — the sweep could not isolate the shell.")
elif spread(off) < 2.0:
    print("VERDICT: the shell's own contribution did NOT move across the sweep "
          "(fog-off luma spread %.1f). The runtime gain is not reaching the "
          "rendered pixels; do not turn it up further, find out why first." % spread(off))
elif spread(on) < 2.0:
    print("VERDICT: the shell brightens (fog-off spread %.1f) but the frame does "
          "NOT (fog-on spread %.1f). FOG is painting over a backdrop 615 m away. "
          "That is an art decision about fog, not a brightness bug, and no gain "
          "fixes it." % (spread(off), spread(on)))
else:
    best = max(on, key=lambda t: t[1])
    print("VERDICT: gain moves the real frame. Best sampled gain %g at luma %.1f "
          "(fog-on). Capture the pair there." % best)
PY

printf '\nNext, the pair at the chosen gain:\n'
printf '  WL_HERO_CAMS="0 6" WL_EXEC_CMDS="wonderland.MarbleGain <g>" \\\n'
printf '    bash wonderland/infra/lightning/capture-hero-shots.sh\n'
