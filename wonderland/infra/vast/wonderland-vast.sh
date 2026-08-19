#!/usr/bin/env bash
# Wonderland — Vast.ai GPU lifecycle (the ACTIVE GPU provider).
#
# Vast.ai replaced AWS as the active Wonderland GPU path: a live marketplace of
# GPU hosts rented by the hour. The AWS Terraform/EC2 stack is preserved under
# ../terraform + ../scripts as DEFERRED/optional infrastructure — nothing here
# imports or requires it.
#
# Three kinds of subcommand, three authorization boundaries (same shape as the
# AWS wonderland.sh):
#   read-only     (preflight, offer, balance, status, health, logs, ssh) — RUN
#                 NOW. They read the marketplace/account and charge nothing.
#   create        (create) — the PAID-RENT boundary. PLAN-ONLY: it runs preflight
#                 and PRINTS the exact `vastai create instance` command for the
#                 operator to run BY HAND. Running it by hand IS the authorization
#                 this script deliberately does not cross. It never rents.
#   lifecycle     (start, stop, destroy) — act on an ALREADY-RENTED instance and
#                 execute DIRECTLY; typing the subcommand IS the authorization.
#                 `start` resumes a stopped instance and RESTARTS hourly billing;
#                 `stop` halts billing; `destroy` permanently deletes it (also
#                 halts billing) and asks for confirmation first.
#
# SECRETS: the Vast API key (read by the vastai CLI from ~/.vast_api_key or
# $VAST_API_KEY) and any container-registry PAT are NEVER printed or logged by
# this script. The create command shows registry creds as <PLACEHOLDERS> only.
set -euo pipefail

# ---------------------------------------------------------------- configuration
# Every value is overridable by an env var of the same name. Defaults describe
# the founder's selection — offer 24964770 (1x L40S, 46.1GB VRAM, 32 vCPU,
# 128.9GB RAM, 969GB disk, Japan, $0.6009/hr, verified) — and Wonderland's needs.
#
# EPHEMERAL OFFER IDS (proven against the live marketplace): Vast RE-ISSUES the
# ask-id on almost every query — the Japan L40S host appeared as 24964770,
# 24964771, 24964709, 24964750, 24964753 across consecutive searches seconds
# apart. A pinned id is therefore stale by rent time. So we SELECT the current
# best offer matching the machine PROFILE (GPU + minimums + geo/price preference)
# at rent time, never a fixed id. REFERENCE_OFFER records the founder's original
# for traceability; OFFER_ID, if you set it, is honoured ONLY when still listed.
REFERENCE_OFFER="${REFERENCE_OFFER:-24964770}"   # the founder's original id (documentation/traceability)
OFFER_ID="${OFFER_ID:-}"                    # optional pin; empty = select current best matching offer
PREFER_GEO="${PREFER_GEO:-Japan}"           # soft preference (the founder's choice); falls back to any geo
MAX_DPH="${MAX_DPH:-0.70}"                  # soft price ceiling for the preferred pick (a bit above $0.6009)
GPU_NAME="${GPU_NAME:-L40S}"                # required GPU model
EXPECTED_DPH="${EXPECTED_DPH:-0.6009}"      # offer's shown $/hr (display only; live value wins)
DISK_GB="${DISK_GB:-200}"                   # requested local disk — UE 5.8 + build/package (NOT the 10GB default)
IMAGE="${IMAGE:-ghcr.io/epicgames/unreal-engine:dev-5.8}"  # build-on-instance path (private; needs --login)
LABEL="${LABEL:-wonderland-stream}"         # instance label — the single-instance ceiling key
ALLOWED_ORIGIN="${ALLOWED_ORIGIN:-https://sunday-relay.vercel.app}"
QUALITY_PROFILE="${QUALITY_PROFILE:-WONDERLAND_BROWSER_ULTRA}"
BUILD_URL="${BUILD_URL:-}"                  # optional: pre-built artifact URL (non-AWS); empty = build on instance

