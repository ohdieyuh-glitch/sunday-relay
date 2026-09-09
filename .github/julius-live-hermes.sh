#!/usr/bin/env bash
# Installs Hermes on the runner and bootstraps ONE ephemeral profile holding
# the xAI credential, for the Independent Reviewer role only.
#
# WHY A PROFILE AND NOT AN ENVIRONMENT VARIABLE. `runHermesReview` — the path
# Julius uses — spawns Hermes with `env: {PATH, HOME}` and nothing else. That
# is deliberate: the reviewer's credential is not something Julius holds, pass
# around, or can leak into a prompt, an artifact or an evidence record. The
# only supported way to give that child a credential is therefore the profile
# under its HOME. This script does not widen that boundary and Julius is not
# modified to accommodate CI.
#
# WHY A WRAPPER RATHER THAN A JOB-WIDE `HOME`. Both the reviewer AND the live
# Claude coding agent are children of the same Julius process, so pointing that
# process's HOME at the credential-bearing profile would hand the CODING agent
# — which holds Read/Glob/Grep — the directory containing the xAI key, and let
# the Agent SDK scatter its own session state through it. Instead the wrapper
# below sets HOME for the Hermes child alone, at exec time, through the
# supported `RELAY_HERMES_EXECUTABLE` seam. Julius is unchanged and the process
# HOME stays clean.
#
# EPHEMERAL. The profile lives in a directory created here, is 0700, is used
# by exactly one job, and is shredded by the workflow's cleanup step. It is
# never uploaded as an artifact and never written into the repository.
#
# THE CREDENTIAL IS NEVER ECHOED. It arrives in XAI_API_KEY from the job's
# environment (a GitHub Environment secret), is written to the profile with a
# 0600 mode, and is never printed, logged, or placed anywhere else.
set -euo pipefail

: "${HERMES_PROFILE_HOME:?missing HERMES_PROFILE_HOME}"
: "${HERMES_WRAPPER_DIR:?missing HERMES_WRAPPER_DIR}"
: "${XAI_API_KEY:?missing XAI_API_KEY}"
# BOTH DEADLINES ARE REQUIRED, because their ORDER is the invariant this script
# now enforces and a missing one would silently switch the enforcement off.
: "${HERMES_REQUEST_TIMEOUT_SECONDS:?missing HERMES_REQUEST_TIMEOUT_SECONDS}"
: "${RELAY_HERMES_TIMEOUT_MS:?missing RELAY_HERMES_TIMEOUT_MS}"
# The exact commit the founder's proven build runs. It is public upstream, so
# there is nothing local to reproduce: `git status` in that checkout reports
# "+1 carried commit" only because its shallow clone's origin ref is stale.
# The commit itself changes `gateway/run.py` and one gateway test — the
# messaging gateway, which the reviewer's one-shot CLI path never touches.
HERMES_REF=${HERMES_REF:-2ea39daeb1f675d72e5c21c9400f2d58d7e6d71a}
HERMES_PROVIDER=${RELAY_HERMES_PROVIDER:-xai}

# Install into its own virtualenv so the runner's Python stays untouched and
# the executable path is predictable.
python3 -m venv /opt/hermes-venv
/opt/hermes-venv/bin/pip install --quiet --upgrade pip
case "$HERMES_REF" in
  *[!0-9a-f]*|'') echo "hermes_ref_not_a_commit_sha:$HERMES_REF" >&2; exit 1;;
esac
[ "${#HERMES_REF}" -eq 40 ] || { echo 'hermes_ref_not_a_commit_sha' >&2; exit 1; }
/opt/hermes-venv/bin/pip install --quiet "git+https://github.com/NousResearch/hermes-agent.git@${HERMES_REF}"


HERMES_BIN=/opt/hermes-venv/bin/hermes
test -x "$HERMES_BIN" || { echo 'hermes_not_installed' >&2; exit 1; }

mkdir -p "$HERMES_PROFILE_HOME"
chmod 0700 "$HERMES_PROFILE_HOME"

