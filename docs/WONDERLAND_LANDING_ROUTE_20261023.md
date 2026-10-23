# Wonderland landing route (2026-10-23)

Author: Cosmo (Wonderland dev agent). Status: proposal for Skywalker's exact-head review.
Revision 7: fixes [R6-1]..[R6-3] from Skywalker's PASS WITH FINDINGS of rev 6 `c233261e`, and records the state after
#395 landed at main `f539cab2` (new section 1.2; see section 8.0).
Revision 6 fixed [R5-1]..[R5-4] from Skywalker's PASS WITH FINDINGS of rev 5 `19353d85`, recorded YUJI as the
App-credential holder and identity-hardening owner, and added [FR-6] (section 8.1).
Revision 5 applied the founder's FINAL rulings of 2026-10-23, 7:27 AM PT ([FR-1]..[FR-5]) and fixed [R4-1]..[R4-3] from
Skywalker's PASS WITH FINDINGS of rev 4 `ca9400ac` (section 8.2).
Revision 4 fixed [R3-1]..[R3-4], the re-run answer [RR] and the no-branch-protection note [BP] from Skywalker's PASS WITH
FINDINGS of rev 3 `cb68c692` (section 8.3).
Revision 3 fixed [R2-1]..[R2-4] from Skywalker's PASS WITH FINDINGS of rev 2 `aa7a5188` (section 8.4).
Revision 2 fixed [RD-1]..[RD-6] from Skywalker's FAIL of rev 1 `f3d6ebc7` (section 8.5). [RD-7] spoofing content stayed
unchanged until rev 5 ([FR-4]).
Citations up to rev 6 are `file:line` at main `689d2be92c3158ba4a59883ed4f6cc02f700660b` (tree `ecfe4f5c`, parent
`3f20fc1a`), re-read line by line before writing. Corrections to earlier citations are listed in section 7.
[F539] Citations marked `@f539` are at main `f539cab2530b7733bd987068be676308440e04a5` (tree `bcbefd01`, parent
`689d2be9`), the #395 squash. #395 changed `land-lib.mjs`, `land.mjs`, `julius-main-provenance.mjs` and
`julius-real-infra.yml`, among others, so older citations into those four files may have shifted at `f539cab2`. For
example, the opener check `julius-main-provenance.mjs:450-454` is `:453-455` @f539, and the signed-clearance author
check `:290-292` is `:293-296` @f539.
Re-pinning every older citation is left to a later revision.

## 1. Context

- Founder ruling (2026-10-23, about 4:10 AM PT): Wonderland changes land through the Julius landing
  process, and main stays provenant.
- [FR] Founder FINAL rulings (2026-10-23, 7:27 AM PT), as they bear on this route:
  - [FR-1] #395 is approved to land at exact head `32c5a2be` through the existing Julius installer, once Skywalker has
    verified it and produced a legitimate signed G6 clearance with the authorized Ed25519 key (1.1 point 1, open item h).
    [R6-1] No existing installer could land #395. It landed through pkg3 `FOUNDER_INSTALL_LANDING_395.sh`, a new
    founder-governed installer that reuses pkg2's G6 block byte for byte, cleared by Skywalker for that exact file
    (1.2). Whether pkg3 counts as "the existing installer" under the 7:27 ruling is the founder's call; this doc does
    not assume it.
  - [FR-2] The `julius-worker` App does the final squash automatically after exact-head independent approval and once
    every required gate passes. The founder does not click Merge (section 3, step 7; open item e).
  - [FR-3] No repeated founder approval. This conflicts with the gate as coded (section 3, step 6; open item i).
  - [FR-4] Git author name and email are not trusted identity evidence; mismatches fail closed (section 2; open item b).
  - [FR-5] Branch protection or rulesets are authorized, provided they do not deadlock the landing system (open item g).
  - [FR-6] #396: Cosmo may continue all J1 Wonderland client development, repairs, tests and documentation now. After
    #395 lands, cleared changes go through the Julius landing mechanism. The draft PR #396 is never merged directly into
    main (1.1 point 3).
  - [FD-0808] Founder paid-API directive (2026-10-23, 8:08 AM PT): provider items 1-8 are YUJI's, and Skywalker reviews
    the baselines and plan before any spend. Cosmo's part is item 9, the client trace. Limits: $30 per run, 3 repair
    cycles, $60 in total. API-only smoke tests are not missions. Paid runs still need a provenant main (below).
  - The rulings on R4-F and run-id (c) belong to the C2/J1 resolutions doc and are not restated here.
  - None of these rulings changes a gate in this doc. Every gate cited here stays as coded at `689d2be9`.
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
- [RD-2] **Main is unprovenanced now.** At rev 6 the tip was `689d2be9`, the #394 squash, git author `Kaisin Rogodfree`.
  `julius-main-provenance.mjs` exits 1 on it (verified by Skywalker; exit code set at `:740`). [F539] The tip is now
  `f539cab2`, the #395 squash, and it is still unprovenanced: the PR opener `ohdieyuh-glitch` is not a worker login
  (`julius-main-provenance.mjs:453-455` @f539; section 1.2). Consequences until
  provenance is restored:
  - **No paid or live runs.** The live preflight requires `provenant` for the frozen main sha
    (`scripts/julius-live-preflight-gates.mjs:31`, enforced at `:193-194`).
  - **No new acceptance checkpoint.** `.github/workflows/julius-accept-main.yml:148-155` runs the provenance gate and fails.
