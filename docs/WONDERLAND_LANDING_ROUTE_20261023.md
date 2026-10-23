# Wonderland landing route (2026-10-23)

Author: Cosmo (Wonderland dev agent). Status: proposal for Skywalker's exact-head review.
Revision 4: fixes [R3-1]..[R3-4] and the re-run answer [RR] from Skywalker's PASS WITH FINDING of rev 3 `cb68c692`, plus his
no-branch-protection note [BP] (see section 8.0).
Revision 3 fixed [R2-1]..[R2-4] from Skywalker's PASS WITH FINDING of rev 2 `aa7a5188` (section 8.1).
Revision 2 fixed [RD-1]..[RD-6] from Skywalker's FAIL of rev 1 `f3d6ebc7` (section 8.2). [RD-7] spoofing content is unchanged.
Every citation is `file:line` at main `689d2be92c3158ba4a59883ed4f6cc02f700660b` (tree `ecfe4f5c`, parent `3f20fc1a`),
re-read line by line before writing. Corrections to earlier citations are listed in section 7.

## 1. Context

- Founder ruling (2026-10-23, about 4:10 AM PT): Wonderland changes land through the Julius landing
  process, and main stays provenant.
- The provenance gate (`scripts/julius-main-provenance.mjs`) judges only main's tip commit:
  - exactly one parent, i.e. a squash (`:355-362`);
  - exactly one merged PR records the tip as its merge result (`:388-401`), base `main` (`:417-421`), base never changed (`:441-448`);
  - the PR opener is a worker login (`:450-454`; opener read from `pull.user.login` at `:649`).
    [RD-4] `WORKER_AUTHOR_LOGINS` at `:57` is only an alias. The list is defined at `scripts/julius-review-currency.mjs:38` as `NON_ATTESTING_IDENTITIES = ['julius-worker[bot]']`;
  - exact-head approval with no blocking finding on that head (review currency, `:469-481`; what it reads is in section 2, [R3-4]);
  - main's tree equals the reviewed head's tree (`:491-495`);
  - the pre-merge parent is contained in the reviewed head (`:506-516`).
- Governance: "Source changes go through the worker and are approved by the founder at an exact sha"
  (`docs/REPOSITORY_GOVERNANCE.md:363-364`).
- [RD-2] **Main is unprovenanced now.** The current tip `689d2be9` is the #394 squash, git author `Kaisin Rogodfree`.
  `julius-main-provenance.mjs` exits 1 on it (verified by Skywalker; exit code set at `:740`). Consequences until
  provenance is restored:
  - **No paid or live runs.** The live preflight requires `provenant` for the frozen main sha
    (`scripts/julius-live-preflight-gates.mjs:31`, enforced at `:193-194`).
  - **No new acceptance checkpoint.** `.github/workflows/julius-accept-main.yml:148-155` runs the provenance gate and fails.
- [BP] **No branch protection.** Skywalker reported that main has no GitHub branch protection. The repository is private on a
  plan with no branch protection and no rulesets (the API answers 403 "upgrade", `.github/workflows/julius-land.yml:5-6`;
  also `julius-main-provenance.mjs:208`). GitHub refuses nothing on main; only the landing checks guard it. The provenance
  gate judges main's tip after it moves, so it reports a bad landing rather than preventing one.

### 1.1 Ordering on main (normative) [RD-1]

1. **#395 installs FIRST.**
   - The founder issues the G6 token for #395: head `32c5a2be10c60a3a4c7de7741a98bf3ce63c4f5c`, tree `bcbefd01`, base `689d2be9`.
   - [R2-2] `32c5a2be` is a merge commit with two parents, `2dbe6430` and `689d2be9`. So `689d2be9` is a parent of the
     head as well as the merge base.
   - Then the installer runs.
   - Then #393 is closed and branch `relay/julius-landing-system-v35i-pkg2` is deleted.
2. **NOTHING lands on main before the installer runs.** That includes Wonderland squashes, worker PRs and anything else.
   Any landing would make #395's G6 base stale and void Skywalker's clearance.
