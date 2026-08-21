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

echo "== stage 6 can actually capture a frame =="
# A run reaching "8/8" with no hero frame is not a successful run: the phase's
# own criteria list one, and VERIFY has nothing to check without it. Nothing
# installed playwright, so shot.cjs exited 3, the launcher only warned, and the
# gap was invisible until someone read the report.
grep -q 'WL_TOOLS' "$HERE/common.sh" && ok "common.sh defines a tools dir" \
  || bad "no WL_TOOLS definition"
out=$(WL_ROOT=/teamspace/studios/this_studio/wonderland bash -c ". $HERE/common.sh; echo \$WL_TOOLS")
case "$out" in /teamspace/*/tools) ok "the toolchain lives on persistent storage ($out)" ;;
  *) bad "toolchain is not on persistent storage: $out" ;; esac
grep -q 'npm install playwright' "$HERE/prepare.sh" && ok "prepare.sh installs playwright on CPU" \
  || bad "prepare.sh does not install playwright — stage 6 will produce no frame"
grep -q 'playwright install --with-deps chrome' "$HERE/prepare.sh" \
  && ok "prepare.sh installs real Chrome (the bundled Chromium has no H264)" \
  || bad "prepare.sh does not install Chrome"
grep -q 'hero capture' "$HERE/prepare.sh" && ok "readiness reports whether capture can run" \
  || bad "readiness does not report capture readiness"
grep -q "node_modules/playwright" "$HERE/shot.cjs" && ok "shot.cjs resolves from the tools dir" \
  || bad "shot.cjs cannot find a locally installed playwright"

# The capture and the signalling server need DIFFERENT nodes, and taking one
# answer for both breaks stage 6 on a correctly-installed machine.
grep -q "require('playwright')" "$HERE/launch-wonderland.sh" \
  && ok "the launcher picks a node that can load playwright" \
  || bad "the launcher assumes a node instead of testing it"

echo "== the launcher states its own completion criteria =="
for crit in "packaged Wonderland" "pixel streaming" "browser url" "hero frame" "verification"; do
  grep -q "$crit" "$HERE/launch-wonderland.sh" \
    && ok "8/8 reports: $crit" || bad "8/8 does not report: $crit"
done

echo "== the UE target config is gated before a paid cook =="
grep -q 'verify-target-config.py' "$HERE/prepare.sh" \
  && ok "prepare.sh runs the target-config gate" \
  || bad "a legacy target config would not be caught until the L4 compile"
if python3 "$HERE/../build/verify-target-config.py" >/dev/null 2>&1; then
  ok "the targets are on UE 5.8 settings"
else
  bad "verify-target-config.py fails on the current tree"
fi

echo "== project-local headers are gated before a paid compile =="
# A real L4 got through UHT and nine compile actions before dying on a header
# that had never been committed. Finding those one at a time costs a compile
# each; this finds all of them in under a second.
grep -q 'verify-local-includes.py' "$HERE/prepare.sh" \
  && ok "prepare.sh runs the local-include gate" \
  || bad "a missing project header would not be caught until the L4 compile"
if python3 "$HERE/../build/verify-local-includes.py" >/dev/null 2>&1; then
  ok "every project-local include resolves"
else
  bad "verify-local-includes.py fails on the current tree"
fi

echo "== gpu guard =="
# launch-wonderland must refuse to run without a GPU rather than start a long
# build and fail at the end.
mkdir -p "$TMP/bin"; printf '#!/bin/sh\nexit 1\n' > "$TMP/bin/nvidia-smi"; chmod +x "$TMP/bin/nvidia-smi"
PATH="$TMP/bin:$PATH" WL_ROOT="$TMP/wl" bash "$HERE/launch-wonderland.sh" >"$TMP/noGpu.log" 2>&1
rc=$?
check "$rc" "2" "launcher exits 2 when nvidia-smi finds nothing"
grep -q "no GPU" "$TMP/noGpu.log" && ok "it says why" || bad "it exits without explaining"

echo "== stage 5 uses the PROVEN Lightning architecture =="
# THE ARCHITECTURE THAT WAS WRONG. run-stream.sh searched $WL_UE for a
# SignallingWebServer directory. On Lightning the engine is a Docker image, so
# that directory can never exist and the search returned empty on a perfectly
# healthy machine. Every assertion below pins the replacement.
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/run-stream.sh" > "$TMP/rs-live.sh"

if grep -qE 'wl_find_first "\$WL_UE".*SignallingWebServer|-name .SignallingWebServer' "$TMP/rs-live.sh"; then
  bad "run-stream.sh still searches the engine tree for SignallingWebServer"
else
  ok "the engine-tree SignallingWebServer lookup is gone"
fi
grep -q 'WL_PS_SIG' "$TMP/rs-live.sh" && ok "run-stream.sh uses the separate PS infrastructure checkout" \
  || bad "run-stream.sh does not reference WL_PS_SIG"

# UE5.8 Wilbur's flags, exactly. --http_port is the UE5.5 name; passing it to a
# UE5.8 Wilbur is accepted, ignored, and the server listens somewhere else —
# which every later port check then reports as a failure to start.
grep -q -- '--player_port' "$TMP/rs-live.sh"   && ok "uses --player_port" || bad "does not pass --player_port"
grep -q -- '--streamer_port' "$TMP/rs-live.sh" && ok "uses --streamer_port" || bad "does not pass --streamer_port"
grep -q -- '--peer_options_file' "$TMP/rs-live.sh" && ok "uses --peer_options_file" \
  || bad "does not use --peer_options_file"
grep -q -- '--http_root' "$TMP/rs-live.sh" && ok "serves an explicit --http_root" || bad "no --http_root"
if grep -qE -- '--peer_options[[:space:]]' "$TMP/rs-live.sh"; then
  bad "the old inline --peer_options JSON is still passed"
else
  ok "the inline --peer_options form is gone"
fi
if grep -q -- '--http_port' "$TMP/rs-live.sh"; then
  bad "run-stream.sh still passes the UE5.5-era --http_port"
else
  ok "no UE5.5-era --http_port remains"
fi

echo "== the PS infrastructure version is proven exactly =="
ps_env() {   # $1 = version string or "none", $2 = dist? $3 = www?
  # The REAL checkout layout: two bare one-line files at the infrastructure
  # root, not shell declarations buried in platform_scripts.
  rm -rf "$TMP/ps"; mkdir -p "$TMP/ps/SignallingWebServer"
  [ "$1" = none ] || printf '%s\n' "$1" > "$TMP/ps/DOWNLOAD_VERSION"
  printf 'v22.14.0\n' > "$TMP/ps/NODE_VERSION"
  [ "$2" = yes ] && mkdir -p "$TMP/ps/SignallingWebServer/dist"
  [ "$3" = yes ] && mkdir -p "$TMP/ps/SignallingWebServer/www"
  return 0
}
ps_status() {
  WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" \
    bash -c ". $HERE/common.sh; wl_ps_status" 2>/dev/null
}
ps_env UE5.8 yes yes; check "$(ps_status)" "READY"         "a built UE5.8 checkout reads READY"
ps_env UE5.5 yes yes; check "$(ps_status)" "WRONG_VERSION" "a UE5.5 checkout is rejected by version"
ps_env UE5.8 no  yes; check "$(ps_status)" "NOT_BUILT"     "no dist/ reads NOT_BUILT"
ps_env UE5.8 yes no ; check "$(ps_status)" "NOT_BUILT"     "no www/ reads NOT_BUILT (the page would 404)"
ps_env none  yes yes; check "$(ps_status)" "WRONG_VERSION" "an undeterminable version is not assumed good"
rm -rf "$TMP/ps";     check "$(ps_status)" "MISSING"       "an absent checkout reads MISSING"

# EXACT, not prefix. 'UE5.8.1' is a different branch and must not satisfy UE5.8.
ps_env UE5.8.1 yes yes; check "$(ps_status)" "WRONG_VERSION" "UE5.8.1 does not satisfy an exact UE5.8"

# and each failing state must fail CLOSED with a message, not warn and continue
for st in "none:no checkout" "UE5.5:wrong branch" ; do
  v="${st%%:*}"; desc="${st#*:}"
  if [ "$v" = none ]; then rm -rf "$TMP/ps"; else ps_env "$v" yes yes; fi
  out=$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" \
        bash -c ". $HERE/common.sh; wl_require_ps_infra" 2>&1); rc=$?
  [ "$rc" != "0" ] && ok "wl_require_ps_infra fails closed: $desc (exit $rc)" \
                   || bad "wl_require_ps_infra accepted: $desc"
done
ps_env UE5.8 yes yes
out=$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" \
      bash -c ". $HERE/common.sh; wl_require_ps_infra" 2>&1); rc=$?
check "$rc" "0" "wl_require_ps_infra accepts a correct checkout"

# a version lookup over a tree must not die under the callers' set -euo pipefail
out=$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/nope" bash -c '
set -euo pipefail
. '"$HERE"'/common.sh
V="$(wl_ps_version)"
echo "REACHED:[$V]"' 2>&1); rc=$?
check "$rc" "0" "wl_ps_version survives a missing tree under set -euo pipefail"
case "$out" in *"REACHED:[]"*) ok "  and returns empty" ;; *) bad "  wrong result: $out" ;; esac

echo "== the version comes from the real DOWNLOAD_VERSION file =="
# THE REAL LIGHTNING CHECKOUT, exactly. $WL_PS_INFRA/DOWNLOAD_VERSION holds a
# bare version string and nothing else — it is NOT a shell declaration. Two
# earlier parsers searched the tree for an assignment, found nothing, and made
# wl_ps_status answer WRONG_VERSION for a correct UE5.8 — so stage 5 would have
# refused to start on a healthy machine. Failing the GOOD case is the worse
# direction: it spends a GPU session disproving something already right.
real_ps() {   # $1 = version file contents or "none"
  rm -rf "$TMP/ps"; mkdir -p "$TMP/ps/SignallingWebServer/dist" "$TMP/ps/SignallingWebServer/www"
  [ "$1" = none ] || printf '%s\n' "$1" > "$TMP/ps/DOWNLOAD_VERSION"
  printf 'v22.14.0\n' > "$TMP/ps/NODE_VERSION"
  return 0
}
ps_call() { WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" bash -c ". $HERE/common.sh; $1" 2>/dev/null; }

real_ps UE5.8
check "$(ps_call wl_ps_version)" "UE5.8"  "the real file layout reads UE5.8"
check "$(ps_call wl_ps_status)"  "READY"  "and a built UE5.8 checkout reads READY"

real_ps UE5.7   ; check "$(ps_call wl_ps_status)" "WRONG_VERSION" "UE5.7 is rejected"
real_ps UE5.8.1 ; check "$(ps_call wl_ps_status)" "WRONG_VERSION" "UE5.8.1 does not satisfy an exact UE5.8"
real_ps none    ; check "$(ps_call wl_ps_status)" "WRONG_VERSION" "a MISSING version file fails closed"
real_ps none    ; check "$(ps_call wl_ps_version)" ""             "  and reports no version rather than guessing"

# trailing newline and CRLF are both ordinary for a one-line file
real_ps UE5.8; printf 'UE5.8\r\n' > "$TMP/ps/DOWNLOAD_VERSION"
check "$(ps_call wl_ps_version)" "UE5.8" "a CRLF version file still reads UE5.8"
real_ps UE5.8; printf '  UE5.8  \n' > "$TMP/ps/DOWNLOAD_VERSION"
check "$(ps_call wl_ps_version)" "UE5.8" "surrounding whitespace is trimmed"

# and it must NOT go hunting through the tree any more
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/common.sh" > "$TMP/cs-live.sh"
if grep -qE 'grep -r.*DOWNLOAD_VERSION' "$TMP/cs-live.sh"; then
  bad "wl_ps_version still recursively greps the infrastructure tree"
else
  ok "the recursive tree search is gone"
fi
grep -q 'DOWNLOAD_VERSION' "$TMP/cs-live.sh" && ok "common.sh names the authoritative file" \
  || bad "common.sh no longer reads DOWNLOAD_VERSION at all"

echo "== the node is verified against NODE_VERSION before Wilbur starts =="
# The real checkout has NODE_VERSION=v22.14.0 and NO bundled node; the host
# node happens to match. That is a pass — but only because it was CHECKED. A
# mismatched node fails deep inside a dependency and reads as a networking
# problem, which is an expensive way to learn a version number on a GPU.
mkdir -p "$TMP/nbin"
mknode() {  # $1 = version it reports
  printf '#!/bin/sh\ncase "$1" in -v) echo %s ;; esac\nexit 0\n' "$1" > "$TMP/nbin/node"
  chmod +x "$TMP/nbin/node"
  printf '#!/bin/sh\nexit 0\n' > "$TMP/nbin/npm"; chmod +x "$TMP/nbin/npm"
}
node_call() {  # $1 = function
  PATH="$TMP/nbin:/usr/bin:/bin" WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" \
    bash -c ". $HERE/common.sh; $1" 2>&1
}
real_ps UE5.8; mknode v22.14.0
out="$(node_call wl_require_node)"; rc=$?
check "$rc" "0" "a host node matching NODE_VERSION is accepted"
check "$(node_call wl_node_status)" "READY" "  and reads READY"

mknode v18.20.4
out="$(node_call wl_require_node)"; rc=$?
[ "$rc" != "0" ] && ok "a MISMATCHED host node fails closed (exit $rc)" \
                 || bad "a mismatched node was accepted - Wilbur would fail deep in a dependency"
has "$out" "v22.14.0" && ok "  and the message names the required version" \
  || bad "  the failure does not say which version is needed"
check "$(node_call wl_node_status)" "WRONG_VERSION" "  and reads WRONG_VERSION"

# v22.14.1 is not v22.14.0. Exact, like the UE version.
mknode v22.14.1
out="$(node_call wl_require_node)"; rc=$?
[ "$rc" != "0" ] && ok "a near-miss node version is still refused" \
                 || bad "v22.14.1 was accepted for a v22.14.0 requirement"

# no NODE_VERSION file at all is a failure, never an assumption
real_ps UE5.8; rm -f "$TMP/ps/NODE_VERSION"; mknode v22.14.0
out="$(node_call wl_require_node)"; rc=$?
[ "$rc" != "0" ] && ok "a missing NODE_VERSION file fails closed" \
                 || bad "it ran without knowing which node was required"
check "$(node_call wl_node_status)" "MISSING" "  and reads MISSING"

# stage 5 must verify BEFORE launching, not after
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/run-stream.sh" > "$TMP/rs-live2.sh"
grep -q 'wl_require_node' "$TMP/rs-live2.sh" && ok "run-stream.sh verifies the node" \
  || bad "run-stream.sh starts Wilbur without checking the node"
ln_req=$( ( set +o pipefail; grep -n 'wl_require_node' "$TMP/rs-live2.sh" | head -1 | cut -d: -f1 ) || true)
ln_npm=$( ( set +o pipefail; grep -n 'npm start' "$TMP/rs-live2.sh" | head -1 | cut -d: -f1 ) || true)
if [ -n "$ln_req" ] && [ -n "$ln_npm" ] && [ "$ln_req" -lt "$ln_npm" ]; then
  ok "the node is verified before Wilbur is launched (lines $ln_req < $ln_npm)"
else
  bad "Wilbur launches before the node is verified (require=$ln_req npm=$ln_npm)"
fi
# and no live line may fetch a node during a GPU launch
if grep -qE 'npm[[:space:]]+install[[:space:]]+.*node|nvm[[:space:]]+install|curl.*nodejs\.org' "$TMP/rs-live2.sh"; then
  bad "run-stream.sh would download a node during a GPU launch"
else
  ok "no node is downloaded in the launch path"
fi

echo "== vulkan is proven, and nvidia-smi is not accepted as proof =="
# THE REAL L4 FAILURE. TURN, Wilbur, 8080, 8888 and the player page were all
# working; the packaged client started and died in RHIInit:
#   vpCreateInstance(...) failed, VkResult=-9  VK_ERROR_INCOMPATIBLE_DRIVER
# nvidia-smi was healthy the whole time. It talks to the kernel driver; Vulkan
# additionally needs a loader, an ICD manifest, and the userspace library that
# manifest names. Treating the first as evidence of the rest is the mistake.

# The probe is real: on THIS machine it finds a software llvmpipe device and
# correctly refuses to call that an NVIDIA GPU.
if [ -r "$HERE/vulkan-probe.py" ]; then ok "the vulkan probe exists"; else bad "no vulkan-probe.py"; fi
python3 -c "import ast,io;ast.parse(io.open('$HERE/vulkan-probe.py').read())" 2>/dev/null \
  && ok "the vulkan probe parses" || bad "vulkan-probe.py does not parse"
probe_json="$(python3 "$HERE/vulkan-probe.py" 2>/dev/null)"; probe_rc=$?
if [ "$probe_rc" != "0" ]; then
  ok "the probe fails on a machine with no NVIDIA GPU (exit $probe_rc)"
else
  bad "the probe reported an NVIDIA device on a machine that has none"
fi
has "$probe_json" '"nvidiaDeviceEnumerated": false' \
  && ok "  and says so explicitly rather than by exit code alone" \
  || bad "  the probe output does not state the verdict"
# It must not mistake a software rasteriser for a GPU - llvmpipe enumerates
# happily and would make every check downstream pass on a CPU renderer.
if has "$probe_json" 'llvmpipe'; then
  has "$probe_json" '"isNvidia": false' && ok "  and llvmpipe is classified as NOT nvidia" \
    || bad "  llvmpipe was accepted as an NVIDIA device"
else
  ok "  (no llvmpipe on this host to classify)"
fi

# nvidia-smi lying about Vulkan: a mocked, perfectly healthy nvidia-smi must
# NOT be enough to let the launch proceed.
mkdir -p "$TMP/gbin"
cat > "$TMP/gbin/nvidia-smi" <<'SMIEOF'
#!/bin/sh
case "$*" in
  -L) echo "GPU 0: NVIDIA L4 (UUID: GPU-test)" ;;
  *name*) echo "NVIDIA L4" ;;
  *driver_version*) echo "550.54.15" ;;
  *) echo "NVIDIA L4" ;;
esac
exit 0
SMIEOF
chmod +x "$TMP/gbin/nvidia-smi"
out=$(PATH="$TMP/gbin:$PATH" WL_ROOT="$TMP/root" WL_LIGHTNING_DIR="$HERE" \
      bash -c ". $HERE/common.sh; wl_require_vulkan" 2>&1); rc=$?
[ "$rc" != "0" ] && ok "a healthy nvidia-smi is NOT accepted as vulkan proof (exit $rc)" \
                 || bad "nvidia-smi success was treated as vulkan success - the exact L4 mistake"
has "$out" "VK_ERROR_INCOMPATIBLE_DRIVER" \
  && ok "  and the refusal names the crash it is preventing" \
  || bad "  the refusal does not reference the real crash"

echo "== the refusal prints real evidence, not 'GPU failed' =="
rep=$(PATH="$TMP/gbin:$PATH" WL_ROOT="$TMP/root" WL_LIGHTNING_DIR="$HERE" \
      bash -c ". $HERE/common.sh; wl_vulkan_report" 2>&1)
for item in "gpu" "nvidia driver" "vulkan loader" "nvidia ICD json" "ICD library" \
            "libvulkan" "VK_ICD_FILENAMES" "VK_DRIVER_FILES" "LD_LIBRARY_PATH" \
            "vulkaninfo" "instance probe"; do
  has "$rep" "$item" && ok "evidence includes: $item" || bad "evidence omits: $item"
done
# the mocked GPU must actually show up in the report, or the report is not reading anything
has "$rep" "NVIDIA L4"   && ok "the report shows the detected GPU"    || bad "the report ignores nvidia-smi"
has "$rep" "550.54.15"   && ok "the report shows the driver version"  || bad "the report omits the driver version"

echo "== the ICD override is detected, never guessed =="
# A hardcoded ICD path is worse than none: it turns a clear "no driver" into a
# confusing "wrong driver".
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/common.sh" > "$TMP/cs2.sh"
if grep -qE '(VK_ICD_FILENAMES|VK_DRIVER_FILES)=/usr/share/vulkan' "$TMP/cs2.sh"; then
  bad "an ICD path is hardcoded in live code"
else
  ok "no ICD path is hardcoded"
fi
# unset -> no environment pairs at all
out=$(WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh; wl_vulkan_env_pairs" 2>&1)
check "$out" "" "with WL_VULKAN_ICD unset, nothing is injected"
# set to a real file -> both names, that file
: > "$TMP/nv.json"
out=$(WL_ROOT="$TMP/root" WL_VULKAN_ICD="$TMP/nv.json" \
      bash -c ". $HERE/common.sh; wl_vulkan_env_pairs" 2>&1)
has "$out" "VK_ICD_FILENAMES=$TMP/nv.json" && ok "a detected ICD sets VK_ICD_FILENAMES" \
  || bad "VK_ICD_FILENAMES not set from WL_VULKAN_ICD"
has "$out" "VK_DRIVER_FILES=$TMP/nv.json" && ok "and VK_DRIVER_FILES (loader-version dependent)" \
  || bad "VK_DRIVER_FILES not set from WL_VULKAN_ICD"
# set to a file that does not exist -> refuse, do not silently ignore
out=$(WL_ROOT="$TMP/root" WL_VULKAN_ICD="$TMP/definitely-absent.json" \
      bash -c ". $HERE/common.sh; wl_vulkan_env_pairs" 2>&1); rc=$?
[ "$rc" != "0" ] && ok "a WL_VULKAN_ICD that does not exist fails closed" \
                 || bad "a nonexistent ICD override was accepted"

# SCOPED TO THE CHILD. A global export would redirect every other GPU program
# on a shared Studio.
grep -q 'setsid nohup env \$(wl_vulkan_env_pairs)' "$TMP/rs-live2.sh" 2>/dev/null \
  || grep -q 'env \$(wl_vulkan_env_pairs)' "$HERE/run-stream.sh" \
  && ok "the vulkan environment is applied to the Wonderland process only" \
  || bad "the vulkan environment is not scoped to the client"
if grep -qE '^[[:space:]]*export[[:space:]]+VK_(ICD_FILENAMES|DRIVER_FILES)=' "$TMP/cs2.sh"; then
  bad "VK_* is exported globally - it would affect the whole Studio"
else
  ok "VK_* is never exported into the Studio environment"
fi

echo "== the ICD manifest's library is checked, not just the manifest =="
# A manifest naming a library that is not installed IS what -9 looks like, and
# it is invisible unless the library_path is followed.
mkdir -p "$TMP/icd"
printf '{"file_format_version":"1.0.0","ICD":{"library_path":"%s/libGLX_nvidia.so.0","api_version":"1.3.277"}}\n' "$TMP/icd" > "$TMP/icd/nvidia_icd.json"
out=$(WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh; wl_vulkan_icd_library $TMP/icd/nvidia_icd.json")
check "$out" "$TMP/icd/libGLX_nvidia.so.0" "the library_path is read out of the manifest"
WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh; wl_vulkan_library_resolves '$TMP/icd/libGLX_nvidia.so.0' '$TMP/icd/nvidia_icd.json'" \
  && bad "a library that does not exist was reported as resolving" \
  || ok "a manifest naming an absent library does NOT resolve"
: > "$TMP/icd/libGLX_nvidia.so.0"
WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh; wl_vulkan_library_resolves '$TMP/icd/libGLX_nvidia.so.0' '$TMP/icd/nvidia_icd.json'" \
  && ok "and once the library exists it does resolve" \
  || bad "an existing library was reported as missing"

echo "== wilbur's dependencies are proven BEFORE turn starts =="
# MODULE_NOT_FOUND on require("express") after a CPU->L4 machine switch, found
# only once coturn was already running.
mkmod() {  # $1 = resolve? (yes/no)
  rm -rf "$TMP/nbin"; mkdir -p "$TMP/nbin"
  if [ "$1" = yes ]; then
    printf '#!/bin/sh\ncase "$1" in -v) echo v22.14.0 ;; -e) exit 0 ;; esac\nexit 0\n' > "$TMP/nbin/node"
  else
    printf '#!/bin/sh\ncase "$1" in -v) echo v22.14.0 ;; -e) exit 1 ;; esac\nexit 0\n' > "$TMP/nbin/node"
  fi
  chmod +x "$TMP/nbin/node"
}
real_ps UE5.8; mkdir -p "$TMP/ps/SignallingWebServer"
mod_call() { PATH="$TMP/nbin:/usr/bin:/bin" WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" \
  WL_WILBUR_MODULES_ARCHIVE="$TMP/nomods.tar" bash -c ". $HERE/common.sh; $1" 2>&1; }

mkmod yes
check "$(mod_call wl_wilbur_modules_status)" "READY" "resolvable modules read READY"
out="$(mod_call wl_require_wilbur_modules)"; rc=$?
check "$rc" "0" "  and the preflight passes"

mkmod no
check "$(mod_call wl_wilbur_modules_status)" "MISSING" "unresolvable modules read MISSING"
out="$(mod_call wl_require_wilbur_modules)"; rc=$?
[ "$rc" != "0" ] && ok "  and the preflight FAILS CLOSED (exit $rc)" \
                 || bad "  it continued with modules that cannot load"
has "$out" "npm ci" && ok "  and names the exact CPU fix" || bad "  no actionable fix given"

# BOTH names, and express specifically - it is the one that actually failed.
grep -q 'express' "$TMP/cs2.sh" && ok "express is one of the required modules" \
  || bad "express is not checked"
grep -q 'lib-pixelstreamingsignalling-ue5.8' "$TMP/cs2.sh" \
  && ok "the signalling library is one of the required modules" \
  || bad "the signalling library is not checked"

# NO SILENT NETWORK on a GPU. npm ci only on explicit opt-in, and never audit fix.
if grep -qE 'npm[[:space:]]+audit' "$TMP/cs2.sh"; then
  bad "npm audit appears in live code"
else
  ok "npm audit is never run"
fi
grep -q 'WL_ALLOW_NPM_INSTALL' "$TMP/cs2.sh" && ok "npm ci is opt-in only" \
  || bad "dependencies could be downloaded on a GPU without opting in"

# BEHAVIOURALLY, not just by mention. Mutation-testing showed the guard
# `if [ "$WL_ALLOW_NPM_INSTALL" = "1" ]` could be replaced with `if true` and
# every assertion still passed, because the variable was still named in the
# export line above. A mock npm that records being run settles it.
mkmod no
printf '#!/bin/sh\necho "$@" >> "$WL_TEST_NPM_LOG"\nexit 0\n' > "$TMP/nbin/npm"
chmod +x "$TMP/nbin/npm"
rm -f "$TMP/npmlog"
PATH="$TMP/nbin:/usr/bin:/bin" WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" \
  WL_WILBUR_MODULES_ARCHIVE="$TMP/nomods.tar" WL_ALLOW_NPM_INSTALL=0 \
  WL_TEST_NPM_LOG="$TMP/npmlog" \
  bash -c ". $HERE/common.sh; wl_require_wilbur_modules" >/dev/null 2>&1
if [ -s "$TMP/npmlog" ]; then
  bad "npm ran on a GPU launch without WL_ALLOW_NPM_INSTALL=1"
else
  ok "npm is NOT invoked when the opt-in is off"
fi
# and WITH the opt-in it must actually run ci (not install, not audit)
rm -f "$TMP/npmlog"
PATH="$TMP/nbin:/usr/bin:/bin" WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" \
  WL_WILBUR_MODULES_ARCHIVE="$TMP/nomods.tar" WL_ALLOW_NPM_INSTALL=1 \
  WL_TEST_NPM_LOG="$TMP/npmlog" \
  bash -c ". $HERE/common.sh; wl_require_wilbur_modules" >/dev/null 2>&1
npmlog="$(cat "$TMP/npmlog" 2>/dev/null || true)"
has "$npmlog" "ci" && ok "with the opt-in on, npm ci runs" || bad "the opt-in did not run npm ci"
if has "$npmlog" "audit"; then bad "npm audit was invoked"; else ok "and npm audit is never invoked"; fi
out=$(WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh; echo \$WL_ALLOW_NPM_INSTALL")
check "$out" "0" "and the opt-in defaults to OFF"

echo "== the preflight order is: deps, vulkan, THEN turn and the client =="
ln_mod=$( ( set +o pipefail; grep -n 'wl_require_wilbur_modules' "$HERE/run-stream.sh" | head -1 | cut -d: -f1 ) || true)
ln_vk=$(  ( set +o pipefail; grep -n 'wl_require_vulkan'         "$HERE/run-stream.sh" | head -1 | cut -d: -f1 ) || true)
ln_turn=$(( set +o pipefail; grep -n '^start_turn$'              "$HERE/run-stream.sh" | head -1 | cut -d: -f1 ) || true)
ln_app=$( ( set +o pipefail; grep -n '^start_app$'               "$HERE/run-stream.sh" | head -1 | cut -d: -f1 ) || true)
for pair in "deps:$ln_mod:$ln_turn" "vulkan:$ln_vk:$ln_turn" "vulkan:$ln_vk:$ln_app"; do
  nm="${pair%%:*}"; rest="${pair#*:}"; a="${rest%%:*}"; b="${rest#*:}"
  if [ -n "$a" ] && [ -n "$b" ] && [ "$a" -lt "$b" ]; then
    ok "$nm is checked before line $b"
  else
    bad "$nm is not checked first (a=$a b=$b)"
  fi
done

echo "== the packaged build must contain a Pixel Streaming runtime =="
# THE LIVE BLOCKER. Wonderland ran on the L4 and used it, Wilbur served 8080
# and 8888, the public URL worked, and the browser said "No streamer
# available": Wonderland.uproject enabled NO Pixel Streaming plugin, so there
# was no streamer in the build. app.log carried the -PixelStreamingURL command
# line and zero PixelStreaming/WebRTC/encoder lines, because an unrecognised
# switch is not an error to Unreal and nothing announced it.
UPJ="$HERE/../../Wonderland.uproject"
python3 -c "import json,io;json.load(io.open('$UPJ',encoding='utf8'))" 2>/dev/null \
  && ok "Wonderland.uproject is valid JSON" || bad "Wonderland.uproject does not parse"
psname=$(python3 - "$UPJ" <<'PYX'
import json, io, sys
d = json.load(io.open(sys.argv[1], encoding="utf8"))
for p in d.get("Plugins", []):
    if p.get("Enabled") and "pixelstreaming" in p.get("Name", "").lower():
        print(p["Name"])
PYX
)
[ -n "$psname" ] && ok "the project enables a Pixel Streaming plugin ($psname)" \
                 || bad "the project enables NO Pixel Streaming plugin - the live blocker"
# It must not be editor-only, or it never stages into the packaged Linux build.
allow=$(python3 - "$UPJ" <<'PYX'
import json, io, sys
d = json.load(io.open(sys.argv[1], encoding="utf8"))
for p in d.get("Plugins", []):
    if p.get("Enabled") and "pixelstreaming" in p.get("Name", "").lower():
        print(p.get("TargetAllowList") or "")
PYX
)
[ -z "$(printf '%s' "$allow" | tr -d '[:space:]')" ] \
  && ok "  and it is enabled for all targets, not editor-only" \
  || bad "  it is restricted to $allow and would not stage into a Linux package"

# The engine-side gate: enabled-but-absent must fail, and no plugin at all must
# fail with a DIFFERENT code, because the two need different responses.
VPS="$HERE/../build/verify-pixelstreaming-plugin.py"
[ -r "$VPS" ] && ok "the plugin gate exists" || bad "no verify-pixelstreaming-plugin.py"
python3 "$VPS" >/dev/null 2>&1
rc=$?
[ "$rc" = 0 ] && ok "the plugin gate passes on the current project (exit 0)" \
              || bad "the plugin gate fails on the current tree (exit $rc)"
# a project with no PS plugin must exit 2
mkdir -p "$TMP/proj/infra/build"
printf '{"FileVersion":3,"Plugins":[{"Name":"EnhancedInput","Enabled":true}]}\n' > "$TMP/proj/Wonderland.uproject"
cp "$VPS" "$TMP/proj/infra/build/"
python3 "$TMP/proj/infra/build/verify-pixelstreaming-plugin.py" >/dev/null 2>&1
check "$?" "2" "a project enabling no streamer exits 2"
# an editor-only PS plugin must exit 1
printf '{"FileVersion":3,"Plugins":[{"Name":"PixelStreaming2","Enabled":true,"TargetAllowList":["Editor"]}]}\n' > "$TMP/proj/Wonderland.uproject"
python3 "$TMP/proj/infra/build/verify-pixelstreaming-plugin.py" >/dev/null 2>&1
check "$?" "1" "an editor-only streamer plugin exits 1"
# and it must NOT invent an engine result when no engine is reachable
out=$(WL_UE=/definitely/absent WL_ROOT=/definitely/absent python3 "$VPS" 2>&1)
has "$out" "UNVERIFIED" && ok "with no engine it reports UNVERIFIED, not PASS" \
  || bad "it claimed a result it could not have checked"

echo "== the package proof catches a streamer-less build =="
VPK="$HERE/../build/verify-packaged-streamer.py"
[ -r "$VPK" ] && ok "the package proof exists" || bad "no verify-packaged-streamer.py"
mkpkg() {  # $1 = dir, $2 = with-streamer? yes/no, $3 = layout mono|modular
  rm -rf "$1"; mkdir -p "$1/Linux/Wonderland/Binaries/Linux"
  head -c 6000000 /dev/zero > "$1/Linux/Wonderland/Binaries/Linux/Wonderland"
  chmod +x "$1/Linux/Wonderland/Binaries/Linux/Wonderland"
  if [ "$2" = yes ]; then
    if [ "$3" = modular ]; then
      mkdir -p "$1/Linux/Engine/Plugins/Media/PixelStreaming2"
    else
      printf 'PixelStreaming2Module' >> "$1/Linux/Wonderland/Binaries/Linux/Wonderland"
    fi
  fi
}
mkpkg "$TMP/pk" yes mono
WL_OUT="$TMP/pk" python3 "$VPK" >/dev/null 2>&1
check "$?" "0" "a monolithic build with the runtime linked in PASSES"
mkpkg "$TMP/pk" yes modular
WL_OUT="$TMP/pk" python3 "$VPK" >/dev/null 2>&1
check "$?" "0" "a modular build with a staged plugin dir PASSES"
mkpkg "$TMP/pk" no mono
WL_OUT="$TMP/pk" python3 "$VPK" >/dev/null 2>&1
check "$?" "1" "a build with NO streamer FAILS"
out=$(WL_OUT="$TMP/pk" python3 "$VPK" 2>&1)
has "$out" "No streamer available" && ok "  and names the browser symptom it explains" \
  || bad "  the failure does not connect to the observed symptom"
# absent package is 'not found', never 'fail' - they are different situations
WL_OUT="$TMP/definitely-absent" python3 "$VPK" >/dev/null 2>&1
check "$?" "2" "an absent package reports NOT FOUND rather than failing"

# both gates must be wired in, before anything expensive
grep -q 'verify-pixelstreaming-plugin.py' "$HERE/prepare.sh" \
  && ok "prepare.sh runs the plugin gate before the cook" \
  || bad "a streamer-less project would not be caught until a browser said so"
grep -q 'verify-packaged-streamer.py' "$HERE/run-stream.sh" \
  && ok "run-stream.sh proves the package before launching it" \
  || bad "run-stream.sh launches a package it has not checked"

echo "== zero streamer lines is diagnosed, not shrugged at =="
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/run-stream.sh" > "$TMP/rs3.sh"
has "$(cat "$TMP/rs3.sh")" "no streamer in the packaged build" \
  && ok "run-stream distinguishes 'no streamer in the build' from 'did not join'" \
  || bad "both failures still read the same to the founder"
grep -q 'PixelStreaming|WebRTC|Streamer' "$TMP/rs3.sh" \
  && ok "  by looking for streamer lines of any kind in app.log" \
  || bad "  it does not inspect app.log for streamer activity"

echo "== the missing NVIDIA ICD is generated, scoped, from a detected library =="
# PROVEN ON THE L4: no manifest under /etc/vulkan or /usr/share/vulkan, but
# /usr/lib/x86_64-linux-gnu/libGLX_nvidia.so.0 present. A manifest pointing at
# it got Unreal past VK_ERROR_INCOMPATIBLE_DRIVER.
mkdir -p "$TMP/nvlib"
: > "$TMP/nvlib/libGLX_nvidia.so.0"
gen_call() { WL_ROOT="$TMP/root" WL_RUN="$TMP/root/run" \
  bash -c "_WL_NV_LIB_DIRS='$TMP/nvlib'; . $HERE/common.sh; _WL_NV_LIB_DIRS='$TMP/nvlib'; $1" 2>&1; }
out=$(gen_call wl_vulkan_nvidia_lib)
check "$out" "$TMP/nvlib/libGLX_nvidia.so.0" "the NVIDIA driver library is detected"
out=$(gen_call wl_vulkan_generate_icd)
[ -n "$out" ] && [ -r "$out" ] && ok "an ICD manifest is generated at $out" \
  || bad "no ICD manifest was generated from a detected library"
python3 -c "import json,io;d=json.load(io.open('$out'));print(d['ICD']['library_path'])" 2>/dev/null | \
  grep -q "libGLX_nvidia.so.0" && ok "  and it points at the detected library" \
  || bad "  the generated manifest does not name the detected library"
python3 -c "import json,io;json.load(io.open('$out'))" 2>/dev/null \
  && ok "  and is valid JSON the loader can read" || bad "  the generated manifest is not valid JSON"
# IT MUST BE WRITTEN UNDER $WL_RUN, never into the system.
case "$out" in
  "$TMP/root/run"/*) ok "  and lives under WL_RUN, not /etc or /usr" ;;
  *) bad "  the generated manifest was written outside WL_RUN: $out" ;;
esac
if grep -qE '>[[:space:]]*/(etc|usr)/' "$TMP/cs2.sh"; then
  bad "common.sh writes into /etc or /usr - that mutates the Studio globally"