- [BP] **No branch protection.** Skywalker reported that main has no GitHub branch protection. The repository is private on a
  plan with no branch protection and no rulesets (the API answers 403 "upgrade", `.github/workflows/julius-land.yml:5-6`;
  also `julius-main-provenance.mjs:208`). GitHub refuses nothing on main; only the landing checks guard it. The provenance
  gate judges main's tip after it moves, so it reports a bad landing rather than preventing one.
  [FR-5] The founder has since authorized branch protection or rulesets, on the condition in open item g.

### 1.1 Ordering on main (normative) [RD-1]

1. **#395 installs FIRST. DONE** (1.2).
   - [FR-1] Approved by the founder (7:27 AM PT ruling) to land at exact head `32c5a2be10c60a3a4c7de7741a98bf3ce63c4f5c`,
     tree `bcbefd01`, base `689d2be9`. [R6-1] It landed through the pkg3 installer `FOUNDER_INSTALL_LANDING_395.sh`
     (sha256 `c281fe30…2c1e`), once Skywalker had cleared that exact file.
   - Skywalker verified the exact head, tree, base, CI and settled review evidence, then produced the legitimate signed
     G6 clearance with the authorized Ed25519 key (`b0b8e29b`, nonce `a40b1d05`). The founder does not hold that key.
     No agent forges G6, bypasses validation or weakens a landing gate.
   - [R2-2] `32c5a2be` is a merge commit with two parents, `2dbe6430` and `689d2be9`. So `689d2be9` is a parent of the
     head as well as the merge base.
   - [R6-1] After #395's post-merge checks, YUJI closed #393 over the founder-authorized connection (closed 15:33:21Z,
     08:33:21 PT). Branch `relay/julius-landing-system-v35i-pkg2` (`23aa7fbd`) is KEPT as pkg2 install evidence.
     Deleting it needs explicit founder approval (Skywalker, `/workspace/g6-395/REPORT_merge.md` section 7).
2. **NOTHING lands on main before the installer runs.** That includes Wonderland squashes, worker PRs and anything else.
   Any landing would make #395's G6 base stale and void Skywalker's clearance. (Satisfied: `f539cab2`'s single parent is
   `689d2be9`, so nothing landed in between.)
3. **Only after that,** the first worker-PR squash restores provenance (`docs/REPOSITORY_GOVERNANCE.md:325-328`). [R2-1]
   - The restoring squash must be an App-opened worker PR: `julius-worker[bot]` opens it (`julius-main-provenance.mjs:450`),
     and its commits are re-authored as the App per `RUNBOOK:70-88`.
   - **#396 can never be that squash.** It was opened by `ohdieyuh-glitch`, so it would fail `julius-main-provenance.mjs:450`.
     Its route is an App-opened worker re-cut of #396's Skywalker-cleared tree. The re-cut head's tree must equal that
     reviewed tree. Then #396 is closed unmerged.
   - **This applies to any PR** not opened by `julius-worker[bot]`, Wonderland or Julius: re-cut it as an App-opened worker
     PR of its cleared tree and close the original unmerged.
   - The restoring squash is that Wonderland re-cut if it is cleared by then, otherwise YUJI's plain Julius worker PR
     (also App-opened). [F539] The current plan makes the Wonderland worker squash the first worker squash, after the
     G6 installer for #397, #398 and #400 (1.2).
4. [R2-4] Steps 1-2 of section 3 (develop, clear) touch neither main nor any PR, so they can go ahead now.
   Steps 3-8 of section 3 run only after point 3 above.

### 1.2 State at main `f539cab2` (rev 7, facts with sources)

- **#395 MERGED** through pkg3 `FOUNDER_INSTALL_LANDING_395.sh`, sha256
  `c281fe30b0664f42493378f184cafb8158c12de458b17fdad9523dde950b2c1e`.
  - Skywalker cleared that exact file: PASS WITH FINDINGS (`/workspace/pkg3-review/REPORT_c281fe30.md`).
  - G6 was signed with key `b0b8e29b`, nonce `a40b1d05`.
  - Merge commit `f539cab2530b7733bd987068be676308440e04a5` at 15:09:09Z (08:09:09 PT), merged by `ohdieyuh-glitch`.
    It has a single parent, `689d2be9`, and tree `bcbefd01`, equal to the reviewed head's tree.
  - Skywalker verified the landing: "LANDED AND VERIFIED, PASS" (`/workspace/g6-395/REPORT_merge.md`).
  - Main CI is green: Relay CI run 39975802150, check run "Verify Relay" (app 15368), success, completed 15:19:48Z
    (08:19:48 PT, read from GitHub for rev 7). Both Vercel commit statuses report success (REPORT_merge.md section 5).
  - Kaisin's clock runs about 99 s slow against GitHub (REPORT_merge.md section 3). Allow for it in every token window.
- **Why pkg3 merges as the founder account.** #395 changes `.github/workflows/julius-real-infra.yml` (blob `860f7cc0` at
  `689d2be9`, `9135fac8` @f539), and the `julius-worker` App has no workflows permission by design (its permission
  list at `RUNBOOK:11-13` @f539 has none). pkg2 already did this (pkg2 L3, L221, L371; installer lines, not main's
  tree). No review is submitted through that account.
