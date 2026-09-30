#!/usr/bin/env bash
# THE LOCAL LIVE QUALIFICATION — Paid Live Mission 6, launched from the founder's laptop inside
# WSL, with the Coding Agent authenticated by the founder's Claude Max subscription.
#
# WHY LOCAL, AND WHY NOT THE HOSTED WORKFLOW. The founder chose this launch for the first
# subscription-backed qualification (2026-09-28). The first-party subscription login lives on
# this machine. The GitHub-hosted runner has none: it resolves the Coding Agent to ANTHROPIC_API
# and bills the Anthropic key. Moving a personal Claude OAuth or session credential onto GitHub
# infrastructure is not allowed, and a self-hosted runner would add infrastructure before the
# execution path itself is proven.
#
# THE SAME PATH, NOT A SIMPLIFIED ONE. Every step below is a step of the `first-live-mission` job in
# .github/workflows/julius-first-live-mission.yml, run through the SAME shared scripts
# (.github/julius-live-*.sh), the SAME entrypoint bundle (dist-relay-bridge/julius-live-mission.cjs)
# and the SAME contract. The launch environment is what differs, and it is listed here in full so
# nothing differs silently:
#
#   Coding Agent auth   JULIUS_CLAUDE_AUTH=CLAUDE_SUBSCRIPTION. No ANTHROPIC_* route exists in this
#                       process: one present on the way in is REFUSED, and the list is held equal
#                       to relay-bridge/hosted-coding-agent/hosted-auth.ts by the drift test.
#   PostgreSQL          published on 127.0.0.1:55432, database julius_qualification. Inside WSL2,
#                       127.0.0.1:5432 is Docker Desktop's forward to Julius's LIVE durable store,
#                       because every WSL2 distro shares one network namespace.
#   Docker              this distro's own engine, NEVER Docker Desktop's. `julius-postgres` there
#                       IS the live store, and rig-down removes containers by exactly that name.
#   Provider readiness  NOT RUN. The workflow's /v1/models probes contact the providers, and the
#                       founder has not authorised provider contact for validation.
#   GitHub-only gates   the paid-slot queue, the trusted-verifier checkout, main provenance and the
#                       artifact markers have no runner to live on here. They are replaced by an
#                       explicit commit pin, a clean checkout, a local attempt marker per contract
#                       digest and the same typed confirmation. That is stated, not implied.
#   Privilege           the shared scripts call `sudo` themselves (the tmpfs, the workspace
#                       ownership, the root-only receipt root). Here that is the founder's OWN
#                       sudo, typed at launch. No passwordless account is created or assumed.
#
# SUBCOMMANDS (bash scripts/julius-local-qualification.sh <subcommand>)
#   provision-check  read-only: is this WSL user ready? Names the founder's command for each gap.
#   secrets          the founder's step: prompts, silently, for OPENAI_API_KEY and XAI_API_KEY.
#   rig-up           builds, images, identity, workspace, PostgreSQL, executor, the key and receipt
#                    boundary proofs, and the pinned Hermes engine (installed, no credential).
#   preflight        every no-dispatch check; prints READY or NOT READY and names exactly which
#                    human step still blocks. Contacts no model provider.
#   run              THE PAID MISSION. Refuses without --confirm "RUN LIVE MISSION", a --commit equal
#                    to HEAD, a clean checkout and a preflight that passed on this rig.
#   evidence         the workflow's redacted evidence bundle, scanned for credential material.
#   rig-down         destroys everything rig-up created. Markers and evidence are kept.
set -euo pipefail

# ------------------------------------------------------------------ the one mission this launches
#
# THE FROZEN MISSION, PINNED BY CONTENT. Mission 6 was frozen at 231369e6
# (relay/julius-beta-qualification). PR #288 re-authored that history, so the freeze commit is not
# an ancestor of the code that lands. A git TREE and a git BLOB are content hashes, identical
# wherever the content is identical. These were measured equal at 231369e6, at PR #288's frozen head
# 15cf04d7, and at the follow-up branch. The preflight refuses a checkout where any of them differs,
# so the mission cannot drift toward being easier to pass.
readonly MISSION=julius-live-mission-6
readonly MISSION6_TREE=93dd0ab35fb36496fa4e9042a7abf66250d31fa1
# What the slice copies into the workspace: the one deliverable and the two harness files.
readonly MISSION6_SLICE_BLOBS='src/relay/workspace/julius-tools/node-tool-adapter.ts=fec0b40f0f6a0756df48b904cb3b32a2132706da
.github/julius-mission-slice/resolve.mjs=c222c8c51867ffd31b66b6713dbcd11b92535fff
.github/julius-mission-slice/loader.mjs=b811ab9107dbe59b25e0d92a84ff5ffd5e6c1ccd'

# BEGIN JOB ENV — mirrors `jobs.first-live-mission.env` in .github/workflows/julius-first-live-mission.yml.
# scripts/julius-local-qualification.test.ts holds every line here equal to that block, except the
# local differences it names and justifies. Edit both together or the test fails.
export JULIUS_CALLER_ID=julius-live
export JULIUS_TENANT_ID=tenant
export JULIUS_PROJECT_ID=prj-julius-first-live
export EXECUTOR_KEY_ID=julius-live-key
export JULIUS_FLEET_ROOT=/tmp/julius-workspace
export JULIUS_WORKSPACE=/tmp/julius-workspace/tenant/ws
export JULIUS_RECEIPT_HOST_ROOT=/tmp/julius-executor/receipts
export JULIUS_PUBLIC_KEY_PATH=/tmp/julius-public.pem
export JULIUS_EXECUTOR_ENDPOINT=http://127.0.0.1:8787/
export JULIUS_EXECUTOR_ALLOW_LOOPBACK=1
export PGUSER=julius
export PGDATABASE=julius_qualification
export HERMES_PROFILE_HOME=/tmp/julius-hermes-home
export HERMES_WRAPPER_DIR=/tmp/julius-hermes-bin
export MISSION_DIR=.github/julius-missions/julius-live-mission-6
export CONTRACT=.github/julius-missions/julius-live-mission-6/contract.json
export RELAY_PROMPT_ARCHITECT_MODE=live
export OPENAI_PROMPT_ARCHITECT_MODEL=gpt-5.6-sol
export RELAY_HOSTED_CODING_MODEL=claude-fable-5
export RELAY_HERMES_PROVIDER=xai
export RELAY_HERMES_MODEL=grok-build-0.1
# HOW THE REVIEWER IS PAID FOR: the workflow's own declaration, which the founder made where the
# xAI API key is injected. It is true here for the same reason: this launcher, like the workflow's
# Hermes step, writes XAI_API_KEY into the reviewer's profile, so every review is billed to that
# key. The reviewer then states API_BILLED on the ledger (`juliusReviewerBillingPath` in
# relay-bridge/julius/live-workers.ts, parsed as relay-bridge/attestation.ts parses it).
export RELAY_HERMES_BILLING_MODE=api_billed
export HERMES_REQUEST_TIMEOUT_SECONDS=480
# END JOB ENV