else
  ok "nothing is written into /etc or /usr"
fi
# NOTHING IS GENERATED WITHOUT A DETECTED LIBRARY. A manifest naming a library
# that is not there converts a clear failure into a confusing one.
rm -f "$TMP/nvlib/libGLX_nvidia.so.0"
out=$(gen_call wl_vulkan_generate_icd)
check "$out" "" "with no NVIDIA library present, nothing is generated"
# and a system manifest, when one exists, is left alone rather than overridden
mkdir -p "$TMP/nvlib"; : > "$TMP/nvlib/libGLX_nvidia.so.0"
out=$(WL_ROOT="$TMP/root" WL_RUN="$TMP/root/run" bash -c "
_WL_ICD_DIRS='$TMP/sysicd'; . $HERE/common.sh
_WL_ICD_DIRS='$TMP/sysicd'; _WL_NV_LIB_DIRS='$TMP/nvlib'
mkdir -p '$TMP/sysicd'; : > '$TMP/sysicd/nvidia_icd.json'
wl_vulkan_icd_files" 2>&1)
check "$out" "" "an existing system manifest is used as-is, not overridden"
# the auto-generation can be turned off
out=$(WL_ROOT="$TMP/root" WL_RUN="$TMP/root/run" WL_VULKAN_AUTOGEN_ICD=0 bash -c "
. $HERE/common.sh; _WL_NV_LIB_DIRS='$TMP/nvlib'; wl_vulkan_icd_files" 2>&1)
check "$out" "" "WL_VULKAN_AUTOGEN_ICD=0 disables generation"

echo "== the packaged build must open the world that was generated =="
# THE ROOT CAUSE OF THE WRONG WORLD. The generator saves to
# /Game/Wonderland/Maps/WonderlandHub. The project had NO Config/ directory at
# all, so no GameDefaultMap was set, and BuildCookRun was invoked with no -map.
# A packaged Unreal game with no map pinned opens the ENGINE'S OWN default map.
# The stream was healthy and showed a near-empty template with proxy pawns.
PROJ="$HERE/../.."
LEVEL=$(python3 -c "import json,io;print(json.load(io.open('$PROJ/WorldDesign/hub-layout.json',encoding='utf8'))['level'])")
check "$LEVEL" "/Game/Wonderland/Maps/WonderlandHub" "the generator's target level is known"

[ -f "$PROJ/Config/DefaultEngine.ini" ] && ok "Config/DefaultEngine.ini exists" \
  || bad "no Config/DefaultEngine.ini - a packaged build would open the engine default map"
CFG="$(cat "$PROJ/Config/DefaultEngine.ini" 2>/dev/null || true)"
has "$CFG" "GameDefaultMap=" && ok "GameDefaultMap is set" || bad "no GameDefaultMap"
has "$CFG" "WonderlandHub"   && ok "  and it names WonderlandHub" || bad "  it does not name WonderlandHub"
# MapsToCook MOVED TO DefaultGame.ini with the rest of ProjectPackagingSettings,
# which is a GAME-ini config class. In DefaultEngine.ini it parsed and did
# nothing — that is what stripped every material and rendered the live L4 world
# grey. GameDefaultMap above is EngineSettings and correctly stays put.
GAMECFG="$(cat "$PROJ/Config/DefaultGame.ini" 2>/dev/null || true)"
has "$GAMECFG" "MapsToCook" && ok "the map is in MapsToCook (DefaultGame.ini)" \
  || bad "the map is not explicitly cooked"
has "$GAMECFG" "DirectoriesToAlwaysCook" \
  && ok "  and runtime-only assets are force-cooked from the game ini" \
  || bad "  DirectoriesToAlwaysCook is missing from DefaultGame.ini"
# A setting naming a class that does not exist is a fabricated setting.
if has "$CFG" "GlobalDefaultGameMode="; then
  gm=$( ( set +o pipefail; printf '%s' "$CFG" | grep -oE 'GlobalDefaultGameMode=[^ ]+' ) || true)
  cls="${gm##*.}"
  if ls "$PROJ/Source/Wonderland/"*.h >/dev/null 2>&1 && grep -rq "class .*$cls" "$PROJ/Source/Wonderland/" 2>/dev/null; then
    ok "GlobalDefaultGameMode names a class that exists ($cls)"
  else
    bad "GlobalDefaultGameMode names $cls, which does not exist in Source/Wonderland"
  fi
else
  ok "no GlobalDefaultGameMode is set (this project has no GameMode class)"
fi
grep -q -- '-map=' "$HERE/../build/build-wonderland.sh" \
  && ok "the cook names the map explicitly" \
  || bad "BuildCookRun infers what to cook and can omit the generated world"

echo "== the world audit fails on the pre-fix state =="
VW="$HERE/../build/verify-packaged-world.py"
[ -r "$VW" ] && ok "the world audit exists" || bad "no verify-packaged-world.py"
python3 "$VW" >/dev/null 2>&1
check "$?" "0" "the audit passes on the current (fixed) source"
# Reconstruct the exact broken state: no Config at all.
rm -rf "$TMP/wp"; mkdir -p "$TMP/wp/infra/build" "$TMP/wp/WorldDesign"
printf '{"level":"/Game/Wonderland/Maps/WonderlandHub"}\n' > "$TMP/wp/WorldDesign/hub-layout.json"
cp "$VW" "$TMP/wp/infra/build/"
printf 'run_step BuildCookRun -project=x -nop4 -build -cook\n' > "$TMP/wp/infra/build/build-wonderland.sh"
out=$(python3 "$TMP/wp/infra/build/verify-packaged-world.py" 2>&1); rc=$?
check "$rc" "1" "the audit FAILS when Config/ is missing (the real pre-fix state)"
has "$out" "engine default map" && ok "  and explains that the engine default map would open" \
  || bad "  the failure does not explain the consequence"
# and the -map omission is caught on its own
mkdir -p "$TMP/wp/Config"
printf 'GameDefaultMap=/Game/Wonderland/Maps/WonderlandHub.WonderlandHub\n' > "$TMP/wp/Config/DefaultEngine.ini"
out=$(python3 "$TMP/wp/infra/build/verify-packaged-world.py" 2>&1); rc=$?
check "$rc" "1" "a cook with no -map still fails the audit"
has "$out" "omit the generated world" && ok "  and says why that matters" \
  || bad "  the -map failure is not explained"
# UNVERIFIED is not PASS: with no package and no log it must not claim runtime proof
out=$(WL_OUT="$TMP/definitely-absent" WL_APP_LOG="$TMP/definitely-absent.log" python3 "$VW" 2>&1)
has "$out" "UNVERIFIED" && ok "with no package or log it reports UNVERIFIED, not PASS" \
  || bad "it claimed a runtime result it could not have measured"

echo "== the running build states which world it is in =="
WP="$PROJ/Source/Wonderland/WonderlandWorldProof.cpp"
[ -r "$WP" ] && ok "the runtime world proof exists" || bad "no WonderlandWorldProof.cpp"
for token in "WORLD=" "ACTORS=" "RELAY_DOGS=" "COMPOUND_AGENTS=" "PROXY_ACTORS=" "WORLD_MISMATCH"; do
  grep -q "$token" "$WP" && ok "runtime logs $token" || bad "runtime does not log $token"
done
# Warning level, or the packaged log filters it out and the proof is unreadable.
grep -q "LogWonderlandProof, Warning, TEXT(\"WORLD=" "$WP" \
  && ok "the proof logs at Warning (Display is filtered from packaged logs)" \
  || bad "the proof would be invisible in a packaged build log"
grep -q "WonderlandWorldProof::Register" "$PROJ/Source/Wonderland/WonderlandModule.cpp" \
  && ok "the module registers the proof at startup" \
  || bad "the proof is never registered - it would never run"

# THE UE 5.8 DELEGATE, exactly. The first version hooked
# FWorldDelegates::OnWorldBeginPlay, which does not exist in 5.8 — the compile
# said "no member named 'OnWorldBeginPlay' in 'FWorldDelegates'". UWorld has a
# per-world OnWorldBeginPlay, which is a different thing; the global hook that
# fires once per world with actors already initialised is
# OnWorldInitializedActors, and it passes a params struct rather than a UWorld*.
WPLIVE="$TMP/wp-live.cpp"
sed 's|[[:space:]]//.*$||; s|^[[:space:]]*//.*$||' "$WP" > "$WPLIVE"
if grep -q 'FWorldDelegates::OnWorldBeginPlay' "$WPLIVE"; then
  bad "still hooks FWorldDelegates::OnWorldBeginPlay - no such member in UE 5.8"
else
  ok "the non-existent FWorldDelegates::OnWorldBeginPlay hook is gone"
fi
grep -q 'FWorldDelegates::OnWorldInitializedActors.AddStatic' "$WPLIVE" \
  && ok "registers on FWorldDelegates::OnWorldInitializedActors" \
  || bad "does not register on the UE 5.8 delegate"
grep -q 'FWorldDelegates::OnWorldInitializedActors.Remove' "$WPLIVE" \
  && ok "and unregisters from the same delegate" \
  || bad "registers on one delegate and unregisters from another"
# The callback signature has to match, or it fails to compile again.
grep -q 'const FActorsInitializedParams& Params' "$WPLIVE" \
  && ok "the callback takes const FActorsInitializedParams&" \
  || bad "the callback signature does not match the delegate"
grep -q 'UWorld\* World = Params.World' "$WPLIVE" \
  && ok "and the world comes from Params.World" \
  || bad "the world is not taken from the params struct"
# Engine/World.h declares FActorsInitializedParams; without it this will not build.
grep -q '#include "Engine/World.h"' "$WP" \
  && ok "Engine/World.h is included for FActorsInitializedParams" \
  || bad "FActorsInitializedParams would be undeclared"
# and the audit must be able to READ those lines back
rm -rf "$TMP/rt"; mkdir -p "$TMP/rt"
printf 'LogWonderlandProof: Warning: WORLD=/Game/Wonderland/Maps/WonderlandHub\nACTORS=33048\nRELAY_DOGS=12\nCOMPOUND_AGENTS=4\nPROXY_ACTORS=0\n' > "$TMP/rt/app.log"
out=$(WL_APP_LOG="$TMP/rt/app.log" python3 "$VW" 2>&1)
has "$out" "RUNTIME PASS" && ok "a correct runtime log reads as PASS" || bad "a correct runtime log was not accepted"
printf 'WORLD=/Engine/Maps/Entry\nACTORS=14\nRELAY_DOGS=0\nCOMPOUND_AGENTS=0\nPROXY_ACTORS=1\n' > "$TMP/rt/app.log"
out=$(WL_APP_LOG="$TMP/rt/app.log" python3 "$VW" 2>&1); rc=$?
check "$rc" "1" "the engine default map + 14 actors FAILS the audit"
has "$out" "not WonderlandHub" && ok "  and names the world that actually opened" \
  || bad "  the failure does not name the wrong world"
printf 'WORLD=/Game/Wonderland/Maps/WonderlandHub\nACTORS=31\nRELAY_DOGS=0\nCOMPOUND_AGENTS=0\nPROXY_ACTORS=0\n' > "$TMP/rt/app.log"
out=$(WL_APP_LOG="$TMP/rt/app.log" python3 "$VW" 2>&1); rc=$?
check "$rc" "1" "the RIGHT map with a template-sized actor count also fails"
has "$out" "template, not the generated world" && ok "  and says the cooked map is stale/small" \
  || bad "  a stale cooked map is not distinguished"

echo "== the production region is explicit and US-West =="
VR="$HERE/../build/verify-region.py"
python3 "$VR" >/dev/null 2>&1; check "$?" "0" "the default region passes"
out=$(python3 "$VR" 2>&1)
has "$out" "us-west4" && ok "the default is us-west4 (Las Vegas)" || bad "the default is not us-west4"
WL_GCP_REGION=us-east1 python3 "$VR" >/dev/null 2>&1
check "$?" "1" "an east-coast region is REFUSED, not warned about"
WL_GCP_REGION=us-central1 python3 "$VR" >/dev/null 2>&1
check "$?" "1" "a central region is refused too"
WL_GCP_REGION=us-west2 python3 "$VR" >/dev/null 2>&1
check "$?" "0" "us-west2 (Los Angeles) is allowed"
has "$out" "not sufficient" && ok "and it states that region alone is not a quality claim" \
  || bad "it lets a region be read as proof of quality"

echo "== CONNECTED is distinguished from GOOD ENOUGH TO USE, by measurement =="
VQ="$HERE/../build/verify-stream-quality.py"
[ -r "$VQ" ] && ok "the quality gate exists" || bad "no verify-stream-quality.py"
q() { printf '%s' "$1" | python3 "$VQ" >"$TMP/q.out" 2>&1; printf '%s' "$?"; }
GOOD='{"inbound":{"packetsReceived":100000,"packetsLost":200,"framesPerSecond":60,"frameWidth":1280,"frameHeight":720},"candidatePair":{"currentRoundTripTime":0.021},"localCandidate":{"candidateType":"srflx","protocol":"udp"},"remoteCandidate":{"candidateType":"srflx","protocol":"udp"},"measuredKbps":6200,"measuredFps":60}'
check "$(q "$GOOD")" "0" "a direct, low-latency, full-rate session is GOOD_ENOUGH"
# THE FOUNDER'S ACTUAL SYMPTOM: connects fine, looks bad.
POOR='{"inbound":{"packetsReceived":9000,"packetsLost":400,"framesPerSecond":18,"frameWidth":1280,"frameHeight":720},"candidatePair":{"currentRoundTripTime":0.140},"localCandidate":{"candidateType":"relay","protocol":"tcp"},"remoteCandidate":{"candidateType":"relay","protocol":"tcp"},"measuredKbps":900,"measuredFps":18}'
check "$(q "$POOR")" "1" "a connected-but-poor session is NOT good enough"
out="$(cat "$TMP/q.out")"
has "$out" "TURN relay" && ok "  and names the relayed media path" || bad "  the relay is not named"
has "$out" "TCP" && ok "  and names the TCP candidate pair" || bad "  the TCP pair is not named"
has "$out" "below the" && ok "  and names the bitrate floor" || bad "  the bitrate floor is not named"
check "$(q '{"inbound":null,"error":"the page created no RTCPeerConnection"}')" "2" \
  "no video at all is NOT_CONNECTED, a third distinct verdict"
# A GOOD SESSION THAT IS MERELY RELAYED must still fail: the route is the point.
RELAYED='{"inbound":{"packetsReceived":100000,"packetsLost":100,"framesPerSecond":60,"frameWidth":1280,"frameHeight":720},"candidatePair":{"currentRoundTripTime":0.020},"localCandidate":{"candidateType":"relay","protocol":"udp"},"remoteCandidate":{"candidateType":"srflx","protocol":"udp"},"measuredKbps":8000,"measuredFps":60}'
check "$(q "$RELAYED")" "1" "a fast but RELAYED session is still not production-quality"
# and nothing in the gate may infer quality from geography
# The gate may EXPLAIN where a threshold came from ("US-West to US-West should
# beat this"); what it must never do is read a region and let that influence the
# verdict. Assert on the mechanism, not on the word - the first version of this
# failed on a comment, which is a test being louder than it is correct.
if grep -qE 'WL_GCP_REGION|getenv.*REGION|region *=' "$VQ"; then
  bad "the quality gate reads a region - quality must be measured, not inferred"
else
  ok "the quality gate never reads a region; every verdict comes from a measurement"
fi

echo "== the stats come from a real receiving browser =="
SS="$HERE/stream-stats.cjs"
[ -r "$SS" ] && ok "stream-stats.cjs exists" || bad "no stream-stats.cjs"
node --check "$SS" 2>/dev/null && ok "  and it parses" || bad "  it does not parse"
grep -q "channel: 'chrome'" "$SS" \
  && ok "  and uses real Chrome (bundled Chromium has no H264 decoder)" \
  || bad "  bundled Chromium would decode nothing and read as zero bitrate"
for f in getStats currentRoundTripTime packetsLost candidateType framesPerSecond; do
  grep -q "$f" "$SS" && ok "  collects $f" || bad "  does not collect $f"
done
# bitrate must be a RATE, from two samples
grep -q "measuredKbps" "$SS" && ok "  reports a measured bitrate, not a byte total" \
  || bad "  a single bytesReceived says nothing about throughput"

echo "== prepare.sh reports the two new CPU-settleable facts =="
grep -q 'WILBUR DEPS' "$HERE/prepare.sh" && ok "prepare.sh reports wilbur dependency state" \
  || bad "prepare.sh does not report wilbur dependencies"
grep -q 'vulkan  ' "$HERE/prepare.sh" && ok "prepare.sh has a vulkan readiness row" \
  || bad "prepare.sh has no vulkan row"

echo "== prepare.sh reports both signalling facts =="
grep -q 'SIGNALLING READY - \$WL_PS_VERSION' "$HERE/prepare.sh" \
  && ok "prepare.sh reports SIGNALLING READY - UE5.8" || bad "prepare.sh does not report the signalling version"
grep -q 'SIGNALLING NODE READY' "$HERE/prepare.sh" \
  && ok "prepare.sh reports SIGNALLING NODE READY - v22.14.0" || bad "prepare.sh does not report the node version"

echo "== coturn comes from persistent storage, never the network =="
# Same cost invariant as the engine, same three answers. A host `turnserver`
# binary does not exist on the Lightning image, so the old check took the
# "coturn absent, same-host only" branch every time — a warning, and a stream
# that reaches a remote browser and stays black.
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
    [ "${WL_TEST_LOAD_FAILS:-0}" = "1" ] && exit 1
    [ "${WL_TEST_LOAD_WRONG_IMAGE:-0}" = "1" ] || : > "$WL_TEST_IMAGE_PRESENT"
    echo "Loaded image: coturn/coturn:4.17.0-r0-debian"
    exit 0 ;;
  pull) exit 0 ;;
esac
exit 0
MOCKEOF
chmod +x "$TMP/bin/docker"

turn_env() {  # $1 = image present? $2 = archive present?
  LOADFAIL=0; LOADWRONG=0
  rm -f "$TMP/img" "$TMP/dockerlog" "$TMP/root/coturn.tar"; mkdir -p "$TMP/root"
  [ "$1" = yes ] && : > "$TMP/img"
  if [ "$2" = yes ]; then
    ( cd "$TMP" && echo hi > _t && tar -cf "$TMP/root/coturn.tar" _t && rm -f _t )
  fi
  return 0
}
turn_run() {  # $1 = function to call
  PATH="$TMP/bin:$PATH" \
  WL_TEST_DOCKER_LOG="$TMP/dockerlog" WL_TEST_IMAGE_PRESENT="$TMP/img" \
  WL_TEST_LOAD_FAILS="${LOADFAIL:-0}" WL_TEST_LOAD_WRONG_IMAGE="${LOADWRONG:-0}" \
  WL_ROOT="$TMP/root" WL_TURN_ARCHIVE="$TMP/root/coturn.tar" \
  bash -c ". $HERE/common.sh; $1" 2>&1
}

turn_env yes no; check "$(turn_run wl_turn_status)" "READY"      "a loaded coturn image reads READY"
turn_env no yes; check "$(turn_run wl_turn_status)" "RESTORABLE" "image absent + archive reads RESTORABLE"
turn_env no no ; check "$(turn_run wl_turn_status)" "MISSING"    "neither reads MISSING"

turn_env yes no
out="$(turn_run wl_ensure_turn_image)"; rc=$?
check "$rc" "0" "a present coturn image is accepted"
if grep -q "^load" "$TMP/dockerlog" 2>/dev/null; then
  bad "it loaded the coturn archive although the image was present"
else
  ok "the coturn archive is NOT loaded when the image is present"
fi

turn_env no yes
out="$(turn_run wl_ensure_turn_image)"; rc=$?
check "$rc" "0" "a missing coturn image is restored from the archive"
grep -q "^load -i" "$TMP/dockerlog" && ok "docker load ran against the coturn archive" \
  || bad "docker load did not run for coturn"

turn_env no yes
out="$(LOADWRONG=1 turn_run wl_ensure_turn_image)"; rc=$?
[ "$rc" != "0" ] && ok "a coturn load exiting 0 without the image still fails closed" \
                 || bad "it trusted docker load instead of verifying the coturn image"
has "$out" "different image" && ok "  and says the archive holds a different image" \
  || bad "  the coturn failure message does not explain what went wrong"

turn_env no no
out="$(turn_run wl_ensure_turn_image)"; rc=$?
[ "$rc" != "0" ] && ok "no coturn image and no archive fails closed" || bad "it did not fail"
has "$out" "will NOT download" && ok "  and states the no-download rule" \
  || bad "  the coturn failure does not state the no-download rule"
if grep -q "^pull" "$TMP/dockerlog" 2>/dev/null; then
  bad "the coturn ensure helper invoked docker pull"
else
  ok "the coturn ensure helper never invoked docker pull"
fi

echo "== cleanup touches only the Wonderland-owned TURN container =="
sed 's/[[:space:]]#.*$//; s/^[[:space:]]*#.*$//' "$HERE/stop-wonderland.sh" > "$TMP/stop-live.sh"
grep -q 'WL_TURN_CONTAINER' "$TMP/stop-live.sh" && ok "cleanup names the container it owns" \
  || bad "cleanup does not reference WL_TURN_CONTAINER"
# The dangerous shapes: removing by IMAGE, or by everything running.
if grep -qE 'ancestor=|docker (rm|stop)[^"]*\$\(docker ps -q\)' "$TMP/stop-live.sh"; then
  bad "cleanup removes containers by image or wholesale — it would kill a foreign coturn"
else
  ok "cleanup never removes by image or wholesale"
fi
if grep -q 'turnserver' "$TMP/stop-live.sh"; then
  bad "cleanup still hunts a host turnserver process that does not exist on Lightning"
else
  ok "the host-turnserver kill is gone"
fi
# and it must survive a machine with no docker at all
grep -q 'command -v docker' "$TMP/stop-live.sh" && ok "cleanup tolerates a machine without docker" \
  || bad "cleanup assumes docker exists"

echo "== stage 5 pre-flight refuses a foreign process on any port =="
# THE QUIET FAILURE. If something else already holds 8080, our signalling
# server cannot bind, and every later check that merely asks "is the port
# listening" then passes on the intruder — the stream is reported up while
# nothing of ours is running. Run the real script with a common.sh whose port
# reader always answers yes.
mkdir -p "$TMP/rs" "$TMP/root/packaged/Linux/w"
: > "$TMP/root/packaged/Linux/w/Wonderland.sh"; chmod +x "$TMP/root/packaged/Linux/w/Wonderland.sh"
cp "$HERE/run-stream.sh" "$TMP/rs/run-stream.sh"
{ cat "$HERE/common.sh"; printf '\nwl_port_listening() { return 0; }\n'; } > "$TMP/rs/common.sh"
# ALL THREE PORTS, checked structurally: the behavioural case below proves the
# loop refuses a collision, but it would pass just as well if the loop had
# quietly stopped covering the streamer or TURN port. Mutation-testing found
# exactly that — dropping two ports from the loop changed nothing here.
PREFLIGHT_LOOP="$( ( set +o pipefail; grep -m1 'for _p in ' "$TMP/rs-live.sh" ) || true)"
for _v in WL_HTTP_PORT WL_STREAMER_PORT WL_TURN_PORT; do
  if has "$PREFLIGHT_LOOP" "$_v"; then
    ok "pre-flight covers $_v"
  else
    bad "pre-flight no longer checks $_v for a foreign owner"
  fi
done
for port_case in WL_HTTP_PORT WL_STREAMER_PORT WL_TURN_PORT; do
  out=$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" bash "$TMP/rs/run-stream.sh" 2>&1); rc=$?
  [ "$rc" != "0" ] && ok "pre-flight refuses to start when a port is held ($port_case path)" \
                   || bad "pre-flight started into a port collision ($port_case)"
  has "$out" "already in use" && ok "  and says which port" || bad "  it did not name the collision"
  break   # one execution proves the loop; the ports are checked in one pass
done

# and with all ports FREE it must still refuse when the infrastructure is absent
{ cat "$HERE/common.sh"; printf '\nwl_port_listening() { return 1; }\n'; } > "$TMP/rs/common.sh"
rm -rf "$TMP/ps"
out=$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/ps" WL_TURN_ARCHIVE="$TMP/none.tar" \
      bash "$TMP/rs/run-stream.sh" 2>&1); rc=$?
[ "$rc" != "0" ] && ok "pre-flight refuses to start with no PS infrastructure" \
                 || bad "it started stage 5 with no signalling server present"
has "$out" "SignallingWebServer" && ok "  and names what is missing" \
  || bad "  the message does not name the missing infrastructure"

echo "== stage 5 success requires an answering player page =="
# A bound port is not a served page: --serve with a wrong --http_root binds
# happily and 404s every request, and the founder opens a dead URL.
grep -q 'wl_http_ok "http://127.0.0.1:\$WL_HTTP_PORT/"' "$TMP/rs-live.sh" \
  && ok "run-stream.sh probes the player page over HTTP before claiming success" \
  || bad "run-stream.sh accepts a listening port as proof the page is served"
grep -q 'wl_wait_port "\$WL_STREAMER_PORT"' "$TMP/rs-live.sh" \
  && ok "and it proves the streamer socket opened too" \
  || bad "the streamer port is never proven — the client could never connect"
# the probe itself must not pass on a closed port
out=$(WL_ROOT="$TMP/root" bash -c ". $HERE/common.sh; wl_http_ok http://127.0.0.1:9/ 2; echo rc=\$?" 2>&1)
case "$out" in *"rc=0"*) bad "wl_http_ok returned success for a closed port" ;;
  *) ok "wl_http_ok does not pass on a closed port" ;; esac