- **Main is not provenant yet.** `julius-main-provenance.mjs:453-455` @f539 refuses a founder-opened squash. So
  `julius-accept-main.yml` is HELD until the first worker squash, because it would be refused at its provenance gate
  (`julius-accept-main.yml:148-155` @f539) and must not be forced (REPORT_merge.md section 6).
- **#393 closed, pkg2 branch kept:** see 1.1 point 1.
- **Landing order from here:**
  1. ONE G6 installer carries three draft PRs, in order:
     - #397, identity hardening (head `55d05fd3`);
     - #398, clearance gate (head `63a48f64`, stacked on #397);
     - #400, an allowed-branches entry (head `a59c2d73`) that adds exactly `relay/julius-wonderland-j1-client-recut-20261023`.
  2. Then the Wonderland worker squash is the first worker squash, and it restores provenance.
  - #402 was closed (15:50:56Z, 08:50:56 PT) because it named Cosmo's source branch.
- **Blockers at `f539cab2` (all @f539):**
  - No Wonderland branch is in `.github/julius-landing/allowed-branches.txt:5-13`. The check is at `land-lib.mjs:113`.
    The one Wonderland-related entry is `relay/julius-ask-route` (`:13`).
  - Before #398, a founder exact-head approval is the only approval path: `EXTERNAL_APPROVER_LOGINS = ['ohdieyuh-glitch']`
    (`julius-review-currency.mjs:59`), `REVIEW_AUTHORITY_LOGINS` (`:78`), and only `APPROVED` counts (`:112`). See item i.
  - The lander creates its own landing commit (`land.mjs:345`, created at `:366-370`) with identity `github-actions[bot]`
    (`LANDER_IDENTITY`, `land-lib.mjs:177`). It accepts only an open, one-commit PR opened by `julius-worker[bot]` whose
    head commit is App-authored, on an allowlisted branch (`checkPullRequest`, `land-lib.mjs:91-128`; `:104-105`,
    `:108`, `:112`, `:113`).
- **Wonderland source.** r2 `wonderland/j1-client-recut-r2-20261023` at `a821a46786ba51779e7a1bfb7c40b9ad453b5ce8`
  (tree `c4aeed0c`, single parent `f539cab2`; compare: ahead 1, behind 0). It has 4 pure additions:
  `src/relay/mission/wonderland/wonderland-j1-logic.test.ts`,
  `wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp`, `wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.h`
  and `wonderland/Tools/j1_logic_kat.cpp`.
  - Skywalker cleared it as the App's copy source only. That is not an approval.
  - The run-id head `28d55bf3` has a code PASS.
  - The App's worker commit is the new main plus exactly those 4 blobs, and it gets its own exact-head review.
  - `de6625d0` is superseded and kept.
- **MERGED PULL REQUESTS:** PR #394 (`689d2be9`) and PR #395 (`f539cab2`). Nothing else has merged.
- **Readiness:** unchanged, Wonderland 56.25% (section 6).

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
- [FR-4] **DECIDED (founder, 7:27 AM PT):** git author name and email are NOT trusted identity evidence. Identity comes
  from the authenticated GitHub/App identity, trusted provenance and the required signed clearance, and any mismatch fails
  closed. This route relies only on the authenticated PR-opener login and the `ohdieyuh-glitch` review login; the code
  paths that still rest on the author name or email are listed in open item b.

**Trust statement:**
- `RUNBOOK:3-4` has the founder run the runbook on a machine holding the App credential. [FR-2] The 7:27 ruling instead has
  the authorized agent locate and use the existing App credential through its established secure environment. That agent
  is YUJI (open item a).
- "App-opened" proves an App token was used. It does not prove a worker did the work.
- The App credential and the required approver account are both under the founder's control. **This is NOT two-party control.**
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
3. **Re-author as the App (the authorized App-credential holder, [FR-2]).**
   - Where: a machine holding the `julius-worker` App credential. App id `4838349` is at `RUNBOOK:4`; installation `159218171` is at `RUNBOOK:11`.
   - **Token.** The holder of the App credential mints an installation token in its established secure environment
     (`RUNBOOK:108-110`, [RD-5]). The token is never printed or put on a command line (`:115-116`, `:119-121`).
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
     - After a re-run within the same workflow run, each required name appears once, so the exactly-once test passes
       (`land-lib.mjs:148-152`, count at `:150`), and so does the duplicate-name test (`:153-156`).
     - Skywalker confirmed this on `e90eb92a`: 7 check runs with `filter=latest` against 16 with `filter=all`.
     - [R4-1] **Scope of that proof:** it covers re-runs within a single workflow run only. It is not proven that
       `filter=latest` collapses same-named check runs from two different workflow runs (for example a `pull_request`
       run plus a dispatch). That is why "some ran" stops and asks Skywalker, and why a failed run is re-run, never
       answered with a second dispatch.
     - So a failed real-infra job needs a re-run, not a re-cut. Whoever checks this step counts with `filter=latest`.
   - **Dispatcher [R2-3]:** Cosmo, acting through the founder's connected GitHub account (write access). Through that
     account Cosmo may only:
     - dispatch main's unmodified `julius-real-infra.yml` by `workflow_dispatch` (`:5`) on the worker branch at the exact
       PR head; and
     - re-run the failed jobs of a run of that same workflow on that head (the R2-4 rule above).

     Through that account Cosmo never opens, reviews, approves or merges a PR, and changes nothing in the repository.
     [R5-2] Cosmo's scope does not include `julius-accept-main.yml`; YUJI starts that one (step 8).
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
     Skywalker, section 1 [BP]). This route makes the 6 checks a hard precondition of steps 5, 6 and 7.
