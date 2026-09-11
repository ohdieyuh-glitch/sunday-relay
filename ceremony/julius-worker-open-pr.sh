#!/usr/bin/env bash
#
# OPEN THE BRAND/DOCUMENTATION CANDIDATE AS julius-worker[bot].
#
# Run this in the trusted Codespace, which holds the persistent secrets
# JULIUS_WORKER_APP_ID and JULIUS_WORKER_APP_PEM. Nothing here prints, logs,
# copies or asks for the PEM: it is read once from the environment and piped
# straight into openssl through a process substitution, so it never reaches
# disk, never reaches a shell history line, and never reaches stdout.
#
# THE APP ID IS NOT THE BOT USER ID, and this is the trap that wastes an hour.
# docs/JULIUS_WORKER_PR_RUNBOOK.md calls 325202980 the "App id". It is not: it
# is the BOT USER id — the `user.id` GitHub reports for julius-worker[bot] and
# the prefix of its noreply commit email. A JWT signed with `iss: 325202980`
# authenticates as nothing. The App id is 4838349, and it is what `iss` needs.
#
# WHAT THIS SCRIPT WILL NOT DO. It does not approve, does not merge, does not
# enable auto-merge and does not touch repository metadata. The worker App must
# never approve or merge its own pull request; founder exact-head approval is a
# separate act by a separate identity. The GitHub repository description is not
# part of the git squash and is changed only AFTER the pull request lands.
#
# DEFAULT IS VERIFY-ONLY. Without --open-pr it runs every check and stops. That
# is deliberate: the checks are the point, and opening the PR is one flag.

set -euo pipefail

OWNER=ohdieyuh-glitch
REPO=sunday-relay
# FROZEN 2026-09-11, after replaying onto trusted main 9f155b91 (the squash of
# #254). These are the exact objects the founder approves against; they are
# overridable only so the script can be re-pinned if main moves again, which is
# the one event that invalidates this candidate.
BRANCH="${CEREMONY_BRANCH:-claude/sunday-relay-brand-docs-imb2bk}"
EXPECT_BASE="${CEREMONY_BASE:-9f155b919b0243e20fc3af132e9ea9176fd470ba}"
EXPECT_HEAD="${CEREMONY_HEAD:-4a775e89e7c68f68ebe2c1274316352505c99b9f}"
EXPECT_TREE="${CEREMONY_TREE:-6da3f6db2f7a2dc44392557ef56bee72a4d99bc6}"
EXPECT_COMMITS="${CEREMONY_COMMITS:-1}"
PR_TITLE="${CEREMONY_TITLE:-Julius: the public identity is Julius 3.3, i.Wonder and Wonderland}"
PR_BODY_FILE="${CEREMONY_BODY_FILE:-}"

WORKER_LOGIN='julius-worker[bot]'
WORKER_EMAIL='325202980+julius-worker[bot]@users.noreply.github.com'
ALLOWED_FILES='README.md
docs/documentation-contract.test.ts'

OPEN_PR=0
[ "${1:-}" = "--open-pr" ] && OPEN_PR=1

die() { printf '\n  REFUSED: %s\n' "$*" >&2; exit 1; }
ok()  { printf '  [ok]   %s\n' "$*"; }

printf '\nJULIUS WORKER CEREMONY — %s/%s\n  branch %s\n\n' "$OWNER" "$REPO" "$BRANCH"

# ---------------------------------------------------------------- 1. the remote
# Every expectation is checked against the REAL REMOTE first. A local checkout
# can be stale, rewritten or simply a different branch with the same name.

