#!/usr/bin/env bash
# Ship relay/wonderland-v2 to the Lightning Studio and start the CPU build.
# Runs on the DEVELOPMENT machine (the Chromebook), not on the Studio.
#
#   bash wonderland/v2/tools/ship_v2.sh            # ship + build (detached on the Studio)
#   bash wonderland/v2/tools/ship_v2.sh --ship-only
#   WL_EXTRA_ENV="WLV2_PARTITIONED=0" bash wonderland/v2/tools/ship_v2.sh   # env for the remote build
#
# Why a bundle: the Studio has no GitHub credential for the private repo, and
# scp to it has silently no-op'd before — so the bundle goes over `ssh cat >`
# and its md5 is checked on the far side before anything is built. The build
# is pinned to the exact head shipped (WL_REQUIRE_SHA), so the source gate
# fails closed if the Studio's checkout is not that commit.
set -euo pipefail
HOST="${WL_STUDIO_HOST:-wonderland-l4}"
BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
# No base: the whole branch (19.6 MB) goes, so the fetch can never fail on
# a prerequisite the Studio's checkout (last on relay/wonderland-marble) lacks.
BASE="${WL_STUDIO_BASE:-}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRATCH="${WL_SCRATCH:-${TMPDIR:-/tmp}}"
BUNDLE="$SCRATCH/wlv2.bundle"
REMOTE_BUNDLE="/teamspace/studios/this_studio/wonderland/wlv2.bundle"
REMOTE_LOG="/teamspace/studios/this_studio/wonderland/run/v2-build.log"

say() { printf '\033[1;36m[ship-v2]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[ship-v2] %s\033[0m\n' "$*" >&2; exit 1; }

HEAD_SHA="$(git -C "$REPO" rev-parse "$BRANCH")"
RANGE="$BRANCH"; [ -n "$BASE" ] && RANGE="$BASE..$BRANCH"
say "bundling $RANGE ($HEAD_SHA)"
git -C "$REPO" bundle create "$BUNDLE" "$RANGE" >/dev/null 2>&1 || die "bundle failed for $RANGE"
git bundle verify "$BUNDLE" >/dev/null 2>&1 || die "bundle does not verify"
MD5="$(md5sum "$BUNDLE" | cut -d' ' -f1)"
say "bundle $(du -h "$BUNDLE" | cut -f1) md5 $MD5"

timeout 25 ssh -o ConnectTimeout=12 -o BatchMode=yes "$HOST" 'echo ok' >/dev/null 2>&1 || die "Studio not reachable ($HOST) -- it must be started by the founder first"

say "uploading over ssh (scp has silently no-op'd here before)"
ssh "$HOST" "mkdir -p $(dirname "$REMOTE_BUNDLE") && cat > $REMOTE_BUNDLE" < "$BUNDLE"
RMD5="$(ssh "$HOST" "md5sum $REMOTE_BUNDLE | cut -d' ' -f1")"
[ "$RMD5" = "$MD5" ] || die "remote md5 $RMD5 != local $MD5 -- upload corrupt, not building"
say "remote md5 verified"

if [ "${1:-}" = "--ship-only" ]; then say "shipped; build not started"; exit 0; fi

# Detached so the ssh session dropping does not kill a 40-minute build; the
# log is the record.
# THE CHECKOUT MUST BE ON THE SHIPPED HEAD BEFORE THE ENTRY SCRIPT RUNS: the
# fetch inside prepare.sh cannot run a v2-build.sh that the old branch does not
# have (the first live ship hit exactly this). Local edits on the Studio are
# saved as a patch in run/, never silently discarded.
say "moving the Studio checkout to $HEAD_SHA (local edits saved as a patch)"
ssh "$HOST" "set -e; R=/teamspace/studios/this_studio/wonderland; mkdir -p \$R/run; cd \$R/src; \
  git diff > \$R/run/studio-local-changes-\$(git rev-parse --short HEAD).patch; git checkout -q -- .; \
  git fetch -q $REMOTE_BUNDLE $BRANCH; git checkout -q -B $BRANCH FETCH_HEAD; git reset -q --hard FETCH_HEAD; \
  test \"\$(git rev-parse HEAD)\" = $HEAD_SHA; test -x wonderland/infra/lightning/v2-build.sh; echo checkout-ok" \
  | grep -q checkout-ok || die "the Studio checkout is not at $HEAD_SHA with v2-build.sh present"
say "starting v2-build.sh on the Studio, pinned to $HEAD_SHA"
ssh "$HOST" "mkdir -p $(dirname "$REMOTE_LOG"); cd /teamspace/studios/this_studio/wonderland/src; \
  ${WL_EXTRA_ENV:-} WL_BUNDLE=$REMOTE_BUNDLE WL_BRANCH=$BRANCH WL_REQUIRE_SHA=$HEAD_SHA \
  nohup bash wonderland/infra/lightning/v2-build.sh > $REMOTE_LOG 2>&1 < /dev/null & \
  echo started pid \$!"
say "log: ssh $HOST tail -f $REMOTE_LOG"
say "success test: grep -E 'V2 SUMMARY|packaged.sha|wl_die|FAILED' $REMOTE_LOG"
