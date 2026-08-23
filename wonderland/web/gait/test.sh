#!/usr/bin/env bash
# The gait preview's checks. No GPU, no engine, no browser.
#
# What this proves: the browser's walk IS the engine's walk, and the Dog it
# walks is the canonical Dog rather than a retyped approximation of one. What it
# cannot prove is that the result looks right — that needs eyes on a frame, and
# capture-gait-frames.sh does that on a machine with a browser.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RC=0

# The generated inputs must be REGENERABLE and current, not just present. A
# committed table that no longer matches its source is the failure this whole
# arrangement exists to prevent, so both are re-derived and compared here.
echo "=== generated inputs are current ==="
if FRESH="$(python3 "$ROOT/wonderland/infra/build/emit-dog-body.py" 2>&1)"; then
  if [ "$FRESH" = "$(cat "$HERE/dog-body.json")" ]; then
    echo "  ok   dog-body.json is what WonderlandDogBody.cpp says today"
  else
    echo "  FAIL dog-body.json is stale — regenerate it from the C++" >&2; RC=1
  fi
else
  echo "  FAIL emit-dog-body.py failed: $FRESH" >&2; RC=1
fi

echo
echo "=== gait.parity.test.mjs ==="
if ! node "$HERE/gait.parity.test.mjs"; then RC=1; fi

printf '\n'
if [ "$RC" -ne 0 ]; then echo "GAIT PREVIEW: FAILED" >&2; else echo "GAIT PREVIEW: all green"; fi
exit "$RC"
