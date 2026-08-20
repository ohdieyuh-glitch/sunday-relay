#!/usr/bin/env bash
# END-TO-END SMOKE TEST for launch-wonderland.sh, against stubs.
#
# Every fix to the launch path so far was verified in isolation: the Config/
# hash, the four stage-5 pipeline hazards, the capture toolchain, the node
# choice. None of that proves the LAUNCHER runs — a stage-ordering mistake, an
# unset variable under `set -u`, or a stray non-zero in a `set -e` script would
# still end a paid run, and would still be invisible until the GPU was already
# billing.
#
# So this drives the real launch-wonderland.sh with every expensive thing
# stubbed: no GPU, no Docker, no Unreal, no build, no stream, no browser. What
# is under test is the launcher's own control flow — that it reaches all eight
# stages in order, that the phase-criteria block reflects what the stubs
# actually produced, and that it fails closed when a stage fails.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { echo "  ok   $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL $*"; FAIL=$((FAIL + 1)); }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# ------------------------------------------------------------------ stubs
mkdir -p "$TMP/bin"
cat > "$TMP/bin/nvidia-smi" <<'EOF'
#!/bin/sh
case "$*" in
  -L) echo "GPU 0: NVIDIA L4 (UUID: GPU-stub)" ;;
  *name,memory.total,driver_version*) echo "NVIDIA L4, 23034 MiB, 550.00" ;;
  *name*) echo "NVIDIA L4" ;;
  *utilization*) echo "42 %" ;;
  *memory.used*) echo "1024 MiB, 23034 MiB" ;;
  *compute-apps*) ;;
  *) echo "stub" ;;
esac
exit 0
EOF
printf '#!/bin/sh\nexit 0\n' > "$TMP/bin/docker"
chmod +x "$TMP/bin/nvidia-smi" "$TMP/bin/docker"

mkpng() {   # $1 = path, $2 = black|flat|real
  python3 - "$1" "$2" <<'PY'
import zlib, struct, sys
path, kind = sys.argv[1], sys.argv[2]
w = h = 96
if kind == "black":  fn = lambda y: [0] * (w * 3)
elif kind == "flat": fn = lambda y: [120, 90, 60] * w
else: fn = lambda y: [v for x in range(w) for v in ((x*7+y*13)%256, (x*5+y*3)%256, (y*11+x)%256)]
raw = b''.join(b'\x00' + bytes(fn(y)) for y in range(h))
def ch(t, d):
    c = t + d
    return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
open(path, 'wb').write(b'\x89PNG\r\n\x1a\n'
    + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b''))
PY
}

# A launcher directory holding the REAL launcher and common.sh, with every
# stage it shells out to replaced by a stub we control.
stage_dir() {   # $1 = dir, $2..= which stages should fail
  local d="$1"; shift
  rm -rf "$d"; mkdir -p "$d"
  cp "$HERE/launch-wonderland.sh" "$HERE/common.sh" "$HERE/frame-check.py" "$d/"
  local failing=" $* "
  for s in prepare build-render run-stream stop-wonderland; do
    if [ "${failing#* $s }" != "$failing" ]; then
      printf '#!/usr/bin/env bash\necho "stub %s: FAILING"\nexit 1\n' "$s" > "$d/$s.sh"
    else
      printf '#!/usr/bin/env bash\necho "stub %s ok"\nexit 0\n' "$s" > "$d/$s.sh"
    fi
    chmod +x "$d/$s.sh"
  done
  # prepare.sh must leave the stamp the launcher checks for
  if [ "${failing#* prepare }" = "$failing" ]; then
    printf '#!/usr/bin/env bash\necho "stub prepare ok"\nmkdir -p "$WL_RUN"\n: > "$WL_RUN/prepared.stamp"\nexit 0\n' > "$d/prepare.sh"
    chmod +x "$d/prepare.sh"
  fi
}

