#!/usr/bin/env bash
# Wonderland on Lightning — EVERYTHING THAT DOES NOT NEED A GPU.
#
# Run this while the Studio is still on CPU. Every minute of work done here is
# a minute the GPU is not being paid for, and most of the cost of a Wonderland
# build is not the rendering — it is fetching an engine, installing packages,
# and synthesising textures and audio, all of which are pure CPU.
#
# Safe to re-run. Nothing here needs a GPU, and nothing here starts one.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=common.sh
. "$HERE/common.sh"

wl_say "preparing Wonderland under $WL_ROOT"
wl_mkdirs

# ------------------------------------------------------------ 0. environment
if [ -d /teamspace/studios/this_studio ]; then
  wl_ok "Lightning persistent storage detected — artifacts survive a Studio stop"
else
  wl_warn "no /teamspace found; using $WL_ROOT. If this is a Lightning Studio,"
  wl_warn "check that the path exists, or set WL_ROOT to persistent storage."
fi
df -h "$WL_ROOT" 2>/dev/null | tail -1 | awk '{print "[wonderland] disk on " $6 ": " $4 " free of " $2}'
awk '/MemTotal/ {printf "[wonderland] RAM: %.1f GB\n", $2/1048576}' /proc/meminfo 2>/dev/null || true
wl_say "cpus: $(nproc 2>/dev/null || echo '?')"

