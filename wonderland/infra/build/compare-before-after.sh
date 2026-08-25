#!/usr/bin/env bash
# BEFORE / AFTER / REFERENCE, side by side, for the founder.
#
# The rebuild brief's acceptance test is the rendered image compared against
# the reference and against where the scene started -- not a number. This
# makes that comparison one command, so it is the FIRST thing produced when a
# frame lands rather than something assembled by hand afterwards.
#
#   compare-before-after.sh BEFORE.png AFTER.png REFERENCE.png OUT.png
#
# Each panel is scaled to the same height, labelled if drawtext is available
# (it is not on every ffmpeg build; the composite is still produced without
# labels, and says so), and the three are stacked left to right in the order
# the eye should read them: where it was, where it is, where it should be.
set -euo pipefail
BEFORE="$1"; AFTER="$2"; REF="$3"; OUT="$4"
H=720
label() {  # $1 in, $2 text, $3 out
  if ffmpeg -hide_banner -loglevel error -y -i "$1" \
       -vf "scale=-2:${H},drawtext=text='$2':x=16:y=16:fontsize=34:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=10" \
       "$3" 2>/dev/null; then return 0; fi
  ffmpeg -hide_banner -loglevel error -y -i "$1" -vf "scale=-2:${H}" "$3"
  echo "  (no drawtext on this ffmpeg; panel '$2' is unlabelled)" >&2
}
T=$(mktemp -d)
label "$BEFORE" "BEFORE" "$T/a.png"
label "$AFTER"  "AFTER"  "$T/b.png"
label "$REF"    "REFERENCE" "$T/c.png"
ffmpeg -hide_banner -loglevel error -y -i "$T/a.png" -i "$T/b.png" -i "$T/c.png" \
  -filter_complex "[0][1][2]hstack=inputs=3" "$OUT"
rm -rf "$T"
echo "wrote $OUT"