3. **Only after that,** the first worker-PR squash restores provenance (`docs/REPOSITORY_GOVERNANCE.md:325-328`). [R2-1]
   - The restoring squash must be an App-opened worker PR: `julius-worker[bot]` opens it (`julius-main-provenance.mjs:450`),
     and its commits are re-authored as the App per `RUNBOOK:70-88`.
   - **#396 can never be that squash.** It was opened by `ohdieyuh-glitch`, so it would fail `julius-main-provenance.mjs:450`.
     Its route is an App-opened worker re-cut of #396's Skywalker-cleared tree. The re-cut head's tree must equal that
     reviewed tree. Then #396 is closed unmerged.
   - **This applies to any PR** not opened by `julius-worker[bot]`, Wonderland or Julius: re-cut it as an App-opened worker
     PR of its cleared tree and close the original unmerged.
   - The restoring squash is that Wonderland re-cut if it is cleared by then, otherwise YUJI's plain Julius worker PR
     (also App-opened).
4. [R2-4] Steps 1-2 of section 3 (develop, clear) touch neither main nor any PR, so they can go ahead now.
   Steps 3-8 of section 3 run only after point 3 above.

## 2. What the route enforces, and what it trusts

**Identity checks the squash route actually enforces:**
- The PR opener is `julius-worker[bot]` (`julius-main-provenance.mjs:450`, read from `user.login` at `:649`).
- An `ohdieyuh-glitch` review approves the exact head. The founder submits it in person; no agent does (section 3,
  step 6, [R2-3]):
  - `scripts/julius-review-currency.mjs:269-272` (`commit_id === headSha`, authority check);
  - the approver list is at `:59`;
  - the approver may be neither a non-attesting (bot) identity nor the PR author (`:246-252`).
  - [R3-4] Review currency also reads blocking findings on the head, and they win over any approval
    (`julius-review-currency.mjs:274-283`, `:316-324`):
    - a `CHANGES_REQUESTED` review at the head (`:284-287`);
    - a review body at the head: on an approval only an explicit marker (`P1`, Critical, High; `:130`) blocks; on any other
      review an unclassifiable body blocks too (`:132-136`, `:302-309`);
    - a line comment written against the head (`original_commit_id`, `:310-313`) whose body is blocking or unclassifiable.
  - Commit statuses are also read, as an alternative SHA-bound approval on context `julius/independent-review`
    (`:100`, `:184-201`, `:326-329`), not as findings. Nothing publishes that status today (`:94`).
  - Only `ohdieyuh-glitch` has standing to approve or block (`:59`, `:78`, `:264-265`); other logins' reviews and comments
    are read past (`:67-69`). The gate fetches reviews, line comments and statuses (`julius-main-provenance.mjs:663-665`),
    not issue comments.
  - So a blocking or unclassifiable review body or line comment posted as `ohdieyuh-glitch` on the head fails the gate even
    next to an approval. That is one more reason agents post nothing through the founder's account.

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
- [R2-3] Agents never act as the approver. Cosmo uses the founder's connected account only to dispatch or re-run
  main's unmodified `julius-real-infra.yml` (section 3, step 4).
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
   - **Token.** The founder mints an installation token (`RUNBOOK:108-110`, [RD-5]). The token is never printed or put on a
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
     open it again with an App token (`RUNBOOK:141-143`). [R2-1] This holds for every PR, #396 included.