# THE CREDENTIAL GOES IN `.env`, WHICH IS HERMES'S OWN FIRST LOOKUP. For an
# api-key provider Hermes resolves the key via `get_env_value_prefer_dotenv`,
# which reads `get_hermes_home()/.env` BEFORE `os.environ`, falling back to the
# credential pool only afterwards. Writing that file is therefore the supported
# path and, unlike `hermes auth add`, it cannot prompt for a TTY, cannot make a
# network call, and does not depend on an internal `auth.json` schema that
# varies by version.
mkdir -p "$HERMES_PROFILE_HOME/.hermes"
chmod 0700 "$HERMES_PROFILE_HOME/.hermes"
umask 077
printf '%s=%s\n' 'XAI_API_KEY' "$XAI_API_KEY" > "$HERMES_PROFILE_HOME/.hermes/.env"
chmod 0600 "$HERMES_PROFILE_HOME/.hermes/.env"

# THE ENGINE GETS A DEADLINE OF ITS OWN, INSIDE RELAY'S.
#
# Paid run 34311556047's Independent Reviewer failed three times on `review:plan`
# with `timed_out=true`, zero bytes, no exit code and no status — nine minutes
# that could not say whether the provider was slow, unreachable, or never asked.
# The cause was here: this script wrote only `.env`, and Hermes's
# `get_provider_request_timeout` returns nothing unless `config.yaml` carries a
# provider timeout, so the engine inherited the OpenAI SDK default of 600 s with
# three retries. Its own give-up therefore sat around forty minutes while
# Relay's window was three, and Relay's guillotine ALWAYS fell first — on every
# distinct provider fault, producing one indistinguishable shape.
#
# Measured against the real Hermes v0.18.2 at this pinned commit, against an
# endpoint that accepted the connection and never answered: with no deadline it
# ran 420 s, made 30 connection attempts, printed nothing and never exited. With
# `api_max_retries: 0` and a per-request deadline it reported and exited 0 —
# at 127 s for a 30 s deadline, at 227 s for an 80 s one. Two points, so the
# engine's total give-up is roughly `67 s + 2 x request_timeout`, not a fixed
# multiple: there is a large constant in its connect-retry loop.
#
# THE CHECK BELOW USES THAT MEASURED SLOPE with the constant tripled, and it is
# a floor rather than a proof — the retry behaviour is the engine's, it is
# version-dependent, and a provider that answers differently may take another
# path. What IS guaranteed is the other half: `runHermesReview` now records the
# process lifecycle, so a window Relay closes itself is diagnosable whether or
# not the engine got its word in first.
#
# ONLY THE TWO SECTIONS BELOW ARE WRITTEN. The model and the provider stay on
# Julius's command line, where they already are: this file must not become a
# second place that decides who reviews.
cat > "$HERMES_PROFILE_HOME/.hermes/config.yaml" <<CONFIG
providers:
  ${HERMES_PROVIDER}:
    request_timeout_seconds: ${HERMES_REQUEST_TIMEOUT_SECONDS}
    stale_timeout_seconds: ${HERMES_REQUEST_TIMEOUT_SECONDS}
agent:
  api_max_retries: 0
CONFIG
chmod 0600 "$HERMES_PROFILE_HOME/.hermes/config.yaml"

# AND THE ORDER IS CHECKED, NOT ASSUMED. If the engine's worst case does not fit
# inside Relay's window then Relay cuts first again and the next paid failure is
# as unreadable as the last, so this refuses before a provider is contacted.
SLOPE=2
CONSTANT_MS=180000
worst_case_ms=$(( HERMES_REQUEST_TIMEOUT_SECONDS * SLOPE * 1000 + CONSTANT_MS ))
if [ "$worst_case_ms" -ge "$RELAY_HERMES_TIMEOUT_MS" ]; then
  echo "hermes_engine_deadline_not_inside_relay_window:${worst_case_ms}ms_vs_${RELAY_HERMES_TIMEOUT_MS}ms" >&2
  exit 1
fi