# Hardware minimums Wonderland actually needs (used to VERIFY the offer and to
# build an honest replacement search if the offer is gone).
MIN_GPU_RAM_GB="${MIN_GPU_RAM_GB:-40}"      # L40S is ~46GB
MIN_VCPUS="${MIN_VCPUS:-16}"               # HARD floor of EFFECTIVE vCPUs (a real UE build host)
PREF_VCPUS="${PREF_VCPUS:-32}"             # PREFERRED effective vCPUs (the founder's profile)
MIN_RAM_GB="${MIN_RAM_GB:-64}"            # HARD RAM floor (the profile prefers ~128GB)
MIN_RELIABILITY="${MIN_RELIABILITY:-0.98}"

# Port plan. Vast maps DISCRETE ports (it cannot map AWS's 16k-wide UDP range),
# so WebRTC media is pinned to a SMALL window that UE Pixel Streaming is told to
# use (-PixelStreamingWebRTCMin/MaxPort in the onstart); coturn shares that window.
SIGNALLING_TCP="${SIGNALLING_TCP:-443}"     # WSS signalling (browser <-> host)
TURN_PORT="${TURN_PORT:-3478}"              # STUN/TURN (tcp+udp)
WEBRTC_UDP_START="${WEBRTC_UDP_START:-50000}"
WEBRTC_UDP_COUNT="${WEBRTC_UDP_COUNT:-10}"  # 50000..50009: WebRTC media window (PS2 pins UE here)
WEBRTC_UDP_END=$(( WEBRTC_UDP_START + WEBRTC_UDP_COUNT - 1 ))
# certbot's port 80 is opened ONLY when a real TLS domain is set; the default
# self-signed path does not need it — so the port count is domain-dependent.
SIGNALLING_DOMAIN="${WONDERLAND_SIGNALLING_DOMAIN:-}"
ACME_TCP=80
_acme_ports=0; [ -n "$SIGNALLING_DOMAIN" ] && _acme_ports=1
# ACTUAL direct-port need = ssh(1) + WSS 443(1) + TURN tcp+udp(2) + media(N) + acme(0|1)
REQUIRED_PORTS=$(( 1 + 1 + 2 + WEBRTC_UDP_COUNT + _acme_ports ))

HERE="$(cd "$(dirname "$0")" && pwd)"
ONSTART="${HERE}/vast-onstart.sh"

say() { printf '%s\n' "$*"; }
have() { command -v "$1" >/dev/null 2>&1; }