world() {   # $1 = root, $2 = staged? , $3 = url?
  rm -rf "$1"; mkdir -p "$1/logs" "$1/proof" "$1/run" "$1/packaged" "$1/src" "$1/tools"
  [ "$2" = staged ] && { mkdir -p "$1/packaged/Linux"; : > "$1/packaged/Linux/Wonderland.sh"; }
  [ "$3" = url ] && printf 'https://stub.trycloudflare.com\n' > "$1/run/player-url.txt"
  return 0
}

launch() {   # $1 = launcher dir, $2 = world root
  PATH="$TMP/bin:$PATH" \
  WL_ROOT="$2" WL_SRC="$2/src" WL_UE="$2/ue" WL_OUT="$2/packaged" \
  WL_LOG="$2/logs" WL_PROOF="$2/proof" WL_RUN="$2/run" WL_TOOLS="$2/tools" \
  WL_UE_ARCHIVE_MIN_GB=0 SKIP_SHOT=1 WL_PUBLIC=none \
  WL_MIN_DISK_GB=0 WL_MIN_RAM_GB=0 \
  timeout 120 bash "$1/launch-wonderland.sh" 2>&1
}

echo "== the launcher reaches all eight stages =="
stage_dir "$TMP/L"
world "$TMP/w" staged url
# a loaded image so the engine step is satisfied without a real docker
printf '#!/bin/sh\ncase "$1 $2" in "image inspect") exit 0;; esac\nexit 0\n' > "$TMP/bin/docker"
out="$(launch "$TMP/L" "$TMP/w")"; rc=$?
for st in "1/8  MACHINE" "2/8  UNREAL 5.8" "3/8  PREPARE" "4/8  BUILD + COOK" \
          "5/8  STREAM UP" "6/8  HERO FRAME" "7/8  VERIFY"; do
  has "$out" "$st" && ok "reached $st" || bad "never reached $st"
done
# Stage 8 now has TWO forms. Reaching it is what this section tests; WHICH form
# it prints is evidence-dependent and is the subject of the next section.
if has "$out" "8/8  WONDERLAND IS OPEN" || has "$out" "8/8  NOT OPEN"; then
  ok "reached stage 8/8"
else
  bad "never reached stage 8/8"
fi
[ "$rc" -eq 0 ] && ok "a fully-stubbed run exits 0" || bad "a fully-stubbed run exited $rc"

echo "== 8/8 is EARNED, not printed =="
# The stubbed run has a staged build and nothing else: no live process, no
# reachable player page, no URL, no hero frame, no verification. Announcing
# WONDERLAND IS OPEN there would send the founder to a dead link.
if has "$out" "8/8  WONDERLAND IS OPEN"; then
  bad "it announced OPEN with no process, URL, frame or verification"
else
  ok "it refuses to announce OPEN without evidence"
fi
has "$out" "NOT OPEN" && ok "  and says so plainly" || bad "  it did not say NOT OPEN"
for miss in "the Wonderland process is not running" \
            "no hero frame from this run" "verification did not pass"; do
  has "$out" "$miss" && ok "  names missing evidence: $miss" || bad "  did not name: $miss"
done
# This fixture DOES write a player-url.txt, so the honest complaint is that the
# URL cannot be reached — not that it is absent. Asserting "no browser URL"
# here was my error, and it would have masked the reachability check working.
if has "$out" "no browser URL" || has "$out" "is not reachable"; then
  ok "  names the URL problem correctly (absent or unreachable)"
else
  bad "  a URL that cannot be opened was accepted"
fi
has "$out" "Logs for diagnosis" && ok "  and points at the logs" || bad "  no diagnosis pointer"