printf 'REMOTE STATE\n'
REMOTE_HEAD=$(git ls-remote "https://github.com/$OWNER/$REPO" "refs/heads/$BRANCH" | cut -f1)
REMOTE_MAIN=$(git ls-remote "https://github.com/$OWNER/$REPO" refs/heads/main | cut -f1)
[ -n "$REMOTE_HEAD" ] || die "branch $BRANCH does not exist on the remote"
[ "$REMOTE_HEAD" = "$EXPECT_HEAD" ] || die "remote head $REMOTE_HEAD != frozen head $EXPECT_HEAD"
ok "remote branch head is the frozen head  $EXPECT_HEAD"
[ "$REMOTE_MAIN" = "$EXPECT_BASE" ] || die "main has moved: remote $REMOTE_MAIN != frozen base $EXPECT_BASE.
           The candidate must be replayed onto the new trusted main and re-frozen.
           Do NOT open a pull request from a stale base."
ok "remote main is still the frozen trusted base  $EXPECT_BASE"

# ------------------------------------------------------------- 2. the candidate
git fetch --quiet "https://github.com/$OWNER/$REPO" "$BRANCH" "refs/heads/main:refs/ceremony/main"
CAND=FETCH_HEAD

printf '\nCANDIDATE SHAPE\n'
TREE=$(git rev-parse "$CAND^{tree}")
[ "$TREE" = "$EXPECT_TREE" ] || die "tree $TREE != frozen tree $EXPECT_TREE"
ok "tree is the frozen tree  $EXPECT_TREE"

COUNT=$(git rev-list --count "$EXPECT_BASE..$CAND")
[ "$COUNT" = "$EXPECT_COMMITS" ] || die "$COUNT commits over base, expected $EXPECT_COMMITS"
ok "$COUNT commit(s) over the trusted base"

git merge-base --is-ancestor "$EXPECT_BASE" "$CAND" \
  || die "the candidate does not contain the trusted base — it was not replayed onto it"
ok "candidate contains the trusted base (replayed, not merged from a stale base)"

# No merge commits: a replayed documentation delta is linear by construction.
MERGES=$(git rev-list --merges --count "$EXPECT_BASE..$CAND")
[ "$MERGES" = "0" ] || die "$MERGES merge commit(s) present — stale base history was merged in"
ok "no merge commits — linear replay"

# --------------------------------------------------------------- 3. authorship
printf '\nWORKER AUTHORSHIP\n'
IDENT=$(git log --format='%an <%ae>|%cn <%ce>' "$EXPECT_BASE..$CAND" | sort -u)
EXPECT_IDENT="$WORKER_LOGIN <$WORKER_EMAIL>|$WORKER_LOGIN <$WORKER_EMAIL>"
[ "$IDENT" = "$EXPECT_IDENT" ] || die "authorship is not uniformly the worker App:
$IDENT"
ok "every commit authored AND committed by $WORKER_LOGIN"

# ------------------------------------------------------------------- 4. scope
printf '\nCHANGE SCOPE\n'
CHANGED=$(git diff --name-only "$EXPECT_BASE..$CAND" | sort)
if [ "$CHANGED" != "$(printf '%s' "$ALLOWED_FILES" | sort)" ]; then
  die "candidate changes files outside the documentation delta:
$CHANGED"
fi
ok "changes exactly README.md and docs/documentation-contract.test.ts"

# The description lives in repository metadata, never in the squash.
git diff "$EXPECT_BASE..$CAND" -- package.json | grep -q . \
  && die "package.json changed — repository metadata is not part of this candidate"
ok "no repository-metadata change in the squash"

if [ "$OPEN_PR" -eq 0 ]; then
  printf '\nVERIFY-ONLY. Everything above passed.\n'
  printf 'To open the pull request as %s, re-run with:\n\n    %s --open-pr\n\n' "$WORKER_LOGIN" "$0"
  exit 0
fi

# ------------------------------------------------- 5. authenticate AS THE APP
: "${JULIUS_WORKER_APP_ID:?JULIUS_WORKER_APP_ID is not set in this environment}"
: "${JULIUS_WORKER_APP_PEM:?JULIUS_WORKER_APP_PEM is not set in this environment}"

