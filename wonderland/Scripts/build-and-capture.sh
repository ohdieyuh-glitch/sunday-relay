#!/usr/bin/env bash
# WONDERLAND — build + evidence capture for the first Unreal-capable session.
#
# Authored on a machine that CANNOT run Unreal; never executed here, and says
# so. It exists so the paid session runs ONE command for steps 2-5 of
# UNREAL_SESSION_CHECKLIST.md and leaves timestamped artifacts behind instead
# of relying on someone remembering to save logs.
#
# Usage:   UE_ROOT=/path/to/UnrealEngine ./build-and-capture.sh
# Output:  wonderland/Evidence/<utc-timestamp>/ …
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
UPROJECT="$HERE/Wonderland.uproject"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
EVIDENCE="$HERE/Evidence/$STAMP"
mkdir -p "$EVIDENCE"

fail() { echo "FAIL: $*" | tee -a "$EVIDENCE/summary.txt"; exit 1; }
note() { echo "$*" | tee -a "$EVIDENCE/summary.txt"; }

[ -n "${UE_ROOT:-}" ] || fail "Set UE_ROOT to the Unreal Engine install root."
[ -f "$UPROJECT" ] || fail "No Wonderland.uproject at $UPROJECT"

# Step 1 — Unreal available. The version is READ from the binary, not assumed.
UE_EDITOR="$UE_ROOT/Engine/Binaries/Linux/UnrealEditor"
[ -x "$UE_EDITOR" ] || UE_EDITOR="$UE_ROOT/Engine/Binaries/Win64/UnrealEditor.exe"
[ -e "$UE_EDITOR" ] || fail "No UnrealEditor under $UE_ROOT"
"$UE_EDITOR" -version > "$EVIDENCE/01-unreal-version.txt" 2>&1 || true
note "step 1: editor binary present; version captured"

# Step 2 — generate project files.
UBT="$UE_ROOT/Engine/Build/BatchFiles/Linux/GenerateProjectFiles.sh"
[ -e "$UBT" ] || UBT="$UE_ROOT/Engine/Build/BatchFiles/GenerateProjectFiles.bat"
"$UBT" -project="$UPROJECT" -game 2>&1 | tee "$EVIDENCE/02-generate.log"
note "step 2: project files generated"

# Steps 3+4 — compile and link the editor target. The build log IS the
# evidence; a zero exit with a missing binary is caught below rather than
# trusted ("exit code 0" is not "there is a build" — Relay's own rule).
BUILD="$UE_ROOT/Engine/Build/BatchFiles/Linux/Build.sh"
[ -e "$BUILD" ] || BUILD="$UE_ROOT/Engine/Build/BatchFiles/Build.bat"
"$BUILD" WonderlandEditor Linux Development -project="$UPROJECT" 2>&1 | tee "$EVIDENCE/03-build.log" \
  || fail "compile/link failed — the log is the finding"
BINARY="$(find "$HERE/Binaries" -name 'UnrealEditor-Wonderland.*' -newer "$EVIDENCE/02-generate.log" | head -1)"
[ -n "$BINARY" ] || fail "build reported success and produced no module binary"
ls -la "$BINARY" > "$EVIDENCE/04-linked-binary.txt"
note "steps 3-4: compiled and linked; binary recorded"

# Step 5 — the editor launches the project. Headless smoke: run one frame and
# exit. A real interactive launch + screenshot still belongs to a human.
"$UE_EDITOR" "$UPROJECT" -run=cook -targetplatform=Linux -unattended -stdout \
  > "$EVIDENCE/05-launch-smoke.log" 2>&1 || note "step 5 smoke returned nonzero — read the log before concluding"
note "step 5: launch smoke captured (interactive launch + screenshot is still step 5's human half)"

note ""
note "Steps 6-12 are interactive by nature (map authoring, input assets, play,"
note "Relay integration, GVE) — see UNREAL_SESSION_CHECKLIST.md. This script"
note "gets the session to the door of step 5 with evidence in $EVIDENCE."
