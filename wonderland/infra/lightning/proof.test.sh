#!/usr/bin/env bash
# Tests for the Wonderland proof harness. Fixtures and stubs only — no GPU, no
# Unreal, no network, no stream.
#
# The property under test is not "does it print things". It is that the report
# tells the TRUTH about what was measured: that a missing measurement reads
# UNVERIFIED rather than FAIL, that a failed one reads FAIL rather than being
# quietly absent, and that no combination of evidence can make it say PROVEN.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()  { echo "  ok   $*"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL $*"; FAIL=$((FAIL + 1)); }
has() { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

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

# A world in whatever state the caller asks for.
make_world() {   # $1 = root, $2 = built?, $3 = frame kind|none, $4 = url?
  local r="$1"
  rm -rf "$r"; mkdir -p "$r/logs" "$r/proof" "$r/run" "$r/packaged" "$r/src"
  if [ "$2" = built ]; then
    mkdir -p "$r/packaged/Linux"; : > "$r/packaged/Linux/Wonderland.sh"
    printf '[build-wonderland] packaged Wonderland -> %s/packaged/Linux\n' "$r" > "$r/logs/build.log"
    printf 'LogPython: Warning: WORLD REPORT actors=32624 materials=59\n' >> "$r/logs/build.log"
  else
    printf '[build-wonderland] engine reports version 5.8\n' > "$r/logs/build.log"
  fi
  [ "$3" = none ] || mkpng "$r/proof/hero-20260820T000000Z.png" "$3"
  [ "$4" = url ] && printf 'https://example.trycloudflare.com\n' > "$r/run/player-url.txt"
  return 0
}

run_proof() {   # $1 = root
  WL_ROOT="$1" WL_SRC="$1/src" WL_UE="$1/ue" WL_OUT="$1/packaged" \
  WL_LOG="$1/logs" WL_PROOF="$1/proof" WL_RUN="$1/run" \
  bash "$HERE/proof.sh" 2>&1
}

echo "== syntax =="
bash -n "$HERE/proof.sh" && ok "proof.sh parses" || bad "proof.sh does not parse"
python3 -c "import ast,io;ast.parse(io.open('$HERE/frame-check.py').read())" 2>/dev/null \
  && ok "frame-check.py parses" || bad "frame-check.py does not parse"

echo "== a run that produced nothing =="
make_world "$TMP/w0" nobuild none nourl
out="$(run_proof "$TMP/w0")"; rc=$?
[ "$rc" -ne 0 ] && ok "an empty run exits non-zero" || bad "an empty run reported success"
has "$out" "FAIL        packaged build" && ok "missing build is a FAIL" || bad "missing build not FAILed"
has "$out" "FAIL        hero frame present" && ok "missing frame is a FAIL" || bad "missing frame not FAILed"
has "$out" "ASSURANCE: " && ok "it still reports an assurance rung" || bad "no assurance rung"

echo "== unmeasured things read UNVERIFIED, not FAIL =="
has "$out" "UNVERIFIED  frame rate" && ok "absent FPS is UNVERIFIED" || bad "absent FPS was not UNVERIFIED"
has "$out" "UNVERIFIED  build duration" && ok "unrecorded duration is UNVERIFIED" \
  || bad "unrecorded duration was not UNVERIFIED"
has "$out" "UNVERIFIED  browser url" && ok "absent URL is UNVERIFIED" || bad "absent URL was not UNVERIFIED"
# The distinction that matters most: never dress a gap as a failure.
if has "$out" "FAIL        frame rate"; then bad "an unmeasured FPS was reported as FAIL"; else ok "no measurement gap reported as FAIL"; fi

echo "== a built world reports COMPILED =="
make_world "$TMP/w1" built none nourl
out1="$(run_proof "$TMP/w1")"
has "$out1" "PASS        packaged build" && ok "a staged build is a PASS" || bad "staged build not PASSed"
has "$out1" "PASS        build completed" && ok "the completion line is found" || bad "completion line missed"
has "$out1" "ASSURANCE: COMPILED" && ok "assurance is COMPILED with no stream" \
  || bad "wrong rung for a built-but-not-running world"
has "$out1" "actors=32624" && ok "it surfaces the world report from build.log" \
  || bad "world report not surfaced"

echo "== a black frame is a FAIL, not a pass =="
make_world "$TMP/w2" built black url
out2="$(run_proof "$TMP/w2")"
has "$out2" "FAIL        hero frame structure" && ok "a black frame FAILs structure" \
  || bad "a black frame was not FAILed"
has "$out2" "black frame" && ok "  and it names the reason" || bad "  no reason given"
# a black frame must NOT promote the rung
if has "$out2" "ASSURANCE: STREAMED" || has "$out2" "ASSURANCE: DEPLOYED"; then
  bad "a black frame promoted the assurance rung"
else
  ok "a black frame does not promote the rung"
fi

echo "== a flat frame is also a FAIL =="
make_world "$TMP/w3" built flat url
out3="$(run_proof "$TMP/w3")"
has "$out3" "FAIL        hero frame structure" && ok "a single-colour frame FAILs" \
  || bad "a flat frame was not FAILed"

echo "== a structured frame reports size and structure =="
make_world "$TMP/w4" built real url
out4="$(run_proof "$TMP/w4")"
has "$out4" "PASS        hero frame structure" && ok "a structured frame PASSes structure" \
  || bad "a structured frame was not PASSed"
has "$out4" "96x96" && ok "it reports the frame dimensions" || bad "dimensions not reported"
has "$out4" "PASS        browser url" && ok "the URL is reported when present" || bad "URL not reported"

echo "== PROVEN is unreachable, whatever the evidence =="
# THIS ASSERTION WAS VACUOUS AND MUTATION-TESTING FOUND IT. No fixture above
# reaches DEPLOYED, because that needs listening ports — so "it did not say
# PROVEN" was true for a world that could never have said it, and inserting a
# `RUNG=PROVEN` promotion still passed 27/27. A guard that is only exercised on
# inputs that cannot trip it is not a guard.
#
# Open two real listeners so the world genuinely climbs
# RUNNING -> STREAMED -> DEPLOYED, and only then ask whether PROVEN appears.
# A background listener that WRITES its ports to a file and stays alive. The
# first attempt bound the sockets inside a command substitution and forked —
# which either closes the sockets when the parent exits, or blocks the
# substitution because the child still holds stdout. Neither gave a listening
# port, so the fixture silently failed to reach DEPLOYED.
cat > "$TMP/listen.py" <<'PY'
import socket, sys, time
socks = []
for _ in range(2):
    x = socket.socket(); x.bind(("127.0.0.1", 0)); x.listen(1); socks.append(x)
open(sys.argv[1], "w").write(" ".join(str(x.getsockname()[1]) for x in socks))
time.sleep(120)
PY
python3 "$TMP/listen.py" "$TMP/ports" >/dev/null 2>&1 &
LISTEN_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do [ -s "$TMP/ports" ] && break; sleep 0.3; done
PORTS="$(cat "$TMP/ports" 2>/dev/null || true)"
P_HTTP="${PORTS%% *}"; P_STREAM="${PORTS##* }"
make_world "$TMP/wd" built real url
outd="$(WL_HTTP_PORT="$P_HTTP" WL_STREAMER_PORT="$P_STREAM" run_proof "$TMP/wd")"
if has "$outd" "ASSURANCE: DEPLOYED"; then
  ok "a complete run with live ports reaches DEPLOYED"
else
  bad "the fixture never reached DEPLOYED, so the PROVEN check would be vacuous"
fi
if has "$outd" "ASSURANCE: PROVEN"; then
  bad "the harness declared PROVEN from measurements alone"
else
  ok "even a DEPLOYED run does not reach PROVEN"
fi

if has "$out4" "ASSURANCE: PROVEN"; then
  bad "the harness declared PROVEN from measurements alone"
else
  ok "even a complete run does not reach PROVEN"
fi
has "$out4" "UNVERIFIED  visual vs reference" \
  && ok "the visual comparison is explicitly UNVERIFIED" \
  || bad "the visual comparison is not surfaced as unverified"
has "$out4" "requires the founder to" && ok "  and it says who must judge it" \
  || bad "  it does not say a human must look"

kill "$LISTEN_PID" 2>/dev/null || true

echo "== a frame from a PREVIOUS run is not evidence about this one =="
# The exact trap: this run's capture failed, so the newest hero-*.png in
# $WL_PROOF belongs to an earlier run. proof.sh picks the newest one, so
# without a freshness check it would report a structured frame and promote the
# assurance rung on a stream that rendered nothing today.
make_world "$TMP/wstale" built real url
# age the frame well behind the run's own logs
touch -d "2020-01-01" "$TMP/wstale/proof/hero-20260820T000000Z.png" 2>/dev/null \
  || touch -t 202001010000 "$TMP/wstale/proof/hero-20260820T000000Z.png"
outst="$(run_proof "$TMP/wstale")"
has "$outst" "OLDER than this run" \
  && ok "a frame older than the logs is called out" \
  || bad "a stale frame was accepted as this run's evidence"
has "$outst" "UNVERIFIED  hero frame present" \
  && ok "  and reported UNVERIFIED, not PASS" \
  || bad "  a stale frame was reported PASS"
if has "$outst" "ASSURANCE: STREAMED" || has "$outst" "ASSURANCE: DEPLOYED"; then
  bad "  a stale frame promoted the assurance rung"
else
  ok "  and does not promote the rung"
fi
# a FRESH frame must still pass, or the check is just refusing everything
make_world "$TMP/wfresh" built real url
outfr="$(run_proof "$TMP/wfresh")"
has "$outfr" "PASS        hero frame present" \
  && ok "a fresh frame still passes" \
  || bad "the freshness check now rejects good frames too"

echo "== the report is persisted =="
n=0; for f in "$TMP/w4/proof"/proof-*.txt; do [ -e "$f" ] && n=$((n+1)); done
[ "$n" -ge 1 ] && ok "a proof-*.txt is written under WL_PROOF" || bad "no persisted report"

echo "== fatal scan reads real signatures =="
make_world "$TMP/w5" built real url
printf 'Fatal error: [File:X] Assertion failed\n' >> "$TMP/w5/logs/build.log"
out5="$(run_proof "$TMP/w5")"
has "$out5" "FAIL        fatal scan: build.log" && ok "a fatal signature is caught" \
  || bad "a fatal signature was missed"
# and routine chatter is NOT a fatal
make_world "$TMP/w6" built real url
printf 'LogTemp: Warning: something ordinary\nerror: not really\n' >> "$TMP/w6/logs/build.log"
out6="$(run_proof "$TMP/w6")"
has "$out6" "PASS        fatal scan: build.log" && ok "ordinary chatter is not a fatal" \
  || bad "routine log noise was reported as fatal"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