4. **Required CI, with no workflow change.** [RD-6]
   - `julius-real-infra.yml` runs on `pull_request` only when the PR touches a path in its filter
     (`.github/workflows/julius-real-infra.yml:3-4`). `wonderland/**` is not in the filter, but `package*.json` is.
     So a Wonderland PR that touches `package.json` or `package-lock.json` starts all 5 real-infra jobs when it opens.
   - **Rule [R2-4]:** after the worker PR opens, check whether the 5 real-infra jobs ran on that exact head:
     - **all ran and all passed:** no dispatch;
     - **none ran:** dispatch `julius-real-infra.yml` once by `workflow_dispatch` (`:5`);
     - **some ran:** stop and ask Skywalker, because a dispatch would duplicate check names;
     - **ran with a failure:** re-run only the failed job(s) in that same workflow run (`gh run rerun <run-id> --failed`,
       or "Re-run failed jobs" in the Actions UI). Never a new dispatch, and no re-cut (counting rule below).
     - The path filter applies to the whole workflow, and a dispatch runs every job, so in practice it is all-or-none.
     - The same re-run rule applies to a run that was itself started by the one dispatch.
   - **Re-runs [RR].** Re-running needs Actions: write. The worker App's installation has only `actions=read`
     (`RUNBOOK:11-13`), so the founder's connected account is required, for re-running failed jobs only. A re-run is a new
     attempt with new check-run ids; the failed attempt's check runs are kept (they show with `filter=all`).
   - **Counting rule [R3-3]** (replaces rev 3's open question). Count check runs on the head the way the lander reads them:
     - `land.mjs:92` reads `/commits/{head}/check-runs` with no `filter` parameter; `pageUrl` (`land.mjs:53`) adds only
       `per_page` and `page`. So GitHub's default `filter=latest` applies: one run per check name, the latest attempt.
     - After a re-run, each required name appears once, so the exactly-once test passes (`land-lib.mjs:148-152`, count at
       `:150`), and so does the duplicate-name test (`:153-156`).
     - Skywalker confirmed this on `e90eb92a`: 7 check runs with `filter=latest` against 16 with `filter=all`.
     - So a failed real-infra job needs a re-run, not a re-cut. Whoever checks this step counts with `filter=latest`.
   - **Dispatcher [R2-3]:** Cosmo, acting through the founder's connected GitHub account (write access). Through that
     account Cosmo may only:
     - dispatch main's unmodified `julius-real-infra.yml` by `workflow_dispatch` (`:5`) on the worker branch at the exact
       PR head; and
     - re-run the failed jobs of a run of that same workflow on that head (the R2-4 rule above).

     Through that account Cosmo never opens, reviews, approves or merges a PR, and changes nothing in the repository.
     - Skywalker agreed that dispatching unmodified checks is operational.
     - The worker App holds only `actions=read` (`RUNBOOK:11-13`). Its dispatch is refused (403), and it cannot re-run
       either, because both need Actions: write [RR].
     - The PR does not touch `.github/workflows/**`, and the dispatcher confirms that the workflow's blob at the head
       equals main's blob before dispatching.
   - All 6 required checks (`.github/julius-landing/required-checks.txt:4-9`) must each appear exactly once,
     produced by app `15368` (GitHub Actions), and conclude `success` on that head. None is relaxed.
     - `Verify Relay`: `.github/workflows/relay-ci.yml:22`. It runs on `pull_request` to main (`:9-10`).
     - `sibling-control-plane`: `julius-real-infra.yml:9`.
     - `first-live-topology (executor-private|host-visible)`: `julius-real-infra.yml:167`, matrix at `:181-184`.
     - `real-infra-julius`: `julius-real-infra.yml:456`.
     - `learning-store-container`: `julius-real-infra.yml:513`.
   - The provenance gate itself does not check CI. Green CI is a runbook rule (`RUNBOOK:147-148`), and there is no
     branch protection (`julius-main-provenance.mjs:208`; `.github/workflows/julius-land.yml:5-6`; confirmed on GitHub by
     Skywalker, section 1 [BP]). This route makes the 6 checks a hard precondition of steps 5 and 6.
5. **Exact-head PASS.** Skywalker verifies `head^{tree}` == the cleared tree, then posts a fresh PASS pinned to that head.
6. **Founder approval: the founder in person, not Cosmo.** [R2-3]
   - The founder personally approves as `ohdieyuh-glitch` on GitHub at that exact head (`RUNBOOK:145-155`). The review's
     `commit_id` must equal the head that merges (`julius-review-currency.mjs:270-271`).
   - This is a separate human step, and it is the founder acting, not Cosmo or any other agent.
   - No agent submits the exact-head approval through the founder's connected account; the founder clicks it in person.
     Why: otherwise an agent could approve as `ohdieyuh-glitch`, and review-currency `:270-271` would pass with no human
     involved. That check sees only the review's `commit_id` and login (plus its state at `:272`), not who pressed the button.
7. **Squash with a SHA guard.** [R3-1] **Who merges is a PENDING founder ruling. Until the founder rules, option A applies.**
   - The command is the same for both options: `gh pr merge <n> --squash --match-head-commit <head>` (`RUNBOOK:151-155`).
   - **Option A (default):** the founder clicks the squash in person, as `RUNBOOK:145` and `:151-155` say.
     Cosmo does not merge through the founder's account (R2-3).
   - **Option B (only if the founder rules that "merge automatically" covers it):** after Skywalker's exact-head PASS
     (step 5) and the founder's in-person exact-head approval (step 6), the `julius-worker` App merges with an
     installation token handled as in step 3, with the same SHA guard.
     - Technically possible: the installation has `contents=write` (`RUNBOOK:11-13`), which is what a merge needs, and the
       provenance gate never checks who merged: to decide a PR merged it reads only `merged_at` and `merge_commit_sha`
       (`julius-main-provenance.mjs:645-652`, used at `:388-389`), never `merged_by`.
     - **Untested.** Skywalker has not tried an App merge on this repository.
   - **Not an option: the lander.** It never uses the merge endpoint (`land.mjs:3`; `julius-land.yml:22-23`), so it cannot
     merge this route's PR. It lands only by its own route (section 4).
   - [R3-2] `RUNBOOK:13-14` says the installation is "deliberately not enough to merge". Given `contents=write`, that is
     inaccurate. This doc does not edit the runbook; fixing it needs its own approved change. Until then, option B
     also contradicts the runbook text.
   - If main moved first, re-cut on the new main, re-run CI, and get a fresh PASS and a re-approval (`RUNBOOK:170-176`).
8. **Verify the landing.**
   - The new main's tree equals the reviewed tree, with exactly one parent (`RUNBOOK:157-164`).
   - The pre-merge parent is contained in the reviewed head.
   - `node scripts/julius-main-provenance.mjs ohdieyuh-glitch/sunday-relay main` must report `provenant` and exit 0
     (the gh-fetching form, as run by `julius-accept-main.yml:155`). [RD-5] `RUNBOOK:191` is the `--evidence <file>`
     form of the same rule, for a machine without `gh` (`RUNBOOK:178-193`).

## 4. Not chosen

- **Lander route** (`julius-land.yml` with `land-lib.mjs`). It would need all of the following:
  - **A one-commit head.** The commit must be App-authored (`land-lib.mjs:104-112`), and #394 failed 6 PR checks and 7 CI checks in Skywalker's replay.
  - **An allowlisted branch.** The entries are at `.github/julius-landing/allowed-branches.txt:5-9` and `:11-13`;
    the comments are at `:1-4` and `:10` [RD-3]. The check is at `land-lib.mjs:113`.
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
  - CI (`required-checks.txt`; `land-lib.mjs:142-164`: check runs at `:142-161`, commit statuses at `:162` [RD-5]);
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
- **(e) [R3-1] PENDING founder ruling: who does the step 7 squash?**
  - Option A (default): the founder clicks it in person.
  - Option B: the worker App merges after the founder's in-person exact-head approval.
  - The question is whether the 4:10 ruling's "merge automatically" covers an App merge. Until the founder rules, option A applies.
- **(f) [R3-2] `RUNBOOK:13-14` is inaccurate.** It says the installation is "deliberately not enough to merge", but it has
  `contents=write`. This doc does not edit the runbook; correcting it needs its own approved change.
- **(g) [BP] Branch protection.** Skywalker suggested turning it on. `julius-land.yml:5` records that this plan answered
  403 "upgrade", so it may need a plan change. That is the founder's call; this route does not depend on it.

## 6. Status

No readiness change. Wonderland verified readiness stays at 56.25%.

## 7. Citation corrections, from re-reading at `689d2be9`

- **The workflows ceremony `:308-333`** is `docs/REPOSITORY_GOVERNANCE.md:308-333`, not `land-lib.mjs`.
  `land-lib.mjs` has 317 lines, and its `:308` is `nonceUsed`.
- **App id and installation** are at `RUNBOOK:4` and `RUNBOOK:11`, not `:108-132`. `:108-110` is the token-minting text ([RD-5]).
- **`allowed-branches.txt:1-2`** are comments. The full comment set is `:1-4` and `:10` ([RD-3]). The entries are at `:5-9` and `:11-13`.
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
- [RR] **The App's `actions=read`** sits in the permission list at `RUNBOOK:11-13`, not `:13` alone. The "not enough to
  merge" claim is `:13-14` ([R3-2]).
- **These held as given:**
  - `julius-real-infra.yml:4` (filter) and `:5` (`workflow_dispatch`);
  - `julius-main-provenance.mjs:215`, `:450-454` and `:649`;
  - `julius-review-currency.mjs:246-252`;
  - `land-lib.mjs:6`, `:7`, `:21`, `:96`, `:103-108`, `:112`, `:113`, `:117`, `:119-120` and `:126`;
  - `RUNBOOK:141-143` and `:250-259`;
  - `julius-land.yml:10-12`;
  - `reviewer-tools.mjs:36-50`.

## 8. Fix lists

Every changed citation was re-read at `689d2be9`. Citations point into other files at that fixed main, so the line
shifts inside this document move none of them.

### 8.0 Revision 4 (fixes to rev 3 `cb68c692`, after Skywalker's PASS WITH FINDING)

- **[RR] Re-runs** (Skywalker's answer 1). Section 3, step 4 (re-run bullet and dispatcher bullet) now says:
  - re-running needs Actions: write, and the worker App's installation has only `actions=read` (`RUNBOOK:11-13`);
  - so the founder's connected account is needed, for re-running failed jobs only;
  - a re-run is a new attempt with new check-run ids, and the old check runs stay.
- **[R3-3]** Step 4 now states the counting rule, and rev 3's open question (rev 3 `:118-120`) is removed:
  - `land.mjs:92` reads check runs with no `filter` parameter (`pageUrl` at `land.mjs:53` adds only `per_page` and `page`),
    so GitHub's default `filter=latest` applies. After a re-run there is one run per check name, and the exactly-once
    test (`land-lib.mjs:150`) passes.
  - Skywalker's evidence on `e90eb92a`: 7 runs with `filter=latest` against 16 with `filter=all`.
  - So a failed job needs a re-run, not a re-cut.
- **[R3-1] (MEDIUM)** Step 7 now states both options explicitly and marks the choice as a PENDING founder ruling
  (also open item e):
  - Option A, the default until the founder rules: the founder clicks the squash in person (`RUNBOOK:145-155`).
  - Option B: a worker-App merge after the founder's in-person exact-head approval. Technically possible (the
    installation has `contents=write`; the gate reads `merged_at` and `merge_commit_sha`, never `merged_by`,
    `julius-main-provenance.mjs:645-652`, `:388-389`), but untested.
  - The lander is not an option: it never uses the merge endpoint (`land.mjs:3`; `julius-land.yml:22-23`).
- **[R3-2] (MEDIUM)** Noted at step 7 and open item f: `RUNBOOK:13-14` ("deliberately not enough to merge") is
  inaccurate. The runbook is not edited here; fixing it needs its own approved change.
- **[R3-4] (info)** Section 2 now lists what review currency reads besides the approval (`julius-review-currency.mjs`):
  `CHANGES_REQUESTED` reviews (`:284-287`), review bodies (`:302-309`) and line comments (`:310-313`), all decided before
  approval (`:316-324`), plus commit statuses (`:184-201`, `:329`). The gate fetches all three at
  `julius-main-provenance.mjs:663-665`.
  - Precision from the code: statuses are read as an alternative SHA-bound approval on context
    `julius/independent-review` (`:100`), not as blocking findings. Blocking findings come from reviews and line
    comments. Issue (conversation) comments are not fetched by the gate.
- **[BP]** Section 1 now notes that main has no GitHub branch protection (reported by Skywalker), so only the landing
  checks guard it (`julius-land.yml:5-6`; `julius-main-provenance.mjs:208`). Also open item g.
- **Citations re-checked at `689d2be9`:** `land.mjs:3`, `:53`, `:56-63`, `:92`; `land-lib.mjs:148-156`;
  `julius-review-currency.mjs:59`, `:67-69`, `:78`, `:94`, `:100`, `:130-136`, `:184-201`, `:264-265`, `:284-324`, `:329`;
  `julius-main-provenance.mjs:208`, `:388-389`, `:469-476`, `:645-652`, `:663-665`; `julius-land.yml:5-6`, `:22-23`;
  `RUNBOOK:11-14`, `:145-155`. None of rev 3's citations shifted; `RUNBOOK:13` for `actions=read` is widened to `:11-13`.

### 8.1 Revision 3 (fixes to rev 2 `aa7a5188`, after Skywalker's PASS WITH FINDING)

- **[R2-1] (MEDIUM)** 1.1 point 3 no longer names #396 as the restoring squash.
  - #396 was opened by `ohdieyuh-glitch` and would fail `julius-main-provenance.mjs:450`.
  - The restoring squash is an App-opened worker re-cut (opened by `julius-worker[bot]`, re-authored per `RUNBOOK:70-88`)
    of #396's Skywalker-cleared tree, whose tree must equal the reviewed tree. #396 is then closed unmerged.
  - Stated for any PR, not just #396; also noted at section 3, step 3.
- **[R2-2]** #395's head `32c5a2be` is a merge commit with parents `2dbe6430` and `689d2be9` (1.1 point 1, and 8.2 [RD-1]).
  - Rev 2 wrongly said `2dbe6430` was the direct parent. `689d2be9` is a parent as well as the merge base.
  - Re-verified with `git log` at `32c5a2be`: 4 commits ahead of `689d2be9`, 0 behind.
- **[R2-3]** Through the founder's connected GitHub account, Cosmo may only dispatch main's unmodified
  `julius-real-infra.yml` (and re-run its failed jobs, per R2-4). Cosmo never opens, reviews, approves or merges through it.
  - The founder's exact-head approval (`RUNBOOK:145-155`; `julius-review-currency.mjs:270-271`) stays a separate human
    step, done by the founder in person (section 3, step 6). The squash is also the founder's (step 7).
  - Added: "No agent submits the exact-head approval through the founder's connected account; the founder clicks it in
    person." Otherwise an agent could approve as `ohdieyuh-glitch` and review-currency `:270-271` would pass with no
    human involved.
  - Section 2 now says agents never act as the approver.
- **[R2-4]** Steps 1-2 of section 3 can go ahead now (1.1 point 4). The real-infra rule (section 3, step 4) is now:
  - all ran and passed: no dispatch;
  - none ran: dispatch once;
  - some ran: stop and ask Skywalker;
  - ran with a failure: re-run the failed job (`gh run rerun <run-id> --failed` or equivalent), never a new dispatch.
- **Citations re-checked at `689d2be9`:** `julius-main-provenance.mjs:450`; `RUNBOOK:70-88`, `:145`, `:145-155`, `:151-155`;
  `julius-review-currency.mjs:270-272`; `julius-real-infra.yml:4-5`. None shifted.

### 8.2 Revision 2 (fixes to rev 1 `f3d6ebc7`, after Skywalker's FAIL)

Every changed citation was re-read at `689d2be9`.

- **[RD-1] (HIGH)** Added §1.1, the normative ordering:
  - #395 installs first: G6 token, installer run, then close #393 and delete `relay/julius-landing-system-v35i-pkg2`.
  - Nothing lands on main before the installer runs.
  - Only then does the first worker-PR squash restore provenance.
  - Verified on GitHub:
    - #395's head is `32c5a2be`, with tree `bcbefd01d3b6fea0e12e1fed2f967c2d11bc1af0`.
    - The head is 4 commits ahead of and 0 behind `689d2be9`, which is the merge base. [R2-2] It is a merge commit with
      parents `2dbe6430` and `689d2be9` (rev 2 wrongly called `2dbe6430` the direct parent).
    - #393 and the branch to be deleted both point at `23aa7fbd`.
- **[RD-2] (MEDIUM)** "may be" is now "is": main is unprovenanced (the gate exits 1).
  - Cited consequences: preflight at `:31` and `:193-194`; acceptance at `julius-accept-main.yml:148-155`.
  - The gate sets its exit code at `julius-main-provenance.mjs:740`.
- **[RD-3]** The allowlist comments are `:1-4` and `:10`.
- **[RD-4]** `WORKER_AUTHOR_LOGINS` (`provenance:57`) is an alias of `NON_ATTESTING_IDENTITIES`, defined at
  `julius-review-currency.mjs:38`.
  - That file defines no symbol named `WORKER_AUTHOR_LOGINS`; it defines the list under the other name.
- **[RD-5]** Three citations fixed:
  - Token minting is `RUNBOOK:108-110`.
  - The CI range is now `land-lib.mjs:142-164`, including the statuses rule at `:162`.
  - `RUNBOOK:191` is described as the `--evidence` form.
- **[RD-6]** The real-infra rule is now: check the exact head first, and dispatch only if the jobs did not run.
  - The filter at `:4` includes `package*.json`.
  - The dispatcher is Cosmo, via the founder's connected account with write access, using main's unmodified workflow file.
- **[RD-7]** The spoofing content (section 2, open item b) is unchanged.
