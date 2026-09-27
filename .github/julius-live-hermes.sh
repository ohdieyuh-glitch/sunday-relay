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
# The isolation proof below runs the command the review runs, and that command
# names the model. A proof run with a different model or none would be a proof
# about a neighbouring invocation.
: "${RELAY_HERMES_MODEL:?missing RELAY_HERMES_MODEL}"
# RELAY'S OWN WINDOW IS NO LONGER AN ENVIRONMENT VARIABLE. It is derived below
# by scripts/julius-reviewer-deadline.mjs, the same derivation the bridge uses
# for both the Hermes transport and the reviewer worker's declared deadline.
# Deriving it rather than accepting a literal is what stopped three numbers from
# describing one limit.
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

# FETCH THE SOURCE OURSELVES, ONCE, WITH RETRIES — then install from disk.
#
# `pip install "git+https://…@<sha>"` was the whole install, and it made TWO
# unauthenticated requests to github.com: a `--filter=blob:none` clone, then a
# lazy blob fetch from the promisor remote during `git checkout`. The zero-spend
# preflight for Live Run 3 was refused twice by HTTP 429 — once at the clone
# (run 34388913340) and once at the promisor fetch (34389221834) — so both
# halves of that path are exposed, and neither retried.
#
# `git fetch --depth 1 origin <sha>` asks for exactly the pinned commit and its
# trees and blobs in one request. There is no partial clone and therefore no
# promisor remote to come back to, which removes the second failure mode
# outright rather than retrying it.
#
# THE CLONE STAYS UNAUTHENTICATED, deliberately. A token would raise the rate
# limit and would also be readable by `setup.py` and every build hook in a
# third-party repository, which is exactly the exposure this file exists to
# avoid. Waiting is the cheaper trade: the limit is transient and this step
# still runs before anything can reach a provider, so a refusal here costs a
# job and never money.
HERMES_SRC=/opt/hermes-src
rm -rf "$HERMES_SRC"
mkdir -p "$HERMES_SRC"
git -C "$HERMES_SRC" init --quiet
git -C "$HERMES_SRC" remote add origin https://github.com/NousResearch/hermes-agent.git
fetched=''
for delay in 0 5 15 30 60; do
  [ "$delay" -eq 0 ] || { echo "hermes_source_fetch_retry_after_${delay}s"; sleep "$delay"; }
  if git -C "$HERMES_SRC" fetch --quiet --depth 1 origin "$HERMES_REF" 2>&1; then fetched='yes'; break; fi
done
[ -n "$fetched" ] || { echo 'hermes_source_fetch_failed: upstream refused the pinned commit' >&2; exit 1; }
git -C "$HERMES_SRC" checkout --quiet FETCH_HEAD

# THE PIN IS NOW OURS TO PROVE. pip resolved the ref itself before; this script
# does, so it says out loud which commit it is about to install. A checkout that
# is not the pinned commit is a different Hermes, and an immutable pin nobody
# checks is a tag with extra characters.
got="$(git -C "$HERMES_SRC" rev-parse HEAD)"
[ "$got" = "$HERMES_REF" ] || {
  echo "hermes_source_not_pinned: checked out $got, expected $HERMES_REF" >&2; exit 1; }