# The wrapper is what Julius spawns. `runHermesReview` forwards {PATH, HOME}
# only, so redirecting HOME here — and nowhere else — is what keeps the
# credential away from the coding agent that shares the parent process.
mkdir -p "$HERMES_WRAPPER_DIR"
cat > "$HERMES_WRAPPER_DIR/hermes" <<WRAPPER
#!/usr/bin/env bash
# Gives the Independent Reviewer, and only it, the ephemeral profile.
exec env HOME="$HERMES_PROFILE_HOME" HERMES_HOME="$HERMES_PROFILE_HOME/.hermes" "$HERMES_BIN" "\$@"
WRAPPER
chmod 0755 "$HERMES_WRAPPER_DIR/hermes"

# Prove the credential is resolvable on the REAL path — HERMES_HOME unset,
# exactly as Julius will spawn it — rather than trusting that a file exists.
# This calls Hermes's OWN resolver, so it answers the question that matters
# ("will the reviewer find a key here?") and it is a file read: no provider is
# contacted, which is the whole contract of the preflight stage. It prints
# nothing but its exit status.
if ! env -u HERMES_HOME HOME="$HERMES_PROFILE_HOME" /opt/hermes-venv/bin/python -c \
  'import sys; from hermes_cli.config import get_env_value_prefer_dotenv as resolve; sys.exit(0 if (resolve("XAI_API_KEY") or "").strip() else 1)' \
  >/dev/null 2>&1; then
  echo "hermes_credential_not_resolvable_for_provider:$HERMES_PROVIDER" >&2
  exit 1
fi

if [ ! -s "$HERMES_PROFILE_HOME/.hermes/.env" ]; then
  echo 'hermes_profile_missing' >&2
  exit 1
fi

# AND THE DEADLINE IS PROVEN THE SAME WAY THE CREDENTIAL IS: by asking Hermes's
# own resolver what it will use, rather than trusting that a file exists. Reading
# a config file contacts nothing, so the preflight's zero-provider contract holds.
resolved_timeout=$(env -u HERMES_HOME HOME="$HERMES_PROFILE_HOME" /opt/hermes-venv/bin/python -c \
  'import sys; from hermes_cli.timeouts import get_provider_request_timeout as t; sys.stdout.write(str(t(sys.argv[1]) or 0))' \
  "$HERMES_PROVIDER" 2>/dev/null || echo 0)
if [ "${resolved_timeout%%.*}" != "$HERMES_REQUEST_TIMEOUT_SECONDS" ]; then
  echo "hermes_request_timeout_not_resolvable_for_provider:$HERMES_PROVIDER" >&2
  exit 1
fi
# THE SAME SIX LINES, KEPT WHERE THE BUNDLE CAN READ THEM.
#
# Run 34311556047's evidence could not say which reviewer binary ran, under
# which profile, or with which deadlines — those facts existed only in the
# step log, which is not the artifact anyone reads a paid failure out of.
# Every line is already printed to that public log and none of them is or
# contains a credential: paths, a version string, a mode, two integers, and the
# word REGISTERED. The evidence step copies this file into the bundle, where
# the two credential scans see it like everything else.
HERMES_BOOTSTRAP_EVIDENCE=${HERMES_BOOTSTRAP_EVIDENCE:-/tmp/julius-hermes-bootstrap.evidence.txt}
{
  echo "hermes_executable=$HERMES_WRAPPER_DIR/hermes (wraps $HERMES_BIN)"
  echo "hermes_ref=$HERMES_REF"
  echo "hermes_version=$("$HERMES_BIN" --version 2>/dev/null | head -n 1)"
  echo "hermes_profile=$HERMES_PROFILE_HOME (mode $(stat -c '%a' "$HERMES_PROFILE_HOME"))"
  echo "hermes_credential=REGISTERED"
  echo "hermes_request_timeout_seconds=$HERMES_REQUEST_TIMEOUT_SECONDS (resolved by hermes itself)"
  echo "relay_reviewer_window_ms=$RELAY_HERMES_TIMEOUT_MS (engine worst case ${worst_case_ms}ms, and it fits)"
} | tee "$HERMES_BOOTSTRAP_EVIDENCE"
chmod 0644 "$HERMES_BOOTSTRAP_EVIDENCE"
