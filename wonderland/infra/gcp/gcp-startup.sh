#!/usr/bin/env bash
# Wonderland — GCE startup-script. Runs as root on every boot.
#
# The GCP port of ../vast/vast-onstart.sh. Three things differ, and they are the
# three things that actually differ between a rented container and a VM:
#
#   * THE DRIVER IS OURS. On Vast the host supplied the NVIDIA driver through
#     the container runtime. Here the VM must have it. We boot a Deep Learning
#     image that ships driver + CUDA, and verify rather than assume — a Pixel
#     Streaming host with no working NVENC fails silently, encoding nothing.
#   * THE EPIC IMAGE IS A CONTAINER WE RUN, not the environment we are already
#     inside. So: docker + the NVIDIA container toolkit, then `docker run --gpus`.
#   * WE MUST TURN OURSELVES OFF. Vast bills a stopped instance almost nothing
#     and the founder watches it. A forgotten GPU VM is the single most expensive
#     mistake available here, so this script installs its own watchdog.
#
# Idempotent throughout: every boot re-checks and re-starts only what is missing.
# Fail-closed: if the GPU is not visible we say so loudly and do not pretend.
set -uo pipefail

WORK=/opt/wonderland
LOG="$WORK/startup.log"
mkdir -p "$WORK"
exec >>"$LOG" 2>&1
log() { printf '[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }
log "=== startup-script begin ==="

md() { curl -s -H 'Metadata-Flavor: Google' \
  "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null; }
ZONE_FULL="$(curl -s -H 'Metadata-Flavor: Google' http://metadata.google.internal/computeMetadata/v1/instance/zone)"
ZONE="${ZONE_FULL##*/}"
SELF="$(hostname)"

IMAGE="$(md wonderland-image)";               IMAGE="${IMAGE:-ghcr.io/epicgames/unreal-engine:dev-5.8}"
ALLOWED_ORIGIN="$(md wonderland-allowed-origin)"
QUALITY="$(md wonderland-quality)"
BUILD_URL="$(md wonderland-build-url)"
MAX_RUNTIME_MIN="$(md wonderland-max-runtime-min)"; MAX_RUNTIME_MIN="${MAX_RUNTIME_MIN:-240}"
IDLE_MIN="$(md wonderland-idle-min)";               IDLE_MIN="${IDLE_MIN:-30}"
SIG_TCP="$(md wonderland-signalling-tcp)";          SIG_TCP="${SIG_TCP:-443}"
TURN_PORT="$(md wonderland-turn-port)";             TURN_PORT="${TURN_PORT:-3478}"
UDP_START="$(md wonderland-udp-start)";             UDP_START="${UDP_START:-50000}"
UDP_END="$(md wonderland-udp-end)";                 UDP_END="${UDP_END:-50009}"
REPO_URL="$(md wonderland-repo-url)"
SRC_URL="$(md wonderland-src-url)"
PSI_BRANCH="$(md wonderland-psi-branch)"; PSI_BRANCH="${PSI_BRANCH:-UE5.5}"
GHCR_USER="$(md ghcr-user)"
GHCR_PAT="$(md ghcr-pat)"

# ---------------------------------------------------------------- 1. the GPU
# First, because everything downstream is pointless without it and the failure is
# otherwise silent: the stream comes up, connects, and encodes nothing.
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  log "GPU OK: $(nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader | head -1)"
  if nvidia-smi --query-gpu=encoder.stats.sessionCount --format=csv,noheader >/dev/null 2>&1; then
    log "NVENC query works — the encoder path is present"
  else
    log "WARNING: could not query NVENC. Pixel Streaming needs hardware H.264."
  fi
else
  log "FATAL: no working nvidia-smi. Not starting the streamer — a host that cannot"
  log "       encode would come up, accept a viewer and send nothing, which is worse"
  log "       than being down. Check the image really is a CUDA/driver image."
  exit 1
fi

# ---------------------------------------------------------- 2. container runtime
if ! command -v docker >/dev/null 2>&1; then
  log "installing docker"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq && apt-get install -y -qq docker.io >/dev/null
fi
systemctl is-active --quiet docker || systemctl start docker
if ! docker info 2>/dev/null | grep -qi nvidia; then
  log "installing nvidia-container-toolkit"
  curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey \
    | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg 2>/dev/null
  curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list \
    | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' \
    > /etc/apt/sources.list.d/nvidia-container-toolkit.list
  apt-get update -qq && apt-get install -y -qq nvidia-container-toolkit >/dev/null
  nvidia-ctk runtime configure --runtime=docker >/dev/null 2>&1
  systemctl restart docker
fi
docker run --rm --gpus all nvidia/cuda:12.3.0-base-ubuntu22.04 nvidia-smi -L >/dev/null 2>&1 \
  && log "docker sees the GPU" || log "WARNING: docker cannot see the GPU"

# ------------------------------------------------------------ 3. the UE image
if [ -n "$GHCR_USER" ] && [ -n "$GHCR_PAT" ]; then
  # Piped, never echoed, and cleared immediately. The value never reaches the log.
  printf '%s' "$GHCR_PAT" | docker login ghcr.io -u "$GHCR_USER" --password-stdin >/dev/null 2>&1 \
    && log "ghcr login ok" || log "ghcr login FAILED (check the PAT has read:packages)"
  unset GHCR_PAT
fi
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  log "pulling $IMAGE (large; first boot only)"
  docker pull "$IMAGE" >/dev/null 2>&1 && log "pull ok" || log "pull FAILED"
fi

# ------------------------------------------------------- 4. the watchdog FIRST
# Installed BEFORE the long build, deliberately: the expensive failure mode is a
# build that hangs on a GPU nobody is watching. The watchdog must already be
# running by then.
#
# It STOPS the VM rather than deleting it. Compute billing ends either way, and
# stopping keeps the disk — which holds the built engine, the packaged game and
# the generated textures, all expensive to rebuild. Deleting is a deliberate
# human act (`wonderland-gcp.sh delete`), not something a timer should do.
cat > /usr/local/bin/wonderland-watchdog.sh <<WD
#!/usr/bin/env bash
set -u
BOOT=\$(date +%s)
IDLE_SINCE=\$(date +%s)
while true; do
  sleep 60
  NOW=\$(date +%s)
  AGE_MIN=\$(( (NOW - BOOT) / 60 ))
  if [ "\$AGE_MIN" -ge "$MAX_RUNTIME_MIN" ]; then
    logger -t wonderland "MAX RUNTIME \${AGE_MIN}m >= $MAX_RUNTIME_MIN — stopping this VM"
    gcloud compute instances stop "$SELF" --zone "$ZONE" --quiet && exit 0
  fi
  # A viewer is an ESTABLISHED connection to the signalling port. No viewer for
  # the idle window means nobody is watching a GPU that is still billing.
  if ss -tn state established "( sport = :$SIG_TCP or sport = :8080 )" 2>/dev/null | tail -n +2 | grep -q .; then
    IDLE_SINCE=\$NOW
  fi
  IDLE_MIN_NOW=\$(( (NOW - IDLE_SINCE) / 60 ))
  if [ "\$IDLE_MIN_NOW" -ge "$IDLE_MIN" ]; then
    logger -t wonderland "IDLE \${IDLE_MIN_NOW}m >= $IDLE_MIN with no viewer — stopping this VM"
    gcloud compute instances stop "$SELF" --zone "$ZONE" --quiet && exit 0
  fi
done
WD
chmod +x /usr/local/bin/wonderland-watchdog.sh
cat > /etc/systemd/system/wonderland-watchdog.service <<'UNIT'
[Unit]
Description=Wonderland GPU cost watchdog (max runtime + idle shutdown)
[Service]
ExecStart=/usr/local/bin/wonderland-watchdog.sh
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now wonderland-watchdog.service >/dev/null 2>&1
log "watchdog armed: stop at ${MAX_RUNTIME_MIN}m runtime or ${IDLE_MIN}m with no viewer"

# ------------------------------------------------ 4b. the source and the server
# TWO THINGS THE VM CANNOT BUILD OR SERVE WITHOUT, and neither arrives by magic.
# I had written the serve step to `find` a SignallingWebServer that nothing ever
# put there, and to build from a $WORK/src that nothing ever populated — both
# would have failed on a fresh VM with a confusing "not found" rather than an
# honest "never fetched".
SRC="$WORK/src"
if [ ! -d "$SRC/wonderland" ]; then
  if [ -n "$SRC_URL" ]; then
    # A tarball over plain HTTPS. Preferred: no credential touches the VM.
    log "fetching source tarball"
    mkdir -p "$SRC"
    curl -fsSL "$SRC_URL" | tar -xz -C "$SRC" --strip-components=1 \
      && log "source unpacked" || log "source tarball FAILED"
  elif [ -n "$REPO_URL" ]; then
    # May embed a token, supplied from the operator's shell at create time —
    # the same seam as the GHCR pull secret, and for the same reason: it lives
    # in the operator's environment and never in this repository.
    log "cloning source"
    git clone --depth 1 "$REPO_URL" "$SRC" >/dev/null 2>&1 \
      && log "source cloned" || log "git clone FAILED (private repo needs a token in the URL)"
  else
    log "NO SOURCE. Supply wonderland-src-url (tarball, preferred) or"
    log "  wonderland-repo-url at create time, or push it yourself:"
    log "  gcloud compute scp --recurse ./wonderland <instance>:$SRC/ --zone <zone>"
  fi
fi
[ -d "$SRC/wonderland" ] && log "source present at $SRC" || log "source absent — build and serve will be skipped"

# The signalling server is a separate Epic repository (public, unlike the engine
# image). Without it there is nothing for the streamer to connect to.
PSI="$WORK/PixelStreamingInfrastructure"
if [ ! -d "$PSI" ]; then
  log "cloning PixelStreamingInfrastructure ($PSI_BRANCH)"
  git clone --depth 1 --branch "$PSI_BRANCH" \
    https://github.com/EpicGames/PixelStreamingInfrastructure.git "$PSI" >/dev/null 2>&1 \
    && log "signalling infrastructure cloned" \
    || log "PSI clone FAILED — check the branch name matches the engine version"
fi

# --------------------------------------------------------- 5. the application
# Left as the explicit seam to the existing build path rather than duplicated:
# infra/build/build-wonderland.sh already knows how to build, cook, stage and
# package, and it is provider-independent. Nothing about it changes for GCP.
if [ -n "$BUILD_URL" ]; then
  log "fetching prebuilt artifact"
  mkdir -p "$WORK/packaged"
  curl -fsSL "$BUILD_URL" -o "$WORK/build.zip" && unzip -oq "$WORK/build.zip" -d "$WORK/packaged" \
    && log "artifact unpacked" || log "artifact fetch FAILED"
else
  log "no BUILD_URL: build on this VM with infra/build/build-wonderland.sh inside $IMAGE"
  log "  docker run --rm --gpus all -v $WORK:/work $IMAGE bash /work/src/infra/build/build-wonderland.sh"
fi

# ------------------------------------------------------- 6. serve, if we can
# THE LIFECYCLE HAS TO CLOSE. GCE runs this script on EVERY boot, so a VM that
# has already been built should come back serving — otherwise `start` resumes a
# GPU that bills and streams nothing, which is the exact failure the watchdog
# exists to punish and a silly one to build in deliberately.
#
# On the very first boot there is no package yet and this block correctly does
# nothing. That is the only time it should.
PKG="$WORK/packaged/Linux/Wonderland.sh"
if [ -x "$PKG" ]; then
  log "packaged build present — bringing the stack up"

  # TURN first: the media path needs it advertised in the signalling peer
  # options, which is the single fix that made remote streaming work at all.
  if [ -f /etc/turnserver.conf ] && ! pgrep -x turnserver >/dev/null 2>&1; then
    setsid nohup turnserver -c /etc/turnserver.conf >/var/log/turn.log 2>&1 </dev/null &
    log "turnserver started"
  fi

  SIGDIR="$(find "$PSI" -maxdepth 4 -type d -name SignallingWebServer 2>/dev/null | head -1)"
  NODE="$(find "${SIGDIR:-/}" -path '*platform_scripts/bash/node/bin/node' 2>/dev/null | head -1)"
  if [ -n "$SIGDIR" ] && [ -n "$NODE" ] && ! pgrep -f '[W]ilbur' >/dev/null 2>&1; then
    # the BUNDLED node, not the system one — the system v12 cannot run Wilbur
    ( cd "$SIGDIR" && setsid nohup "$NODE" ./dist/Wilbur.js \
        --peer_options "{\"iceServers\":[{\"urls\":[\"turn:127.0.0.1:${TURN_PORT}\"]}]}" \
        >"$WORK/sig.log" 2>&1 </dev/null & )
    log "signalling started with TURN advertised"
    sleep 6
  fi

  if ! pgrep -x Wonderland >/dev/null 2>&1; then
    # as ue4, never root: the packaged app refuses to run with root privileges.
    # Auto-exposure does not converge headless, so the bias is forced at launch.
    RUNAS="$(id -u ue4 >/dev/null 2>&1 && echo ue4 || echo root)"
    setsid nohup runuser -u "$RUNAS" -- env HOME="/home/$RUNAS" "$PKG" \
      -RenderOffscreen -PixelStreamingURL="ws://127.0.0.1:8888" \
      -ResX=1920 -ResY=1080 -ExecCmds="r.AutoExposure.Bias -0.15" \
      -Unattended -stdout -FullStdOutLogOutput \
      >>"$WORK/app.log" 2>&1 </dev/null &
    log "streamer started as $RUNAS"
  fi

  IP="$(curl -s -H 'Metadata-Flavor: Google' \
        http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip)"
  log "PLAYER URL: http://${IP}:${SIG_TCP}/   (external IP, stable while the VM exists)"
  log "  Unlike the Vast path this address does NOT change on every restart —"
  log "  no quick tunnel in the loop. Put it in VITE_WONDERLAND_SIGNALLING_URL."
else
  log "no packaged build yet — not starting the stack."
  log "Build once with infra/build/build-wonderland.sh inside $IMAGE; after that"
  log "every boot serves automatically."
fi

log "=== startup-script end. GPU up, watchdog armed. ==="
