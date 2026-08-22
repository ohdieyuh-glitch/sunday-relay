#!/usr/bin/env bash
# Wonderland — compile + package for Linux Pixel Streaming. AUTHORED, NOT RUN.
#
# Runs on the GPU/build host (Unreal Engine 5.8 present — see README.md for how
# to obtain it). Produces a staged Linux client the streaming instance serves.
# This box (a 2-core Chromebook, no GPU) cannot run it; NOTHING HERE HAS EXECUTED
# and no Wonderland C++ has ever been compiled. Every "verify"/"detect" below is
# the guard an eventual real run will hit — it has caught nothing yet.
#
# DESIGN GOALS (this hardening pass):
#   - REPRODUCIBLE: the UE version is pinned and asserted (5.8), inputs are
#     content-hashed, and the packaged output location is explicit.
#   - IDEMPOTENT: a second run with unchanged inputs skips the expensive build
#     (checksum stamp); FORCE_REBUILD=1 overrides.
#   - FAIL-CLOSED: every engine step's exit code is checked explicitly and its
#     log is grepped for failure signatures; a swallowed error is a bug.
#   - LAUNCHES NOTHING: this script only compiles + packages. It never uploads,
#     never provisions, and never starts a paid GPU. Shipping the artifact and
#     standing up AWS are separate, documented, MANUAL steps (see README.md and
#     docs/relay/wonderland/BUILD_AUTOMATION.md).
set -euo pipefail

# ----------------------------------------------------------------- config
UE_ROOT="${UE_ROOT:-/opt/UnrealEngine}"                 # UE 5.8 source or install root
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"     # the wonderland/ project dir
PROJECT="${PROJECT:-$PROJECT_ROOT/Wonderland.uproject}"
OUT="${OUT:-/opt/wonderland/packaged}"
CONFIG="${CONFIG:-Development}"                          # Development | Shipping
PLATFORM="${PLATFORM:-Linux}"
UE_MAJOR_EXPECTED="${UE_MAJOR_EXPECTED:-5}"
UE_MINOR_EXPECTED="${UE_MINOR_EXPECTED:-8}"
FORCE_REBUILD="${FORCE_REBUILD:-0}"                     # 1 = ignore the idempotence stamp
ALLOW_EMPTY_LEVEL="${ALLOW_EMPTY_LEVEL:-0}"            # 1 = package even if level-gen failed

SRC_DIR="$PROJECT_ROOT/Source"
CFG_DIR="$PROJECT_ROOT/Config"
WORLD_DIR="$PROJECT_ROOT/WorldDesign"
LOG_DIR="$OUT/logs"
STAMP="$OUT/.wonderland-build.stamp"
RUNUAT="$UE_ROOT/Engine/Build/BatchFiles/RunUAT.sh"
UE_EDITOR_CMD="$UE_ROOT/Engine/Binaries/Linux/UnrealEditor-Cmd"
BUILD_VERSION_FILE="$UE_ROOT/Engine/Build/Build.version"

log()  { echo "[build-wonderland] $*"; }
die()  { echo "[build-wonderland] ERROR: $*" >&2; exit 1; }

# Extracts an integer field from Engine/Build/Build.version WITHOUT assuming jq
# is installed (the build container may be minimal). Prints nothing on miss.
version_field() {
  # THE PIPELINE RUNS WITH pipefail DISABLED, and that is not cosmetic. The
  # comment above promises "prints nothing on miss", and under `set -euo
  # pipefail` this function could not keep that promise: a missing
  # Build.version or an absent field makes grep exit 1, pipefail propagates it,
  # the enclosing `VAR="$(version_field ...)"` fails, and `set -e` kills the
  # build with NO message at all. `head -n1` adds a second route to the same
  # place by closing the pipe and handing the upstream grep a SIGPIPE.
  #
  # A miss here is a legitimate outcome — it is handled explicitly by the
  # caller, which warns and proceeds without a version assertion. Disabling
  # pipefail for the subshell, plus the `|| true`, makes the code able to do
  # what its own documentation says.
  ( set +o pipefail
    grep -o "\"$1\"[[:space:]]*:[[:space:]]*[0-9]\+" "$BUILD_VERSION_FILE" 2>/dev/null \
      | grep -o '[0-9]\+$' | head -n1 ) || true
}

