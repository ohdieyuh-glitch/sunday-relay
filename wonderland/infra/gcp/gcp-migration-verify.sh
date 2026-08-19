#!/usr/bin/env bash
# Wonderland — staged Vast->GCP migration verification.
#
# The brief's twelve steps, in order, each one refusing to run until the one
# before it has passed. Split by what they cost:
#
#   1-4, 12   READ-ONLY. Run them now, as often as you like, for nothing.
#   5         THE PAID BOUNDARY. Plan-only: prints the create command.
#   6-11      Act on an instance that already exists.
#
# Nothing here decides on your behalf that GPU time should be bought, and
# nothing removes Vast. Vast stays the fallback until stage 12 passes.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GCP="${HERE}/wonderland-gcp.sh"
NAME="${GCP_INSTANCE_NAME:-wonderland-stream}"
ZONE="${GCP_ZONE:-us-central1-a}"
PROJECT="${GCP_PROJECT_ID:-}"
PASS=0; FAIL=0
ok()   { printf '  [pass] %s\n' "$*"; PASS=$((PASS+1)); }
bad()  { printf '  [FAIL] %s\n' "$*"; FAIL=$((FAIL+1)); }
hdr()  { printf '\n== %s\n' "$*"; }
g() { gcloud --project="$PROJECT" "$@"; }

s1_config() {
  hdr "1. configuration"
  [ -f "$GCP" ] && ok "provider script present" || bad "provider script missing"
  bash -n "$GCP" 2>/dev/null && ok "provider parses" || bad "provider does not parse"
  bash -n "${HERE}/gcp-startup.sh" 2>/dev/null && ok "startup script parses" || bad "startup script does not parse"
  [ -n "$PROJECT" ] && ok "GCP_PROJECT_ID set" || bad "GCP_PROJECT_ID unset — export it"
  # A config file that has grown a secret is worse than no config file.
  #
  # Excluding THIS script, because the pattern it greps for is written in it —
  # the first run flagged itself, which is a check that can never pass on a clean
  # tree and would have trained whoever ran it to ignore the one line that
  # matters.
  local self hits
  self="$(basename "${BASH_SOURCE[0]}")"
  hits="$(grep -RliE '(-----BEGIN [A-Z ]*PRIVATE KEY|"private_key"[[:space:]]*:|AIza[0-9A-Za-z_-]{30,})' \
          "$HERE" 2>/dev/null | grep -v "/$self\$" || true)"
  if [ -n "$hits" ]; then
    bad "credential-shaped content in infra/gcp — do NOT commit:"
    printf '      %s\n' $hits
  else
    ok "no credential-shaped content in infra/gcp"
  fi
}

s2_auth() {
  hdr "2. authentication"
  command -v gcloud >/dev/null 2>&1 || { bad "gcloud not installed"; return; }
  local a; a="$(gcloud config get-value account 2>/dev/null)"
  [ -n "$a" ] && [ "$a" != "(unset)" ] && ok "logged in as $a" || bad "not logged in — gcloud auth login"
  gcloud auth application-default print-access-token >/dev/null 2>&1 \
    && ok "application default credentials present" \
    || bad "no ADC — gcloud auth application-default login"
}

s3_api() {
  hdr "3. Compute Engine API"
  command -v gcloud >/dev/null 2>&1 || { bad "gcloud not installed"; return; }
  g services list --enabled --filter='config.name:compute.googleapis.com' \
    --format='value(config.name)' 2>/dev/null | grep -q compute \
    && ok "compute.googleapis.com enabled" \
    || bad "not enabled — gcloud services enable compute.googleapis.com"
  g beta billing projects describe "$PROJECT" --format='value(billingEnabled)' 2>/dev/null | grep -qi true \
    && ok "billing enabled" || bad "billing not enabled — link a billing account"
}

s4_quota() {
  hdr "4. quota and availability"
  command -v gcloud >/dev/null 2>&1 || { bad "gcloud not installed"; return; }
  "$GCP" preflight && ok "preflight clear" || bad "preflight blocked (see its output)"
}

s5_create() {
  hdr "5. create ONE test GPU VM  (PAID — plan only)"
  "$GCP" create
  printf '\n  Run the command above yourself, then: %s 6\n' "$0"
}

