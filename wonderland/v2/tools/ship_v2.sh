#!/usr/bin/env bash
# Ship relay/wonderland-v2 to the Lightning Studio and start the CPU build.
# Runs on the DEVELOPMENT machine (the Chromebook), not on the Studio.
#
#   bash wonderland/v2/tools/ship_v2.sh            # ship + build (detached on the Studio)
#   bash wonderland/v2/tools/ship_v2.sh --ship-only
#
# Why a bundle: the Studio has no GitHub credential for the private repo, and
# scp to it has silently no-op'd before — so the bundle goes over `ssh cat >`
# and its md5 is checked on the far side before anything is built. The build
# is pinned to the exact head shipped (WL_REQUIRE_SHA), so the source gate
# fails closed if the Studio's checkout is not that commit.
set -euo pipefail
HOST="${WL_STUDIO_HOST:-wonderland-l4}"
BRANCH="${WL_BRANCH:-relay/wonderland-v2}"
BASE="${WL_STUDIO_BASE:-667fbf9}"        # the last commit the Studio's checkout is known to have
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
SCRATCH="${WL_SCRATCH:-${TMPDIR:-/tmp}}"
BUNDLE="$SCRATCH/wlv2.bundle"
REMOTE_BUNDLE="/teamspace/studios/this_studio/wonderland/wlv2.bundle"
REMOTE_LOG="/teamspace/studios/this_studio/wonderland/run/v2-build.log"

say() { printf '\033[1;36m[ship-v2]\033[0m %s\n' "$*"; }
die() { printf '\033[1;31m[ship-v2] %s\033[0m\n' "$*" >&2; exit 1; }

HEAD_SHA="$(git -C "$REPO" rev-parse "$BRANCH")"
say "bundling $BASE..$BRANCH ($HEAD_SHA)"
git -C "$REPO" bundle create "$BUNDLE" "$BASE..$BRANCH" >/dev/null 2>&1 || die "bundle failed (is $BASE an ancestor of $BRANCH?)"
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
say "starting v2-build.sh on the Studio (CPU), pinned to $HEAD_SHA"
ssh "$HOST" "mkdir -p $(dirname "$REMOTE_LOG"); cd /teamspace/studios/this_studio/wonderland/src 2>/dev/null || true; \
  WL_BUNDLE=$REMOTE_BUNDLE WL_BRANCH=$BRANCH WL_REQUIRE_SHA=$HEAD_SHA \
  nohup bash /teamspace/studios/this_studio/wonderland/src/wonderland/infra/lightning/v2-build.sh > $REMOTE_LOG 2>&1 < /dev/null & \
  echo started pid \$!"
say "log: ssh $HOST tail -f $REMOTE_LOG"
say "success test: grep -E 'V2 SUMMARY|packaged.sha|wl_die|FAILED' $REMOTE_LOG"
