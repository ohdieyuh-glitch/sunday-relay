#!/usr/bin/env bash
# Replaces the body of ONE open julius-worker pull request, as the julius-worker
# GitHub App, after verifying the PR is still the worker's and still at the
# exact head the new body describes.
#
#   JULIUS_WORKER_APP_ID=<id> JULIUS_WORKER_APP_PEM="$(cat <pem>)" \
#     bash ceremony/update-julius-worker-pr-body.sh <pr-number> <expected-head> <body-file>
#
# The PEM lives only in this child process. Nothing credential-shaped is printed:
# the JWT and the installation token stay in shell variables, and every call
# sends the token in a header.
set -euo pipefail

REPO='ohdieyuh-glitch/sunday-relay'
WORKER='julius-worker[bot]'
PR="${1:?pull request number}"
HEAD="${2:?expected head sha}"
BODY_FILE="${3:?body file}"

APP_ID="${JULIUS_WORKER_APP_ID:?need the julius-worker App ID}"
if [ "$APP_ID" = '325202980' ]; then echo 'that is the BOT USER id, not the App ID' >&2; exit 2; fi
[ -n "${JULIUS_WORKER_APP_PEM:-}" ] || { echo 'JULIUS_WORKER_APP_PEM is not set in this shell' >&2; exit 2; }
[ -f "$BODY_FILE" ] || { echo "body not found: $BODY_FILE" >&2; exit 2; }
grep -qF "$HEAD" "$BODY_FILE" || { echo "the body does not name the head $HEAD — STOP" >&2; exit 1; }

field() { python3 "$(dirname "$0")/github-field.py" "$1" "$2"; }

echo '== minting an installation token =='
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
jwt_header="$(printf '{"alg":"RS256","typ":"JWT"}' | b64)"
jwt_claim="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$APP_ID" | b64)"
jwt_sig="$(printf '%s.%s' "$jwt_header" "$jwt_claim" | openssl dgst -binary -sha256 -sign <(printf '%s' "$JULIUS_WORKER_APP_PEM") | b64)"
JWT="${jwt_header}.${jwt_claim}.${jwt_sig}"
install_id="$(curl -sS -H "Authorization: Bearer $JWT" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/installation" | field id 'looking up the installation')"
TOKEN="$(curl -sS -X POST -H "Authorization: Bearer $JWT" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/app/installations/$install_id/access_tokens" | field token 'minting the token')"
unset JWT jwt_sig
echo '  token minted (not printed)'

echo '== verifying the pull request before touching it =='
current="$(curl -sS -H "Authorization: token $TOKEN" -H 'Accept: application/vnd.github+json' "https://api.github.com/repos/$REPO/pulls/$PR")"
state="$(printf '%s' "$current" | field state 'reading the state')"
author="$(printf '%s' "$current" | field user.login 'reading the author')"
head="$(printf '%s' "$current" | field head.sha 'reading the head')"
[ "$state" = open ] || { echo "PR #$PR is $state — STOP" >&2; exit 1; }
[ "$author" = "$WORKER" ] || { echo "PR #$PR is by $author, not $WORKER — STOP" >&2; exit 1; }
[ "$head" = "$HEAD" ] || { echo "PR #$PR head is $head, not $HEAD — STOP" >&2; exit 1; }
echo "  PR #$PR open, by $WORKER, at $HEAD  OK"

echo '== replacing the body =='
payload="$(python3 -c 'import json,sys; print(json.dumps({"body": open(sys.argv[1], encoding="utf-8").read()}))' "$BODY_FILE")"
updated="$(printf '%s' "$payload" | curl -sS -X PATCH -H "Authorization: token $TOKEN" -H 'Accept: application/vnd.github+json' \
  --data-binary @- "https://api.github.com/repos/$REPO/pulls/$PR" | field number 'updating the body')"
unset TOKEN
echo "BODY UPDATED: #$updated"
