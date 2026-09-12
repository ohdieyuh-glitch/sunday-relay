# Ceremony transport — brand/documentation candidate

Carrier branch only. **Nothing here is proposed for `main`.** It exists so the
founder can run the Worker App ceremony from the trusted Codespace without
locating, pasting or handling a token by hand.

| | |
|---|---|
| candidate branch | `claude/sunday-relay-brand-docs-imb2bk` |
| trusted base | `7982593526ffe9c86676991715201d84a096cfa2` (squash of #256) |
| frozen head | `03d79b92334be277d4d6f4053e11b944f278bc26` |
| frozen tree | `487a25f783ddddc60df994e554efdd8b48f25fb4` |
| commits | 1, authored **and** committed by `julius-worker[bot]` |
| changes | `README.md`, `docs/documentation-contract.test.ts` — nothing else |

## Defect found on PR #255, and fixed here

The first version of `julius-worker-open-pr.sh` defaulted `PR_BODY_FILE` to the
empty string while this directory shipped a prepared `pr-body.md` and this file
claimed the body was prepared. **PR #255 was opened with `"body":""`, and GitHub
reported it as null.** Nothing errored; the package simply did not do what it
said.

Three changes so it cannot recur:

1. The body now defaults to `pr-body.md` beside the script, not to nothing.
2. A missing or empty body **refuses**, before any credential is touched — a
   pull request is a review record, and posting silence into one is worse than
   stopping.
3. A body carrying `P1`, `critical` or `high` refuses too. Those are
   `scripts/julius-review-currency.mjs`'s `BLOCKING_MARKERS`, and a body
   carrying one invites a false blocker.

`--set-body <pr-number>` repairs an already-open PR's body **as the worker
App**, which is why the correction is not simply made by hand: the founder is
the separate approver and must not also author the record they approve. It
moves no commit, no head and no base, and leaves the title alone.

## Re-pinned 2026-09-12

Main moved under the candidate while PR #255 sat open — #256 landed on
`9f155b91` and made it `79825935`. The candidate was replayed onto the new
trusted main (never merged from the stale base), fully re-gated, and re-frozen;
these SHAs and the PR body's Base/Head/Tree lines were re-pinned to match. That
drift is exactly what this script's stale-base refusal exists to catch.

## Run it

In the trusted Codespace, which already holds `JULIUS_WORKER_APP_ID` and
`JULIUS_WORKER_APP_PEM` as persistent secrets:

```bash
./ceremony/julius-worker-open-pr.sh                       # verify only — default
./ceremony/julius-worker-open-pr.sh --open-pr             # opens the PR as julius-worker[bot]
./ceremony/julius-worker-open-pr.sh --set-body 255        # repairs #255's empty body as julius-worker[bot]
```

The PEM is never printed, never written to disk and never asked for: it is read
once from the environment into `openssl` through a process substitution. The
minted installation token is never printed either.

## The App id is not the bot user id

`docs/JULIUS_WORKER_PR_RUNBOOK.md` calls `325202980` the "App id". It is not —
that is the **bot user** id, the one GitHub reports as `user.id` for
`julius-worker[bot]` and the prefix of its noreply commit email. A JWT signed
with `iss: 325202980` authenticates as nothing. `JULIUS_WORKER_APP_ID` is
`4838349`, and the script asserts the PEM resolves to the slug `julius-worker`
so a wrong id fails by name instead of as an opaque 401.

## What it refuses

It fails closed, before minting anything, if the remote branch head is not the
frozen head, if `main` has moved off the frozen base, if the tree differs, if
the commit count is wrong, if any commit is not authored **and** committed by
the worker App, if a merge commit is present, or if any file outside the two
documentation files changed.

## What it will never do

Approve, merge, enable auto-merge, or touch repository metadata. The worker App
must not approve or merge its own pull request; founder exact-head approval is
a separate act by a separate identity. The GitHub repository description is not
part of the squash and is updated only after the pull request lands and
`julius:main-provenance` reads `provenant`.
