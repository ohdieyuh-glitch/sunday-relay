# Wonderland landing route (2026-10-23)

Author: Cosmo (Wonderland dev agent). Status: proposal for Skywalker's exact-head review.
Every citation is `file:line` at main `689d2be92c3158ba4a59883ed4f6cc02f700660b` (tree `ecfe4f5c`, parent `3f20fc1a`),
re-read line by line before writing. Corrections to earlier citations are listed in section 7.

## 1. Context

- Founder ruling (2026-10-23, about 4:10 AM PT): Wonderland changes land through the Julius landing
  process, and main stays provenant.
- The provenance gate (`scripts/julius-main-provenance.mjs`) judges only main's tip commit:
  - exactly one parent, i.e. a squash (`:355-362`);
  - exactly one merged PR records the tip as its merge result (`:388-401`), base `main` (`:417-421`), base never changed (`:441-448`);
  - the PR opener is a worker login (`:450-454`; opener read from `pull.user.login` at `:649`; `WORKER_AUTHOR_LOGINS` at `:57`);
  - exact-head approval (review currency, `:469-481`);
  - main's tree equals the reviewed head's tree (`:491-495`);
  - the pre-merge parent is contained in the reviewed head (`:506-516`).
- Governance: "Source changes go through the worker and are approved by the founder at an exact sha"
  (`docs/REPOSITORY_GOVERNANCE.md:363-364`).
- Note: the current tip `689d2be9` is the #394 squash, git author `Kaisin Rogodfree`. Skywalker should confirm
  main's provenance verdict at `689d2be9`. The first worker-PR squash under this route also serves as the
  restoration PR described at `docs/REPOSITORY_GOVERNANCE.md:325-328`.

## 2. What the route enforces, and what it trusts

**Identity checks the squash route actually enforces:**
- The PR opener is `julius-worker[bot]` (`julius-main-provenance.mjs:450`, read from `user.login` at `:649`).
- An `ohdieyuh-glitch` review approves the exact head:
  - `scripts/julius-review-currency.mjs:269-272` (`commit_id === headSha`, authority check);
  - the approver list is at `:59`;
  - the approver may be neither a non-attesting (bot) identity nor the PR author (`:246-252`).

**Never checked on this route:** the commit author field, `merged_by`, the ed25519 reviewer key, and `allowed-branches.txt`.
- The commit author is set by `--amend --reset-author` (`docs/JULIUS_WORKER_PR_RUNBOOK.md:79-82`). That is the same
  free-text pattern as `3f20fc1a`, whose message says "Made by the founder with git commit-tree" while GitHub
  resolves its author to `julius-worker[bot]`.
- The author field is not treated as proof of worker authorship, pending the founder's ruling on Skywalker's
  author-spoofing finding (open item b).

**Trust statement:**
- The founder holds the App credential (`RUNBOOK:3-4`) and is also the required approver.
- "App-opened" proves an App token was used. It does not prove a worker did the work.
- In practice the opener and the approver are the same person. **This is NOT two-party control.**
- The independent links are:
  1. the pre-merge check that the PR head's tree equals the tree Skywalker cleared;
  2. Skywalker's exact-head PASS.

## 3. Default route: worker-PR squash

Source: `docs/JULIUS_WORKER_PR_RUNBOOK.md`
- step 1, re-author: `:70-104`
- step 2, push and open as the App: `:106-143`
- step 3, approve and squash: `:145-164`
- main moved before the merge: `:170-176`

1. **Develop.** Cosmo develops on any `wonderland/*` branch. Cosmo-authored commits there are never landed as they are.
2. **Clear.** Skywalker clears the exact tree and records the tree sha.
3. **Re-author as the App (founder).**
   - Where: a machine holding the `julius-worker` App credential. App id `4838349` is at `RUNBOOK:4`; installation `159218171` is at `RUNBOOK:11`.
   - **Token.** The founder mints an installation token (`RUNBOOK:108-123`). The token is never printed or put on a
     command line (`:115-116`, `:119-121`).
   - **Re-author onto current main.** Runbook step 1 rebases onto main and re-authors each commit, keeping the commit
     count (`RUNBOOK:79-82`, `:101-103`). So the worker PR may carry the reviewed commits re-authored; it does not
     have to be one commit. The one-commit rule (`.github/julius-landing/land-lib.mjs:105`) applies to the lander
     only. The squash in step 7 yields one commit on main either way.
   - **Trailer.** Add `Co-authored-by: Cosmo (Wonderland dev agent) <cosmo@iwonder.invalid>`.
   - **Before pushing**, check that:
     - `git diff <cleared-tree> HEAD` is empty;
     - every commit is App-authored and App-committed (`RUNBOOK:93-95`);
     - the count matches (`:101-103`).
   - **Push and open the PR as the App** (`RUNBOOK:122-131`).
   - **Verify the PR opener is the App** (`RUNBOOK:134-139`). If the opener is `ohdieyuh-glitch`, close the PR and
     open it again with an App token (`RUNBOOK:141-143`).