# ------------------------------------------------------------ 1. packages
# Best-effort: a Studio may not give us root, and that is fine — the only hard
# requirement below is python3 and git. Missing extras are reported, not fatal.
WL_APT="${WL_APT:-1}"
if [ "$WL_APT" = "1" ] && command -v apt-get >/dev/null 2>&1; then
  SUDO=""
  [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1 && SUDO="sudo"
  if [ "$(id -u)" -eq 0 ] || [ -n "$SUDO" ]; then
    wl_say "installing CPU-side packages (best effort)"
    $SUDO apt-get update -qq >>"$WL_LOG/apt.log" 2>&1 || wl_warn "apt update failed; see $WL_LOG/apt.log"
    # coturn: the media path needs a TURN server ADVERTISED to the browser, and
    # that single fact was the difference between a black player and a picture
    # when this last worked. cloudflared: gives a public https URL over outbound
    # 443 only, so it works regardless of what the provider exposes.
    $SUDO apt-get install -y -qq --no-install-recommends \
      git curl ca-certificates python3 xz-utils coturn \
      libvulkan1 libsdl2-2.0-0 libnss3 libatk1.0-0 libatk-bridge2.0-0 \
      libcups2 libdrm2 libgbm1 libasound2t64 libxkbcommon0 libxcomposite1 \
      libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 \
      >>"$WL_LOG/apt.log" 2>&1 || wl_warn "some packages failed; see $WL_LOG/apt.log"
  else
    wl_warn "no root and no sudo; skipping package install"
  fi
fi

command -v python3 >/dev/null 2>&1 || wl_die "python3 is required and absent"
command -v git     >/dev/null 2>&1 || wl_die "git is required and absent"

if ! command -v cloudflared >/dev/null 2>&1 && [ ! -x "$WL_RUN/cloudflared" ]; then
  wl_say "fetching cloudflared (public URL over outbound 443 only)"
  curl -fsSL -o "$WL_RUN/cloudflared" \
    https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 \
    >>"$WL_LOG/prepare.log" 2>&1 && chmod +x "$WL_RUN/cloudflared" \
    || wl_warn "cloudflared download failed; the Lightning port panel is the fallback"
fi

# ------------------------------------------------------------ 2. source
#
# THIS BLOCK USED TO RESET AN EXISTING CHECKOUT ONTO $WL_BRANCH WITHOUT SAYING
# SO. $WL_SRC is a checkout of its own — not the operator's working directory —
# so `git checkout <branch>` in a shell never affected what was compiled, and a
# stale WL_BRANCH default meant the L4 built and measured a package whose source
# did not contain the code that was being tested. Every stage reported success.
#
# Now: a branch change has to be asked for, and the resulting commit is verified
# against the branch head before anything is compiled.
wl_require_source_branch
if [ -d "$WL_SRC/.git" ]; then
  wl_say "updating $WL_BRANCH"
  git -C "$WL_SRC" fetch --depth 50 origin "$WL_BRANCH" >>"$WL_LOG/git.log" 2>&1 \
    || wl_die "fetch of origin/$WL_BRANCH failed; see $WL_LOG/git.log"
  git -C "$WL_SRC" checkout -q "$WL_BRANCH" 2>>"$WL_LOG/git.log" || \
    git -C "$WL_SRC" checkout -qb "$WL_BRANCH" "origin/$WL_BRANCH" >>"$WL_LOG/git.log" 2>&1
  git -C "$WL_SRC" reset --hard "origin/$WL_BRANCH" >>"$WL_LOG/git.log" 2>&1
else
  wl_say "cloning $WL_BRANCH"
  git clone --depth 50 --branch "$WL_BRANCH" "$WL_REPO" "$WL_SRC" >>"$WL_LOG/git.log" 2>&1 \
    || wl_die "clone failed; see $WL_LOG/git.log (a private repo needs a credential in the Studio)"
fi
# FULL sha, and fail closed unless it is the head of the branch that was asked
# for. A short sha is not enough here: this number gets quoted in a report and
# compared against a commit someone pushed.
wl_verify_source "prepare"

# The checkout was just reset to origin, so anything that is not in git is gone
# or was never there. Re-link the Marble meshes from persistent storage now,
# while this is free, rather than discovering they are missing in the middle of
# a build.
wl_link_marble_assets
wl_source_sha > "$WL_RUN/source.sha"

BUILD_DIR="$WL_SRC/wonderland/infra/build"
[ -d "$BUILD_DIR" ] || wl_die "expected $BUILD_DIR in the checkout"

# ------------------------------------------------------------ 3. offline gates
# These are the cheap checks that have actually saved cooks. Running them here
# means a broken generator is found on CPU, not after the GPU is already warm.
wl_say "running the offline gates"
GATE_FAIL=0
# verify-target-config.py runs FIRST and cheaply: a legacy target config is the
# failure that reached UnrealBuildTool on a paid L4 before dying, so catching it
# here costs a second instead of a compile.
# verify-pixelstreaming-plugin.py is in this list because a project that
# enables no streamer produces a package that runs perfectly and streams
# nothing — the "No streamer available" failure, discovered only from a
# browser after a full cook and launch.
for g in verify-target-config.py verify-pixelstreaming-plugin.py verify-local-includes.py verify-look-table.py verify-docs.py verify-dog-proxy.py verify-hero-motif.py verify-hero-skyline.py verify-generator-classes.py verify-generator-dryrun.py; do
  if [ -f "$BUILD_DIR/$g" ]; then
    if python3 "$BUILD_DIR/$g" >>"$WL_LOG/gates.log" 2>&1; then
      wl_ok "gate $g"
    else
      wl_warn "gate $g FAILED — see $WL_LOG/gates.log"
      GATE_FAIL=1
    fi
  fi
done
[ "$GATE_FAIL" = 0 ] || wl_warn "one or more gates failed; fix before spending GPU time"

# ------------------------------------------------------------ 4. textures + audio
# Pure-stdlib synthesis: no GPU, no network, no licence. Doing it here is the
# single biggest saving in the whole flow, because the alternative is a warm
# GPU sitting idle while Python writes PNGs.
wl_say "synthesising textures and audio on CPU"
wl_say "  textures -> $WONDERLAND_TEXTURE_DIR"
wl_say "  audio    -> $WONDERLAND_AUDIO_DIR"
# The destination is passed EXPLICITLY as well as exported. The first real
# Lightning run generated both sets successfully and the build would still have
# imported nothing, because the tools defaulted to the old host's
# /opt/wonderland while the assets sat on Studio storage. Belt and braces here
# is cheap; a silent empty import costs a GPU session.
( cd "$BUILD_DIR" && python3 gen-textures.py "$WONDERLAND_TEXTURE_DIR" >>"$WL_LOG/gen.log" 2>&1 ) \
  && wl_ok "textures generated" || wl_warn "gen-textures.py failed; see $WL_LOG/gen.log"
if [ -f "$BUILD_DIR/gen-audio.py" ]; then
  ( cd "$BUILD_DIR" && WONDERLAND_AUDIO_DIR="$WONDERLAND_AUDIO_DIR" \
      python3 gen-audio.py >>"$WL_LOG/gen.log" 2>&1 ) \
    && wl_ok "audio generated" || wl_warn "gen-audio.py failed; see $WL_LOG/gen.log"
fi

# Announce the fact, not the intention: count what is actually on disk.
_ntex=$( ( set +o pipefail; find "$WONDERLAND_TEXTURE_DIR" -type f -name '*.png' 2>/dev/null | wc -l ) || echo 0)
_naud=$( ( set +o pipefail; find "$WONDERLAND_AUDIO_DIR" -type f -name '*.wav' 2>/dev/null | wc -l ) || echo 0)
wl_say "on disk: $_ntex textures, $_naud wavs"
[ "$_ntex" -gt 0 ] || wl_warn "NO textures on disk - the build will import none"
[ "$_naud" -gt 0 ] || wl_warn "NO wavs on disk - the build will import no audio"

# ------------------------------------------------- 4b. the capture toolchain
# STAGE 6 CANNOT RUN WITHOUT THIS, and nothing installed it. shot.cjs requires
# playwright; without it the launcher warns and carries on, so a paid run
# reaches "8/8" having produced NO hero frame and nothing for VERIFY to check —
# two of the phase's completion criteria, silently unmet.
#
# Installed here because here is CPU. Downloading a browser on a GPU machine is
# the same waste as downloading the engine on one.
CAPTURE_READY=0
if [ -d "$WL_TOOLS/node_modules/playwright" ]; then
  wl_ok "capture toolchain already present at $WL_TOOLS"
  CAPTURE_READY=1
elif command -v npm >/dev/null 2>&1; then
  wl_say "installing the hero-frame capture toolchain (CPU, one time)"
  mkdir -p "$WL_TOOLS"
  ( cd "$WL_TOOLS" && npm init -y >>"$WL_LOG/capture.log" 2>&1       && npm install playwright >>"$WL_LOG/capture.log" 2>&1 )     && wl_ok "playwright installed"     || wl_warn "playwright install failed; see $WL_LOG/capture.log"
  # Real Chrome, not the bundled Chromium: the bundled build has NO H264
  # decoder, so the page loads, the stream negotiates and the video stays
  # black with nothing reporting an error.
  ( cd "$WL_TOOLS" && npx --yes playwright install --with-deps chrome       >>"$WL_LOG/capture.log" 2>&1 )     && wl_ok "chrome installed (H264 capable)"     || wl_warn "chrome install failed; see $WL_LOG/capture.log"
  [ -d "$WL_TOOLS/node_modules/playwright" ] && CAPTURE_READY=1
else
  wl_warn "no npm; the hero frame cannot be captured on this Studio"
fi

# ------------------------------------------------------------ 5. the engine
# UE 5.8 is the one thing this script cannot obtain on its own. Epic gate it
# behind an account link, and working around that is not something to automate.
# So: report precisely what is present and what the founder must do.
# THREE STATES, NOT TWO. "Image absent" and "engine unobtainable" are different
# situations and only the second needs the founder. Lightning has already
# discarded the local image once across a session change, and reporting that as
# NOT READY would send someone to relink Epic and re-download 69 GB while a
# verified archive sits on the same disk.
UE_STATE="$(wl_ue_status)"
case "$UE_STATE" in
  READY)
    if [ -x "$WL_UE/Engine/Build/BatchFiles/RunUAT.sh" ]; then
      UE_VER="$(grep -o '"MinorVersion"[[:space:]]*:[[:space:]]*[0-9]*' \
                "$WL_UE/Engine/Build/Build.version" 2>/dev/null | grep -o '[0-9]*$' || echo '?')"
      wl_ok "ENGINE READY - native Unreal at $WL_UE (minor version ${UE_VER})"
    else
      wl_ok "ENGINE READY - $WL_UE_IMAGE is loaded"
    fi
    ;;
  RESTORABLE)
    wl_ok "ENGINE RESTORABLE - image not loaded, but the persistent archive is here:"
    wl_say "    $WL_UE_ARCHIVE ($(du -h "$WL_UE_ARCHIVE" 2>/dev/null | cut -f1))"
    wl_say "    launch-wonderland.sh restores it automatically. No download, no founder action."
    ;;
  *)
    wl_warn "ENGINE NOT READY - neither a loaded image nor a usable archive."
    ;;
