#!/usr/bin/env bash
# Wonderland — Google Compute Engine GPU lifecycle.
#
# The GCP sibling of ../vast/wonderland-vast.sh, deliberately built to the SAME
# shape, because this repository already had a two-provider convention (AWS
# ../wonderland.sh, Vast ../vast/wonderland-vast.sh) and inventing a third one
# would be churn. Same subcommands, same three authorization boundaries:
#
#   read-only  (preflight, quota, status, health, logs, ssh) — run freely. They
#              read the project and cost nothing.
#   create     (create) — the PAID boundary. PLAN-ONLY: it runs preflight and
#              PRINTS the exact `gcloud compute instances create` for you to run
#              by hand. Running it by hand IS the authorization this script
#              refuses to cross on your behalf. It never provisions.
#   lifecycle  (start, stop, delete) — act on an instance that already exists and
#              run DIRECTLY; typing the subcommand is the authorization. `start`
#              resumes and RESUMES BILLING, `stop` halts compute billing (the
#              disk still bills), `delete` ends both and asks first.
#
# WHY RELAY IS NOT INVOLVED. Relay's product code has no idea a GPU exists —
# grep src/ and relay-bridge/ for a provider name and you get nothing. The only
# seam between Relay and this machine is one browser env var,
# VITE_WONDERLAND_SIGNALLING_URL. So the provider abstraction lives HERE, at the
# shell, and adding a ComputeProvider interface inside Relay would create a
# coupling that does not presently exist.
#
# SECRETS: credentials come from Application Default Credentials or an attached
# service account. No JSON key is read, written, printed or committed. The GHCR
# pull token is taken from your shell at create time and echoed as a
# <PLACEHOLDER> only.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STARTUP="${HERE}/gcp-startup.sh"

# ---------------------------------------------------------------- configuration
PROJECT="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-us-central1}"
ZONE="${GCP_ZONE:-us-central1-a}"
GPU_TYPE="${GCP_GPU_TYPE:-nvidia-l4}"
GPU_COUNT="${GCP_GPU_COUNT:-1}"
MACHINE="${GCP_MACHINE_TYPE:-g2-standard-8}"
SERVICE_ACCOUNT="${GCP_SERVICE_ACCOUNT:-}"
PROV_MODEL="${GCP_PROVISIONING_MODEL:-STANDARD}"
DISK_GB="${GCP_BOOT_DISK_GB:-250}"
DISK_TYPE="${GCP_BOOT_DISK_TYPE:-pd-balanced}"
KEEP_DISK="${GCP_KEEP_DISK_ON_DELETE:-false}"
NAME="${GCP_INSTANCE_NAME:-wonderland-stream}"
MAX_INSTANCES="${GCP_MAX_INSTANCES:-1}"
MAX_RUNTIME_MIN="${GCP_MAX_RUNTIME_MIN:-240}"
IDLE_MIN="${GCP_IDLE_SHUTDOWN_MIN:-30}"
IMAGE="${IMAGE:-ghcr.io/epicgames/unreal-engine:dev-5.8}"
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-https://sunday-relay.vercel.app}"
QUALITY_PROFILE="${QUALITY_PROFILE:-WONDERLAND_BROWSER_ULTRA}"
BUILD_URL="${BUILD_URL:-}"
SIGNALLING_TCP="${SIGNALLING_TCP:-443}"
TURN_PORT="${TURN_PORT:-3478}"
UDP_START="${WEBRTC_UDP_START:-50000}"
UDP_COUNT="${WEBRTC_UDP_COUNT:-10}"
UDP_END=$(( UDP_START + UDP_COUNT - 1 ))
FW_TAG="wonderland-stream"

say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }
mark() { if [ "$1" = 1 ]; then say "  [ok]      $2"; else say "  [BLOCKED] $2"; BLOCKED=$((BLOCKED+1)); fi; }
g() { gcloud --project="$PROJECT" "$@"; }

require_gcloud() {
  have gcloud || { say "gcloud is not installed. See ./README.md — installing it and running"; \
                   say "'gcloud auth login' are yours to do; this script will not work around auth."; exit 2; }
}