4. **Required CI, with no workflow change.**
   - `julius-real-infra.yml`'s `pull_request` path filter (`.github/workflows/julius-real-infra.yml:3-4`) does not
     match `wonderland/**`, so its jobs do not start on a Wonderland-only PR.
   - The workflow has a `workflow_dispatch` trigger (`:5`).
   - The worker App holds only `actions=read` (`RUNBOOK:13`), so its dispatch is refused (403).
   - A write-capable identity dispatches `julius-real-infra.yml` once, on the worker branch at the exact PR head.
     The PR changes only `wonderland/**`, so the dispatched workflow file is main's unmodified file. The dispatcher
     confirms that the blob at the head equals main's blob before dispatching.
   - All 6 required checks (`.github/julius-landing/required-checks.txt:4-9`) must each appear exactly once,
     produced by app `15368` (GitHub Actions), and conclude `success` on that head. None is relaxed.
     - `Verify Relay`: `.github/workflows/relay-ci.yml:22`. It runs on `pull_request` to main (`:9-10`).
     - `sibling-control-plane`: `julius-real-infra.yml:9`.
     - `first-live-topology (executor-private|host-visible)`: `julius-real-infra.yml:167`, matrix at `:181-184`.
     - `real-infra-julius`: `julius-real-infra.yml:456`.
     - `learning-store-container`: `julius-real-infra.yml:513`.
   - The provenance gate itself does not check CI. Green CI is a runbook rule (`RUNBOOK:147-148`), and there is no
     branch protection (`julius-main-provenance.mjs:208`; `.github/workflows/julius-land.yml:5-6`). This route
     makes the 6 checks a hard precondition of steps 5 and 6.
5. **Exact-head PASS.** Skywalker verifies `head^{tree}` == the cleared tree, then posts a fresh PASS pinned to that head.
6. **Founder approval.** `ohdieyuh-glitch` approves on GitHub at that exact head (`RUNBOOK:149-150`).
   No agent approves on the founder's behalf.
7. **Squash with a SHA guard.** Run `gh pr merge <n> --squash --match-head-commit <head>` (`RUNBOOK:151-155`).
   If main moved first, re-cut on the new main, re-run CI, and get a fresh PASS and a re-approval (`RUNBOOK:170-176`).
8. **Verify the landing.**
   - The new main's tree equals the reviewed tree, with exactly one parent (`RUNBOOK:157-164`).
   - The pre-merge parent is contained in the reviewed head.
   - `node scripts/julius-main-provenance.mjs ohdieyuh-glitch/sunday-relay main` (`RUNBOOK:191`) must report `provenant`.

## 4. Not chosen

- **Lander route** (`julius-land.yml` with `land-lib.mjs`). It would need all of the following:
  - **A one-commit head.** The commit must be App-authored (`land-lib.mjs:104-112`), and #394 failed 6 PR checks and 7 CI checks in Skywalker's replay.
  - **An allowlisted branch.** The entries are at `.github/julius-landing/allowed-branches.txt:5-13`; `:1-2` are comments; the check is at `land-lib.mjs:113`.
    - One Wonderland-related branch is already allowlisted: `relay/julius-ask-route` (`:13`, the "Julius x Wonderland ask route", `:10`). It is not a general Wonderland branch.
    - Any new entry is a founder-governed edit, refused by the lander (`land-lib.mjs:21`, `:119-120`). On #395 such an edit goes through the G6 installer.
  - **A signed clearance.** It must be signed with the ed25519 reviewer private key whose public-key fingerprint is `b0b8e29b`. No file names the private-key holder.
    - The clearance field list is at `land-lib.mjs:30`.
    - Signing is `reviewer-tools.mjs:36-50`, and verification is `land-lib.mjs:62-69`.
    - The 24-hour cap is at `:7` and `:96`.

  It adds nothing over the squash route for Wonderland.