esac

# ------------------------------- 5b. pixel streaming infrastructure + coturn
# Stage 5 has never once run to completion on Lightning, and both of its
# dependencies are things a CPU session can settle for free. Reported here so
# the founder learns about a wrong branch or an absent coturn image now, rather
# than from a GPU that is already attached and billing.
PS_STATE="$(wl_ps_status)"
case "$PS_STATE" in
  READY)         wl_ok "SIGNALLING READY - $WL_PS_VERSION" ;;
  NOT_BUILT)     wl_warn "SIGNALLING NOT BUILT - $WL_PS_SIG needs its CPU build (dist/ and www/)" ;;
  WRONG_VERSION) wl_warn "SIGNALLING WRONG BRANCH - DOWNLOAD_VERSION='$(wl_ps_version)', need $WL_PS_VERSION" ;;
  *)             wl_warn "SIGNALLING MISSING - no checkout at $WL_PS_INFRA" ;;
esac
NODE_STATE="$(wl_node_status)"
case "$NODE_STATE" in
  READY)         wl_ok "SIGNALLING NODE READY - $(wl_ps_required_node)" ;;
  WRONG_VERSION) wl_warn "SIGNALLING NODE WRONG - need $(wl_ps_required_node), stage 5 will fail closed" ;;
  *)             wl_warn "SIGNALLING NODE MISSING - no NODE_VERSION file or no node at all" ;;