# THE TWO LOCAL ADDITIONS. Neither exists in the workflow, which is what keeps CI unchanged.
export JULIUS_CLAUDE_AUTH=CLAUDE_SUBSCRIPTION
export JULIUS_LIVE_PG_PORT=55432
# The workflow job's own ceiling, `timeout-minutes: 120`, which JOB_BUDGET_MS in
# relay-bridge/reviewer-deadline.ts is shared out from. Applied to the live step here.
readonly LIVE_TIMEOUT_MINUTES=120

# EVERY ROUTE THAT WOULD TAKE THE CODING AGENT OFF THE SUBSCRIPTION. This is the ONE place this
# file names them. Present on the way in means refused, never quietly dropped: someone expected
# that variable to do something, and billing an API balance nobody chose is the failure this
# launch exists to rule out. After the check, the whole list is unset.
readonly ANTHROPIC_ROUTES=(ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL ANTHROPIC_BEDROCK_BASE_URL ANTHROPIC_VERTEX_BASE_URL CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX AWS_BEARER_TOKEN_BEDROCK)
for route in "${ANTHROPIC_ROUTES[@]}"; do
  if [ -n "${!route:-}" ]; then
    printf 'REFUSED: %s is set in the launch environment. Subscription mode must not see it; unset it and re-run.\n' "$route" >&2
    exit 1
  fi
done
unset "${ANTHROPIC_ROUTES[@]}"

# THE ONLY DATABASE THIS LAUNCHER MAY NAME is the one rig-up creates. On this laptop the Windows
# user environment carries DATABASE_URL pointing at Julius's LIVE store, and the entrypoint reads
# JULIUS_DATABASE_URL first. Both are dropped here and set only from the rig's own record.
unset DATABASE_URL JULIUS_DATABASE_URL JULIUS_TEST_DATABASE_URL

# WINDOWS PATH ENTRIES ARE NOT THIS LAUNCHER'S. WSL appends the Windows PATH (/mnt/c/...). There,
# `docker` is Docker Desktop's shim and `node` and `npm` are Windows binaries. Nothing here may
# resolve to them. The user's own bin directory is where the Claude CLI and uv install themselves.
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '^/mnt/' | paste -sd: -)
PATH="$HOME/.local/bin:$PATH"
export PATH

readonly STATE=${JULIUS_LOCAL_STATE:-$HOME/.julius-local}
readonly RIG=$STATE/rig
readonly LOGS=$RIG/logs
readonly MARKERS=$STATE/markers
readonly HERMES_ENGINE=$STATE/hermes
readonly SECRETS_FILE=${JULIUS_LOCAL_SECRETS_FILE:-$HOME/.config/julius-local/provider.env}

say() { printf '%s\n' "$*"; }
refuse() { printf 'REFUSED: %s\n' "$*" >&2; exit 1; }

# ------------------------------------------------------------------------------------------ guards

preamble() {
  # NOT ROOT. Julius, the Claude child and Hermes run as the invoking user, and the receipt
  # boundary is proven by an UNPRIVILEGED user failing to read it. Run as root, that proof is void.
  [ "$(id -u)" -ne 0 ] || refuse 'run_as_root_refused: run this as your own WSL user; privileged steps ask for your sudo themselves.'
  REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null) || refuse 'not_in_a_checkout'
  cd "$REPO"
  HEAD_SHA=$(git rev-parse HEAD)
}

# NEVER DOCKER DESKTOP. Its `julius-postgres` is Julius's LIVE durable store, and this launcher both
# starts and removes a container of that exact name. The socket is pinned, the binary must not be a
# Windows one, and the daemon must not describe itself as Docker Desktop. Anything else is refused
# before a single container command runs.
require_native_docker() {
  export DOCKER_HOST=unix:///var/run/docker.sock
  unset DOCKER_CONTEXT
  local bin os
  bin=$(command -v docker || true)
  [ -n "$bin" ] || refuse 'docker_missing: install this distro'"'"'s own engine (runbook step 2).'
  case "$(readlink -f "$bin")" in /mnt/*) refuse "docker_is_a_windows_binary: $bin" ;; esac
  os=$(docker info --format '{{.OperatingSystem}}' 2>/dev/null) || refuse 'docker_unreachable: the engine is not running, or this user may not use its socket (runbook step 2).'
  case "$os" in
    *'Docker Desktop'*) refuse "docker_is_docker_desktop: '$os'. Julius's live store runs there; this launcher never touches that daemon." ;;
  esac
}

# THE FOUNDER'S OWN SUDO, typed once per subcommand. The shared scripts call `sudo` themselves, as
# they do on the runner. Nothing here grants, stores or assumes a password.
sudo_session() {
  if sudo -n true 2>/dev/null; then return 0; fi
  [ -t 0 ] || refuse 'sudo_needs_your_password: run this subcommand in an interactive WSL terminal.'
  say 'The shared rig scripts need sudo (tmpfs mount, workspace ownership, the root-only receipt root).'
  sudo -v || refuse 'sudo_refused'
}

port_in_use() { ss -ltnH "( sport = :$1 )" 2>/dev/null | grep -q .; }

rig_fact() { sed -n "s/^$1=//p" "$RIG/rig.env" 2>/dev/null | tail -n 1; }
require_rig() { [ -f "$RIG/rig.env" ] || refuse 'rig_not_up: run `rig-up` first.'; }

# THE RIG'S OWN RECORD, read into this process only. The values are never printed: identity.out and
# github.env are 0600 files in a 0700 directory, exactly as the runner's masked step outputs are.
load_rig() {
  RIG_ID=$(rig_fact RIG_ID)
  RIG_HEAD=$(rig_fact HEAD_SHA)
  SANDBOX_IMAGE=$(sed -n 's/^sandbox=//p' "$RIG/images.out" | tail -n 1)
  EXECUTOR_IMAGE=$(sed -n 's/^executor=//p' "$RIG/images.out" | tail -n 1)
  EXECUTOR_ROOT_VALUE=$(sed -n 's/^root=//p' "$RIG/identity.out" | tail -n 1)
  DB_PASSWORD_VALUE=$(sed -n 's/^database_password=//p' "$RIG/identity.out" | tail -n 1)
  SCOPED_VALUE=$(sed -n 's/^scoped=//p' "$RIG/identity.out" | tail -n 1)
  DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' "$RIG/github.env" 2>/dev/null | tail -n 1)
  guard_database_url
  JULIUS_DATABASE_URL=$DATABASE_URL
  export DATABASE_URL JULIUS_DATABASE_URL
}

# The URL is checked by shape and never echoed: it carries the ephemeral password.
guard_database_url() {
  case "$DATABASE_URL" in
    postgresql://*@127.0.0.1:"$JULIUS_LIVE_PG_PORT"/"$PGDATABASE") ;;
    *) refuse "database_url_unexpected: the qualification URL must name 127.0.0.1:$JULIUS_LIVE_PG_PORT/$PGDATABASE and nothing else." ;;
  esac
  [ "$JULIUS_LIVE_PG_PORT" != 5432 ] || refuse 'pg_port_5432_refused: that port is the live store'"'"'s forward.'
}

# ----------------------------------------------------------------------------------- the secrets
#
# TWO NAMES, ONE FILE, NEVER ECHOED. The founder types them into `secrets`, where they go to a
# 0600 file under their own home. They reach a child only as a bash prefix assignment
# (NAME="$value" command), which puts them in that child's environment and in nobody's argv.
stored_secret() {
  [ -f "$SECRETS_FILE" ] || return 0
  local line
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in "$1="*) printf '%s' "${line#"$1"=}"; return 0 ;; esac
  done < "$SECRETS_FILE"
}
secret_presence() { if [ -n "$(stored_secret "$1")" ]; then printf 'PRESENT'; else printf 'MISSING'; fi; }
check_secrets_file_mode() {
  [ -f "$SECRETS_FILE" ] || return 0
  local mode
  mode=$(stat -c '%a' "$SECRETS_FILE")
  [ "$mode" = 600 ] || refuse "secrets_file_mode_$mode: $SECRETS_FILE must be 0600 (chmod 600 it)."
}

# --------------------------------------------------------------- the credential scan (evidence)
#
# MIRRORS the workflow step 'Refuse to publish evidence that contains credential material', which
# lives inline in the workflow YAML (the worker App cannot edit workflows), so it is restated here.
# LAYER ONE catches shapes this rig never minted. LAYER TWO matches, literally, every value this rig
# holds. Neither says WHICH value matched.
credential_scan() {
  local dir=$1 needles leaked=0 value
  [ -d "$dir" ] || return 0
  if grep -rEq '(sk-(ant-|proj-)?[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|BEGIN [A-Z ]*PRIVATE KEY|Authorization:[[:space:]]*([A-Za-z]+[[:space:]]+)?[A-Za-z0-9._-]{16,}|CLAUDE_CODE_OAUTH_TOKEN[[:space:]]*[:=][[:space:]]*[A-Za-z0-9._-]{8,})' "$dir"; then
    return 1
  fi
  needles=$(umask 077; mktemp)
  for value in "${EXECUTOR_ROOT_VALUE:-}" "${DB_PASSWORD_VALUE:-}" "$(stored_secret OPENAI_API_KEY)" "$(stored_secret XAI_API_KEY)"; do
    [ -n "$value" ] && printf '%s\n' "$value" >> "$needles"
  done
  printf '%s' "${SCOPED_VALUE:-}" | tr ',' '\n' | sed -n 's/.*:"\([A-Za-z0-9_-]\{20,\}\)".*/\1/p' | awk '{ print }' >> "$needles" || true
  if [ -s "$needles" ] && grep -rF -f "$needles" "$dir" >/dev/null 2>&1; then leaked=1; fi
  rm -f "$needles"
  [ "$leaked" -eq 0 ]
}