s6_boot() {
  hdr "6. VM boot"
  local st; st="$(g compute instances describe "$NAME" --zone "$ZONE" --format='value(status)' 2>/dev/null)"
  [ "$st" = "RUNNING" ] && ok "instance RUNNING" || { bad "instance status: ${st:-absent}"; return; }
  g compute instances get-serial-port-output "$NAME" --zone "$ZONE" 2>/dev/null \
    | grep -q "startup-script begin" && ok "startup script ran" || bad "startup script did not run"
}

s7_gpu() {
  hdr "7. GPU"
  local out
  out="$(g compute ssh "$NAME" --zone "$ZONE" --command 'nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv,noheader' 2>/dev/null)"
  [ -n "$out" ] && ok "nvidia-smi: $out" || bad "no GPU visible"
  g compute ssh "$NAME" --zone "$ZONE" --command 'docker run --rm --gpus all nvidia/cuda:12.3.0-base-ubuntu22.04 nvidia-smi -L' >/dev/null 2>&1 \
    && ok "container runtime sees the GPU" || bad "container runtime cannot see the GPU"
}

s8_bootstrap() {
  hdr "8. bootstrap"
  g compute ssh "$NAME" --zone "$ZONE" --command 'systemctl is-active wonderland-watchdog.service' 2>/dev/null \
    | grep -q active && ok "cost watchdog armed" || bad "cost watchdog NOT running — this is the expensive failure"
  g compute ssh "$NAME" --zone "$ZONE" --command 'docker image inspect ghcr.io/epicgames/unreal-engine:dev-5.8 >/dev/null 2>&1 && echo yes' 2>/dev/null \
    | grep -q yes && ok "UE image present" || bad "UE image not pulled (check the GHCR PAT)"
}

s9_workload() {
  hdr "9-10. a small real workload, and its result"
  # The smallest honest end-to-end: run the level generator's own offline dry run
  # inside the image. It exercises Python, the repo layout and the container, and
  # costs seconds rather than a full cook.
  local out
  out="$(g compute ssh "$NAME" --zone "$ZONE" --command \
    'cd /opt/wonderland/src/wonderland/infra/build 2>/dev/null && python3 verify-generator-dryrun.py 2>&1 | tail -2' 2>/dev/null)"
  printf '%s\n' "$out"
  printf '%s' "$out" | grep -q "DRY RUN OK" && ok "workload ran and returned a result" || bad "workload did not return DRY RUN OK"
}

s11_stop() {
  hdr "11. stop"
  "$GCP" stop && ok "stop issued" || bad "stop failed"
  sleep 20
  local st; st="$(g compute instances describe "$NAME" --zone "$ZONE" --format='value(status)' 2>/dev/null)"
  [ "$st" = "TERMINATED" ] && ok "instance TERMINATED (compute billing stopped)" || bad "status is ${st:-unknown}"
}

s12_orphans() {
  hdr "12. orphan check"
  command -v gcloud >/dev/null 2>&1 || { bad "gcloud not installed"; return; }
  local run disks ips
  run="$(g compute instances list --filter='status=RUNNING' --format='value(name)' 2>/dev/null | wc -l | tr -d ' ')"
  [ "$run" = "0" ] && ok "no RUNNING instances" || bad "$run instance(s) still RUNNING — they are billing"
  disks="$(g compute disks list --filter='-users:*' --format='value(name,sizeGb)' 2>/dev/null)"
  [ -z "$disks" ] && ok "no unattached disks" || { bad "unattached disks still billing:"; printf '      %s\n' "$disks"; }
  ips="$(g compute addresses list --filter='status=RESERVED' --format='value(name)' 2>/dev/null)"
  [ -z "$ips" ] && ok "no reserved-but-unused addresses" || { bad "reserved addresses still billing:"; printf '      %s\n' "$ips"; }
}

case "${1:-}" in
  1) s1_config ;; 2) s2_auth ;; 3) s3_api ;; 4) s4_quota ;;
  5) s5_create ;; 6) s6_boot ;; 7) s7_gpu ;; 8) s8_bootstrap ;;
  9|10) s9_workload ;; 11) s11_stop ;; 12) s12_orphans ;;
  readonly|"") s1_config; s2_auth; s3_api; s4_quota; s12_orphans ;;
  *) printf 'usage: %s [1..12|readonly]\n' "$0"; exit 1 ;;
esac
printf '\n%d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
