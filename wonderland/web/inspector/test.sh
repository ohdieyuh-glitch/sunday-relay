#!/usr/bin/env bash
# Every browser-inspector check, in one command. No GPU, no Lightning, no engine.
#
# Two suites because there are two different things to be wrong about: whether
# the browser places a point where Unreal places it (parity), and whether the
# verdicts actually fire on a world that is broken (diagnostics). A tool that
# renders a mesh beautifully and passes a flipped world is worse than no tool.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
RC=0

for dep in three cannon-es; do
  if [ ! -d "$ROOT/node_modules/$dep" ]; then
    echo "$dep is not installed — run 'npm install $dep' at the repo root." >&2
    echo "INSPECTOR SUITES: NOT RUN (dependency missing, which is not a pass)" >&2
    exit 1
  fi
done

for suite in parity.test.mjs diagnostics.test.mjs physics.test.mjs; do
  printf '\n=== %s ===\n' "$suite"
  if ! node "$HERE/$suite"; then RC=1; printf 'FAILED: %s\n' "$suite" >&2; fi
done

printf '\n'
if [ "$RC" -ne 0 ]; then echo "INSPECTOR SUITES: FAILED" >&2; else echo "INSPECTOR SUITES: all green"; fi
exit "$RC"