# --------------------------------------------------------------------------- Hermes, the reviewer

# The pinned engine is the workflow's own default, read from the shared script so the two cannot
# disagree about which Hermes reviews.
pinned_hermes_ref() { sed -n 's/^HERMES_REF=\${HERMES_REF:-\([0-9a-f]\{40\}\)}$/\1/p' .github/julius-live-hermes.sh | head -n 1; }

# PYTHON 3.12, as on the runner. The pinned engine's dependency wheels may predate a newer distro
# python, so the launcher asks uv for 3.12 rather than guessing. HERMES_PYTHON overrides.
hermes_python() {
  if [ -n "${HERMES_PYTHON:-}" ]; then printf '%s' "$HERMES_PYTHON"; return 0; fi
  if command -v uv >/dev/null 2>&1; then uv python find 3.12 2>/dev/null && return 0; fi
  command -v python3.12 2>/dev/null || true
}

hermes_installed() {
  [ -x "$HERMES_ENGINE/venv/bin/hermes" ] && [ "$(cat "$HERMES_ENGINE/installed-ref" 2>/dev/null)" = "$(pinned_hermes_ref)" ]
}

# ONLY WHAT WAS OBSERVED, AND ONLY WHEN IT WAS: the workflow exports the claim to every later step
# only when `observe-research` printed exactly one. A contract granting no research exports nothing.
apply_research_observation() {
  local claim=''
  if [ -f "$RIG/research.env" ]; then claim=$(sed -n 's/^JULIUS_RESEARCH_OBSERVED_BACKENDS=//p' "$RIG/research.env"); fi
  if [ -n "$claim" ]; then export JULIUS_RESEARCH_OBSERVED_BACKENDS="$claim"; else unset JULIUS_RESEARCH_OBSERVED_BACKENDS; fi
}

# ================================================================================== subcommands

cmd_provision_check() {
  preamble
  local gaps=0 version
  say "LOCAL QUALIFICATION — provision check (read-only; installs and changes nothing)"
  say "  user: $(id -un) (uid $(id -u))   kernel: $(uname -r)"
  if grep -qi microsoft /proc/sys/kernel/osrelease 2>/dev/null; then say '  host: WSL2'; else say '  host: not WSL (the runbook assumes WSL2; a plain Linux host also works)'; fi
  say "  checkout: $REPO at $HEAD_SHA"
  gap() { gaps=$((gaps + 1)); say "  GAP: $1"; say "       founder command: $2"; }
  command -v sudo >/dev/null 2>&1 || gap 'sudo is missing' 'install sudo as root'
  if command -v docker >/dev/null 2>&1 && ! readlink -f "$(command -v docker)" | grep -q '^/mnt/'; then
    if os=$(DOCKER_HOST=unix:///var/run/docker.sock docker info --format '{{.OperatingSystem}}' 2>/dev/null); then
      case "$os" in
        *'Docker Desktop'*) gap "docker reaches Docker Desktop ('$os'), which this launcher refuses" 'disable Docker Desktop WSL integration for this distro, then install the native engine (runbook step 2)' ;;
        *) say "  docker: native engine, $os" ;;
      esac
    else
      gap 'docker CLI present but the engine is unreachable for this user' 'sudo systemctl start docker; then grant this user the socket (runbook step 2: docker group, or a per-session ACL)'
    fi
  else
    gap 'no native docker CLI in this distro' 'sudo apt-get install -y docker.io docker-buildx && sudo systemctl start docker (runbook step 2)'
  fi
  version=$(node --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p')
  if [ -n "$version" ] && [ "$version" -ge 20 ]; then
    say "  node: $(node --version)  npm: $(npm --version 2>/dev/null || echo MISSING)"
  else
    gap 'node >= 20 is missing' 'sudo apt-get install -y nodejs npm (runbook step 3)'
  fi
  for tool in git openssl sha256sum mountpoint df ss tar awk; do
    command -v "$tool" >/dev/null 2>&1 || gap "$tool is missing" "sudo apt-get install -y <the package providing $tool>"
  done
  if [ -n "$(hermes_python)" ]; then say "  python for Hermes: $(hermes_python)"; else gap 'no Python 3.12 for the Hermes engine' 'curl -LsSf https://astral.sh/uv/install.sh | sh && uv python install 3.12 (runbook step 4, user-level)'; fi
  if hermes_installed; then say "  Hermes engine: installed at the pinned ref $(pinned_hermes_ref)"; else say '  Hermes engine: not installed yet (rig-up installs it; no credential needed)'; fi
  if command -v claude >/dev/null 2>&1; then
    local status
    status=$(claude auth status --json 2>/dev/null || true)
    if printf '%s' "$status" | grep -Eq '"loggedIn":[[:space:]]*true'; then
      say "  claude: $(command -v claude), logged in ($(printf '%s' "$status" | grep -Eo '"(authMethod|apiProvider|subscriptionType)":[[:space:]]*"[A-Za-z0-9._-]*"' | tr -d '" ' | paste -sd' ' -))"
    else
      gap 'the Claude CLI is not logged in for this user' 'claude   (then complete /login in the browser: the official first-party flow; nothing is copied from Windows)'
    fi
  else
    gap 'the Claude CLI is not installed for this user' 'curl -fsSL https://claude.ai/install.sh | bash, then `claude` and /login (runbook step 5)'
  fi
  [ -d node_modules ] && say '  node_modules: present' || say '  node_modules: absent (rig-up runs npm ci)'
  check_secrets_file_mode
  say "  OPENAI_API_KEY: $(secret_presence OPENAI_API_KEY)   XAI_API_KEY: $(secret_presence XAI_API_KEY)   (bash scripts/julius-local-qualification.sh secrets)"
  if port_in_use 5432; then say '  127.0.0.1:5432 is occupied: expected, it is Docker Desktop'"'"'s forward to the live store. This rig never uses it.'; fi
  if port_in_use "$JULIUS_LIVE_PG_PORT"; then gap "127.0.0.1:$JULIUS_LIVE_PG_PORT is already in use" 'stop whatever holds it, or rig-down a previous rig'; fi
  if [ "$gaps" -eq 0 ]; then say 'PROVISION: READY for rig-up'; else say "PROVISION: $gaps gap(s), each above with the founder command that closes it"; fi
}