# Runs one UAT/editor step fail-closed: capture the log, check the exit code
# EXPLICITLY (not swallowed by `|| true`), then grep the log for the failure
# signatures UAT sometimes emits alongside a zero exit. Either tripwire fails.
run_step() {
  local name="$1"; shift
  local logfile="$LOG_DIR/${name}.log"
  log "step: $name"
  local rc=0
  # Disable -e only around the captured command so we can inspect rc ourselves.
  set +e
  "$@" 2>&1 | tee "$logfile"
  rc="${PIPESTATUS[0]}"
  set -e
  if [ "$rc" -ne 0 ]; then
    die "$name failed (exit $rc). See $logfile"
  fi
  # Secondary tripwire: strong failure signatures that can appear with rc=0.
  if grep -Eq 'AutomationTool exiting with ExitCode=[1-9]|ExitCode=[1-9][0-9]*|BUILD FAILED|Fatal error:|LogInit: *Error' "$logfile"; then
    die "$name reported a failure signature in its log despite exit $rc. See $logfile"
  fi
  log "step ok: $name"
}

# --------------------------------------------------- 0. preflight + version pin
[ -f "$PROJECT" ]  || die "project not found: $PROJECT"
[ -d "$SRC_DIR" ]  || die "Source/ not found: $SRC_DIR"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required for the idempotence stamp"

if [ ! -x "$RUNUAT" ]; then
  echo "Unreal Engine $UE_MAJOR_EXPECTED.$UE_MINOR_EXPECTED not found at UE_ROOT=$UE_ROOT." >&2
  echo "See wonderland/infra/build/README.md — obtaining UE requires an Epic<->GitHub link." >&2
  exit 2
fi

# Pin the engine to 5.8. A wrong engine version silently produces an artifact
# that will not match the plugin/signalling versions the stream stack expects,
# so this is a hard gate, overridable only by deliberately widening the vars.
if [ -f "$BUILD_VERSION_FILE" ]; then
  UE_MAJOR="$(version_field MajorVersion)"
  UE_MINOR="$(version_field MinorVersion)"
  if [ -n "$UE_MAJOR" ] && [ -n "$UE_MINOR" ]; then
    log "engine at $UE_ROOT reports version ${UE_MAJOR}.${UE_MINOR}"
    if [ "$UE_MAJOR" != "$UE_MAJOR_EXPECTED" ] || [ "$UE_MINOR" != "$UE_MINOR_EXPECTED" ]; then
      die "engine version ${UE_MAJOR}.${UE_MINOR} != required ${UE_MAJOR_EXPECTED}.${UE_MINOR_EXPECTED} (override UE_MAJOR_EXPECTED/UE_MINOR_EXPECTED only deliberately)"
    fi
  else
    log "WARNING: could not parse $BUILD_VERSION_FILE; proceeding WITHOUT a version-pin assertion (verify UE 5.8 by hand)"
  fi
else
  log "WARNING: $BUILD_VERSION_FILE absent; cannot assert the 5.8 pin (a source tree without a staged Build.version)"
fi

mkdir -p "$OUT" "$LOG_DIR"

