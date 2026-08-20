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
  rm -rf "$TMP/ps"; mkdir -p "$TMP/ps/SignallingWebServer/platform_scripts/bash"
  [ "$1" = none ] || printf 'NODE_VERSION=v22.14.0\nDOWNLOAD_VERSION=%s\n' "$1" \
    > "$TMP/ps/SignallingWebServer/platform_scripts/bash/common.sh"
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

echo "== the version parser reads every real declaration form =="
# THE REAL LIGHTNING CHECKOUT BROKE THE FIRST PARSER. Its file plainly read
# UE5.8 and the helper extracted nothing, so wl_ps_status said WRONG_VERSION
# for a correct checkout and stage 5 would have failed closed on a healthy
# machine. A gate that blocks the good case is not stricter, it is broken —
# and it is the worse direction to fail in, because it burns a GPU session
# proving something that was already right.
vform() {   # $1 = description, $2 = the literal declaration line
  rm -rf "$TMP/vf"; mkdir -p "$TMP/vf"
  printf '%s\n' "$2" > "$TMP/vf/common.sh"
  local got
  got="$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/vf" bash -c ". $HERE/common.sh; wl_ps_version" 2>/dev/null)"
  check "$got" "UE5.8" "parses $1"
}
vform "a bare value"            'DOWNLOAD_VERSION=UE5.8'
vform "a double-quoted value"   'DOWNLOAD_VERSION="UE5.8"'
vform "a single-quoted value"   "DOWNLOAD_VERSION='UE5.8'"
vform "an exported value"       'export DOWNLOAD_VERSION=UE5.8'
vform "an indented value"       '   DOWNLOAD_VERSION=UE5.8'
vform "an overridable default"  'DOWNLOAD_VERSION=${DOWNLOAD_VERSION:-UE5.8}'
vform "a set-if-unset default"  ': ${DOWNLOAD_VERSION:=UE5.8}'
vform "a trailing comment"      'DOWNLOAD_VERSION=UE5.8   # the branch'
vform "quoted and exported"     'export DOWNLOAD_VERSION="UE5.8"'

# CRLF: a checkout that has been through a Windows tool leaves \r on the value,
# and 'UE5.8\r' != 'UE5.8' — an exact match would reject it for an invisible
# reason, which is the hardest kind of failure to diagnose on a paid machine.
rm -rf "$TMP/vf"; mkdir -p "$TMP/vf"; printf 'DOWNLOAD_VERSION=UE5.8\r\n' > "$TMP/vf/common.sh"
check "$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/vf" bash -c ". $HERE/common.sh; wl_ps_version")" \
  "UE5.8" "parses a CRLF file"

# A COMMENT IS NOT A DECLARATION. The infrastructure's own docs mention
# DOWNLOAD_VERSION; matching one would give a confident wrong answer.
rm -rf "$TMP/vf"; mkdir -p "$TMP/vf"
printf '# DOWNLOAD_VERSION names the branch\nDOWNLOAD_VERSION=UE5.8\n' > "$TMP/vf/common.sh"
check "$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/vf" bash -c ". $HERE/common.sh; wl_ps_version")" \
  "UE5.8" "skips a comment mentioning DOWNLOAD_VERSION"

# AND IT MUST STILL FAIL OPEN FOR NOBODY. Tolerating more forms must not make
# a wrong branch parse as the right one.
for wrong in 'DOWNLOAD_VERSION="UE5.5"' 'export DOWNLOAD_VERSION=UE5.4' 'DOWNLOAD_VERSION=${DOWNLOAD_VERSION:-UE5.6}'; do
  rm -rf "$TMP/vf"; mkdir -p "$TMP/vf"; printf '%s\n' "$wrong" > "$TMP/vf/common.sh"
  got="$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/vf" bash -c ". $HERE/common.sh; wl_ps_version")"
  if [ "$got" = "UE5.8" ] || [ -z "$got" ]; then
    bad "a wrong branch parsed as '$got' from: $wrong"
  else
    ok "a wrong branch is still read correctly ($got)"
  fi
  st="$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/vf" bash -c ". $HERE/common.sh; mkdir -p \$WL_PS_INFRA/SignallingWebServer/dist \$WL_PS_INFRA/SignallingWebServer/www; wl_ps_status")"
  check "$st" "WRONG_VERSION" "  and a built checkout on it is rejected"
done

# THE DIAGNOSIS PATH. An extraction bug and a wrong branch both land on
# WRONG_VERSION and need opposite responses from the founder, so the raw line
# has to be printed.
rm -rf "$TMP/vf"; mkdir -p "$TMP/vf/SignallingWebServer/dist" "$TMP/vf/SignallingWebServer/www"
printf 'DOWNLOAD_VERSION="UE5.5"\n' > "$TMP/vf/common.sh"
out=$(WL_ROOT="$TMP/root" WL_PS_INFRA="$TMP/vf" \
      bash -c ". $HERE/common.sh; wl_require_ps_infra" 2>&1); rc=$?
[ "$rc" != "0" ] && ok "a wrong branch still fails closed" || bad "a wrong branch was accepted"
has "$out" 'DOWNLOAD_VERSION="UE5.5"' && ok "  and the raw declaration line is shown" \
  || bad "  the failure does not show what it actually found"

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

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ]
