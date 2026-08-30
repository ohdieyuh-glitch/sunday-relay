#!/usr/bin/env bash
# PUT THE LIVE TERMINAL ON THE PAGE THE FOUNDER ACTUALLY OPENS.
#
#   bash wonderland/web/player/install-overlay.sh [www_dir]
#
# The Pixel Streaming frontend is Epic's stock player.html plus a 2.5 MB
# bundle, and it lives OUTSIDE this repository in pixel-streaming-infra. A
# hand-edit there is invisible to git and is gone the next time the infra is
# restored, so the edit is this script instead: idempotent, checked, and
# re-runnable after any restore.
#
# What it does: copies the player module into www/wonderland/ and adds ONE
# module script tag to player.html. It does not touch Epic's bundle.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WWW="${1:-/teamspace/studios/this_studio/wonderland/pixel-streaming-infra/SignallingWebServer/www}"
TAG='<script type="module" src="wonderland/overlay.js"></script>'

[ -d "$WWW" ] || { echo "no www directory at $WWW"; exit 1; }
[ -f "$WWW/player.html" ] || { echo "no player.html in $WWW -- is this the signalling server's www?"; exit 1; }

mkdir -p "$WWW/wonderland"
for f in keys.js feed.js terminal.js mount.js overlay.js player.css; do
  cp "$HERE/$f" "$WWW/wonderland/$f"
done

# KEEP A PRISTINE COPY OF EPIC'S PAGE. Re-running against an already-patched
# page must not stack script tags, and a restore must be able to start clean.
[ -f "$WWW/player.html.orig" ] || cp "$WWW/player.html" "$WWW/player.html.orig"
cp "$WWW/player.html.orig" "$WWW/player.html"

# AFTER player.js, so the stream client has registered its own listeners
# before ours goes on in the capture phase and gets there first anyway.
python3 - "$WWW/player.html" "$TAG" <<'PY'
import sys
path, tag = sys.argv[1], sys.argv[2]
s = open(path).read()
anchor = '<script defer src="player.js"></script>'
assert anchor in s, "player.js script tag not found -- Epic's frontend changed shape"
s = s.replace(anchor, anchor + '\n' + tag, 1)
open(path, 'w').write(s)
PY

grep -c 'wonderland/overlay.js' "$WWW/player.html" | grep -qx 1 \
  || { echo "FAILED: the overlay tag is not present exactly once"; exit 1; }
echo "overlay installed: $WWW/wonderland/ + one script tag in player.html"
