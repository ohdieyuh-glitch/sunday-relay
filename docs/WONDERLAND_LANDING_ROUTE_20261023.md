# Wonderland landing route (2026-10-23)

Author: Cosmo (Wonderland dev agent). Status: proposal for Skywalker's exact-head review.
Revision 8: fixes [R7-1]..[R7-4] from Skywalker's PASS WITH FINDINGS of rev 7 `9a0fa7b0`. It states ONE route for the
Wonderland worker commit, the lander `julius-land` (section 3), and records who starts it and the room updates
(see section 8.0).
Revision 7 fixed [R6-1]..[R6-3] from Skywalker's PASS WITH FINDINGS of rev 6 `c233261e`, and recorded the state after
#395 landed at main `f539cab2` (new section 1.2; see section 8.1).
Revision 6 fixed [R5-1]..[R5-4] from Skywalker's PASS WITH FINDINGS of rev 5 `19353d85`, recorded YUJI as the
App-credential holder and identity-hardening owner, and added [FR-6] (section 8.2).
Revision 5 applied the founder's FINAL rulings of 2026-10-23, 7:27 AM PT ([FR-1]..[FR-5]) and fixed [R4-1]..[R4-3] from
Skywalker's PASS WITH FINDINGS of rev 4 `ca9400ac` (section 8.3).
Revision 4 fixed [R3-1]..[R3-4], the re-run answer [RR] and the no-branch-protection note [BP] from Skywalker's PASS WITH
FINDINGS of rev 3 `cb68c692` (section 8.4).
Revision 3 fixed [R2-1]..[R2-4] from Skywalker's PASS WITH FINDINGS of rev 2 `aa7a5188` (section 8.5).
Revision 2 fixed [RD-1]..[RD-6] from Skywalker's FAIL of rev 1 `f3d6ebc7` (section 8.6). [RD-7] spoofing content stayed
unchanged until rev 5 ([FR-4]).
Citations up to rev 6 are `file:line` at main `689d2be92c3158ba4a59883ed4f6cc02f700660b` (tree `ecfe4f5c`, parent
`3f20fc1a`), re-read line by line before writing. Corrections to earlier citations are listed in section 7.
[F539] Citations marked `@f539` are at main `f539cab2530b7733bd987068be676308440e04a5` (tree `bcbefd01`, parent
`689d2be9`), the #395 squash. #395 changed `land-lib.mjs`, `land.mjs`, `julius-main-provenance.mjs` and
`julius-real-infra.yml`, among others, so older citations into those four files may have shifted at `f539cab2`. For
example, the opener check `julius-main-provenance.mjs:450-454` is `:453-457` @f539 (the `if` at `:453`, its return
at `:454-456`, closing at `:457`; [R7-3]), and the signed-clearance author
check `:290-292` is `:293-296` @f539.
[A59C] Citations marked `@a59c` are at `a59c2d73d644f3ef9fa7655c14ecd7f97489726c`, the head of draft #400, stacked on
#398 `63a48f64` and #397 `55d05fd3` (compare `f539cab2...a59c2d73`: ahead 5, behind 0). The stack changes
`allowed-branches.txt`, `land-lib.mjs` and `julius-main-provenance.mjs` (blobs @a59c `4bb6f902`, `83c04970`, `de3e9b2c`),
not `land.mjs` or `julius-land.yml`. They apply only if the installer lands that stack unchanged.
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
    every required gate passes. The founder does not click Merge (section 4, step 7; open item e). [R7-1] This ruling
    governs worker-PR squashes. The Wonderland worker commit lands through the lander instead (section 3).
  - [FR-3] No repeated founder approval. This conflicts with the squash gate as coded (section 4, step 6; open item i).
    [R7-1] The lander route (section 3) has no founder review, so this conflict does not block the Wonderland commit.
  - [FR-4] Git author name and email are not trusted identity evidence; mismatches fail closed (section 2; open item b).
  - [FR-5] Branch protection or rulesets are authorized, provided they do not deadlock the landing system (open item g).
  - [FR-6] #396: Cosmo may continue all J1 Wonderland client development, repairs, tests and documentation now. After
    #395 lands, cleared changes go through the Julius landing mechanism. The draft PR #396 is never merged directly into
    main (1.1 point 3).
  - [FD-0808] Founder paid-API directive (2026-10-23, 8:08 AM PT): provider items 1-8 are YUJI's, and Skywalker reviews
    the baselines and plan before any spend. Cosmo's part is item 9, the client trace. Limits: $30 per run, 3 repair
    cycles, $60 in total. API-only smoke tests are not missions. Paid runs still need a provenant main (below).
    [R7-4] The source is the founder's directive in the room. The limits are not in the repository, so they cannot be
    checked against main's tree.
  - [R7-room] BRIDGE took RID-6 server-side, the J1 wrapper and the item-9 trace (scope assignment, room, 9:13 AM PT).
    That moves the item-9 client trace from Cosmo to BRIDGE. Cosmo keeps the J1 client code and this route.
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
  - [R7-1] That list is the founder-approval (squash) path. A tip whose message carries a signed landing block is
    judged by the signed-landing path first instead (`julius-main-provenance.mjs:235-311`, `:370-371` @f539; section 3,
    step 8), which is how the lander's commit can be `provenant`.
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
3. **Only after that,** the next worker landing can restore provenance (`docs/REPOSITORY_GOVERNANCE.md:325-328`). [R2-1]
   [R7-1] For Wonderland that landing is the lander's commit (section 3), not a squash, and it restores provenance only
   if the signed-landing check reports `provenant` on the resulting main (section 3, step 8).
   - Either way, the PR must be App-opened: `julius-worker[bot]` opens it (`julius-main-provenance.mjs:450`; the lander's
     `land-lib.mjs:104` @f539), and its commit is App-authored per `RUNBOOK:70-88`.
   - **#396 can never be that squash.** It was opened by `ohdieyuh-glitch`, so it would fail `julius-main-provenance.mjs:450`.
     Its route is an App-opened worker re-cut of #396's Skywalker-cleared tree. The re-cut head's tree must equal that
     reviewed tree. Then #396 is closed unmerged.
   - **This applies to any PR** not opened by `julius-worker[bot]`, Wonderland or Julius: re-cut it as an App-opened worker
     PR of its cleared tree and close the original unmerged.
   - [F539] [R7-1] The current plan: after the G6 installer for #397, #398 and #400 (1.2), the first worker landing is
     the lander landing the App's Wonderland PR on `relay/julius-wonderland-j1-client-recut-20261023` (section 3).