echo "== TURN is proven running, not merely launched =="
# NOT just "the helper is mentioned somewhere". It is called twice — once as
# an idempotence check at the top of start_turn, once as the post-launch
# verification — and mutation-testing showed that deleting the SECOND call left
# a bare mention behind, so this assertion passed while the launch was no
# longer verified at all. Pin the failure branch instead, which only the
# verification has.
grep -q 'the TURN container exited' "$TMP/rs-live.sh" \
  && ok "run-stream.sh confirms the container is actually up after launching it" \
  || bad "it trusts 'docker run -d' exiting 0 - a container that exits at once reads as success"
# Anchored on the failure branch for the same reason as the check above: the
# helper also appears in the poll loop, so a bare mention survives deleting the
# assertion entirely. Mutation-testing caught this one too.
grep -q 'nothing is listening on' "$TMP/rs-live.sh" \
  && ok "and it fails when nothing is listening on the TURN port" \
  || bad "the TURN port is polled but never actually required"
grep -q -- '--network host' "$TMP/rs-live.sh" \
  && ok "coturn runs on the host network (a bridged relay advertises an unreachable address)" \
  || bad "coturn is not on the host network"

echo "== one definition of the new constants =="
for v in WL_PS_INFRA WL_PS_VERSION WL_TURN_IMAGE WL_TURN_ARCHIVE WL_TURN_CONTAINER; do
  grep -q "$v:-" "$HERE/common.sh" && ok "common.sh defines $v" || bad "$v is not defined in common.sh"
  for f in run-stream.sh stop-wonderland.sh prepare.sh; do
    n=$(grep "$v:-" "$HERE/$f" 2>/dev/null | wc -l | tr -d ' ')
    [ "$n" = "0" ] || bad "$f redefines $v ($n site(s)) - two defaults drift apart"
  done