cmd_secrets() {
  if [ "${1:-}" = --forget ]; then rm -f "$SECRETS_FILE"; say "removed $SECRETS_FILE"; return 0; fi
  [ -t 0 ] || refuse 'secrets_needs_a_terminal: type the keys interactively; they are never taken from argv or a pipe.'
  local dir tmp name value
  dir=$(dirname "$SECRETS_FILE")
  mkdir -p "$dir"
  chmod 0700 "$dir"
  tmp=$(umask 077; mktemp "$dir/.provider.env.XXXXXX")
  for name in OPENAI_API_KEY XAI_API_KEY; do
    printf 'Paste %s (input hidden; Enter keeps the stored one): ' "$name" >&2
    IFS= read -rs value || true
    printf '\n' >&2
    [ -n "$value" ] || value=$(stored_secret "$name")
    case "$value" in *[[:space:]]*) rm -f "$tmp"; refuse "$name contains whitespace; nothing was stored." ;; esac
    if [ -n "$value" ]; then printf '%s=%s\n' "$name" "$value" >> "$tmp"; fi
  done
  chmod 0600 "$tmp"
  mv -f "$tmp" "$SECRETS_FILE"
  value=''
  say "stored in $SECRETS_FILE (0600): OPENAI_API_KEY $(secret_presence OPENAI_API_KEY), XAI_API_KEY $(secret_presence XAI_API_KEY)"
}