4. [R2-4] Steps 1-2 of section 3 (develop, clear the source) touch neither main nor any PR, so they can go ahead now.
   Steps 3-8 of section 3 run only after points 1-2 above and the installer for #397, #398 and #400.

### 1.2 State at main `f539cab2` (rev 7, updated in rev 8; facts with sources)

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
- **Main is not provenant yet.** `julius-main-provenance.mjs:453-457` @f539 refuses a founder-opened squash. So
  `julius-accept-main.yml` is HELD until the first provenant tip ([R7-1]: the lander landing, section 3), because it would be refused at its provenance gate
  (`julius-accept-main.yml:148-155` @f539) and must not be forced (REPORT_merge.md section 6).
- **#393 closed, pkg2 branch kept:** see 1.1 point 1.
- **#391 closed, superseded** [R7-room]. YUJI closed it unmerged at 16:15:01Z (09:15:01 PT; read from GitHub for rev 8).
  Its branch `relay/julius-landing-system-v34-pkg2` is kept, at `d5b135d2` (read from GitHub for rev 8).
- **Landing order from here:**
  1. ONE G6 installer carries three draft PRs, in order:
     - #397, identity hardening (head `55d05fd3`);
     - #398, clearance gate (head `63a48f64`, stacked on #397);
     - #400, an allowed-branches entry (head `a59c2d73`) that adds exactly `relay/julius-wonderland-j1-client-recut-20261023`.
  2. [R7-1] Then the lander `julius-land` lands the App's one-commit Wonderland PR from
     `relay/julius-wonderland-j1-client-recut-20261023`, the branch #400's entry names (section 3). It restores
     provenance only if the signed-landing check reports `provenant` on the resulting main (section 3, step 8).
  - #402 was closed (15:50:56Z, 08:50:56 PT) because it named Cosmo's source branch.