done

echo "== the branch that gets compiled =="
#
# THE REGRESSION THIS CLOSES. prepare.sh fetched, checked out and `reset --hard`
# an existing $WL_SRC onto $WL_BRANCH with no message. $WL_SRC is a checkout of
# its OWN — not the operator's working directory — so `git checkout <branch>` in
# a shell never affected what was compiled. With a stale default, an L4 session
# compiled, packaged, streamed and MEASURED a world whose source did not contain
# the code under test, and every stage reported success.
out=$(bash -c ". $HERE/common.sh; echo \$WL_BRANCH")
check "$out" "relay/wonderland-marble" "WL_BRANCH defaults to the branch the work is on"
grep -q "wl_require_source_branch" "$HERE/prepare.sh" \
  && ok "prepare.sh asks before switching branches" \
  || bad "prepare.sh can still switch branches silently"
if python3 -c "
import io,sys
src=io.open('$HERE/prepare.sh',encoding='utf8').read()
sys.exit(0 if src.index('wl_require_source_branch') < src.index('reset --hard \"origin/\$WL_BRANCH\"') else 1)"; then
  ok "...and it asks BEFORE the hard reset, not after"
else bad "the branch guard runs after the reset that it exists to prevent"; fi
grep -q "wl_verify_source" "$HERE/build-render.sh" \
  && ok "build-render.sh re-verifies the source before handing off to the compiler" \
  || bad "build-render.sh compiles without checking what it is compiling"