5. **Exact-head PASS.** Skywalker verifies `head^{tree}` == the cleared tree, then posts a fresh PASS pinned to that head.
6. **Founder approval: the founder in person, not Cosmo.** [R2-3]
   - The founder personally approves as `ohdieyuh-glitch` on GitHub at that exact head (`RUNBOOK:145-155`). The review's
     `commit_id` must equal the head that merges (`julius-review-currency.mjs:270-271`).
   - This is a separate human step, and it is the founder acting, not Cosmo or any other agent.
   - No agent submits the exact-head approval through the founder's connected account; the founder clicks it in person.
     Why: otherwise an agent could approve as `ohdieyuh-glitch`, and review-currency `:270-271` would pass with no human
     involved. That check sees only the review's `commit_id` and login (plus its state at `:272`), not who pressed the button.
   - [FR-3] **Conflict with the 7:27 ruling: REAL BLOCKER (open item i).** The ruling asks for "exact-head independent
     approval" with no repeated founder approval. The gate as coded still requires an `ohdieyuh-glitch` review at the exact
     head (`julius-review-currency.mjs:59`, `:78`, `:269-272`). Skywalker's PASS does not count: a login outside that list
     is read past (`:66-69`). Until this is resolved, either the founder clicks Approve at each head that lands, or the
     gate gets a separately reviewed change. This doc does not change the gate.
7. **Squash with a SHA guard. [FR-2] DECIDED: option B. Option A is SUPERSEDED.** [R3-1]
   - The command: `gh pr merge <n> --squash --match-head-commit <head>` (`RUNBOOK:151-155`).
   - **Option B (decided, 7:27 AM PT ruling):** the `julius-worker` App does the squash automatically once all of these
     hold at the same head: Skywalker's exact-head PASS (step 5), the exact-head approval of step 6, and every required
     gate (the 6 checks of step 4, tree equality, parent containment). The founder does not click Merge.
     - [R4-2] **Who executes it:** YUJI, the agent holding the App credential in its established secure environment
       (open item a), with an installation token handled as in step 3. Cosmo does not hold the App credential and does
       not merge through the founder's account (R2-3).
     - Technically possible: the installation has `contents=write` (`RUNBOOK:11-13`), which is what a merge needs, and the
       provenance gate never checks who merged: to decide a PR merged it reads only `merged_at` and `merge_commit_sha`
       (`julius-main-provenance.mjs:645-652`, used at `:388-389`), never `merged_by`.
     - **Untested.** No App merge has been tried on this repository. The first App merge must be verified afterwards:
       the squash commit is on main (one parent, tree equal to the reviewed tree, step 8), the provenance gate reports
       `provenant` on the new tip, and `julius-accept-main.yml` passes on it (started by YUJI, step 8 [R5-2]).
   - **Option A (SUPERSEDED by the 7:27 ruling):** the founder clicks the squash in person (`RUNBOOK:145`, `:151-155`).
     Kept for the record only.
   - **Not an option: the lander.** It never uses the merge endpoint (`land.mjs:3`; `julius-land.yml:22-23`), so it cannot
     merge this route's PR. It lands only by its own route (section 4).
   - [R3-2] `RUNBOOK:13-14` says the installation is "deliberately not enough to merge". Given `contents=write`, that is
     inaccurate, and option B now contradicts it. This doc does not edit the runbook; fixing it needs its own approved
     change (open item f).
   - If main moved first, re-cut on the new main, re-run CI, and get a fresh PASS and a re-approval (`RUNBOOK:170-176`).
8. **Verify the landing.**
   - The new main's tree equals the reviewed tree, with exactly one parent (`RUNBOOK:157-164`).
   - The pre-merge parent is contained in the reviewed head.
   - `node scripts/julius-main-provenance.mjs ohdieyuh-glitch/sunday-relay main` must report `provenant` and exit 0
     (the gh-fetching form, as run by `julius-accept-main.yml:155`). [RD-5] `RUNBOOK:191` is the `--evidence <file>`
     form of the same rule, for a machine without `gh` (`RUNBOOK:178-193`).
   - For the first App merge [FR-2], also run `julius-accept-main.yml` on the new tip and confirm it passes
     (`RUNBOOK:166-168`: not required for monotonicity, but it records a fresh checkpoint and costs nothing).
   - [R5-2] **Who starts `julius-accept-main.yml`: YUJI** (YUJI, room, 7:43 AM PT). [R6-3] This rests on YUJI's own
     statement in the room, not on a founder ruling. Skywalker accepted it as narrow (REPORT_rev6.md R6-3). At `f539cab2`
     it is held until the first worker squash (1.2). After each App squash, YUJI starts it
     by hand over the founder-authorized GitHub connection, then confirms the run finished at the new main tip.
     - Trigger facts at `689d2be9`: the only trigger is `workflow_dispatch` (`.github/workflows/julius-accept-main.yml:70-71`);
       there is deliberately no `push` trigger (`:21-24`). It needs two inputs (`:72-80`): `confirm_accept`, which must be
       exactly `ACCEPT MAIN` (checked at `:116-119`), and `expected_main`, a full 40-hex sha (`:120-123`) that must equal
       main's tip or the run is refused (`:141-145`). It records nothing unless the provenance gate passes (`:148-155`).
     - The App cannot start it: its `actions: read` refuses `workflow_dispatch` with HTTP 403 (`julius-accept-main.yml:17-18`;
       App permissions at `RUNBOOK:11-13`). So only an account with Actions: write can dispatch it, which is why YUJI
       uses the founder-authorized connection.
     - Starting a workflow is not an approval. The gate reads reviews, line comments and commit statuses
       (`julius-main-provenance.mjs:663-665`), not workflow runs, so this does not conflict with "no agent approves
       through the founder's account" (step 6). The dispatcher passes inputs only and changes nothing in the repository.