# --------------------------------------------------- 1. idempotence stamp
# Content-hash the build inputs (project, C++ Source, Config, WorldDesign data).
# Content-addressed on purpose: a touched-but-unchanged file must NOT force a
# multi-hour rebuild. If the stamp matches and a staged build already exists,
# skip — unless FORCE_REBUILD=1.
# WHICH INPUTS MUST EXIST, AND WHICH MAY NOT.
#
# This distinction is the whole bug. `find` was given four paths unconditionally
# and `Config/` does not exist in this project — Unreal does not require one and
# nothing here creates it. find then exits nonzero, its stderr is discarded by
# the 2>/dev/null, pipefail propagates the failure to the command substitution,
# and `set -e` terminates the script WITHOUT PRINTING ANYTHING. On a real paid
# L4 run the build stopped dead one line after the engine version banner, and
# build.log contained exactly that one line.
#
# Required: the project descriptor, the C++ Source tree, and WorldDesign —
# hub-layout.json lives there and the generator cannot build a world without it,
# so its absence must be loud rather than silently hashed around.
REQUIRED_INPUTS=("$PROJECT" "$SRC_DIR" "$WORLD_DIR")
# Optional: Config/ is included when present and simply skipped when not.
OPTIONAL_INPUTS=("$CFG_DIR")

validate_build_inputs() {
  # Deliberately NOT inside the command substitution. A `die` from within
  # $( ) exits the subshell and leaves the caller to fail on its own terms,
  # which is how a clear error becomes an obscure one.
  local p missing=0
  for p in "${REQUIRED_INPUTS[@]}"; do
    if [ ! -e "$p" ]; then
      echo "[build-wonderland] ERROR: required build input missing: $p" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || die "cannot compute an input hash without every required build input"
  for p in "${OPTIONAL_INPUTS[@]}"; do
    [ -e "$p" ] || log "optional build input absent, skipping: $p"
  done
}

compute_input_hash() {
  # sha256sum every input file, sort for stable order, hash the digest list.
  local -a paths=()
  local p
  for p in "${REQUIRED_INPUTS[@]}" "${OPTIONAL_INPUTS[@]}"; do
    [ -e "$p" ] && paths+=("$p")
  done
  # pipefail off for the subshell so no benign stage status can terminate the
  # build, and `xargs -r` so an empty file list does not invoke sha256sum with
  # no arguments — where it would read STDIN and hash the wrong thing rather
  # than fail.
  ( set +o pipefail
    find "${paths[@]}" -type f -print0 2>/dev/null \
      | sort -z \
      | xargs -0 -r sha256sum 2>/dev/null \
      | sha256sum | cut -d' ' -f1 )
}

validate_build_inputs
INPUT_HASH="$(compute_input_hash)"
# THE GENERATOR'S KNOBS ARE BUILD INPUTS TOO.
#
# WONDERLAND_LOOK changes the world the generator produces, and it is not a
# file — so the content hash could not see it, the stamp matched, the cook was
# skipped, and the PREVIOUS package was reused. Two consecutive launches with
# different lighting produced frames identical to within one per cent, because
# they were the same binary. An override that cannot invalidate the build is an
# override that silently does nothing, which is the second time today the same
# shape of bug has cost a rebuild.
_KNOBS="LOOK=${WONDERLAND_LOOK:-} BATCH=${WONDERLAND_BATCH:-1} BACKDROP=${WONDERLAND_MARBLE_BACKDROP:-0} MARBLE=${WONDERLAND_MARBLE_IMPORT:-} COLLIDE=${WONDERLAND_COLLIDE:-}"
INPUT_HASH="$(printf '%s|%s' "$INPUT_HASH" "$_KNOBS" | sha256sum | cut -d' ' -f1)"
[ -n "${WONDERLAND_LOOK:-}" ] && log "generator knobs in the hash: $_KNOBS"
# The belt to the braces: if anything above still produced something that is not
# a hash, say so HERE rather than writing a meaningless stamp that makes the
# next run skip a build it should have done.
case "$INPUT_HASH" in
  [0-9a-f][0-9a-f][0-9a-f][0-9a-f]*) : ;;
  *) die "input hash came back as '${INPUT_HASH:-<empty>}' — refusing to stamp a build with it" ;;
esac
log "input content hash: ${INPUT_HASH:-<none>}"