grep -q "wl_verify_source" "$HERE/launch-wonderland.sh" \
  && ok "the launcher states the source up front" \
  || bad "the launcher never states which commit it is building"
grep -q 'COMPILING \$BUILD_SHA' "$HERE/../build/build-wonderland.sh" \
  && ok "the full SHA is printed immediately before BuildEditor" \
  || bad "nothing prints the SHA at the compile"

GITROOT="$TMP/gitfix"
mkdir -p "$GITROOT"
( cd "$GITROOT" && git init -q upstream && cd upstream \
  && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m base \
  && git branch -M relay/wonderland-marble \
  && git -c user.email=t@t -c user.name=t commit -q --allow-empty -m more \
  && git branch relay/wonderland-ca-fixes ) >/dev/null 2>&1
git clone -q "$GITROOT/upstream" "$GITROOT/src" >/dev/null 2>&1
SRCSHA="$(git -C "$GITROOT/src" rev-parse HEAD)"

vs() {
  local br="$1"; shift
  env WL_ROOT="$TMP/wr" WL_SRC="$GITROOT/src" WL_BRANCH="$br" "$@" \
    bash -c ". $HERE/common.sh; wl_verify_source test" 2>&1
}
out="$(vs relay/wonderland-marble)"; rc=$?
if [ $rc = 0 ] && has "$out" "$SRCSHA"; then
  ok "wl_verify_source passes on the right branch and prints the FULL sha"
