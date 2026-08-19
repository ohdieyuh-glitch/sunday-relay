#!/usr/bin/env bash
# Wonderland — Vast.ai instance onstart (the container bootstrap). AUTHORED, NOT
# RUN — this box has no GPU and no Unreal; nothing here has executed on real
# hardware. Its CONTENT is passed to `vastai create instance --onstart-cmd "$(cat
# this)"`; Vast runs it as root inside the rented container at boot.
#
# It is the Vast port of ../scripts/bootstrap.sh, changed in exactly the ways a
# Vast container differs from an EC2 VM:
#   * THE EPIC UE DEV IMAGE IS THE ENVIRONMENT. This container launches FROM
#     ghcr.io/epicgames/unreal-engine:dev-5.8, so UE 5.8 is already here. We build
#     with the IN-IMAGE engine (RunUAT at the detected UE_ROOT). NO `docker pull`,
#     NO nested Docker/Podman, NO UE-inside-a-second-container. One container only.
#   * NO systemd. Vast instances are Docker containers; services run as
#     supervised BACKGROUND processes (a restart loop + pidfiles), not units.
#   * NO AWS. The packaged app is built ON THIS INSTANCE (the offer has the vCPU
#     + RAM for it) or fetched over plain HTTPS from $WONDERLAND_BUILD_URL — never
#     `aws s3`. No awscli, no instance profile, no CloudWatch.
#   * DISCRETE PORTS. WebRTC media is pinned to the small opened UDP window
#     [$WONDERLAND_WEBRTC_UDP_START..END] via UE's -PixelStreamingWebRTCMin/MaxPort,
#     because Vast maps individual ports, not EC2's 16k-wide range.
#
# Every step is idempotent (safe to re-run) and fail-closed. The exact PS2 launch
# surface for UE 5.8 must be confirmed against the plugin on first real run.
set -euo pipefail

WORK=/opt/wonderland
APP="$WORK/app"
PROJECT="$WORK/project"                      # mounted/cloned Wonderland UE project (build-on-instance)
PSI="$WORK/PixelStreamingInfrastructure"
PSI_BRANCH="${PSI_BRANCH:-UE5.8}"            # version-matched to the engine; do not drift
STREAMER_PORT=8888                            # UE streamer <-> signalling (INTERNAL only; never opened)
PLAYER_PORT=8080                              # signalling HTTP (nginx fronts TLS on $SIGNALLING_TCP)
SIGNALLING_TCP="${WONDERLAND_SIGNALLING_TCP:-443}"
UDP_MIN="${WONDERLAND_WEBRTC_UDP_START:-50000}"
UDP_MAX="${WONDERLAND_WEBRTC_UDP_END:-50009}"
ORIGIN="${WONDERLAND_ALLOWED_ORIGIN:-https://sunday-relay.vercel.app}"
PROFILE="${WONDERLAND_QUALITY_PROFILE:-WONDERLAND_BROWSER_ULTRA}"
LOGDIR=/var/log/wonderland
RUNDIR=/run/wonderland

log() { echo "[wonderland-onstart] $*"; }
die() { echo "[wonderland-onstart] ERROR: $*" >&2; exit 1; }
mkdir -p "$WORK" "$LOGDIR" "$RUNDIR"

# A stable TURN secret: generate once, reuse on re-run (idempotent).
TURN_SECRET_FILE=/etc/wonderland-turn.secret
if [ ! -s "$TURN_SECRET_FILE" ]; then ( umask 077; openssl rand -hex 24 > "$TURN_SECRET_FILE" ); fi
TURN_SECRET="$(cat "$TURN_SECRET_FILE")"

# 1. GPU visibility — a Pixel Streaming host with no working driver would silently
#    fail to encode. Vast provides the host NVIDIA driver via the container runtime.
if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then
  log "nvidia-smi OK: $(nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null | head -1)"
else
  log "WARNING: nvidia-smi unavailable — the encoder will not work until the GPU is visible (check the Vast image has the nvidia runtime)"
fi

