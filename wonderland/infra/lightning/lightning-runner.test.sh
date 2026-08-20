#!/usr/bin/env bash
# Offline tests for the Lightning runner. No GPU, no Unreal, no network.
#
# None of the runner can be executed for real from the authoring machine, so
# the parts that are pure logic are tested with mocks and synthetic inputs.
# That is: path detection, the /proc/net/tcp port reader, and — most
# importantly — the frame-structure verifier, because a verifier that cannot
# tell a black frame from a rendered one turns the whole "is it working" step
# into theatre.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()   { echo "  ok   $*"; PASS=$((PASS+1)); }
bad()  { echo "  FAIL $*"; FAIL=$((FAIL+1)); }
check(){ if [ "$1" = "$2" ]; then ok "$3"; else bad "$3 (wanted '$2', got '$1')"; fi; }
# SUBSTRING TESTS WITHOUT A PIPE.
#
# `echo "$x" | grep -q P` is wrong in this file and wrong in a way that hides:
# under `set -o pipefail` grep exits the moment it matches, echo takes SIGPIPE,
# the PIPELINE reports failure, and the assertion inverts — it says "not found"
# precisely when it did find it. Worse, it is FLAKY BY MESSAGE LENGTH: short
# strings finish writing before grep leaves, so the same construct passes for
# some assertions and fails for others in the same run. That is exactly how it
# presented here. This is the third time this trap has bitten in this codebase;
# bash pattern matching has no pipe and no subprocess, so it cannot do it.
has(){ case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

echo "== syntax =="
for f in common.sh prepare.sh build-render.sh run-stream.sh launch-wonderland.sh stop-wonderland.sh; do
  if bash -n "$HERE/$f" 2>/dev/null; then ok "$f parses"; else bad "$f does not parse"; fi
done

echo "== storage detection =="
# A Lightning Studio must land on persistent storage; anywhere else must not
# pretend to. Getting this wrong means a 100 GB engine on a disk that is wiped
# when the Studio stops, and paying to download it again every session.
out=$(WL_ROOT= HOME=/home/x bash -c ". $HERE/common.sh; echo \$WL_ROOT")
case "$out" in
  /teamspace/*) ok "detected Lightning storage ($out)" ;;
  /home/x/wonderland) ok "fell back to \$HOME off-Lightning ($out)" ;;
  *) bad "unexpected WL_ROOT: $out" ;;
esac
out=$(WL_ROOT=/custom/place bash -c ". $HERE/common.sh; echo \$WL_ROOT")
check "$out" "/custom/place" "an explicit WL_ROOT wins"

echo "== port reader =="
# `ss` is absent on some images and reports nothing listening when something
# is. This reads /proc/net/tcp instead, so it has to parse the real format.
mkproc() {  # $1 = hex port, $2 = state
  mkdir -p "$TMP/proc"
  printf '  sl  local_address rem_address   st\n' > "$TMP/proc/net_tcp"
  printf '   0: 0100007F:%s 00000000:0000 %s 00000000:00000000 00:00000000 00000000\n' "$1" "$2" >> "$TMP/proc/net_tcp"
}
port_test() {
  mkproc "$1" "$2"
  sed "s#/proc/net/tcp /proc/net/tcp6#$TMP/proc/net_tcp#" "$HERE/common.sh" > "$TMP/c.sh"
  bash -c ". $TMP/c.sh; wl_port_listening $3 && echo yes || echo no"
}
check "$(port_test 1F90 0A 8080)" "yes" "8080 in LISTEN is seen"
check "$(port_test 1F90 01 8080)" "no"  "8080 ESTABLISHED is not LISTEN"
check "$(port_test 22B8 0A 8080)" "no"  "a different port is not matched"

echo "== frame verifier =="
# Extract the embedded python verifier from the launcher and feed it frames
# whose answer is known. If this cannot separate them, the launcher's VERIFY
# step is worthless and would happily announce a black stream as working.
awk '/<</ && /PYEOF/ {grab=1; next} /^PYEOF$/ {grab=0} grab' \
  "$HERE/launch-wonderland.sh" > "$TMP/verify.py"
# An EMPTY extraction makes python exit 0 on every input, which this test read
# as "the structured frame was accepted" and reported as a pass. A check that
# passes when it extracted nothing is worse than no check, so this is fatal.
if [ -s "$TMP/verify.py" ] && grep -q "BLACK FRAME" "$TMP/verify.py"; then
  ok "extracted the frame verifier ($(wc -l < "$TMP/verify.py") lines)"
else
  bad "could not extract the frame verifier - the cases below cannot be trusted"
  echo "passed $PASS, failed $((FAIL+3))"; exit 1
fi

python3 - "$TMP" <<'PYEOF'
import sys, zlib, struct, os
out = sys.argv[1]
def png(path, pixels, w, h):
    raw = b''.join(b'\x00' + bytes(pixels(y, w)) for y in range(h))
    def chunk(t, d):
        c = t + d
        return struct.pack('>I', len(d)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)
    hdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', hdr)
                           + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))
png(os.path.join(out, 'black.png'), lambda y, w: [0] * (w * 3), 64, 48)
png(os.path.join(out, 'flat.png'),  lambda y, w: [120, 90, 70] * w, 64, 48)
png(os.path.join(out, 'real.png'),
    lambda y, w: [v for x in range(w)
                  for v in ((x * 7 + y * 13) % 256, (x * 3) % 256, (y * 11) % 256)], 64, 48)
PYEOF

for case in "black 2 a black frame is rejected" "flat 3 a single-colour frame is rejected" "real 0 a structured frame is accepted"; do
  set -- $case
  name=$1; want=$2; shift 2; desc="$*"
  python3 "$TMP/verify.py" "$TMP/$name.png" >/dev/null 2>&1
  check "$?" "$want" "$desc"
done

echo "== no vast assumptions carried over =="
# The whole point of this directory is that none of the old host's layout
# leaks in. A hardcoded /opt/wonderland or /home/ue4/wonderland-src would work
# on exactly one machine that no longer exists.
#
# Note what is NOT flagged: /home/ue4/UnrealEngine is Epic's OWN layout inside
# their official container image, and build-render.sh is right to use it there.
# The first version of this check caught that and called it a Vast leak, which
# is the failure mode where a test is louder than it is correct.
leak=0
for f in common.sh prepare.sh build-render.sh run-stream.sh launch-wonderland.sh stop-wonderland.sh; do
  # Comments that EXPLAIN why the old layout is not used are the point of
  # this directory existing; only live code matters. Strip comment bodies and
  # blank the leading-# lines before looking.
  if sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/$f" \
     | grep -nE '/opt/wonderland|/home/ue4/wonderland|/opt/ue-root|vast\.ai|ssh8\.' >/dev/null 2>&1; then
    bad "$f still references the old Vast layout"; leak=1
  fi
done
[ "$leak" = 0 ] && ok "no Vast paths in any Lightning script"

echo "== generated assets land on persistent storage =="
# THE FIRST REAL LIGHTNING RUN FOUND THIS. prepare.sh generated 24 textures and
# 7 wavs successfully, and the build would still have imported NOTHING: the
# synthesis tools defaulted to the old host's /opt/wonderland while the assets
# sat on Studio storage. Nothing failed. Nothing warned. It would have cost a
# GPU session to discover.
out=$(WL_ROOT=/teamspace/studios/this_studio/wonderland bash -c \
      ". $HERE/common.sh; echo \$WONDERLAND_TEXTURE_DIR \$WONDERLAND_AUDIO_DIR")
case "$out" in
  /teamspace/*/textures\ /teamspace/*/audio) ok "asset dirs default under persistent storage ($out)" ;;
  *) bad "asset dirs are not on persistent storage: $out" ;;
esac

GEN="$HERE/../build/generate-hub-level.py"
GT="$HERE/../build/gen-textures.py"
GA="$HERE/../build/gen-audio.py"

# the generator must READ both from the environment, not hardcode either
for var in WONDERLAND_TEXTURE_DIR WONDERLAND_AUDIO_DIR; do
  if grep -q "$var" "$GEN"; then ok "generator reads $var"; else bad "generator ignores $var"; fi
done
# and the env var must actually WIN over the legacy default
out=$(cd "$HERE/../build" && WONDERLAND_AUDIO_DIR=/tmp/wl-a WONDERLAND_TEXTURE_DIR=/tmp/wl-t python3 - <<'PY'
import io, os
src = io.open("generate-hub-level.py", encoding="utf8").read()
head = src[:src.index("\ndef build_niagara")]
g = {"__name__": "p", "__file__": os.path.abspath("generate-hub-level.py")}
exec(compile(head, "g", "exec"), g)
print(g["_AUDIO_DIR"], g["_TEX_DIR"])
PY
)
check "$out" "/tmp/wl-a /tmp/wl-t" "the environment overrides the legacy asset paths"

# No *.wav path may be hardcoded to the old host in the generator's live code.
#
# NOT WRITTEN AS `sed ... | grep -q`. Under `set -o pipefail`, grep -q exits the
# instant it matches, sed dies of SIGPIPE (141), the PIPELINE reports failure,
# and the `if` takes the else branch — announcing "no hardcoded path" exactly
# when there is one. Mutation-testing caught this: re-hardcoding the audio path
# passed 30/30. The stages are separated so each exit code means what it says.
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$GEN" > "$TMP/gen-live.py"
if grep -qE '"/opt/wonderland/audio/' "$TMP/gen-live.py"; then
  bad "generator still hardcodes the old audio path in live code"
else
  ok "no hardcoded /opt/wonderland audio path in generator code"
fi

# both synthesis tools must honour the same variable, or prepare.sh can set it,
# believe it directed the output, and write somewhere else entirely
grep -q "WONDERLAND_TEXTURE_DIR" "$GT" && ok "gen-textures.py honours WONDERLAND_TEXTURE_DIR" \
  || bad "gen-textures.py ignores WONDERLAND_TEXTURE_DIR"
grep -q "WONDERLAND_AUDIO_DIR" "$GA" && ok "gen-audio.py honours WONDERLAND_AUDIO_DIR" \
  || bad "gen-audio.py ignores WONDERLAND_AUDIO_DIR"

# gen-textures.py must actually WRITE where it is told
rm -rf "$TMP/tex"; mkdir -p "$TMP/tex"
if (cd "$HERE/../build" && WONDERLAND_TEXTURE_DIR="$TMP/tex" timeout 600 python3 gen-textures.py >/dev/null 2>&1); then
  n=$(find "$TMP/tex" -name '*.png' 2>/dev/null | wc -l)
  [ "$n" -gt 0 ] && ok "gen-textures.py wrote $n PNGs to the requested directory" \
                 || bad "gen-textures.py wrote nothing to WONDERLAND_TEXTURE_DIR"
else
  bad "gen-textures.py failed when directed by environment"
fi

echo "== the container is given, and shown, the asset dirs =="
for var in WONDERLAND_TEXTURE_DIR WONDERLAND_AUDIO_DIR; do
  n=$(grep -c -- "-e $var=" "$HERE/build-render.sh" 2>/dev/null || echo 0)
  [ "$n" -ge 2 ] && ok "build-render.sh passes $var into the container ($n sites)" \
                 || bad "build-render.sh passes $var into the container only $n time(s)"
  grep -q "$var" "$HERE/build-render.sh" || bad "build-render.sh never mentions $var"
done
# and it must PROVE visibility rather than assume it
grep -q "cannot see the generated assets" "$HERE/build-render.sh" \
  && ok "build-render.sh verifies the container can read them" \
  || bad "build-render.sh assumes container visibility instead of checking"
# refuse to cook with no assets at all
grep -q "run prepare.sh before spending GPU time" "$HERE/build-render.sh" \
  && ok "build-render.sh refuses to cook without generated assets" \
  || bad "build-render.sh would cook a world with no textures or audio"

echo "== the UE engine is restored, never re-downloaded =="
# Lightning discarded the local Docker image once across a machine change. The
# image is ~69 GB, so re-acquiring it over the network ON A GPU MACHINE would
# spend credits on a download. These tests pin the behaviour that prevents it.
#
# A mock docker records every invocation and answers `image inspect` from a
# state file, so the whole decision tree runs without touching a real image.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/docker" <<'MOCKEOF'
#!/bin/sh
echo "$@" >> "$WL_TEST_DOCKER_LOG"
case "$1 $2" in
  "image inspect")
    [ -f "$WL_TEST_IMAGE_PRESENT" ] && exit 0
    exit 1 ;;
esac
case "$1" in
  load)
    [ "$WL_TEST_LOAD_FAILS" = "1" ] && exit 1
    # a real `docker load` makes the image present; the mock does the same
    [ "$WL_TEST_LOAD_WRONG_IMAGE" = "1" ] || : > "$WL_TEST_IMAGE_PRESENT"
    echo "Loaded image: ghcr.io/epicgames/unreal-engine:dev-5.8"
    exit 0 ;;
  pull) exit 0 ;;
esac
exit 0
MOCKEOF
chmod +x "$TMP/bin/docker"

ue_env() {   # $1 = image present? $2 = archive present?
  # Reset the fault switches too. Every case begins from the same state or one
  # case's fault silently becomes the next one's.
  LOADFAIL=0; LOADWRONG=0
  rm -f "$TMP/img" "$TMP/dockerlog" "$TMP/root/ue58-dev.tar"
  mkdir -p "$TMP/root"
  [ "$1" = yes ] && : > "$TMP/img"
  if [ "$2" = yes ]; then
    # a tiny but VALID tar standing in for the 69 GB archive; the size floor is
    # lowered for the test rather than fabricating gigabytes
    ( cd "$TMP" && echo hi > _a && tar -cf "$TMP/root/ue58-dev.tar" _a && rm -f _a )
  fi
}

run_ensure() {
  PATH="$TMP/bin:$PATH" \
  WL_TEST_DOCKER_LOG="$TMP/dockerlog" \
  WL_TEST_IMAGE_PRESENT="$TMP/img" \
  WL_TEST_LOAD_FAILS="${LOADFAIL:-0}" \
  WL_TEST_LOAD_WRONG_IMAGE="${LOADWRONG:-0}" \
  WL_ROOT="$TMP/root" WL_UE="$TMP/root/UnrealEngine" WL_UE_ARCHIVE_MIN_GB=0 \
  bash -c ". $HERE/common.sh; wl_ensure_ue_image" 2>&1
}

ue_env yes no
out="$(run_ensure)"; rc=$?
check "$rc" "0" "a present image is accepted"
has "$out" "already present" && ok "it says the image was already present" \
  || bad "it did not report the present image"
if grep -q "^load" "$TMP/dockerlog" 2>/dev/null; then
  bad "it loaded the archive even though the image was present"
else
  ok "the archive is NOT loaded when the image is present"
fi

ue_env no yes
out="$(run_ensure)"; rc=$?
check "$rc" "0" "a missing image is restored from the archive"
grep -q "^load -i" "$TMP/dockerlog" && ok "docker load ran against the archive" \
  || bad "docker load did not run"
has "$out" "restored" && ok "it reports the restore" || bad "it did not report a restore"

ue_env no yes
# NOT `LOADFAIL=1 out=...`. A variable prefix on an ASSIGNMENT is not a command
# prefix — it sets the variable for the whole rest of the script, and the next
# case inherited it, so the "wrong image" test was silently exercising the
# "load failed" path instead. It passed while testing nothing it claimed to.
out="$(LOADFAIL=1 run_ensure)"; rc=$?
[ "$rc" != "0" ] && ok "a failed docker load fails closed (exit $rc)" \
  || bad "a failed docker load was treated as success"

# docker load can exit 0 having loaded something that is NOT the image we need
ue_env no yes
out="$(LOADWRONG=1 run_ensure)"; rc=$?
[ "$rc" != "0" ] && ok "load exiting 0 without the expected image still fails" \
  || bad "it trusted docker load instead of verifying the image"
has "$out" "different image" && ok "and it says the archive holds a different image" \
  || bad "the message does not explain what went wrong"

ue_env no no
out="$(run_ensure)"; rc=$?
[ "$rc" != "0" ] && ok "no image and no archive fails closed" || bad "it did not fail"
has "$out" "will NOT download" && ok "and it says it will not download Unreal" \
  || bad "the failure does not state the no-download rule"

# THE COST INVARIANT. No live line in any Lightning script may pull an image.
pullhits=0
for f in common.sh prepare.sh build-render.sh run-stream.sh launch-wonderland.sh stop-wonderland.sh; do
  sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/$f" > "$TMP/nc.sh"
  # Lines the script PRINTS to the founder are not lines it runs. The CPU
  # acquisition instructions legitimately mention a pull; what must never exist
  # is an executed one. Printed guidance in this project is prefixed
  # "[wonderland]", so those lines are excluded.
  if grep -vE '^\[wonderland\]' "$TMP/nc.sh" | grep -qE '^[^#]*docker[[:space:]]+pull'; then
    bad "$f contains a live 'docker pull' — a GPU launch must never download Unreal"
    pullhits=1
  fi
done
[ "$pullhits" = 0 ] && ok "no Lightning script pulls an image in live code"
if grep -q "^pull" "$TMP/dockerlog" 2>/dev/null; then
  bad "the ensure helper invoked docker pull"
else
  ok "the ensure helper never invoked docker pull"
fi

echo "== readiness distinguishes RESTORABLE from NOT READY =="
status_of() {
  ue_env "$1" "$2"
  PATH="$TMP/bin:$PATH" WL_TEST_DOCKER_LOG="$TMP/dockerlog" \
  WL_TEST_IMAGE_PRESENT="$TMP/img" \
  WL_ROOT="$TMP/root" WL_UE="$TMP/root/UnrealEngine" WL_UE_ARCHIVE_MIN_GB=0 \
  bash -c ". $HERE/common.sh; wl_ue_status" 2>/dev/null
}
check "$(status_of yes no)" "READY"      "image loaded reads READY"
check "$(status_of no yes)" "RESTORABLE" "image absent + archive present reads RESTORABLE"
check "$(status_of no no)"  "MISSING"    "neither reads MISSING"

# a truncated export must not read as restorable
ue_env no yes
out="$(PATH="$TMP/bin:$PATH" WL_TEST_IMAGE_PRESENT="$TMP/img" \
      WL_ROOT="$TMP/root" WL_UE="$TMP/root/UnrealEngine" WL_UE_ARCHIVE_MIN_GB=20 \
      bash -c ". $HERE/common.sh; wl_ue_status" 2>/dev/null)"
check "$out" "MISSING" "an archive below the size floor is not RESTORABLE"

echo "== one definition of the engine constants =="
for f in prepare.sh build-render.sh; do
  # grep -c prints 0 AND exits 1 when nothing matches, so `|| echo 0` appended
  # a second zero and the count read "0\n0". Count lines instead.
  n=$(grep 'WL_UE_IMAGE:-' "$HERE/$f" 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" = "0" ] && ok "$f does not redefine WL_UE_IMAGE" \
                 || bad "$f redefines WL_UE_IMAGE ($n site(s)) - two defaults drift apart"
done
grep -q 'WL_UE_ARCHIVE:-' "$HERE/common.sh" && ok "common.sh defines WL_UE_ARCHIVE" \
  || bad "WL_UE_ARCHIVE is not defined in common.sh"

echo "== the launcher restores before it prepares =="
le=$(grep -n "wl_ensure_ue_image" "$HERE/launch-wonderland.sh" | head -1 | cut -d: -f1)
# match the INVOCATION, not the header comment that mentions the file
lp=$(grep -n 'bash "\$HERE/prepare.sh"' "$HERE/launch-wonderland.sh" | head -1 | cut -d: -f1)
if [ -n "$le" ] && [ -n "$lp" ] && [ "$le" -lt "$lp" ]; then
  ok "wl_ensure_ue_image runs before prepare.sh (lines $le < $lp)"
else
  bad "the launcher prepares before restoring the engine (ensure=$le prepare=$lp)"
fi

echo "== stage 5 pipeline hazards (the class that killed two paid runs) =="
# Both reproduced before being fixed: `find | head -1` over a large tree exits
# 141 on SIGPIPE, and `grep | tail -1` with no match exits 1. Under
# `set -euo pipefail` either one ends the script with NO output — the same
# silent death as the Config/ hash bug, in the next unproven stage.
mkdir -p "$TMP/big/a/b/c"
i=0; while [ "$i" -lt 200 ]; do mkdir -p "$TMP/big/d$i/e"; : > "$TMP/big/d$i/e/x$i"; i=$((i+1)); done
: > "$TMP/big/a/b/c/Wonderland.sh"

# the helper must survive a tree big enough that find is still running
out=$(WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh
set -euo pipefail
R=\"\$(wl_find_first $TMP/big -maxdepth 4 -name 'x*' -type f)\"
echo \"REACHED:\$R\"" 2>&1); rc=$?
check "$rc" "0" "wl_find_first survives a large tree under set -euo pipefail"
case "$out" in *REACHED:*) ok "  and the line after it runs" ;; *) bad "  it died before the next line" ;; esac

# a no-match search must return empty, not kill the caller
out=$(WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh
set -euo pipefail
R=\"\$(wl_find_first $TMP/big -name 'definitely-not-here')\"
echo \"REACHED:[\$R]\"" 2>&1); rc=$?
check "$rc" "0" "a no-match search does not kill the caller"
case "$out" in *"REACHED:[]"*) ok "  and returns empty" ;; *) bad "  wrong no-match result: $out" ;; esac

# a missing root must not kill it either
out=$(WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh
set -euo pipefail
R=\"\$(wl_find_first $TMP/nope -name x)\"
echo REACHED" 2>&1); rc=$?
check "$rc" "0" "a missing search root does not kill the caller"

# no live `find ... | head` may remain in the launch path
leak=0
for f in common.sh prepare.sh build-render.sh run-stream.sh launch-wonderland.sh; do
  sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/$f" > "$TMP/nc2.sh"
  if grep -qE 'find .*\| *head' "$TMP/nc2.sh"; then
    bad "$f still pipes find into head — SIGPIPE kills it under pipefail"; leak=1
  fi
done
[ "$leak" = 0 ] && ok "no 'find | head' remains in the launch path"

# the tunnel poll must tolerate the no-match case it hits on every early pass
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/run-stream.sh" > "$TMP/nc3.sh"
if grep -qE 'url="\$\(grep' "$TMP/nc3.sh"; then
  bad "the tunnel URL poll still assigns straight from a bare grep pipeline"
else
  ok "the tunnel URL poll tolerates no-match"
fi

echo "== gpu guard =="
# launch-wonderland must refuse to run without a GPU rather than start a long
# build and fail at the end.
mkdir -p "$TMP/bin"; printf '#!/bin/sh\nexit 1\n' > "$TMP/bin/nvidia-smi"; chmod +x "$TMP/bin/nvidia-smi"
PATH="$TMP/bin:$PATH" WL_ROOT="$TMP/wl" bash "$HERE/launch-wonderland.sh" >"$TMP/noGpu.log" 2>&1
rc=$?
check "$rc" "2" "launcher exits 2 when nvidia-smi finds nothing"
grep -q "no GPU" "$TMP/noGpu.log" && ok "it says why" || bad "it exits without explaining"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ]