else bad "wl_verify_source rejected a correct checkout (rc=$rc)"; fi

out="$(vs relay/wonderland-ca-fixes)"; rc=$?
if [ $rc != 0 ] && has "$out" "not the branch that was asked for"; then
  ok "a checkout on the wrong branch is REFUSED, not reset"
else bad "the wrong branch was accepted (rc=$rc)"; fi

out="$(vs relay/wonderland-marble WL_REQUIRE_SHA=0000000000000000000000000000000000000000)"; rc=$?
if [ $rc != 0 ] && has "$out" "WL_REQUIRE_SHA"; then
  ok "an exact SHA pin that does not match is refused"
else bad "WL_REQUIRE_SHA was ignored (rc=$rc)"; fi

out="$(vs relay/wonderland-marble WL_REQUIRE_SHA="$SRCSHA")"; rc=$?
[ $rc = 0 ] && ok "...and a matching pin passes" || bad "a matching SHA pin was refused"

( cd "$GITROOT/src" && git reset -q --hard HEAD~1 ) >/dev/null 2>&1
out="$(vs relay/wonderland-marble)"; rc=$?
if [ $rc != 0 ] && has "$out" "is NOT the head"; then
  ok "a checkout behind origin's branch head is refused"
else bad "stale source was accepted (rc=$rc)"; fi
( cd "$GITROOT/src" && git reset -q --hard "$SRCSHA" ) >/dev/null 2>&1

