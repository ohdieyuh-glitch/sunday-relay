#!/usr/bin/env bash
# Opens EXACTLY ONE pull request for the frozen reviewer-deadline repair and Mission 5 fixture,
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
#   * there are exactly 2 commits above main
#   * every commit's AUTHOR and COMMITTER are julius-worker[bot]
set -euo pipefail

REPO='ohdieyuh-glitch/sunday-relay'
BRANCH='relay/julius-timeout-truth-and-mission-5'
BASE='5be73c5653ba26b607b6e805c720ebddc549dd5f'
HEAD='b06381669244097dabb84af7adf243c36ce91888'
TREE='bae8f38227f7d40adeec39eff340cc86e31e4261'
COMMITS=2
WORKER='julius-worker[bot]'
BODY_FILE="${PR_BODY_FILE:-PR_BODY_MISSION5.md}"

APP_ID="${JULIUS_WORKER_APP_ID:-${1:-}}"
[ -n "$APP_ID" ] || { echo 'need the julius-worker App ID: export JULIUS_WORKER_APP_ID=<id> (or pass it as $1)' >&2; exit 2; }
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

install_id="$(curl -sS -H "Authorization: Bearer $JWT" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/installation" | python3 -c 'import sys,json; print(json.load(sys.stdin)["id"])')"
TOKEN="$(curl -sS -X POST -H "Authorization: Bearer $JWT" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/app/installations/$install_id/access_tokens" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')"
unset JWT jwt_sig
[ -n "$TOKEN" ] || { echo 'could not mint an installation token' >&2; exit 1; }
echo '  token minted (not printed)'

echo '== refusing to open a second PR for this branch =='
open_count="$(curl -sS -H "Authorization: token $TOKEN" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/pulls?state=open&head=ohdieyuh-glitch:$BRANCH" \
  | python3 -c 'import sys,json; print(len(json.load(sys.stdin)))')"
[ "$open_count" = 0 ] || { echo "a PR for $BRANCH is already open — STOP" >&2; exit 1; }

echo '== creating the pull request =='
payload="$(python3 - "$BODY_FILE" <<'PY'
import json, sys
print(json.dumps({
  "title": "Julius: one derivation decides how long a review may take, and the Mission 5 fixture",
  "head": "relay/julius-timeout-truth-and-mission-5",
  "base": "main",
  "body": open(sys.argv[1], encoding="utf-8").read(),
  "maintainer_can_modify": False,
}))
PY
)"
number="$(printf '%s' "$payload" | curl -sS -X POST -H "Authorization: token $TOKEN" \
  -H 'Accept: application/vnd.github+json' --data-binary @- \
  "https://api.github.com/repos/$REPO/pulls" \
  | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d.get("number") or d)')"

echo '== reading it back =='
curl -sS -H "Authorization: token $TOKEN" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$REPO/pulls/$number" \
| python3 <<'READBACK'
import sys, json
d = json.load(sys.stdin)
print('  PR #%s  by %s' % (d['number'], d['user']['login']))
print('  head %s' % d['head']['sha'])
print('  base %s' % d['base']['sha'])
print('  state %s' % d['state'])
READBACK
unset TOKEN

echo
echo "WORKER PR OPENED: #$number"