STAGED_DIR="$OUT/${PLATFORM}"
if [ "$FORCE_REBUILD" != "1" ] \
   && [ -f "$STAMP" ] \
   && [ "$(cat "$STAMP" 2>/dev/null)" = "$INPUT_HASH" ] \
   && [ -d "$STAGED_DIR" ] \
   && [ -n "$(ls -A "$STAGED_DIR" 2>/dev/null || true)" ]; then
  log "inputs unchanged since the last successful package and $STAGED_DIR is present."
  log "SKIP (idempotent). Set FORCE_REBUILD=1 to rebuild anyway."
  exit 0
fi

# --------------------------------------------------- 2. compile the editor target
# Needed so the Python level generator can load the Wonderland C++ classes (the
# Dog pawn, etc.). Fail-closed: if the editor will not build, level generation
# cannot run and there is nothing honest to package.
# --- WHAT IS ABOUT TO BE COMPILED -----------------------------------------
#
# The full SHA, immediately before the compiler runs, from the repository this
# script is itself part of. Not the short one: this number is quoted in reports
# and compared against a commit someone pushed, and a seven-character prefix is
# not an identity.
#
# It is printed HERE rather than only in prepare.sh because prepare.sh runs
# earlier and against a different concern. A build that compiled source nobody
# can name afterwards is how a measurement gets attributed to the wrong code —
# which is exactly what happened: an L4 session measured a package built from a
# branch that did not contain the class being tested, and every stage said OK.
SRC_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD_SHA="$(git -C "$SRC_ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
BUILD_REF="$(git -C "$SRC_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
log "COMPILING $BUILD_SHA  (branch $BUILD_REF)"
if [ -n "${WL_REQUIRE_SHA:-}" ] && [ "$BUILD_SHA" != "$WL_REQUIRE_SHA" ]; then
  die "WL_REQUIRE_SHA=$WL_REQUIRE_SHA but this checkout is at $BUILD_SHA.
Refusing to compile a commit that was not the one asked for."
fi
if [ -n "${WL_BRANCH:-}" ] && [ "$BUILD_REF" != "unknown" ] \
   && [ "$BUILD_REF" != "$WL_BRANCH" ]; then
  die "WL_BRANCH=$WL_BRANCH but this checkout is on '$BUILD_REF'.
Refusing to compile a branch that was not the one asked for. This is the exact
regression that made an L4 session measure the wrong package."
fi
printf '%s\n' "$BUILD_SHA" > "$LOG_DIR/compiled.sha"

# UNREAL BUILD ACCELERATOR IS OFF BY DEFAULT HERE, AND IT IS NOT A PREFERENCE.
#
# On the L4, 2026-08-22, UBA's local executor turned the editor build into a
# crash loop: 143,340 CHAINED-SIGNAL 11 traces, every one of them faulting in
# opendir inside llvm::sys::fs::directory_iterator_construct — UBA detours the
# compiler's filesystem calls and that interception was the thing dying. Zero
# compiler errors, 3 of 13 actions completed in 35 minutes, a 70 MB log growing
# at 28 KB/s of pure stack trace, and UBT's own log parser reporting it was
# spending 88% of a core parsing the spew. Nothing FAILED; it simply never
# finished, which on a metered GPU is worse.
#
# This is the second time UBA has cost this project a session: the California
# export died on a 261 GiB UBA sparse file.
#
# VERIFIED IN THIS ENGINE, NOT ASSUMED. UnrealBuildTool/Configuration/
# BuildConfiguration.cs carries [CommandLine("-NoUBA", Value = "false")] on
# bAllowUBAExecutor, and both entry points used below parse -ubtargs and hand it
# to UBT: BuildTarget.Automation.cs:80 for BuildEditor, ProjectParams.cs:1057
# for BuildCookRun. (bAllowUBALocalExecutor, the name that reads like the right
# one, is marked Obsolete in 5.8 — which is exactly why this was checked against
# the engine rather than written from memory.)
#
# Set WL_UBT_ARGS="" to build with UBA again once it is understood. Note the
# single dash: ${VAR-default} substitutes only when VAR is UNSET, where
# ${VAR:-default} would also substitute when it is set-but-empty — which would
# have made the documented escape hatch silently do nothing.
WL_UBT_ARGS="${WL_UBT_ARGS--NoUBA}"
UBT_PASSTHROUGH=()
if [ -n "$WL_UBT_ARGS" ]; then
  UBT_PASSTHROUGH=(-ubtargs="$WL_UBT_ARGS")
  log "passing to UnrealBuildTool: $WL_UBT_ARGS"