printf '\nAUTHENTICATING AS THE WORKER APP\n'
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# A secret stored through a UI may arrive with literal backslash-n instead of
# real newlines; PEM parsing fails obscurely on that, so normalise first.
pem() {
  if printf '%s' "$JULIUS_WORKER_APP_PEM" | grep -q '\\n'; then
    printf '%b' "$JULIUS_WORKER_APP_PEM"
  else
    printf '%s' "$JULIUS_WORKER_APP_PEM"
  fi
}

NOW=$(date +%s)
JWT_HEADER=$(printf '{"alg":"RS256","typ":"JWT"}' | b64url)
JWT_CLAIMS=$(printf '{"iat":%d,"exp":%d,"iss":"%s"}' "$((NOW - 60))" "$((NOW + 540))" "$JULIUS_WORKER_APP_ID" | b64url)
JWT_SIG=$(printf '%s' "$JWT_HEADER.$JWT_CLAIMS" \
  | openssl dgst -sha256 -sign <(pem) -binary | b64url)
APP_JWT="$JWT_HEADER.$JWT_CLAIMS.$JWT_SIG"

APP_SLUG=$(curl -sS -H "Authorization: Bearer $APP_JWT" \
  -H 'Accept: application/vnd.github+json' https://api.github.com/app \
  | sed -n 's/.*"slug"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ "$APP_SLUG" = "julius-worker" ] || die "the PEM authenticates as '$APP_SLUG', not julius-worker.
           Check JULIUS_WORKER_APP_ID — it must be the APP id (4838349),
           not the bot USER id (325202980)."
ok "JWT authenticates as the julius-worker App"

INSTALL_ID=$(curl -sS -H "Authorization: Bearer $APP_JWT" \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$OWNER/$REPO/installation" \
  | sed -n 's/.*"id"[[:space:]]*:[[:space:]]*\([0-9]*\).*/\1/p' | head -1)
[ -n "$INSTALL_ID" ] || die "no installation of the App on $OWNER/$REPO"
ok "installation resolved"

TOKEN=$(curl -sS -X POST -H "Authorization: Bearer $APP_JWT" \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/app/installations/$INSTALL_ID/access_tokens" \
  | sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -1)
[ -n "$TOKEN" ] || die "could not mint an installation access token"
ok "installation access token minted (not printed)"

# ------------------------------------------------------------ 6. open the PR
printf '\nOPENING THE PULL REQUEST\n'
BODY_ARG='"body":""'
if [ -n "$PR_BODY_FILE" ] && [ -f "$PR_BODY_FILE" ]; then
  BODY_ARG=$(python3 -c 'import json,sys;print("\"body\":"+json.dumps(open(sys.argv[1],encoding="utf-8").read()))' "$PR_BODY_FILE")
fi
PAYLOAD=$(printf '{"title":%s,"head":"%s","base":"main",%s}' \
  "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$PR_TITLE")" "$BRANCH" "$BODY_ARG")

RESPONSE=$(curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$OWNER/$REPO/pulls" \
  -d "$PAYLOAD")
PR_URL=$(printf '%s' "$RESPONSE" | sed -n 's/.*"html_url"[[:space:]]*:[[:space:]]*"\([^"]*pull[^"]*\)".*/\1/p' | head -1)
[ -n "$PR_URL" ] || die "pull request was not created. Response: $(printf '%s' "$RESPONSE" | head -c 400)"

printf '\n  PULL REQUEST OPENED: %s\n' "$PR_URL"
printf '\nNEXT, AND NOT BY THIS SCRIPT OR THIS IDENTITY:\n'
printf '  1. Confirm the PR author reads julius-worker[bot].\n'
printf '  2. Founder approves at the exact head %s (read the review commit_id, never the body).\n' "$EXPECT_HEAD"
printf '  3. Squash merge.\n'
printf '  4. npm run julius:main-provenance -- %s/%s   → must read provenant\n' "$OWNER" "$REPO"
printf '  5. Dispatch "Julius accept main" at the new main.\n'
printf '  6. ONLY THEN update the GitHub repository description.\n\n'
