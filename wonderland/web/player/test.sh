#!/usr/bin/env bash
# The player's offline gates. No browser, no GPU, no stream.
set -u
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RC=0
for suite in keys.test.mjs feed.test.mjs page.test.mjs; do
  printf '\n=== %s ===\n' "$suite"
  if ! node "$HERE/$suite"; then RC=1; printf 'FAILED: %s\n' "$suite" >&2; fi
done
exit $RC