cmd_rig_up() {
  preamble
  require_native_docker
  [ ! -e "$RIG/rig.env" ] || refuse 'rig_already_up: run `rig-down` first.'
  local name py=''
  for name in julius-postgres julius-executor; do
    if docker container inspect "$name" >/dev/null 2>&1; then refuse "container_exists:$name (a previous rig? run rig-down)"; fi
  done
  if port_in_use "$JULIUS_LIVE_PG_PORT"; then refuse "port_in_use:$JULIUS_LIVE_PG_PORT"; fi
  if port_in_use 8787; then refuse 'port_in_use:8787 (the executor binds loopback 8787 on the host network)'; fi
  if mountpoint -q "$JULIUS_WORKSPACE" 2>/dev/null; then refuse "workspace_already_mounted:$JULIUS_WORKSPACE"; fi
  if ! hermes_installed; then
    py=$(hermes_python)
    [ -n "$py" ] || refuse 'hermes_python_missing: install uv and Python 3.12 (runbook step 4) or set HERMES_PYTHON.'
  fi
  sudo_session
  mkdir -p "$LOGS" "$MARKERS"
  chmod 0700 "$STATE" "$RIG" "$LOGS"

  say '== build (the same three bundles the workflow builds)'
  if [ ! -d node_modules ]; then nice -n 10 npm ci --no-audit --no-fund; fi
  nice -n 10 npm run --silent relay:executor:build
  nice -n 10 npm run --silent relay:julius:preflight:build
  nice -n 10 npm run --silent relay:julius:build

  say '== images (.github/julius-live-images.sh)'
  (umask 077; : > "$RIG/images.out")
  GITHUB_OUTPUT="$RIG/images.out" nice -n 10 ./.github/julius-live-images.sh | tee "$LOGS/images.log"

  say '== identity (.github/julius-live-identity.sh)'
  # ITS STDOUT IS DISCARDED, AND MUST BE. On the runner it prints `::add-mask::<value>` for the
  # credential root, the database password and every derived scoped credential, and GitHub turns
  # those lines into masks. In a terminal they are simply the secrets, printed.
  (umask 077; : > "$RIG/identity.out")
  GITHUB_OUTPUT="$RIG/identity.out" ./.github/julius-live-identity.sh >/dev/null
  say 'identity minted (root, database password and scoped credentials are in a 0600 file, never printed)'
  load_images_and_identity

  say '== workspace (.github/julius-live-workspace.sh, slice of the pinned commit)'
  JULIUS_MISSION_DIR="$MISSION_DIR" JULIUS_SLICE_REV="$HEAD_SHA" GITHUB_WORKSPACE="$REPO" ./.github/julius-live-workspace.sh | tee "$LOGS/workspace.log"

  say "== PostgreSQL on 127.0.0.1:$JULIUS_LIVE_PG_PORT and the independent executor (.github/julius-live-executor.sh)"
  (umask 077; : > "$RIG/github.env")
  SANDBOX_IMAGE="$SANDBOX_IMAGE" EXECUTOR_IMAGE="$EXECUTOR_IMAGE" EXECUTOR_CREDENTIAL_ROOT="$EXECUTOR_ROOT_VALUE" PGPASSWORD="$DB_PASSWORD_VALUE" GITHUB_WORKSPACE="$REPO" GITHUB_ENV="$RIG/github.env" ./.github/julius-live-executor.sh | tee "$LOGS/executor.log"
  DATABASE_URL=$(sed -n 's/^DATABASE_URL=//p' "$RIG/github.env" | tail -n 1)
  guard_database_url

  say '== boundary proofs, from the side that must not hold the key'
  ./.github/julius-live-key-boundary.sh | tee "$LOGS/key-boundary.log"
  ./.github/julius-live-receipt-boundary.sh | tee "$LOGS/receipt-boundary.log"

  say '== the Independent Reviewer engine (.github/julius-live-hermes.sh, install phase: no credential)'
  if hermes_installed; then
    say "Hermes already installed at the pinned ref $(pinned_hermes_ref)"
  else
    mkdir -p "$HERMES_ENGINE"
    HERMES_PHASE=install HERMES_PYTHON="$py" HERMES_VENV_DIR="$HERMES_ENGINE/venv" HERMES_SRC_DIR="$HERMES_ENGINE/src" ./.github/julius-live-hermes.sh | tee "$LOGS/hermes-install.log"
    pinned_hermes_ref > "$HERMES_ENGINE/installed-ref"
  fi

  {
    printf 'RIG_ID=%s\n' "$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 4)"
    printf 'HEAD_SHA=%s\n' "$HEAD_SHA"
    printf 'DIRTY_PATHS=%s\n' "$(git status --porcelain | wc -l | tr -d ' ')"
    printf 'PG=127.0.0.1:%s/%s\n' "$JULIUS_LIVE_PG_PORT" "$PGDATABASE"
    printf 'SANDBOX_IMAGE=%s\nEXECUTOR_IMAGE=%s\n' "$SANDBOX_IMAGE" "$EXECUTOR_IMAGE"
    printf 'UP_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  } > "$RIG/rig.env"
  say "RIG UP at $HEAD_SHA. Nothing was dispatched. Next: preflight."
}

# rig-up has not written rig.env yet when it needs these, so they are read directly.
load_images_and_identity() {
  SANDBOX_IMAGE=$(sed -n 's/^sandbox=//p' "$RIG/images.out" | tail -n 1)
  EXECUTOR_IMAGE=$(sed -n 's/^executor=//p' "$RIG/images.out" | tail -n 1)
  EXECUTOR_ROOT_VALUE=$(sed -n 's/^root=//p' "$RIG/identity.out" | tail -n 1)
  DB_PASSWORD_VALUE=$(sed -n 's/^database_password=//p' "$RIG/identity.out" | tail -n 1)
  SCOPED_VALUE=$(sed -n 's/^scoped=//p' "$RIG/identity.out" | tail -n 1)
  [ -n "$SANDBOX_IMAGE" ] && [ -n "$EXECUTOR_IMAGE" ] || refuse 'images_not_recorded'
  [ -n "$EXECUTOR_ROOT_VALUE" ] && [ -n "$DB_PASSWORD_VALUE" ] && [ -n "$SCOPED_VALUE" ] || refuse 'identity_not_recorded'
}

cmd_preflight() {
  preamble
  require_native_docker
  require_rig
  load_rig
  check_secrets_file_mode
  sudo_session
  rm -f "$RIG/preflight.ok"
  local human=() problems=() status line claude_line dirty
  local openai xai
  openai=$(stored_secret OPENAI_API_KEY)
  xai=$(stored_secret XAI_API_KEY)
  say 'LOCAL QUALIFICATION PREFLIGHT — Mission 6, no model provider is contacted'

  # CHECKOUT AND MISSION, from git alone.
  dirty=$(git status --porcelain | wc -l | tr -d ' ')
  say "CHECKOUT: commit=$HEAD_SHA rig_built_from=$RIG_HEAD dirty_paths=$dirty"
  [ "$RIG_HEAD" = "$HEAD_SHA" ] || problems+=("the rig was built from $RIG_HEAD, not HEAD; rig-down and rig-up again")
  local tree blob_ok=yes entry path want got
  tree=$(git rev-parse "HEAD:$MISSION_DIR" 2>/dev/null || echo missing)
  while IFS= read -r entry; do
    path=${entry%%=*}; want=${entry#*=}
    got=$(git rev-parse "HEAD:$path" 2>/dev/null || echo missing)
    [ "$got" = "$want" ] || blob_ok="NO ($path)"
  done <<< "$MISSION6_SLICE_BLOBS"
  if [ "$tree" = "$MISSION6_TREE" ] && [ -z "$(git status --porcelain -- "$MISSION_DIR")" ] && [ "$blob_ok" = yes ]; then
    say "MISSION: $MISSION INTACT (tree $MISSION6_TREE, slice and harness blobs as frozen, no local edits)"
  else
    say "MISSION: $MISSION ALTERED (tree=$tree want=$MISSION6_TREE, slice blobs=$blob_ok)"
    problems+=('Mission 6 differs from its frozen contents; do not alter the mission to make the run easier')
  fi

  # THE CONTRACT, by the workflow's own checker (no lane: this is not the paid-slot queue).
  if node scripts/julius-live-contract-check.mjs "$CONTRACT" > "$LOGS/contract-check.log" 2>&1; then
    say "CONTRACT: valid and bounded ($(tail -n 1 "$LOGS/contract-check.log"))"
  else
    say 'CONTRACT: REFUSED by scripts/julius-live-contract-check.mjs'
    problems+=('contract check failed')
  fi

  # RESEARCH, observed exactly as the workflow observes it (no request at all if none is granted).
  rm -f "$RIG/research.env"
  set +e
  node dist-relay-bridge/julius-live-mission.cjs observe-research --contract "$CONTRACT" > "$LOGS/research-observation.log" 2>&1
  status=$?
  set -e
  local claims
  claims=$(grep -cE '^JULIUS_RESEARCH_OBSERVED_BACKENDS=[a-z_]+:[a-z_]+(,[a-z_]+:[a-z_]+)*$' "$LOGS/research-observation.log" || true)
  if [ "$status" -ne 0 ]; then
    say "RESEARCH: observation failed (exit $status)"; problems+=('research observation failed')
  elif [ "$claims" = 1 ]; then
    grep -E '^JULIUS_RESEARCH_OBSERVED_BACKENDS=' "$LOGS/research-observation.log" > "$RIG/research.env"
    say "RESEARCH: observed ($(cat "$RIG/research.env"))"
  elif [ "$claims" = 0 ] && grep -qx 'research_not_granted: .*' "$LOGS/research-observation.log"; then
    say 'RESEARCH: not granted by this contract; nothing observed, nothing exported'
  else
    say "RESEARCH: unexported ($claims claim lines)"; problems+=('research observation output not understood')
  fi

  # THE DURABLE STORE AND THE EXECUTOR: the provider-free round-trip. It also applies the migrations,
  # through the repository's own migrate(), to this rig's disposable database only.
  set +e
  JULIUS_SCOPED_CREDENTIALS="$SCOPED_VALUE" npm run --silent relay:julius:preflight > "$LOGS/infra-preflight.log" 2>&1
  status=$?
  set -e
  if [ "$status" -eq 0 ]; then
    say "EXECUTOR: sandbox round-trip OK ($(grep -E 'createSandbox|base revision resolved|receipts verified' "$LOGS/infra-preflight.log" | wc -l | tr -d ' ') checkpoints passed; host-to-sandbox diff proven)"
  else
    say "EXECUTOR: round-trip FAILED (exit $status; see $LOGS/infra-preflight.log)"; problems+=('provider-free infrastructure preflight failed')
  fi
  local applied expected pending
  applied=$(PGPASSWORD="$DB_PASSWORD_VALUE" docker exec -e PGPASSWORD julius-postgres psql -U "$PGUSER" -d "$PGDATABASE" -Atc 'SELECT version FROM relay_wonderland.schema_migrations ORDER BY version' 2>/dev/null || true)
  expected=$(grep -ho "schema_migrations(version) VALUES('[^']*')" src/relay/persistence/wonderland-migrations/*.sql | sed "s/.*VALUES('\([^']*\)')/\1/" | sort -u)
  pending=$(comm -13 <(printf '%s\n' "$applied" | sort -u) <(printf '%s\n' "$expected") | grep -c . || true)
  if [ -n "$applied" ] && [ "$pending" = 0 ] && printf '%s\n' "$applied" | grep -qx '028_julius_criteria_per_run'; then
    say "DATABASE: PostgreSQL reachable at 127.0.0.1:$JULIUS_LIVE_PG_PORT, database $PGDATABASE (disposable, this rig's own); migrations $(printf '%s\n' "$applied" | grep -c .) applied, 0 pending, through 028_julius_criteria_per_run"
  else
    say "DATABASE: migrations NOT current ($pending pending of $(printf '%s\n' "$expected" | grep -c .))"; problems+=('migrations are not current through 028')
  fi
  if ./.github/julius-live-key-boundary.sh > "$LOGS/key-boundary-preflight.log" 2>&1 && ./.github/julius-live-receipt-boundary.sh > "$LOGS/receipt-boundary-preflight.log" 2>&1; then
    say 'BOUNDARIES: signing key on no host path or mount; receipt root root:root 0700 and unreadable by this user'
  else
    say 'BOUNDARIES: FAILED'; problems+=('key or receipt boundary proof failed')
  fi

  # THE REVIEWER: the engine is proven installed without a credential; the profile needs one.
  local hermes_state='NOT INSTALLED'
  if hermes_installed; then hermes_state="PRESENT (pinned ref $(pinned_hermes_ref))"; fi
  if [ -z "$xai" ]; then
    say "REVIEWER: xAI/Hermes — Hermes runtime $hermes_state; XAI_API_KEY MISSING"
    human+=('XAI_API_KEY: run `bash scripts/julius-local-qualification.sh secrets` in this WSL terminal')
  elif ! hermes_installed; then
    say "REVIEWER: xAI/Hermes — Hermes runtime NOT INSTALLED; XAI_API_KEY PRESENT"; problems+=('the Hermes engine is not installed (rig-up installs it)')
  else
    set +e
    HERMES_PHASE=bootstrap XAI_API_KEY="$xai" HERMES_VENV_DIR="$HERMES_ENGINE/venv" HERMES_SRC_DIR="$HERMES_ENGINE/src" ./.github/julius-live-hermes.sh > "$LOGS/hermes-bootstrap.log" 2>&1
    status=$?
    set -e
    if [ "$status" -eq 0 ]; then
      say "REVIEWER: xAI/Hermes — Hermes runtime $hermes_state; XAI_API_KEY PRESENT; profile bootstrapped; isolation proven with the network closed"
    else
      say "REVIEWER: Hermes bootstrap FAILED (exit $status; see $LOGS/hermes-bootstrap.log)"; problems+=('Hermes bootstrap failed')
    fi
  fi
  xai=''

  # THE ARCHITECT.
  if [ -n "$openai" ]; then say 'ARCHITECT: OpenAI — OPENAI_API_KEY PRESENT'; else
    say 'ARCHITECT: OpenAI — OPENAI_API_KEY MISSING'
    human+=('OPENAI_API_KEY: run `bash scripts/julius-local-qualification.sh secrets` in this WSL terminal')
  fi

  # THE THREE ROLES, resolved by the entrypoint itself without --confirm-live. Exit 5 is the only
  # answer that means ready. It constructs no provider client and opens no provider connection.
  apply_research_observation
  set +e
  JULIUS_SCOPED_CREDENTIALS="$SCOPED_VALUE" OPENAI_API_KEY="$openai" RELAY_HERMES_EXECUTABLE="$HERMES_WRAPPER_DIR/hermes" node dist-relay-bridge/julius-live-mission.cjs run --contract "$CONTRACT" > "$LOGS/preflight-roles.log" 2>&1
  status=$?
  set -e
  openai=''
  claude_line=$(grep -E '^  (BLOCKED )?CLAUDE AUTH' "$LOGS/preflight-roles.log" | head -n 1 || true)
  if printf '%s' "$claude_line" | grep -Eq '^  CLAUDE AUTH: SUBSCRIPTION provider=ANTHROPIC execution=CLAUDE_AGENT_SDK plan=[a-z]+ api_key_used=false api_cost_applicable=false$'; then
    say "CLAUDE:${claude_line#  CLAUDE AUTH:}"
    printf '%s' "$claude_line" | grep -q 'plan=max' || problems+=('the subscription login is not a Max plan')
  elif printf '%s' "$claude_line" | grep -q 'subscription_login_absent'; then
    say 'CLAUDE: mode CLAUDE_SUBSCRIPTION; no first-party login observed for this WSL user'
    if command -v claude >/dev/null 2>&1; then
      human+=('Claude login: run `claude` in this WSL terminal and complete /login (official first-party flow; nothing is copied from Windows)')
    else
      human+=('Claude CLI: install it for this WSL user (curl -fsSL https://claude.ai/install.sh | bash), then `claude` and complete /login')
    fi
  else
    say "CLAUDE: ${claude_line:-no CLAUDE AUTH line was printed}"; problems+=('the Coding Agent auth did not resolve to the subscription')
  fi
  grep -qx '  ANTHROPIC_API_KEY: MISSING' "$LOGS/preflight-roles.log" || problems+=('the entrypoint saw an Anthropic API key')
  line=$(grep -m1 '^  requested models:' "$LOGS/preflight-roles.log" || true)
  say "ROLES: entrypoint exit=$status (5 = ready and awaiting --confirm-live);${line#  requested models:}"
  if [ "$status" -eq 5 ]; then
    grep -q "architect=$OPENAI_PROMPT_ARCHITECT_MODEL" "$LOGS/preflight-roles.log" || problems+=('architect model unexpected')
    grep -q "coder=$RELAY_HOSTED_CODING_MODEL" "$LOGS/preflight-roles.log" || problems+=('coding model unexpected')
    grep -q "reviewer=$RELAY_HERMES_PROVIDER/$RELAY_HERMES_MODEL" "$LOGS/preflight-roles.log" || problems+=('reviewer model unexpected')
    grep -qx '  live_ledger: BOUND' "$LOGS/preflight-roles.log" || problems+=('live ledger unbound: allocation would fall back to a flat estimate')
    for name in OPENAI_API_KEY DATABASE_URL JULIUS_EXECUTOR_ENDPOINT JULIUS_SCOPED_CREDENTIALS EXECUTOR_KEY_ID JULIUS_PUBLIC_KEY_PATH JULIUS_CALLER_ID; do
      grep -q "^  $name: SET$" "$LOGS/preflight-roles.log" || problems+=("preflight variable not set: $name")
    done
  elif [ "${#human[@]}" -eq 0 ]; then
    problems+=("the entrypoint preflight exited $status with no human step outstanding")
  fi
  grep -E '^  BLOCKED ' "$LOGS/preflight-roles.log" | sed 's/^  /  entrypoint: /' || true

  say "ACCOUNTING: Coding Agent (Anthropic, Claude subscription) API billing basis NOT_APPLICABLE; architect (OpenAI) and reviewer (xAI via Hermes) bill their own API accounts; execution budget enforced: contract $(sed -n 's/.*"spendUsd":[[:space:]]*\([0-9.]*\).*/spendUsd=\1/p' "$CONTRACT" | head -n 1) $(sed -n 's/.*"repairCycles":[[:space:]]*\([0-9]*\).*/repairCycles=\1/p' "$CONTRACT" | head -n 1), per-dispatch runtime ceiling in the hosted runner"
  if printf '%s' "$line" | grep -q "architect=$OPENAI_PROMPT_ARCHITECT_MODEL coder=$RELAY_HOSTED_CODING_MODEL reviewer=$RELAY_HERMES_PROVIDER/"; then
    say 'PROVENANCE: three distinct providers — architect OpenAI, coding agent Anthropic, reviewer xAI'
  else
    problems+=('provider independence could not be read from the resolved roles')
  fi
  if credential_scan "$LOGS"; then say 'SECRET AUDIT: this preflight'"'"'s logs hold no credential shape and no value this rig holds'; else
    rm -rf "$LOGS"; mkdir -p "$LOGS"; chmod 0700 "$LOGS"
    problems+=('credential material was found in the preflight logs, which were deleted')
  fi
  say 'PROVIDER DISPATCHES: 0 (no --confirm-live; the entrypoint stops before constructing any provider client)'

  if [ "${#problems[@]}" -eq 0 ] && [ "${#human[@]}" -eq 0 ] && [ "$status" -eq 5 ]; then
    { printf 'RIG_ID=%s\nHEAD_SHA=%s\nAT_EPOCH=%s\n' "$RIG_ID" "$HEAD_SHA" "$(date -u +%s)"; } > "$RIG/preflight.ok"
    say 'RESULT: READY. The paid mission still needs the founder'"'"'s explicit authorization and `run`.'
    return 0
  fi
  say 'RESULT: NOT READY'
  local item
  for item in "${human[@]}"; do say "  HUMAN STEP: $item"; done
  for item in "${problems[@]}"; do say "  PROBLEM: $item"; done
  return 1
}

cmd_run() {
  local confirm='' rerun='' commit='' max_ticks=derived
  while [ $# -gt 0 ]; do
    case "$1" in
      --confirm) confirm=${2:-}; shift 2 ;;
      --rerun) rerun=${2:-}; shift 2 ;;
      --commit) commit=${2:-}; shift 2 ;;
      --max-ticks) max_ticks=${2:-}; shift 2 ;;
      *) refuse "run_argument_unknown:$1" ;;
    esac
  done
  # THE TYPED CONFIRMATION COMES FIRST, before anything is read, so no path through this function
  # reaches a provider without it. Approval is never inferred: the workflow's literal, verbatim.
  [ "$confirm" = 'RUN LIVE MISSION' ] || refuse 'run_not_confirmed: the paid mission needs --confirm "RUN LIVE MISSION", typed by the founder.'
  case "$max_ticks" in derived) ;; ''|*[!0-9]*|0) refuse "max_ticks_invalid:$max_ticks" ;; esac
  preamble
  case "$commit" in *[!0-9a-f]*|'') refuse 'commit_pin_missing: pass --commit <the 40-hex landed commit this checkout is at>' ;; esac
  [ "${#commit}" -eq 40 ] || refuse 'commit_pin_not_40_hex'
  [ "$commit" = "$HEAD_SHA" ] || refuse "commit_pin_mismatch: HEAD is $HEAD_SHA"
  [ -z "$(git status --porcelain)" ] || refuse 'checkout_dirty: the paid mission runs only from a clean checkout of the pinned commit'
  require_native_docker
  require_rig
  load_rig
  [ "$RIG_HEAD" = "$HEAD_SHA" ] || refuse 'rig_built_from_another_commit: rig-down, rig-up, preflight'
  [ -f "$RIG/preflight.ok" ] || refuse 'preflight_not_passed_on_this_rig'
  [ "$(sed -n 's/^RIG_ID=//p' "$RIG/preflight.ok")" = "$RIG_ID" ] || refuse 'preflight_from_another_rig'
  [ "$(sed -n 's/^HEAD_SHA=//p' "$RIG/preflight.ok")" = "$HEAD_SHA" ] || refuse 'preflight_from_another_commit'
  local age
  age=$(( $(date -u +%s) - $(sed -n 's/^AT_EPOCH=//p' "$RIG/preflight.ok") ))
  [ "$age" -le 3600 ] || refuse "preflight_stale: passed ${age}s ago; run preflight again"
  for name in julius-postgres julius-executor; do
    [ "$(docker container inspect -f '{{.State.Running}}' "$name" 2>/dev/null)" = true ] || refuse "container_not_running:$name"
  done
  [ -x "$HERMES_WRAPPER_DIR/hermes" ] || refuse 'reviewer_profile_not_bootstrapped'

  # A PAID MISSION ATTEMPTED ONCE IS NOT ATTEMPTED AGAIN BY ACCIDENT. The marker names WHAT was
  # authorised (the contract digest), never its text, and it is written BEFORE any provider can be
  # reached, so an attempt that dies mid-mission still leaves the fact behind. It is local: a
  # GitHub-hosted dispatch cannot see it, and the runbook says so.
  local digest marker_dir stamp
  digest=$(sha256sum "$CONTRACT" | cut -d' ' -f1)
  [ -n "$digest" ] || refuse 'contract_digest_unavailable'
  marker_dir="$MARKERS/$digest"
  if compgen -G "$marker_dir/attempted-*" >/dev/null; then
    [ "$rerun" = 'RERUN PAID MISSION' ] || refuse "paid_mission_already_attempted: $(ls "$marker_dir") — repeat only with --rerun \"RERUN PAID MISSION\""
  fi
  mkdir -p "$marker_dir"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  {
    printf 'attempted_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'launcher=scripts/julius-local-qualification.sh (local WSL)\n'
    printf 'commit=%s\n' "$HEAD_SHA"
    printf 'rig_id=%s\n' "$RIG_ID"
    printf 'contract_sha256=%s\n' "$digest"
  } > "$marker_dir/attempted-$stamp.txt"

  local openai status
  openai=$(stored_secret OPENAI_API_KEY)
  [ -n "$openai" ] || refuse 'openai_key_missing'
  apply_research_observation
  say "LIVE: Mission 6 at $HEAD_SHA — the paid mission starts now"
  set +e
  JULIUS_JOB_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" JULIUS_SCOPED_CREDENTIALS="$SCOPED_VALUE" OPENAI_API_KEY="$openai" RELAY_HERMES_EXECUTABLE="$HERMES_WRAPPER_DIR/hermes" timeout "${LIVE_TIMEOUT_MINUTES}m" node dist-relay-bridge/julius-live-mission.cjs run --contract "$CONTRACT" --confirm-live --max-ticks "$max_ticks" | tee "$LOGS/live-mission.log"
  status=${PIPESTATUS[0]}
  set -e
  openai=''
  say "julius_exit=$status"
  if [ "$status" -eq 0 ]; then
    { printf 'completed_at=%s\ncommit=%s\nrig_id=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$HEAD_SHA" "$RIG_ID"; } > "$marker_dir/completed-$stamp.txt"
  fi
  say 'Next: evidence (the redacted bundle), then rig-down.'
  return "$status"
}