# JSON helper — jq is not guaranteed on the operator box; python3 is. Reads JSON
# on stdin and runs the given python expression against the parsed value `d`.
pyjson() { python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    sys.exit(3)
'"$1" 2>/dev/null; }

require_cli() {
  have vastai || { say "vastai CLI not found. Install: pip install --upgrade vastai"; return 1; }
}

# Authenticated? `show user` fails (non-zero / empty) when no API key is set.
authed() { vastai show user --raw 2>/dev/null | pyjson 'print("ok") if isinstance(d,dict) and (d.get("id") or d.get("email") or d.get("username")) else sys.exit(1)' | grep -q ok; }

# SELECT the current best offer matching the machine profile, LIVE. Vast re-issues
# ask-ids on almost every query, so we never rely on a pinned id: we pick the best
# offer meeting the minimums right now. An explicit OFFER_ID is honoured ONLY if it
# is still listed; otherwise we fall through to the current best (with a notice).
# Prefers PREFER_GEO within MAX_DPH, else the cheapest match. NEVER below minimums.
# Output line 1: SELECTED=<id>|<dph>|<geo>|<vcpu_eff>|<ram_gb>|<disk_gb>|<ports>  or  SELECTED=none
#   (vcpu_eff = cpu_cores_effective, NOT the host's cpu_cores; ram from cpu_ram)
select_offer() {
  require_cli >/dev/null 2>&1 || { say "SELECTED=none"; say "  vastai CLI not installed"; return 1; }
  authed || { say "SELECTED=none"; say "  vastai not authenticated (vastai set api-key <KEY>)"; return 1; }
  # The minimums+rentable query is the reliable oracle (it already excludes
  # anything below spec). Retry only to smooth an empty marketplace response.
  local raw="" tries="${VAST_OFFER_RETRIES:-3}" i
  for (( i=1; i<=tries; i++ )); do
    raw="$(vastai search offers "gpu_name=${GPU_NAME} num_gpus=1 gpu_ram>=${MIN_GPU_RAM_GB} disk_space>=${DISK_GB} cpu_cores>=${MIN_VCPUS} direct_port_count>=${REQUIRED_PORTS} reliability>${MIN_RELIABILITY} rentable=true verified=true" -o 'dph' --raw 2>/dev/null || true)"
    printf '%s' "$raw" | grep -q '"id"' && break
    [ "$i" -lt "$tries" ] && sleep 2 || true
  done
  printf '%s' "$raw" | OFFER_ID="$OFFER_ID" PREFER_GEO="$PREFER_GEO" MAX_DPH="$MAX_DPH" \
    MIN_VCPUS="$MIN_VCPUS" MIN_RAM_GB="$MIN_RAM_GB" PREF_VCPUS="$PREF_VCPUS" python3 -c '
import sys,json,os
try: rows=json.load(sys.stdin)
except Exception: print("SELECTED=none"); print("  marketplace query returned nothing"); sys.exit(0)
if isinstance(rows,dict): rows=rows.get("offers",[]) or []
def dph(r):  return float(r.get("dph_total", r.get("dph", 1e9)))
# cpu_cores is the HOST total; cpu_cores_effective is the vCPUs THIS offer gets.
# cpu_ram is system RAM in MB. Never confuse the two.
def vcpu(r): return float(r.get("cpu_cores_effective", r.get("cpu_cores", 0)) or 0)
def ram(r):  return float(r.get("cpu_ram", 0) or 0) / 1000.0
def vram(r): return float(r.get("gpu_ram", 0) or 0) / 1000.0
minv=float(os.environ.get("MIN_VCPUS","0") or 0); minr=float(os.environ.get("MIN_RAM_GB","0") or 0)
prefv=float(os.environ.get("PREF_VCPUS","0") or 0)
# Precise HARD minimums on EFFECTIVE vCPUs + RAM (the query prefilter uses host cores).
rows=[r for r in rows if int(r.get("id",-1))>0 and vcpu(r)>=minv and ram(r)>=minr]
rows.sort(key=dph)
if not rows:
    print("SELECTED=none"); print("  no offer meets the vCPU/RAM/GPU minimums right now — re-run shortly (the marketplace changes constantly)"); sys.exit(0)
pin=os.environ.get("OFFER_ID","").strip()
pick=None
if pin:
    pick=next((r for r in rows if str(r.get("id"))==pin), None)
    if pick is None: print("  note: pinned OFFER_ID %s is no longer listed (Vast ids are ephemeral) — selecting current best" % pin)
if pick is None:
    geo=os.environ.get("PREFER_GEO","").strip().lower()
    cap=float(os.environ.get("MAX_DPH","1e9") or 1e9)
    def gm(r): return bool(geo) and geo in (r.get("geolocation","") or "").lower()
    # Tiered preference (cheapest within each tier, tiers already dph-sorted):
    #   1) preferred geo + >=PREF vCPUs + <=price cap   2) >=PREF vCPUs + <=cap
    #   3) preferred geo (any vCPU>=floor)              4) cheapest meeting the floor
    tiers=[[r for r in rows if gm(r) and vcpu(r)>=prefv and dph(r)<=cap],
           [r for r in rows if vcpu(r)>=prefv and dph(r)<=cap],
           [r for r in rows if gm(r)]]
    pick=next((t[0] for t in tiers if t), rows[0])
# Never a SILENT downgrade: if the pick is below the preferred vCPU tier, say so loudly.
if vcpu(pick) < prefv:
    print("  WARNING: no offer with the preferred %.0f effective vCPUs is available right now;" % prefv)
    print("           picked %.0f vCPUs (>= the %.0f hard floor). Re-run for the full profile, or accept this." % (vcpu(pick), minv))
# SELECTED=id|dph|geo|vcpu_eff|ram_gb|disk_gb|ports  (create reads only fields 1-3)
print("SELECTED=%s|%.4f|%s|%.0f|%.1f|%.0f|%.0f" % (pick.get("id"), dph(pick), pick.get("geolocation","?"),
    vcpu(pick), ram(pick), float(pick.get("disk_space",0)), float(pick.get("direct_port_count",0))))
print("  picked id=%s  $%.4f/hr  %s | vram=%.1fGB vcpu=%.0f ram=%.1fGB disk=%.0fGB ports=%.0f"
      % (pick.get("id"), dph(pick), pick.get("geolocation","?"), vram(pick), vcpu(pick), ram(pick),
         float(pick.get("disk_space",0)), float(pick.get("direct_port_count",0))))
alts=[r for r in rows if r is not pick][:4]
if alts:
    print("  alternatives (cheapest-first):")
    for r in alts:
        print("    id=%s $%.4f/hr %s vcpu=%.0f ram=%.1fGB disk=%.0fGB ports=%.0f"
              % (r.get("id"), dph(r), r.get("geolocation","?"), vcpu(r), ram(r),
                 float(r.get("disk_space",0)), float(r.get("direct_port_count",0))))
'
}

# Instances we own that carry our label — the single-instance ceiling.
our_instances() {
  vastai show instances --raw 2>/dev/null | LABEL="$LABEL" python3 -c '
import sys,json,os
try: rows=json.load(sys.stdin)
except Exception: sys.exit(0)
if isinstance(rows,dict): rows=rows.get("instances",[]) or []
lab=os.environ["LABEL"]
for r in rows:
    if (r.get("label") or "")==lab:
        print("%s %s %s" % (r.get("id"), r.get("actual_status") or r.get("cur_state") or "?", r.get("public_ipaddr") or ""))
' 2>/dev/null || true
}

# ----------------------------------------------------------------- subcommands

preflight() {
  local ok=1
  mark() { if [ "$1" = "1" ]; then say "  [ok] $2"; else say "  [--] $2"; ok=0; fi; }
  say "Wonderland Vast preflight (profile=${GPU_NAME}/${PREFER_GEO:-any} disk=${DISK_GB}GB ports=${REQUIRED_PORTS} ref=${REFERENCE_OFFER}):"

  if require_cli >/dev/null 2>&1; then mark 1 "vastai CLI installed ($(vastai --version 2>/dev/null | head -1))"; else mark 0 "vastai CLI installed (pip install --upgrade vastai)"; fi
  if authed; then mark 1 "vastai authenticated"; else mark 0 "vastai authenticated (vastai set api-key <KEY>)"; fi

  # onstart script present + syntactically valid (no spend).
  if [ -f "$ONSTART" ]; then mark 1 "onstart script present ($ONSTART)"; else mark 0 "onstart script present"; fi
  if bash -n "$ONSTART" 2>/dev/null; then mark 1 "onstart script parses (bash -n)"; else mark 0 "onstart script parses (bash -n)"; fi

  # disk sanity (never the 10GB default).
  if [ "${DISK_GB}" -ge 60 ]; then mark 1 "requested disk ${DISK_GB}GB is realistic for UE 5.8 (>=60)"; else mark 0 "requested disk ${DISK_GB}GB too small for UE 5.8"; fi

  # live offer SELECTION + no-conflict + balance (only when authenticated).
  if authed; then
    # Use the caller's already-made selection when given (create passes PRESELECTED
    # so exactly ONE marketplace query feeds both preflight and the emitted command).
    local sel selline selid
    if [ -n "${PRESELECTED:-}" ]; then sel="$PRESELECTED"; else sel="$(select_offer || true)"; fi
    selline="$(printf '%s\n' "$sel" | sed -n 's/^SELECTED=//p' | head -1)"
    printf '%s\n' "$sel" | sed '/^SELECTED=/d' | sed 's/^/     /'
    if [ -n "$selline" ] && [ "$selline" != "none" ]; then
      selid="${selline%%|*}"
      mark 1 "a matching ${GPU_NAME} offer is rentable NOW (id=${selid}) meeting every minimum"
    else
      mark 0 "no matching ${GPU_NAME} offer is rentable right now — re-run shortly (marketplace churns constantly)"
    fi
    local existing; existing="$(our_instances)"
    if [ -z "$existing" ]; then mark 1 "no conflicting '${LABEL}' instance"; else mark 0 "a '${LABEL}' instance already exists: ${existing}"; fi
    # balance, if observable.
    local bal
    bal="$(vastai show user --raw 2>/dev/null | python3 -c 'import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(0)
b=d.get("credit", d.get("balance"))
print("%.2f"%float(b)) if b is not None else None' 2>/dev/null || true)"
    if [ -n "$bal" ]; then
      # need ~1 hour of runway at the shown rate.
      if awk "BEGIN{exit !(${bal} >= ${EXPECTED_DPH})}"; then mark 1 "account balance \$${bal} covers >=1h at \$${EXPECTED_DPH}/hr"; else mark 0 "account balance \$${bal} below 1h at \$${EXPECTED_DPH}/hr"; fi
    else
      say "  [~~] account balance not observable (skipped, not failed)"
    fi
  else
    say "  [~~] offer/hardware/ports/balance checks need auth — run 'vastai set api-key <KEY>' then re-run"
  fi

  if [ "$ok" -eq 1 ]; then say "PREFLIGHT: READY"; else say "PREFLIGHT: BLOCKED (fix the [--] rows above)"; return 1; fi
}

# Build the exact env string (port map + non-secret env) for the create command.
env_string() {
  # SSH is provided by --ssh --direct (Vast assigns its own direct port). We open
  # exactly what PS2 + TURN need: WSS 443, TURN 3478 tcp+udp, and the pinned media
  # window. Port 80 is added ONLY for certbot when a real TLS domain is set.
  local e="-p ${SIGNALLING_TCP}:${SIGNALLING_TCP}"
  [ -n "$SIGNALLING_DOMAIN" ] && e="$e -p ${ACME_TCP}:${ACME_TCP}"
  e="$e -p ${TURN_PORT}:${TURN_PORT} -p ${TURN_PORT}:${TURN_PORT}/udp"
  local p
  for (( p=WEBRTC_UDP_START; p<=WEBRTC_UDP_END; p++ )); do e="$e -p ${p}:${p}/udp"; done
  e="$e -e WONDERLAND_ALLOWED_ORIGIN=${ALLOWED_ORIGIN}"
  e="$e -e WONDERLAND_QUALITY_PROFILE=${QUALITY_PROFILE}"
  e="$e -e WONDERLAND_SIGNALLING_TCP=${SIGNALLING_TCP}"
  e="$e -e WONDERLAND_WEBRTC_UDP_START=${WEBRTC_UDP_START}"
  e="$e -e WONDERLAND_WEBRTC_UDP_END=${WEBRTC_UDP_END}"
  [ -n "$SIGNALLING_DOMAIN" ]        && e="$e -e WONDERLAND_SIGNALLING_DOMAIN=${SIGNALLING_DOMAIN}"
  [ -n "${WONDERLAND_REPO_URL:-}" ]  && e="$e -e WONDERLAND_REPO_URL=${WONDERLAND_REPO_URL}"
  [ -n "$BUILD_URL" ]                && e="$e -e WONDERLAND_BUILD_URL=${BUILD_URL}"
  printf '%s' "$e"
}

# THE PAID-RENT AUTHORIZATION BOUNDARY. Never runs `vastai create`; runs
# preflight, then PRINTS the exact command for the operator to run by hand.
# ------------------------------------------------- LEGACY PROVIDER GUARD
# Vast is no longer the active provider; GCP is (../gcp/wonderland-gcp.sh). Vast
# is kept as a FALLBACK, which means its lifecycle commands still work — you can
# still start, stop, inspect and rescue the existing instance, and you should be
# able to without ceremony.
#
# What is disabled is RENTING SOMETHING NEW. That is the one Vast action that
# would quietly re-establish the provider the project has migrated off, and it
# is the one the brief asks to prevent. Opting back in is deliberate and loud:
#
#   WONDERLAND_PROVIDER=vast ./wonderland-vast.sh create
#
# The guard sits on `create` only. Guarding `start` would make the fallback
# useless in the exact emergency it exists for.
legacy_guard() {
  [ "${WONDERLAND_PROVIDER:-gcp}" = "vast" ] && return 0
  say "REFUSING: this project is migrating to GCP. New Vast rentals are off."
  say "  (GCP is DESIGNATED, not proven — it has never provisioned anything.)"
  say "    ../gcp/wonderland-gcp.sh preflight"
  say ""
  say "Renting new Vast capacity would re-establish the provider this project has"
  say "migrated off. Lifecycle commands on the EXISTING instance still work —"
  say "start / stop / destroy / status / ssh / logs — because that is what a"
  say "fallback is for."
  say ""
  say "If you genuinely mean it:  WONDERLAND_PROVIDER=vast $0 create"
  return 1
}

create() {
  legacy_guard || return 1
  # ONE live selection, carried ATOMICALLY into both the preflight display and the
  # emitted command. Vast re-issues ids per query, so a second selection would
  # drift — this is the fix for the "picked A / created B" inconsistency.
  local sel selline selid seldph selgeo
  sel="$(select_offer || true)"
  selline="$(printf '%s\n' "$sel" | sed -n 's/^SELECTED=//p' | head -1)"
  if [ -z "$selline" ] || [ "$selline" = "none" ]; then
    printf '%s\n' "$sel" | sed '/^SELECTED=/d'
    say ""; say "Refusing: no matching offer meets the profile right now. Re-run shortly (do NOT fall back to a stale id)."; return 1
  fi
  selid="${selline%%|*}"; seldph="$(printf '%s' "$selline" | cut -d'|' -f2)"; selgeo="$(printf '%s' "$selline" | cut -d'|' -f3)"
  # Preflight the OTHER gates against THIS exact selection (no second marketplace query).
  PRESELECTED="$sel" preflight || { say ""; say "Refusing to emit a create command: preflight is BLOCKED."; return 1; }
  local envs; envs="$(env_string)"
  say ""
  say "SELECTED_LIVE_ID=${selid}"
  say "================= VAST CREATE (run BY HAND to authorize the rent) ================="
  say "# This script does NOT run this command. Running it yourself IS the authorization."
  say "# Selected LIVE just now: id=${selid}  \$${seldph}/hr  ${selgeo}  (the command below uses THIS id)"
  say "# Vast ids DRIFT — run PROMPTLY. If it errors 'not available', re-run create for a fresh id."
  say "#"
  say "# FIRST export your GHCR creds in THIS shell (never written to the repo, never printed):"
  say "#   export GHCR_USER=<your-github-username>"
  say "#   export GHCR_PAT=<classic-PAT-with-read:packages-only>"
  say ""
  say "vastai create instance ${selid} \\"
  say "  --image ${IMAGE} \\"
  say "  --login \"-u \$GHCR_USER -p \$GHCR_PAT ghcr.io\" \\"
  say "  --disk ${DISK_GB} \\"
  say "  --ssh --direct \\"
  say "  --label ${LABEL} \\"
  say "  --onstart-cmd \"\$(cat ${ONSTART})\" \\"
  say "  --env '${envs}'"
  say ""
  say "After it rents: 'wonderland-vast.sh status' shows the mapped external ports;"
  say "point VITE_WONDERLAND_SIGNALLING_URL at wss://<host>:<mapped-${SIGNALLING_TCP}>."
  say "When done: 'wonderland-vast.sh stop <id>'  halts COMPUTE billing (STORAGE still bills);"
  say "           'wonderland-vast.sh destroy <id>' ends BOTH (deletes the instance + disk)."
  say "==================================================================================="
}

status() {
  require_cli || return 1
  say "profile=${GPU_NAME}/${PREFER_GEO:-any} disk=${DISK_GB}GB label=${LABEL} required_ports=${REQUIRED_PORTS}"
  local rows; rows="$(our_instances)"
  if [ -z "$rows" ]; then say "instance: NONE (nothing rented)"; return 0; fi
  say "instance(s) [id status ip]:"; printf '%s\n' "$rows" | sed 's/^/  /'
  say "port mappings — run: vastai show instances   (external ports are assigned at rent time)"
}

offer()   { select_offer; }
balance() { require_cli || return 1; authed && vastai show user --raw 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin);print("balance/credit:",d.get("credit",d.get("balance","unknown")))' || say "not authenticated"; }

start()   { local id="${1:?usage: start <instance-id>}"; say "starting ${id} — COMPUTE billing RESUMES once running (storage was billing while stopped)"; vastai start instance "$id"; }
stop()    { local id="${1:?usage: stop <instance-id>}"; say "stopping ${id} — COMPUTE billing halts, but STORAGE billing CONTINUES (the disk is retained). Use 'destroy' to end storage billing too."; vastai stop instance "$id"; }
destroy() {
  local id="${1:?usage: destroy <instance-id>}"
  say "DESTROY ${id} ends BOTH compute AND storage billing (deletes the instance + its disk). Irreversible."
  printf 'Type the instance id again to confirm: '
  local c; read -r c
  [ "$c" = "$id" ] || { say "confirmation mismatch — aborted"; return 1; }
  vastai destroy instance "$id"
}
logs()    { local id="${1:?usage: logs <instance-id>}"; vastai logs "$id" --tail "${2:-200}"; }
ssh_url() { local id="${1:?usage: ssh <instance-id>}"; vastai ssh-url "$id"; }

health() {
  local id="${1:-}"; local ip="${2:-}"
  if [ -z "$ip" ] && [ -n "$id" ]; then
    ip="$(vastai show instances --raw 2>/dev/null | ID="$id" python3 -c 'import sys,json,os
try: rows=json.load(sys.stdin)
except Exception: sys.exit(0)
if isinstance(rows,dict): rows=rows.get("instances",[]) or []
i=os.environ["ID"]
for r in rows:
    if str(r.get("id"))==i: print(r.get("public_ipaddr") or ""); break' 2>/dev/null || true)"
  fi
  [ -n "$ip" ] || { say "health: need a running instance ip (usage: health <id> [ip])"; return 0; }
  say "signalling(${ip}:${SIGNALLING_TCP}): $(curl -sk -m 5 -o /dev/null -w '%{http_code}' "https://${ip}:${SIGNALLING_TCP}/" 2>/dev/null || echo unreachable)"
  say "player status: $(curl -sk -m 5 "https://${ip}:${SIGNALLING_TCP}/api/status" 2>/dev/null || echo unreachable)"
}

cmd="${1:-help}"; shift || true
case "$cmd" in
  preflight) preflight ;;
  offer)     offer ;;
  balance)   balance ;;
  create)    create ;;
  status)    status ;;
  start)     start "$@" ;;
  stop)      stop "$@" ;;
  destroy)   destroy "$@" ;;
  logs)      logs "$@" ;;
  ssh)       ssh_url "$@" ;;
  health)    health "$@" ;;
  *)
    say "usage: $0 {preflight|offer|balance|create|status|start|stop|destroy|logs|ssh|health}"
    say "read-only (run now): preflight offer balance status health logs ssh"
    say "paid-rent (plan-only, operator runs by hand): create"
    say "lifecycle on an existing instance (execute directly): start<+bill> stop<-bill> destroy<-bill,irreversible>"
    ;;
esac