## 4. Not chosen

- **Lander route** (`julius-land.yml` with `land-lib.mjs`). It would need all of the following:
  - **A one-commit head.** The commit must be App-authored (`land-lib.mjs:104-112`), and #394 failed 6 PR checks and 7 CI checks in Skywalker's replay.
  - **An allowlisted branch.** The entries are at `.github/julius-landing/allowed-branches.txt:5-9` and `:11-13`;
    the comments are at `:1-4` and `:10` [RD-3]. The check is at `land-lib.mjs:113`.
    - One Wonderland-related branch is already allowlisted: `relay/julius-ask-route` (`:13`, the "Julius x Wonderland ask route", `:10`). It is not a general Wonderland branch.
    - Any new entry is a founder-governed edit, refused by the lander (`land-lib.mjs:21`, `:119-120`). On #395 such an edit goes through the G6 installer.
  - **A signed clearance.** It must be signed with the ed25519 reviewer private key whose public-key fingerprint is `b0b8e29b`.
    - The clearance field list is at `land-lib.mjs:30`.
    - Signing is `reviewer-tools.mjs:36-50`, and verification is `land-lib.mjs:62-69`.
    - The 24-hour cap is at `:7` and `:96`.
    - [R6-2] The key is tied to the reviewer by the Kaisin signing folder's README.txt (the "Independent Reviewer signing
      identity") and mailbox note `f3047c`. The `.pub` file and that note confirm the fingerprint (open item h).

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

- **(a) The `julius-worker` App credential: YUJI holds it.** [FR-2] The 7:27 ruling has the authorized agent locate and
  use the existing credential through its established secure environment. YUJI, who owns Julius landings, has taken it
  (room, 2026-10-23, after rev 5). YUJI runs steps 3 and 7. Cosmo will not search for it, read it or mint a token from it.
- **(b) [FR-4] Author spoofing: DECIDED (founder, 7:27 AM PT).** Git author name and email are not trusted identity
  evidence. Use the authenticated GitHub/App identity, trusted provenance and the required signed clearance; fail closed
  on mismatches.
  - What the code does today, at `689d2be9`:
    - The provenance gate's squash-route check (`julius-main-provenance.mjs:450-454`) compares the PR opener,
      `pull.user.login` (`:649`), an authenticated GitHub login. That check already fits the ruling.
    - The provenance gate's signed-clearance check (`julius-main-provenance.mjs:290-292`) compares the head commit's
      `author.login` (`:642`), which is the account GitHub resolves from the git author email.
    - The lander's head-commit checks rest on the same fields: `land-lib.mjs:108` compares the free-text git author and
      committer names, and `:112` relies on GitHub resolving the author email to a login.
    - The squash route never checks the commit author (section 2). Precedent for a free-text author: `3f20fc1a`.
  - **Follow-up: owned by YUJI** (room, 7:40 AM PT). A hardening change so that no gate takes the git author name or
    email as identity evidence, covering `julius-main-provenance.mjs:290-292` and `land-lib.mjs:108`, `:112`. It lands
    only after #395, through G6 with Skywalker's review. This doc changes no gate.
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
- **(e) [R3-1] [FR-2] DECIDED: option B.** The `julius-worker` App does the step 7 squash automatically after exact-head
  independent approval and once every required gate passes. Option A is superseded. Executor: YUJI, holder of the App
  credential (open item a, [R4-2]). YUJI also starts `julius-accept-main.yml` after each App squash (step 8, [R5-2]). Untested; the first App merge is verified as in step 7.
- **(f) [R3-2] `RUNBOOK:13-14` is inaccurate.** It says the installation is "deliberately not enough to merge", but it has
  `contents=write`. Option B now contradicts that text. This doc does not edit the runbook; correcting it needs its own
  approved change.
- **(g) [BP] [FR-5] Branch protection: DECIDED, authorized with a condition.** The founder authorized branch protection or
  rulesets that enforce required CI and the authorized landing procedures, provided they do not deadlock the landing
  system.
  - Condition: the `julius-worker` App must still be able to land approved PRs (step 7), and the installer and lander
    routes must keep working. Any rule is checked against this route before it is activated, including that its required
    check names match `required-checks.txt:4-9`. Untested.
  - `julius-land.yml:5` records that this plan answered 403 "upgrade", so it may still need a plan change.
  - This doc activates nothing.