/opt/hermes-venv/bin/pip install --quiet "$HERMES_SRC"


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
# THE STREAM WATCHDOGS, TIED TO THE ONE REQUEST DEADLINE.
#
# Hermes loads this file into its environment, and for a responses-mode stream
# it applies two watchdogs of its own beside the request timeout
# (agent/chat_completion_helpers.py at the pinned commit): no first byte within
# HERMES_CODEX_TTFB_TIMEOUT_SECONDS (default 120 s), and no SSE event for
# HERMES_CODEX_EVENT_STALE_TIMEOUT_SECONDS after the first byte — a default that
# scales with request size and is 12 s below ~10k tokens. A reasoning model
# streams nothing while it thinks, so paid qualification 34753589938's tool-less
# reviewer was killed at 12 s and the record read "prose". Both are set to the
# request timeout: silence is allowed exactly as long as a whole request is, and
# never longer. Not secrets; they share the file because Hermes reads it first.
printf '%s=%s\n' 'HERMES_CODEX_EVENT_STALE_TIMEOUT_SECONDS' "$HERMES_REQUEST_TIMEOUT_SECONDS" >> "$HERMES_PROFILE_HOME/.hermes/.env"
printf '%s=%s\n' 'HERMES_CODEX_TTFB_TIMEOUT_SECONDS' "$HERMES_REQUEST_TIMEOUT_SECONDS" >> "$HERMES_PROFILE_HOME/.hermes/.env"
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
# THE PROFILE IS ALSO WHERE READ-ONLY LIVES, because nothing else carries it.
#
# This file used to write only the deadline and `api_max_retries`. Measured
# against this pinned Hermes, with that profile and the flags `runHermesReview`
# passes, `hermes -z --safe-mode` handed the reviewer terminal, write_file,
# patch, execute_code, delegate_task and web tools, with every approval
# auto-granted by one-shot mode. `--safe-mode` keeps plugins, shell hooks and
# MCP servers out; it does not stop the one-shot path reading this profile's
# toolsets, and the profile named none. The reviewer harness has always
# disabled every toolset in its own profile; the paid profile now carries the
# same settings, rendered by `scripts/julius-reviewer-isolation.mjs` from one
# list that a test holds equal to the harness's.
#
# The model and the provider still stay on Julius's command line, where they
# already are: this file must not become a second place that decides who
# reviews. It names the provider only to give that provider its deadline.
node scripts/julius-reviewer-isolation.mjs config "$HERMES_PROVIDER" "$HERMES_REQUEST_TIMEOUT_SECONDS" \
  > "$HERMES_PROFILE_HOME/.hermes/config.yaml" || {
  echo 'hermes_reviewer_profile_refused' >&2; exit 1; }
chmod 0600 "$HERMES_PROFILE_HOME/.hermes/config.yaml"

# AND THE ORDER IS CHECKED, NOT ASSUMED. If the engine's worst case does not fit
# inside Relay's window then Relay cuts first again and the next paid failure is
# as unreadable as the last, so this refuses before a provider is contacted.
# ONE FILE, NAMED LITERALLY, ONCE PER FIELD. Neither `node -e` nor a path held
# in a variable: `relay-repository-boundary.mjs` refuses a deployment-capable
# path whose entry it cannot READ, and both of those hide the entry from it. The
# workflow runs this script from the repository root, the same place
# `node scripts/julius-live-contract-check.mjs` is invoked from.
RELAY_HERMES_TIMEOUT_MS="$(node scripts/julius-reviewer-deadline.mjs operativeTimeoutMs)" || {
  echo "reviewer_deadline_policy_refused" >&2; exit 1; }
export RELAY_HERMES_TIMEOUT_MS
worst_case_ms="$(node scripts/julius-reviewer-deadline.mjs analyticalWorstCaseMs)"
deadline_basis="$(node scripts/julius-reviewer-deadline.mjs basis)"
deadline_floor_ms="$(node scripts/julius-reviewer-deadline.mjs floorMs)"
# The engine's own deadline must still land INSIDE Relay's window, or Relay cuts
# first and every distinct provider fault reaches the record as one shape again.
# What changed is that Relay's window is now derived from the worst thing any
# paid run was ever seen to do, not from a model that Paid Mission 4 outran.
# THE REQUEST COUNT COMES FROM THE POLICY, NOT FROM A `2` WRITTEN HERE.
# `x 2` was the same assertion `DEFAULT_ANALYTICAL_MODEL` made, and Mission 4's
# own COMPLETED review falsifies it: a 381 880 ms review at 90 s per request
# with no engine retries made at least five. The literal made this check pass
# with 300 s of margin that did not exist.
requests_per_review="$(node scripts/julius-reviewer-deadline.mjs requestsPerReview)" || {
  echo "reviewer_deadline_policy_refused" >&2; exit 1; }
engine_deadline_ms=$(( HERMES_REQUEST_TIMEOUT_SECONDS * requests_per_review * 1000 ))
if [ "$engine_deadline_ms" -ge "$RELAY_HERMES_TIMEOUT_MS" ]; then
  echo "hermes_engine_deadline_not_inside_relay_window:${engine_deadline_ms}ms_vs_${RELAY_HERMES_TIMEOUT_MS}ms" >&2
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