- **Blockers at `f539cab2` (all @f539):**
  - No Wonderland branch is in `.github/julius-landing/allowed-branches.txt`. The entries are at `:5-9` and `:11-13`
    [R7-3]. The check is at `land-lib.mjs:113`. The one Wonderland-related entry is `relay/julius-ask-route` (`:13`).
    #400 adds the comment `:14` and the entry `:15` @a59c; the check moves to `land-lib.mjs:137` @a59c.
  - **Squash route only** (section 4, not the Wonderland route) [R7-1]: before #398, a founder exact-head approval is
    the only approval path: `EXTERNAL_APPROVER_LOGINS = ['ohdieyuh-glitch']` (`julius-review-currency.mjs:59`),
    `REVIEW_AUTHORITY_LOGINS` (`:78`), and only `APPROVED` counts (`:112`). See item i. #398 adds a signed clearance as
    the approval on a worker-PR squash (`julius-main-provenance.mjs:406-426` @a59c, the doc comment of that path).
  - The lander creates its own landing commit (`land.mjs:345`, created at `:366-370`) with identity `github-actions[bot]`
    (`LANDER_IDENTITY`, `land-lib.mjs:177`). It accepts only an open, non-draft, one-commit PR opened by
    `julius-worker[bot]` whose head commit is App-authored, on an allowlisted branch (`checkPullRequest`,
    `land-lib.mjs:91-128`; open `:98`, not a draft `:99` [R7-3], `:104-105`, `:108`, `:112`, `:113`).
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

[R7-1] This section describes the worker-PR squash (section 4). The lander's checks for the Wonderland route are in
section 3.