- **(h) [FR-1] #395: MERGED, CLOSED.** The founder approved landing #395 at exact head `32c5a2be` (tree `bcbefd01`, base
  `689d2be9`). [R6-1] It landed through the pkg3 installer `FOUNDER_INSTALL_LANDING_395.sh` (sha256 `c281fe30…2c1e`),
  as merge `f539cab2` (1.2).
  - Skywalker verified head, tree, base, CI and settled review evidence, then produced the signed G6 clearance with the
    authorized Ed25519 key (nonce `a40b1d05`).
  - [R6-2] The founder does not hold the key. The Kaisin signing folder's README.txt identifies the key as the
    Independent Reviewer signing identity. The `.pub` file and mailbox note `f3047c` confirm its fingerprint.
  - The history below is kept as it was at rev 6.
  - [R5-3] **Key: CONFIRMED** (Skywalker, 7:45 AM PT; source `/workspace/g6-395/REPORT_kaisin.md`). YUJI reported the
    candidate reviewer key on Kaisin at 07:33 PT. Skywalker checked its public half only: ed25519, fingerprint
    `b0b8e29b3eff…d13a`, matching `.github/julius-landing/reviewer-ed25519.pub` and mailbox note `f3047c`. [R6-2] The
    README identifies the signing identity; it does not state the fingerprint. No key bytes were printed, copied or moved.
  - **#395 still passes** at head `32c5a2be`, tree `bcbefd01`, base `689d2be9` (live main), with 7/7 check runs green.
  - **G6 BLOCKED: no installer can land #395.** The only reviewer-cleared installer, v3.5i pkg2
    `FOUNDER_INSTALL_LANDING_V3.sh` (sha256 `978a475d…`):
    - is pinned to base `3f20fc1a` and tree `710da65c` (its L89-91) and stops once main has moved (L244);
    - takes no arguments, so it has no mode for an existing PR (L50);
    - rebuilds the signed G6 fields from its own pins and byte-compares them (L316-343), so a token for PR 395 can
      never match.
    The v35j and v35k packages are also pinned to `3f20fc1a` and were never cleared. (Installer line numbers are from
    Skywalker's report, not from main's tree.)
  - **What unblocks it:** YUJI writes a pkg3 installer for the existing PR 395, pinning `32c5a2be` / `bcbefd01` /
    `689d2be9`, with the G6 block unchanged. Skywalker clears that exact file, then signs on Kaisin just before the
    installer's "G6 token:" prompt, because the token is valid for at most 2 hours.
  - Until a legitimate G6 exists, nothing lands on main (1.1).
  - Resolved: YUJI wrote pkg3, Skywalker cleared it (PASS WITH FINDINGS, `/workspace/pkg3-review/REPORT_c281fe30.md`),
    G6 was signed, and #395 merged at `f539cab2` (Skywalker, LANDED AND VERIFIED, PASS, `/workspace/g6-395/REPORT_merge.md`).
  - [R6-1] YUJI closed #393 over the founder-authorized connection after #395's post-merge checks. Branch
    `relay/julius-landing-system-v35i-pkg2` (`23aa7fbd`) is kept. Deleting it needs founder approval.
  - Kaisin's clock runs about 99 s slow; allow for it in every token window.
- **(i) [FR-3] REAL BLOCKER: exact-head approval.** The ruling says "no repeated founder approval", but review currency
  still requires an `ohdieyuh-glitch` approval at the exact head (`julius-review-currency.mjs:270-271`), and no agent
  submits it through the founder's account (step 6).
  - Options: the founder clicks Approve at each landing head, or the gate gets a separately reviewed change.
  - The `julius/independent-review` commit status (`julius-review-currency.mjs:100`, `:184-201`) is an existing alternative
    SHA-bound approval, but nothing publishes it today (`:94`), and the App has only `statuses=read` (`RUNBOOK:11-13`).
    Using it would also need its own reviewed change.
  - This doc does not change the gate. Needs a ruling before any worker-PR squash.
  - [F539] Unchanged at `f539cab2` (`julius-review-currency.mjs` has the same blob, `0ed3c5fe`; `:59`, `:78`, `:112` @f539).
    Before #398 lands, a founder exact-head approval is the only approval path (1.2).

## 6. Status

No readiness change. Wonderland verified readiness stays at 56.25%.

MERGED PULL REQUESTS:
- PR #394 — MERGED — WONDERLAND — B33 v3_1b import — `689d2be9`
- PR #395 — MERGED — JULIUS — landing v3.5i package 3, founder-governed update via pkg3 and G6 — `f539cab2`

## 7. Citation corrections, from re-reading at `689d2be9`

- **The workflows ceremony `:308-333`** is `docs/REPOSITORY_GOVERNANCE.md:308-333`, not `land-lib.mjs`.
  `land-lib.mjs` has 317 lines, and its `:308` is `nonceUsed`.
