#!/usr/bin/env bash
# Regression tests for build-wonderland.sh's INPUT HANDLING.
#
# These exist because of a real failure on a paid L4. The build reached
#
#     [build-wonderland] engine at /home/ue4/UnrealEngine reports version 5.8
#
# and exited to the shell. build.log contained that single line and nothing
# else — no error, no signature, no clue.
#
# The cause: `find` was handed four input paths unconditionally, one of them
# `Config/`, which this project does not have. find exited nonzero, its stderr
# went to /dev/null, `set -o pipefail` propagated the status to the enclosing
# command substitution, and `set -e` killed the script silently.
#
# Everything below runs against STUBS: a fake project tree and a fake engine.
# No Unreal, no GPU, no network.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0
ok()   { echo "  ok   $*"; PASS=$((PASS + 1)); }
bad()  { echo "  FAIL $*"; FAIL=$((FAIL + 1)); }
# Substring matching WITHOUT a pipe: `printf | grep -q` under pipefail reports
# the writer's SIGPIPE as a failure and inverts the assertion.
has()  { case "$1" in *"$2"*) return 0 ;; *) return 1 ;; esac; }

# ---------------------------------------------------------------- fixtures
# A fake wonderland/ tree with the script at infra/build/, because the script
# derives PROJECT_ROOT from its own location.
make_project() {   # $1 = root; $2 = "with-config" | "no-config"
  local r="$1"
  rm -rf "$r"
  mkdir -p "$r/infra/build" "$r/Source/Wonderland" "$r/WorldDesign"
  cp "$HERE/build-wonderland.sh" "$r/infra/build/"
  printf '{}\n'            > "$r/Wonderland.uproject"
  printf 'void WonderlandFixture(){}\n' > "$r/Source/Wonderland/a.cpp"
  printf '{"a":1}\n'       > "$r/WorldDesign/hub-layout.json"
  printf '# stub\n'        > "$r/infra/build/generate-hub-level.py"
  if [ "$2" = "with-config" ]; then
    mkdir -p "$r/Config"
    printf '[/Script/Engine]\n' > "$r/Config/DefaultEngine.ini"
  fi
}

# A fake UE 5.8 install: version file, RunUAT, editor-cmd.
make_engine() {   # $1 = root
  local e="$1"
  rm -rf "$e"
  mkdir -p "$e/Engine/Build/BatchFiles" "$e/Engine/Binaries/Linux"
  cat > "$e/Engine/Build/Build.version" <<'JSON'
{ "MajorVersion": 5, "MinorVersion": 8, "PatchVersion": 1 }
JSON
  cat > "$e/Engine/Build/BatchFiles/RunUAT.sh" <<'UAT'
#!/bin/sh
echo "stub UAT: $*"
# BuildCookRun must leave something staged or the script rightly refuses
for a in "$@"; do
  case "$a" in
    -archivedirectory=*) mkdir -p "${a#-archivedirectory=}/Linux"
                         : > "${a#-archivedirectory=}/Linux/Wonderland.sh" ;;
  esac
done
exit 0
UAT
  chmod +x "$e/Engine/Build/BatchFiles/RunUAT.sh"
  printf '#!/bin/sh\necho "stub editor: $*"\nexit 0\n' > "$e/Engine/Binaries/Linux/UnrealEditor-Cmd"
  chmod +x "$e/Engine/Binaries/Linux/UnrealEditor-Cmd"
}

run_build() {   # $1 = project root
  UE_ROOT="$TMP/ue" OUT="$TMP/out" FORCE_REBUILD=1 \
    bash "$1/infra/build/build-wonderland.sh" 2>&1
}

make_engine "$TMP/ue"

echo "== the exact L4 failure: Config/ absent =="
make_project "$TMP/p" no-config
rm -rf "$TMP/out"
out="$(run_build "$TMP/p")"; rc=$?
if [ "$rc" -eq 0 ]; then ok "the build completes with no Config/ directory"
else bad "the build failed with no Config/ (exit $rc)"; fi
# THE regression: it must get PAST the version banner, which is where it died.
has "$out" "reports version 5.8" && ok "it reports the engine version" \
  || bad "it never reached the version pin"
has "$out" "input content hash:" && ok "it reaches the input content hash" \
  || bad "SILENT EXIT AFTER THE VERSION LINE — the original bug is back"
has "$out" "step: build-editor" && ok "it reaches the first engine step" \
  || bad "it never reached build-editor"
has "$out" "optional build input absent" && ok "it says the optional input was skipped" \
  || bad "it skipped Config/ without saying so"

echo "== an optional input that IS present is hashed =="
make_project "$TMP/p2" with-config
rm -rf "$TMP/out"
out2="$(run_build "$TMP/p2")"; rc=$?
check_hash() { case "$1" in *"input content hash: "*) echo "${1#*input content hash: }" | head -1 ;; esac; }
h_with="$(check_hash "$out2")"
rm -rf "$TMP/out"
out3="$(run_build "$TMP/p" )"
h_without="$(check_hash "$out3")"
if [ -n "$h_with" ] && [ -n "$h_without" ] && [ "$h_with" != "$h_without" ]; then
  ok "Config/ changes the hash when present, so it is genuinely included"
else
  bad "the hash did not change with Config/ present (with='$h_with' without='$h_without')"
fi

echo "== a missing REQUIRED input fails loudly, never silently =="
for req in "Wonderland.uproject" "Source" "WorldDesign"; do
  make_project "$TMP/pr" no-config
  rm -rf "$TMP/pr/$req" "$TMP/out"
  out="$(run_build "$TMP/pr")"; rc=$?
  if [ "$rc" -eq 0 ]; then
    bad "removing $req did not fail the build"
  else
    ok "removing $req fails the build (exit $rc)"
  fi
  # NAME THE PATH, not just "something is wrong". Mutation-testing caught this
  # assertion being satisfied by `die`'s generic closing message, so deleting
  # the per-path ERROR line still passed. An operator on a rented GPU needs to
  # know WHICH input is missing, not that one of three is.
  # NAME THE PATH. Two guards can catch these — the preflight (`project not
  # found`, `Source/ not found`) and validate_build_inputs (`required build
  # input missing`) — and asserting one exact phrasing rejects the other while
  # proving nothing extra. What actually matters to someone on a rented GPU is
  # that an ERROR appears AND says which input is missing. Asserting only
  # "ERROR" is too weak: mutation-testing showed `die`'s generic closing line
  # satisfies it with the per-path message deleted.
  if has "$out" "ERROR" && has "$out" "$req"; then
    ok "  and it names $req in an explicit ERROR"
  else
    bad "  $req went missing without being named — a silent or vague exit"
  fi
