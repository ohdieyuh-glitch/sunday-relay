# C2 acceptance protocol vs J1 client addenda: 7 conflicts (2026-10-23, Wonderland dev agent "Cosmo")

Revision 2: follows Skywalker's review of ae67f50a (PASS WITH FINDING). Corrections to conflicts 4-7 and four missed conflicts (M1-M4, Skywalker's findings) are added. Every new J1 citation was re-read with `git show 22a0a9cb:<path>`.

Revision 3: follows Skywalker's review of rev 2 at ab26e15e (PASS WITH FINDING, minor). It fixes the M3 SPEC line (171) and gives a per-kind reachability statement, removes an unresolved label from M4 and cites J1:29-35 and :782-826 directly, and closes the 1254b0d1 open item per Skywalker.

Revision 4: follows Skywalker's review of rev 3 at 8f312b32 (blob f7af3ee9; PASS WITH FINDING). The previous revision is rev 3 (8f312b32), not rev 2: Cosmo mislabelled it as rev 2 in places. Rev 4 adds only Skywalker's findings: the bridge target is now confirmed (Sources notes; Missing or unverifiable citations); M5 (medium, `artifactSha256` vs `artifactJudgedSha256`, which also amends conflict 4); M6 (low, no bridge instance id in `run_start`); SPEC:293 in M4; and a terminology note on "C2". Every rev 4 J1 citation was re-read with `git show 31bfc58b:<path>`. Rev 4 proposes no new resolutions; YUJI owns those.

Revision 5: follows Skywalker's review of rev 4 at 9b50b4d4 (PASS WITH FINDING; report `REPORT_rev4.md`) and two nits from YUJI. The previous revision is rev 4 (9b50b4d4). Each fix is labelled in place: R4-1 (medium, Skywalker; YUJI first gave the order, as RF1) the third-dispatch refusal paths in M4; R4-2 (low, Skywalker; YUJI's RF4) `SHA256SUMS.txt` now lists this file's sha256; R4-3 (low, Skywalker) the "C2" terminology note; R4-4 (nit, Skywalker) the 8,000 UTF-16 code-unit condition in M5; R4-5 (low, Skywalker) every rev 1-3 Proposal block is marked as superseded by YUJI's resolutions (`/workspace/julius/c2/C2_J1_RESOLUTIONS_PROPOSED_20261023.md`, sha256 `a008a01878f499e00c6552f1cd6df5d51376f9bd07be665dee272f6569734c9e` as read 2026-10-23 04:22 PT), not deleted; RF2 (YUJI) M5's "checker-judged" label; RF3 (YUJI) the `run_start` append starts at J1:854. Every rev 5 J1 citation was re-read with `git show 31bfc58b:<path>`. Rev 5 proposes no resolutions; YUJI owns those.

