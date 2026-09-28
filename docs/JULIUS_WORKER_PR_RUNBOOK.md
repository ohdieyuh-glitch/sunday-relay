# Landing the 34186711214 repair as a worker-authored PR — founder runbook

> **Who runs this:** the founder, on a machine that holds the `julius-worker`
> GitHub App credential. **The App id is `4838349`** — read from `GET /app` on
> 2026-09-27, which answers slug `julius-worker`, owner `ohdieyuh-glitch`. Until
> that date this line said `325202980`, which is the BOT USER id (it is the number
> in `325202980+julius-worker[bot]@users.noreply.github.com`, and that email stays
> correct). A JWT minted with `325202980` as its `iss` is not this App, so the
> next operator to follow this line would have met `404 Integration not found` at
> the first call and had nothing to tell them why. The installation on
> `ohdieyuh-glitch/sunday-relay` is `159218171`, `repository_selection: selected`,
> granting `contents=write`, `pull_requests=write`, `issues=write`,
> `actions=read`, `metadata=read`, `statuses=read` — enough for steps 1 and 2 and
> deliberately not enough to merge.
> **Why a runbook:** the fix is complete and gated on branch
> `relay/julius-architect-gate-fix` at `d8c9fab1`, but its eight commits are
> authored `Claude <noreply@anthropic.com>` and every environment that produced
> them holds the review authority's credential, not the worker's. The
> provenance gate (`scripts/julius-main-provenance.mjs`) requires the landed
> pull request's **author** to be `julius-worker[bot]` and its **approver** to
> be a different login. This is the shortest honest path from the branch to a
> trusted `main`.

Everything marked **verified** below was read from the repository or the
GitHub API. Everything marked **standard mechanics** is the ordinary GitHub App
flow and was not exercised from the cloud session, which has no App credential.

