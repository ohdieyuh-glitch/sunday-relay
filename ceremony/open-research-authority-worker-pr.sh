#!/usr/bin/env bash
# Opens EXACTLY ONE pull request for the frozen research-authority-pr candidate,
# authored by the julius-worker GitHub App.
#
# Run this once, in the Codespace that holds JULIUS_WORKER_APP_PEM.
# It prints no credential material: the PEM is never echoed, the JWT and the
# installation token are held in shell variables and never written to a file,
# and every curl call sends the token in a header rather than a URL.
#
# It refuses unless ALL of these hold, so it cannot open a PR for the wrong tree:
#   * origin/main is still the trusted base
#   * the branch head is the exact frozen head
#   * the tree matches
#   * there is exactly 1 commit above main
#   * every commit's AUTHOR and COMMITTER are julius-worker[bot]
set -euo pipefail

REPO='ohdieyuh-glitch/sunday-relay'
BRANCH='relay/julius-research-authority'
BASE='7982593526ffe9c86676991715201d84a096cfa2'
HEAD='6c3a4e7431a8c2d5d6e69bfa206e199090ce2c57'
TREE='0fb53fa92ee8859c308d016d265c4bc710141087'
COMMITS=1
WORKER='julius-worker[bot]'
# RESOLVED AGAINST THE SCRIPT, NOT THE WORKING DIRECTORY. The README says to run
# this as `bash ceremony/open-...-pr.sh` from the repository root, where a bare
# filename resolves to `./PR_BODY_...md` and is not there. Same class of fault as
# the inline-Python trap: a runbook that does not match its own script.
BODY_FILE="${PR_BODY_FILE:-$(dirname "$0")/PR_BODY_RESEARCH_AUTHORITY.md}"

APP_ID="${JULIUS_WORKER_APP_ID:-${1:-}}"
[ -n "$APP_ID" ] || { echo 'need the julius-worker App ID: export JULIUS_WORKER_APP_ID=<id> (or pass it as $1)' >&2; exit 2; }

# THE APP ID IS NOT THE BOT USER ID, and they are easy to confuse because the
# bot's commit address is built from the USER id:
#   325202980+julius-worker[bot]@users.noreply.github.com
# That number is the bot's user id and appears as `user.id` on every PR it
# opens. The App ID is a different, much smaller number, on the app's settings
# page (Settings -> Developer settings -> GitHub Apps -> julius-worker -> "App ID").
# Signing a JWT with the user id yields a 401 that used to surface as a Python
# KeyError several lines later, which is how one run died having created nothing.
if [ "$APP_ID" = '325202980' ]; then
  echo 'JULIUS_WORKER_APP_ID is 325202980, which is the BOT USER id, not the App ID.' >&2
  echo 'Find the App ID on the app settings page for julius-worker; it is a much smaller number.' >&2
  exit 2
fi
[ -n "${JULIUS_WORKER_APP_PEM:-}" ] || { echo 'JULIUS_WORKER_APP_PEM is not set in this shell' >&2; exit 2; }
[ -f "$BODY_FILE" ] || { echo "PR body not found: $BODY_FILE" >&2; exit 2; }

echo '== verifying the candidate before touching GitHub =='
git fetch --quiet origin main "$BRANCH"

got_base="$(git rev-parse origin/main)"
[ "$got_base" = "$BASE" ] || { echo "main moved: $got_base != $BASE — STOP, the candidate is stale" >&2; exit 1; }
echo "  base       $BASE  OK"

got_head="$(git rev-parse "origin/$BRANCH")"
[ "$got_head" = "$HEAD" ] || { echo "head is $got_head, expected $HEAD — STOP" >&2; exit 1; }
echo "  head       $HEAD  OK"

got_tree="$(git rev-parse "origin/$BRANCH^{tree}")"
[ "$got_tree" = "$TREE" ] || { echo "tree is $got_tree, expected $TREE — STOP" >&2; exit 1; }
echo "  tree       $TREE  OK"

got_count="$(git rev-list --count "$BASE..origin/$BRANCH")"
[ "$got_count" = "$COMMITS" ] || { echo "$got_count commits above main, expected $COMMITS — STOP" >&2; exit 1; }
echo "  commits    $COMMITS  OK"