done

echo "== version_field cannot silently kill the build =="
# Its own comment promises "prints nothing on miss". Under set -euo pipefail the
# original could not keep that promise: a missing Build.version exits the script.
make_project "$TMP/pv" no-config
rm -f "$TMP/ue/Engine/Build/Build.version"
rm -rf "$TMP/out"
out="$(run_build "$TMP/pv")"; rc=$?
has "$out" "input content hash:" \
  && ok "a missing Build.version does not stop the build" \
  || bad "a missing Build.version silently killed the build"
has "$out" "cannot assert" && ok "  and it warns that the version pin was skipped" \
  || bad "  it proceeded without saying the pin was skipped"
# restore for later cases
make_engine "$TMP/ue"

echo "== an unparseable Build.version warns rather than exits =="
make_project "$TMP/pw" no-config
printf 'not json at all\n' > "$TMP/ue/Engine/Build/Build.version"
rm -rf "$TMP/out"
out="$(run_build "$TMP/pw")"; rc=$?
has "$out" "input content hash:" \
  && ok "an unparseable version file does not stop the build" \
  || bad "an unparseable version file silently killed the build"
make_engine "$TMP/ue"

echo "== the wrong engine version is still a hard gate =="
make_project "$TMP/px" no-config
cat > "$TMP/ue/Engine/Build/Build.version" <<'JSON'
{ "MajorVersion": 5, "MinorVersion": 4 }
JSON
rm -rf "$TMP/out"
out="$(run_build "$TMP/px")"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "!= required"; then
  ok "engine 5.4 is refused with an explicit message"
else
  bad "the version pin did not refuse 5.4 (exit $rc)"
fi
make_engine "$TMP/ue"

# ---------------------------------------------------------------------------
# THE DECORATION MUST REACH THE MAP
#
# The world's visual geometry now lives as instances inside
# AWonderlandInstancedBatch actors. If that class is missing from the editor
# binary the generator places NOTHING and saves a valid, cookable, streamable
# map containing lights, markers and Dogs in an empty field — and every later
# step reports success. These three cases are the only thing between that and a
# founder finding out by looking at a browser.
echo
echo "== a world whose decoration never reached disk is refused =="

stub_editor_says() {   # $1 = engine root, $2... = lines the stub prints
  local e="$1"; shift
  {
    printf '#!/bin/sh\n'
    for line in "$@"; do printf 'echo "%s"\n' "$line"; done
    printf 'exit 0\n'
  } > "$e/Engine/Binaries/Linux/UnrealEditor-Cmd"
  chmod +x "$e/Engine/Binaries/Linux/UnrealEditor-Cmd"
}

make_project "$TMP/pb" with-config
stub_editor_says "$TMP/ue" "BATCHES=144  INSTANCED_PIECES=31996" \
                           "LIFECYCLE saved=True actors=256 level=/Game/Wonderland/Maps/WonderlandHub"
rm -rf "$TMP/out"
out="$(run_build "$TMP/pb")"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "31996 instanced pieces"; then
  ok "a full world passes and the piece count is reported"
else
  bad "a full world was refused (exit $rc)"
fi

stub_editor_says "$TMP/ue" "BATCHES=3  INSTANCED_PIECES=12" \
                           "LIFECYCLE saved=True actors=20 level=/Game/Wonderland/Maps/WonderlandHub"
rm -rf "$TMP/out"
out="$(run_build "$TMP/pb")"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "instanced pieces (floor"; then
  ok "a nearly-empty world is refused before the cook"
else
  bad "12 pieces was cooked anyway (exit $rc)"
fi

stub_editor_says "$TMP/ue" "LIFECYCLE saved=True actors=256 level=/Game/Wonderland/Maps/WonderlandHub"
rm -rf "$TMP/out"
out="$(run_build "$TMP/pb")"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "reported no INSTANCED_PIECES"; then
  ok "a generator that finished without batching anything is refused"
else
  bad "a run with no batch report was cooked anyway (exit $rc)"
fi

WONDERLAND_BATCH=0 rm -rf "$TMP/out"
out="$(WONDERLAND_BATCH=0 run_build "$TMP/pb")"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "UNBATCHED"; then
  ok "WONDERLAND_BATCH=0 is allowed through, and says which architecture it built"
else
  bad "the deliberate unbatched build was refused (exit $rc)"
fi

# A stubbed editor that prints nothing at all is not evidence of an empty world
# — it is a harness. Treating "no evidence" as "zero pieces" would fail every
# harnessed build while looking like a safety check.
make_engine "$TMP/ue"
rm -rf "$TMP/out"
out="$(run_build "$TMP/pb")"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "did not really run"; then
  ok "a stubbed editor is not mistaken for an empty world"
else
  bad "the silent-stub case was misjudged (exit $rc)"
fi

# ------------------------------------------------------- the Marble layer step
#
# The failure mode being guarded: a python exception under -run=pythonscript
# does NOT reliably fail the process, so the import step can exit 0 having
# imported nothing, saved nothing, or saved a world with no backdrop in it —
# and the cook, the package and the stream all succeed afterwards. The only
# evidence is what the importer prints, so the build has to read it.
echo "== the Marble visual layer =="

# An editor stub that speaks the importer's report lines on demand. It answers
# only when it is handed the Marble script, so the level-generation step is
# unaffected and stays silent exactly as before.
make_marble_engine() {   # $1 = engine root; $2 = what the importer "prints"
  make_engine "$1"
  cat > "$1/Engine/Binaries/Linux/UnrealEditor-Cmd" <<STUB
#!/bin/sh
echo "stub editor: \$*"
case "\$*" in
  *import-marble-world*) printf '%s\n' '$2' ;;
esac
exit 0
STUB
  chmod +x "$1/Engine/Binaries/Linux/UnrealEditor-Cmd"
}

# The world fixture the step insists on before it will spend a build on it.
make_marble_world() {   # $1 = project root; $2 = slug
  mkdir -p "$1/marble/worlds/$2"
  printf '# stub importer\n' > "$1/marble/import-marble-world.py"
  printf '{"transform":{}}\n' > "$1/marble/worlds/$2/manifest.json"
}

SLUG=royal-garden-backdrop

make_project "$TMP/pm" no-config
make_marble_world "$TMP/pm" "$SLUG"
make_marble_engine "$TMP/ue" "[marble] MARBLE_VISUAL_ACTORS=1  MARBLE_COLLIDER_REFERENCES=1
[marble] MARBLE_LEVEL_SAVED=1  (/Game/Wonderland/Maps/WonderlandHub)"
rm -rf "$TMP/out"
out="$(WONDERLAND_MARBLE_IMPORT="$SLUG" run_build "$TMP/pm")"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "Marble visual layer: 1 actor"; then
  ok "an import that places actors and saves the level is accepted, and counted"
