# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-reviewer-envelope` |
| base | `74b9ee52cf42e499f88320836bf01b5ed348be10` |
| head | `fa194b583db7e56b10ef9051a0c78a206e7fd610` |
| tree | `9ae2b5265a111d7f18f866d19afc92929b23e0ed` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/reviewer-envelope-pr
    git checkout origin/ceremony/reviewer-envelope-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-reviewer-envelope-worker-pr.sh

## What this branch carries

Step 6 of the nine-candidate path. Originally frozen at `8b294c48` on `9f155b91`; rebased onto `74b9ee52` after #256–#261 and re-authored as `julius-worker[bot]`. Patch-identical to `8b294c48` in every file except the GENERATED `JULIUS_HARNESS_MANIFEST.md`, which was regenerated with `npm run julius:harness:export` on the new base: it records the same one new edge (the bridge provider stack reading the kernel), counted from 3 to 4 instead of 2 to 3. This is the candidate that sets one pipeline attempt per normal review stage (plan, build, guidance: 3 × 1).
