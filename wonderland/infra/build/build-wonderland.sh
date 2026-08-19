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
  grep -o "\"$1\"[[:space:]]*:[[:space:]]*[0-9]\+" "$BUILD_VERSION_FILE" 2>/dev/null \
    | grep -o '[0-9]\+$' | head -n1
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
compute_input_hash() {
  # sha256sum every input file, sort for stable order, hash the digest list.
  find "$PROJECT" "$SRC_DIR" "$CFG_DIR" "$WORLD_DIR" -type f -print0 2>/dev/null \
    | sort -z \
    | xargs -0 sha256sum 2>/dev/null \
    | sha256sum | cut -d' ' -f1
}
INPUT_HASH="$(compute_input_hash)"
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
run_step "build-editor" "$RUNUAT" BuildEditor -project="$PROJECT" -notools

# --------------------------------------------------- 3. generate the starter Hub level
# Milestone-1 placeholder content via Editor Python, so the packaged build
# renders a REAL scene rather than an empty map. Milestone-2 art replaces the
# placeholders in-Editor on a GPU workstation. Owned by generate-hub-level.py
# (do not inline it here).
LEVEL_OK=1
if [ -x "$UE_EDITOR_CMD" ]; then
  GEN_SCRIPT="$(cd "$(dirname "$0")" && pwd)/generate-hub-level.py"
  [ -f "$GEN_SCRIPT" ] || die "level generator missing: $GEN_SCRIPT"
  if ! run_step "generate-hub-level" "$UE_EDITOR_CMD" "$PROJECT" -run=pythonscript \
        -script="$GEN_SCRIPT" -unattended -nop4; then
    LEVEL_OK=0
  fi
else
  log "WARNING: $UE_EDITOR_CMD not present; skipping level generation"
  LEVEL_OK=0
fi
if [ "$LEVEL_OK" != "1" ] && [ "$ALLOW_EMPTY_LEVEL" != "1" ]; then
  die "level generation did not complete and ALLOW_EMPTY_LEVEL != 1; refusing to package a contentless build silently"
fi

# --------------------------------------------------- 4. compile client + cook/stage/pak
# PixelStreaming2 is enabled in the .uproject, so the packaged build launches
# with -PixelStreamingURL. This step compiles the Wonderland C++ module for the
# first time against real UE 5.8 API signatures — expect first-build fixups
# (docs/relay/WONDERLAND.md §12). It is a BUILD, not a deploy: it uploads and
# launches nothing.
run_step "build-cook-run" "$RUNUAT" BuildCookRun \
  -project="$PROJECT" \
  -platform="$PLATFORM" \
  -clientconfig="$CONFIG" \
  -nop4 -build -cook -stage -pak -archive \
  -archivedirectory="$OUT" \
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