else
  bad "the good Marble path was rejected (exit $rc)"
fi
has "$out" "step: import-marble-world" && ok "the import runs as its own build step" \
  || bad "the import step never ran"

# ORDER. Generation rewrites the map from a blank one, so anything imported
# before it is overwritten without a word.
gen_at="$(printf '%s\n' "$out" | grep -n "step: generate-hub-level" | head -1 | cut -d: -f1)"
imp_at="$(printf '%s\n' "$out" | grep -n "step: import-marble-world" | head -1 | cut -d: -f1)"
if [ -n "$gen_at" ] && [ -n "$imp_at" ] && [ "$gen_at" -lt "$imp_at" ]; then
  ok "the Marble import runs AFTER level generation, which rewrites the map"
else
  bad "import/generation order is wrong (gen=$gen_at import=$imp_at)"
fi

rm -rf "$TMP/out"
out="$(run_build "$TMP/pm")"; rc=$?
if [ "$rc" -eq 0 ] && has "$out" "Marble visual layer: off"; then
  ok "with no slug the step is off, and says so rather than being invisible"
else
  bad "the default (no Marble) path changed (exit $rc)"
fi
has "$out" "step: import-marble-world" && bad "the import ran without being asked" \
  || ok "…and the importer is not run"

echo "== a Marble import that did not really happen fails the build =="
make_marble_engine "$TMP/ue" "[marble] nothing useful"
rm -rf "$TMP/out"
out="$(WONDERLAND_MARBLE_IMPORT="$SLUG" run_build "$TMP/pm")"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "no MARBLE_VISUAL_ACTORS line"; then
  ok "an importer that printed no report fails the build (exit 0 is not evidence)"
else
  bad "a silent importer was accepted (exit $rc)"
fi

make_marble_engine "$TMP/ue" "[marble] MARBLE_VISUAL_ACTORS=0  MARBLE_COLLIDER_REFERENCES=0
[marble] MARBLE_LEVEL_SAVED=1  (/Game/Wonderland/Maps/WonderlandHub)"
rm -rf "$TMP/out"
out="$(WONDERLAND_MARBLE_IMPORT="$SLUG" run_build "$TMP/pm")"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "placed 0 visual actors"; then
  ok "zero placed actors fails the build"
else
  bad "an empty Marble layer was cooked (exit $rc)"
fi

make_marble_engine "$TMP/ue" "[marble] MARBLE_VISUAL_ACTORS=1  MARBLE_COLLIDER_REFERENCES=0
[marble] MARBLE_LEVEL_SAVED=0  (/Game/Wonderland/Maps/WonderlandHub)"
rm -rf "$TMP/out"
out="$(WONDERLAND_MARBLE_IMPORT="$SLUG" run_build "$TMP/pm")"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "WITHOUT the backdrop"; then
  ok "actors placed but the level unsaved fails — that cook would ship no backdrop"
else
  bad "an unsaved Marble layer was cooked (exit $rc)"
fi

echo "== the Marble step refuses before it wastes a build =="
make_marble_engine "$TMP/ue" "[marble] MARBLE_VISUAL_ACTORS=1
[marble] MARBLE_LEVEL_SAVED=1"
make_project "$TMP/pn" no-config
mkdir -p "$TMP/pn/marble"
printf '# stub importer\n' > "$TMP/pn/marble/import-marble-world.py"   # importer present, world absent
rm -rf "$TMP/out"
out="$(WONDERLAND_MARBLE_IMPORT="$SLUG" run_build "$TMP/pn")"; rc=$?
if [ "$rc" -ne 0 ] && has "$out" "no Marble manifest for"; then
  ok "a slug with no manifest refuses, naming the path it looked at"
else
  bad "a missing manifest did not refuse (exit $rc)"
fi

echo "== the slug is part of the build identity =="
# Two builds that differ only by which world is imported must NOT reuse each
# other's stamp. This project already shipped two 'different' lighting builds
# that were the same binary because a generator knob was outside the hash.
make_marble_engine "$TMP/ue" "[marble] MARBLE_VISUAL_ACTORS=1
[marble] MARBLE_LEVEL_SAVED=1"
hash_of() { case "$1" in *"input content hash: "*) echo "${1#*input content hash: }" | head -1 ;; esac; }
rm -rf "$TMP/out"
h_off="$(hash_of "$(run_build "$TMP/pm")")"
rm -rf "$TMP/out"
h_on="$(hash_of "$(WONDERLAND_MARBLE_IMPORT="$SLUG" run_build "$TMP/pm")")"
if [ -n "$h_off" ] && [ -n "$h_on" ] && [ "$h_off" != "$h_on" ]; then
  ok "WONDERLAND_MARBLE_IMPORT changes the input hash, so it cannot reuse a stale package"
else
  bad "the Marble slug is outside the build hash (off='$h_off' on='$h_on')"
fi

make_engine "$TMP/ue"

echo
echo "== editing the generator has to invalidate the build =="
# The hash covered Wonderland.uproject, Source/, Config/ and WorldDesign/ -- and
# not generate-hub-level.py, the program that decides what is IN the world. A
# change to it reported "inputs unchanged since the last successful package",
# reused the previous package, and printed BUILT AND PACKAGED against the new
# SHA while every stage log still carried the previous build's timestamps.
make_project "$TMP/hash" plain 2>/dev/null || make_project "$TMP/hash"
rm -rf "$TMP/out"
h_before="$(hash_of "$(run_build "$TMP/hash")")"
# The generator INSIDE the fixture, because run_build executes the fixture's own
# copy of build-wonderland.sh and it resolves its inputs relative to itself. My
# first version of this probe edited the repo's real generator, which that build
# never reads — so it measured nothing and reported the code broken.
GEN_REAL="$TMP/hash/infra/build/generate-hub-level.py"
cp "$GEN_REAL" "$TMP/gen.bak"
printf '\n# hash-invalidation probe %s\n' "$$" >> "$GEN_REAL"
rm -rf "$TMP/out"
h_after="$(hash_of "$(run_build "$TMP/hash")")"
cp "$TMP/gen.bak" "$GEN_REAL"
if [ -n "$h_before" ] && [ -n "$h_after" ] && [ "$h_before" != "$h_after" ]; then
  ok "editing generate-hub-level.py changes the input hash"
else
  bad "the generator is outside the build hash (before='$h_before' after='$h_after')"