Revision 6: follows Skywalker's findings on rev 5 at 672d1358 (blob e99fde0f). The previous revision is rev 5 (672d1358). Each fix is labelled in place: R5-2 YUJI's resolutions are now pinned by GitHub location as RES (Sources): `7773fc53:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `0a43daba`, sha256 `2635f73a…a8a8`, 750 lines. Cosmo fetched it read-only and checked that the blob id and sha256 match before citing it. All eight superseded Proposal blocks now point to RES. The rev 5 note's reference to the local working copy (`/workspace/julius/c2/C2_J1_RESOLUTIONS_PROPOSED_20261023.md`, sha256 `a008a018…`) is HISTORICAL and is left as written. RES is YUJI's proposal, not a PASS; the R4-F and (c) rulings are pending with the founder. Nit 1: the bridge error body is `{ error: { kind, message } }` everywhere (J1:952; M3 path 3 and the M4 429 note corrected). Nit 2: M5 now says the cut is to 8,000 UTF-16 code units, not "8,000-char". Nit 3: the M4 Conflict line now follows its J1 citations. Nit 4: J1T:838-850 is added to the M4 test list. R5-1 (YUJI owns the test): a note in M4 that the same-day default-cap gap applies to every mission. Every rev 6 J1 citation was re-read with `git show 31bfc58b:<path>`. Line shifts are listed at the end. Rev 6 proposes no resolutions; YUJI owns those.

Revision 7: follows Skywalker's review of rev 6 at 8b5d5233 (blob 9cf820e5; PASS WITH FINDING, one nit, R6-1) and YUJI's resolutions rev 6. The previous revision is rev 6 (8b5d5233). Each change is labelled in place. Re-pin: RES now points to YUJI's resolutions rev 6, `4515c548:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `a9d717b6`, sha256 `af9abf79…e2b5`, 773 lines (Sources). Cosmo fetched it read-only and checked that the blob id and sha256 match before citing it. Skywalker gave it PASS WITH FINDING (nits I1 and I2 open in YUJI's doc). It is still YUJI's proposal, not a ruling; the R4-F and (c) rulings are pending with the founder. The rev 6 pin (`7773fc53`, blob `0a43daba`) is HISTORICAL: it is kept as the Sources row RES-r4, and the rev 6 note above is left as written. All eight superseded Proposal blocks now point to the new RES. R6-1 (nit, Skywalker): M4's "Not covered" list called R5-1 "YUJI's"; the finding is Skywalker's, and YUJI owns the test. No J1 citation changed in rev 7. Line shifts rev 6 → rev 7 are listed at the end (YUJI's Appendix E covers only rev 5 → rev 6). Rev 7 proposes no resolutions; YUJI owns those.

Revision 8: follows Skywalker's review of rev 7 at 8b0e71d2 (blob 2f4eb6d4; PASS, no findings) and YUJI's resolutions rev 7. The previous revision is rev 7 (8b0e71d2). Each change is labelled in place. Re-pin: RES now points to YUJI's resolutions rev 7, `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`, sha256 `49f77dea…5dbf`, 839 lines (Sources). Cosmo fetched it read-only and checked that the blob id, the full sha256 and the line count match before citing it. Skywalker gave it PASS WITH FINDING (one nit, J1-1: YUJI's chat announcement said +102/−29; the commit is +107/−41; nothing in YUJI's doc needs to change; report `/workspace/c2-resolutions-review/REPORT_rev7.md`). The rev 7 pin (`4515c548`, blob `a9d717b6`) is HISTORICAL: it is kept as the Sources row RES-r6, and the rev 7 note above is left as written. All eight superseded Proposal blocks now point to the new RES. Founder rulings of 07:27 PT 2026-10-23, now recorded as DECIDED (quoted verbatim as RES quotes them, RES:305 and :152): R4-F in M5, and run-id (c) in the run-id section. RES is still YUJI's proposal for everything else. Skywalker's note (J1-4): nothing captures the coder's untrimmed final message yet, so today every scrubbed or cut run FAILS C5d (M5). No J1 citation changed in rev 8. Line shifts rev 7 → rev 8 are listed at the end. Rev 8 proposes no resolutions; YUJI owns those, and readiness is unchanged.

Status: documentation only. Changes nothing, awards nothing, makes no readiness claim (readiness stays 56.25% verified; R16 credit 0 of 18.75). No criterion is weakened here; every resolution is a PROPOSAL for the protocol owner (JUDEV2/C2) and the client owner (WDEV) to accept or reject.

Line numbers are 1-based and were read from the exact bytes whose sha256 is listed below. Quotes are short excerpts.

## Terminology: "C2" (rev 4; Skywalker's finding)
"C2" now means three different things. From rev 4 on, this doc cites by path and sha256 (or file and line), not by the label alone. Rev 5 (Skywalker's R4-3): rev 4 listed this doc's own title label as a separate meaning, but it is the same as the protocol, so that bullet is merged into the first; and rev 4 missed the protocol's crosscheck row C2, now added.
- The in-world acceptance protocol: JUDEV2 `_independent_review_judev2_20261021\C2\INWORLD_ACCEPTANCE_PROTOCOL.md`, sha256 `58ba107e0fa1dc4858c075f396c9ae4cef686646bb27005ffcfb026b8d0aa2db` (tag PROT). On GitHub it exists only as the byte copy on this docs branch. **Skywalker has never certified the protocol's content.** Skywalker's reviews of this doc check that citations match the cited bytes; they do not make the protocol correct. The "C2" in this doc's title and file name means this protocol.
- J1's frozen-brief test: `relay-bridge/julius-dispatch.test.ts:1063` at 31bfc58b (J1T, `describe('C2: the brief hash equals the frozen contract hash, ...')`), with the refusal `julius_dispatch_brief_not_frozen_contract` at J1:733.
- The protocol's crosscheck row **C2**: PROT:34 "`| C2 | architect, coder, reviewer each have pre_call before result | neg_missing_pre_call |`". This is the meaning most easily confused here, because this doc cites other PROT check ids (C1, C5, ...).

## Sources (sha256 of the exact bytes cited)

| Tag | Original path on Kaisin (C:\dev\iwonder\...) | Copy in this commit | sha256 |
|---|---|---|---|
| PROT | `_independent_review_judev2_20261021\C2\INWORLD_ACCEPTANCE_PROTOCOL.md` (74 lines) | `docs/sources/_independent_review_judev2_20261021/C2/INWORLD_ACCEPTANCE_PROTOCOL.md` | `58ba107e0fa1dc4858c075f396c9ae4cef686646bb27005ffcfb026b8d0aa2db` |
| SPEC | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\j1\CLIENT_PACKAGE_SPEC_r1.md` (380 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/j1/CLIENT_PACKAGE_SPEC_r1.md` | `43958afa8960e8a3d3d3c82cf7aa0a64cc51d2597127eb2cc191310322aea7d2` |
| ECHO | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\j1\CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md` (20 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/j1/CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md` | `f03e7f91e7a72a0ebc0dd606fc152d0d6f89ebbc093c2db79dcbc28122a03e11` |
| PLANADD | `_qa_handoff\julius_readiness\followon_100\inworld_missions_20261022\ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md` (17 lines) | `docs/sources/_qa_handoff/julius_readiness/followon_100/inworld_missions_20261022/ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md` | `ce1aff4769174b1046c5632bcd48b5b7190ca90283baabd6052be7d8a7a8e97d` |
| J1 | sunday-relay `relay-bridge/julius-dispatch.ts` at commit `22a0a9cb2cc93f64929f1dd855aa242936f739e9` (blob `018fb582b427ad4fc884b9965d8bd3d8080ebf5b`, 1050 lines; rev 4: the same blob at the bridge target `31bfc58b`; read with `git show 22a0a9cb:relay-bridge/julius-dispatch.ts`) | not copied: it is already readable at that fixed commit | `0a29be76e58fae6a9938a33704434ff6ffdc8df406007918d0c5a12ee6588fe6` |
| J1A | sunday-relay `relay-bridge/julius-dispatch-adapters.ts` at 22a0a9cb (617 lines; same blob `579f513a` at 31bfc58b) | not copied (fixed commit) | see `git show` |
| J1W | sunday-relay `relay-bridge/julius-dispatch-wiring-core.ts` at 22a0a9cb (282 lines; same blob `6c1fe492` at 31bfc58b) | not copied (fixed commit) | see `git show` |
| J1B | sunday-relay `relay-bridge/julius-dispatch-bundle.ts` at 31bfc58b (blob `3770e76b`, same at 22a0a9cb) | not copied (fixed commit) | see `git show` |
| J1WT | sunday-relay `relay-bridge/julius-dispatch-wiring.test.ts` at 31bfc58b (blob `a5e2861a`, same at 22a0a9cb) | not copied (fixed commit) | see `git show` |
| J1T | sunday-relay `relay-bridge/julius-dispatch.test.ts` at 31bfc58b (blob `91a8ff80`, same at 22a0a9cb) | not copied (fixed commit) | see `git show` |
| RES | YUJI's C2/J1 resolutions, rev 7 (rev 8 re-pin; supersedes the rev 7 pin, see RES-r6 below): sunday-relay `docs/C2_J1_RESOLUTIONS_20261023.md` at commit `af3c105f0449f42efbaaea407ea261dda998f155` on branch `docs/julius-c2-j1-resolutions-20261023` (parent `4515c548`, tree `22d3d9f595ec605908f803dcc8e9b007781d1a1f`; blob `cf52875879aea9b8584a42ae14d85b93f306f11f`, 839 lines; read with `git show af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md` after a read-only fetch, 2026-10-23 PT). A PROPOSAL by YUJI, except the two items that carry the founder's 07:27 PT rulings verbatim (R4-F at RES:305, run-id (c) at RES:152), which are DECIDED. Skywalker's review of af3c105f: PASS WITH FINDING (nit J1-1, in YUJI's chat announcement only: the diff is +107/−41, not +102/−29; no doc change needed). Its own CONF citations stay pinned to rev 5 (672d1358); its Appendix F maps rev 6 → rev 7 of this doc | not copied (fixed commit) | `49f77deae589cbcac9aa1d83aa060bcfcb0bdc2d1f7ecdbe9c1bf63d0ae35dbf` |
| RES-r6 | **HISTORICAL (superseded in rev 8 by RES above).** The rev 7 pin: YUJI's C2/J1 resolutions, rev 6, sunday-relay `docs/C2_J1_RESOLUTIONS_20261023.md` at commit `4515c548633bb75a53d15b91270c15fc6fec8753` on branch `docs/julius-c2-j1-resolutions-20261023` (parent `15d17c17`, tree `ab5add36446d4368ebbb4ea1069aba1af91b4ffe`; blob `a9d717b6bc7b3fcc92b5b7925987342fe91df62e`, 773 lines). Skywalker: PASS WITH FINDING (nits I1 and I2, fixed in rev 7). Kept for anyone citing rev 7; do not cite it for current resolutions | not copied (fixed commit) | `af9abf794b2a8460bdeb3dbad3b22099a9a8eaf2c72a591aae33fed443d3e2b5` |
| RES-r4 | **HISTORICAL (superseded in rev 7 by RES-r6, and in rev 8 by RES above).** The rev 6 pin (R5-2): YUJI's C2/J1 resolutions, rev 4, sunday-relay `docs/C2_J1_RESOLUTIONS_20261023.md` at commit `7773fc53a0286e319c658edf58db9fe5f7b95135` on branch `docs/julius-c2-j1-resolutions-20261023` (parent `689d2be9`, tree `3aefcd3f`; blob `0a43daba228e8c255b35beb88400401a86634358`, 750 lines). Kept for anyone citing rev 6; do not cite it for current resolutions | not copied (fixed commit) | `2635f73af5f9857a105d9a52e19f64cf00f748008886c0a1ce6f3489ef8ad8a8` |

Notes on the sources:
- **Path discrepancy.** The protocol is NOT under `...\inworld_missions_20261022\`. That folder holds only `j1\` and the PLAN addendum. The protocol was found at the PROT path above (mtime 2026-10-22 01:05 PT). SPEC line 372 (U10) also records that a filename search under `_qa_handoff` did not find it.
- The PLAN addendum lives one level above `j1\`, not inside it. Its title calls it an addendum to SPEC r1, so it is cited and copied. The `PREREG_v*_ADDENDUM_*_DRAFT.md` files in `j1\` are pre-registration addenda. None of the 7 conflicts depends on them, so they are neither cited nor copied.
- Precedence: ECHO line 1 says "Where it differs from spec r1 and from ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md, THIS wins." So the order is ECHO > PLANADD > SPEC.
- Commit 22a0a9cb (committer time 2026-10-23 01:09 PT) is contained in the remote-tracking branch `origin/judev/j1-combined-ceiling` (`git branch -a --contains`). There is no local branch of that name. **The tip in rev 1 is stale.** The local remote-tracking ref shows `126b3713`, but `git ls-remote` (2026-10-23 ~01:5x PT) shows origin `judev/j1-combined-ceiling` = `1254b0d1fee745ea5998898e4d0f111c5cf74558`. That object is not in the local repo (no fetch was done). **Rev 3:** per Skywalker, 1254b0d1 builds on 22a0a9cb. It is 4 commits ahead and 0 behind, with linear history, and the 4 commits touch only the reviewer prompt and evidence. Cosmo did not re-verify this locally, because the object is absent and fetching was out of scope. **Rev 4:** the objects are now present on Kaisin, so Cosmo re-verified. `git ls-remote` (2026-10-23 04:08 PT) shows origin `judev/j1-combined-ceiling` = `71d9f6f82aa6a99d0f3f655e7e021ee92ef88436`. Its parent is `1254b0d1`, whose parent is the target `31bfc58b` (3 commits ahead of `22a0a9cb`). `git diff --name-only 31bfc58b 71d9f6f8` lists only 10 files, all under `.github/julius-missions/review-evidence/j1-combined-ceiling/31bfc58b/`.
- ECHO line 1 says its bridge contract was read at `judev/inworld-dispatch` tip 2f8c346a. The `run_created` code cited here comes from a different branch/commit (22a0a9cb). **Rev 4 (Skywalker's finding):** the bridge target is confirmed as `31bfc58b89de137670e5dbaf752c3328b31163f7` (tree `46744fc1`), per YUJI. Skywalker confirmed that the cited J1 files are byte-identical at `31bfc58b` and `22a0a9cb` (`julius-dispatch.ts` blob `018fb582`), so the J1 line numbers in this doc hold at the target. Cosmo re-checked the blobs of all six `relay-bridge/` files in Sources at both commits; they match. `1254b0d1` and `71d9f6f8`, the only commits after the target, add only evidence files. 2f8c346a (ECHO:1) is an older ancestor of `31bfc58b` (20 commits back) and is not the target.

## Conflict 1: log prefix `WLMISSION` vs `WLJMISSION`
- **Protocol:** PROT:6 "Client (one line each, prefix `WLMISSION`, never `JULIUS STREAM:` or `WLBRAIN`..."
  - The line formats at PROT:7-10 all start `WLMISSION ...`.
  - N1 expects "`WLMISSION refused kind=unauthorized`" (PROT:60).
- **J1 side:**
  - ECHO:8 "Log line A (prefix `WLJMISSION`, kind `ui_action`...".
  - ECHO:15 "## 4. Log lines (prefix WLJMISSION, line-anchored...".
  - PLANADD:4 "U2: client lines use the prefix WLJMISSION (not WLMISSION)... EXACT LINE-ANCHORED match".
  - SPEC:240-245 still uses `WLMISSION`. SPEC:364 (U2) records the collision: "`WLMISSION` prefix collides with existing client lines".
- **Conflict:** `crosscheck.py` built to PROT:6-10 would match no J1 client line, so C1/C4/C5/C9 could not pass for a reason unrelated to the run. ECHO wins on the client side.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):** the protocol and crosscheck adopt `WLJMISSION`, anchored at line start, as PLANADD:4 asks.

## Conflict 2: one `trigger` line vs `ui_action` / `run_id_received` / `trigger`
- **Protocol:**
  - PROT:7 defines one line, "`WLMISSION trigger run=<id> mission=<id> key_hash=... utc=<ISO8601Z> [rehearsal=fake]`".
  - PROT:33 C1: "exactly one in-game trigger; its utc < first ledger pre_call".
  - PROT:24: "The ledger `pre_call` must be later than the client `trigger` line."
- **J1 side:**
  - ECHO:8 adds line A `ui_action` ("local UTC, NO run id").
  - ECHO:10 adds "log line B `run id received` with the run id".
  - ECHO:16 lists "`ui_action`, `offset`, `run_id_received`, `trigger` ...".
  - PLANADD:6 gives the order "(i) log a "UI action" line ... BEFORE the mission POST is sent; (ii) mission POST; (iii) log a "run id received" line...".
  - PLANADD:10: "C1 ... needs to say which of the two lines it uses and add the new inequality UI-action < ledger run-created."
  - J1 enforces this bridge-side at J1:248 ("THE ORDERING RULE: UI-action < run_created <= first pre_call <= result") and J1:768 ("UI-action < run_created: the client's claimed UI time must parse, and must precede the bridge's own clock reading").
- **Conflict:**
  - C1 does not say which of the J1 lines is "the trigger".
  - The protocol has no `ui_action`-before-`run_created` check.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):**
  - C1 names the `WLJMISSION trigger` line (it carries run, key_hash, player_hash and build, per ECHO:16), with "exactly one" and "utc < first pre_call" kept unchanged.
  - Add rule C1b: exactly one `ui_action` line for the run; its UTC < ledger `run_created.at`; and ledger `run_created.uiActionUtc` equals that line's UTC.
  - Any reorder or extra line is a FAIL. Nothing in C1 is relaxed.

## Conflict 3: J1's `run_created` ledger row is not named in the protocol
- **Protocol:** PROT:11 lists the ledger rows: "`run_start` {runId, missionId, frozenSha256, budgetCapUsd, authorizedPlayerHash}; per leg `pre_call` {...} ... and `result` {...}; a `final` result row {resultSha256}". There is no `run_created`.
- **J1 side:** J1:846-852 (at 22a0a9cb):
  - "RUN_CREATED: this route creates the run's dispatch in ONE authenticated flow (there is no separate creator route in this branch)".
  - It appends `phase: 'run_created', runId, dispatchId, creatorPlayerHash: callerHash, creatorKeyHash: keyHash, uiActionUtc: input.clientUiActionUtc, clientTriggerId, clientLogSha256, at, clientOffsetMs, echoId`.
  - J1:853 "THE RUN_START ROW precedes every pre_call row". This is the comment; the `run_start` append itself starts at J1:854 (rev 5, YUJI's RF3).
  - J1:254-267 refuse when `run_created_missing`, `ui_action_not_before_run_created` or `row_before_run_created`.
  - PLANADD:11 asks for exactly this as "a named field" and marks it "UNVERIFIED, to be checked against wt_j1". At 22a0a9cb the row exists in code. This is code-level only: no run has produced it under the protocol.
- **Conflict:** crosscheck cannot check creator attribution (creatorPlayerHash/creatorKeyHash vs the client's player_hash/key_hash) or the UI-action ordering, because the protocol does not name the row.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):**
  - Add `run_created` to PROT section 0 with the J1:849-851 fields.
  - Require exactly one per run, before `run_start`.
  - Require `creatorKeyHash` == client `key_hash` and `creatorPlayerHash` == client `player_hash` == `authorizedPlayerHash`.

## Conflict 4: C5 and the on-screen check use `result_sha256[:12]`; ECHO §3 displays `artifactSha256[:12]`
- **Protocol:**
  - PROT:9 result line "`body_sha256=<64> result_sha256=<64> digest_ok=<0|1>`".
  - PROT:37 C5 "client `result_sha256` == ledger final `resultSha256`, `digest_ok=1`".
  - PROT:45 "reviewer compares `check <12>` sub-line to the first 12 hex of result_sha256 by eye".
- **J1 side:**
  - ECHO:1 precedence ("THIS wins").
  - ECHO:14: the game "DISPLAYS THE FIRST 12 HEX CHARACTERS of that value [`artifactSha256`]... `resultSha256` is NEVER labelled or shown as the artifact hash".
  - ECHO:14 also says the ledger coder row "carries the same value under the field `artifactJudgedSha256`". **Rev 4 (M5, Skywalker):** at 31bfc58b this holds only under conditions; see M5.
  - ECHO:16 result line is "`result` (artifact_sha256 full, digest12, digest_ok, rows)". The client result line no longer carries `result_sha256` (or `body_sha256`).
  - SPEC:211 ("`check <first 12 of resultSha256>`") and SPEC:287 ("the screenshot's `check <12>` equals `result_sha256[:12]`") are superseded by ECHO. So are SPEC:243 (line 4 carries `result_sha256`) and SPEC:258.
- **Conflict:**
  - C5 compares a client field that the ECHO result line no longer emits.
  - The by-eye check compares the screen against the wrong hash: the screen shows `artifactSha256[:12]`.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):**
  - C5 becomes: client `artifact_sha256` == the result JSON `artifactSha256`, with `digest_ok=1` and `digest12` == `artifact_sha256[:12]`. **Rev 4 (M5, Skywalker):** rev 1-3 also required "== the ledger coder row `artifactJudgedSha256` (ECHO:14)". That part is withdrawn: at 31bfc58b the two are equal only under the conditions in M5. How C5 should treat the ledger value is left to YUJI's resolutions (RES, a proposal, not PASSed).
  - The by-eye check compares on-screen `check <12>` with `artifact_sha256[:12]`.
  - The ledger `final.resultSha256` stays checked bridge-side (whole result bytes) but is not compared with the screen.
  - **Correction (rev 2):** the f00041 equality test already exists. It is commit `5eb51efbaaa47952b848877642ac121ccf05d29b` (2026-10-22 08:59 PT, "the artifact hash the client receives equals the ledger artifactJudgedSha256"), which adds a test to `relay-bridge/julius-dispatch-wiring.test.ts` asserting `result.artifactSha256 == sha(artifactText.trim())` and `== coder.artifactJudgedSha256`. `git merge-base --is-ancestor 5eb51efb 22a0a9cb` is true. Rev 1 wrongly said it was pending. **Rev 4 (M5, Skywalker):** that test (J1WT:281-292 at 31bfc58b) shows equality only for its fixture, a bundled coder leg whose text has no key and is at most 8,000 UTF-16 code units before the trim (rev 5 wording, Skywalker's R4-4; see M5). It does not show that the two values are equal in general.

## Conflict 5: N9 bridge restart mid-run: J1 can only take the refuse branch
- **Protocol:** PROT:68 N9 "client shows disconnected; on resume either same run completes from ledger or refuses; no duplicate pre_call for a finished leg".
- **J1 side:**
  - PLANADD:12 "J1 refuses a repeat (not resumable, j1 OPEN_ITEMS 8), so J1 can only satisfy the refuse branch; it must not claim recovery."
  - SPEC:329 F18 "bridge restart mid-chain / after chain | events 404 `julius_dispatch_run_unknown` -> `The server does not know that run any more`; `ORPHANED` -> row".
  - SPEC:165 maps `julius_dispatch_run_unknown` "also after a bridge restart".
  - ECHO:4: the echoId is "forgotten on bridge restart".
- **Conflict:** N9 as written accepts "completes from ledger", which J1 cannot do. A J1 run must never be credited as a recovery.
- **Severity (rev 2, Skywalker):** this is a NARROWING, not a contradiction. PROT:68 already allows "or refuses", so J1 can pass N9 through the refuse branch alone.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):**
  - For J1, N9 PASS = refuse branch only: ORPHANED row, a `refused` line, and no new pre_call for any leg after restart.
  - Any "completed after restart" outcome on J1 is a FAIL, not a pass.

## Conflict 6: M2/N8 refuse-to-send while `LogHttp VeryVerbose` is on
- **Protocol:**
  - PROT:51 M2 "even with `LogHttp VeryVerbose` requested (the client must refuse to send while it is on)".
  - PROT:67 N8 "log leak sweep with `-LogCmds="LogHttp VeryVerbose"` | send refused".
- **J1 side:**
  - PLANADD:13 "Spec r1 lists a leak sweep but I have not confirmed that it specifies the refuse-to-send behaviour: UNVERIFIED".
  - ECHO (lines 1-20) does not mention it.
- **Finding:** the conflict as stated ("not in the client spec") is NOT reproduced against SPEC at sha256 43958afa…. SPEC does specify the refusal:
  - SPEC:74 "Gates, checked in this order BEFORE anything is sent".
  - SPEC:77 "`UE_LOG_ACTIVE(LogHttp, VeryVerbose)` ... -> `Not sent: HTTP logging is too verbose...` kind `local_http_verbose` (J1 D3/N8)".
  - SPEC:314 F3 "`LogHttp VeryVerbose` active | `kind=local_http_verbose`, nothing sent".
- **Residual gaps:**
  - PLANADD:13 is stale.
  - ECHO:16 says `refused` carries "(code only)", and ECHO:12 says "refusals are shown from the error `code` only". SPEC:74 and PROT:60 use `kind=`.
  - **Expanded (rev 2, Skywalker):** the bridge's HTTP error body has no `code` field. It is `{ error: { kind, message } }` (J1:952 `const err = (status, kind, message) => ({ status, body: { error: { kind, message } } })`). A client built literally to ECHO:12/:16 would read a field the bridge does not send. The field name must be pinned to `kind` (as SPEC:155 and :157 say), or the addendum must say that "code" means `error.kind`.
  - SPEC:377 (U15) leaves open whether the header-print risk applies to the Windows HTTP backend. The client gate is required either way.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):** keep M2/N8 unchanged, and state in the protocol that the expected J1 line is `WLJMISSION refused ... local_http_verbose` with nothing sent and no ledger `pre_call`.

## Conflict 7: rehearsal label `rehearsal=fake` vs "REHEARSAL (fake provider)"
- **Protocol:**
  - PROT:7 trigger "`[rehearsal=fake]`".
  - PROT:19 B4 "trigger line carries `rehearsal=fake`".
  - PROT:32 C0 "no `rehearsal=fake` / `mode=fake` anywhere".
- **J1 side:**
  - PLANADD:14 "Spec r1 uses a "REHEARSAL (fake provider)" row prefix ... format to be aligned to the protocol token `rehearsal=fake`".
  - SPEC:199 "EVERY row headline is prefixed `REHEARSAL (fake provider) - `" (on-screen rows).
  - SPEC:240 line 1 "`utc=<ISO>[ rehearsal=fake]`".
  - SPEC:305 N0 "line 1 `rehearsal=fake`".
  - ECHO:16 (which wins) defines the `trigger` field list as "(carries run id, key hash, player hash, build id, utc)". It does not list `rehearsal=fake`.
- **Conflict:**
  - SPEC carries both forms: the screen prefix and the log token.
  - The governing ECHO line set does not list the token. A literal ECHO implementation could drop it, and C0/B4 would then miss a fake run.
- **Impact narrowed (rev 2, Skywalker):** a fake run is still caught by C0 without the client token. PROT:32 C0 also rejects `mode=fake` anywhere. The J1 ledger writes `mode: ctx.mode` on every `pre_call` (J1:500-501) and on the final `result` row (J1:638). The remaining gap is B4's client-side label check (PROT:19), not fake-run detection.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):**
  - ECHO §4 `trigger` (and `result`) must carry `rehearsal=fake` whenever mode is fake.
  - The screen prefix "REHEARSAL (fake provider) - " stays as the player-visible label.
  - C0 matches the log token. M1/video review checks the screen prefix.

## Missed conflicts found by Skywalker (M1-M4 added in rev 2, M5-M6 in rev 4; all attributed to Skywalker; M1-M4 citations re-read by Cosmo at 22a0a9cb, rev 4 citations at 31bfc58b)

### M1: no run-creating route; the run lookup is a frozen stub
- J1:846-847 "this route creates the run's dispatch in ONE authenticated flow (there is no separate creator route in this branch)".
- J1A:567-582 `createFrozenRunLookup`: "J1 creates its own run ... so there is no Julius store row to read. The lookup answers, for the ONE configured project, with the frozen mission record ... in state READY; any other project is "no such run". It proves nothing about the run id" (J1A:568-571). It returns `{ missionId, contractSha256, state: 'READY' }` for any query on the configured project (J1A:578-579).
- **Conflict:**
  - PROT:24 ("no pre-created run") and the PLANADD:6 / ECHO:10 sequence ("mission POST ... run id received") assume a mission/run is created and its id is returned.
  - In J1, run existence comes only from the dispatch itself.
- **Status:** CONFIRMED. The acceptance record must state: "run lookup is a frozen stub; run existence is not evidence of mission creation". See the run-id section.

### M2: N1 `kind=unauthorized` vs the bridge's actual refusals
- PROT:60 N1 "refusal row in game, `WLMISSION refused kind=unauthorized`, NO ledger pre_call".
- The bridge has no `unauthorized` kind:
  - J1:983 `err(401, 'sign_in_required', ...)` for no session;
  - J1:707 `refuse(403, 'julius_dispatch_founder_only')`;
  - J1:709 `refuse(403, 'julius_dispatch_second_pairing')`.
- SPEC:162-163 map those kinds.
- **Conflict:** N1 as written can never match literally.
- **Proposal (rev 1-3; Superseded by YUJI's resolutions (rev 8: now pinned as RES `af3c105f:docs/C2_J1_RESOLUTIONS_20261023.md`, blob `cf528758`; the rev 7 pin `4515c548`, blob `a9d717b6`, and the rev 6 pin `7773fc53`, blob `0a43daba` (R5-2), are HISTORICAL; see Sources. Rev 5 cited the local working copy, see the rev 5 note); kept, not deleted; Skywalker's R4-5):** N1 accepts exactly the set {`sign_in_required`, `julius_dispatch_founder_only`, `julius_dispatch_second_pairing`, `julius_dispatch_wrong_project`}, with no ledger `pre_call`.
- **Status:** CONFIRMED.

### M3: SPEC r1 error table (SPEC:157-175) is missing kinds the bridge emits; recovery is lazy
- **Missing kinds:** the following `julius_dispatch_*` string literals appear in J1 at 22a0a9cb but not in SPEC:157-175 (found by literal search, Cosmo):
  - `body_invalid`, `brief_not_frozen_contract`;
  - `clock_binding_invalid`, `clock_binding_required`, `clock_echo_unknown`, `clock_offset_out_of_range`;
  - `cursor_invalid`, `final_row_unwritten`, `key_store_required`, `mode_mismatch`, `provider_key_in_env`;
  - `repeat_above_per_run`, `repeat_already_used`, `repeat_combined_ceiling`, `repeat_receipt_missing`, `repeat_spend_unknown`;
  - `result_lost_on_restart`, `reviewer_config_mismatch`, `run_creator_mismatch`, `run_order_violation`, `run_orphaned`.
  - **Rev 3: all 21 are code-confirmed, not run-confirmed.** Each reaches an HTTP response through one of three paths, each re-read at 22a0a9cb.
  - **Path 1: `refuse()` → J1:1027.** `refuse()` (J1:420, `({ ok: false, status, code })`) and `refuseRepeat()` (J1:789-796, which calls `refuse`) return an outcome. J1:1027 turns it into `err(outcome.status, outcome.code, ...)`.
    - `brief_not_frozen_contract` (J1:733), `key_store_required` (J1:735), `mode_mismatch` (J1:727, :729), `provider_key_in_env` (J1:737), `reviewer_config_mismatch` (J1:722), `run_creator_mismatch` (J1:748, :774), `run_order_violation` (J1:770).
    - The clock kinds `clock_binding_required`, `clock_echo_unknown` and `clock_offset_out_of_range` (J1:834-836, returned at J1:844).
    - `repeat_already_used` (J1:797), `repeat_receipt_missing` / `repeat_spend_unknown` (J1:799), and `repeat_above_per_run` / `repeat_combined_ceiling` (J1:811-814).
  - **Path 2: `err()` directly** (J1:952): `body_invalid` (J1:1010), `cursor_invalid` (J1:1002), `clock_binding_invalid` (J1:1020).
  - **Path 3: direct `{ error: { kind, message } }` bodies** (rev 6, nit 1; J1:905 and :908 also add `detail: { resultSha256 }`): `run_orphaned` (J1:902), `final_row_unwritten` (J1:905), `result_lost_on_restart` (J1:908).
  - None of these has been observed in a real run.
- **Lazy recovery:** J1W:256-270. "recover() must finish before the first dispatch (OPEN_ITEMS 21). A failed recovery refuses every dispatch". `ready()` runs `inner.recover()` lazily on the first `dispatch` (J1W:258-264). If recovery fails, every dispatch returns `503 julius_dispatch_ledger_unavailable` (J1W:267).
  - SPEC:171 (rev 2 said :170; corrected and re-checked) does list `julius_dispatch_ledger_unavailable` as "Try again in a moment", which is misleading when recovery has permanently failed for that process.
- **Status:** CONFIRMED (code-confirmed, not run-confirmed).

### M4: ACCEPT needs run 2, but J1 refuses a repeat without run-1 receipts
- PROT:71/:74 require run 2 to pass C0-C12 for ACCEPT-FOR-ROW-12.
- J1:29-35 (header): "julius-inworld-data-1 also refuses a repeat unless run-1 has a verified provider dollar receipt ... The wired coder is CLAUDE_SUBSCRIPTION and does not produce a dollar receipt, so a real-shaped repeat stays refused."
- J1:782-826 "COMBINED CEILING: a repeat of julius-inworld-data-1 reads run-1's provider receipts. Fail closed." It refuses with:
  - `julius_dispatch_repeat_receipt_missing` / `_spend_unknown` (J1:798-799), when run-1 spend is unverified;
  - `julius_dispatch_repeat_already_used` (J1:797);
  - `_repeat_above_per_run` / `_repeat_combined_ceiling` (J1:810-814).
- **Conflict:** run 2 is blocked unless run-1 provider receipts reach the ledger. The protocol does not list this precondition, and a refused run 2 means no ACCEPT. (rev 6, nit 3: this line now follows the J1 citations, as in the other entries; rev 5 had it below the analysis.)
- **Rev 4 (Skywalker's finding): SPEC:293.** "Run 2: repeat 5-10 with a fresh key and a fresh run id; assert the second `key_hash` differs and a third dispatch is refused by the bridge cap (`julius_dispatch_mission_cap_reached` row)." So in SPEC it is the **third** dispatch that the cap refuses, not the second: run 2 is expected to be dispatched. The receipt refusals above are a separate gate that can refuse run 2 itself. (Rev 4 said the third dispatch is refused at J1:781; that is only one case. Rev 5 corrects it below.)
- **Rev 5 (R4-1, medium; Skywalker's finding; YUJI first gave this order): how a third dispatch is refused at 31bfc58b.** Inside the reservation lock the checks run in this order: J1:774 `run_creator_mismatch` (403), J1:776 `already_dispatched` (409), J1:777 `key_reused` (409), J1:779-780 the daily cap, J1:781 the mission cap, then the combined ceiling (J1:787-826). Both caps default to 2 (`J1_DEFAULT_DAILY_CAP` at J1:52, `J1_DEFAULT_MAX_RUNS_PER_MISSION` at J1:53, read at J1:764-765). For a third dispatch after runs 1 and 2 started, with a fresh key and a fresh run id:
  - **Same UTC day, default caps:** J1:779 counts `run_start` and `run_refused` rows on the bridge's current UTC day. The count is 2, so J1:780 refuses with **429 `julius_dispatch_cap_reached`**, and J1:781 is never reached.
  - **A later UTC day** (or a daily cap raised above the day count): J1:781 refuses with **429 `julius_dispatch_mission_cap_reached`**.
  - **Mission cap raised by env, daily cap not binding, mission `julius-inworld-data-1` only** (the combined ceiling applies only to that mission: J1:719, `julius-dispatch-repeat-ceiling.ts:54`): `priorSpendFromLedger` returns `repeat_already_used` when there is more than one prior `run_start` (repeat-ceiling.ts:214-216), so J1:797 refuses with **409 `julius_dispatch_repeat_already_used`**. This path DOES write a `run_refused` row and a log line (`refuseRepeat`, J1:789-796).
  - **Mission cap raised, any other mission:** none of these three refusals fires.
- **Neither 429 writes a ledger row.** Both are `return refuse(...)`, and `refuse` (J1:420) only builds an outcome object; J1:1027 maps it to the HTTP `{ error: { kind, message } }` body (via `err`, J1:952; rev 6, nit 1). So SPEC:293's "`julius_dispatch_mission_cap_reached` row" cannot exist at 31bfc58b, and a check that requires that row would fail a correct bridge.
- **Tests at 31bfc58b:** `julius-dispatch.test.ts:439-445` (mission cap on the third dispatch, with `JULIUS_J1_DAILY_CAP` raised to 10 to get past the daily check), :446-449 (daily cap of 1), :752-766 (two `run_refused` rows use up a daily cap of 2, and the third attempt gets `cap_reached`), :838-850 (rev 6, nit 4; `describe('J1 file ledger')`, mission `mission-j1-frozen`, which has no ceiling: run 1 is dispatched on a file ledger, the ledger is closed and reopened as a restart, the restarted controller (with `JULIUS_J1_DAILY_CAP` raised to 10, J1T:846) refuses run 1's identical input again with 409 `julius_dispatch_already_dispatched` (J1T:847), admits run 2 (J1T:848), and refuses run 3 with `julius_dispatch_mission_cap_reached` (J1T:850; it matches the code only, not the 429 status)); `julius-dispatch-repeat-ceiling.test.ts:342-401` (combined-ceiling refusals; :390-401 is the third run of julius-inworld-data-1 with both caps at 10, giving `repeat_already_used`). **Not covered:** a same-day third dispatch under the shipped default caps (2/2) after two admitted runs, for ANY mission, not only the ceiling mission (rev 6; rev 7, R6-1: Skywalker's R5-1 widens this gap; YUJI owns that test, RES §11 gap 1); a later UTC day; an assertion that a 429 cap refusal writes zero ledger rows.
- No resolution is proposed here; YUJI owns resolutions.
- **Status:** CONFIRMED.

### M5 (medium; Skywalker's finding, rev 4): ECHO:14 says `artifactJudgedSha256` is "the same value" as `artifactSha256`; in J1 code it is not
- ECHO:14: "The result JSON carries the hash of the trimmed artifact as `artifactSha256` ...; the ledger's coder result row carries the same value under the field `artifactJudgedSha256` (the checker-judged hash)". Conflict 4 (rev 1-3) assumed this.
- **Rev 5 (YUJI's RF2): ECHO's label "the checker-judged hash" is also wrong.** The checker judges `coderArtifact`, the scrubbed, cut and trimmed text (J1:607 `deps.checker.check({ runId: rec.runId, artifactText: coderArtifact })`). `artifactJudgedSha256` is the hash of the coder's full, unscrubbed final message (trimmed), which the bundle step compares with the bytes of `out/normalized.json` (J1B:40-46; J1A:386).
- **`artifactSha256` (client-visible), at 31bfc58b:**
  - J1:529-530: `const scrubbed = scrubKeys(out.text, secrets);` then, for the coder, `scrubbed.trim()`.
  - `scrubKeys` (J1:333-337) replaces every key value of 8+ chars with `[redacted]`, then cuts the text to `J1_TEXT_MAX_CHARS` (J1:55, `8_000`). So the order is: scrub, then the cut to the first 8,000 UTF-16 code units (`out.slice(0, J1_TEXT_MAX_CHARS)` at J1:337; rev 6, nit 2), then trim.
  - J1:598 stores that text as `coderArtifact`. J1:627 sets `artifactSha256: coderArtifact === null ? null : sha256(coderArtifact)`, where `sha256` is the UTF-8 hex helper at J1:328.
  - It exists only as a field inside `resultText`. The result route returns `{ data: { runId, state, mode, resultText, resultSha256 } }` (J1:913).
- **`artifactJudgedSha256` (ledger-only), at 31bfc58b:**
  - J1A:386 passes the coder session's raw `outcome.finalText` (not scrubbed, not cut) to `bundleStep` as `judgedMessage`.
  - J1B:25-42: `compareJudgedToFile` hashes `trimmedBytes(judgedMessage)` (strict UTF-8 decode, `String.trim`, re-encode; J1B:26-29, :42).
  - J1:556 writes it to the ledger coder `result` row only: `artifactJudgedSha256: role === 'coder' ? (out.bundle?.judgedSha256 ?? null) : null`. It is not in the result JSON (J1:624-628) or the result body (J1:913), so the client never receives it.
- **When they are equal:** only when no key was scrubbed, the scrubbed text is at most 8,000 UTF-16 code units before the trim (rev 5, Skywalker's R4-4: `J1_TEXT_MAX_CHARS = 8_000` at J1:55 is applied by `String.prototype.slice` at J1:337, which counts UTF-16 code units, before the trim at J1:530; the cut can fall in trailing whitespace only), and the bundle step ran. J1WT:281-292 asserts the equality (`expect(result.artifactSha256).toBe(coder!.artifactJudgedSha256)`, J1WT:291) for a fixture that meets all three conditions. Per Skywalker, that test runs on the fake path (the `makeDeps()` test harness, J1WT:282).
- **When they differ:** the coder text contained a key value (scrubbed only on the client-visible side), or was over 8,000 UTF-16 code units with non-whitespace past the cut (cut only on the client-visible side), or there was no bundle (`artifactJudgedSha256` is null, J1:556). A failed coder leg breaks at J1:596 before J1:598, so its `artifactSha256` is null.
- **Conflict:** a C5 that requires client `artifact_sha256` == ledger `artifactJudgedSha256` would fail a run whose coder text was scrubbed or cut, and the client cannot check the ledger value itself. Conflict 4 is amended in rev 4 so that it no longer assumes equality.
- **Rev 8: R4-F is DECIDED.** Founder ruling, 07:27 PT 2026-10-23 (verbatim, as quoted at RES:305): "Scrubbed or truncated artifacts may qualify ONLY when independent verification confirms the original protected artifact and exact scrub-cut-trim transformation. A displayed [redacted] marker or 8,000-code-unit text alone does not establish proof. Missing, inconsistent or spoofable evidence cannot receive qualifying PASS." RES conflict 4 (C5d, RES:278-303) encodes it: a mismatch with `artifactJudgedSha256` is a C5d FAIL unless the judge holds the coder's original message, verifies it against `artifactJudgedSha256` and the bundle's file tie, and reproduces `artifactText` exactly with J1's own scrub, cut and trim (J1:333-337, :529-530); otherwise it fails closed. A `[redacted]` marker or an 8,000-code-unit length excuses nothing by itself (RES:301, spoof fixtures RES:326-328). Skywalker: faithful (REPORT_rev7.md §2).
- **Rev 8: no scrubbed or cut run can qualify today (Skywalker's J1-4).** Nothing captures the coder's untrimmed final message yet; J1 at 31bfc58b stores only hashes. Until a founder-side capture is built and verified, every scrubbed or cut run FAILS C5d. This is consistent with the ruling (missing evidence cannot PASS).
- **Status:** CONFIRMED (code-confirmed at 31bfc58b, not run-confirmed). No resolution is proposed here; YUJI owns resolutions.

### M6 (low; Skywalker's finding, rev 4): PLANADD:7 expects a bridge instance id in `run_start`; J1 writes none
- PLANADD:7: "4. Client prints exe hash and pid at boot; the bridge writes an instance id in run_start (already requested by C3 "Binding")."
- At 31bfc58b the only `run_start` write is J1:854-863 (rev 5, YUJI's RF3: the append starts at J1:854; J1:853 is the comment above it; `deps.ledger.append({ phase: 'run_start', ... })`). Its fields are `dispatchId`, `runId`, `missionId`, `frozenSha256`, `contractSha256`, `briefSha256`, `checkerSha256`, `preregId`, `budgetCapUsd`, `legEstimateUsd`, `authorizedPlayerHash`, `mode`, `at`, the repeat-ceiling fields (J1:858), `projectHash`, `sessionHash`, `keyHash`, `clientTriggerId`, `clientLogSha256`, `runOrdinal` and the three role providers. None of them is a bridge instance id.
- `git grep -n -i "instanceId\|instance_id\|bridgeInstance" 31bfc58b -- relay-bridge` finds nothing.
- **Status:** CONFIRMED (code-confirmed at 31bfc58b), low severity. No resolution is proposed here.

### Low: N5 idempotency semantics (Skywalker)
- PROT:64 N5 "reuse same key, different mission | 409-style refusal; same key + same mission returns stored result without a new pre_call".
- J1 keys idempotency on runId + creator:
  - J1:744-745: same runId with the same caller and key → replay (200, `replayed: true`);
  - J1:748: same runId with another caller or key → 403 `julius_dispatch_run_creator_mismatch`;
  - J1:750-751: the same key on ANY other run → 409 `julius_dispatch_key_reused`.
- With one frozen mission, "same key + same mission" but a new runId is refused 409, not replayed.
- **Status:** CONFIRMED, low severity.

### Low: stale bridge tip
- The rev 1 tip `126b3713` is stale. Origin is now `1254b0d1`. Per Skywalker it builds linearly on 22a0a9cb: 4 ahead, 0 behind, touching only the reviewer prompt and evidence (see Sources). CLOSED. **Rev 4:** origin is now `71d9f6f8`, and the bridge target is `31bfc58b` (see Sources).

## Also noticed (not one of the 7; not counted)
- PROT:60 N1 expects `kind=unauthorized`, but ECHO:16 says `refused (code only)`. This is the same field-name question as in conflict 6.

## Client run-id under option (a) (rev 1-7: pending founder decision; rev 8: DECIDED, option (a))
Option (a) vs (b) is pending the founder's ruling. **Rev 2:** the run-id FORMAT is now fixed in `docs/j1_client_plan.md` §5a: `wlj_` prefix plus a BCryptGenRandom UUIDv4 formatted from the raw bytes, strict regex, with a 10,000-id test. That section supersedes the format text below where they differ. This section states what the client must do IF option (a) is chosen.

**Rev 8: run-id (c) is DECIDED.** Founder ruling, 07:27 PT 2026-10-23 (verbatim, as quoted at RES:152): "Use CLIENT-MINTED cryptographically random UUIDv4 run IDs for the current J1 implementation. Generate a fresh run ID and idempotency key after a refusal. Preserve the reviewed client/bridge requirements." So option (a) applies: the client mints a cryptographically random UUIDv4 (CSPRNG only, no fallback; RES:157-164), and after any refusal it mints a fresh run id AND a fresh idempotency key before the next dispatch (RES:165-172, [F4]). The judge accepts only `source=minted` (RES:149). The ruling names UUIDv4, so the canonical 122-random-bit reading of the note below applies. Skywalker re-ran YUJI's 10,000-id test: 0 failures against J1:962/:964 and against #396's `IsStrictRunId`/`IsBridgeRunId` (REPORT_rev7.md §2). The text below is kept as written; "IF option (a) is chosen" is now the rule.

**The client mints the runId:**
- One per run. It is unguessable (Skywalker).
- Format: `[<fixed prefix>]<random part>`.
  - The prefix is OPTIONAL. It is a constant literal fixed in the build (e.g. `wlj_`), the same for every run and every player.
  - The random part is a UUIDv4 from the OS CSPRNG, OR at least 128 bits from the OS CSPRNG, hex-encoded.
- Note: a canonical UUIDv4 carries 122 random bits. If the rule is read strictly as ">= 128 random bits", use 16 CSPRNG bytes as 32 hex characters. The founder/Skywalker should say which reading applies. Neither reading weakens unguessability below 122 bits.
- **No participant id, player hash, key hash, mission id, timestamp, counter, machine name or any other derived data** may appear in the runId.

**Validation:**
- The runId must match `^[A-Za-z0-9:_-]{1,128}$` before use.
- On failure the client refuses locally: nothing is sent, and one `refused` line is logged.
- The same regex is already enforced bridge-side at J1:962 (`const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/;`), with 400 `julius_dispatch_run_invalid` at J1:996 and J1:1012.

**Logged before dispatch:**
- The minted runId is written to the client log (WLJMISSION line, after `ui_action`, flushed) BEFORE the dispatch POST is built.
- The `trigger` line carries it, and the ledger `run_created.runId` (J1:849) must equal it.
- The exact line name for "run id minted" (vs ECHO's `run_id_received`) is not fixed by any source: OPEN.

**Acceptance record:** must state verbatim: **"run lookup is a frozen stub; run existence is not evidence of mission creation"**.
- Context: J1:846-847 says there is no separate creator route in that branch.
- A runId that the bridge "knows" proves only that a dispatch was accepted with that id.

## Missing or unverifiable citations
- The protocol is not at the user-stated folder (see Sources). It was cited from the actual path.
- PROT:5 refers to "section 6 of REPORT_C2" for the format spec. It was not read and is not cited.
- "j1 OPEN_ITEMS 8" (PLANADD:12), "j1 DESIGN 5.5" and `wt_j1` are referenced by the sources but were not opened. They are cited only through the quoting source.
- Bridge tip actually to be run: **rev 4: confirmed** as `31bfc58b89de137670e5dbaf752c3328b31163f7` (tree `46744fc1`), per YUJI. Skywalker confirmed the cited J1 files are byte-identical at `31bfc58b` and `22a0a9cb` (`julius-dispatch.ts` blob `018fb582`). `1254b0d1` and `71d9f6f8` only add evidence files. (Rev 1-3 said "unconfirmed": ECHO:1 cites 2f8c346a, the J1 citations were at 22a0a9cb, and the origin tip was 1254b0d1.)
- Rev 3: CLOSED. Per Skywalker, 1254b0d1 builds on 22a0a9cb (4 ahead, 0 behind, linear; touches only reviewer prompt + evidence). This was not re-verified locally because the object is absent. M3 per-kind reachability is now code-confirmed (not run-confirmed). **Rev 4:** now re-verified locally: `1254b0d1` and `71d9f6f8` are present on Kaisin, and their parent chain is checked in Sources.

## Rev 6 line shifts (rev 5 672d1358, 287 lines → rev 6)
Rev 5 line → rev 6 line, for anyone citing this doc (e.g. RES §10a). Two lines were added after rev 5 line 9 (blank + rev 6 note) and one Sources row after rev 5 line 34 (RES); M4 was reordered (nit 3). Lines not listed keep their numbers (rev 5 :1-9). Section headers: Sources :21 → :23; M4 :200 → :203; M5 :219 → :222; Missing or unverifiable citations :282 → :285.
- :10-34 → :12-36; :35-206 → :38-209; :216 → :210; :207-215 → :211-219; :217-287 → :220-290.

## Rev 7 line shifts (rev 6 8b5d5233, 294 lines → rev 7, 301 lines)
Rev 6 line → rev 7 line. Two lines were added after rev 6 line 11 (blank + rev 7 note) and one Sources row after rev 6 line 37 (RES-r4, the historical rev 6 pin). Lines not listed keep their numbers (rev 6 :1-11). Section headers: Sources :23 → :25; M4 :203 → :206; M5 :222 → :225; Missing or unverifiable citations :285 → :288; Rev 6 line shifts :292 → :295. Changed in place (rev 7 numbers): RES :39; Proposal blocks :59, :76, :90, :109, :124, :144, :161, :184; R6-1 :221.
- :12-37 → :14-39; :38-294 → :41-297.

## Rev 8 line shifts (rev 7 8b0e71d2, 301 lines → rev 8, 312 lines)
Rev 7 line → rev 8 line. Two lines were added after rev 7 line 13 (blank + rev 8 note), one Sources row after rev 7 line 39 (RES-r6, the historical rev 7 pin), two M5 bullets after rev 7 line 239 (R4-F DECIDED; J1-4), and two lines after rev 7 line 264 (blank + run-id (c) DECIDED). Lines not listed keep their numbers (rev 7 :1-13). Section headers: Sources :25 → :27; M4 :206 → :209; M5 :225 → :228; Client run-id :263 → :268 (header changed in place); Missing or unverifiable citations :288 → :295; Rev 6 line shifts :295 → :302; Rev 7 line shifts :299 → :306. Changed in place (rev 8 numbers): RES :41; RES-r4 :43; Proposal blocks :62, :79, :93, :112, :127, :147, :164, :187; run-id header :268. New lines: :14-15, :42, :243-244, :270-271, :309-312.
- :14-39 → :16-41; :40-239 → :43-242; :240-264 → :245-269; :265-301 → :272-308.