- **App id and installation** are at `RUNBOOK:4` and `RUNBOOK:11`, not `:108-132`. `:108-110` is the token-minting text ([RD-5]).
- **`allowed-branches.txt:1-2`** are comments. The full comment set is `:1-4` and `:10` ([RD-3]). The entries are at `:5-9` and `:11-13`.
- **`land-lib.mjs:30`** is the clearance field list (`CLEARANCE_KEYS`), not a key. `b0b8e29b` is the public-key
  fingerprint (`.github/julius-landing/reviewer-ed25519.pub`). [R6-2] The Kaisin signing folder's README.txt and mailbox
  note `f3047c` tie the key to the reviewer (open item h).
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

### 8.0 Revision 7 (fixes to rev 6 `c233261e`, after Skywalker's PASS WITH FINDINGS, plus the state at `f539cab2`)

- **[R6-1] (low)** [FR-1], 1.1 point 1 and item h now name the pkg3 installer `FOUNDER_INSTALL_LANDING_395.sh`
  (sha256 `c281fe30…2c1e`) instead of "the existing installer". [FR-1] keeps the ruling's wording and adds that pkg3 is
  a new founder-governed installer reusing pkg2's G6 block; whether it counts as "the existing installer" is the
  founder's call. YUJI closed #393 after #395's post-merge checks. The pkg2 branch (`23aa7fbd`) is kept, and deleting
  it needs founder approval.
- **[R6-2] (nit)** "No file names its holder" is replaced in item h, section 4 and section 7. The README identifies the
  signing identity, and the `.pub` file and mailbox note `f3047c` confirm the fingerprint. The README is no longer
  said to state the fingerprint.
- **[R6-3] (info)** Step 8 notes that YUJI's accept-main role rests on YUJI's room statement, not a founder ruling, and
  that Skywalker accepted it as narrow.
- **State at `f539cab2`.** New section 1.2 covers:
  - #395's merge, pkg3 clearance, G6, merge verification and main CI;
  - why pkg3 merges as the founder account;
  - main still unprovenanced, and accept-main held;
  - the landing order #397 → #398 → #400, then the Wonderland worker squash, and the closing of #402;
  - the blockers at `f539cab2`;
  - the r2 Wonderland source `a821a467`;
  - the Kaisin clock skew;
  - the MERGED PULL REQUESTS list.
  [RD-2], 1.1 points 2 and 3, and item i are updated to match. [FD-0808] records the 8:08 AM PT paid-API directive.
- **Correction against the brief.** The lander's own landing commit is authored `github-actions[bot]`
  (`land-lib.mjs:177` @f539), not by the App. The App-authorship rule applies to the PR head it accepts
  (`land-lib.mjs:108`, `:112` @f539). `checkPullRequest` spans `land-lib.mjs:91-128` @f539; `:130` begins the next
  function's comment.
- **Header [F539].** Older citations stay pinned at `689d2be9`. New ones are marked `@f539`. Four cited files changed in
  #395.
- **Renumbering.** The fix lists are now 8.0 (rev 7) to 8.5 (rev 2). The cross-reference in 8.4 [R2-2] is updated.
- **Citations newly used, re-read @f539** (blobs: `allowed-branches.txt` `b9b3590f`, `land-lib.mjs` `eeb7ca5d`,
  `land.mjs` `cb5aa4cd`, `julius-review-currency.mjs` `0ed3c5fe`, `julius-main-provenance.mjs` `6f2d0a45`,
  `julius-accept-main.yml` `589c79aa`, RUNBOOK `0616c09d`):
  - `allowed-branches.txt:5-13`, `:13`;
  - `land-lib.mjs:91-128`, `:104-105`, `:108`, `:112`, `:113`, `:177`;
  - `land.mjs:345`, `:366-370`;
  - `julius-review-currency.mjs:59`, `:78`, `:112`;
  - `julius-main-provenance.mjs:453-455`, `:293-296`;
  - `julius-accept-main.yml:148-155`;
  - `RUNBOOK:11-13`.
- **Readiness:** unchanged.

### 8.1 Revision 6 (fixes to rev 5 `19353d85`, after Skywalker's PASS WITH FINDINGS)

- **[R5-1] (nit)** The rev 4 and rev 2 verdicts now read "PASS WITH FINDINGS", plural, matching REPORT_rev4.md and
  REPORT_rev2.md (header and the 8.1 and 8.3 headings).
- **[R5-2] (low)** Step 8 names who starts `julius-accept-main.yml`: YUJI, by hand over the founder-authorized GitHub
  connection after each App squash, then confirming the run finished at the new main tip (YUJI, room, 7:43 AM PT). The
  trigger facts are cited: dispatch-only (`julius-accept-main.yml:70-71`, no `push` by design at `:21-24`), with
  required inputs at `:72-80` checked at `:116-123` and `:141-145`, and the App's 403 at `:17-18`. Starting a run is not
  an approval (`julius-main-provenance.mjs:663-665`). Step 4 notes that Cosmo's founder-account scope (R2-3) does not
  include this workflow. Steps 7 and item e point to step 8.
