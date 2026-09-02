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
HERMES_REF=${HERMES_REF:-v0.18.2}
HERMES_PROVIDER=${RELAY_HERMES_PROVIDER:-xai}

# Install into its own virtualenv so the runner's Python stays untouched and
# the executable path is predictable.
python3 -m venv /opt/hermes-venv
/opt/hermes-venv/bin/pip install --quiet --upgrade pip
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
echo "hermes_executable=$HERMES_WRAPPER_DIR/hermes (wraps $HERMES_BIN)"
echo "hermes_version=$("$HERMES_BIN" --version 2>/dev/null | head -n 1)"
echo "hermes_profile=$HERMES_PROFILE_HOME (mode $(stat -c '%a' "$HERMES_PROFILE_HOME"))"
echo "hermes_credential=REGISTERED"