> **THE PATH WAS WALKED, 2026-09-09 — PR #237.** This runbook is no longer a
> proposal. A session holding the App credential followed it and opened
> [#237](https://github.com/ohdieyuh-glitch/sunday-relay/pull/237):
>
> | | |
> |---|---|
> | author | `julius-worker[bot]` (App id 4838349, bot user id 325202980) — the provenance route's requirement, met |
> | head | `ebcebe1842b555efcf154ce295ae706fc25f4e7c` |
> | tree | `868bf1c97d61b0d462945456a843b6e668beda45` — **identical** to the reviewed `d8c9fab1`, `git diff` empty |
> | shape | 8 commits over `main` `872f1790`, one identity line, App as author AND committer |
> | branch | `relay/julius-architect-gate-fix-worker` |
>
> The reference branch was never touched. Step 1's re-authoring produces a
> different commit sha each time it is run (committer timestamps move) and the
> same TREE every time — which is exactly what the tree-equality rule is for,
> and why the sha in a PR body is stale by construction while the tree is not.
>
> **The one thing to watch.** #237's approval body quoted a 42-character sha —
> two characters too many. The binding that matters is the review's `commit_id`,
> which was correct; the prose was not. Read the `commit_id`, never the body.

## What is being landed — verified

| | |
|---|---|
| branch | `relay/julius-architect-gate-fix`, head `d8c9fab1e120fa99e6fe3944eb9aa8bd2601169e` |
| base | `origin/main` = `872f1790465c4d519d9a89c7e525fdaf23f5c3d0` (PR #234's squash) |
| shape | 8 commits, 13 files, +1,703 / −29 |
| PR body | `docs/JULIUS_ARCHITECT_GATE_PR.md` on the branch; its `Head SHA:` line reads `6e3ccd39…`, one commit stale by construction (the body cannot name the commit that contains it) |
| title | `Julius: the architect and reviewer refusals of paid run 34186711214` |
| commits, oldest first | `98a4a002` the aimed rule, the surviving diagnostic, the charter · `2f729388` test: auth precondition established · `7b2150fb` test: consume the provoked rejection · `5127618a` a refused plan is corrected once · `adb3c750` the reviewer's one bounded correction · `8c7ae60e` a correction is a spend · `6e3ccd39` test: pin run 34186711214's plan shape · `d8c9fab1` docs: the PR body |

How #234 was authored — **verified** from its commits: author AND committer
`julius-worker[bot] <325202980+julius-worker[bot]@users.noreply.github.com>`
on every head commit, `merged_by` `ohdieyuh-glitch`, squash on `main` keeps
the App as author with `GitHub` as committer.

## Step 0 — do not touch the reference branch

`relay/julius-architect-gate-fix @ d8c9fab1` is the reviewed reference. Work on
a **new** branch; never rebase, amend or force-push the reference.

## Step 1 — re-author the eight commits as the App — **verified by dry run**

```bash
git fetch origin main relay/julius-architect-gate-fix
git checkout -B relay/julius-architect-gate-fix-worker origin/relay/julius-architect-gate-fix

# The branch is already based on origin/main (872f1790), so this rewrites
# authorship only. --reset-author takes the author from the -c identity, and
# --amend sets the committer to it as well.
WORKER_NAME='julius-worker[bot]'
WORKER_EMAIL='325202980+julius-worker[bot]@users.noreply.github.com'
git -c user.name="$WORKER_NAME" -c user.email="$WORKER_EMAIL" rebase origin/main \
  --exec "git -c user.name='$WORKER_NAME' -c user.email='$WORKER_EMAIL' commit --amend --no-edit --reset-author"
```

These exact commands were dry-run in the cloud container on 2026-09-08 in a
throwaway worktree (never pushed, removed afterwards): all eight commits came
out with the App as author and committer, the tree was byte-identical to the
reference, the count was eight, and the reference branch was untouched.

Verify before pushing — all three must hold:

```bash
# 1. every commit is authored AND committed by the App
git log --format='%an <%ae> | %cn <%ce>' origin/main..HEAD | sort -u
#    → exactly one line: julius-worker[bot] <325202980+…> | julius-worker[bot] <325202980+…>

# 2. the tree is byte-identical to the reviewed reference
git diff --stat origin/relay/julius-architect-gate-fix HEAD
#    → (no output)

# 3. still exactly eight commits over main
git rev-list --count origin/main..HEAD
#    → 8
```

## Step 2 — push and open the PR **as the App** — standard mechanics

Mint an installation access token for the App on this repository (the
App-JWT → `POST /app/installations/{id}/access_tokens` flow, or whatever
minted #234's token), then:

**On Windows (mingw bash), two calls refuse a POSIX idiom.** `openssl` will not
take a PEM through process substitution, and `curl` cannot read `-H @/dev/fd/3`:
it answers `Failed to open /proc/<pid>/fd/3`. Both need a real path, so the
Authorization header goes in a `mktemp` file at mode 600, removed by an `EXIT`
trap — not on a command line, where a process list would carry the token.

```bash
# Authenticate gh AND git from the App's token, read from a file or a prompt —
# never pasted into a URL or a shell history line. (The repository's boundary
# scanner refuses inline-credential URLs in any file, docs included.)
gh auth login --with-token < /path/to/installation-token     # the App's token, never the founder's PAT
gh auth setup-git                                             # git pushes use gh's credential helper
git push origin relay/julius-architect-gate-fix-worker

# The committed body names a stale head by construction; rewrite that one line
# to the pushed head in a temporary copy and open with it.
sed "s/^Head SHA: .*/Head SHA: \`$(git rev-parse HEAD)\`/" docs/JULIUS_ARCHITECT_GATE_PR.md > /tmp/pr-body.md
gh pr create --base main --head relay/julius-architect-gate-fix-worker \
  --title "Julius: the architect and reviewer refusals of paid run 34186711214" \
  --body-file /tmp/pr-body.md
```

Verify the author before anything else:

```bash
gh pr view --json number,author --jq '{number, login: .author.login, is_bot: .author.is_bot}'
#    → login "app/julius-worker" (or "julius-worker[bot]"), is_bot true
```

If the author is `ohdieyuh-glitch`, the token was the founder's. **Close that
PR** — merging it would make `main` `unprovenanced` and block every paid run —
and mint the App token again.

## Step 3 — review and merge as the founder — verified requirements

1. Wait for CI on the PR head. (The branch was green in the cloud container
   on every gate; CI is the authority.)
2. Approve as `ohdieyuh-glitch` **at the PR's head SHA** — the review's
   `commit_id` must equal the head that merges (review currency).
3. Squash-merge at that exact head:

```bash
gh pr merge <number> --squash --match-head-commit "$(git rev-parse HEAD)"
```

4. Confirm the landing the way the gate will:

```bash
git fetch origin main
git rev-parse origin/main^{tree}            # must equal …
git rev-parse relay/julius-architect-gate-fix-worker^{tree}   # … this
git rev-list --count origin/main^@          # 1 parent: a squash
```

No `julius-accept-main` dispatch is required for monotonicity: the existing
checkpoints (`f131098c`, `67ade6ea`) stay contained in a forward-merged `main`.
Dispatching it anyway records a fresh checkpoint and costs nothing.

**If `main` moves before the merge** (anything else lands first), the gate's
"pre-merge parent contained in the reviewed candidate" rule will refuse a head
that does not contain the new `main`. Then, as the App on the worker branch:
`git rebase origin/main` (the tree-identity check against the reference no
longer applies; re-run the three Step 1 verifications for identity and count),
push, wait for CI, **re-approve at the new head**, and squash-merge at that
head. Never merge an approval that names an older head.

### Verifying the landing FROM A MACHINE WITH NO `gh` — verified 2026-09-09

All three gates are pure rules behind `gh api` fetchers, and a Claude Code cloud
container has no `gh`. Each now takes `--evidence <file>`: the same rule, fed
the same object from JSON gathered however the operator can gather it (here,
through the GitHub MCP tools). It is not a weaker mode — an omitted field
arrives `undefined` and every rule answers indeterminate rather than passing,
proven field by field in each gate's tests — and every output line carries
`source=github` or `source=file:<path>` so a fed verdict is never mistaken for
a fetched one.

```bash
node scripts/julius-review-currency.mjs  <owner/repo> <pr>    --evidence <file>
node scripts/julius-main-provenance.mjs  <owner/repo> [main]  --evidence <file>
node scripts/julius-main-monotonicity.mjs <owner/repo> [main] --evidence <file>
```

| Gate | Fields the file must carry |
|---|---|
| review currency | `headSha`, `headShaAfter`, `reviews`, `reviewComments`, `statuses`, `pullAuthorLogin`, `baseSha`, `baseShaAfter`, `baseContainedInHead` |
| provenance | `mainSha`, `mainShaAfter`, `mainTreeSha`, `mainParents`, `pullRequests`, `reviewedTreeSha`, `reviewedHeadShaAfter`, `reviews`, `reviewComments`, `statuses`, `parentContainedInReviewedHead`, `baseRefChanged` |
| monotonicity | `mainSha`, `mainShaAfter`, `acceptedShas`, `containment` |

Run against PR #237 before its merge, this is what the real rule said — not a
person restating it:

```
pr=ohdieyuh-glitch/sunday-relay#237 source=file:… review_currency=current
base_integration=integrated merge_eligible=true
head=ebcebe1842b555efcf154ce295ae706fc25f4e7c approved_by=ohdieyuh-glitch
```

### The NEXT worker PR is the contract stack

`relay/julius-contract-stack-rebased` follows this repair through the same
runbook, with two differences: **50 commits** in place of 8, and a rebase first.
`docs/JULIUS_STACK_REBASE_NOTES.md` holds the recipe, re-verified on 2026-09-09
against the shape #237 lands — three known conflicts, three known resolutions,
all three typechecks and the whole 9,759-test suite green on the result.

Every rule the gate applies, for reference (`scripts/julius-main-provenance.mjs`):
`main` readable and still while the check runs · exactly one parent (a squash)
· exactly one merged PR records that commit as its merge result · that PR's
base is `main` and its base never changed · its author is `julius-worker[bot]`
· `main`'s tree equals the PR head's tree · the pre-merge parent is contained
in the PR head · plus review currency (an `APPROVED` review by a different
login bound to that exact head).

## Step 4 — nothing else

The cloud session's hourly watch (`trig_01PvdqADjSgk5aUH9dvugJEZ`, :35 UTC)
notices the PR (reports `FOUNDER ACTION REQUIRED — PR #n` while it is open) and
the landing; on landing it verifies containment, provenance, monotonicity and
review currency through the GitHub API and reports what it found. The record
goes to `docs/handoffs/JULIUS_CURRENT.md`.

**IT DOES NOT SPEND, AND THIS PARAGRAPH USED TO SAY IT DID.** Until 2026-09-09
it read "runs the zero-spend preflight … and, if green, dispatches the paid
rerun … under the founder's standing authorization", and the standing
authorization was real. It was withdrawn after paid run 34311556047, whose
lesson was not that the run failed but that it was dispatched to answer no
question — a new `main` sha is not a causal question, and spending on one buys
nothing a reader can use. The watcher may inspect `main`, inspect worker PRs,
verify provenance, verify a review's `commit_id`, verify tree equality, verify
monotonicity and report founder actions. It may not dispatch a preflight, may
not dispatch a paid mission, and may not infer paid authorization from a new
`main` sha.

Every paid mission now needs three things before it is dispatched: a specific
causal or evidentiary question, a justified reason that answering it needs
provider spend, and explicit founder authorization for that run.

## Never

- open, approve or merge this PR with a credential that maps to
  `ohdieyuh-glitch` in any coding environment — that is the credential finding
  in `docs/handoffs/JULIUS_CURRENT.md` §00a, and a PR opened that way fails
  provenance at `julius-main-provenance.mjs`;
- rebase the branch onto anything other than `872f1790` before review — the
  base the reviewer saw must be the base that merges;
- weaken `WORKER_AUTHOR_LOGINS`, `EXTERNAL_APPROVER_LOGINS` or the tree-equality
  check to make a differently-authored branch admissible.