fi

run_step "build-editor" "$RUNUAT" BuildEditor -project="$PROJECT" -notools \
  "${UBT_PASSTHROUGH[@]+"${UBT_PASSTHROUGH[@]}"}"

# --------------------------------------------------- 3. generate the starter Hub level
# Milestone-1 placeholder content via Editor Python, so the packaged build
# renders a REAL scene rather than an empty map. Milestone-2 art replaces the
# placeholders in-Editor on a GPU workstation. Owned by generate-hub-level.py
# (do not inline it here).
LEVEL_OK=1
if [ -x "$UE_EDITOR_CMD" ]; then
  GEN_SCRIPT="$(cd "$(dirname "$0")" && pwd)/generate-hub-level.py"
  [ -f "$GEN_SCRIPT" ] || die "level generator missing: $GEN_SCRIPT"
  # WL_GENERATOR_EXTRA exists for one flag: -nullrhi.
  #
  # Epic documents `-run=pythonscript` as headless ("can even run your scripts
  # in headless mode without opening the Editor UI") and the Unreal Containers
  # hub documents -nullrhi as what "allows this to work in containers without
  # GPU access". So a CPU-only level generation is plausible and is worth a try
  # on a machine that costs nothing.
  #
  # It is NOT the default, and the reason is specific to this generator: it
  # creates materials and imports textures through the editor, and this project
  # already has a record of editor features behaving differently headless — the
  # engine screenshot path returns success and writes an empty buffer here, and
  # Niagara templates cook and place fine while drawing nothing. Unproven is not
  # the same as broken, but it is not a default either.
  # shellcheck disable=SC2086
  if ! run_step "generate-hub-level" "$UE_EDITOR_CMD" "$PROJECT" -run=pythonscript \
        -script="$GEN_SCRIPT" -unattended -nop4 ${WL_GENERATOR_EXTRA:-}; then
    LEVEL_OK=0
  fi
else
  log "WARNING: $UE_EDITOR_CMD not present; skipping level generation"
  LEVEL_OK=0
fi
if [ "$LEVEL_OK" != "1" ] && [ "$ALLOW_EMPTY_LEVEL" != "1" ]; then
  die "level generation did not complete and ALLOW_EMPTY_LEVEL != 1; refusing to package a contentless build silently"
fi

# --- THE DECORATION ACTUALLY REACHED THE MAP -------------------------------
#
# The world's visual geometry is now instances inside AWonderlandInstancedBatch
# actors. If that C++ class is missing from the editor binary — a stale build,
# a compile that silently reused an old module — the generator logs an error,
# places NOTHING, and saves a map containing lights, markers and Dogs standing
# in an empty field. Every later step succeeds: the cook is clean, the package
# is valid, the stream comes up, and a person has to look at a browser to find
# out.
#
# A python exception inside -run=pythonscript does not reliably fail the
# process, so this reads the number the generator prints and decides here.
GEN_LOG="$LOG_DIR/generate-hub-level.log"
MIN_PIECES="${WONDERLAND_MIN_PIECES:-25000}"
if [ "$LEVEL_OK" = "1" ] && [ -f "$GEN_LOG" ]; then
  # THREE CASES, and only one of them is judgeable.
  #
  # The generator prints INSTANCED_PIECES=N when it batches and LIFECYCLE when
  # it finishes. A stubbed editor — which is exactly what build-wonderland.test.sh
  # runs — prints neither, and a gate that treated "no evidence" as "zero pieces"
  # would fail every harnessed build while looking like a real safety check.
  PIECES="$( ( set +o pipefail
               grep -ao 'INSTANCED_PIECES=[0-9]*' "$GEN_LOG" | tail -1 \
                 | cut -d= -f2 ) || true)"
  if [ -n "$PIECES" ]; then
    log "generated world: $PIECES instanced pieces"
    if [ "$PIECES" -lt "$MIN_PIECES" ]; then
      die "the generated world has only $PIECES instanced pieces (floor $MIN_PIECES).
