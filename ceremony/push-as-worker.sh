#!/usr/bin/env bash
# Pushes ONE branch to GitHub as the julius-worker GitHub App — never as whoever
# the local git credential helper happens to be.
#
# WHY THIS EXISTS. Earlier ceremonies pushed the worker branch with the machine's
# ordinary git credential, which on this workstation maps to the founder account.
# The founder's rule is that a coding session must not exercise founder authority
# for worker ceremony actions, so the push goes through the App like the PR does.
#
# Run from the repository root, with the App credential supplied to THIS PROCESS
# ONLY:
#   JULIUS_WORKER_APP_ID=<id> JULIUS_WORKER_APP_PEM="$(< ~/.config/julius/julius-worker.pem)" \
#     bash ceremony/push-as-worker.sh <branch> <expected-head-sha> [<main-sha-that-must-be-ancestor>]
#
# It refuses, before minting anything, unless ALL of these hold:
#   * the local branch head is exactly <expected-head-sha>
#   * every commit above origin/main is authored AND committed by julius-worker[bot]
#   * <main-sha>, when given, is an ancestor of the head
#   * the branch does not already exist on GitHub (no force, no overwrite)
#
# CREDENTIAL HANDLING. The PEM is never echoed. The JWT and the installation
# token live in shell variables only. The token reaches git through
# GIT_CONFIG_* ENVIRONMENT variables, not argv (argv is visible to other
# processes), and the credential helper is explicitly RESET so a rejected token
# fails the push instead of silently falling back to a stored credential.
set -euo pipefail

REPO='ohdieyuh-glitch/sunday-relay'
WORKER='julius-worker[bot]'
BRANCH="${1:-}"; EXPECTED_HEAD="${2:-}"; MUST_CONTAIN="${3:-}"
[ -n "$BRANCH" ] && [ -n "$EXPECTED_HEAD" ] || { echo 'usage: push-as-worker.sh <branch> <expected-head-sha> [<main-sha>]' >&2; exit 2; }
[[ "$EXPECTED_HEAD" =~ ^[0-9a-f]{40}$ ]] || { echo 'expected head must be a full 40-hex sha' >&2; exit 2; }

APP_ID="${JULIUS_WORKER_APP_ID:-}"
[ -n "$APP_ID" ] || { echo 'need JULIUS_WORKER_APP_ID' >&2; exit 2; }
if [ "$APP_ID" = '325202980' ]; then echo 'JULIUS_WORKER_APP_ID is the BOT USER id, not the App ID' >&2; exit 2; fi
[ -n "${JULIUS_WORKER_APP_PEM:-}" ] || { echo 'JULIUS_WORKER_APP_PEM is not set in this shell' >&2; exit 2; }

echo "== verifying $BRANCH before touching GitHub =="
git fetch --quiet origin main
got_head="$(git rev-parse "refs/heads/$BRANCH")"
[ "$got_head" = "$EXPECTED_HEAD" ] || { echo "local $BRANCH is $got_head, expected $EXPECTED_HEAD — STOP" >&2; exit 1; }
echo "  head       $EXPECTED_HEAD  OK"

if [ -n "$MUST_CONTAIN" ]; then
  git merge-base --is-ancestor "$MUST_CONTAIN" "$EXPECTED_HEAD" || { echo "$MUST_CONTAIN is not contained in the head — STOP" >&2; exit 1; }
  echo "  contains   $MUST_CONTAIN  OK"
fi

count=0; bad=0
while IFS='|' read -r sha an cn; do
  count=$((count + 1))
  [ "$an" = "$WORKER" ] && [ "$cn" = "$WORKER" ] || { echo "  $sha author='$an' committer='$cn' — NOT the worker" >&2; bad=1; }
done < <(git log --format='%h|%an|%cn' "origin/main..$EXPECTED_HEAD")
[ "$bad" = 0 ] || { echo 'provenance check failed — STOP' >&2; exit 1; }
[ "$count" -gt 0 ] || { echo 'nothing above origin/main to push — STOP' >&2; exit 1; }
echo "  provenance all $count commit(s) above main authored AND committed by $WORKER  OK"

remote="$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)"
[ -z "$remote" ] || { echo "$BRANCH already exists on GitHub at $remote — refusing to overwrite" >&2; exit 1; }
echo '  remote     branch absent on GitHub  OK'

echo '== minting an installation token =='
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
jwt_header="$(printf '{"alg":"RS256","typ":"JWT"}' | b64)"
jwt_claim="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$APP_ID" | b64)"
jwt_sig="$(printf '%s.%s' "$jwt_header" "$jwt_claim" \
  | openssl dgst -binary -sha256 -sign <(printf '%s' "$JULIUS_WORKER_APP_PEM") | b64)"
JWT="${jwt_header}.${jwt_claim}.${jwt_sig}"
field() { python3 "$(dirname "$0")/github-field.py" "$1" "$2"; }
install_id="$(curl -sS -H "Authorization: Bearer $JWT" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/installation" | field id 'looking up the installation')" || {
    echo 'the App could not be identified — check JULIUS_WORKER_APP_ID and JULIUS_WORKER_APP_PEM' >&2; exit 1; }
echo "  installation $install_id resolved"
TOKEN="$(curl -sS -X POST -H "Authorization: Bearer $JWT" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/app/installations/$install_id/access_tokens" | field token 'minting the token')" || {
    echo 'could not mint an installation token' >&2; exit 1; }
unset JWT jwt_sig
[ -n "$TOKEN" ] || { echo 'could not mint an installation token' >&2; exit 1; }
echo '  token minted (not printed)'

echo "== pushing $BRANCH as $WORKER =="
AUTH="$(printf 'x-access-token:%s' "$TOKEN" | openssl base64 -A)"
unset TOKEN
# Explicit URL, no stored remote credential, helper reset, no prompt.
GIT_TERMINAL_PROMPT=0 \
GIT_CONFIG_COUNT=2 \
GIT_CONFIG_KEY_0='credential.helper' GIT_CONFIG_VALUE_0='' \
GIT_CONFIG_KEY_1='http.https://github.com/.extraheader' GIT_CONFIG_VALUE_1="AUTHORIZATION: basic $AUTH" \
  git push --quiet "https://github.com/$REPO.git" "$EXPECTED_HEAD:refs/heads/$BRANCH"
unset AUTH

got_remote="$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)"
[ "$got_remote" = "$EXPECTED_HEAD" ] || { echo "GitHub reports $got_remote for $BRANCH, expected $EXPECTED_HEAD" >&2; exit 1; }
echo "WORKER PUSH OK: $BRANCH @ $EXPECTED_HEAD"