bad=0
while IFS='|' read -r sha an cn; do
  [ "$an" = "$WORKER" ] && [ "$cn" = "$WORKER" ] || { echo "  $sha author='$an' committer='$cn' — NOT the worker" >&2; bad=1; }
done < <(git log --format='%h|%an|%cn' "$BASE..origin/$BRANCH")
[ "$bad" = 0 ] || { echo 'provenance check failed — STOP' >&2; exit 1; }
echo "  provenance every commit authored AND committed by $WORKER  OK"

echo '== minting an installation token =='
b64() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
now=$(date +%s)
jwt_header="$(printf '{"alg":"RS256","typ":"JWT"}' | b64)"
jwt_claim="$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((now - 60))" "$((now + 540))" "$APP_ID" | b64)"
jwt_sig="$(printf '%s.%s' "$jwt_header" "$jwt_claim" \
  | openssl dgst -binary -sha256 -sign <(printf '%s' "$JULIUS_WORKER_APP_PEM") | b64)"
JWT="${jwt_header}.${jwt_claim}.${jwt_sig}"

# Each step says what GitHub actually answered. A missing field used to raise a
# KeyError and die under `set -e` with a traceback and no diagnosis; GitHub's own
# message ("A JWT could not be decoded", "Integration not found") names the fault.
# The reader is a FILE, not inline Python: inline Python inside this script is
# how the ceremony has failed twice (see ceremony/github-field.py).
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

echo '== refusing to open a second PR for this branch =='
open_count="$(curl -sS -H "Authorization: token $TOKEN" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/pulls?state=open&head=ohdieyuh-glitch:$BRANCH" \
  | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')"
[ "$open_count" = 0 ] || { echo "a PR for $BRANCH is already open — STOP" >&2; exit 1; }

echo '== creating the pull request =='
# THE TITLE COMES FROM THE BODY'S OWN HEADING, never from a literal here.
#
# A literal is what a copied opener carries forward silently. This one did:
# the peer-hardening ceremony opened its PR titled "the continuous-worker
# architecture, armed" — the PREVIOUS candidate's title — because the SHAs and
# the body filename were re-pinned and the title was not. Nothing verified it,
# because nothing could: a title is not a SHA. Deriving it from the first `# `
# line of the body makes the two unable to disagree.
#
# The branch comes from $BRANCH for the same reason: one place to re-pin.
payload="$(BRANCH="$BRANCH" python3 - "$BODY_FILE" <<'PY'
import json, os, sys
body = open(sys.argv[1], encoding="utf-8").read()
title = next((line[2:].strip() for line in body.splitlines() if line.startswith("# ")), None)
if not title:
    sys.exit("PR body has no `# ` heading to take a title from — STOP")
print(json.dumps({
  "title": title,
  "head": os.environ["BRANCH"],
  "base": "main",
  "body": body,
  "maintainer_can_modify": False,
}))
PY
)"
number="$(printf '%s' "$payload" | curl -sS -X POST -H "Authorization: token $TOKEN" \
  -H 'Accept: application/vnd.github+json' --data-binary @- \
  "https://api.github.com/repos/$REPO/pulls" | field number 'creating the pull request')" || {
    echo 'the pull request was NOT created — nothing was changed on GitHub' >&2; exit 1; }

echo '== reading it back =='
# NOT a heredoc. `python3 <<'X'` makes python read the PROGRAM from stdin, so the
# curl output is consumed as source and json.load(sys.stdin) sees nothing —
# JSONDecodeError, AFTER the pull request has already been created. That is what
# killed the read-back on #247 (an f-string quoting fault) and again on #249.
# Every GitHub response in this script now goes through the same FILE.
readback="$(curl -sS -H "Authorization: token $TOKEN" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/pulls/$number")"
printf '  PR #%s  by %s\n' \
  "$(printf '%s' "$readback" | field number 'reading back the number')" \
  "$(printf '%s' "$readback" | field user.login 'reading back the author')"
printf '  head  %s\n'  "$(printf '%s' "$readback" | field head.sha 'reading back the head')"
printf '  base  %s\n'  "$(printf '%s' "$readback" | field base.sha 'reading back the base')"
printf '  state %s\n'  "$(printf '%s' "$readback" | field state 'reading back the state')"
unset TOKEN

echo
echo "WORKER PR OPENED: #$number"