fi
rm -rf "$TMP/out"
h_restored="$(hash_of "$(run_build "$TMP/hash")")"
if [ "$h_restored" = "$h_before" ]; then
  ok "…and restoring it returns the original hash, so the probe measured the file"
else
  bad "the hash did not return after restoring the generator"
fi
# The Marble manifest is an input too: the importer places from it and the
# generator derives the backdrop switch from it.
MAN_DIR="$TMP/hash/marble/worlds/probe-world"
mkdir -p "$MAN_DIR"
printf '{"marble_world_id":"probe"}\n' > "$MAN_DIR/manifest.json"
rm -rf "$TMP/out"
h_man="$(hash_of "$(run_build "$TMP/hash")")"
if [ -n "$h_man" ] && [ "$h_man" != "$h_before" ]; then
  ok "…and adding a Marble world manifest changes it too"
else
  bad "the Marble manifests are outside the build hash"
fi
printf '{"marble_world_id":"probe","edited":true}\n' > "$MAN_DIR/manifest.json"
rm -rf "$TMP/out"
h_man2="$(hash_of "$(run_build "$TMP/hash")")"
if [ -n "$h_man2" ] && [ "$h_man2" != "$h_man" ]; then
  ok "…and EDITING one changes it again, so content is hashed and not just presence"
else
  bad "manifest contents are not hashed, only their existence"
fi
# The IMPORTER is a build input too, and lives one directory over from the
# generator — which is exactly why the first version of this list missed it.
mkdir -p "$TMP/hash/marble"
printf '# stub importer\n' > "$TMP/hash/marble/import-marble-world.py"
rm -rf "$TMP/out"; h_imp="$(hash_of "$(run_build "$TMP/hash")")"
printf '# stub importer, edited\n' > "$TMP/hash/marble/import-marble-world.py"
rm -rf "$TMP/out"; h_imp2="$(hash_of "$(run_build "$TMP/hash")")"
if [ -n "$h_imp2" ] && [ "$h_imp" != "$h_imp2" ]; then
  ok "…and editing import-marble-world.py changes the hash"
else
  bad "the Marble importer is outside the build hash"
fi
rm -rf "$TMP/hash/marble"
# "unset" and "0" must be different inputs: unset now means DERIVE.
rm -rf "$TMP/out"; h_unset="$(hash_of "$(run_build "$TMP/hash")")"
rm -rf "$TMP/out"; h_zero="$(hash_of "$(WONDERLAND_MARBLE_BACKDROP=0 run_build "$TMP/hash")")"
if [ -n "$h_zero" ] && [ "$h_unset" != "$h_zero" ]; then
  ok "an unset backdrop knob hashes differently from an explicit 0"
else
  bad "unset and 0 collapse to the same hash, so one build can be reused for the other"
fi

echo
echo "== Unreal Build Accelerator is off, and provably off in BOTH steps =="
# UBA turned the L4 editor build into a crash loop: 143,340 SIGSEGV traces from
# its filesystem interception, 0 compiler errors, 3 of 13 actions in 35 minutes.
# Nothing failed — it just never finished, which on a metered GPU is worse. The
# flag has to reach BOTH UAT commands; disabling it for the editor build only
# would look fixed right up until the cook.
make_project "$TMP/uba" plain 2>/dev/null || make_project "$TMP/uba"
rm -rf "$TMP/out"
uba_out="$(run_build "$TMP/uba")"
editor_line="$(printf '%s' "$uba_out" | grep -a 'stub UAT:' | grep -a 'BuildEditor' | head -1)"
cook_line="$(printf '%s' "$uba_out" | grep -a 'stub UAT:' | grep -a 'BuildCookRun' | head -1)"
case "$editor_line" in *-ubtargs=-NoUBA*) ok "BuildEditor is handed -NoUBA" ;;
  *) bad "BuildEditor runs with UBA: $editor_line" ;; esac
case "$cook_line" in *-ubtargs=-NoUBA*) ok "BuildCookRun is handed -NoUBA" ;;
  *) bad "BuildCookRun runs with UBA: $cook_line" ;; esac
# And it must be possible to turn back on, or this is a hardcode rather than a
# decision.
rm -rf "$TMP/out"
uba_on="$(WL_UBT_ARGS="" run_build "$TMP/uba")"
if printf '%s' "$uba_on" | grep -a 'stub UAT:' | grep -aq 'ubtargs'; then
  bad "WL_UBT_ARGS=\"\" still passes ubtargs — UBA cannot be re-enabled"
else
  ok "…and WL_UBT_ARGS=\"\" passes nothing, so UBA can be turned back on"
fi
# The flag itself must be the one THIS engine documents. bAllowUBALocalExecutor
# is Obsolete in 5.8 and reads like the right answer.
# Comments stripped before matching: the script EXPLAINS that
# bAllowUBALocalExecutor is the obsolete name, and a check that reads its own
# prose is a check that reports on the wrong thing.
UBA_CODE="$(sed 's/#.*//' "$HERE/build-wonderland.sh")"
if printf '%s' "$UBA_CODE" | grep -q 'NoUBA' \
   && ! printf '%s' "$UBA_CODE" | grep -q 'bAllowUBALocalExecutor'; then
  ok "…using -NoUBA, the switch UE 5.8's BuildConfiguration.cs actually declares"
else
  bad "the build uses a UBA switch this engine does not declare"
fi

echo
echo "== a picture can be measured without ffmpeg or PIL =="
# The Lightning box has neither, and adding a dependency to read four numbers
# out of a frame is how a measurement stops being taken. The gain sweep decides
# what the backdrop's brightness should be from these numbers, so a reader that
# is quietly wrong would tune the world to the wrong value.
MFR="$HERE/measure-frame-region.py"
MFR_TMP="$(mktemp -d)"
python3 - "$MFR_TMP" <<'PYPNG'
import os, struct, sys, zlib
D = sys.argv[1]
def write(path, w, h, rgb, ftype):
    raw, prev = b'', bytearray(w * 3)
    for _ in range(h):
        line = bytearray(bytes(rgb) * w)
        if ftype == 0:
            enc = bytes(line)
        elif ftype == 1:
            enc = bytes((line[i] - (line[i-3] if i >= 3 else 0)) & 0xFF for i in range(len(line)))
        else:
            enc = bytes((line[i] - prev[i]) & 0xFF for i in range(len(line)))
        raw += bytes([ftype]) + enc
        prev = line
    def chunk(k, b):
        c = struct.pack('>I', len(b)) + k + b
        return c + struct.pack('>I', zlib.crc32(k + b) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\x0a'[:8]
    out = b'\x89PNG\r\n\x1a\n'
    out += chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(out)
for ft, name in ((0, 'none'), (1, 'sub'), (2, 'up')):
    write(os.path.join(D, 'f%s.png' % name), 40, 30, (200, 100, 50), ft)
def chunk(k, b):
    c = struct.pack('>I', len(b)) + k + b
    return c + struct.pack('>I', zlib.crc32(k + b) & 0xffffffff)
deep = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 4, 4, 16, 2, 0, 0, 0))
deep += chunk(b'IDAT', zlib.compress(b'\x00' * 100)) + chunk(b'IEND', b'')
open(os.path.join(D, 'deep.png'), 'wb').write(deep)
PYPNG
mfr_ok=1
for n in none sub up; do
  got="$(python3 "$MFR" "$MFR_TMP/f$n.png" 0 0 40 30 2>/dev/null)"
  case "$got" in *"mean_rgb=200.0,100.0,50.0"*) : ;; *) mfr_ok=0 ;; esac