# 2. Runtime deps (the Epic build image may already ship some; apt is idempotent).
export DEBIAN_FRONTEND=noninteractive
apt-get update -y || log "apt-get update failed (continuing; deps may already be present)"
apt-get install -y --no-install-recommends \
  curl unzip jq git coturn nginx certbot python3-certbot-nginx openssl ca-certificates nodejs npm \
  || log "some apt packages failed to install (may already be present in the image)"

# 3. coturn — WebRTC relay, pinned to the SAME small window the host opens.
cat > /etc/turnserver.conf <<CONF
listening-port=3478
fingerprint
use-auth-secret
static-auth-secret=${TURN_SECRET}
realm=wonderland
no-cli
min-port=${UDP_MIN}
max-port=${UDP_MAX}
CONF
# no systemd: run coturn in the background, supervised below.
pkill -x turnserver 2>/dev/null || true

# 4. Epic PixelStreamingInfrastructure, VERSION-MATCHED (UE 5.8). Cloning the PSI
#    is public; UE itself comes from the private container image. Idempotent.
if [ ! -d "$PSI/.git" ]; then
  git clone --depth 1 --branch "$PSI_BRANCH" \
    https://github.com/EpicGames/PixelStreamingInfrastructure "$PSI" \
    || die "PixelStreamingInfrastructure clone (branch $PSI_BRANCH) failed"
fi
log "PSI branch: $(git -C "$PSI" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown) (pinned ${PSI_BRANCH})"
PSI_SIG="$PSI/SignallingWebServer"
[ -d "$PSI_SIG" ] || die "PSI SignallingWebServer not found (layout changed for ${PSI_BRANCH}? confirm against the UE 5.8 plugin)"
if [ -f "$PSI_SIG/platform_scripts/bash/setup.sh" ]; then
  ( cd "$PSI_SIG/platform_scripts/bash" && ./setup.sh ) || log "PSI setup.sh returned non-zero (confirm the PS2 signalling layout for ${PSI_BRANCH})"
fi

# 5. THE EPIC UE DEV IMAGE IS THE EXECUTION ENVIRONMENT. We compile with the
#    engine that ALREADY ships in this container — we do NOT docker-pull and do
#    NOT launch a nested container. build-wonderland.sh calls RunUAT.sh directly
#    at UE_ROOT, so we just have to point it at the in-image engine.
detect_ue_root() {
  if [ -n "${UE_ROOT:-}" ] && [ -x "$UE_ROOT/Engine/Build/BatchFiles/RunUAT.sh" ]; then echo "$UE_ROOT"; return 0; fi
  local c
  for c in /home/ue4/UnrealEngine /opt/unreal-engine /opt/UnrealEngine /UnrealEngine /root/UnrealEngine "$HOME/UnrealEngine"; do
    [ -x "$c/Engine/Build/BatchFiles/RunUAT.sh" ] && { echo "$c"; return 0; }
  done
  local hit; hit="$(find / -maxdepth 6 -type f -name RunUAT.sh -path '*/Engine/Build/BatchFiles/*' 2>/dev/null | head -1)"
  [ -n "$hit" ] && { dirname "$(dirname "$(dirname "$(dirname "$hit")")")"; return 0; }
  return 1
}

# Acquire the Wonderland source (.uproject + Source/Config/WorldDesign): prefer a
# project already mounted at $PROJECT; else clone $WONDERLAND_REPO_URL (which may
# carry a token IN THE URL — supplied via the container env, never written here).
acquire_source() {
  [ -f "$PROJECT/Wonderland.uproject" ] && { log "using mounted project at $PROJECT"; return 0; }
  if [ -n "${WONDERLAND_REPO_URL:-}" ]; then
    log "cloning Wonderland source (repo url from env; not logged)"
    rm -rf "$PROJECT"
    git clone --depth 1 "${WONDERLAND_REPO_URL}" "$PROJECT" >/dev/null 2>&1 || log "git clone returned non-zero"
    [ -f "$PROJECT/Wonderland.uproject" ] && return 0
    [ -f "$PROJECT/wonderland/Wonderland.uproject" ] && { PROJECT="$PROJECT/wonderland"; return 0; }
    log "cloned repo has no Wonderland.uproject where expected"
  fi
  return 1
}