- **Adding `wonderland/**` to the path filter.** This is a `.github/workflows/**` change, so it would need the
  founder-install ceremony (`docs/REPOSITORY_GOVERNANCE.md:308-333`), and main would be unprovenanced in the meantime
  (`:321-324`). A `workflow_dispatch` run produces the same checks with no change.
- **Explicitly:** nothing in this route changes or weakens:
  - the author or opener checks (`land-lib.mjs:104-112`; `julius-main-provenance.mjs:450-454`);
  - CI (`required-checks.txt`; `land-lib.mjs:142-160`);
  - the clearance checks;
  - `WORKER_AUTHOR_LOGINS`, `EXTERNAL_APPROVER_LOGINS` or tree equality (`RUNBOOK:258-259`).

## 5. Open items

- **(a) Founder: which machine holds the `julius-worker` App credential?** Step 3 cannot run without it.
  No agent will search for it, read it or mint a token from it.
- **(b) Founder ruling on Skywalker's author-spoofing finding (medium-high).**
  - The commit-author checks (`land-lib.mjs:108`, `:112`) rely on a free-text name and on GitHub resolving the email.
  - Only the PR-opener check (`land-lib.mjs:104`; `julius-main-provenance.mjs:450`) truly requires the App.
  - Precedent: `3f20fc1a`.
  - This route does not rely on the author name. Its limits are stated in section 2.
- **(c) Vercel "Deployment was blocked" on #394 previews: resolved by the route.**
  - All of #394's commits were authored by `Cosmo <cosmo@iwonder.invalid>`, which GitHub links to no account.
    Vercel blocks private-repo deploys whose head author does not map to a team member
    (vercel.com/docs/deployments/troubleshoot-project-collaboration). This is from GitHub evidence and Vercel's docs;
    Vercel's own deployment text was not readable (403 scope).
  - Worker-authored heads #392 `5936fde4` and #389 `897c7138` deployed both projects, so a `julius-worker[bot]`
    re-author should pass. The effect of the `Co-authored-by` trailer is inferred and untested.
  - Previews of Cosmo-authored development branches are expected to be blocked. They are not among the required statuses.
- **(d) Concurrency.**
  - Each squash lands on current main, and the pre-merge parent must be contained in the reviewed head (`julius-main-provenance.mjs:506-516`).
  - So Wonderland re-cuts serialize with Julius landings, and any main move forces a re-cut, a fresh PASS and a re-approval (`RUNBOOK:170-176`).
  - Julius landings take priority near live runs.

## 6. Status

No readiness change. Wonderland verified readiness stays at 56.25%.

## 7. Citation corrections, from re-reading at `689d2be9`

- **The workflows ceremony `:308-333`** is `docs/REPOSITORY_GOVERNANCE.md:308-333`, not `land-lib.mjs`.
  `land-lib.mjs` has 317 lines, and its `:308` is `nonceUsed`.
- **App id and installation** are at `RUNBOOK:4` and `RUNBOOK:11`, not `:108-132`. `:108-123` is the token-minting text.
- **`allowed-branches.txt:1-2`** are comments. The entries are at `:5-9` and `:11-13`.
- **`land-lib.mjs:30`** is the clearance field list (`CLEARANCE_KEYS`), not a key. `b0b8e29b` is the public-key
  fingerprint (`.github/julius-landing/reviewer-ed25519.pub`). No file names the private-key holder.
- **"Runbook step 1 `:70-88`"** covers only the re-author commands and the dry-run note.
  - The step 1 verification is `:90-104`.
  - Step 1 keeps the commit count (`:101-103`); it does not squash to one commit.
  - Mint, push and open is `:106-143`.
  - Approve and squash is `:145-155`, with landing verification at `:157-164`.
- **The squash rule "~:491-519"** is two checks:
  - tree equality at `julius-main-provenance.mjs:491-495`;
  - parent containment at `:506-516`.
  
  `:518-527` is the `provenant` return.
- **Review-currency exact head** is `julius-review-currency.mjs:269-272`; the predicate lines are `:270-271`.
- **These held as given:**
  - `julius-real-infra.yml:4` (filter) and `:5` (`workflow_dispatch`);
  - `julius-main-provenance.mjs:215`, `:450-454` and `:649`;
  - `julius-review-currency.mjs:246-252`;
  - `land-lib.mjs:6`, `:7`, `:21`, `:96`, `:103-108`, `:112`, `:113`, `:117`, `:119-120` and `:126`;
  - `RUNBOOK:141-143` and `:250-259`;
  - `julius-land.yml:10-12`;
  - `reviewer-tools.mjs:36-50`.
