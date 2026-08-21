#!/usr/bin/env bash
# Every offline Marble check, in one command. No network, no credits, no engine.
#
# There are three suites because there are three different things to be wrong
# about: the vendor contract (marble_offline_test), what reaches the level
# (import_offline_test), and what must never reach a paid generation
# (dog_separation_test). Running them separately is how one of them gets
# forgotten.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
RC=0
for suite in marble_offline_test.py import_offline_test.py dog_separation_test.py; do
  printf '\n=== %s ===\n' "$suite"
  if ! python3 "$HERE/$suite"; then
    RC=1
    printf 'FAILED: %s\n' "$suite" >&2
  fi
done
printf '\n'
if [ "$RC" -ne 0 ]; then
  echo "MARBLE OFFLINE SUITES: FAILED" >&2
else
  echo "MARBLE OFFLINE SUITES: all green"
fi
exit "$RC"
