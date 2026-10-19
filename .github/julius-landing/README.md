# Julius autonomous landing (founder-governed directory)

Everything in this directory, and `.github/workflows/julius-land.yml`, is founder-governed: the lander refuses to merge any PR that touches it.

Operation: the Independent Reviewer signs a clearance (`reviewer-tools.mjs sign`), MAIN JULIUS dispatches `Julius land` with the clearance and signature; the job verifies, waits for CI, and squash-merges pinned to the cleared head. `dry_run` defaults to true; only the exact string `false` merges.

Facts to remember:
- A merge made with the workflow's GITHUB_TOKEN triggers NO further workflows. Accept-main, the hold check, ledger rows and paid dispatch are run by MAIN JULIUS after each landing, as before.
- Exit code 2 means the merge happened but the landed commit is not the cleared tree: it is an ALERT, not an undo. Manual rollback: `git revert <landed sha>` through the normal founder-governed path, then accept-main at the revert commit.
- The GitHub App `julius-worker` must NOT have the `workflows` permission; the founder confirms this when installing, and the permission list is recorded in the installing PR.
- The reviewer's key: only the PUBLIC key is committed (`reviewer-ed25519.pub`). A placeholder is refused until the reviewer replaces it.
- `governed-exceptions` in a clearance lets the reviewer permit a change to `scripts/julius-live-contract-check.mjs` (spend ceilings) or `relay-bridge/julius/role-effort.test.ts` (effort tripwire) for one PR; every other governed path is refused with or without a clearance.