Refusing to cook a world whose decoration never reached disk. Most likely the
editor binary has no AWonderlandInstancedBatch in it — check $LOG_DIR/build-editor.log.
Set WONDERLAND_BATCH=0 to generate the old one-actor-per-piece world, or
WONDERLAND_MIN_PIECES to lower this floor deliberately."
    fi
  elif grep -qa 'LIFECYCLE ' "$GEN_LOG" 2>/dev/null; then
    if [ "${WONDERLAND_BATCH:-1}" = "0" ]; then
      log "world generated UNBATCHED (WONDERLAND_BATCH=0) — the L4 measured 12 FPS on that architecture"
    else
      die "the generator finished but reported no INSTANCED_PIECES.
Batching is on and produced nothing, so the saved world has no decoration in it.
Check $GEN_LOG for 'WonderlandInstancedBatch is not in this build'."
    fi
  else
    log "no generator batch report in $GEN_LOG — level generation did not really run; piece floor not enforced"
  fi
fi

# --------------------------------------------------- 3b. the Marble visual layer
# OFF unless a world slug is named. WONDERLAND_MARBLE_IMPORT=royal-garden-backdrop
# adds World Labs geometry to the level as SCENERY: collision disabled, tagged,
# and placed on top of the generated world rather than instead of it. Unreal
# keeps every consequence — collision, navigation, Relay Dogs, gameplay.
#
# It runs AFTER generation because generation rewrites the map from a blank
# one; anything imported before it is overwritten without a word.
MARBLE_SLUG="${WONDERLAND_MARBLE_IMPORT:-}"
if [ -n "$MARBLE_SLUG" ]; then
  if [ "$LEVEL_OK" != "1" ]; then
    die "WONDERLAND_MARBLE_IMPORT=$MARBLE_SLUG but level generation did not complete.
There is no world to add a backdrop to."
  fi
  MARBLE_SCRIPT="$PROJECT_ROOT/marble/import-marble-world.py"
  [ -f "$MARBLE_SCRIPT" ] || die "Marble importer missing: $MARBLE_SCRIPT"
  MARBLE_MANIFEST="$PROJECT_ROOT/marble/worlds/$MARBLE_SLUG/manifest.json"
  [ -f "$MARBLE_MANIFEST" ] || die "no Marble manifest for '$MARBLE_SLUG' at $MARBLE_MANIFEST.
Generate and fetch the world first (wonderland/marble/marble_cli.py); this step
imports what exists, it does not spend credits."
  # The slug rides in the environment as well as in -script=, because whether
  # -script= arguments reach argparse on UE 5.8 has not been measured here and
  # a silently slug-less import would refuse in the middle of a paid build.
  # EXPORTED, not prefixed onto the call. `VAR=x some_function` in bash puts the
  # assignment in the function's environment, and whether it reaches a process
  # the function then execs is exactly the kind of detail that is easy to
  # believe and wrong. Exporting it is unambiguous.
  export WONDERLAND_MARBLE_SLUG="$MARBLE_SLUG"
  # shellcheck disable=SC2086
  if ! run_step "import-marble-world" "$UE_EDITOR_CMD" "$PROJECT" -run=pythonscript \
         -script="$MARBLE_SCRIPT --slug $MARBLE_SLUG" -unattended -nop4 ${WL_GENERATOR_EXTRA:-}; then
    die "the Marble import step failed — see $LOG_DIR/import-marble-world.log"
  fi
  # SAME TRAP AS THE GENERATOR. A python exception under -run=pythonscript does
  # not reliably fail the process, so the exit code above is not evidence. These
  # two numbers are: the actors reached the level, and the level reached disk.
  MARBLE_LOG="$LOG_DIR/import-marble-world.log"
  MARBLE_ACTORS="$( ( set +o pipefail
                      grep -ao 'MARBLE_VISUAL_ACTORS=[0-9]*' "$MARBLE_LOG" 2>/dev/null \
                        | tail -1 | cut -d= -f2 ) || true)"
  if [ -z "$MARBLE_ACTORS" ]; then
    die "the Marble importer printed no MARBLE_VISUAL_ACTORS line. It did not run to