done
[ "$mfr_ok" = 1 ] \
  && ok "a known flat colour reads back exactly, through every PNG filter the encoder uses" \
  || bad "the frame reader does not reproduce a known colour"
if python3 "$MFR" "$MFR_TMP/deep.png" 0 0 4 4 >/dev/null 2>&1; then
  bad "a 16-bit PNG is decoded as if it were 8-bit"
else
  ok "…and an unsupported PNG is REFUSED by name, not decoded into a wrong number"
fi
rm -rf "$MFR_TMP"

echo
echo "== the Relay Dog's paws do not skate =="
# The founder's words were "sliding, teleporting, jittering, snapping" and "a
# model being translated through space while its legs twitch". That was literal:
# four static cubes welded to a root that SetActorLocation moved, with no gait
# at all. Foot lock - a planted paw not moving in WORLD space - decides whether
# a walk reads as walking, and it is arithmetic, so it is compiled and proven
# here rather than judged from a stream on a rented GPU.
GAIT_DIR="$HERE/../../Source/Wonderland"
# OUTSIDE Source/, because UnrealBuildTool compiles everything under Source/ and
# a second main() collides with the engine's at link time. build-wonderland.sh
# refuses to start a build that would hit it; this is the other half.
GAIT_TEST="$HERE/../../tests/cpp/WonderlandDogGait.test.cpp"
# A MISSING TEST FILE IS A FAILURE, NOT A SKIP. This block used to be guarded by
# `[ -f ... ]`, so moving the file would have silently deleted fourteen checks
# and left the suite green — the same vacuous-pass shape as an all() over an
# empty list.
if [ ! -f "$GAIT_TEST" ]; then
  bad "the gait proof is missing from $GAIT_TEST"
elif command -v g++ >/dev/null 2>&1; then
  GAIT_BIN="$(mktemp -u)"
  if g++ -std=c++17 -O1 -I "$GAIT_DIR" -o "$GAIT_BIN" \
       "$GAIT_DIR/WonderlandDogGait.cpp" "$GAIT_TEST" 2>/dev/null; then
    GAIT_OUT="$("$GAIT_BIN" 2>&1)"; rm -f "$GAIT_BIN"
    if printf '%s' "$GAIT_OUT" | grep -q 'failed 0'; then
      while IFS= read -r line; do
        case "$line" in "  ok   "*) ok "${line#  ok   }" ;; esac
      done <<< "$GAIT_OUT"
    else
      bad "the gait math fails: $(printf '%s' "$GAIT_OUT" | grep FAIL | head -3)"
    fi
  else
    bad "the gait math does not compile"
  fi
fi
echo
echo "== the gait can be SEEN without a GPU =="
# Locomotion is the highest-priority visible item and every way of looking at it
# needed the L4 — build, cook, package, stream, capture. With the Studio off
# that is not a slow loop, it is no loop, and "the gait is correct" becomes a
# claim resting on arithmetic nobody can see.
STRIP_OUT="$(mktemp -u).png"
if python3 "$HERE/render-gait-strip.py" --out "$STRIP_OUT" >/tmp/strip.log 2>&1; then
  if [ -s "$STRIP_OUT" ]; then
    ok "the gait strip renders walk, trot and run from the engine's own numbers"
  else
    bad "render-gait-strip produced an empty file"
  fi
  # IT MUST REFUSE TO DRAW A DIFFERENT ANIMAL. The strip re-implements two
  # formulas; a drift would show a convincing picture of a gait Unreal does not
  # run, which is worse than no picture.
  if grep -q "parity worst" /tmp/strip.log; then
    ok "...after checking its own formulas against the engine's sampled table"
  else
    bad "the strip draws without checking parity with the engine"
  fi
  rm -f "$STRIP_OUT"
else
  bad "render-gait-strip failed: $(tail -2 /tmp/strip.log | tr '\n' ' ')"
fi
# And the refusal must actually fire.
if grep -q "refusing to draw a different animal" "$HERE/render-gait-strip.py"; then
  ok "...and it REFUSES rather than drawing when the two disagree"
else
  bad "a drift from the engine would produce a picture instead of an error"
fi

echo
echo "== the Project Avatar does not lie about what Relay is doing =="
# A world that idly cycles pretty animations is a screensaver. One that shows
# implementing ONLY while Relay is implementing is an instrument. The difference
# is invisible in a screenshot and total in what the thing is for.
AV_TEST="$HERE/../../tests/cpp/WonderlandProjectAvatar.test.cpp"
if [ ! -f "$AV_TEST" ]; then
  bad "the Project Avatar proof is missing from $AV_TEST"
elif command -v g++ >/dev/null 2>&1; then
  AV_BIN="$(mktemp -u)"
  if g++ -std=c++17 -O1 -I "$GAIT_DIR" -o "$AV_BIN" \
       "$GAIT_DIR/WonderlandProjectAvatar.cpp" "$GAIT_DIR/WonderlandDogPose.cpp" \
       "$AV_TEST" 2>/dev/null; then
    AV_OUT="$("$AV_BIN" 2>&1)"; rm -f "$AV_BIN"
    if printf '%s' "$AV_OUT" | grep -q 'failed 0'; then
      while IFS= read -r line; do
        case "$line" in "  ok   "*) ok "${line#  ok   }" ;; esac
      done <<< "$AV_OUT"
    else
      bad "the Project Avatar fails: $(printf '%s' "$AV_OUT" | grep FAIL | head -3)"
    fi
  else
    bad "the Project Avatar state module does not compile"
  fi
else
  bad "g++ is unavailable, so the Project Avatar proof did not run"