- **[R5-3] (info)** Open item h and 1.1 point 1 now record Skywalker's 7:45 AM PT result
  (`/workspace/g6-395/REPORT_kaisin.md`): the Kaisin reviewer key is confirmed against `b0b8e29b` (public half only), and
  #395 still passes. G6 is blocked because no cleared installer can land #395. The unblock is a pkg3 installer for
  PR 395 written by YUJI and cleared by Skywalker. (Superseded wording from the first rev 6 commit `5007db7a`: "candidate
  under verification".)
- **[R5-4] (info)** New [FR-6] in section 1 lists the founder's 7:27 #396 ruling.
- **Item a:** YUJI holds the App credential. Updated in section 2's trust statement, step 7 and items a and e.
- **Item b:** YUJI owns the identity-hardening follow-up (`julius-main-provenance.mjs:290-292`, `land-lib.mjs:108`,
  `:112`). It lands only after #395, through G6 with Skywalker's review.
- **Renumbering.** The fix lists are now 8.0 (rev 6), 8.1 (rev 5), 8.2 (rev 4), 8.3 (rev 3) and 8.4 (rev 2). Cross-
  references are updated in the header and in 8.3 [R2-2]. Section 8.1's own "Renumbering" bullet describes rev 5's
  numbering and is kept as history.
- **Readiness:** unchanged (section 6).
- **Citations newly used, re-read at `689d2be9`** (blob of `julius-accept-main.yml` `589c79aa`, 213 lines):
  `julius-accept-main.yml:17-18`, `:21-24`, `:70-71`, `:72-80`, `:116-119`, `:120-123`, `:141-145`, `:148-155`;
  `julius-main-provenance.mjs:663-665` (already used). None of rev 5's citations shifted.

### 8.2 Revision 5 (fixes to rev 4 `ca9400ac`, after Skywalker's PASS WITH FINDINGS, plus the founder's 7:27 AM PT rulings)

- **[FR-1] #395.** 1.1 point 1, section 1 [FR] and new open item h: approved to land at `32c5a2be` through the existing
  installer once Skywalker produces a legitimate G6 with the authorized Ed25519 key. The signing environment is still to
  be located.
- **[FR-2] / [R3-1] Squash.** Step 7 is now option B (decided), and option A is marked superseded. Open items a and e are
  updated. Section 2's trust statement and step 3 now point to the authorized App-credential holder, not the founder.
  - [R4-2] (info) The merge is executed by the authorized agent holding the App credential in its established secure
    environment. Which agent is to be confirmed in the room; YUJI owns Julius landings.
  - The untested caveat stays. The first App merge must be verified afterwards: squash commit on main, `provenant` on the
    tip, and `julius-accept-main.yml` (steps 7 and 8).
  - Open item f now notes that option B contradicts `RUNBOOK:13-14`.
- **[FR-3] Approval.** Step 6 keeps the `ohdieyuh-glitch` exact-head requirement (`julius-review-currency.mjs:270-271`) and
  the sentence that no agent submits it through the founder's account. New open item i flags the conflict with "no
  repeated founder approval" as a real blocker. The gate is not changed.
- **[FR-4] Spoofing.** Section 2 and open item b record the ruling as decided. Open item b lists the code that still rests
  on author name or email: `julius-main-provenance.mjs:290-292` (with `:642`) and `land-lib.mjs:108`, `:112`. The squash
  route's opener check at `julius-main-provenance.mjs:450-454` reads the authenticated `pull.user.login` (`:649`).
  Follow-up hardening change needed (Julius lane, separately reviewed).
- **[FR-5] Branch protection.** Section 1 [BP] and open item g: authorized, on condition that it does not deadlock the
  landing system and the App can still land.
- **[R4-1] (low)** Step 4's counting rule now says the one-run-per-name result under `filter=latest` is proven only for
  re-runs within a single workflow run.
- **[R4-3] (nit)** The rev 3 verdict is now "PASS WITH FINDINGS", plural (header and the 8.1 heading).
- **Renumbering.** The fix lists are now 8.0 (rev 5), 8.1 (rev 4), 8.2 (rev 3) and 8.3 (rev 2). Cross-references are
  updated in the header and in 8.2 [R2-2].
- **Citations newly used, re-read at `689d2be9`:** `julius-main-provenance.mjs:290-292`, `:642`, `:649`;
  `julius-review-currency.mjs:66-69`, `:78`; `RUNBOOK:3-4`, `:166-168`; `required-checks.txt:4-9`. None of rev 4's
  citations shifted.

### 8.3 Revision 4 (fixes to rev 3 `cb68c692`, after Skywalker's PASS WITH FINDINGS)

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

### 8.4 Revision 3 (fixes to rev 2 `aa7a5188`, after Skywalker's PASS WITH FINDINGS)

- **[R2-1] (MEDIUM)** 1.1 point 3 no longer names #396 as the restoring squash.
  - #396 was opened by `ohdieyuh-glitch` and would fail `julius-main-provenance.mjs:450`.
  - The restoring squash is an App-opened worker re-cut (opened by `julius-worker[bot]`, re-authored per `RUNBOOK:70-88`)
    of #396's Skywalker-cleared tree, whose tree must equal the reviewed tree. #396 is then closed unmerged.
  - Stated for any PR, not just #396; also noted at section 3, step 3.
- **[R2-2]** #395's head `32c5a2be` is a merge commit with parents `2dbe6430` and `689d2be9` (1.1 point 1, and 8.5 [RD-1]).
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

### 8.5 Revision 2 (fixes to rev 1 `f3d6ebc7`, after Skywalker's FAIL)

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