cmd_evidence() {
  preamble
  require_native_docker
  require_rig
  load_rig
  # THE BUNDLE NAMES THE CODE THAT RAN, OR IT IS NOT WRITTEN. Its manifest records this checkout's
  # `git rev-parse HEAD` and tracked changes at DUMP time, and the Beta Gate binds a bundle only to
  # that commit with no tracked change. `run` refuses unless the rig was built from HEAD on a clean
  # checkout, so the rig's commit is the run's: evidence taken after the checkout moved, or from an
  # edited tree, would name code the mission never ran.
  [ "$RIG_HEAD" = "$HEAD_SHA" ] || refuse "evidence_head_moved: the rig ran $RIG_HEAD and HEAD is now $HEAD_SHA; check $RIG_HEAD out again before taking evidence"
  [ -z "$(git status --porcelain --untracked-files=no)" ] || refuse 'evidence_checkout_dirty: the checkout has tracked changes, so the manifest would name a commit that is not the code that ran'
  local out
  out="$STATE/evidence/$(date -u +%Y%m%dT%H%M%SZ)/julius-live-evidence"
  mkdir -p "$out"
  chmod 0700 "$STATE/evidence"
  cp /tmp/julius-hermes-bootstrap.evidence.txt "$out/hermes-bootstrap.evidence.txt" 2>/dev/null || true
  # The executor's raw log is reduced to its exact diagnostic grammar and the raw copy deleted, as
  # in the workflow: a raw executor log never enters a bundle.
  local raw
  raw=$(umask 077; mktemp)
  docker logs julius-executor > "$raw" 2>&1 || true
  grep -E '^executor_(ready:[0-9]{1,5}|diagnostic operation=[a-z]+ result=[A-Za-z0-9_.:-]{1,120} class=[A-Za-z0-9_]{1,32} status=[0-9]{3})$' "$raw" > "$out/executor-diagnostics.txt" || true
  rm -f "$raw"
  # Logs are rebuilt line by line from the allowlist of known shapes, never copied.
  if [ -f "$LOGS/preflight-roles.log" ]; then node scripts/julius-live-evidence.mjs "$LOGS/preflight-roles.log" > "$out/preflight-roles.evidence.txt" || true; fi
  if [ -f "$LOGS/live-mission.log" ]; then node scripts/julius-live-evidence.mjs "$LOGS/live-mission.log" > "$out/live-mission.evidence.txt" || true; fi
  grep -E '^(research_observation source=[a-z]+ capability=[a-z_]+ host=[a-z0-9*.-]+ backend=[a-z_]+ result=(observed|unreachable|throttled|unauthenticated|unconfigured)|research_observation_summary observed=[0-9]+ of=[0-9]+|JULIUS_RESEARCH_OBSERVED_BACKENDS=[a-z_]+:[a-z_]+(,[a-z_]+:[a-z_]+)*|research_not_granted: the contract has no research clause, so there is nothing to observe\.|research_unobservable: no backend was observed serving any of the [0-9]+ research probe\(s\) the contract grants; refusing to dispatch a mission whose research would all be refused\.)$' "$LOGS/research-observation.log" > "$out/research-observation.txt" 2>/dev/null || true
  # THE BUNDLE SAYS WHAT IT IS. Off a runner the dump cannot read a dispatch input, so this
  # launcher declares the mode for its manifest: `paid` only when this rig ran the confirmed
  # mission (`run` is the one path that writes live-mission.log), `preflight` otherwise.
  local evidence_mode=preflight
  if [ -f "$LOGS/live-mission.log" ]; then evidence_mode=paid; fi
  JULIUS_EVIDENCE_MODE="$evidence_mode" PGPASSWORD="$DB_PASSWORD_VALUE" ./.github/julius-live-evidence-dump.sh "$out"
  git -c safe.directory="$JULIUS_WORKSPACE" -C "$JULIUS_WORKSPACE" --no-pager diff > "$out/workspace.diff" 2>/dev/null || true
  git -c safe.directory="$JULIUS_WORKSPACE" -C "$JULIUS_WORKSPACE" status --porcelain=v1 > "$out/workspace-status.txt" 2>/dev/null || true
  docker exec julius-executor sh -c 'ls -1 "$EXECUTOR_RECEIPT_ROOT" 2>/dev/null | head -n 200' > "$out/receipt-ids.txt" 2>/dev/null || true
  # WHAT THIS MISSION DID NOT DO, PROVEN ANYWAY: the workflow's provider-free capability drills,
  # after the dump, one database each, never able to fail the bundle. BOTH database variables are
  # pointed at the drill's own database: the entrypoint family reads JULIUS_DATABASE_URL first, and
  # this process exports it for the mission's database.
  local drill db
  for drill in recovery-drill failure-recovery-drill repair-loop-drill; do
    db="julius_${drill//-/_}"
    if PGPASSWORD="$DB_PASSWORD_VALUE" docker exec -e PGPASSWORD julius-postgres createdb -U "$PGUSER" "$db" 2>/dev/null; then
      DATABASE_URL="${DATABASE_URL%/*}/$db" JULIUS_DATABASE_URL="${DATABASE_URL%/*}/$db" npm run "julius:$drill" --silent -- --out /tmp/julius-capability-proofs > /dev/null 2>&1 || true
    fi
  done
  cp /tmp/julius-capability-proofs/capability-proofs.tsv /tmp/julius-capability-proofs/*.transcript.txt "$out/" 2>/dev/null || true
  rm -rf /tmp/julius-capability-proofs
  { printf 'launcher=scripts/julius-local-qualification.sh (local WSL)\ncommit=%s\nrig_id=%s\ncoding_agent_auth=%s\n' "$HEAD_SHA" "$RIG_ID" "$JULIUS_CLAUDE_AUTH"; } > "$out/launch.txt"
  if credential_scan "$out"; then
    say "EVIDENCE: $out (scan clean: shapes and exact values)"
  else
    rm -rf "$out"
    refuse 'evidence_contains_credential_material: the bundle was deleted'
  fi
}

cmd_rig_down() {
  preamble
  require_native_docker
  sudo_session
  docker ps -aq --filter 'label=julius.sandbox' | xargs -r docker rm -f >/dev/null 2>&1 || true
  docker rm -f julius-executor julius-postgres >/dev/null 2>&1 || true
  # The reviewer profile holds the xAI credential; it never outlives the rig.
  rm -rf "$HERMES_PROFILE_HOME" "$HERMES_WRAPPER_DIR" /tmp/julius-hermes-bootstrap.evidence.txt 2>/dev/null || true
  rm -f "$JULIUS_PUBLIC_KEY_PATH" 2>/dev/null || true
  sudo rm -rf /tmp/julius-executor 2>/dev/null || true
  sudo umount "$JULIUS_WORKSPACE" 2>/dev/null || true
  sudo rm -rf "$JULIUS_FLEET_ROOT" 2>/dev/null || true
  rm -rf "$RIG"
  if [ "${1:-}" = --purge-hermes ]; then rm -rf "$HERMES_ENGINE"; fi
  say 'RIG DOWN: containers, workspace, receipts, reviewer profile, identity and logs removed. Markers and evidence kept.'
}

usage() {
  sed -n '/^# SUBCOMMANDS/,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^# \{0,1\}//'
}

main() {
  local sub=${1:-help}
  [ $# -eq 0 ] || shift
  case "$sub" in
    provision-check) cmd_provision_check "$@" ;;
    secrets) cmd_secrets "$@" ;;
    rig-up) cmd_rig_up "$@" ;;
    preflight) cmd_preflight "$@" ;;
    run) cmd_run "$@" ;;
    evidence) cmd_evidence "$@" ;;
    rig-down) cmd_rig_down "$@" ;;
    help|-h|--help) usage ;;
    *) refuse "unknown_subcommand:$sub (see: help)" ;;
  esac
}

main "$@"