fi

echo
echo "== a Relay Dog stands up without teleporting into the pose =="
# "No instant pose swap" is a claim about CONTINUITY, and continuity is
# arithmetic — so it is compiled and proven here rather than judged from a
# stream. So is "the hind paws stay planted", which is the difference between
# a Dog standing up and a Dog hovering.
POSE_TEST="$HERE/../../tests/cpp/WonderlandDogPose.test.cpp"
POSE_SRC="$GAIT_DIR/WonderlandDogPose.cpp"
if [ ! -f "$POSE_TEST" ]; then
  bad "the upright-pose proof is missing from $POSE_TEST"
elif command -v g++ >/dev/null 2>&1; then
  POSE_BIN="$(mktemp -u)"
  if g++ -std=c++17 -O1 -I "$GAIT_DIR" -o "$POSE_BIN" "$POSE_SRC" "$POSE_TEST" 2>/dev/null; then
    POSE_OUT="$("$POSE_BIN" 2>&1)"; rm -f "$POSE_BIN"
    if printf '%s' "$POSE_OUT" | grep -q 'failed 0'; then
      while IFS= read -r line; do
        case "$line" in "  ok   "*) ok "${line#  ok   }" ;; esac
      done <<< "$POSE_OUT"
    else
      bad "the upright pose fails: $(printf '%s' "$POSE_OUT" | grep FAIL | head -3)"
    fi
  else
    bad "the upright pose does not compile"
  fi
else
  bad "g++ is unavailable, so the upright-pose proof did not run"
fi

echo
echo "== the UPRIGHT Relay Dog walks like a being, not like a block =="
# The founder's bar for the upright form is "must not look like a Minecraft
# character": no jitter, no snapping, no sliding, no pose stepping, no
# whole-body-as-one-block. Every one of those is a property of the ARITHMETIC,
# so every one is decided here rather than judged from a stream -- which is the
# same reason the quadruped gait is a separate file, and it is why that walk
# stopped sliding.
STANCE_TEST="$HERE/../../tests/cpp/WonderlandDogStance.test.cpp"
STANCE_SRC="$GAIT_DIR/WonderlandDogStance.cpp"
if [ ! -f "$STANCE_TEST" ]; then
  bad "the upright-stance proof is missing from $STANCE_TEST"
elif command -v g++ >/dev/null 2>&1; then
  STANCE_BIN="$(mktemp -u)"
  if g++ -std=c++17 -O1 -I "$GAIT_DIR" -o "$STANCE_BIN" "$STANCE_SRC" "$STANCE_TEST" 2>/dev/null; then
    STANCE_OUT="$("$STANCE_BIN" 2>&1)"; rm -f "$STANCE_BIN"
    if printf '%s' "$STANCE_OUT" | grep -q 'failed 0'; then
      while IFS= read -r line; do
        case "$line" in "  ok   "*) ok "${line#  ok   }" ;; esac
      done <<< "$STANCE_OUT"
    else
      bad "the upright stance fails: $(printf '%s' "$STANCE_OUT" | grep FAIL | head -3)"
    fi
  else
    bad "the upright stance does not compile"
  fi
else
  bad "g++ is unavailable, so the upright-stance proof did not run"
fi

SD="$GAIT_DIR/WonderlandStrollingDog.cpp"
# READ IT ONCE, MATCH WITHOUT A PIPE. Every check below used
#     sed 's|//.*||' "$SD" | grep -q '<thing>'
# which is precisely what has() exists to avoid: grep -q exits at the first
# match, sed takes SIGPIPE, and `set -o pipefail` turns that into a failed
# assertion. It is a RACE — whether sed has finished writing before grep leaves
# — so it failed a different check on each run and passed entirely on some. The
# comment warning about this shape sits twenty lines above the code using it.
SD_SRC="$(sed 's|//.*||' "$SD")"
if has "$SD_SRC" 'DistanceWalked += StepLength'; then
  ok "the stroller advances its gait by distance travelled, not by a clock"
else
  bad "the gait is not driven by distance, so it can drift from the body"
fi
if has "$SD_SRC" 'LineTraceSingleByChannel'; then
  ok "...and traces for the ground instead of holding its spawn height"
else
  bad "the Dog never looks for the floor, so it floats on any slope"
fi
# A LIMB THAT SLIDES IS NOT A LIMB. The first gait moved each leg with
# SetRelativeLocation alone: the paw went to the right place and nothing
# pivoted, which reads as a box on a rail. The engine has to swing it.
if has "$SD_SRC" 'SetRelativeRotation'; then
  ok "...and swings each limb from the hip rather than sliding it"
else
  bad "the legs are translated, never rotated — they will read as boxes on a rail"
fi
if has "$SD_SRC" 'LegSwing'; then
  ok "...using the shared swing solve, not a second one"
else
  bad "the stroller rotates legs by some other arithmetic than WonderlandGait::LegSwing"
fi
# The stretch has to be measured from a RECORDED rest scale. Reading the
# component's current scale back would compound last frame's stretch into this
# frame's and the legs would grow without bound.
if has "$SD_SRC" 'LegRestScale'; then
  ok "...and stretches from a recorded rest length, so it cannot compound"
else
  bad "the leg stretch has no recorded rest length to measure from"
fi
# A Dog whose heading interpolates while it walks at full speed travels in a
# direction it is not facing. That IS sliding, whatever the legs are doing.
if has "$SD_SRC" 'GetActorForwardVector'; then
  ok "...and gates its step on where it is actually FACING, so it turns on the spot"
else
  bad "the step is not gated on heading — the Dog will crab sideways out of every turn"
fi
# THE STRIDE WAS A CONSTANT. 132 uu whatever the Dog was doing, so "faster"
# only ever meant the same walk replayed more quickly — the speed/animation
# mismatch by construction rather than by accident.
if has "$SD_SRC" 'GaitForSpeed'; then
  ok "...and derives stride, duty, lift and footfall from its CURRENT SPEED"
else
  bad "the gait is not derived from speed — a faster Dog just replays the walk"
fi
if has "$SD_SRC" 'FInterpConstantTo(CurrentSpeed'; then
  ok "...reaching that speed by acceleration, not by assignment"
else
  bad "speed is assigned outright, so the Dog snaps from nothing to full stride"
fi
if has "$SD_SRC" 'HipHeightWorld'; then
  ok "...and the gait threshold is a Froude number in WORLD units, so scale is free"
else
  bad "no world-space hip height — a Dog at actor scale 1.75 breaks gait at the wrong speed"
