# Ceremony transport — NOT a landing candidate

Orphan branch. It shares no history with `main` and must never be merged.

| | |
|---|---|
| branch | `relay/julius-coder-participation` |
| base | `f3fa988b03c3561208f42d7c3ea18df0e855c348` |
| head | `12d8efa2b884c9b69a1d945ce19bb2033742e3e2` |
| tree | `bb85c22e478dc060745ff4328529b96c05d40851` |
| commits | 1, authored AND committed by `julius-worker[bot]` |

## Use

    git fetch origin ceremony/coder-participation-pr
    git checkout origin/ceremony/coder-participation-pr -- ceremony/
    export JULIUS_WORKER_APP_ID=<the App ID>
    # JULIUS_WORKER_APP_PEM must already be in the shell
    bash ceremony/open-coder-participation-worker-pr.sh

**`JULIUS_WORKER_APP_ID` is NOT `325202980`** — that is the bot's USER id, where
the commit address comes from. The App ID is a much smaller number on the app's
settings page; the script refuses `325202980` by name.

The opener re-verifies base, head, tree, commit count and the authorship of
every commit against the real remote **before** it touches GitHub, refuses if a
PR for the branch is already open, takes its title from the body's `# ` heading
rather than a literal, and prints no credential material.

## What this one is

The continuous three-worker lifecycle has been complete in the domain and
unreachable in production. `driveContinuousLifecycle` runs only when a dispatch
result carries `guidanceRequest`, `guidance` or `researchAsks`, and on trusted
main no live adapter carried any of the three — the strings appear nowhere in
`relay-bridge`. The architect can answer a guidance task; a guidance task is
minted only from a coder's request; no coder could make one.

So on every paid mission the Coding Agent's only way to be stuck was to finish
anyway, and a mission granted research would have sealed a policy nothing could
consult.

This gives the hosted Coding Agent one bounded way to ask, through the only
structured thing it returns: the text of its final message. The transport
decides nothing — every request is handed on exactly as written for the domain
sanitizers to refuse. Ambiguity is refused rather than resolved. An unreadable
block never fails the dispatch and never vanishes from the record. Unknown stays
unknown.

**It authorises nothing.** No research grant exists on this base and no contract
declares a research clause; every retrieval is still refused by the same gates.
What changes is that a worker can ask, and be refused on the record instead of
silently.

## Why it matters now

It is the precondition for the first continuous paid qualification, whose whole
shape is *ask rather than guess*. Dispatching that mission against a main where
no worker can ask would have bought a predictable failure.

## Eleven candidates, ten published

Ten are on base `9f155b91` and independent of one another —
`participant-isolation`, `architect-envelope`, `ending-diagnostics`,
`reviewer-envelope`, `research-authority`, `coder-stream-usage`,
`research-attempt`, `guidance-delivery`, `live-timeline`, and this one. Any
order works; the first to land moves `main` and every other opener then refuses
on a stale base until it is rebased and re-frozen. That refusal is the safety
property working, not a fault.

`worker-deadline` is the eleventh and is held: it is stacked on
`reviewer-envelope` and must not be opened before it.

### Rebase overlaps for THIS candidate, measured rather than guessed

| file | also changed by |
|---|---|
| `.github/julius-live-evidence-dump.sh` | `ending-diagnostics`, `coder-stream-usage`, `research-attempt`, `guidance-delivery` |
| `relay-bridge/julius/live-workers.ts` | `ending-diagnostics`, `coder-stream-usage` |
| `src/relay/mission/julius/julius-router.ts` | `ending-diagnostics`, `coder-stream-usage` |
| `relay-bridge/julius/julius-live-composition.test.ts` | `architect-envelope`, `reviewer-envelope`, `coder-stream-usage` |
| `relay-bridge/julius/julius-peer-qualification.e2e.test.ts` | `architect-envelope`, `guidance-delivery` |
| `JULIUS_HARNESS_MANIFEST.md` | `reviewer-envelope`, `research-authority`, `live-timeline` |
| `scripts/export-julius-harness.mjs` | `live-timeline` |

`JULIUS_HARNESS_MANIFEST.md` is **GENERATED**. Whichever candidate lands second
must resolve it by running `npm run julius:harness:export` in the rebased
worktree and committing what that writes — never by hand-editing the file or
taking one side of the conflict.

The evidence dump and `live-workers.ts` overlaps are additive in every case:
each candidate appends its own columns or its own block, and a rebase keeps
both sides.

## After it lands

    node ceremony/verify-landing.mjs --repo <checkout> --evidence <file>

built from `ceremony/build-evidence.py` and `ceremony/github-field.py`. All ten
checks must read PASS; an absent field reads INDETERMINATE and never PASS.

## Re-frozen 2026-09-12

Rebased onto `f3fa988b03c3561208f42d7c3ea18df0e855c348` (after #256 participant-isolation and #257 research-authority) and re-authored as `julius-worker[bot]`. Patch-identical to the original frozen head `1519cae3` (`git patch-id --stable`); only the base moved. Any text above naming base `9f155b91` describes the state before those landings.
