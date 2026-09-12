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
# FROZEN 2026-09-12, after replaying onto trusted main 79825935 (the squash of
# #256). Re-pinned once already: main moved under the candidate while it sat
# open, which is exactly what the stale-base refusal below exists to catch. These are the exact objects the founder approves against; they are
# overridable only so the script can be re-pinned if main moves again, which is
# the one event that invalidates this candidate.
BRANCH="${CEREMONY_BRANCH:-claude/sunday-relay-brand-docs-imb2bk}"
EXPECT_BASE="${CEREMONY_BASE:-7982593526ffe9c86676991715201d84a096cfa2}"
EXPECT_HEAD="${CEREMONY_HEAD:-03d79b92334be277d4d6f4053e11b944f278bc26}"
EXPECT_TREE="${CEREMONY_TREE:-487a25f783ddddc60df994e554efdd8b48f25fb4}"
EXPECT_COMMITS="${CEREMONY_COMMITS:-1}"
PR_TITLE="${CEREMONY_TITLE:-Julius: the public identity is Julius 3.3, i.Wonder and Wonderland}"
# THE DEFECT THIS LINE ONCE WAS. It read `${CEREMONY_BODY_FILE:-}` — an empty
# default — while this directory shipped a prepared pr-body.md and a README that
# said the body was prepared. PR #255 was opened with `"body":""` and GitHub
# reported it as null. Nothing failed; the package simply did not do what it
# said. The default is now the prepared body sitting beside this script, and an
# empty or missing body REFUSES rather than posting silence.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PR_BODY_FILE="${CEREMONY_BODY_FILE:-$SCRIPT_DIR/pr-body.md}"

WORKER_LOGIN='julius-worker[bot]'
WORKER_EMAIL='325202980+julius-worker[bot]@users.noreply.github.com'
ALLOWED_FILES='README.md
docs/documentation-contract.test.ts'

OPEN_PR=0
SET_BODY_PR=""
case "${1:-}" in
  --open-pr)  OPEN_PR=1 ;;
  --set-body) SET_BODY_PR="${2:?--set-body needs a pull-request number}" ;;
  "")         : ;;
  *)          printf 'usage: %s [--open-pr | --set-body <pr-number>]\n' "$0" >&2; exit 2 ;;
esac

die() { printf '\n  REFUSED: %s\n' "$*" >&2; exit 1; }

# A body is not optional. Silence posted into a review record is worse than a
# refusal, because it reads as "the author had nothing to say".
body_json() {
  [ -f "$PR_BODY_FILE" ] || die "no PR body at $PR_BODY_FILE. A pull request is
           a review record; this script will not post an empty one."
  [ -s "$PR_BODY_FILE" ] || die "the PR body at $PR_BODY_FILE is empty."
  python3 -c 'import json,sys
text=open(sys.argv[1],encoding="utf-8").read()
if not text.strip(): raise SystemExit("empty body")
print("\"body\":"+json.dumps(text))' "$PR_BODY_FILE"
}
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

if [ "$OPEN_PR" -eq 0 ] && [ -z "$SET_BODY_PR" ]; then
  printf '\nVERIFY-ONLY. Everything above passed.\n'
  printf 'To open the pull request as %s:      %s --open-pr\n' "$WORKER_LOGIN" "$0"
  printf 'To correct an open PR body as %s:    %s --set-body <pr-number>\n\n' "$WORKER_LOGIN" "$0"
  exit 0
fi

# ---------------------------------------------------------------- 4b. the body
# BEFORE ANY CREDENTIAL IS TOUCHED. This check is free, and it is the one that
# was missing when #255 went out empty. A run that cannot produce a body should
# fail here, not after minting a token.
printf '\nPULL REQUEST BODY\n'
BODY_ARG=$(body_json)
ok "prepared body present and non-empty  ($(wc -c < "$PR_BODY_FILE") bytes, $PR_BODY_FILE)"
for marker in 'P1' 'critical' 'high'; do
  if grep -qiE "\b${marker}\b" "$PR_BODY_FILE"; then
    die "the body contains the review-currency blocking marker '${marker}'.
           scripts/julius-review-currency.mjs reads P1 / critical / high as a
           BLOCKING finding; a PR body carrying one invites a false blocker."
  fi
