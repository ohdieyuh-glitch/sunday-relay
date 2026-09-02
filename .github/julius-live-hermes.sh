#!/usr/bin/env bash
# Installs Hermes on the runner and bootstraps ONE ephemeral profile holding
# the xAI credential, for the Independent Reviewer role only.
#
# WHY A PROFILE AND NOT AN ENVIRONMENT VARIABLE. `runHermesReview` — the path
# Julius uses — spawns Hermes with `env: {PATH, HOME}` and nothing else. That
# is deliberate: the reviewer's credential is not something Julius holds, pass
# around, or can leak into a prompt, an artifact or an evidence record. The
# only supported way to give that child a credential is therefore the profile
# under its HOME, written by Hermes itself via `hermes auth add`. This script
# does not widen that boundary and Julius is not modified to accommodate CI.
#
# EPHEMERAL. The profile lives in a directory created here, is 0700, is used
# by exactly one job, and is shredded by the workflow's cleanup step. It is
# never uploaded as an artifact and never written into the repository.
#
# THE CREDENTIAL IS NEVER ECHOED. It arrives in XAI_API_KEY from the job's
# environment (a GitHub Environment secret), is registered by Hermes, and is
# never printed, logged, or written anywhere this script controls.
set -euo pipefail

: "${HERMES_PROFILE_HOME:?missing HERMES_PROFILE_HOME}"
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

# `hermes auth add` writes the credential into the profile in whatever shape
# this Hermes version owns. Registering it through the tool rather than
# hand-writing a file is what keeps this correct across versions — the format
# is Hermes's business, not this repository's.
HOME="$HERMES_PROFILE_HOME" HERMES_HOME="$HERMES_PROFILE_HOME/.hermes" \
  "$HERMES_BIN" auth add "$HERMES_PROVIDER" --type api-key --api-key "$XAI_API_KEY" --label julius-live-ci >/dev/null 2>&1 \
  || { echo 'hermes_auth_add_failed' >&2; exit 1; }

chmod -R go-rwx "$HERMES_PROFILE_HOME"

# Report only that a profile now exists and is owner-only. Its CONTENT is
# never read, printed, or summarised here.
if [ ! -d "$HERMES_PROFILE_HOME/.hermes" ]; then
  echo 'hermes_profile_missing' >&2
  exit 1
fi
echo "hermes_executable=$HERMES_BIN"
echo "hermes_version=$("$HERMES_BIN" --version 2>/dev/null | head -n 1)"
echo "hermes_profile=$HERMES_PROFILE_HOME (mode $(stat -c '%a' "$HERMES_PROFILE_HOME"))"
echo "hermes_credential=REGISTERED"
