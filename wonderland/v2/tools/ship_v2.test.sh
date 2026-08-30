#!/usr/bin/env bash
# ship_v2.sh against a fake ssh: the md5 mismatch must refuse to build, and a
# matching md5 must start the detached build with the head sha pinned.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
T="$(mktemp -d)"; trap 'rm -rf "$T"' EXIT
mkdir -p "$T/bin" "$T/scratch"
cat > "$T/bin/ssh" <<'SH'
#!/usr/bin/env bash
# fake ssh: last arg is the remote command
cmd="${@: -1}"
# The order matters: the checkout-move command also contains "rev-parse HEAD",
# and the launch command must be caught before either.
case "$cmd" in
  *"cat > "*)     cat > "$FAKE_REMOTE/wlv2.bundle"; exit 0 ;;
  *md5sum*)       if [ "${FAKE_MD5_LIE:-0}" = 1 ]; then echo deadbeef; else md5sum "$FAKE_REMOTE/wlv2.bundle" | cut -d' ' -f1; fi ;;
  *nohup*)        echo "$cmd" > "$FAKE_REMOTE/launch.txt"; echo "started pid 4242" ;;
  # ship_v2.sh proves the checkout moved by having the remote echo this. The
  # fake never answered it, so `grep -q checkout-ok` failed and the script
  # died on its own guard -- which is why three of this file's four
  # assertions had been failing against a ship that works in production.
  *checkout-ok*)  echo checkout-ok ;;
  # The base probe. Answering with a real ancestor exercises the incremental
  # bundle; FAKE_REMOTE_HEAD="" makes the probe fail and the whole branch go.
  *"rev-parse HEAD"*) echo "${FAKE_REMOTE_HEAD:-}" ;;
  *)              echo ok ;;
esac
SH
chmod +x "$T/bin/ssh"
export FAKE_REMOTE="$T" PATH="$T/bin:$PATH" WL_SCRATCH="$T/scratch"
# The Studio is one commit behind, which is the ordinary case and the one the
# incremental bundle exists for.
export FAKE_REMOTE_HEAD="$(git -C "$HERE/../../.." rev-parse relay/wonderland-v2~1)"
fail=0
# 1. corrupt upload -> no build
if FAKE_MD5_LIE=1 bash "$HERE/ship_v2.sh" >"$T/o1" 2>&1; then echo "FAIL: md5 mismatch did not refuse"; fail=1; else grep -q "upload corrupt, not building" "$T/o1" && echo "ok  md5 mismatch refuses to build"; fi
[ -f "$T/launch.txt" ] && { echo "FAIL: build launched after corrupt upload"; fail=1; }
# 2. good upload -> detached build pinned to the shipped head
bash "$HERE/ship_v2.sh" >"$T/o2" 2>&1 || { echo "FAIL: happy path exited non-zero"; cat "$T/o2"; fail=1; }
HEAD_SHA="$(git -C "$HERE/../../.." rev-parse relay/wonderland-v2)"
grep -q "WL_REQUIRE_SHA=$HEAD_SHA" "$T/launch.txt" && echo "ok  build pinned to $HEAD_SHA" || { echo "FAIL: build not pinned to head"; fail=1; }
grep -q "WL_BUNDLE=/teamspace" "$T/launch.txt" && echo "ok  build fetches from the shipped bundle" || { echo "FAIL: no WL_BUNDLE"; fail=1; }
grep -q "v2-build.sh" "$T/launch.txt" && echo "ok  v2-build.sh is the entry" || { echo "FAIL: wrong entry"; fail=1; }
# 3. the bundle is incremental when the Studio holds an ancestor, and whole
#    when it does not. A full-branch bundle stopped fitting in a ten-minute
#    upload once the reference art landed on the branch, so which one is
#    chosen is now load-bearing rather than a size detail.
grep -q "shipping incrementally" "$T/o2" && echo "ok  ancestor head -> incremental bundle" || { echo "FAIL: did not ship incrementally from an ancestor"; fail=1; }
FAKE_REMOTE_HEAD="" bash "$HERE/ship_v2.sh" --ship-only >"$T/o3" 2>&1 || true
grep -q "shipping the whole branch" "$T/o3" && echo "ok  unknown head -> whole branch" || { echo "FAIL: unknown Studio head did not fall back to the whole branch"; fail=1; }

# 4. --ship-only never launches
rm -f "$T/launch.txt"; bash "$HERE/ship_v2.sh" --ship-only >/dev/null 2>&1
[ -f "$T/launch.txt" ] && { echo "FAIL: --ship-only launched a build"; fail=1; } || echo "ok  --ship-only does not build"
[ $fail = 0 ] && echo "ship_v2.test: PASS" || { echo "ship_v2.test: FAIL"; exit 1; }