done
ok "body is free of the review-currency blocking markers (P1 / critical / high)"

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

# ------------------------------------------- 6a. correct an existing PR body
#
# METADATA ONLY. This never pushes a commit, never moves head or base, never
# touches the title, and never approves or merges. It exists because PR #255
# was opened with an empty body by the defect recorded at the top of this file,
# and the correction has to carry the WORKER's identity — not the founder's,
# who is the separate approver and must not also be the author of the record
# they approve.
if [ -n "$SET_BODY_PR" ]; then
  API="https://api.github.com/repos/$OWNER/$REPO/pulls/$SET_BODY_PR"
  gh_get() { curl -sS -H "Authorization: Bearer $TOKEN" -H 'Accept: application/vnd.github+json' "$1"; }
  field() { python3 -c 'import json,sys;d=json.load(sys.stdin)
k=sys.argv[1:]
for key in k: d=d[key] if isinstance(d,dict) else d
print("" if d is None else d)' "$@"; }

  printf '\nPULL REQUEST #%s — BEFORE\n' "$SET_BODY_PR"
  BEFORE=$(gh_get "$API")
  PR_HEAD=$(printf '%s' "$BEFORE" | field head sha)
  PR_BASE=$(printf '%s' "$BEFORE" | field base sha)
  PR_USER=$(printf '%s' "$BEFORE" | field user login)
  PR_TITLE_NOW=$(printf '%s' "$BEFORE" | field title)
  [ "$PR_HEAD" = "$EXPECT_HEAD" ] || die "PR head $PR_HEAD != frozen head $EXPECT_HEAD"
  [ "$PR_BASE" = "$EXPECT_BASE" ] || die "PR base $PR_BASE != frozen base $EXPECT_BASE"
  [ "$PR_USER" = "$WORKER_LOGIN" ] || die "PR author is $PR_USER, not $WORKER_LOGIN"
  ok "head, base and author match the frozen candidate"

  PATCH=$(printf '{%s}' "$(body_json)")
  curl -sS -X PATCH -H "Authorization: Bearer $TOKEN" \
    -H 'Accept: application/vnd.github+json' "$API" -d "$PATCH" > /dev/null

  printf '\nPULL REQUEST #%s — AFTER\n' "$SET_BODY_PR"
  AFTER=$(gh_get "$API")
  printf '%s' "$AFTER" | python3 -c '
import json,sys
pr=json.load(sys.stdin)
want=open(sys.argv[1],encoding="utf-8").read()
got=pr.get("body")
assert got, "body is still empty or null"
assert got.replace("\r\n","\n")==want, "body does not match the prepared file byte-for-byte"
print("  [ok]   body is non-empty and exactly the prepared body")
print(f"  [ok]   title preserved: {pr[\"title\"]}")
print(f"  [ok]   head unchanged:  {pr[\"head\"][\"sha\"]}")
print(f"  [ok]   base unchanged:  {pr[\"base\"][\"sha\"]}")
print(f"  [ok]   author:          {pr[\"user\"][\"login\"]}")
' "$PR_BODY_FILE" || die "post-update verification failed"
  [ "$(printf '%s' "$AFTER" | field title)" = "$PR_TITLE_NOW" ] || die "title changed"
  printf '\n  BODY CORRECTED on #%s, as %s. No commit pushed, no head or base moved.\n\n' "$SET_BODY_PR" "$WORKER_LOGIN"
  exit 0
fi

# ------------------------------------------------------------ 6b. open the PR
printf '\nOPENING THE PULL REQUEST\n'
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