esac
# Wilbur's node_modules: the thing that vanished across a CPU->L4 switch.
# THE NODE WILBUR NEEDS, fetched here on CPU rather than discovered missing at
# stage 5 on a GPU after a 1.1 GB cook. Best effort: a failure warns and the
# launch still refuses later with the same clear message it always did.
wl_ensure_node || wl_warn "node not installed; the stream stage will refuse"

# Settle it here, on CPU, where fetching it is free.
MODS_STATE="$(wl_wilbur_modules_status)"
case "$MODS_STATE" in
  READY)      wl_ok "WILBUR DEPS READY - $WL_WILBUR_MODULES resolve" ;;
  RESTORABLE) wl_ok "WILBUR DEPS RESTORABLE - archive at $WL_WILBUR_MODULES_ARCHIVE" ;;
  *)          wl_warn "WILBUR DEPS MISSING - run 'cd $WL_PS_SIG && npm ci' NOW, on CPU, then re-run prepare.sh"
              wl_say  "   (this is the MODULE_NOT_FOUND express failure; fixing it on the GPU costs credits)" ;;
esac
TURN_STATE="$(wl_turn_status)"
case "$TURN_STATE" in
  READY)      wl_ok "TURN READY - $WL_TURN_IMAGE is loaded" ;;
  RESTORABLE) wl_ok "TURN RESTORABLE - restored automatically at launch from"
              wl_say "    $WL_TURN_ARCHIVE ($(du -h "$WL_TURN_ARCHIVE" 2>/dev/null | cut -f1))" ;;
  *)          wl_warn "TURN NOT READY - no image and no archive at $WL_TURN_ARCHIVE" ;;
esac

# ------------------------------------------------------------ 6. report
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ) prepared at $(git -C "$WL_SRC" rev-parse --short HEAD)" \
  > "$WL_RUN/prepared.stamp"

echo
wl_say "================ READINESS ================"
printf '  storage      %s\n' "$WL_ROOT"
printf '  source       %s (%s)\n' "$(git -C "$WL_SRC" rev-parse --short HEAD)" "$WL_BRANCH"
printf '  textures     %s\n' "$([ -d "$WL_SRC/wonderland/Content" ] || [ -d "$WL_ROOT/textures" ] && echo present || echo 'see gen.log')"
printf '  offline gates %s\n' "$([ "$GATE_FAIL" = 0 ] && echo pass || echo FAIL)"
printf '  hero capture %s\n' "$([ "$CAPTURE_READY" = 1 ] && echo READY || echo 'NOT READY - stage 6 will produce no frame')"
case "$UE_STATE" in
  READY)      printf '  engine       READY\n' ;;
  RESTORABLE) printf '  engine       RESTORABLE (archive on persistent storage; auto-restored at launch)\n' ;;
  *)          printf '  engine       NOT READY - founder action needed\n' ;;