# AND THE REVIEWER'S ISOLATION IS PROVEN ON THE PATH THE REVIEW TAKES.
#
# A profile that says "no tools" is a hope about how Hermes reads it. This runs
# the wrapper above, which runs the real `hermes -z`, with the flags
# `runHermesReview` passes, from an empty scratch directory, under exactly the
# environment Julius gives the reviewer child: `PATH` and `HOME`, which the
# wrapper then points at the profile. Two variables are added and nothing else.
# `PYTHONPATH` loads `.github/julius-live-hermes-isolation/sitecustomize.py`,
# which closes the network and, when Hermes asks its agent for a conversation,
# writes down what that agent was built with and returns instead of asking a
# model. `RELAY_REVIEWER_ISOLATION_RECORD` says where to write it.
#
# `scripts/julius-reviewer-isolation.mjs verify` then refuses the job unless the
# agent held no tool and no toolset, `--safe-mode` took effect, no shell hook
# was registered, each provider call gets one attempt, and the provider and
# model are the ones configured with this deadline on both timeouts. Hermes's
# exit status is not the judge: a run that never built an agent writes a record
# saying so, and that record is refused.
#
# Nothing here reaches a provider: every name lookup and connection raises, and
# the guard proves that it does before Hermes starts. It runs after the pinned
# install and before the mission, so a refusal costs a job and never money.
#
# THE RECORDER EXISTS FOR THIS COMMAND ONLY. A recorder that reached the paid
# review would itself be a patched agent, so it is kept away from everything the
# review uses. It is copied into a fresh directory that is neither the profile
# nor the wrapper's; the record is written beside it; both directories are
# removed whatever the verdict. The wrapper above names neither variable, and
# Julius spawns it with PATH and HOME only, so the review has no path to the
# copy even while it exists. The recorder also does nothing unless its record
# variable is set.
isolation_hook_source="$(pwd -P)/.github/julius-live-hermes-isolation/sitecustomize.py"
[ -f "$isolation_hook_source" ] || { echo 'hermes_reviewer_isolation_proof_missing' >&2; exit 1; }
isolation_dir="$(mktemp -d)"
isolation_cwd="$(mktemp -d)"
mkdir "$isolation_dir/hook"
cp "$isolation_hook_source" "$isolation_dir/hook/sitecustomize.py"
( cd "$isolation_cwd" && exec env -i PATH="$PATH" HOME="$HOME" \
    PYTHONPATH="$isolation_dir/hook" RELAY_REVIEWER_ISOLATION_RECORD="$isolation_dir/record.json" \
    "$HERMES_WRAPPER_DIR/hermes" -z 'Relay reviewer isolation proof: the network is closed and no model is asked.' \
    --safe-mode --usage-file "$isolation_cwd/relay-hermes-usage.json" \
    -m "$RELAY_HERMES_MODEL" --provider "$HERMES_PROVIDER" ) >/dev/null 2>&1 || true
reviewer_isolation="$(node scripts/julius-reviewer-isolation.mjs verify "$isolation_dir/record.json" \
  "$HERMES_PROVIDER" "$RELAY_HERMES_MODEL" "$HERMES_REQUEST_TIMEOUT_SECONDS")" || {
  rm -rf "$isolation_dir" "$isolation_cwd"
  echo 'hermes_reviewer_isolation_refused' >&2; exit 1; }
rm -rf "$isolation_dir" "$isolation_cwd"
# THE SAME LINES, KEPT WHERE THE BUNDLE CAN READ THEM.
#
# Run 34311556047's evidence could not say which reviewer binary ran, under
# which profile, or with which deadlines — those facts existed only in the
# step log, which is not the artifact anyone reads a paid failure out of.
# Every line is already printed to that public log and none of them is or
# contains a credential: paths, a version string, a mode, integers, the word
# REGISTERED, and the isolation proof's counts. The evidence step copies this
# file into the bundle, where the two credential scans see it like everything
# else.
HERMES_BOOTSTRAP_EVIDENCE=${HERMES_BOOTSTRAP_EVIDENCE:-/tmp/julius-hermes-bootstrap.evidence.txt}
{
  echo "hermes_executable=$HERMES_WRAPPER_DIR/hermes (wraps $HERMES_BIN)"
  echo "hermes_ref=$HERMES_REF"
  echo "hermes_version=$("$HERMES_BIN" --version 2>/dev/null | head -n 1)"
  echo "hermes_profile=$HERMES_PROFILE_HOME (mode $(stat -c '%a' "$HERMES_PROFILE_HOME"))"
  echo "hermes_credential=REGISTERED"
  echo "hermes_request_timeout_seconds=$HERMES_REQUEST_TIMEOUT_SECONDS (resolved by hermes itself)"
  echo "$reviewer_isolation"
  echo "relay_reviewer_window_ms=$RELAY_HERMES_TIMEOUT_MS (basis ${deadline_basis}, floor ${deadline_floor_ms}ms, analytical ${worst_case_ms}ms)"
} | tee "$HERMES_BOOTSTRAP_EVIDENCE"
chmod 0644 "$HERMES_BOOTSTRAP_EVIDENCE"