# Obtain the packaged app — NO AWS, NO nested container. Either build on-instance
# with the image's own UE 5.8, or fetch a pre-built Linux artifact over HTTPS.
obtain_app() {
  if [ -n "${WONDERLAND_BUILD_URL:-}" ]; then
    log "fetching packaged app from \$WONDERLAND_BUILD_URL"
    curl -fSL "$WONDERLAND_BUILD_URL" -o "$WORK/wonderland.zip" || die "artifact download failed"
    rm -rf "$APP" && mkdir -p "$APP"
    unzip -oq "$WORK/wonderland.zip" -d "$APP" || die "artifact unzip failed"
    [ -n "$(ls -A "$APP" 2>/dev/null || true)" ] || die "artifact extracted to an empty app dir"
    return 0
  fi
  acquire_source || { log "no project source and no \$WONDERLAND_BUILD_URL — app not obtained yet (mount the project, set WONDERLAND_REPO_URL, or set WONDERLAND_BUILD_URL)"; return 1; }
  local uer; uer="$(detect_ue_root || true)"
  [ -n "$uer" ] || die "Unreal Engine not found in this image — is this the Epic UE dev image? (looked for Engine/Build/BatchFiles/RunUAT.sh)"
  log "building on-instance with the IN-IMAGE engine at UE_ROOT=$uer (no image pull, single container)"
  local build="$PROJECT/infra/build/build-wonderland.sh"
  [ -f "$build" ] || die "build-wonderland.sh not found under $PROJECT/infra/build"
  UE_ROOT="$uer" OUT="$APP" bash "$build" || die "build-wonderland.sh failed (expect first-build UE 5.8 API fixups; see build/README.md)"
  return 0
}
obtain_app || log "app not present; signalling will still come up, app will wait"

# 6. Resolve the quality profile's CVars from the packaged app's profile file.
PROFILE_INI="$APP/Config/WonderlandQualityProfiles.ini"
PROFILE_CVARS=""
if [ -f "$PROFILE_INI" ]; then
  PROFILE_CVARS="$(awk -v p="[${PROFILE}]" '$0==p{f=1;next} /^\[/{f=0} f&&/^\+CVars=/{sub(/^\+CVars=/,"");printf "%s ",$0}' "$PROFILE_INI" 2>/dev/null || true)"
  [ -n "$PROFILE_CVARS" ] || log "WARNING: no CVars for [${PROFILE}] in $PROFILE_INI"
fi

# 7. TLS for wss:// — the browser is on https:// so mixed-content forbids ws://.
#    A real domain -> certbot. No domain -> a self-signed cert so wss works (the
#    founder accepts it once for a first-frame proof).
CERT=/etc/wonderland/tls.crt; KEY=/etc/wonderland/tls.key
mkdir -p /etc/wonderland
if [ -n "${WONDERLAND_SIGNALLING_DOMAIN:-}" ]; then
  certbot certonly --standalone -n --agree-tos --register-unsafely-without-email \
    -d "${WONDERLAND_SIGNALLING_DOMAIN}" || log "certbot deferred (point DNS at this host, then re-run)"
  L="/etc/letsencrypt/live/${WONDERLAND_SIGNALLING_DOMAIN}"
  [ -f "$L/fullchain.pem" ] && { CERT="$L/fullchain.pem"; KEY="$L/privkey.pem"; }
fi
if [ ! -s "$CERT" ]; then
  log "issuing a self-signed cert (no domain set; browser will warn once)"
  openssl req -x509 -newkey rsa:2048 -nodes -days 30 -subj "/CN=wonderland" -keyout "$KEY" -out "$CERT" 2>/dev/null || die "self-signed cert failed"
fi