esac
case "$PS_STATE" in
  READY)     printf '  signalling   READY (%s)\n' "$WL_PS_VERSION" ;;
  NOT_BUILT) printf '  signalling   NOT BUILT - stage 5 will fail closed\n' ;;
  WRONG_VERSION) printf '  signalling   WRONG BRANCH - stage 5 will fail closed\n' ;;
  *)         printf '  signalling   MISSING - stage 5 will fail closed\n' ;;
esac
case "$NODE_STATE" in
  READY)         printf '  node         READY (%s)\n' "$(wl_ps_required_node)" ;;
  WRONG_VERSION) printf '  node         WRONG VERSION - stage 5 will fail closed\n' ;;
  *)             printf '  node         MISSING - stage 5 will fail closed\n' ;;
esac
case "$MODS_STATE" in
  READY)      printf '  wilbur deps  READY\n' ;;
  RESTORABLE) printf '  wilbur deps  RESTORABLE (archive on persistent storage)\n' ;;
  *)          printf '  wilbur deps  MISSING - stage 5 will fail closed\n' ;;
esac
case "$TURN_STATE" in
  READY)      printf '  turn         READY\n' ;;
  RESTORABLE) printf '  turn         RESTORABLE (archive on persistent storage)\n' ;;
  *)          printf '  turn         NOT READY - the stream would stay black remotely\n' ;;
esac
# On CPU there is no GPU and that is expected; the Vulkan evidence matters only
# once the L4 is attached, so it is offered rather than run.
printf '  vulkan       %s\n' "$(wl_have_gpu && { wl_vulkan_ok && echo 'NVIDIA device reachable' || echo 'NOT REACHABLE - run: bash run-stream.sh (it will print the evidence)'; } || echo 'n/a while on CPU')"
printf '  gpu          %s\n' "$(wl_have_gpu && nvidia-smi --query-gpu=name --format=csv,noheader | head -1 || echo 'none (expected while on CPU)')"
echo
if [ "$UE_STATE" = "RESTORABLE" ]; then
  wl_ok "Nothing to do about the engine. It is restored from persistent storage at launch."
elif [ "$UE_STATE" != "READY" ]; then
  cat <<'NEEDED'
[wonderland] FOUNDER ACTION REQUIRED — obtaining Unreal Engine 5.8
[wonderland]
[wonderland] Epic put UE behind an account link and I will not work around it.
[wonderland] Pick ONE of these, in the Lightning Studio terminal:
[wonderland]
[wonderland]   A) Epic's official container (fastest, recommended)
[wonderland]      1. Link your Epic account to GitHub once, at
[wonderland]         https://www.unrealengine.com/en-US/ue-on-github
[wonderland]      2. Make a GitHub personal access token with read:packages
[wonderland]      3. In the Studio:
[wonderland]           echo <TOKEN> | docker login ghcr.io -u <GITHUB_USER> --password-stdin
[wonderland]           docker pull ghcr.io/epicgames/unreal-engine:dev-5.8
[wonderland]
[wonderland]   B) Build from source (no container, several hours of CPU)
[wonderland]           git clone --depth 1 -b 5.8 git@github.com:EpicGames/UnrealEngine.git \
[wonderland]             /teamspace/studios/this_studio/wonderland/UnrealEngine
[wonderland]           cd /teamspace/studios/this_studio/wonderland/UnrealEngine
[wonderland]           ./Setup.sh && ./GenerateProjectFiles.sh && make
[wonderland]
[wonderland] Do A or B while the Studio is still on CPU. Neither needs a GPU.
NEEDED
else
  wl_ok "CPU preparation complete. Next: enable the GPU, then run launch-wonderland.sh"
fi