completion, so the cook would package a world with no backdrop in it. See $MARBLE_LOG."
  fi
  if [ "$MARBLE_ACTORS" -lt 1 ]; then
    die "the Marble importer placed 0 visual actors. See $MARBLE_LOG."
  fi
  if ! grep -qa 'MARBLE_LEVEL_SAVED=1' "$MARBLE_LOG" 2>/dev/null; then
    die "the Marble layer was placed but the level was not saved (no MARBLE_LEVEL_SAVED=1
in $MARBLE_LOG). Cooking from here would ship the world WITHOUT the backdrop."
  fi
  log "Marble visual layer: $MARBLE_ACTORS actor(s) placed and saved into the level"
else
  log "Marble visual layer: off (set WONDERLAND_MARBLE_IMPORT=<slug> to add one)"
fi

# --------------------------------------------------- 4. compile client + cook/stage/pak
# PixelStreaming2 is enabled in the .uproject, so the packaged build launches
# with -PixelStreamingURL. This step compiles the Wonderland C++ module for the
# first time against real UE 5.8 API signatures — expect first-build fixups
# (docs/relay/WONDERLAND.md §12). It is a BUILD, not a deploy: it uploads and
# launches nothing.
# -map= IS EXPLICIT. Without it the cook infers what to include from the maps
# settings, and with no Config/ at all it inferred the engine default — so the
# packaged build shipped a template world and the live stream showed a blocky
# near-empty scene while every other part of the pipeline worked. Stating the
# map means a cook that omits WonderlandHub fails here instead of being
# discovered from a browser.
COOK_MAP="${WL_COOK_MAP:-/Game/Wonderland/Maps/WonderlandHub}"
run_step "build-cook-run" "$RUNUAT" BuildCookRun \
  -project="$PROJECT" \
  -platform="$PLATFORM" \
  -clientconfig="$CONFIG" \
  -map="$COOK_MAP" \
  -nop4 -build -cook -stage -pak -archive \
  -archivedirectory="$OUT" \
  "${UBT_PASSTHROUGH[@]+"${UBT_PASSTHROUGH[@]}"}" \
  -utf8output

# --------------------------------------------------- 5. verify the artifact + stamp
# Announce "packaged" only after the staged directory actually exists and is
# non-empty (truthfulness rule: a claim follows the fact, not the intent).
if [ ! -d "$STAGED_DIR" ] || [ -z "$(ls -A "$STAGED_DIR" 2>/dev/null || true)" ]; then
  die "packaging reported success but no staged output at $STAGED_DIR"
fi
printf '%s\n' "$INPUT_HASH" > "$STAMP"
log "packaged Wonderland -> $STAGED_DIR (stamp written)"

# --------------------------------------------------- 6. the MANUAL next steps
# Printed, never executed. Shipping the artifact and standing up the GPU are
# deliberate operator actions with their own authorization — this script ends here.
cat <<'NEXT'
[build-wonderland] Build + package complete (on a real UE 5.8 host).
[build-wonderland] Next steps are MANUAL and are NOT run by this script:
  1. Archive the staged build and place it where the instance can read it
     (an object-store copy, or bake it into the AMI).
  2. Point the infrastructure variable at that artifact URI.
  3. Provision/start the single GPU instance BY HAND (terraform is a documented
     manual step; see wonderland/infra/README.md). This script launches nothing.
NEXT