# 8. nginx: terminate TLS on $SIGNALLING_TCP, proxy WSS to the signalling server,
#    locked to the approved browser origin.
cat > /etc/nginx/sites-available/wonderland <<NGINX
server {
  listen ${SIGNALLING_TCP} ssl;
  ssl_certificate     ${CERT};
  ssl_certificate_key ${KEY};
  location / {
    proxy_pass http://127.0.0.1:${PLAYER_PORT};
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    add_header Access-Control-Allow-Origin "${ORIGIN}" always;
  }
}
NGINX
ln -sf /etc/nginx/sites-available/wonderland /etc/nginx/sites-enabled/wonderland
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true
nginx -t 2>/dev/null && { pkill -x nginx 2>/dev/null || true; }

# 9. The supervisor — replaces systemd. Restarts coturn, signalling, nginx, and
#    the UE app if any dies. UE is pinned to the opened WebRTC UDP window.
# Staged UE Linux output is deeply nested (…/Linux/Wonderland/Binaries/Linux/), so search deep.
WONDERLAND_BIN="$(find "$APP" -maxdepth 8 -type f \( -name 'Wonderland.sh' -o -name 'WonderlandClient.sh' \) 2>/dev/null | head -1 || true)"
cat > "$WORK/wonderland-run.sh" <<RUN
#!/usr/bin/env bash
set -u
LOGDIR="$LOGDIR"; PSI_SIG="$PSI_SIG"; APP="$APP"
STREAMER_PORT=$STREAMER_PORT; PLAYER_PORT=$PLAYER_PORT
UDP_MIN=$UDP_MIN; UDP_MAX=$UDP_MAX
WONDERLAND_BIN="${WONDERLAND_BIN:-}"
PROFILE_CVARS="${PROFILE_CVARS:-}"
alive() { kill -0 "\$1" 2>/dev/null; }
start_turn()  { turnserver -c /etc/turnserver.conf >>"\$LOGDIR/coturn.log" 2>&1 & echo \$!; }
start_nginx() { nginx -g 'daemon off;' >>"\$LOGDIR/nginx.log" 2>&1 & echo \$!; }
start_sig()   { ( cd "\$PSI_SIG" && node cirrus.js --HttpPort \$PLAYER_PORT --StreamerPort \$STREAMER_PORT >>"\$LOGDIR/signalling.log" 2>&1 ) & echo \$!; }
start_app()   {
  [ -n "\$WONDERLAND_BIN" ] || { echo "no app binary yet" >>"\$LOGDIR/app.log"; return; }
  ( "\$WONDERLAND_BIN" -RenderOffscreen -AudioMixer \
      -PixelStreamingURL=ws://localhost:\$STREAMER_PORT -AllowPixelStreamingCommands \
      -PixelStreamingWebRTCMinPort=\$UDP_MIN -PixelStreamingWebRTCMaxPort=\$UDP_MAX \
      -ExecCmds="\$PROFILE_CVARS" >>"\$LOGDIR/app.log" 2>&1 ) & echo \$!
}
T=\$(start_turn); N=\$(start_nginx); S=\$(start_sig); A=\$(start_app)
while true; do
  alive "\$T" || T=\$(start_turn)
  alive "\$N" || N=\$(start_nginx)
  alive "\$S" || S=\$(start_sig)
  if [ -n "\$WONDERLAND_BIN" ] && { [ -z "\$A" ] || ! alive "\$A"; }; then A=\$(start_app); fi
  sleep 10
done
RUN
chmod +x "$WORK/wonderland-run.sh"

# Launch the supervisor detached so onstart can return while services persist.
if [ -x "$WORK/wonderland-run.sh" ]; then
  pkill -f wonderland-run.sh 2>/dev/null || true
  setsid bash "$WORK/wonderland-run.sh" >>"$LOGDIR/supervisor.log" 2>&1 < /dev/null &
  log "supervisor launched (pid $!); logs in $LOGDIR"
fi

[ -n "$WONDERLAND_BIN" ] && log "app binary: $WONDERLAND_BIN" || log "app binary NOT present yet — supervisor will start it once obtained"
log "onstart complete (authored, not run) — WebRTC pinned to ${UDP_MIN}-${UDP_MAX}, WSS on ${SIGNALLING_TCP}"