rsb() {
  local br="$1"; shift
  env WL_ROOT="$TMP/wr" WL_SRC="$GITROOT/src" WL_BRANCH="$br" "$@" \
    bash -c ". $HERE/common.sh; wl_require_source_branch" 2>&1
}
out="$(rsb relay/wonderland-ca-fixes)"; rc=$?
if [ $rc != 0 ] && has "$out" "REFUSING TO SWITCH BRANCHES SILENTLY"; then
  ok "wl_require_source_branch refuses an unrequested switch"
else bad "a silent branch switch is still possible (rc=$rc)"; fi
out="$(rsb relay/wonderland-ca-fixes WL_ALLOW_BRANCH_SWITCH=1)"; rc=$?
[ $rc = 0 ] && ok "...and allows it when it is asked for" \
             || bad "WL_ALLOW_BRANCH_SWITCH=1 did not permit the switch"
out="$(rsb relay/wonderland-marble)"; rc=$?
[ $rc = 0 ] && ok "...and says nothing when the branch already matches" \
             || bad "the matching case was refused"

echo "== the CPU-only compile preflight =="
if bash -n "$HERE/compile-preflight.sh" 2>/dev/null; then ok "compile-preflight.sh parses"
else bad "compile-preflight.sh does not parse"; fi
if grep -qE 'wl_have_gpu[^"]*(\|\||&&)[^"]*(exit [0-9]|wl_die)' "$HERE/compile-preflight.sh"; then
  bad "the preflight refuses to run without a GPU"
else ok "the preflight does not require a GPU"; fi
# COMMENTS STRIPPED FIRST. The script explains at length why it does NOT pass
# --gpus, and a naive grep read its own explanation as the offence. A check
# that fails on the prose describing why it should pass is a check that gets
# deleted rather than fixed.
if sed 's/#.*//' "$HERE/compile-preflight.sh" | grep -q -- "--gpus"; then
  bad "the preflight asks docker for a GPU"
else ok "...and never asks docker for one"; fi
grep -q "BuildEditor" "$HERE/compile-preflight.sh" \
  && ok "it runs BuildEditor" || bad "it does not run BuildEditor"
# COMMENTS STRIPPED, for the same reason as the --gpus check above and for the
# THIRD time in this session: a grep over a whole file reads the file's own
# explanation of why it does not do the thing, and reports it as doing it.
# Checks that fire on their subject's prose get deleted, not fixed.
PF_CODE="$TMP/preflight-code.sh"
sed 's/#.*//' "$HERE/compile-preflight.sh" > "$PF_CODE"
for forbidden in BuildCookRun run-stream.sh pythonscript; do
  if grep -q "$forbidden" "$PF_CODE"; then
    bad "the preflight also does $forbidden — that is the GPU half"
  else ok "it does not $forbidden (that stays on the GPU path)"; fi
done
grep -q "AutomationTool exiting with ExitCode" "$HERE/compile-preflight.sh" \
  && ok "it treats a zero exit with a failed build as a failure" \
  || bad "it trusts UAT's exit code alone"
grep -q "SKIP_PREPARE" "$HERE/launch-wonderland.sh" \
  && ok "the launcher can skip work the CPU machine already did" \
  || bad "the GPU session has to redo the CPU preparation"

echo "== the generator's knobs cross the container boundary =="
# WONDERLAND_LOOK is the documented way to sweep the art LOOK table without
# editing code. It was never forwarded into the container, so every sweep in
# container mode silently did nothing — and an override that is ignored is
# worse than one that is unavailable, because the operator believes it applied.
for v in WONDERLAND_LOOK WONDERLAND_BATCH WONDERLAND_MARBLE_BACKDROP WONDERLAND_MARBLE_IMPORT WONDERLAND_COLLIDE; do
  n=$(grep -c -- "-e $v=" "$HERE/build-render.sh" || true)
  [ "${n:-0}" -ge 1 ] && ok "$v is forwarded into the container" \
    || bad "$v never reaches the generator in container mode"
  grep -q "$v=\"\${$v" "$HERE/build-render.sh" \
    && ok "  and the native path passes it too" \
    || bad "  the native path drops $v"
done

echo "== the Marble meshes are linked in from persistent storage =="
# They are 141 MB and 330 MB, they are NOT in git, and $WL_SRC is reset to
# origin on every prepare. A build that reaches the import step with a manifest
# pointing at a file that is not there has already spent the compile.
MT="$TMP/marble"; rm -rf "$MT"; mkdir -p "$MT/root/marble-assets/royal-garden-backdrop"
mkdir -p "$MT/root/src/wonderland/marble/worlds/royal-garden-backdrop"
cat > "$MT/root/src/wonderland/marble/worlds/royal-garden-backdrop/manifest.json" <<'MANIFEST'
{"assets": {"downloaded": {"hq_mesh_url": {"path": "assets/mesh_hq.glb"}}},
 "transform": {}}
