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
  printf 'int main(){}\n'  > "$r/Source/Wonderland/a.cpp"
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