fi
# A DOG DOES NOT INVENT A JOB TO LOOK BUSY. No Avatar means no work, and the
# Avatar's own state module refuses to turn "we have not heard from Relay" into
# something plausible — so there must be no second path that does.
if has "$SD_SRC" 'DesiredWork'; then
  ok "...and its work comes from the attended Avatar's REAL mission state"
else
  bad "the Dog decides its own work — the world would stage performances Relay is not doing"
fi
if has "$SD_SRC" 'PostDist < 90.0f'; then
  ok "...and it only rises once it has ARRIVED, not while crossing the plaza"
else
  bad "nothing gates the rise on arrival — the Dog will hop along on its hind legs"
fi
if has "$SD_SRC" 'ApproachBlend(UprightBlend, 0.0f'; then
  ok "...and comes back down by blending, not by dropping in one frame"
else
  bad "the Dog drops to all fours instantly when work ends"
fi
# The pose struct carrying a stretch is only half a fix; the components have to
# receive it or the body still leaves its legs on screen.
if has "$SD_SRC" 'Up.HindStretch'; then
  ok "...and its hind legs SPAN the raised hip, so the body stays on its legs"
else
  bad "the hind stretch never reaches the components — the body detaches while rearing"
fi
# THE ROOT TRACE IS NOT GROUNDING. It puts the BODY at the right height on a
# slope and leaves every paw at the same height as every other, so uphill paws
# sink and downhill ones hang — the "hovering and sinking" the brief names.
if has "$SD_SRC" 'PawGroundOffset'; then
  ok "...and every paw traces for its OWN ground, not just the body"
else
  bad "only the root is traced — on a slope the paws sink and hang"
fi
if has "$SD_SRC" 'SCENE_QUERY_STAT(WonderlandPaw)'; then
  ok "...with a per-paw trace from the paw's own world position"
else
  bad "the per-paw grounding has no trace behind it"
fi

echo
echo "== the Project Avatar is placed, and its absence is loud =="
GEN_SRC="$(sed 's|#.*||' "$HERE/generate-hub-level.py")"
if has "$GEN_SRC" 'WonderlandProjectAvatarActor'; then
  ok "the generator places a Project Avatar"
else
  bad "no Project Avatar is placed — the system exists and nothing shows it"
fi
if has "$GEN_SRC" 'log_error'; then
  ok "...and a missing Avatar class is an ERROR, not a silent absence"
else
  bad "a missing Avatar class would vanish the way eight Relay Dogs once did"
fi
# THE GENERATOR MUST NOT GUESS WHAT RELAY IS DOING. An Avatar that shipped
# already "implementing" would be a world lying at build time.
if has "$GEN_SRC" 'set_prop(_avatar, "MissionState", 0)'; then
  ok "...and it ships with mission Unknown, never a plausible-looking guess"
else
  bad "the generator sets a mission state it cannot know"
fi

echo
echo "== no light is created with an FColor =="
# set_light_color takes an FLinearColor. Passing unreal.Color throws
#   TypeError: NativizeStructInstance: Cannot nativize 'Color' as 'LinearColor'
# and it has cost this project twice: first SILENTLY, inside a try/except, so
# every lantern and the hero Dog's violet key were built at default white and a
# wrong-coloured light looked exactly like a working one; then FATALLY, when I
# added a ground bounce with the same mistake forty lines below the helper whose
# docstring describes it.
if python3 - "$HERE/generate-hub-level.py" <<'LCEOF'
import ast, io, sys
tree = ast.parse(io.open(sys.argv[1], encoding="utf8").read())
bad = []
for node in ast.walk(tree):
    if not isinstance(node, ast.Call): continue
    f = node.func
    if not (isinstance(f, ast.Attribute) and f.attr == "set_light_color"): continue
    for a in node.args:
        if isinstance(a, ast.Call) and isinstance(a.func, ast.Attribute) \
           and a.func.attr == "Color" and isinstance(a.func.value, ast.Name) \
           and a.func.value.id == "unreal":
            bad.append(node.lineno)
if bad:
    sys.stderr.write("set_light_color(unreal.Color(...)) at line(s) %s\n"
                     % ", ".join(map(str, bad)))
    raise SystemExit(1)
LCEOF
then
  ok "every light colour goes through srgb_light_color or a LinearColor"
else
  bad "a light is created with unreal.Color — UE wants an FLinearColor and will refuse it"
fi

echo
echo "== the near field carries the colour the frame was missing =="
# The last streamed arrival classified 0.1% green and 2.1% pink against 25% and
# 7.7% in the offline preview of the same world. The palette existed; almost
# none of it was in the near field, which is where a frame gets its colour.
if has "$GEN_SRC" 'FOREGROUND PLANTING'; then
  ok "a foreground planting band is authored"
else
  bad "nothing plants the near field — colour stays in the distance"
fi
# It must be placed beyond where the frame ACTUALLY touches the ground, for
# BOTH arrival cameras: HeroCam6 is pitched higher, so its bottom ray meets the
# ground further out, and planting at HeroCam0's band puts flowers under
# HeroCam6's frame edge — invisible in the shot they were added for.
if has "$GEN_SRC" '_FG_START = max(NEAR_Y'; then
  ok "...beyond the ground band of BOTH arrival cameras, not just HeroCam0"
else
  bad "the planting band ignores HeroCam6, which is the primary arrival camera"
fi
if has "$GEN_SRC" 'kit_bed(_fx'; then
  ok "...and it goes through the instanced kit, so batching is preserved"
else
  bad "foreground planting does not use the instanced kit"
fi
# THE ROOM IS AT MID HEIGHT, and that was measured, not assumed. Ground planting
# alone came out at 0.78% of the arrival frame with ZERO pixels in the middle
# third: HeroCam6 sits 430 uu up and pitches +5 degrees, so anything lying on
# the ground can only occupy a bottom sliver however much of it there is.
if has "$GEN_SRC" 'MIDGROUND VERTICALS'; then
  ok "...and a midground band fills the storey between paving and castle"
else
  bad "nothing occupies the middle distance — more ground beds buy more of almost nothing"
fi
# A hedge across the middle distance is worse than an empty one: the eye needs a
# path THROUGH it.
if has "$GEN_SRC" 'if abs(_mx) < 190.0:'; then
  ok "...while leaving the boulevard clear, so the eye still has a path in"
else
  bad "the midground band has no gap — it would wall the view instead of deepening it"
fi
# Both bands must be sweepable or the art change cannot be A/B'd without a GPU.
if has "$GEN_SRC" 'LOOK["foregroundPlanting"]'; then
  ok "...and both bands are sweepable from WONDERLAND_LOOK, so they can be A/B'd on CPU"