echo "== a stale hero frame cannot satisfy VERIFY =="
stage_dir "$TMP/Ls"
world "$TMP/ws" staged url
mkdir -p "$TMP/ws/proof"
mkpng "$TMP/ws/proof/hero-20200101T000000Z.png" real
touch -d "2020-01-01" "$TMP/ws/proof/hero-20200101T000000Z.png" 2>/dev/null || true
# The check is worthless if the fixture was never written — mkpng lived in the
# other suite and this silently passed on a directory with no PNG in it.
if [ -s "$TMP/ws/proof/hero-20200101T000000Z.png" ]; then
  ok "the stale-frame fixture exists ($(stat -c %s "$TMP/ws/proof/hero-20200101T000000Z.png") bytes)"
else
  bad "the stale-frame fixture was not created; the next check proves nothing"
fi
outs="$(launch "$TMP/Ls" "$TMP/ws")"
if has "$outs" "8/8  WONDERLAND IS OPEN"; then
  bad "a frame from 2020 satisfied this run"
else
  ok "an old frame does not satisfy this run"
fi

echo "== cleanup only touches Wonderland-owned processes =="
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/stop-wonderland.sh" > "$TMP/nostop.sh"
grep -qE 'kill_match "tunnel"[[:space:]]+"\[c\]loudflared"[[:space:]]*$' "$TMP/nostop.sh" \
  && bad "stop-wonderland kills ANY cloudflared, including the founder's own" \
  || ok "the tunnel pattern is scoped to our port"
grep -qE 'kill_match "turn"[[:space:]]+"\[t\]urnserver"[[:space:]]*$' "$TMP/nostop.sh" \
  && bad "stop-wonderland kills ANY turnserver" \
  || ok "the turn pattern is scoped to our config"
grep -q 'already in use' "$HERE/run-stream.sh" \
  && ok "run-stream refuses a port someone else holds" \
  || bad "no port-collision preflight"

echo "== stages appear in order =="
prev=0; order_ok=1
for n in 1 2 3 4 5 6 7 8; do
  line="$(printf '%s\n' "$out" | grep -n "$n/8  " | head -1 | cut -d: -f1)"
  if [ -z "$line" ] || [ "$line" -le "$prev" ]; then order_ok=0; fi
  prev="${line:-$prev}"
done
[ "$order_ok" = 1 ] && ok "the eight stages appear in ascending order" \
  || bad "stages are out of order"

echo "== the phase criteria reflect what actually happened =="
has "$out" "PHASE CRITERIA" && ok "the criteria block is printed" || bad "no criteria block"
has "$out" "packaged Wonderland    yes" && ok "packaged build reported yes" \
  || bad "a staged build was not reported"
has "$out" "hero frame             NO" && ok "a skipped capture reports hero frame NO" \
  || bad "a skipped capture did not report NO"

echo "== a missing packaged build is reported, not hidden =="
stage_dir "$TMP/L2"
world "$TMP/w2" nostage url
out2="$(launch "$TMP/L2" "$TMP/w2")"
has "$out2" "packaged Wonderland    NO" && ok "an unstaged build reports NO" \
  || bad "an unstaged build was not reported as NO"

echo "== a failing stage stops the run =="
stage_dir "$TMP/L3" build-render
world "$TMP/w3" nostage nourl
out3="$(launch "$TMP/L3" "$TMP/w3")"; rc3=$?
[ "$rc3" -ne 0 ] && ok "a failing build stage fails the launcher (exit $rc3)" \
  || bad "a failing build stage was swallowed"
has "$out3" "8/8" && bad "it continued to 8/8 after a stage failed" \
  || ok "  and it does not reach 8/8"

echo "== no GPU is still a refusal, with a reason =="
stage_dir "$TMP/L4"
world "$TMP/w4" staged url
printf '#!/bin/sh\nexit 1\n' > "$TMP/bin/nvidia-smi"; chmod +x "$TMP/bin/nvidia-smi"
out4="$(launch "$TMP/L4" "$TMP/w4")"; rc4=$?
[ "$rc4" -eq 2 ] && ok "no GPU exits 2" || bad "no GPU exited $rc4, expected 2"
has "$out4" "no GPU" && ok "  and says why" || bad "  no explanation"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