MANIFEST
printf 'glTF-ish\n' > "$MT/root/marble-assets/royal-garden-backdrop/mesh_hq.glb"
# an assets directory with no manifest in the checkout: must be skipped, loudly
mkdir -p "$MT/root/marble-assets/orphan"
printf 'x\n' > "$MT/root/marble-assets/orphan/mesh_hq.glb"
mout="$(WL_ROOT="$MT/root" WL_SRC="$MT/root/src" bash -c '
  . '"$HERE"'/common.sh >/dev/null 2>&1
  WL_ROOT='"$MT"'/root WL_SRC='"$MT"'/root/src wl_link_marble_assets' 2>&1 || true)"
lnk="$MT/root/src/wonderland/marble/worlds/royal-garden-backdrop/assets/mesh_hq.glb"
if [ -L "$lnk" ] && [ -e "$lnk" ]; then
  ok "wl_link_marble_assets links the mesh into the checkout, and it resolves"
else
  bad "the Marble mesh was not linked ($lnk)"
fi
case "$mout" in *orphan*) ok "an asset directory with no manifest is reported, not linked silently" ;;
  *) bad "the orphan asset directory was passed over without a word" ;; esac
[ -e "$MT/root/src/wonderland/marble/worlds/orphan" ] \
  && bad "it invented a world directory for the orphan" \
  || ok "…and no world directory was invented for it"
# Idempotent: prepare runs it every time, and a second run must not fail or
# stack symlinks-to-symlinks.
WL_ROOT="$MT/root" WL_SRC="$MT/root/src" bash -c '
  . '"$HERE"'/common.sh >/dev/null 2>&1
  WL_ROOT='"$MT"'/root WL_SRC='"$MT"'/root/src wl_link_marble_assets' >/dev/null 2>&1 \
  && ok "…and running it twice is safe" || bad "a second link pass failed"
grep -q 'wl_link_marble_assets' "$HERE/prepare.sh" \
  && ok "prepare.sh links them after the checkout is reset" \
  || bad "prepare.sh never links the Marble assets, so a fresh checkout has none"
grep -q 'wl_link_marble_assets' "$HERE/build-render.sh" \
  && ok "build-render.sh links them too, for sessions that skipped prepare" \
  || bad "SKIP_PREPARE=1 would reach the import with no mesh on disk"

echo "== the build refuses before it compiles if the mesh is missing =="
grep -q 'resolve-mesh.py' "$HERE/build-render.sh" \
  && ok "the preflight resolves the mesh through the importer's own chooser" \
  || bad "build-render.sh does not preflight the Marble mesh"
if sed 's/#.*//' "$HERE/build-render.sh" | grep -q 'hq_mesh_url'; then
  bad "build-render.sh re-implements the mesh choice instead of calling the importer"
else
  ok "…and does not carry a second copy of the selection rule"
fi
rm -f "$lnk"
if bad_out="$(cd "$MT" && python3 "$HERE/../../marble/resolve-mesh.py" \
      --slug royal-garden-backdrop \
      --root "$MT/root/src/wonderland/marble/worlds" 2>&1)"; then
  bad "resolve-mesh.py reported success with no mesh on disk"
else
  case "$bad_out" in *"no visual mesh resolves"*)
      ok "resolve-mesh.py fails closed and says the mesh does not resolve" ;;
    *) bad "resolve-mesh.py failed for an unexplained reason: $bad_out" ;;
  esac
fi

# A half-written manifest is a real state — an interrupted fetch leaves one —
# and a preflight that answers it with a traceback is not actionable.
: > "$MT/root/src/wonderland/marble/worlds/royal-garden-backdrop/manifest.json"
if bad_out="$(python3 "$HERE/../../marble/resolve-mesh.py" \
      --slug royal-garden-backdrop \
      --root "$MT/root/src/wonderland/marble/worlds" 2>&1)"; then
  bad "an empty manifest was accepted"
else
  case "$bad_out" in *"not readable JSON"*)
      ok "an unreadable manifest gets a sentence, not a stack trace" ;;
    *) bad "an empty manifest produced: $bad_out" ;;
  esac
fi

echo "== the packaged world reports the Marble layer =="
# The importer's log proves what the EDITOR did. This proves what the COOK
# shipped — a different fact, and the one that matters when a stream is running.
PROOF="$HERE/../../Source/Wonderland/WonderlandWorldProof.cpp"
IMPORTER="$HERE/../../marble/import-marble-world.py"
py_tag="$(sed -n 's/^MARBLE_TAG = "\(.*\)"$/\1/p' "$IMPORTER")"
[ -n "$py_tag" ] && ok "the importer names its tag once (MARBLE_TAG=$py_tag)" \
  || bad "could not find MARBLE_TAG in the importer"
grep -q "TEXT(\"$py_tag\")" "$PROOF" \
  && ok "the C++ proof matches that exact tag, so it cannot drift silently" \
  || bad "WonderlandWorldProof.cpp does not look for '$py_tag' — the proof would report the backdrop absent from a world that has it"
grep -q 'MARBLE_ACTORS=%d' "$PROOF" \
  && ok "the packaged world reports how many Marble actors it shipped" \
  || bad "nothing proves the backdrop survived the cook"
grep -q 'IsTwoSided' "$PROOF" \
  && ok "…and whether the shell is two-sided, which is its one silent failure" \
  || bad "single-sided is the way this import looks like a success and shows nothing"
grep -q 'ECollisionEnabled::NoCollision' "$PROOF" \
  && ok "…and that Marble geometry is not blocking anything" \
  || bad "the collision boundary is trusted from a log instead of checked in the world"

echo "== collision is measured, not asserted =="
# DONE-WHEN says "collision/gameplay works" and nothing in this repository had
# ever checked it. Every visual piece is an instance in a NoCollision batch, so
# the question has a real answer and it had never been read.
PROOF="$HERE/../../Source/Wonderland/WonderlandWorldProof.cpp"
BATCH="$HERE/../../Source/Wonderland/WonderlandInstancedBatch.cpp"
grep -q 'RUNTIME_BLOCKING_PRIMITIVES=%d' "$PROOF" \
  && ok "the packaged world counts what actually blocks a pawn" \
  || bad "nothing measures whether this world has any collision at all"
grep -q 'RUNTIME_GROUNDED_DOGS' "$PROOF" \
  && ok "…and traces for ground under every Relay Dog" \
  || bad "no ground check under the Dogs"
grep -q 'RUNTIME_GROUNDED_PLAYER_STARTS' "$PROOF" \
  && ok "…and under every PlayerStart" \
  || bad "no ground check under the spawn"
grep -q 'ECC_Pawn' "$PROOF" \
  && ok "…on the PAWN channel, which is the question movement actually asks" \
  || bad "the trace uses a channel the movement system does not"
grep -q 'RUNTIME_WORLD_HAS_NO_GAMEPLAY_COLLISION' "$PROOF" \
  && ok "a world nothing can be stood on says so out loud" \
  || bad "a collisionless world would report as healthy"
# THE SWITCH, not a decision made for the founder. Default off = every build
# this project has made; naming materials makes the other choice measurable in
# one build with no code change.
GEN="$HERE/../build/generate-hub-level.py"
BATCHH="$HERE/../../Source/Wonderland/WonderlandInstancedBatch.h"
grep -q 'WONDERLAND_COLLIDE' "$GEN" \
  && ok "the generator takes a collision material list from the environment" \
  || bad "collision cannot be turned on without editing code"
grep -q 'bCollides' "$BATCHH" \
  && ok "the batch carries a per-batch collision switch" \
  || bad "collision would have to be all-or-nothing across 33,000 instances"
python3 - "$GEN" <<'PY'
import io, re, sys
src = io.open(sys.argv[1], encoding="utf8").read()
problems = []
# Default OFF. An empty WONDERLAND_COLLIDE must yield an empty set, so an
# unset variable can never quietly turn collision on for everything.
if 'os.environ.get("WONDERLAND_COLLIDE", "")' not in src:
    problems.append("no empty default for WONDERLAND_COLLIDE")
# It has to be part of the BATCH KEY, or one colliding piece would make every
# piece sharing its mesh and material collide too.
if not re.search(r"def _batch_key\(mesh_path, mat_path, cast_shadow, collides\)", src):
    problems.append("collides is not part of the batch key")
if "COLLIDING_PIECES" not in src:
    problems.append("the generator does not report how many pieces collide")
sys.exit(0 if not problems else (print(problems) or 1))
PY
check_collide=$?
[ "$check_collide" = 0 ] && ok "…defaulting to OFF, keyed per batch, and counted" \
  || bad "the collision switch is not safely defaulted or not keyed"

# The stale claim that started this: the batch file said other Unreal geometry
# was the collision authority. There is none.
if grep -q "remain the authority" "$BATCH"; then
  bad "WonderlandInstancedBatch.cpp still claims geometry that does not exist owns collision"
else
  ok "the batch no longer claims a collision authority that does not exist"
fi

echo "== the opt-in full CPU build =="
if bash -n "$HERE/cpu-build-all.sh" 2>/dev/null; then ok "cpu-build-all.sh parses"
else bad "cpu-build-all.sh does not parse"; fi
CB_CODE="$TMP/cpu-build-code.sh"
sed 's/#.*//' "$HERE/cpu-build-all.sh" > "$CB_CODE"
if grep -q -- "--gpus" "$CB_CODE"; then bad "the full CPU build asks docker for a GPU"
else ok "the full CPU build never asks docker for a GPU"; fi
grep -q "nullrhi" "$CB_CODE" \
  && ok "it runs the level generator headless (-nullrhi)" \
  || bad "it generates the level without disabling rendering"
# The stream needs NVENC and cannot move. A CPU script that started one would
# be claiming something Epic's own hardware requirements rule out.
if grep -q "run-stream.sh" "$CB_CODE"; then
  bad "the CPU build tries to start the stream, which needs NVENC"
else ok "it does not try to stream (that needs NVENC and cannot move)"; fi
grep -q "INSTANCED_PIECES" "$CB_CODE" \
  && ok "it reports what the headless generation actually produced" \
  || bad "it does not check whether headless generation made a world"
# -nullrhi must be OPT-IN in the shared build script, not the default: the
# generator creates materials and imports textures, and this project has a
# record of editor features behaving differently headless.
grep -q 'WL_GENERATOR_EXTRA' "$HERE/../build/build-wonderland.sh" \
  && ok "build-wonderland.sh takes generator flags from the caller" \
  || bad "the generator invocation is not parameterised"
if sed 's/#.*//' "$HERE/../build/build-wonderland.sh" | grep -q 'nullrhi'; then
  bad "-nullrhi is baked into the shared build path instead of opted into"
else ok "...and -nullrhi is not the default there"; fi

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ]