**Identity checks the squash route actually enforces:**
- The PR opener is `julius-worker[bot]` (`julius-main-provenance.mjs:450`, read from `user.login` at `:649`).
- An `ohdieyuh-glitch` review approves the exact head. The founder submits it in person; no agent does (section 4,
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
  main's unmodified `julius-real-infra.yml` (section 4, step 4).
- The independent links are:
  1. the pre-merge check that the PR head's tree equals the tree Skywalker cleared;
  2. Skywalker's exact-head PASS.

## 3. Route for the Wonderland worker commit: the lander `julius-land` [R7-1]

This is the ONE route for the Wonderland worker commit. #400's allowlist entry exists for it. The worker-PR squash
(section 4) is not used for this commit. YUJI agrees with this route through #400's entry, with provenance conditional
on the signed-landing check (YUJI, room, 9:20 AM PT).

There is no founder review on this route. The gate is Skywalker's signed clearance. The PR is closed without merging,
and the lander's own commit lands on main.

Sources: `.github/workflows/julius-land.yml` (blob `cb73e004` @f539, not changed by #397, #398 or #400), `land.mjs`
(blob `cb5aa4cd` @f539, not changed by the stack), `checkPullRequest` (`land-lib.mjs:91-128` @f539, `:93-152` @a59c),
and `evaluateSignedLanding` (`julius-main-provenance.mjs:235-311` @f539, `:330-404` @a59c).

1. **Develop.** Cosmo develops on any `wonderland/*` branch. Cosmo-authored commits there are never landed as they are.
2. **Clear the source.** Skywalker clears the exact source tree as the App's copy source. Done for r2 `a821a467` (1.2).
   That is not an approval to land.
3. **Wait for the installer.** Nothing below starts until the one G6 installer carrying #397, #398 and #400 has landed
   (1.2). Without #400's entry (`allowed-branches.txt:15` @a59c) the lander refuses the branch (`land-lib.mjs:113`
   @f539, `:137` @a59c).
4. **The App's worker commit and PR (YUJI, the App-credential holder, open item a).**
   - **Token.** Handled as in `RUNBOOK:108-121` ([RD-5]). It is never printed or put on a command line.
   - **One commit on the new main.** Its parent is main after the installer, and its tree is that main plus exactly the
     4 cleared Wonderland blobs (1.2). It is App-authored and App-committed (`RUNBOOK:70-104`), with the trailer
     `Co-authored-by: Cosmo (Wonderland dev agent) <cosmo@iwonder.invalid>`.
   - **Push and open.** The App pushes it to `relay/julius-wonderland-j1-client-recut-20261023` (the branch the App
     pushes; Cosmo's source branch is not listed, `allowed-branches.txt:14` @a59c) and opens a non-draft PR to main.
     The opener must be the App (`RUNBOOK:134-143`).
   - **What the lander checks on that PR**, at `land-lib.mjs` @f539:
     - clearance PR number `:97`;
     - open and not merged `:98`, and not a draft `:99` [R7-3];
     - head equals the cleared head `:100`, in this repository `:101`, base `main` `:102`;
     - main equals the cleared base `:103`;
     - opener `julius-worker[bot]` `:104` (`APP_LOGIN`, `:6`), and exactly one commit `:105`;
     - head tree equals the cleared tree `:106`, with one parent equal to the cleared base `:107`;
     - git author and committer names `:108`, and the resolved author login `:112`;
     - allowlisted branch `:113`;
     - complete file list `:116-117`, no founder-governed path `:119-120` (`HARD_FORBIDDEN_PATH`, `:21`);
     - the bot-comment digest is unchanged since the clearance `:126`.
   - **After #397** (@a59c) the opener must be the authenticated App account `:112-113`, of type `Bot` `:114`, with a
     matching App id if one is reported `:115-116` (`WORKER_APP_ID`, `:8`). Git names and the email-derived login may
     only agree with it; any mismatch fails closed (`:120-128`), and so does a verified signature by another signer
     (`:129-136`).
   - The 4 Wonderland paths match neither `HARD_FORBIDDEN_PATH` (`land-lib.mjs:21` @f539) nor
     `SIGNED_LANDING_HARD_FORBIDDEN` (`julius-main-provenance.mjs:218` @f539). This was checked by applying both
     regexes to the 4 paths for rev 8.
5. **Required CI, with no workflow change.** The same dispatch, re-run and counting rules as section 4, step 4 apply.
   All 6 required checks must each appear exactly once and succeed on the PR head. The lander enforces this itself:
   `checkCi` (`land-lib.mjs:142-164` @f539), called at `land.mjs:327` and `:337` @f539.
6. **Exact-head PASS and signed clearance (Skywalker).**
   - Skywalker verifies `head^{tree}` against the cleared tree and posts a fresh exact-head PASS.
   - Then Skywalker signs a clearance with the reviewer key `b0b8e29b` (open item h). It names this PR, its exact
     head, tree and base (main after the installer), a nonce, and the bot-comment digest. Its lifetime is at most
     24 hours (`land-lib.mjs:96` @f539), and the signature is verified by `verifyClearanceSignature` at `:62-73`.
   - The clearance is issued only after the installer that carries #398 has landed, because it must name that main
     as its base (`land-lib.mjs:103` @f539).
   - This signature is the gate. There is no founder review on this route, so [FR-3] and item i do not apply to it.
   - Kaisin's clock runs about 99 s slow; allow for it in the clearance window (1.2).
7. **Land: YUJI starts `julius-land`.** [R7-2]
   - **Trigger facts @f539.**
     - The only trigger is `workflow_dispatch` (`julius-land.yml:31-32`).
     - Inputs: `pr` (`:34-37`), `head` (`:38-41`), `clearance_b64` (`:42-45`), `signature_b64` (`:46-49`), and
       `dry_run` (`:50-53`). `dry_run` is not required and defaults to `'true'` (`:52-53`). Its description is
       'Leave "true" to run every check and write nothing; type "false" to land.' (`:51`).
     - The input reaches the job as `DRY_RUN` (`:93`), and `land.mjs:355` writes nothing unless it is exactly
       `false`. A default run writes nothing (`julius-land.yml:25`).
     - The job runs only on `refs/heads/main` (`:73`), and the workflow commit must be main's tip
       (`land-lib.mjs:315` @f539).
   - **Who starts it: YUJI** (YUJI, room, 9:20 AM PT). YUJI starts it through the founder-authorized `ohdieyuh-glitch`
     connection, because the App has only Actions: read (`RUNBOOK:11-13`; the workflow's own permissions at
     `julius-land.yml:57-62` include no `actions`).
     - Starting a run is not an approval. "A dispatcher, including a developer session, can hand this workflow a
       clearance but cannot make one" (`julius-land.yml:14`).
     - A run goes ahead only after Skywalker's exact-head clearance (step 6).
     - On real runs YUJI always passes `dry_run=false` explicitly.
     - Like step 8's accept-main dispatch, this rests on YUJI's room statement, not on a founder ruling.
   - **Record.** GitHub lists 10 `julius-land.yml` runs (read for rev 8). All are `workflow_dispatch`, and their actor
     and triggering actor are both `ohdieyuh-glitch`. They ran on 2026-10-19 between 09:59:46 and 15:32:22 PT;
     8 succeeded and 2 failed.
   - **What the lander does @f539.**
     - It creates its own commit: the cleared tree, one parent equal to the cleared base, and the signed clearance in its
       message (`land.mjs:342`, `:345`, created at `:366-370`). Author and committer are `github-actions[bot]`
       (`LANDER_IDENTITY`, `land-lib.mjs:177`).
     - It advances main with a non-forced ref update (`land.mjs:391`) and spends the nonce as a tag (`land.mjs:3`).
     - It comments on the PR naming the landed commit (`land.mjs:422`), then closes the PR (`land.mjs:428`). The PR shows
       as closed, not merged; that is expected (dry-run summary, `land.mjs:361`).
     - The merge endpoint is never used (`julius-land.yml:22-23`).
8. **Verify; provenance is conditional.**
   - The new main's tree equals the cleared tree, and its single parent is the cleared base.
   - **Provenance is restored only if** `node scripts/julius-main-provenance.mjs ohdieyuh-glitch/sunday-relay main`
     reports `provenant` on the resulting main and exits 0. Until it does, main stays unprovenanced and no paid run
     starts ([FD-0808]).
   - **Signed-landing check @f539.** `evaluateSignedLanding` runs first (`julius-main-provenance.mjs:370-371`).
     - A tip without a landing block is `absent` (`:237`), and the founder-approval path decides (`:91`). Any defect in a
       present block is final and fails closed (`:91-95`).
     - It needs all of these:
       - the nonce matches (`:251`);
       - the reviewer key is read at the parent (`:254-258`), and the tip's key is byte-identical (`:262-267`);
       - the signature verifies (`:269-277`);
       - the clearance tree equals main's tree (`:280-282`), and its base equals the tip's parent (`:283-285`);
       - the cleared head is readable (`:286-289`), and its tree matches (`:290-292`);
       - the cleared head is authored by a worker (`:293-296`);
       - the changed paths are read completely (`:298-301`), with no founder-governed path (`:302-307`).
     - Only then does it return `provenant` (`:308-310`).
   - **If the installer lands the stack unchanged** (@a59c), the function is `:330-404`:
     - tree and base `:375-380`;
     - cleared head `:381-387`;
     - head identity `:388-389`, through `clearedHeadIdentityProblem` (`:266`) instead of `:293-296` @f539;
     - paths `:390-400`;
     - `provenant` `:401-403`.
   - **If it is not `provenant`:** stop and report to Skywalker. No other route is tried for this commit without a new
     review.
   - **Then accept-main.** Once main is `provenant`, YUJI starts `julius-accept-main.yml` on the new tip under the same
     facts as section 4, step 8 [R5-2].

## 4. Worker-PR squash (not the route for the Wonderland worker commit) [R7-1]

[R7-1] This route stays the procedure for App-opened worker PRs that land by squash. It is not used for the Wonderland
worker commit, which lands through the lander (section 3). References to "step N" in this section mean the steps
below.

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
     only (section 3). The squash in step 7 yields one commit on main either way.
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
   - [R7-1] The lander never uses the merge endpoint (`land.mjs:3`; `julius-land.yml:22-23`), so it cannot merge this
     route's PR. It lands by its own route, which is the route for the Wonderland worker commit (section 3).
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
     it is held until the first provenant tip (1.2). After each App squash or lander landing (section 3), YUJI starts it
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

### 4.1 Also not chosen

[R7-1] The rev 7 "Lander route" bullet is removed: the lander is now the route (section 3), and its requirements are
in section 3, steps 3-6.
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
  (room, 2026-10-23, after rev 5). YUJI runs section 3, steps 4 and 7 (and, on a squash, section 4, steps 3 and 7).
  Cosmo will not search for it, read it or mint a token from it.
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
- **(e) [R3-1] [FR-2] DECIDED: option B** (squash route, section 4; [R7-1] not the Wonderland route). The
  `julius-worker` App does the section 4, step 7 squash automatically after exact-head
  independent approval and once every required gate passes. Option A is superseded. Executor: YUJI, holder of the App
  credential (open item a, [R4-2]). YUJI also starts `julius-accept-main.yml` after each App squash (step 8, [R5-2]). Untested; the first App merge is verified as in step 7.
- **(f) [R3-2] `RUNBOOK:13-14` is inaccurate.** It says the installation is "deliberately not enough to merge", but it has
  `contents=write`. Option B now contradicts that text. This doc does not edit the runbook; correcting it needs its own
  approved change.
- **(g) [BP] [FR-5] Branch protection: DECIDED, authorized with a condition.** The founder authorized branch protection or
  rulesets that enforce required CI and the authorized landing procedures, provided they do not deadlock the landing
  system.
  - Condition: the `julius-worker` App must still be able to land approved PRs (section 4, step 7), and the installer and lander
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
  submits it through the founder's account (section 4, step 6).
  - [R7-1] **Scope: the squash route only.** The Wonderland worker commit lands through the lander (section 3), which
    has no founder review; its gate is Skywalker's signed clearance. This item does not block it.
  - Options: the founder clicks Approve at each landing head, or the gate gets a separately reviewed change.
  - The `julius/independent-review` commit status (`julius-review-currency.mjs:100`, `:184-201`) is an existing alternative
    SHA-bound approval, but nothing publishes it today (`:94`), and the App has only `statuses=read` (`RUNBOOK:11-13`).
    Using it would also need its own reviewed change.
  - This doc does not change the gate. Needs a ruling before any worker-PR squash.
  - [F539] Unchanged at `f539cab2` (`julius-review-currency.mjs` has the same blob, `0ed3c5fe`; `:59`, `:78`, `:112` @f539).
    Before #398 lands, a founder exact-head approval is the only approval path for a squash (1.2). After it, a signed
    clearance can also serve as that approval (`julius-main-provenance.mjs:406-426` @a59c).

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

### 8.0 Revision 8 (fixes to rev 7 `9a0fa7b0`, after Skywalker's PASS WITH FINDINGS)

- **[R7-1] (medium)** ONE route for the Wonderland worker commit: the lander `julius-land` on the App-only branch
  `relay/julius-wonderland-j1-client-recut-20261023`, the branch #400's entry names.
  - New section 3 is that route. The squash route moves to section 4 ("not the route for the Wonderland worker
    commit"). The old section 4's lander bullet is removed, and section 4.1 keeps the rest.
  - "Default route: worker-PR squash" and "Not an option: the lander" are gone. [FR-2], [FR-3], 1.1 points 3-4,
    1.2 (landing order and blockers), section 2, and items a, e, g and i now agree with section 3. Item i is scoped to
    the squash route.
  - There is no founder review on this route; the gate is Skywalker's signed clearance, issued after the installer
    carrying #398. The PR is closed without merging, and the lander's own commit lands on main.
  - Provenance is conditional on the signed-landing check reporting `provenant` on the resulting main (section 3,
    step 8). The check is cited @f539, and @a59c where the stack changes it.
  - YUJI agrees with this route, with provenance conditional (room, 9:20 AM PT).
- **[R7-2] (low)** Who starts `julius-land`: YUJI, through the founder-authorized `ohdieyuh-glitch` connection (room,
  9:20 AM PT). It is `workflow_dispatch`-only (`julius-land.yml:31-32`), and the App has only Actions: read. Starting a
  run is not an approval (`:14`). A run goes ahead only after Skywalker's exact-head clearance, and YUJI always passes
  `dry_run=false` explicitly on real runs. The `dry_run` input is cited (`:50-53`, `:93`; `land.mjs:355`). The 10
  recorded runs were all started from `ohdieyuh-glitch` (read from GitHub).
- **[R7-3] (nit)** The allowlist entries are at `:5-9` and `:11-13`, not `:5-13`. The lander's non-draft rule
  (`land-lib.mjs:99`) is cited, and the header now gives the opener check as `:453-457` @f539.
- **[R7-4] (info)** [FD-0808] notes that the $30 / 3-cycle / $60 limits come from the founder's room directive and are
  not in the repository.
- **Room updates.** #391 is closed as superseded (16:15:01Z, 09:15:01 PT) with branch
  `relay/julius-landing-system-v34-pkg2` kept at `d5b135d2` (1.2). BRIDGE took RID-6 server-side, the J1 wrapper and
  the item-9 trace (9:13 AM PT, section 1).
- **Against the brief.**
  - The lander already verifies signed clearances @f539 (`land-lib.mjs:62-73`). #398 adds a signed clearance as the
    approval on a worker-PR squash (`julius-main-provenance.mjs:406-426` @a59c), not to the lander. On the lander route
    #398 is an ordering dependency: the clearance must name the post-installer main as its base (`land-lib.mjs:103`).
  - #397 changes the lander's identity checks and the signed-landing head-identity check. Both are cited @a59c
    (section 3, steps 4 and 8).
- **Header [A59C].** New citations at #400's head `a59c2d73` are marked `@a59c`.
- **Renumbering.** The fix lists are now 8.0 (rev 8) to 8.6 (rev 2). The header and the cross-reference in 8.5 [R2-2]
  are updated. Fix lists 8.1-8.6 keep the section numbers of their own revision (their "section 3" is now section 4).
- **Citations newly used.**
  - @f539: `julius-land.yml:14`, `:22-23`, `:25`, `:31-32`, `:34-53`, `:57-62`, `:73`, `:93`;
    `land.mjs:327`, `:337`, `:342`, `:355`, `:361`, `:391`, `:422`, `:428`;
    `land-lib.mjs:6`, `:21`, `:62-73`, `:96-108`, `:112-113`, `:116-117`, `:119-120`, `:126`, `:142-164`, `:315`;
    `julius-main-provenance.mjs:91-95`, `:218`, `:235-311`, `:370-371`, `:453-457`; `allowed-branches.txt:5-9`, `:11-13`.
  - @a59c: `allowed-branches.txt:14-15`; `land-lib.mjs:8`, `:93-152`, `:112-116`, `:120-137`;
    `julius-main-provenance.mjs:266`, `:330-404`, `:375-403`, `:406-426`.
- **Readiness:** unchanged, Wonderland 56.25%.

### 8.1 Revision 7 (fixes to rev 6 `c233261e`, after Skywalker's PASS WITH FINDINGS, plus the state at `f539cab2`)

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

### 8.2 Revision 6 (fixes to rev 5 `19353d85`, after Skywalker's PASS WITH FINDINGS)

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

### 8.3 Revision 5 (fixes to rev 4 `ca9400ac`, after Skywalker's PASS WITH FINDINGS, plus the founder's 7:27 AM PT rulings)

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

### 8.4 Revision 4 (fixes to rev 3 `cb68c692`, after Skywalker's PASS WITH FINDINGS)

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

### 8.5 Revision 3 (fixes to rev 2 `aa7a5188`, after Skywalker's PASS WITH FINDINGS)

- **[R2-1] (MEDIUM)** 1.1 point 3 no longer names #396 as the restoring squash.
  - #396 was opened by `ohdieyuh-glitch` and would fail `julius-main-provenance.mjs:450`.
  - The restoring squash is an App-opened worker re-cut (opened by `julius-worker[bot]`, re-authored per `RUNBOOK:70-88`)
    of #396's Skywalker-cleared tree, whose tree must equal the reviewed tree. #396 is then closed unmerged.
  - Stated for any PR, not just #396; also noted at section 3, step 3.
- **[R2-2]** #395's head `32c5a2be` is a merge commit with parents `2dbe6430` and `689d2be9` (1.1 point 1, and 8.6 [RD-1]).
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

### 8.6 Revision 2 (fixes to rev 1 `f3d6ebc7`, after Skywalker's FAIL)

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
