# v6 clone ref census: summary (2026-10-23, PT)

Source: `v6_refcensus.csv`. It was taken read-only at about 01:33 PT against `git ls-remote` of `ohdieyuh-glitch/sunday-relay` (649 heads) and sunday-relay's already-fetched `origin/*` refs, with no fetch. Coverage classes:
- **tip**: the commit is exactly a GitHub branch head.
- **ancestor**: the commit is contained in a GitHub branch head (sunday-relay `origin/*` ref whose SHA equals ls-remote).
- **not**: neither.

## Refs (487 total)

| Namespace | Total | tip | ancestor | not |
|---|---|---|---|---|
| refs/heads | 139 | 137 | 2 | 0 |
| refs/juju2 | 30 | 30 | 0 | 0 |
| refs/tags (4 lightweight, 1 annotated) | 5 | 0 | 5 | 0 |
| refs/remotes (origin = local sunday-relay) | 313 | 165 | 40 | 108 |
| refs/stash, refs/notes, other | 0 | 0 | 0 | 0 |
| **Total** | **487** | **332** | **47** | **108** |

- **Ancestor total = 47**: 40 remotes + 2 heads (`ju-main-5004713`, `mainr`, both inside `backup/julius-m2/m2-remerge-5004713`) + 5 tags. The earlier report's "40" counted remotes only.
- Heads at tip (137), as labelled in `v6_refcensus.csv` (one GitHub branch name per SHA): **88 at `backup/julius-v6/*`, 38 at `backup/review-20261013/*`**, and 11 at other existing GitHub branches. All 126 of the first two groups also have a same-named `backup/julius-v6/<branch>` at the same SHA. The 38 commits are tips of both `backup/review-20261013/*` and `backup/julius-v6/*`, and the CSV label shows the review name. (Rechecked against ls-remote at 02:25 PT, Oct 23. The earlier "126 backup/julius-v6/* tips" counted the same-name match, not the label.)
- Tags: all 5 names exist on GitHub (`ls-remote --tags`) pointing to the same object, and each tag's commit is also inside a GitHub branch.
- `git stash list` = 0. `git worktree list` = 15.
- The 108 "not" refs are v6 copies of **sunday-relay local branches** (v6's origin is the local sunday-relay repo). All 108 exist in sunday-relay at the same tip (`v6_uncovered_in_sr.csv`). After the census, 36 of them were pushed as `backup/sr-unpushed/*` and verified. **72 were withheld: secret pattern** (`sr_unpushed_verify.csv`, `sr_unpushed_withhold_detail.csv`) and exist only in the local sunday-relay repo.

## Worktrees attached to v6 (`v6_worktrees.csv`)

15 worktrees: **6 clean, 9 dirty**. None is locked or prunable, and every path exists. Every HEAD is on GitHub: 11 at a tip, 4 as an ancestor.

Per-file detail: `v6_worktree_files.csv`, **captured 2026-10-23 02:25:56 PT / 2026-10-23T09:25:56Z (UTC)**. It has 89 dirty-file rows across the 9 dirty worktrees: 6 backed up (`backup/julius-untracked/<wt>`, same path and blob), 79 not backed up, and 4 withheld secret-pattern paths that were not hashed (opt2 ×2, plus `command-runner-partial-secret.test.ts` in stack and stack2).

Uncommitted state that is **not** backed up anywhere (a v6 removal would lose it):
- combo_v32: 11 tracked changes
- g1m: 1 tracked change
- stack: 33 tracked changes (1 of them is a secret-pattern path)
- stack2: 33 tracked changes (1 of them is a secret-pattern path)
- v33: 3 tracked changes
- opt2: 2 untracked files withheld for secret patterns

The untracked files in opt2 (2), pm (1), psfix (2) and v6pm (1) are backed up on `backup/julius-untracked/<wt>` (`untracked_hashobject.csv`, 16/16 match).

Status was read with `GIT_OPTIONAL_LOCKS=0` and `git status --porcelain=v1 -uall`, so no index-cache refresh was written.
