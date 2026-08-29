#!/usr/bin/env bash
# Everything a Lightning Studio RESTART discards, restored in one command, on CPU.
#
# Learned on 2026-08-29, the hard way, one piece at a time: a restart keeps
# /teamspace but loses the UE docker image (73 GB, 18 min from the archive),
# the Chrome + Playwright the hero capture needs, and the apt runtime libs; the
# bundled Pixel-Streaming node keeps its binary but its npm symlink dangles
# (no lib/node_modules beside it), which the launcher rightly refuses. Each of
# those failed a capture launch separately, and one of them started a second
# restore of the archive beside a running pull. Run this BEFORE the first
# capture after any restart:
#
#   cd $WL_SRC && bash wonderland/infra/lightning/after-restart.sh
#
# Idempotent: every step checks first and says what it found.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

wl_say "after-restart: restoring what the Studio restart discarded"

# 1. the engine image (waits for a pull in flight; loads the archive only with
#    room for it; never downloads)
wl_ensure_ue_image

# 2. the bundled node's npm. The launcher requires $(dirname node)/npm to be
#    executable; after a restart the symlink points at a lib/node_modules that
#    is not there. The matching full node tarball lives at $WL_RUN/node22 (or
#    is fetched, on CPU, from nodejs.org) and lends its lib/node_modules.
required="$(wl_ps_required_node)"
node="$(wl_bundled_node 2>/dev/null || true)"
if [ -n "$node" ] && wl_node_install_usable "$node" "$required"; then
  wl_ok "bundled node $required usable with npm at $(dirname "$node")/npm"
else
  [ -n "$node" ] || wl_die "no bundled node under $WL_PS_INFRA; run prepare.sh on CPU first"
  ndir="$(dirname "$(dirname "$node")")"
  full="$WL_RUN/node22"
  if [ ! -x "$full/bin/npm" ] || [ "$("$full/bin/node" -v 2>/dev/null || true)" != "$required" ]; then
    wl_say "fetching node $required (full distribution, for its npm) into $full"
    rm -rf "$full"; mkdir -p "$full"
    curl -fsSL "https://nodejs.org/dist/$required/node-$required-linux-x64.tar.xz" | tar -xJ -C "$full" --strip-components=1
  fi
  mkdir -p "$ndir/lib"
  rm -rf "$ndir/lib/node_modules"
  cp -a "$full/lib/node_modules" "$ndir/lib/node_modules"
  for b in npm npx corepack; do
    [ -e "$full/bin/$b" ] && ln -sfn "../lib/node_modules/$( [ "$b" = corepack ] && echo corepack/dist/corepack.js || echo "npm/bin/$b-cli.js" )" "$ndir/bin/$b"
  done
  wl_node_install_usable "$node" "$required" && wl_ok "bundled node repaired: $(PATH="$(dirname "$node"):$PATH" npm -v) npm beside node $required" \
    || wl_die "the bundled node still has no working npm after the repair; look at $ndir/bin"
fi

# 3. the capture browser. shot.cjs requires playwright from $WL_TOOLS and a
#    real Chrome (H264 for the Pixel-Streaming frame).
if "$node" -e "require('$WL_TOOLS/node_modules/playwright').chromium" >/dev/null 2>&1 && command -v google-chrome >/dev/null 2>&1; then
  wl_ok "playwright loads from $WL_TOOLS and google-chrome is installed"
else
  wl_say "installing the capture toolchain (playwright + chrome, CPU)"
  mkdir -p "$WL_TOOLS"
  ( export PATH="$(dirname "$node"):$PATH"; cd "$WL_TOOLS" && npm install playwright && npx --yes playwright install --with-deps chrome ) \
    || wl_die "playwright/chrome install failed; see the npm output above"
  "$node" -e "require('$WL_TOOLS/node_modules/playwright').chromium" >/dev/null 2>&1 || wl_die "playwright still does not load from $WL_TOOLS"
  wl_ok "playwright + chrome installed"
fi

# 4. the runtime libraries the packaged game and Chrome link against
if ldconfig -p 2>/dev/null | grep -q "libvulkan.so.1" && ldconfig -p 2>/dev/null | grep -q "libSDL2-2.0.so.0"; then
  wl_ok "libvulkan1 and libsdl2 present"
else
  wl_say "installing runtime libraries (apt, CPU)"
  sudo apt-get update -qq >>"$WL_LOG/apt.log" 2>&1 || true
  sudo apt-get install -y -qq --no-install-recommends libvulkan1 libsdl2-2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libgbm1 libasound2t64 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 \
    >>"$WL_LOG/apt.log" 2>&1 || wl_die "apt failed; see $WL_LOG/apt.log"
  wl_ok "runtime libraries installed"
fi

# 5. the TURN image run-stream.sh starts (docker run would pull it at launch
#    time; doing it here keeps the first launch's clock honest)
if docker image inspect "$WL_TURN_IMAGE" >/dev/null 2>&1; then
  wl_ok "TURN image present: $WL_TURN_IMAGE"
else
  wl_say "pulling the TURN image $WL_TURN_IMAGE (114 MB)"
  docker pull "$WL_TURN_IMAGE" >>"$WL_LOG/turn.log" 2>&1 || wl_die "could not pull $WL_TURN_IMAGE; see $WL_LOG/turn.log"
  wl_ok "TURN image pulled"
fi

wl_ok "after-restart: READY for a capture (image, node+npm, playwright+chrome, libs, TURN)"