# ------------------------------------------------------------------- preflight
# Everything that can go wrong BEFORE money is spent, checked in the order that
# fails cheapest first. Anything needing a human decision stops here and says so
# rather than attempting a workaround.
preflight() {
  BLOCKED=0
  require_gcloud
  say "Wonderland GCP preflight"
  say ""

  local acct
  acct="$(gcloud config get-value account 2>/dev/null || true)"
  if [ -n "$acct" ] && [ "$acct" != "(unset)" ]; then mark 1 "authenticated as $acct"
  else mark 0 "authenticated  ->  run: gcloud auth login  AND  gcloud auth application-default login"; fi

  if [ -n "$PROJECT" ]; then mark 1 "project id set ($PROJECT)"
  else mark 0 "GCP_PROJECT_ID set  ->  gcloud projects list, then export GCP_PROJECT_ID=<id>"; fi
  [ -n "$PROJECT" ] || { say ""; say "Cannot continue without a project."; return 1; }

  # Billing. A project without an active billing account cannot create a GPU at
  # all, and the error you get otherwise is unhelpfully generic.
  if g beta billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null | grep -qi true; then
    mark 1 "billing enabled on the project"
  else
    mark 0 "billing enabled  ->  console.cloud.google.com/billing, link a billing account to $PROJECT"
  fi

  if g services list --enabled --filter='config.name:compute.googleapis.com' --format='value(config.name)' 2>/dev/null | grep -q compute; then
    mark 1 "Compute Engine API enabled"
  else
    mark 0 "Compute Engine API  ->  gcloud services enable compute.googleapis.com"
  fi

  # GPU quota, global and regional. New projects ship with ZERO of both and the
  # increase is Google's to approve, not something this script can route around.
  local gq rq
  gq="$(g compute project-info describe --format='value(quotas.limit)' --flatten='quotas[]' \
        --filter='quotas.metric=GPUS_ALL_REGIONS' 2>/dev/null | head -1)"
  rq="$(g compute regions describe "$REGION" --format='value(quotas.limit)' --flatten='quotas[]' \
        --filter="quotas.metric=NVIDIA_L4_GPUS" 2>/dev/null | head -1)"
  if [ -n "$gq" ] && [ "${gq%.*}" -ge "$GPU_COUNT" ] 2>/dev/null; then mark 1 "global GPU quota: $gq"
  else mark 0 "global GPU quota (GPUS_ALL_REGIONS=${gq:-0})  ->  IAM & Admin > Quotas, request >= $GPU_COUNT"; fi
  if [ -n "$rq" ] && [ "${rq%.*}" -ge "$GPU_COUNT" ] 2>/dev/null; then mark 1 "$REGION GPU quota: $rq"
  else mark 0 "regional quota (NVIDIA_L4_GPUS in $REGION = ${rq:-0})  ->  IAM & Admin > Quotas, request >= $GPU_COUNT"; fi

  # Is the accelerator actually offered in this zone, and does the machine type
  # exist there? Both are per-zone and both fail late and confusingly otherwise.
  if g compute accelerator-types describe "$GPU_TYPE" --zone "$ZONE" >/dev/null 2>&1; then
    mark 1 "$GPU_TYPE offered in $ZONE"
  else
    mark 0 "$GPU_TYPE in $ZONE  ->  try another zone: gcloud compute accelerator-types list --filter=name~$GPU_TYPE"
  fi
  if g compute machine-types describe "$MACHINE" --zone "$ZONE" >/dev/null 2>&1; then
    mark 1 "machine type $MACHINE exists in $ZONE"
  else
    mark 0 "machine type $MACHINE in $ZONE"
  fi

  # The single-instance ceiling, same idea as the Vast label ceiling.
  local n
  n="$(g compute instances list --filter="name=$NAME" --format='value(name)' 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$n" -lt "$MAX_INSTANCES" ]; then mark 1 "instance ceiling: $n/$MAX_INSTANCES named $NAME"
  else mark 0 "instance ceiling reached ($n/$MAX_INSTANCES named $NAME) — stop or delete it first"; fi

  if [ "$GPU_COUNT" -le 1 ]; then mark 1 "GPU count is $GPU_COUNT"
  else mark 0 "GPU_COUNT=$GPU_COUNT — refusing to plan a multi-GPU instance without a deliberate override"; fi

  if [ -f "$STARTUP" ] && bash -n "$STARTUP" 2>/dev/null; then mark 1 "startup script present and parses"
  else mark 0 "startup script present and parses ($STARTUP)"; fi

  say ""
  if [ "$BLOCKED" -eq 0 ]; then say "preflight: clear."; return 0; fi
  say "preflight: $BLOCKED blocked. Each line above says exactly what to do."
  return 1
}