else
  bad "the planting cannot be turned off — no before/after without a rebuild"
fi

echo
echo "== a captured frame records what the Dogs were DOING =="
WP_SRC="$(sed 's|//.*||' "$GAIT_DIR/WonderlandWorldProof.cpp")"
if has "$WP_SRC" 'RUNTIME_GAITS'; then
  ok "the world proof reports the gait mix, so 'they trot now' is checkable"
else
  bad "nothing records the gait — it could only be guessed from a screenshot"
fi
if has "$WP_SRC" 'RUNTIME_PROJECT_AVATARS'; then
  ok "...and whether a Project Avatar is present at all"
else
  bad "an absent Avatar would look exactly like a dormant one in a still"
fi
if has "$WP_SRC" 'RUNTIME_AVATAR_MISSION'; then
  ok "...and the mission state it was showing when the shutter opened"
else
  bad "the Avatar's mission is not recorded, so its glow cannot be attributed"
fi

echo "== "sharper" is a number, not an impression =="
# The founder's note is "too blurry, too soft, too smeared, not crisp enough for
# 4K". Those all describe one measurable thing — how much neighbouring pixels
# differ — and none of them can be settled by looking at a frame. Acutance must
# fall under a known blur while the MEAN COLOUR does not move, or it is
# measuring brightness and would credit the backdrop gain with detail it did not
# add.
SH_TMP="$(mktemp -d)"
python3 - "$SH_TMP" <<'PYSH'
import os, struct, sys, zlib
D = sys.argv[1]
def write(path, rows):
    h = len(rows); w = len(rows[0]) // 3
    raw = b''.join(b'\x00' + bytes(r) for r in rows)
    def chunk(k, b):
        c = struct.pack('>I', len(b)) + k + b
        return c + struct.pack('>I', zlib.crc32(k + b) & 0xffffffff)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0))
    out += chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(out)
W = H = 64
# Sharp: hard vertical stripes. Soft: the SAME row low-passed with a 5-tap box,
# which is a real blur rather than a second pattern that happens to look like
# one. The first version of this fixture generated the identical image twice and
# the check reported the metric broken when the metric was fine.
base = [220 if (x // 4) % 2 == 0 else 40 for x in range(W)]
k = 2
blur = [sum(base[max(0, x - k):min(W, x + k + 1)]) / len(base[max(0, x - k):min(W, x + k + 1)])
        for x in range(W)]
sharp, soft = [], []
for _ in range(H):
    sharp.append([c for v in base for c in (v, v, v)])
    soft.append([c for v in blur for c in (int(round(v)),) * 3])
write(os.path.join(D, 'sharp.png'), sharp)
write(os.path.join(D, 'soft.png'), soft)
PYSH
A_SHARP="$(python3 "$HERE/measure-frame-region.py" "$SH_TMP/sharp.png" 0 0 64 64 2>/dev/null | sed -n 's/.*acutance=\([0-9.]*\).*/\1/p')"
A_SOFT="$(python3 "$HERE/measure-frame-region.py" "$SH_TMP/soft.png" 0 0 64 64 2>/dev/null | sed -n 's/.*acutance=\([0-9.]*\).*/\1/p')"
if [ -n "$A_SHARP" ] && [ -n "$A_SOFT" ] \
   && python3 -c "import sys; sys.exit(0 if float('$A_SHARP') > float('$A_SOFT') * 1.5 else 1)"; then
  ok "acutance is much higher on hard edges than on a soft ramp ($A_SHARP vs $A_SOFT)"
else
  bad "acutance does not separate sharp from soft ($A_SHARP vs $A_SOFT)"
fi
rm -rf "$SH_TMP"
SHARP_SH="$HERE/../lightning/tune-sharpness.sh"
bash -n "$SHARP_SH" 2>/dev/null && ok "tune-sharpness.sh parses" || bad "tune-sharpness.sh does not parse"
SH_CODE="$(mktemp)"; sed 's/#.*//' "$SHARP_SH" > "$SH_CODE"
grep -q 'RESAMPLED' "$SH_CODE" \
  && ok "…and refuses to score a capture that was RESAMPLED" \
  || bad "a downscaled 4K capture would be scored as if it were native"
grep -q 'fps_mean\|30.0' "$SH_CODE" \
  && ok "…and reports the sharpest option that still holds 30 FPS" \
  || bad "the sweep can recommend a setting that cannot hold a frame rate"
rm -f "$SH_CODE"
if sed 's|//.*||' "$HERE/../lightning/shot.cjs" | grep -q 'WL_RES_X'; then
  ok "the capture viewport follows the stream resolution, so 4K is captured as 4K"
else
  bad "shot.cjs still hardcodes a viewport — a 4K stream would be captured at 720p"
fi

echo
echo "== the gain sweep decides from frames, and says when the answer is not gain =="
SWEEP="$HERE/../lightning/tune-marble-gain.sh"
bash -n "$SWEEP" 2>/dev/null && ok "tune-marble-gain.sh parses" || bad "tune-marble-gain.sh does not parse"
SWEEP_CODE="$(mktemp)"; sed 's/#.*//' "$SWEEP" > "$SWEEP_CODE"
grep -q 'MARBLE_RUNTIME_GAIN_FAILED' "$SWEEP_CODE" \
  && ok "…and refuses to record a sample where the gain did not take" \
  || bad "a run where the gain failed would be recorded as a brightness data point"
grep -q 'ShowFlag.Fog 0' "$SWEEP_CODE" \
  && ok "…and captures each gain with fog OFF too, to isolate the shell from the fog" \
  || bad "the sweep measures the sky band without separating fog from the backdrop"
if grep -q 'FOG is painting over' "$SWEEP_CODE"; then
  ok "…and concludes FOG, not brightness, when the shell brightens and the frame does not"
else
  bad "the sweep can only conclude 'turn the gain up'"
fi
rm -f "$SWEEP_CODE"

echo
echo "== a hero capture cannot report a result it does not have =="
# The comparison tool is what turns two sidecars into a recommendation, so a
# version of it that always prints a nice table would make every run look like
# a result. Its own suite covers the three ways a capture can be a lie.
CMP_OUT="$(python3 "$HERE/compare-hero-captures.test.py" 2>&1)"
if printf '%s' "$CMP_OUT" | grep -q 'failed 0'; then
  while IFS= read -r line; do
    case "$line" in "  ok   "*) ok "${line#  ok   }" ;; esac
  done <<< "$CMP_OUT"
else
  bad "compare-hero-captures refuses nothing: $(printf '%s' "$CMP_OUT" | tail -3)"
fi

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