quota() {
  require_gcloud
  say "GPU quota for $PROJECT"
  g compute project-info describe --flatten='quotas[]' \
    --format='table(quotas.metric,quotas.limit,quotas.usage)' \
    --filter='quotas.metric~GPU' 2>/dev/null || true
  say ""
  say "Region $REGION"
  g compute regions describe "$REGION" --flatten='quotas[]' \
    --format='table(quotas.metric,quotas.limit,quotas.usage)' \
    --filter='quotas.metric~GPU' 2>/dev/null || true
}

# ------------------------------------------------- the paid-provisioning boundary
create() {
  preflight || { say ""; say "Refusing to emit a create command: preflight is BLOCKED."; return 1; }
  local spot_flags=""
  if [ "$PROV_MODEL" = "SPOT" ]; then
    spot_flags="--provisioning-model=SPOT --instance-termination-action=DELETE"
  fi
  say ""
  say "# ---------------------------------------------------------------------"
  say "# PAID. Run this yourself — that is the authorization. Roughly:"
  say "#   g2-standard-8 + 1x L4, $REGION, STANDARD  ~\$0.85-1.00/hr"
  say "#                                    SPOT     ~\$0.30-0.40/hr"
  say "#   plus ${DISK_GB}GB ${DISK_TYPE} (~\$0.10/GB/month, billed while the disk exists)"
  say "# The VM shuts ITSELF down after ${MAX_RUNTIME_MIN} min, or ${IDLE_MIN} min with no viewer."
  say "# ---------------------------------------------------------------------"
  say ""
  say "export GHCR_USER=<github-username>   # not stored anywhere by this script"
  say "export GHCR_PAT=<classic PAT, read:packages>"
  say ""
  say "gcloud compute instances create ${NAME} \\"
  say "  --project=${PROJECT} --zone=${ZONE} \\"
  say "  --machine-type=${MACHINE} \\"
  say "  --accelerator=type=${GPU_TYPE},count=${GPU_COUNT} \\"
  say "  --maintenance-policy=TERMINATE --restart-on-failure \\"
  [ -n "$spot_flags" ] && say "  ${spot_flags} \\"
  say "  --image-family=common-cu123-ubuntu-2204 --image-project=deeplearning-platform-release \\"
  say "  --boot-disk-size=${DISK_GB}GB --boot-disk-type=${DISK_TYPE} \\"
  say "  --tags=${FW_TAG} \\"
  [ -n "$SERVICE_ACCOUNT" ] && say "  --service-account=${SERVICE_ACCOUNT} \\"
  say "  --scopes=https://www.googleapis.com/auth/cloud-platform \\"
  say "  --metadata-from-file=startup-script=${STARTUP} \\"
  say "  --metadata=^::^wonderland-image=${IMAGE}::wonderland-allowed-origin=${ALLOWED_ORIGIN}::wonderland-quality=${QUALITY_PROFILE}::wonderland-build-url=${BUILD_URL}::wonderland-max-runtime-min=${MAX_RUNTIME_MIN}::wonderland-idle-min=${IDLE_MIN}::wonderland-signalling-tcp=${SIGNALLING_TCP}::wonderland-turn-port=${TURN_PORT}::wonderland-udp-start=${UDP_START}::wonderland-udp-end=${UDP_END}::ghcr-user=\${GHCR_USER}::ghcr-pat=\${GHCR_PAT}"
  say ""
  say "# The image family above ships the NVIDIA driver and CUDA already, which is"
  say "# the difference that matters versus Vast: there the host provided the"
  say "# driver through the container runtime; here the VM has to have it."
  say ""
  say "# Open the ports once per project (idempotent):"
  say "gcloud compute firewall-rules create ${FW_TAG}-tcp --project=${PROJECT} \\"
  say "  --allow=tcp:22,tcp:${SIGNALLING_TCP} --target-tags=${FW_TAG} --direction=INGRESS || true"
  say "gcloud compute firewall-rules create ${FW_TAG}-media --project=${PROJECT} \\"
  say "  --allow=tcp:${TURN_PORT},udp:${TURN_PORT},udp:${UDP_START}-${UDP_END} \\"
  say "  --target-tags=${FW_TAG} --direction=INGRESS || true"
  say ""
  say "# Afterwards:  $0 status    $0 health    $0 stop    $0 delete"
}

status() {
  require_gcloud
  g compute instances list --filter="name=$NAME" \
    --format='table(name,zone.basename(),machineType.basename(),status,scheduling.provisioningModel,networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null \
    || say "no instance named $NAME"
}

ip_of() { g compute instances describe "$NAME" --zone "$ZONE" \
  --format='value(networkInterfaces[0].accessConfigs[0].natIP)' 2>/dev/null; }

start() {
  require_gcloud
  say "starting $NAME — THIS RESUMES BILLING"
  g compute instances start "$NAME" --zone "$ZONE"
  say "started. external IP: $(ip_of)"
  say "Reminder: the VM self-terminates after ${MAX_RUNTIME_MIN} min or ${IDLE_MIN} min idle."
}

stop() {
  require_gcloud
  say "stopping $NAME — halts COMPUTE billing; the ${DISK_GB}GB disk still bills"
  g compute instances stop "$NAME" --zone "$ZONE"
  say "stopped."
}

delete() {
  require_gcloud
  say "DELETE $NAME in $ZONE. This destroys the VM."
  if [ "$KEEP_DISK" = "true" ]; then say "The boot disk is KEPT (GCP_KEEP_DISK_ON_DELETE=true) and continues to bill."
  else say "The boot disk is DELETED with it. Anything on it that exists nowhere else is gone."; fi
  printf 'type the instance name to confirm: '
  read -r ans
  [ "$ans" = "$NAME" ] || { say "not confirmed; nothing done."; return 1; }
  if [ "$KEEP_DISK" = "true" ]; then
    g compute instances delete "$NAME" --zone "$ZONE" --keep-disks=boot --quiet
  else
    g compute instances delete "$NAME" --zone "$ZONE" --quiet
  fi
  say "deleted."
}

ssh_in() { require_gcloud; g compute ssh "$NAME" --zone "$ZONE" -- "$@"; }

logs() {
  require_gcloud
  say "--- serial console (boot + startup-script) ---"
  g compute instances get-serial-port-output "$NAME" --zone "$ZONE" 2>/dev/null | tail -80
}

health() {
  require_gcloud
  local st ip
  st="$(g compute instances describe "$NAME" --zone "$ZONE" --format='value(status)' 2>/dev/null || true)"
  [ -n "$st" ] || { say "no instance named $NAME"; return 1; }
  say "instance      : $st"
  ip="$(ip_of)"; say "external IP   : ${ip:-none}"
  [ "$st" = "RUNNING" ] || { say "not running; nothing further to check."; return 0; }
  say "GPU           : $(g compute ssh "$NAME" --zone "$ZONE" --command 'nvidia-smi --query-gpu=name,utilization.gpu,memory.used --format=csv,noheader' 2>/dev/null || echo unreachable)"
  say "streamer      : $(g compute ssh "$NAME" --zone "$ZONE" --command 'pgrep -x Wonderland >/dev/null && echo running || echo down' 2>/dev/null || echo unreachable)"
  say "signalling    : $(g compute ssh "$NAME" --zone "$ZONE" --command "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/" 2>/dev/null || echo unreachable)"
}

usage() {
  cat <<USAGE
wonderland-gcp.sh <subcommand>

  read-only   preflight   every gate before money: auth, billing, API, quota, zone, ceiling
              quota       GPU quota, global and regional
              status      the instance, if any
              health      GPU / streamer / signalling
              logs        serial console output
              ssh         shell in

  paid        create      PLAN ONLY. Prints the gcloud command for you to run.

  lifecycle   start       resume  (RESUMES BILLING)
              stop        halt    (compute billing stops, disk keeps billing)
              delete      destroy (asks first)

Configure with wonderland/infra/gcp/gcp.env.example.
USAGE
}

case "${1:-}" in
  preflight) preflight ;;
  quota)     quota ;;
  create)    create ;;
  status)    status ;;
  start)     start ;;
  stop)      stop ;;
  delete|destroy) delete ;;
  ssh)       shift; ssh_in "$@" ;;
  logs)      logs ;;
  health)    health ;;
  help|-h|--help) usage ;;
  # An unknown subcommand must FAIL. Printing usage and exiting 0 means a typo in
  # automation reports success — `wonderland-gcp.sh statsu` would look like it
  # worked. Explicit help still exits 0, because asking for help succeeded.
  "")        usage; exit 2 ;;
  *)         printf 'unknown subcommand: %s\n\n' "$1"; usage; exit 2 ;;
esac
