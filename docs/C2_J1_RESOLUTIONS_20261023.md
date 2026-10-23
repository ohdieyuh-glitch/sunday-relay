# C2 / J1 conflicts: proposed resolutions (YUJI, C2 owner, 2026-10-23, DRAFT rev 7 for Skywalker's verification)

Rev 7 (file prepared 07:36 PT; the commit time is set when it is pushed) folds in the founder's rulings of 07:27 PT 2026-10-23 on R4-F and (c), and Skywalker's nits on rev 6 (4515c548, blob a9d717b6, PASS WITH FINDING), tagged [FR-R4F], [FR-c], [I1], [I2]. It also adds Appendix F for Cosmo's conflicts rev 7:
- [FR-R4F] R4-F is DECIDED (the ruling is quoted verbatim in resolution 4). C5d is DISCLOSED-PASS only when the judge holds the original, verified against `artifactJudgedSha256` and the bundle's file tie, and reproduces `artifactText` exactly with J1's own scrub, cut and trim. Every other mismatch FAILS. The former optional hardening is now MANDATORY, and "unverified DISCLOSED" is removed. A `[redacted]` marker or an 8,000-code-unit length no longer excuses anything by itself. The judge fixtures add the spoof cases.
- [FR-c] Question (c) is DECIDED (the ruling is quoted verbatim in conflict 2): run ids are client-minted, cryptographically random UUIDv4s, with a fresh run id and idempotency key after any refusal. **Compatibility checked, no blocker:** a UUIDv4, with or without Cosmo's `wlj_` prefix, passes J1's `RUN_ID` rule (J1:962, applied at :996 and :1012) and PR #396's `IsStrictRunId`/`IsBridgeRunId` at b86efac5. The CSPRNG requirement is added as a client requirement for Cosmo's wrapper.
- [I1] The rebuild starts from the untrimmed `out.text` (J1:529; rev 6 said :530, which is the trim). The original's binding and the file tie compare trimmed bytes on both sides, exactly as J1 does (BUNDLE:42-45), and the cut is taken before the trim. Leading whitespace therefore cannot shift the cut. A cut can only be verified from the untrimmed message.
- [I2] Rev 6 was committed at 04:44:53 PT.
- [AS] Founder ruling on author spoofing: git author name and email are not identity evidence. This doc never relies on them (§0 note).
- [F] Appendix F maps conflicts rev 6 (8b5d5233) to rev 7 (8b0e71d2). CONF citations stay pinned to rev 5 (672d1358), as before.
- Rev 6 (4515c548, sha256 af9abf79…) is kept as `….md.af9abf79.bak`. Cosmo's conflicts rev 7 pins RES to rev 6 (4515c548). A new pin to this revision is his call.

Rev 6 (committed 04:44:53 PT [I2]) fixes Skywalker's findings on rev 5 (15d17c17, PASS WITH FINDING), tagged [H1]-[H3], and adds Appendix E for Cosmo's conflicts rev 6:
- [H1] `outputSha256` equals `artifactSha256` only when `artifactSha256` is non-null; a failed coder leg that still produced text records `outputSha256` while `artifactSha256` is null (J1:553, :596-598, :627). C5c already fails on a null, so no check changes.
- [H2] Commit times corrected: rev 4 was committed 04:33 PT and rev 5 04:39:44 PT.
- [H3] The G3 rebuild starts from the coder's untrimmed final message. (Rev 7 [I1] corrects the cite to J1:529 and fixes the comparison.)
- [E] CONF citations in this doc stay pinned to conflicts rev 5 (672d1358). Appendix E maps them to rev 6 (8b5d5233).

Rev 5 (committed 04:39:44 PT [H2]) fixes Skywalker's findings on rev 4 (7773fc53, blob 0a43daba, PASS WITH FINDING), tagged [G1], [D7], [G3]:
- [G1] Status line corrected (this file is published on `docs/julius-c2-j1-resolutions-20261023`); the 04:3x placeholder is replaced; `/workspace/...` paths are marked as YUJI's working copies, not fetchable from GitHub.
- [D7] `artifactJudgedSha256` is described correctly: the hash of the coder's final message, which the bundle step ties to the artifact file (J1B:40-46).
- [G3] The optional D3 hardening reconstructs scrub-then-cut in J1's order (J1:336-337); R4-4's wording now says "no-cut condition". (Rev 7 [FR-R4F]: this reconstruction is now mandatory.)

Rev 4 (committed 04:33 PT [H2]) folds in Skywalker's findings on rev 3 (a008a018…) and re-maps to Cosmo's rev 5. Each change is tagged [D#] or [R5-#] in place:
- [D1] Every CONF citation is re-mapped from rev 4 of the conflicts doc (9b50b4d4) to Cosmo's rev 5 (672d1358, blob e99fde0f, sha256 6f24f1ff…44aa, 287 lines). The line shifts are in Appendix D (also `/workspace/julius/c2/CONF_rev4_to_rev5_remap.md`). Rev 5 was verified byte-exact (git blob recomputed; `sha256sum -c` 7/7 OK; the commit touches only the doc and SHA256SUMS.txt).
- [D2] C5d FAILS whenever `artifactJudgedSha256` is null, even with scrub or cut evidence.
- [D3] R4-F notes that the disclose trigger is spoofable, and j1_judge.py must count UTF-16 code units.
- [D4] The frozen-stub quote cite is corrected (rev 3 of this doc said CONF:269; it was rev 4 CONF:267 and :166, now rev 5 CONF:278 and :168).
- [D5] Skywalker's R4-3 and R4-4 are carried into §10, with the rev 5 verification (§10a).
- [D6] §11 gaps 1 and 2 state their preconditions. [R5-1] Gap 1 is widened to every mission.
- Record correction: the diff 53c18988 → a008a018 (`C2_RES_53c18988_to_a008a018.diff`, unified, 3 lines of context) has **18** hunks, as Skywalker counted (plain `diff` gives 48 change blocks). Any earlier statement of 20 was wrong.

Rev 3 (a008a018…) is kept as `….md.a008a018.bak`.

Rev 3 (04:20 PT) made three changes:
- It re-maps every CONF citation from rev 3 of the conflicts doc (8f312b32) to Cosmo's rev 4 (9b50b4d4). The line shifts are in Appendix C.
- It maps resolutions 9, 10 and item 8 onto rev 4's M6, M4 and M5. It records findings on rev 4 (§10) and J1 test coverage (§11).
- It folds in all of Skywalker's findings on rev 2 (/workspace/c2-resolutions-review/REPORT.md, PASS WITH FINDING): F1-F9 and the nits, plus the 04:16 and 04:19 steering (the exact C5d wording; scoping `repeat_already_used`; the superseded proposals). Each fix is tagged [F#] in place.

Rev 2 (53c18988…) is kept as `….md.53c18988.bak`.

Rev 2 (04:08 PT) added resolutions 9 and 10 for Skywalker's missed items and cross-references item 8 to resolution 4. It also fixes the hash-order and result-body wording in Appendix A. Rev 1 (sha256 e824196f…) is kept as `C2_J1_RESOLUTIONS_PROPOSED_20261023.md.e824196f.bak`.

Status: PROPOSAL ONLY. This file is published on branch `docs/julius-c2-j1-resolutions-20261023` (off main 689d2be9) for review; nothing else is pushed or edited, and it never lands on main by itself [G1]. Paths under `/workspace/...` are YUJI's working copies and are not fetchable from GitHub; pin this doc by its GitHub commit and blob [G1]. This awards nothing and makes no readiness claim (J1 stays BLOCKED at 94.520%; Wonderland stays 56.25%). No security refusal is weakened, and every rule below fails closed. Items marked NEEDS-FOUNDER-RULING are flagged for the founder, not decided here. Items marked DECIDED carry the founder's ruling verbatim (R4-F and (c), 07:27 PT 2026-10-23) [FR-R4F][FR-c].

Categories: SPEC-ONLY (amend C2 protocol / SPEC r1 / ECHO addendum text), CLIENT-ONLY (Cosmo's client), J1-CODE-CHANGE (needs a new J1 head and a new review), NEEDS-FOUNDER-RULING, DECIDED (founder ruling recorded).

**Headline: none of the 7 resolutions needs a J1 code change. The PASSed J1 code at 31bfc58b stays unchanged.** One side finding (R7-F, rehearsal bridge) may need new J1 code or a founder ruling. It is flagged, not decided.

## 0. Sources and verification

**Conflicts-doc revision cited: rev 4 at `9b50b4d444022e205f31645528d57b268d94c858`.**
- Commit 9b50b4d4 is "docs(c2-j1): rev 4 of the C2/J1 conflicts doc (Skywalker's findings)". It was committed 2026-10-23T11:09:08Z, which is 04:09 PT. Its parent is 8f312b32.
- The doc blob is `28217ba26f534ea663af1a97933acfa1d3038ef8`, 276 lines. I recomputed the git blob id over the fetched bytes, and the sha256 is `7959af5d454aaa24eb7de1ef2cf61da5a2c978db53f19d8769a96dc648d06656`. Both match what Cosmo stated.
- The commit touches only `docs/C2_J1_CONFLICTS_20261023.md` (+46/−11). Every other cited docs-branch file is therefore byte-identical at 8f312b32 and 9b50b4d4: PROT, SPEC, ECHO, PLANADD and SHA256SUMS.txt.
- [D1] All CONF:line references below are to **rev 5 (672d1358)** unless marked otherwise. Rev 3 → rev 4 shifts are in Appendix C, rev 4 → rev 5 in Appendix D. The 9b50b4d4 facts above are kept as the record of rev 3 of this doc.
- PROT, SPEC, ECHO, PLANADD and J1 line numbers are unchanged.

Read read-only through the GitHub API. Each blob was re-hashed locally: the git blob id was recomputed from the fetched bytes and matched the tree entry, so the bytes are exact. sha256 was then taken over those bytes.

| Tag | Path @ ref | git blob | sha256 (computed) | Matches Cosmo's table? |
|---|---|---|---|---|
| CONF (rev 5) [D1] | docs/C2_J1_CONFLICTS_20261023.md @ 672d1358 (287 lines; parent 9b50b4d4) | e99fde0f | 6f24f1ff7a85cf6900d121f64e55b2fb571669e9d1dc86eae3a696d982ac44aa | YES; = SHA256SUMS.txt at 672d1358 (blob 775acda8; `sha256sum -c` 7/7 OK) |
| CONF (rev 4, superseded) | same path @ 9b50b4d4 (276 lines) | 28217ba2 | 7959af5d454aaa24…6656 | Matched Cosmo's message. SHA256SUMS.txt at 9b50b4d4 listed rev 3's 0eac5c77 (stale; fixed in rev 5, §10 RF4). |
| CONF (rev 3, superseded) | same path @ 8f312b32 (241 lines) | f7af3ee9 | 0eac5c77e561e21e… | = SHA256SUMS.txt |
| PROT (C2) | docs/sources/_independent_review_judev2_20261021/C2/INWORLD_ACCEPTANCE_PROTOCOL.md @ 9b50b4d4 (= 8f312b32) (74 lines) | 7891ccfd | 58ba107e0fa1dc4858c075f396c9ae4cef686646bb27005ffcfb026b8d0aa2db | YES |
| SPEC | …/j1/CLIENT_PACKAGE_SPEC_r1.md @ 9b50b4d4 (= 8f312b32) (380 lines) | 13931c7c | 43958afa8960e8a3… | YES |
| ECHO | …/j1/CLIENT_PACKAGE_SPEC_r1_ADDENDUM_1_ECHO_DIGEST.md @ 9b50b4d4 (= 8f312b32) (20 lines) | 02099f63 | f03e7f91e7a72a0e… | YES |
| PLANADD | …/ADDENDUM_1_to_PLAN_r3_and_SPEC_r1.md @ 9b50b4d4 (= 8f312b32) (17 lines) | 2ad2b819 | ce1aff4769174b10… | YES |
| J1 | relay-bridge/julius-dispatch.ts @ 31bfc58b (1050 lines) | 018fb582 | 0a29be76e58fae6a… | YES (same blob at 22a0a9cb) |
| J1A | relay-bridge/julius-dispatch-adapters.ts @ 31bfc58b (617 lines) | 579f513a | 5faabc3ba576a337… | Cosmo gave no sha; same blob at 22a0a9cb |
| J1W | relay-bridge/julius-dispatch-wiring-core.ts @ 31bfc58b (282 lines) | 6c1fe492 | 7e8862bad3a1b441… | Cosmo gave no sha; same blob at 22a0a9cb |
| BUNDLE | relay-bridge/julius-dispatch-bundle.ts @ 31bfc58b | 3770e76b | 800c9820efabb91f… | not cited by Cosmo |
| WTEST | relay-bridge/julius-dispatch-wiring.test.ts @ 31bfc58b | a5e2861a | d314f2f767f084c6… | same blob at 22a0a9cb |
| SERVER | relay-bridge/server.ts @ 31bfc58b | 34f2f92e | 0f069525… (Skywalker) | not cited by Cosmo |
| MROUTES | relay-bridge/julius-mission-routes.ts @ 31bfc58b | 315fbb88 | blob verified | for F3 |
| J1T | relay-bridge/julius-dispatch.test.ts @ 31bfc58b | 91a8ff80 | e2d65775… | = rev 5 CONF:34 [D1] |
| CEILT | relay-bridge/julius-dispatch-repeat-ceiling.test.ts @ 31bfc58b | 6cbd68de | eb2d6066… | for §11 |

Notes:
- All nine `relay-bridge/julius-dispatch*.ts` sources (and the wiring test) have identical blobs at 22a0a9cb and 31bfc58b. **Every J1 line Cosmo cites at 22a0a9cb is therefore the same line at 31bfc58b.** I re-read each cited line at 31bfc58b. See section 9 for the few that are imprecise.
- `2f8c346a`, the tip ECHO:1 says it read, has DIFFERENT blobs: julius-dispatch.ts is 299e5336, and the repeat-ceiling file is absent. ECHO's bridge contract is therefore stale in places, and 31bfc58b is the target (as already told to Cosmo).
- The C2 protocol is NOT on the J1 branch `judev/j1-combined-ceiling`; no crosscheck.py or protocol file exists in that tree. The C2 source used here is the byte copy on the docs branch (blob 7891ccfd, the same at 8f312b32 and 9b50b4d4). Rev 5 CONF:17 [D1] notes that Skywalker has never certified its content.
- `crosscheck.py` and `test_crosscheck.py` (PROT:2) were not available to me. Any statement about what crosscheck does today comes from PROT text only.
- [FR-R4F][FR-c] Rev 7 re-verification (read-only GitHub contents API; local re-hash): J1 `018fb582`, J1A `579f513a` and BUNDLE `3770e76b` at 31bfc58b. PR #396 head b86efac5 has `wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp` `61b0e1a1` and `.h` `4030c22d` (LOGIC / LOGICH below), and `wonderland/Tools/j1_logic_kat.cpp` (KAT). No Julius wrapper or run-id generator exists in `wonderland/Source/Wonderland` at b86efac5 yet.
- [AS] Identity: every source in this doc is pinned by commit SHA and git blob id (content addresses) and re-hashed locally. No conclusion rests on a git author name or email. Per the founder's ruling, those are not identity evidence, so no change is needed here. Identity for landing (authenticated GitHub/App identity, provenance, signed clearance) is outside this doc.

Precedence used: for client behaviour, ECHO > PLANADD > SPEC (ECHO:1, PLANADD:1). For acceptance, PROT governs until amended, and these proposals ARE the amendments.

---

## Conflict 1: log prefix `WLMISSION` (PROT) vs `WLJMISSION` (ECHO/PLANADD)

**Evidence**
- PROT:6-10: all four client formats use `WLMISSION`. PROT:60 N1 expects `WLMISSION refused kind=unauthorized`.
- ECHO:8, ECHO:15 use `WLJMISSION`. PLANADD:4 (U2) wants an EXACT LINE-ANCHORED match (the start of the message after the UE log category).
- SPEC:234, :239-246 still use `WLMISSION`. SPEC:364 U2 records that `WLMISSION` collides with existing client lines.
- J1 code doesn't emit client lines. The only mention is a doc comment at J1:287 ("The client's `WLMISSION chain phase=` value"). It is comment-only and needs no change.

**Proposed resolution (SPEC-ONLY)**
- PROT §0 and §5: replace every `WLMISSION` with `WLJMISSION`.
- Matching rule: the message part of a UE log line (after `[timestamp][frame]Category: `) must start with `WLJMISSION ` followed by a known line type. No substring matching.
- A `WLMISSION` line is never counted toward any check. Because C1 needs exactly one `WLJMISSION trigger`, a client that still emits the old prefix FAILS C1. That is fail-closed.
- SPEC r1 §4.2 is superseded by ECHO §4 for the prefix. Record that in the protocol's precedence note.

**Impact**
- Client PR: emit `WLJMISSION` only, and never `WLMISSION`, `WLBRAIN` or `JULIUS STREAM:` for mission lines.
- j1_judge.py: use an anchored regex `^(?:\[[^\]]*\]){0,2}\s*\w+:\s+WLJMISSION (ui_action|offset|run_id|trigger|chain|result|refused|build|verify) ` against the message. `WLMISSION` lines are ignored.

**Test**
- Judge fixtures:
  - a log with only `WLMISSION trigger …` → C1 FAIL;
  - `WLJMISSION trigger` mid-line (e.g. inside another message) → not matched → FAIL;
  - a correct line → matched.
- Client unit test: no format string contains `WLMISSION ` without the J.

---

## Conflict 2: one `trigger` line (PROT) vs `ui_action` / `run_id_received` / `trigger` (ECHO)

**Evidence**
- PROT:7: one trigger line. PROT:24: "The ledger `pre_call` must be later than the client `trigger` line". PROT:33 C1: "exactly one in-game trigger; its utc < first ledger pre_call".
- ECHO:8: line A `ui_action` (no run id). ECHO:10: line B "run id received". ECHO:11: the trigger line is the one whose sha256 is `clientLogSha256`. ECHO:16 lists the line set. PLANADD:6 sets the order UI-action < run-created < pre_call < result. PLANADD:10 asks C1 to name its line.
- J1 (31bfc58b):
  - J1:248-274 `verifyRunOrdering`: `ui < run_created.at` strictly, then every row of the run after `run_created` in ledger order and non-decreasing `at`. A result before any pre_call is a violation.
  - J1:768-770: `clientUiActionUtc` must match `UTC_ISO` and be strictly earlier than the bridge clock `at`, else 409 `julius_dispatch_run_order_violation`. **This is a raw client-clock vs bridge-clock comparison, with no offset correction.**
  - J1:1014-1016: `clientTriggerId`, `clientLogSha256` (64 hex) and `clientUiActionUtc` are required, else 400 `julius_dispatch_client_log_binding_required`.
  - J1:848-851: `run_created` stores `uiActionUtc`, `clientTriggerId`, `clientLogSha256`, `clientOffsetMs` and `echoId`.
  - J1:855-860: `run_start` repeats `clientTriggerId` and `clientLogSha256`.
- ECHO:10 says the run id is "received" from "mission creation exactly as in spec r1". But at 31bfc58b no route creates a run that J1 dispatch recognises [F3]:
  - The only run-creating route is the operator-only `POST /relay-api/julius/missions` (server.ts:1058-1075; julius-mission-routes.ts:62-64, :152-200). It refuses without the operator bearer (401 `operator_required`, :154). It lands a READY run in the PostgreSQL Julius store and returns `runId` with `dispatched:false` (:190, :198).
  - J1 never reads that store. Its run lookup is the frozen stub `createFrozenRunLookup` (J1A:567-582, wired at J1W:242: "J1 creates its own run"), which answers READY for any runId in the configured project.
  - The game can't call the operator route. The operator bearer is a shell credential, and J1 refuses it on its own routes (J1:977-979).
- So no server issues the run id J1 dispatches. Its source was the founder option (a)/(b) (CONF:257-280) [D1]. **Decided: (a), client-minted UUIDv4 [FR-c].**

**Proposed resolution (SPEC-ONLY + CLIENT-ONLY; the run-id sub-item is DECIDED [FR-c])**
- **C1 (amended):** exactly one `WLJMISSION trigger` line for the run (matched by `run=`). All of these must hold:
  1. Its `utc` < the first ledger `pre_call.at` for the run (as now).
  2. sha256(UTF-8 of the exact trigger message, without the UE prefix) == ledger `run_created.clientLogSha256` == `run_start.clientLogSha256`.
     - **[F5] This amends ECHO:5 and ECHO:11.** Those lines, and J1:38-39, say "the exact client log line".
     - The hash input is defined as the message only: what follows `[timestamp][frame]Category: `, starting at `WLJMISSION`, with no trailing newline. The UE prefix depends on the timestamp and frame, so the client can't hash it reliably before writing it.
     - ECHO §2 item 4 gets this wording.
  3. Its `run=` == `run_created.runId`.
- **C1b (new):** exactly one `WLJMISSION ui_action` line, written before the trigger in log order. All of these must hold:
  1. Its `utc` == ledger `run_created.uiActionUtc`, byte-for-byte as a string.
  2. Its `utc` < `run_created.at`, compared raw as J1:770 does, with no offset adjustment, so the judge and the bridge agree.
  3. Log order is `ui_action` < `offset` < `run_id` < `trigger`.
  4. `verifyRunOrdering` semantics hold on the ledger: `run_created` is the first row of the run, and `at` is non-decreasing.
- Any extra, missing or reordered line is a FAIL. Nothing in C1 is relaxed.
- **Line B name:** use a neutral `WLJMISSION run_id run=<id> source=<minted|server> utc=…` instead of `run_id_received`. **R2-F / (c): DECIDED [FR-c]:** option (a), client-minted. The judge accepts only `source=minted`. The rev 3 provisional default [F6] is now the rule.
  - At 31bfc58b no server issues a run id that J1 dispatch recognises (see the evidence above).
  - The operator-only `POST /relay-api/julius/missions` creates READY runs that J1 doesn't read. Server-issued ids are not adopted [FR-c], so that route stays out of the J1 path, and no J1 code change is needed.
- **[FR-c] Founder ruling (c), DECIDED 07:27 PT 2026-10-23 (verbatim):** "Use CLIENT-MINTED cryptographically random UUIDv4 run IDs for the current J1 implementation. Generate a fresh run ID and idempotency key after a refusal. Preserve the reviewed client/bridge requirements." This answers the rev 3 question [F3] ((a) or (b)) with (a).
  - **Format compatibility (checked; NO blocker):**
    - J1 at 31bfc58b: `const RUN_ID = /^[A-Za-z0-9:_-]{1,128}$/` (J1:962) is the only run-id format rule. It is applied to the events/result query `runId` (J1:996) and to the dispatch body `runId` (J1:1012), and a failure is 400 `julius_dispatch_run_invalid`. A canonical UUIDv4 is 36 characters from `[0-9a-f-]`, and Cosmo's `wlj_` form is 40 characters. Both pass. No other length or format check touches `runId`: the frozen run lookup ignores it (J1A:577-580), and the controller only compares it for equality (J1:773-776).
    - The idempotency key rule `KEY = /^[A-Za-z0-9_-]{8,80}$/` (J1:964, applied at :1007) also passes for a 36-character UUIDv4 or a 40-character `wlj_` UUIDv4.
    - PR #396 at b86efac5: `FormatRunIdFromBytes` (LOGIC:265-279) forces the version nibble to 4 (:269) and the variant to `10xx` (:270), then writes `wlj_` (LOGICH:160) plus lowercase 8-4-4-4-12 hex, straight from the bytes in order. `IsStrictRunId` (LOGIC:281-310; regex in LOGICH:168 `^(wlj_)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`) requires `-` at indices 8, 13, 18 and 23, `4` at index 14 (:296-299), `[89ab]` at index 19 (:300-303), and lowercase hex elsewhere. `IsBridgeRunId` (LOGIC:312-322) mirrors J1:962 (1-128 characters, :314). The KAT rows (KAT:126-152) show every formatted id passing both checks. An uppercase UUIDv4 passes the bridge check but fails strict (KAT:144), so the client must emit lowercase, which `FormatRunIdFromBytes` does.
  - **CSPRNG requirement (CLIENT-ONLY; a requirement on Cosmo's Unreal wrapper).** LOGIC deliberately generates nothing (LOGICH:25, :164), so the wrapper supplies the 16 bytes:
    - The bytes must come from a cryptographically secure generator: `IPlatformCrypto::Get().CreateContext()->CreateRandomBytes(TArrayView<uint8>)` (PlatformCrypto plugin; the result must be `EPlatformCryptoResult::Success`), or OpenSSL `RAND_bytes` through the engine's OpenSSL module (the return value must be 1). If generation fails, the client refuses locally and does not dispatch. There is no fallback.
    - NOT acceptable: `FGuid::NewGuid()` / `FPlatformMisc::CreateGuid`. The engine API promises uniqueness, not a version-4 layout or a cryptographic source on every platform: Windows forwards to `CoCreateGuid`, other platforms use their own implementations, and FGuid's digit layout differs from RFC 4122 order (LOGICH:164). `FMath::Rand`, `FRandomStream`, time, counters and hashes of these are not acceptable either.
    - The idempotency key is minted the same way: an independent value from fresh CSPRNG bytes (for example a second UUIDv4), and it must satisfy J1:964.
    - After any refusal (any non-2xx dispatch answer or a `run_refused` row), the client mints a NEW run id AND a NEW idempotency key before the next dispatch ([F4], below). It never reuses either.
    - LOGICH:25 still says the run-id option "is still the founder's decision". That comment is stale after [FR-c], and Cosmo can update it in the wrapper PR (no logic change).
    - Cosmo's PR test: a unit test proving the wrapper calls the CSPRNG and refuses on failure, plus a code-review check that no `FGuid`/`FMath::Rand` path feeds `FormatRunIdFromBytes`.
  - **Judge:** the credited run id must match LOGICH:168 (strict lowercase v4, optional `wlj_`), and its `run_id` line must say `source=minted`. A non-v4 or uppercase id, or a `source=server` line, is a C1 FAIL. The judge can check the format only. Randomness is a client-code requirement checked in review.
- **[F4] Fresh run id after any refusal (CLIENT-ONLY + SPEC-ONLY; now also the founder's ruling [FR-c]):** after any refusal for a run id, the client must mint a new run id (and a new idempotency key) before the next dispatch. That covers a `run_refused` row (J1:791, :840) and any non-2xx dispatch answer.
  - Why: J1:773-776 checks only `run_created` and `run_start`. A run id whose earlier attempt left only a `run_refused` row is ADMITTED again.
  - The providers are then called. Only after the chain does `verifyRunOrdering` find `row_before_run_created` (J1:267), because the `run_refused` row precedes the new `run_created`. The run is then HALTED with `run_order_violation` (J1:621-622).
  - That spends money on a run that can't be credited.
  - The judge FAILS any credited run id that also has a `run_refused` row (resolution 3 already does this).
  - J1 is not changed. This was advisory and is now required by the founder's ruling [FR-c].
- Note for the record: the trigger line is forgeable corroboration (ECHO:15, PLANADD:5). The binding to the ledger hash is what C1 checks.

**Impact**
- Client PR:
  - Write `ui_action` at the click, before the echo. Then write `offset`, `run_id` and `trigger`, flush, hash the exact trigger message, and POST.
  - Send `clientUiActionUtc` equal to the ui_action line's `utc` string exactly.
  - Format UTC as `YYYY-MM-DDTHH:MM:SS.mmmZ`, which matches J1:327 `UTC_ISO`.
  - Mint the run id and the idempotency key from CSPRNG bytes as above [FR-c], and mint both again after any refusal.
  - Note: if the client clock is ahead of the bridge by up to the allowed 1000 ms (J1:396) and the UI action → dispatch gap is shorter, the bridge refuses 409 `run_order_violation` (fail-closed). The client must show it as a refusal and not retry.
- j1_judge.py: implement C1 and C1b exactly as above, and parse the UTC strings with millisecond precision.

**Test**
- Fixtures:
  - two trigger lines → FAIL;
  - ui_action utc ≥ run_created.at → FAIL;
  - ui_action utc ≠ run_created.uiActionUtc → FAIL;
  - trigger message hash ≠ clientLogSha256 → FAIL;
  - ui_action after trigger in the log → FAIL;
  - `run_id` line with `source=server` → FAIL [FR-c];
  - run id `wlj_0b7a1c2e-4f3d-9a6b-1c2d-3e4f5a6b7c8d` (not v4) or an uppercase v4 → FAIL [FR-c];
  - a valid set → PASS.
- Rehearsal: a client clock pushed +900 ms with an immediate dispatch must produce 409 `julius_dispatch_run_order_violation` and a `refused` line.

---

## Conflict 3: J1's `run_created` ledger row is not named in PROT

**Evidence**
- PROT:11 lists `run_start`, `pre_call`, `result` and the final `result`. It has no `run_created`.
- J1:846-852 writes `run_created` {runId, dispatchId, creatorPlayerHash, creatorKeyHash, uiActionUtc, clientTriggerId, clientLogSha256, at, clientOffsetMs, echoId}. Then J1:853-863 writes `run_start` with the SAME `at` value (both `new Date(at)`).
- `creatorPlayerHash` and `authorizedPlayerHash` are both `callerHash = sha16(callerPlayerId)` (J1:739, :849, :857), and `creatorKeyHash` == `run_start.keyHash` (J1:740, :849, :859).
- J1:774: an existing `run_created` from another creator → 403 `run_creator_mismatch`. J1:776: an existing one → 409 `already_dispatched`.
- Other row phases PROT doesn't name, which the judge must recognize:
  - `run_refused` (J1:790-792, :839-841; it counts toward the daily cap, J1:779);
  - `budget_refused` (J1:488) [F1]. It is written in the chain after `run_start` and before the refused leg's `pre_call`. PROT:61 N2 requires it ("ledger records `budget_refused`");
  - `call_not_made` (J1:509);
  - `bundle_lists` (J1:577);
  - `checker` (J1:612);
  - `orphaned` (J1:689).

**Proposed resolution (SPEC-ONLY)**
- PROT §0 names `run_created` with the J1:849-851 fields.
- Rules:
  - Exactly one `run_created` per run, and it is the first row of the run.
  - Exactly one `run_start`, after it, with `run_start.at` ≥ `run_created.at` (equal in J1).
  - `creatorKeyHash` == `run_start.keyHash` == client `key_hash` == every `pre_call.keyHash` (extends C4).
  - `creatorPlayerHash` == `authorizedPlayerHash` == client `player_hash` == every `pre_call.playerHash` (extends C9).
- PROT §0 also names `run_refused`, `budget_refused`, `call_not_made`, `bundle_lists`, `checker` and `orphaned`. The full phase list at 31bfc58b is:
  - run_created, run_start, pre_call;
  - result (role = architect, coder, reviewer or final);
  - bundle_lists, checker, call_not_made, budget_refused, run_refused, orphaned.
  - Any `run_refused`, `budget_refused`, `call_not_made` or `orphaned` row for the credited run id makes that run FAIL.
  - For the N2 control run (not the credited run), the `budget_refused` row is the REQUIRED evidence: one row, and no `pre_call` for the refused role.
  - Unknown phases are a FAIL for the credited run (fail-closed), not silently skipped.
- Record verbatim, per CONF:278 (also :168) [D4]: "run lookup is a frozen stub; run existence is not evidence of mission creation."

**Impact**
- Client PR: none beyond conflict 2. `player_hash` must hash the participant id exactly as the bridge sees it (SPEC U3).
- j1_judge.py: add the `run_created` checks, the phase whitelist and the extended C4/C9 joins.

**Test**
- Fixtures:
  - no `run_created` → FAIL;
  - two of them → FAIL;
  - `creatorKeyHash` ≠ client key_hash → FAIL;
  - `creatorPlayerHash` ≠ authorizedPlayerHash → FAIL;
  - a `run_refused` row for the run → FAIL;
  - a `budget_refused` row on the credited run → FAIL; on the N2 control, a `budget_refused` row is required;
  - an unknown phase → FAIL.
- Real ledger from the J1 unit tests (wiring test): a valid run → PASS.

---

## Conflict 4: C5 uses `result_sha256[:12]`; ECHO §3 shows `artifactSha256[:12]`

*This also resolves Skywalker's missed item 8, which is **M5** (rev 5 CONF:219-234 [D1]; rev 4 :209-223), about ECHO:14's "same value" claim. See section 8a.*

**Evidence: the two artifact hashes are NOT always equal (verified at 31bfc58b)**
- `artifactSha256` = `sha256(coderArtifact)` (J1:627). `coderArtifact = scrubKeys(out.text, secrets).trim()` (J1:530, :598). `scrubKeys` replaces every key value of 8+ chars with `[redacted]`, then does `.slice(0, J1_TEXT_MAX_CHARS)`, which is 8,000 UTF-16 code units (J1:55, :334-337). The value only travels inside `resultText`. The HTTP body is `{data:{runId,state,mode,resultText,resultSha256}}` (J1:913).
- `artifactJudgedSha256` = `bundle.judgedSha256` (J1:556), and it exists only in the ledger coder `result` row. It is computed as `sha256(trimmedBytes(UTF-8(finalText)))` over the UNSCRUBBED, UNSLICED final message (BUNDLE:25-28, :41-42; J1A:386, :402).
- They are equal only when no key was scrubbed, the message is ≤ 8,000 code units and a bundle step ran. WTEST:281-295 tests exactly the equal case.
- They differ when:
  - a key is scrubbed;
  - the text is truncated;
  - there is no bundle step (judged = null);
  - the coder leg failed (`artifactSha256` = null).
- `resultSha256` = sha256(resultText) (J1:630-631) is in four places: the ledger final row (J1:637-639), the result body (J1:913), the `chain.completed`/`failed` events (J1:652), and the 409/410 `detail` (J1:905, :908).
- **What each hash means [F2]:**
  - The hidden checker judges `coderArtifact` (J1:607), and the reviewer gets the same `coderArtifact` (J1:519). That is the scrubbed, cut and trimmed text, the same text the player is shown, and `artifactSha256` is its hash.
  - `artifactJudgedSha256` (despite its name) is the bundle hash of the coder's full UNSCRUBBED, UNCUT final message. The bundle checks it against `out/normalized.json` (BUNDLE:41-46; J1A:386-391).
  - The ledger coder row also has `outputSha256 = sha256(text)` (J1:553), over the same text as `artifactSha256`. So it equals `artifactSha256` whenever `artifactSha256` is non-null. When the coder leg fails but still produced text (for example `no_workspace_change` or `served_model_mismatch`), J1:553 still records `outputSha256` while `artifactSha256` is null (J1:596-598, :627). C5c fails on a null `artifactSha256`, so this weakens nothing [H1].
- PROT:9, :37 C5 and :45 use `body_sha256`, `result_sha256` and the by-eye `check <12>` against result_sha256.
- ECHO:14 (a founder ruling, 2026-10-22) says to display `artifactSha256[:12]` and never show `resultSha256` as the artifact hash. It states that the ledger coder row "carries the same value", which is **only conditionally true** (above).
- ECHO:16's result line drops `result_sha256` and `body_sha256`.
- SPEC:211, :243, :258 and :287 are superseded.

**Proposed resolution (SPEC-ONLY + CLIENT-ONLY addition; one founder-acknowledgement item)**
- **C5a (bytes binding):** client `result_sha256` (sha256 of the received `resultText` string as UTF-8, SPEC:145) == ledger final `resultSha256`. This keeps the only unforgeable link from what the client received to the ledger.
  - CLIENT-ONLY: the ECHO §4 `result` line must ADD `result_sha256=<64>` (and `http_sha256` per SPEC:146). This is additive, and ECHO doesn't forbid it.
- **C5b (artifact integrity):** client `digest_ok=1` iff all of these hold:
  1. sha256(resultText) == `data.resultSha256`;
  2. sha256(UTF-8(JS-trim(artifactText))) == `artifactSha256` in the parsed result;
  3. `digest12` == `artifact_sha256[:12]`.
- **C5c (shown == checked; primary) [F2]:** client `artifact_sha256` == ledger coder `result` row `outputSha256` (J1:553).
  - This holds whenever the run is honest, because both are sha256 of the same scrubbed, cut and trimmed text that the checker judged (J1:607).
  - A null on either side is a FAIL, and so is a mismatch.
  - This binds what the player saw to what the checker and reviewer saw, through the ledger.
- **C5d (shown == the coder's file; stricter, separate) [F2][FR-R4F]:**
  - Inputs:
    - `artifactSha256`, the hash of the shown text, already bound by C5b and C5c;
    - the shown `artifactText`;
    - the ledger coder row's `artifactJudgedSha256` and `artifactFileSha256` (J1:556-557);
    - and, only when a mismatch is to be excused, the captured ORIGINAL `O`: the coder's untrimmed final message `out.text`, which is the session's `finalText` (J1A:402).
  - Both hashes non-null and equal → C5d PASS.
  - **A null `artifactJudgedSha256` is a C5d FAIL in every case [D2].** Production wiring always passes a bundle to the coder (J1W:238, `bundle: { fs: workspaceFs(workspacePath), artifactPath: J1_ARTIFACT_FILE … }`), and a failed bundle comparison fails the coder leg (J1A:392). So a completed run with a null judged hash did not run the bundle step as wired.
  - **A mismatch is a C5d FAIL, unless ALL of items 1-5 hold. Then C5d is DISCLOSED-PASS: it qualifies, and the report names the transform [FR-R4F].**
    1. **The original is verified.** The judge holds `O` (decoded from the capture as strict UTF-8, or from JSON with lone surrogates kept), and `sha256(UTF-8(JS-trim(O))) == artifactJudgedSha256`. This is exactly how the bundle step hashes the judged message (`trimmedBytes`, BUNDLE:25-29, :42; J1A:386).
    2. **The bundle tie is verified.** `artifactFileSha256` is non-null and equals `artifactJudgedSha256` (BUNDLE:44-45; J1:557), so the bundle step tied `O` to `out/normalized.json`, with both sides trimmed. If the captured `out/normalized.json` is supplied, `sha256(UTF-8(JS-trim(file)))` must equal `artifactFileSha256`, or C5d FAILS.
    3. **The exact transform is reproduced.** The judge runs a faithful port of J1's steps, in J1's order, on `O`:
       - `S = scrubKeys(O, K)` (J1:334-337): for each key `k` in `K` with at least 8 characters, in list order, every occurrence of `k` becomes `[redacted]` (`split/join`). Then `S` is cut to its first 8,000 UTF-16 code units (`slice(0, J1_TEXT_MAX_CHARS)`, J1:55, :337).
       - `T = JS-trim(S)` (J1:530).
       - It requires `T == artifactText` exactly, and `sha256(UTF-8(T)) == artifactSha256`.
       - `K` is the replacement list that the judge derives by aligning `O` with `artifactText`. Each `[redacted]` in the shown text that is not a literal `[redacted]` in `O` stands for one replaced substring. Every derived `k` must be at least 8 characters and have no leading or trailing whitespace (real keys never do; this is fail-closed). The reproduction must then be exact. Because `split/join` replaces every occurrence, a substring replaced once and left visible elsewhere in the uncut region fails.
       - If no such `K` reproduces `artifactText` → FAIL.
    4. **The rebuild mirrors J1's tie [I1].** It starts from the untrimmed `O` (`out.text`, J1:529), never from the file text. The cut is taken before the trim, so leading whitespace in `O` counts toward the 8,000 code units exactly as it does in J1. Items 1 and 2 compare trimmed bytes on both sides, as J1 does. Consequences:
       - `out/normalized.json` equals `O` only after trimming (BUNDLE:42-45), so the file alone can serve as the original ONLY when no cut is needed: the rebuild from `JS-trim(file)` gives `T == artifactText`, and `scrubKeys` of `JS-trim(file)` before the slice is at most 8,000 code units.
       - A cut needs the untrimmed `O`. Without it, the cut position is unknown, so a cut run FAILS C5d (missing evidence).
       - The judge works in UTF-16 code units (Python: `s.encode('utf-16-le', 'surrogatepass')`), keeps a lone surrogate produced by the slice, and hashes it as U+FFFD (`EF BF BD`), as Node does. This matches PR #396's KAT-DIGEST-CUT rows.
       - JS-trim uses ECMAScript's WhiteSpace and LineTerminator set. It strips U+FEFF, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F and U+3000, and NOT U+0085 or U+001C-U+001F. Python's `str.strip()` is not acceptable.
    5. **The report** states DISCLOSED-PASS, the number of replacements, whether a cut happened, which original source was used (`out.text` or the file), and `sha256(UTF-8(JS-trim(O)))`. It never prints `O` or any `k`.
  - **Removed [FR-R4F]:** the rev 3-6 trigger based on evidence in the shown text (`[redacted]` present, or exactly 8,000 UTF-16 code units) excuses nothing any more, and "unverified DISCLOSED" no longer exists. The coder can spoof those signals (rev 4 [D3]), and the founder ruled that they are not proof. Without a verified original and an exact reproduction, every mismatch FAILS.
  - **Handling the original:** `O` may contain a real key, since that is what a scrub means. `O` and the captured file are founder-only evidence: never committed, posted or logged. The judge outputs only hashes and counts, and the report is secret-scanned.
  - Meaning of a C5d FAIL: the text shown and checked is not provably J1's transform of the coder's final message as bound to the artifact file [D7].
- **By-eye check:** on-screen `check <12>` is compared with `artifact_sha256[:12]` (ECHO:14 wins). `resultSha256` is never shown as the artifact hash.
- **R4-F: DECIDED [FR-R4F]** (founder, 07:27 PT 2026-10-23, verbatim): "Scrubbed or truncated artifacts may qualify ONLY when independent verification confirms the original protected artifact and exact scrub-cut-trim transformation. A displayed [redacted] marker or 8,000-code-unit text alone does not establish proof. Missing, inconsistent or spoofable evidence cannot receive qualifying PASS."
  - Implemented by C5d above. DISCLOSED-PASS needs a verified original (items 1-2) and an exact reproduction (items 3-4), and C5a, C5b and C5c must also pass. Everything else FAILS. This replaces both rev 6 options (default "yes, DISCLOSED" and the alternative "any scrub or cut FAILS").
  - **Capture requirement (SPEC-ONLY; founder-side acceptance capture):** for the credited run, the capture keeps the coder's untrimmed final message and `out/normalized.json`, listed by sha256 in the evidence manifest (contents founder-only, as above). J1 at 31bfc58b persists only hashes of these (J1:553, :556-557), so the capture is a harness or founder step, not a J1 change. If the capture is missing, a scrubbed or cut run cannot qualify. A clean run (equal hashes) does not need it.
  - ECHO:14's "carries the same value" sentence should be amended to: "`artifactJudgedSha256` is the hash of the coder's final, unscrubbed and uncut message, which the bundle step ties to the artifact file. It equals `artifactSha256` only when nothing was scrubbed or cut. Whenever `artifactSha256` is non-null, the ledger `outputSha256` equals it." [D7][H1]
  - No J1 code change.

**Impact**
- Client PR:
  - Compute and log both `result_sha256` (C5a) and `artifact_sha256`/`digest12` (C5b), with a JS-compatible trim (Cosmo's PR already covers trim and SHA-256).
  - Display `artifact_sha256[:12]`.
  - Edge: `slice(0, 8000)` can split a UTF-16 surrogate pair. JSON.stringify then emits a lone `\udXXX`, and Node hashes it as U+FFFD. The client must decode the JSON escape into a TCHAR and encode to UTF-8 the same way, or it shows a false "damaged". That is the safe direction (SPEC U8), but add a test.
- j1_judge.py: implement C5a and C5b (from the log fields), C5c (log `artifact_sha256` vs the ledger coder row's `outputSha256`) and C5d [FR-R4F]: equal hashes PASS; null judged = FAIL [D2]; any mismatch FAILS unless items 1-5 hold. That requires an original-verification step (`sha256(UTF-8(JS-trim(O))) == artifactJudgedSha256`, `artifactFileSha256 == artifactJudgedSha256`, and the optional file re-hash), a faithful `scrubKeys` port (split/join per key, then a UTF-16 slice to 8,000), an ECMAScript trim, the alignment that derives `K`, and an exact comparison. It counts UTF-16 code units [D3] and starts from the untrimmed `out.text` [I1]. The `[redacted]`/8,000 trigger is deleted, as is any "unverified" outcome. It takes the original as an optional input path (founder-only) and never echoes it. C5c and C5d need the coder `result` row (`role == 'coder'`).

**Test**
- Fixtures:
  - result_sha256 ≠ final.resultSha256 → FAIL;
  - artifact_sha256 ≠ coder `outputSha256` → C5c FAIL;
  - coder `outputSha256` null → C5c FAIL;
  - no original supplied, and artifactSha256 ≠ artifactJudgedSha256 → C5d FAIL;
  - no scrub or cut, and artifactJudgedSha256 null → C5d FAIL;
  - artifactJudgedSha256 null, with or without an original → C5d FAIL [D2];
  - **spoof: a literal `[redacted]`** in `artifactText`, a mismatch, and no original → C5d FAIL [FR-R4F];
  - **spoof: padded to exactly 8,000 UTF-16 code units**, a mismatch, and no original → C5d FAIL. This includes the variant of 7,999 code points with one astral character (8,000 code units) [FR-R4F][D3];
  - **spoof: a supplied original** whose `sha256(UTF-8(JS-trim(O)))` ≠ artifactJudgedSha256 → C5d FAIL [FR-R4F];
  - original verified, but `artifactFileSha256` null or ≠ artifactJudgedSha256 → C5d FAIL;
  - original verified, one key of 8+ chars scrubbed, no cut, exact reproduction → C5d DISCLOSED-PASS;
  - **original verified, scrubbed AND cut** (the scrubbed text is longer than 8,000 code units), exact reproduction → C5d DISCLOSED-PASS. This proves the scrub runs before the cut;
  - the same text rebuilt by cutting the unscrubbed original first → no match → the judge must not take that path (order guard);
  - **original verified, mismatch not explained by the transform** (one character differs, or a substring of 8+ chars replaced at one occurrence but visible at another inside the uncut region) → C5d FAIL;
  - original with 3 leading spaces, cut case: DISCLOSED-PASS only when the rebuild starts from the untrimmed `out.text`. The same run with only `out/normalized.json` (trimmed) → C5d FAIL [I1];
  - original verified, a cut that splits a surrogate pair → DISCLOSED-PASS, with the lone surrogate hashed as `EF BF BD` (matches PR #396 KAT-DIGEST-CUT);
  - an original ending in U+3000 or U+FEFF is trimmed; one ending in U+0085 is not (a guard against Python `strip()`);
  - a derived replaced substring with leading or trailing whitespace → C5d FAIL;
  - digest12 ≠ prefix → FAIL;
  - all equal → PASS.
- Bridge-side evidence: WTEST:281-295 already shows equality in the clean case.
- Add a vitest in Cosmo's client PR comparing client SHA/trim with Node on: an 8,001-char artifact; one whose 8,000th code unit is a high surrogate; and one containing a fake key-shaped string. Expect C5c to PASS on all three. Expect C5d DISCLOSED-PASS on the 8,001-char and key-shaped cases only when the judge fixture supplies the verified untrimmed original; without it, expect C5d FAIL [FR-R4F]. On the surrogate case, expect a client "damaged" or a C5b FAIL, never a silent pass.

---

## Conflict 5: N9 bridge restart mid-run: J1 can only take the refuse branch

**Evidence (actual behaviour at 31bfc58b)**
- PROT:68 N9 allows "completes from ledger or refuses; no duplicate pre_call". PLANADD:12: J1 must not claim recovery.
- Recovery is LAZY: `ready()` runs `recover()` only on the first `dispatch` after start (J1W:256-269). `events` and `result` are NOT gated on it (J1W:271-272). server.ts:458-460 builds the controller and never calls `recover()` at startup.
- **Before** any post-restart dispatch, `events`/`result` for the old run → 404 `julius_dispatch_run_unknown` (J1:888-889, :898-899), because the in-memory records are empty.
- **After** recovery:
  - An unfinished run gets an `orphaned` ledger row (J1:689) and state ORPHANED. `events` → 200 with `state:ORPHANED`, `events:[]`, `terminal:true` (J1:893, TERMINAL J1:298). `result` → 409 `julius_dispatch_run_orphaned` (J1:901-902).
  - A run that finished before the restart → `result` 410 `julius_dispatch_result_lost_on_restart` (J1:907-908), because the result text is not persisted.
  - A failed recovery → every dispatch 503 `julius_dispatch_ledger_unavailable` (J1W:267).
- Re-dispatching the same runId:
  - with the same key → 200 `replayed:true` with the stored state, and NO new chain or pre_call (J1:744-745);
  - with another key → 403 `julius_dispatch_run_creator_mismatch` (J1:748).
- So "completes from ledger" is impossible in J1.
- SPEC:165 and SPEC:329 F18 describe only the 404 path. They are incomplete.

**Proposed resolution (SPEC-ONLY + CLIENT-ONLY)**
- PROT N9, for J1: PASS iff all hold:
  1. The client shows a non-success terminal row: 404 `run_unknown` → "The server does not know that run any more", or ORPHANED / `run_orphaned` / `result_lost_on_restart` → a stopped row with no result drawn.
  2. The ledger has no `pre_call` for that runId with `at` after the restart.
  3. There is no `result role=final` row for that runId written after the restart.
  4. If the run had a final row before the restart, the client must not display a result (410).
  - Any "completed after restart" outcome, or a `replayed:true` answer rendered as success, is a FAIL.
- The `orphaned` row is required only if a post-restart dispatch occurred. Lazy recovery means its absence alone is not a failure. The test procedure (below) forces one.
- SPEC r1 table §2.5 and F18 add `julius_dispatch_run_orphaned` (409), `julius_dispatch_result_lost_on_restart` (410) and `julius_dispatch_final_row_unwritten` (409) as terminal, no-retry, no-result rows. A 200 dispatch with `replayed:true` and a non-ACCEPTED state is rendered from `state` and never as a fresh start.
- Not proposed: an eager `recover()` at startup would be a J1-CODE-CHANGE (new head, new review). The refuse branch passes without it.

**Impact**
- Client PR: handle the four restart kinds and `replayed:true`. Stop polling on `terminal:true` with ORPHANED.
- j1_judge.py: implement the N9 check on the ledger, comparing the restart time (from the capture's bridge PID and start-time record, resolution 9, or the bridge's stdout lines; there is no access log [F8]) with pre_call/final rows by runId.

**Test (rehearsal, zero spend)**
- **[F7] This can't be run zero-spend at 31bfc58b.** It needs a fake-provider bridge, which doesn't exist (R7-F, conflict 7). It is blocked on R7-F option (i) or (ii), or on a founder-accepted live run (iii).
1. Start run A, then kill the bridge after the architect `pre_call`.
2. Restart it, and poll events → expect 404 `run_unknown`.
3. Dispatch a new run B (fresh run id and key). Recovery runs first (J1W:258-267) and orphans A. For `julius-inworld-data-1`, B is then refused:
   - The answer is 409 `julius_dispatch_repeat_receipt_missing`, because A is unsealed (CEIL:127, :209-240; J1:799).
   - A `run_refused` row is written for B.
   - The attempt counts against the daily cap (J1:779), so with default caps no further dispatch is possible that UTC day.
   - The test PASSES on this 409. B must not start a chain.
4. Poll A → expect 200 ORPHANED terminal, and result 409 `run_orphaned`. The ledger must have an `orphaned` row for A and no new `pre_call` for A.
5. Re-dispatch A with the same key → 200 `replayed:true` state ORPHANED, and no new rows.

---

## Conflict 6: M2/N8 refuse-to-send while `LogHttp VeryVerbose` is on

**Evidence**
- PROT:51 M2 and PROT:67 N8.
- SPEC:74 and :77 DO specify the gate (`local_http_verbose`), and SPEC:314 F3 covers it. PLANADD:13 is stale (Cosmo's finding confirmed).
- ECHO:12 says "refusals are shown from the error `code` only" and ECHO:16 says "`refused` (code only)". But the bridge body is `{error:{kind,message}}`, with no `code` field (J1:952, :1027). `code` exists only inside the controller (J1:420) and in bridge-side log lines (J1:794, :843). SPEC:110, :114 and :155 branch on `error.kind`.
- Every client request carries the `Relay-Session` token, including echo and the events/result polls, not only the dispatch. SPEC:74 checks the gate once, "before anything is sent", at command start. A verbosity raised mid-run with the `log LogHttp VeryVerbose` console command would then leak the header on the polls.

**Proposed resolution (CLIENT-ONLY, plus SPEC-ONLY wording)**
- ECHO §2.5 and §4 wording: "code" means the bridge's `error.kind` string. The client reads `error.kind` only and never `message`. The `refused` line is `WLJMISSION refused run=<id|none> kind=<error.kind | local_*> utc=…`.
- The gate is re-checked immediately before EVERY bridge request (echo, dispatch, each events poll, result).
  - If it's on before dispatch → `refused kind=local_http_verbose`, nothing sent.
  - If it turns on mid-run → stop polling, log `refused kind=local_http_verbose`, and show "not shown". Never send another request while it's on.
  - Fail-closed. This is stricter, never weaker.
- PROT M2/N8 stay unchanged. Add the expected J1 evidence: one `WLJMISSION refused … kind=local_http_verbose` and no ledger row of any phase.
  - **[F8]** server.ts at 31bfc58b has no HTTP access log, so "nothing sent" can't be shown from bridge request logs.
  - Evidence is zero ledger rows (no echo row is written either), no `accepted`/`refused` bridge stdout line for the attempt (J1:794, :843, :875), and the capture's network view if the founder's capture records one.

**Impact**
- Client PR: a per-request gate in the single `NewBridgeRequest` path (SPEC:89); parse `error.kind`.
- j1_judge.py: N8 = exactly one `refused kind=local_http_verbose`, zero ledger rows for that attempt, and the C11 grep is clean.

**Test**
- F3 as written: launch with `-LogCmds="LogHttp VeryVerbose"` → refused, nothing sent.
- New F3b: start a rehearsal run, then raise the verbosity from the console mid-poll → the polls stop, there's one `refused` line, and the grep finds no `Relay-Session` or `Authorization`.
- A judge fixture where `refused` carries `code=` instead of `kind=` → FAIL.

---

## Conflict 7: rehearsal label `rehearsal=fake` vs "REHEARSAL (fake provider)"

**Evidence**
- PROT:7 has `[rehearsal=fake]` on trigger. PROT:19 B4: the trigger line carries it. PROT:32 C0: no `rehearsal=fake` or `mode=fake` anywhere.
- SPEC:199 sets the on-screen row prefix. SPEC:240 puts the token on line 1. SPEC:248: token iff the rehearsal-build CVar is set, and a mismatch with the bridge `mode` → `local_mode_mismatch`, not shown. SPEC:305 N0.
- ECHO:16's trigger field list omits the token.
- J1 writes `mode` on `run_start` (J1:857), every `pre_call` (J1:500-501), each role `result` (J1:549), the final row (J1:638) and `run_refused` (J1:791, :840). It returns `mode` in the dispatch, events and result bodies (J1:880, :893, :913).
- **Side finding:** the production composition hardcodes `mode: 'live'` (J1W:252). server.ts:458-460 chooses only that composition or the refuse-only uncomposed controller. Fake adapters under the live wiring are refused 503 `julius_dispatch_mode_mismatch` (J1:726-729). **At 31bfc58b no bridge entry point can run a fake-provider rehearsal.** Fake mode exists only in unit tests.

**Proposed resolution (CLIENT-ONLY + SPEC-ONLY)**
- ECHO §4: the `trigger` line carries ` rehearsal=fake` iff the build is a rehearsal build (SPEC:248 rule). The `result` and `verify` lines carry `mode=<fake|live>` copied from the bridge.
  - A mismatch between the build label and the bridge `mode` → `refused kind=local_mode_mismatch`, and nothing is shown (SPEC N0/N0b kept).
- The screen prefix `REHEARSAL (fake provider) - ` stays as the player-visible label.
- C0 matches both the log token and the ledger `mode=fake` (already catches fake runs). B4 checks the token. M1/video checks the screen prefix.
- Add: rehearsal and live runs MUST use separate ledger files, so a live run's C0 is never failed or masked by rehearsal rows.
- **R7-F: NEEDS-FOUNDER-RULING (or J1-CODE-CHANGE):** B4, N0 and N1-N9 require "the rehearsal build" with a fake provider, but no shipped bridge composition runs fake at 31bfc58b. Options:
  - (i) a new, default-off, loopback-only fake composition selected by an env flag. This is a J1-CODE-CHANGE and needs a new head and Skywalker review.
  - (ii) a founder ruling that the unit-test harness or a separate test server counts for B4/N-controls.
  - (iii) run the N-controls live, which is not zero-spend and so violates PROT:57.
  - I recommend (i) as a separate PR that does not touch the PASSed 31bfc58b code paths. The founder decides.

**Impact**
- Client PR: emit the token and `mode=`, and implement the mismatch refusal.
- j1_judge.py: C0 over all `WLJMISSION` lines and all ledger rows. B4 rehearsal → print REHEARSAL and exit 1.

**Test**
- Judge fixtures:
  - token present → REHEARSAL, exit 1;
  - ledger `mode=fake` without the token → still C0 FAIL;
  - a live ledger with one stray fake row → FAIL.
- Client test: the rehearsal CVar plus a `live` answer → `local_mode_mismatch`, and the reverse.

---

## 8a. Skywalker's missed items 8-10 (rev 4: item 8 = M5, item 9 = M6, item 10 = SPEC:293 inside M4)

### Item 8 → M5 (rev 5 CONF:219-234 [D1]): ECHO:14 "the ledger's coder result row carries the same value"
Covered by **resolution 4** (C5c, C5d and the founder's R4-F ruling, DECIDED [FR-R4F]) and Appendix A. In short:
- The claim holds only if nothing was scrubbed, the artifact was not cut at 8,000 code units, and a bundle step ran.
- C5c binds the shown text to the ledger `outputSha256` unconditionally.
- C5d FAILS any mismatch with `artifactJudgedSha256` unless the original is verified and J1's scrub, cut and trim reproduce the shown text exactly, which makes it DISCLOSED-PASS (R4-F, DECIDED [FR-R4F]). A null `artifactJudgedSha256` is always a FAIL [D2].
- No separate resolution is needed.
- Rev 4 M5's citations check out (§10 RF2). M5 proposes no resolution and defers C5 to this doc (CONF:104, :234 [D1]).

### Item 9 → M6 (rev 5 CONF:236-240 [D1]) (low): PLANADD:7 expects a bridge instance id in `run_start`; J1 writes none

**Evidence**
- PLANADD:7 says: "the bridge writes an instance id in run_start (already requested by C3 "Binding")".
- The `run_start` row at J1:854-863 (31bfc58b) has these fields: dispatchId, runId, missionId, frozenSha256, contractSha256, briefSha256, checkerSha256, preregId, budgetCapUsd, legEstimateUsd, authorizedPlayerHash, mode, at, the ceiling fields, projectHash, sessionHash, keyHash, clientTriggerId, clientLogSha256, runOrdinal and the three provider ids.
  - There is no instance or process id. A search for "instance" in J1, J1A and J1W finds only unrelated uses.
  - `dispatchId` is fresh per dispatch (J1:766), so it doesn't identify a process.
- The "C3 Binding" PLANADD cites is not C2 protocol C3. PROT:35 C3 is "reviewer provider differs". It probably lives in REPORT_C2 or a JUDEV2 note I could not read, so that citation is **unverified**.
- The PROT checks don't require an instance id anywhere: B1-B5 (PROT:16-20), C0-C12 (PROT:32-44), M1-M6 and N1-N9 (PROT:50-68).

**What an instance id would prove, and what already proves it**
1. **Which bridge build ran.**
   - PROT B2 (PROT:17) already pins the bridge branch commit and tree.
   - `run_start` pins frozenSha256, contractSha256, briefSha256 and checkerSha256 (J1:855-856).
2. **That one process served the whole run, with no hidden restart.**
   - A restart cannot carry a run on: lazy recovery orphans it (J1:689).
   - A restarted run's result is refused with 409 `run_orphaned` or 410 `result_lost_on_restart` (J1:902, :908).
   - So a run that completed with a final row was, by construction, served by one process.
   - The final row's `orderOk` (J1:639) and `verifyRunOrdering` (J1:252-274) seal the row order.
3. **Run 2 on a fresh client launch (PROT:71).** This concerns the CLIENT process, which ECHO:16 covers ("the exe sha256 and pid at boot"). It is not about the bridge.

**Proposed resolution: SPEC-ONLY** (PLANADD amendment)
- Replace PLANADD A.4's bridge clause for J1 with: "Bridge process identity is evidenced outside the ledger. The founder-side capture records the bridge's PID and process start time, and the sha256 of the bridge entry file, before and after each run, together with B2's commit and tree. A different PID or start time within one run is a FAIL (N9 rules apply). The ledger itself carries no instance id at 31bfc58b."
- The judge adds no ledger check for an instance id.
- **No J1 code change is needed.** It would only become one if the founder or Skywalker want the binding *inside* the ledger. That would mean a random per-process `bridgeInstanceId` in `run_created` and `run_start`, a new J1 head and a new review. I don't propose it, because every property in points 1-3 is already covered fail-closed.

**Impact**
- Client PR: none. The client's own exe sha256 and pid at boot are already in ECHO:16.
- j1_judge.py: read the capture's bridge-process record, and FAIL if the PID or start time changed between `run_created.at` and the final row's `at`.
- Capture script (W4, SPEC §5): add the bridge PID, start time and entry-file sha256 to the pre-flight (SPEC:282) and the post step (SPEC:288).

**Test**
- Judge fixtures:
  - same PID and start before and after → PASS;
  - a different start time → FAIL;
  - a missing record → FAIL (fail-closed).
- Rehearsal: restart the bridge mid-run. The record changes, and N9 refuse-branch evidence appears (resolution 5).

### Item 10 → M4, SPEC:293 bullet (rev 5 CONF:207; refusal paths :208-214 [D1]) (low): M4 omitted SPEC:293 (the THIRD dispatch is refused, not the second)

**Evidence**
- SPEC:293: "Run 2: repeat 5-10 with a fresh key and a fresh run id; assert the second `key_hash` differs and a third dispatch is refused by the bridge cap (`julius_dispatch_mission_cap_reached` row)."
  - So SPEC expects dispatch 2 to be ADMITTED and dispatch 3 to be the refused one.
- CONF M4 (CONF:200-217 [D1]) shows that dispatch 2 is refused by the combined ceiling unless run 1 has a verified dollar receipt (J1:30-35, :782-826).
- Rev 3 of M4 didn't cite SPEC:293. Rev 4 added it (rev 5 CONF:207 [D1]) and named J1:781 (default 2, J1:53, :765) as the cap.
- That is the cap SPEC:293 names, but on the same UTC day it is not the check that fires first (see below and §10 RF1).
- The check order at 31bfc58b, inside the reservation (J1:771-826), for mission `julius-inworld-data-1`. Ceilings apply only to that mission (CEIL:53-54).
  1. Daily cap (:779-780): `run_start` and `run_refused` rows on the same UTC day ≥ `JULIUS_J1_DAILY_CAP` (default 2, J1:52, :764) → 429 `julius_dispatch_cap_reached`.
  2. Mission cap (:781): `run_start` rows for the mission ≥ `JULIUS_J1_MAX_RUNS_PER_MISSION` (default 2, J1:53, :765) → 429 `julius_dispatch_mission_cap_reached`. Refused attempts do not count here.
  3. Combined ceiling (:787-826):
     - more than one prior `run_start` → 409 `repeat_already_used` (CEIL:216, J1:797). **Only for `julius-inworld-data-1`** (CEIL:53-54). It writes a `run_refused` row (J1:789-796);
     - run 1 unverified → 409 `repeat_receipt_missing` or `repeat_spend_unknown` (J1:798-799);
     - over the ceiling → 409 `repeat_above_per_run` or `repeat_combined_ceiling` (J1:810-814).
- Consequences:
  - **Dispatch 2** is refused 409 `repeat_receipt_missing` or `repeat_spend_unknown` with a `run_refused` row, unless run 1 is receipt-verified. As wired, with a subscription coder, it is refused. That is M4.
  - **Dispatch 3**, if dispatch 2 was ADMITTED: on the same UTC day it gets 429 **`cap_reached`** (two `run_start` rows, daily cap checked first). On a later day it gets 429 `mission_cap_reached`, which is SPEC:293's kind. If env raised the mission cap (and the daily cap, or it is a later day [F9]):
    - on `julius-inworld-data-1` only, it gets 409 `repeat_already_used`, **with** a `run_refused` row (J1:789-796);
    - on any other mission there is no refusal at that point, and dispatch 3 is ADMITTED. The ceiling block runs only when `missionCeilings !== null` (J1:719, :787), and that is the case only for `julius-inworld-data-1` (CEIL:53-54). CEILT:403 shows a non-ceiling mission getting no repeat refusal on run 2. No test covers a non-ceiling dispatch 3 with a raised cap (see §11).
  - **Dispatch 3**, if dispatch 2 was REFUSED: on the same UTC day it gets 429 `cap_reached` (the `run_start` plus the `run_refused` row count toward the daily cap). On a later day it is refused again by the ceiling (409 `repeat_*`).
  - SPEC:293's single expected kind is therefore right only for a later-day dispatch 3 after an admitted run 2.
  - **SPEC:293 also says "`julius_dispatch_mission_cap_reached` row", but that row doesn't exist.**
    - The two 429 cap refusals (`cap_reached`, `mission_cap_reached`) go through `refuse()` (J1:420), which returns a response and writes NO ledger row. This "no row" statement applies to those two 429s only.
    - By contrast, every combined-ceiling 409 (`repeat_*`, including `repeat_already_used`) DOES write a `run_refused` row, via `refuseRepeat` (J1:789-796). So do the clock refusals (J1:839-841).
    - So the evidence for a 429 cap refusal is the HTTP 429 kind in the client's log and the capture, plus the ABSENCE of any new ledger row.

**Proposed resolution: SPEC-ONLY (M4 itself stays NEEDS-FOUNDER-RULING)**
- M4 now cites SPEC:293 (CONF:207 [D1]); rev 5 adds the refusal paths at CONF:208-214, matching this item. Additionally state: "SPEC r1 expects dispatch 2 admitted and dispatch 3 refused. At 31bfc58b, dispatch 2 is refused by the combined ceiling unless run 1 has a verified dollar receipt. If dispatch 2 is admitted, dispatch 3 is refused by the caps."
- Amend SPEC:293's assertion. The third dispatch must be refused with one of:
  - 429 `julius_dispatch_cap_reached` (same UTC day);
  - 429 `julius_dispatch_mission_cap_reached`;
  - 409 `julius_dispatch_repeat_already_used`. This applies to `julius-inworld-data-1` only, and only when the mission cap (and the daily cap, or the day) allows the dispatch to reach the ceiling. On any other mission with a raised mission cap, nothing refuses here: the third dispatch is admitted, which FAILS this check. So the protocol must keep the default mission cap of 2 for non-ceiling missions.

  Evidence:
  - The client log and the capture show the refusal kind.
  - For either 429 (and only for the 429s): the ledger gains no row at all. Drop the word "row" from SPEC:293.
  - For a 409 `repeat_already_used` (`julius-inworld-data-1` only): exactly one new `run_refused` row with that code (J1:789-796).
  - In every case: no new `run_start` or `pre_call` row, and no chain.

  Any admission of a third dispatch is a FAIL. This keeps the guarantee and only makes the expected kind and evidence accurate, so nothing is weakened.
- The client already has text for the two 429s: "Julius has run all the missions he can for now." (SPEC:170).
- SPEC's table has no row for the 409 `repeat_*` kinds. That gap is CONF M3 / Appendix B. Propose SPEC:166's "That run cannot be started again." with no retry.
- Whether run 2 can be admitted at all is M4 and stays a **founder ruling**: a receipt-producing coder, a ceiling change, or accepting that ACCEPT-FOR-ROW-12 (PROT:74) can't be reached as wired. Not decided here.

**Impact**
- Client PR: map the 409 `repeat_*` kinds (resolution M3 / Appendix B) and the 429 cap kinds to their rows. Never auto-retry.
- j1_judge.py:
  - Third-dispatch check: one refusal kind from the set above in the client log, with 0 new `run_start` or `pre_call` rows. A 429 must also produce 0 new rows of any kind. A 409 `repeat_already_used` must produce exactly one `run_refused` row with that code.
  - Dispatch 2: a `run_refused` row with a `repeat_*` code means run 2 did not happen. That is reported as M4, never as a pass.

**Test (rehearsal or unit level)**
- Same day: dispatches 1 and 2 admitted (fake receipts verified), then dispatch 3 → 429 `cap_reached`.
- Next day with the clock advanced: dispatch 3 → 429 `mission_cap_reached`.
- On `julius-inworld-data-1`, with `JULIUS_J1_MAX_RUNS_PER_MISSION=5` **and** a raised daily cap (`JULIUS_J1_DAILY_CAP` ≥ 3) or a later UTC day [F9]: dispatch 3 → 409 `repeat_already_used`. With the default daily cap of 2, the same day gives 429 `cap_reached` first. CEILT:390-400 uses DAILY_CAP=10 for exactly this reason. Expect one `run_refused` row. On a non-ceiling mission with the same env, dispatch 3 is admitted.
- Unverified run 1: dispatch 2 → 409 `repeat_receipt_missing` with a `run_refused` row; dispatch 3 the same day → 429 `cap_reached`.
- Existing coverage and gaps: see §11. The gaps are recommended J1 test additions, test-only with no runtime change.

## 8. Related items carried from CONF (not among the 7; for Skywalker)

- **M2/N1:** PROT:60 `kind=unauthorized` never matches. Propose that N1 accepts exactly:
  - client-side `local_not_paired` / `local_not_paired_for_a_project` (nothing sent);
  - bridge-side `sign_in_required` (401, J1:983), `julius_dispatch_founder_only` (403, J1:664/707), `julius_dispatch_second_pairing` (403, J1:709) or `julius_dispatch_wrong_project` (403, J1:665/708/987);
  - in every case with no ledger `pre_call`.
  - SPEC-ONLY.
- **M4 (CONF:200-217 [D1]):** run 2 is refused by the combined-ceiling code without a run-1 dollar receipt (J1:30-35, :782-826), and the coder is a subscription. ACCEPT-FOR-ROW-12 (PROT:74) is unreachable as wired. **NEEDS-FOUNDER-RULING.** Not decided here.
- **N5:** idempotency keys on runId+creator (J1:744-751). The PROT:64 wording should say:
  - same key + same runId → replays (J1:744-745);
  - same key on another run → 409 `key_reused` (J1:751, :777);
  - same runId with a different key or creator → 403 `run_creator_mismatch` (J1:748, :774) [nit].

  SPEC-ONLY.

## 9. Citation verification results

- Verified exact, by blob id and sha256: CONF rev 4 (28217ba2 / 7959af5d), PROT (58ba107e), SPEC, ECHO, PLANADD and J1 all match Cosmo's Sources table. PROT, SPEC, ECHO and PLANADD also match SHA256SUMS.txt; that file's CONF entry is stale at rev 4 (§10 RF4).
- Doc line refs (rev 5 [D1]): "Sources" is at CONF:21 and "Missing or unverifiable citations" is at CONF:282 (rev 4: :19 and :271; rev 3: :11 and :236).
- Every PROT, SPEC, ECHO and PLANADD line cited in conflicts 1-7 was read and says what CONF quotes.
- J1 lines re-checked at 31bfc58b. All of these match: 248, 254-267, 420, 500-501, 638, 664-665, 707-709, 722-737, 744-751, 768-770, 774, 789-799, 810-814, 834-836, 844, 846-853, 902, 905, 908, 952, 983, 1002, 1010, 1020 and 1027. J1A:567-582 and J1W:256-270 also match.
- Imprecise or not reproduced:
  1. Rev 3's header vs chat label mismatch: CLOSED. Rev 4 states it at CONF:7 (unchanged in rev 5).
  2. The J1A/J1W rows (rev 3 CONF:20-21, rev 4 CONF:28-29, rev 5 CONF:30-31 [D1]; rev 2 of this doc cited :21-23 by mistake) still give no sha256. Rev 4 adds blob ids. Supplied above: 5faabc3b…, 7e8862ba…, identical at 22a0a9cb and 31bfc58b.
  3. J1:29-35: the quoted text is at J1:30-35. Line 29 is the item header. Harmless.
  4. CONF conflict 5 relies on SPEC:165/:329 (404 `run_unknown` after restart). That is true only before lazy recovery. After it, the behaviour is ORPHANED, 409 or 410 (see conflict 5).
  5. ECHO:14's claim that the ledger coder row "carries the same value" is only conditionally true. Rev 4 withdraws it from conflict 4 (rev 5 CONF:104 [D1]) and adds M5. Here, C5c and C5d handle it (conflict 4).
  6. The claim that 5eb51efb is an ancestor of 22a0a9cb (rev 5 CONF:107 [D1], rev 4 :105, rev 3 :93) is **CONFIRMED** by Skywalker: compare gives ahead_by 16, behind_by 0, merge_base 5eb51efb, single-parent chain. The test it adds is at WTEST:281-295.
  7. 1254b0d1 (rev 5 CONF:40, :287 [D1]; rev 4 :38, :276; rev 3 :27, :241; rev 2 of this doc cited :29 by mistake): **RESOLVED**. Skywalker confirmed its parent is 31bfc58b, 4 commits after 22a0a9cb, single-parent, and evidence-only apart from the xai-direct-reviewer files in that range. Rev 5 CONF:40 agrees (origin is now 71d9f6f8 → 1254b0d1 → 31bfc58b).
  8. ECHO:1's bridge tip 2f8c346a has different J1 blobs (299e5336). ECHO's contract text predates the combined-ceiling code.
  9. crosscheck.py / test_crosscheck.py (PROT:2) and "REPORT_C2 section 6" (PROT:5): **BLOCKED**. They exist only on JUDEV2's side (Kaisin). They are not in the 31bfc58b or 8f312b32 trees, not on the box, and GitHub code search returns 0 (Skywalker). SPEC:288 also says they were not found.

## 10. Findings on Cosmo's rev 4 (9b50b4d4), checked against 31bfc58b

*[D1] Rev 4 line numbers are kept in this section as the historical record of what was found. Rev 5 equivalents: :7 → :7 (rev 5 note at :9); :51/:68/:82/:101-105/:116/:136/:153/:176 → :53/:70/:84/:103-107/:118/:138/:155/:178; :205 → :207 (refusal paths :208-214); :209-223 → :219-234; :225-229 → :236-240; :38-39/:276 → :40-41/:287; :32 → :34. All of RF1-RF4 and R4-1..R4-5 are addressed in rev 5 (§10a).*

- **Superseded:** the rev 2 "**Proposal:**" blocks still present in Cosmo's doc at 9b50b4d4 are SUPERSEDED by the resolutions in this doc. Rev 4 itself says "Rev 4 proposes no new resolutions; YUJI owns those" (CONF:7).

  | CONF line | Topic | Superseded by |
  |---|---|---|
  | :51 | conflict 1 | resolution 1 |
  | :68 | conflict 2 | resolution 2 |
  | :82 | conflict 3 | resolution 3 |
  | :101-105 | conflict 4 | resolution 4 (C5a-C5d, R4-F) |
  | :116 | conflict 5 | resolution 5 |
  | :136 | conflict 6 | resolution 6 |
  | :153 | conflict 7 | resolution 7 |
  | :176 | M2/N1 | §8 M2/N1 |

  Rev 5 should mark each block "superseded by YUJI resolutions (this file's sha256)".

- **RF1 (low; M4's SPEC:293 bullet, CONF:205): CONFIRMED. The cap order is settled, and Skywalker's review §2(c) concurs.**
  - Rev 4 says SPEC:293's third-dispatch refusal is "J1:781 … with `J1_DEFAULT_MAX_RUNS_PER_MISSION = 2` (J1:53) read at J1:765". That is the cap SPEC names, but it is incomplete:
    1. The daily cap is checked first (J1:779-780). It defaults to 2 (J1:52, :764) and counts `run_start` and `run_refused` rows on the same UTC day. After two same-day dispatches, the third gets 429 `julius_dispatch_cap_reached`, so J1:781 is never reached.
    2. J1:781 `mission_cap_reached` fires only on a later UTC day, or with `JULIUS_J1_DAILY_CAP` raised.
    3. Neither 429 writes a ledger row. Both are `return refuse(…)` (J1:420) inside the reservation, and J1:866 returns them unchanged.
    4. Only `refuseRepeat` (J1:789-796) and the clock refusals (J1:839-841) append `run_refused`. So SPEC:293's "`julius_dispatch_mission_cap_reached` row" can't be produced.
    5. The raised-mission-cap 409 `repeat_already_used` exists only for `julius-inworld-data-1`, and it does write a `run_refused` row. On other missions a raised cap means no refusal.
  - J1's own tests corroborate this. Every test that expects `mission_cap_reached` sets `JULIUS_J1_DAILY_CAP: '10'` (J1T:440, :846), and so does the raised-cap test (CEILT:393).
  - Suggested rev 5 wording for CONF:205: "…the third dispatch is refused 429 `cap_reached` (J1:780) on the same UTC day, or 429 `mission_cap_reached` (J1:781) on a later day. Neither writes a ledger row."
- **RF2 (M5, CONF:209-223): citations PASS. The order matches ours.**
  - Scrub at J1:336 (call at :529), cut at J1:337 with J1_TEXT_MAX_CHARS at :55, trim at J1:530: rev 4 says "scrub, then the 8,000-char cut, then trim", the same as here.
  - Also correct:
    - J1:333-337, :328, :598, :627, :913;
    - J1A:386 (`judgedMessage: outcome.finalText ?? ''`);
    - J1B:25-29 and :41-42;
    - J1:556, :624-628, :596;
    - J1WT:281-292 and :291.
  - Nits:
    1. The J1WT test block runs to :294, where it asserts `sha(resultText) ≠ artifactJudgedSha256`.
    2. M5 repeats ECHO's label "(the checker-judged hash)" for `artifactJudgedSha256` without correcting it. Per F2, the checker judges `coderArtifact` (J1:607), whose hash is `artifactSha256`. `artifactJudgedSha256` is the bundle's hash of the unscrubbed message, bound to the file. Worth a one-line note in rev 5.
- **RF3 (M6, CONF:225-229): PASS.**
  - Fields, J1:858 ceiling spread, and no instance id: all correct.
  - Trivial: J1:853 is the comment line. The `append` call starts at :854.
- **RF4 (low; integrity):** SHA256SUMS.txt was not updated in 9b50b4d4, because the commit touches only the doc. It still lists `0eac5c77…` (rev 3) for `docs/C2_J1_CONFLICTS_20261023.md`, while the rev 4 bytes hash to `7959af5d…`. Regenerate it in rev 5, or note that SUMS covers sources only.
- **R4-3 (low; Skywalker's, carried [D5]):** "C2" terminology. Rev 4 listed the title label as a separate meaning (it is the protocol) and missed the protocol's crosscheck row C2, PROT:34 "`| C2 | architect, coder, reviewer each have pre_call before result | neg_missing_pre_call |`". This doc cites PROT check ids (C1, C5, …) by row, so "C2" here means the protocol unless written "PROT C2 (PROT:34)".
- **R4-4 (nit; Skywalker's, carried [D5]):** the no-cut condition [G3] is "at most 8,000 UTF-16 code units before the trim" (`slice(0, J1_TEXT_MAX_CHARS)`, J1:55, :337; trim at J1:530), not "8,000 chars". This doc already uses code units (resolution 4, Appendix A); j1_judge.py must count them the same way (resolution 4, [D3]).
- **RF5 (info):** rev 4's Sources (CONF:38-39, :276) now confirm the bridge target 31bfc58b and the parent chain 71d9f6f8 → 1254b0d1 → 31bfc58b. This is consistent with Skywalker's check (§9 item 7). J1T blob 91a8ff80 (CONF:32) matches my fetch.

## 10a. Rev 5 (672d1358) verification [D1][D5]

Bytes: blob e99fde0f, sha256 6f24f1ff…44aa, 287 lines, parent 9b50b4d4, compare ahead 1 / behind 0; only `docs/C2_J1_CONFLICTS_20261023.md` (+28/−17) and `SHA256SUMS.txt` (+2/−2) changed; `sha256sum -c` 7/7 OK on re-fetched bytes. Commit unsigned (as before).

| Item | Result | Notes |
|---|---|---|
| R4-1 / RF1 (M4 third dispatch, CONF:207-214) | PASS | J1:774/776/777/779-780/781 order, J1:52/53/764-765 defaults, J1:789-796/797, J1:420, J1:1027 (err at :952), J1:719 + CEIL:54, CEIL:214-216 verified at 31bfc58b. Minor: its test list omits J1T:838-850 (restart mission-cap test, DAILY_CAP=10). |
| R4-2 / RF4 (SHA256SUMS) | PASS | |
| R4-3 (CONF:15-19) | PASS | PROT:34 quote exact; title bullet merged. |
| R4-4 (CONF:107, :231-232) | PASS with nit | CONF:224 still says "the 8,000-char cut". |
| R4-5 (8 Proposal blocks) | PASS | all 8 labelled superseded, none deleted. |
| RF2 (CONF:221) | PASS with nit | J1:607, J1B:40-46, J1A:386 correct. Our nit 1 (the J1WT test block runs to :294/:295) not carried; CONF still cites J1WT:281-292. |
| RF3 (CONF:80, :238) | PASS | |

## 11. J1 test coverage at 31bfc58b (daily cap, mission cap, repeat_*)

Files read (blob ids verified): J1T = relay-bridge/julius-dispatch.test.ts (91a8ff80) and CEILT = relay-bridge/julius-dispatch-repeat-ceiling.test.ts (6cbd68de). WTEST (a5e2861a) has no cap or repeat assertions.

| Behaviour | Test (file:line of `it`) | Asserting line(s) | Setup notes |
|---|---|---|---|
| mission cap → 429 `mission_cap_reached` | J1T:439 "caps: two runs of the frozen mission, then refused; the daily cap also binds" | J1T:445 | mission `mission-j1-frozen` (no ceilings); DAILY_CAP=10 |
| daily cap → 429 `cap_reached` | J1T:439 (same test) | J1T:449 | DAILY_CAP=1; second dispatch |
| daily cap counts `run_refused` | J1T:752 "\|offset\| > 1000 … counts against the daily cap" | J1T:759-760 (2 run_refused), :764 (429 cap_reached) | fake harness, DAILY_CAP=2 (J1T:721) |
| mission cap survives restart (file ledger) | J1T:838 "persists rows, and a restart … still refuses the run and the mission cap" | J1T:850 | DAILY_CAP=10 |
| `repeat_above_per_run` / `repeat_spend_unknown` / `repeat_receipt_missing` | CEILT:342 | CEILT:349, :355, :366 (and `calls` stays 3: no second chain) | DAILY_CAP=10; injected receipts |
| `repeat_combined_ceiling` | CEILT:370 | CEILT:377 | env lowers the combined cap |
| `repeat_already_used` (route) | CEILT:390 "refuses a third run of this mission even when the env run cap is higher" | CEILT:399 | DAILY_CAP=10, MAX_RUNS=10 |
| `repeat_already_used` / unverified (unit) | CEILT:227 "reads run-1 from ledger rows and refuses a second prior run"; verifyRun1Spend units CEILT:154, :161, :177 | CEILT:249; :154-195 | pure functions |

**Gaps, confirmed by Skywalker.** These are recommended J1 test additions. They are test-only and need no runtime change. Any change to J1 files would still need a new head and review, per the usual rule.
1. **Same-day, default caps, ANY mission [R5-1]:** with DEFAULT caps (daily 2, mission 2), two ADMITTED dispatches then dispatch 3 on the same UTC day → 429 `cap_reached`. No test covers this for any mission: every test that admits two runs raises `JULIUS_J1_DAILY_CAP` (J1T:440, :565, :577, :846; CEILT:318-404), J1T:446-449 uses DAILY_CAP=1 on dispatch 2, and J1T:752-766 reaches `cap_reached` only after two REFUSED attempts (clock-offset `run_refused` rows, fakeH DAILY_CAP=2 at J1T:721), never after two started runs. Add it for a non-ceiling mission and for `julius-inworld-data-1`.
   - **Precondition [D6]:** for `julius-inworld-data-1`, dispatch 2 is admitted only if run 1 has verified provider receipts, so the test must inject verified run-1 receipts whose actual spend passes the per-run and combined ceilings (as CEILT's `routeHarness` does with `costUsdMicros`). Otherwise dispatch 2 is refused 409 `repeat_*`, and dispatch 3 then gets `cap_reached` for a different reason (one `run_start` + one `run_refused`).
2. **Later UTC day:** dispatch 3 → 429 `mission_cap_reached` for the ceiling mission (and for a non-ceiling mission).
   - **Precondition [D6]:** a settable harness clock. The J1T harness keeps `clock` private (J1T:90) and only advances it per `now()` read (J1T:95), so the test needs a harness option to set or jump the clock across 00:00Z between dispatch 2 and dispatch 3. For the ceiling mission, the gap-1 receipt precondition also applies.
   - No test reaches a later day. The J1T harness clock is fixed at `2026-10-22T12:00:00Z` (J1T:90) and only steps +1 s per `now()` read (J1T:95). A test needs an injectable clock jump across 00:00Z.
3. **429s write no row:** assert ledger row count before == after for both `cap_reached` and `mission_cap_reached`, so no `run_refused` row. No test asserts this today.
4. **(Mine.) Repeat refusals do write a row:** a `run_refused` row with the `repeat_*` code (including `repeat_already_used`) is asserted for the combined-ceiling refusals. CEILT:342-399 checks only the status/code and the provider call count, never the row. The clock-refusal tests do assert rows (J1T:759-760, :770, :796).
   - Also pin that a non-ceiling mission with a raised mission cap admits dispatch 3.
5. (Mine, for F4.) Re-dispatching a run id that has only a `run_refused` row is admitted and then HALTED with `run_order_violation`. A test should pin this documented behaviour, so the client rule in F4 is backed by evidence.

---

## Appendix A: `artifactSha256` vs `artifactJudgedSha256` (31bfc58b)

**They can differ.**

| | artifactSha256 | artifactJudgedSha256 |
|---|---|---|
| Where | inside `resultText` (result JSON) only, not a top-level field. The client gets it in the 200 result body `{data:{runId, state, mode, resultText, resultSha256}}` (J1:913) | ledger coder `result` row only (J1:556); never on the wire |
| Input | in this order: (1) **scrub**: every key value of 8+ chars → `[redacted]` (J1:336); (2) **cut** to the first 8,000 UTF-16 code units, `slice(0, J1_TEXT_MAX_CHARS)` (J1:55, :337); (3) **trim** with JS `String.trim` (J1:530); then sha256 of the UTF-8 (J1:328, :598, :627) | JS-trim of the strict-UTF-8 decode of the UNSCRUBBED, UNSLICED final message (BUNDLE:25-28, :41-42; J1A:386) |
| What it means [F2] | hash of the text the checker (J1:607) and the reviewer (J1:519) judged and the player sees; = ledger coder `outputSha256` (J1:553) | hash of the coder's full unscrubbed, uncut message, bound to `out/normalized.json` (BUNDLE:41-46) |
| Null when | coder leg failed (no artifact) | no bundle step, or not the coder |
| Equal when | no scrub AND ≤ 8,000 code units AND a bundle step ran (test: WTEST:281-295) | same |

`resultSha256` = sha256(resultText) (J1:630-631) is a third, distinct hash. It is in the body (J1:913), the ledger final row (J1:637-639), the `chain.completed`/`failed` events (J1:652) and the 409/410 detail (J1:905, :908). The bundle also checks judged == file (`artifactFileSha256`, BUNDLE:44-45, J1:557). A mismatch fails the coder leg with `artifact_file_mismatch` (J1A:392).

## Appendix B: Error/refusal kinds the bridge sends to the client (31bfc58b, relay-bridge/julius-dispatch.ts blob 018fb582 unless noted)

- Body shape is always `{error:{kind,message}}` (J1:952, :1027). The restart kinds add `detail.resultSha256` (J1:905, :908).
- All kinds are `julius_dispatch_*` except `sign_in_required` and `method_not_allowed`. There is no exported constant list. These are all the literals.
- Source: the independent lookup at /workspace/julius/c2/J1_CLIENT_FACTS_31bfc58b.md (sha256 0a36b7c3… after the rev 2 wording fix: scrub, then cut, then trim; the :913 body includes runId, state and mode). I spot-verified these by reading the lines myself: not_loopback 972, browser_refused 976, sign_in_required 983, method_not_allowed 990/1006, run_invalid 996/1012, founder_only 664/707, run_unknown 889/899, already_dispatched 776, result_not_ready 911, ledger_unavailable 865 + J1W:267, clock_* 834-836, run_order_violation 770, and scrubKeys/slice 334-337 (J1_TEXT_MAX_CHARS = 8000 at :55). All matched.

| HTTP | kind (without `julius_dispatch_` prefix unless noted) : line(s) |
|---|---|
| 400 | body_invalid :1010 · client_log_binding_required :1016 · clock_binding_invalid :1020 · clock_binding_required :834 (live only) · cursor_invalid :1002 · idempotency_key_invalid :1007 · run_invalid :996, :1012 |
| 401 | `sign_in_required` :983 |
| 403 | browser_refused :976 · founder_only :664 (echo), :707 · not_loopback :972 · operator_is_not_the_game :979 · run_creator_mismatch :748, :774 · second_pairing :709 · wrong_project :665 (echo), :708, :987 |
| 404 | run_not_found :755 · run_unknown :889 (events), :899 (result) |
| 405 | `method_not_allowed` :990, :1006 |
| 409 | already_dispatched :776 · clock_echo_unknown :835 · clock_offset_out_of_range :836 · final_row_unwritten :905 · key_reused :751, :777 · mission_not_frozen_mission :756 · repeat_above_per_run :811 · repeat_already_used :797 · repeat_combined_ceiling :812 · repeat_receipt_missing :799 · repeat_spend_unknown :799 · result_not_ready :911 (not a failure: poll again) · run_not_ready :757 · run_order_violation :770 · run_orphaned :902 |
| 410 | result_lost_on_restart :908 |
| 429 | busy :760 · cap_reached :780 · mission_cap_reached :781 |
| 503 | brief_not_frozen_contract :733 · disabled :662 (echo), :699, :975 · key_store_required :735 · ledger_unavailable :865, julius-dispatch-wiring-core.ts:267 · mission_not_frozen :732 · mode_mismatch :727, :729 · not_configured :706, :718, :805, :813-814 · provider_key_in_env :737 · providers_not_composed :700, :731 · reviewer_config_mismatch :722 · reviewer_not_independent :724 · run_lookup_unavailable :754 |

- Separate vocabulary, not HTTP errors: `failure` and `state` inside 200 bodies/events (J1:504-622, e.g. `reviewer_rejected`, `checker_failed`, `kill_switch_flipped`, `ledger_write_failed[_after_call]`, `run_order_violation`, `<role>_<failureClass>`, `internal_error` at J1:878).
- Client-local kinds are `local_*` (SPEC:74-82, plus `local_mode_mismatch`, `local_event_gap`, `local_poll_timeout`, `local_result_mismatch`).
- Freezing this list for the client = SPEC-ONLY. Any change to J1 kinds needs a new head and a new review.

## Appendix C: CONF line shifts, rev 3 (8f312b32, blob f7af3ee9, 241 lines) → rev 4 (9b50b4d4, blob 28217ba2, 276 lines)

Diff hunks (`diff` rev3 rev4):
- 6a7,8 (rev-4 note);
- 10a13,18 (Terminology "C2");
- 19,21c27,32 (Sources rows J1/J1A/J1W changed, plus J1B/J1WT/J1T added);
- 27,28c38,39 (changed);
- 83a95;
- 90c102, 93c105 (changed);
- 146c158 (changed);
- 192a205 (SPEC:293 in M4);
- 195a209,230 (M5, M6);
- 206c241 (changed);
- 240,241c275,276 (changed).

Unchanged lines shift as follows:

| rev 3 lines | shift | rev 4 lines |
|---|---|---|
| 1-6 | +0 | 1-6 |
| 7-10 | +2 | 9-12 |
| 11-18 | +8 | 19-26 |
| 19-21 | changed | 27-32 |
| 22-83 | +11 | 33-94 (27-28 changed in place → 38-39) |
| 84-192 | +12 | 96-204 (90, 93, 146 changed in place → 102, 105, 158) |
| 193-195 | +13 | 206-208 |
| 196-241 | +35 | 231-276 (206, 240-241 changed in place → 241, 275-276) |

Citations in this doc, re-mapped:

| Where cited here | rev 3 | rev 4 | Note |
|---|---|---|---|
| §0, §9 "Sources" | :11 | :19 | |
| §9 item 2 (J1A/J1W rows) | :20-21 (rev 2 of this doc said :21-23, wrong) | :28-29 | rows changed: blob ids added |
| §9 item 7 (1254b0d1) | :27 (rev 2 of this doc said :29, wrong), :241 | :38, :276 | both changed in rev 4 |
| §9 item 6 (5eb51efb) | :93 | :105 | changed: rev-4 M5 note appended |
| Conflict 4 / item 8 → M5 | (none) | :209-223; also :95, :102 | new in rev 4 |
| Item 9 → M6 | (none) | :225-229 | new in rev 4 |
| Item 10 / §8 M4 | :186-194 | :198-207 | :205 (SPEC:293) is new |
| Conflict 2 (option a/b) | :211-234 | :246-269 | |
| Conflict 3 (frozen-stub quote) | :234 | :269 | |
| §9 "Missing or unverifiable" | :236 | :271 | |

## Appendix D: CONF line shifts, rev 4 (9b50b4d4) → rev 5 (672d1358) [D1]

Also saved as `/workspace/julius/c2/CONF_rev4_to_rev5_remap.md`.

In the "Where cited" column, line numbers are those of rev 3 of this doc (a008a018), before the rev 4 edits.


| rev 4 lines | shift | rev 5 lines | note |
|---|---|---|---|
| 1-8 | +0 | 1-8 | |
| — | inserted | 9-10 | rev 5 note |
| 9-13 | +2 | 11-15 | |
| 14-15 | changed | 16-17 | |
| 16 | +2 | 18 | |
| 17 | changed | 19 | |
| 18-50 | +2 | 20-52 | |
| 51-176 | +2 | 53-178 | changed in place: 51, 68, 78, 82, 101, 105, 116, 136, 153, 176 |
| 177-204 | +2 | 179-206 | |
| 205 | changed, 1→9 lines | 207-215 | |
| 206-210 | +10 | 216-220 | |
| — | inserted | 221 | |
| 211-219 | +11 | 222-230 | |
| 220-221 | changed | 231-232 | |
| 222-226 | +11 | 233-237 | |
| 227 | changed | 238 | |
| 228-276 | +11 | 239-287 | |

## Citations in the resolutions doc (a008a018), re-mapped

| Where cited (resolutions line) | rev 4 | rev 5 | note |
|---|---|---|---|
| :4, :24, :31 (header / Sources: "CONF rev 4") | whole doc | whole doc @ 672d1358 | update ref + blob + sha256 + 287 lines |
| :44 J1T row "= rev 4 CONF:32" | :32 | :34 | |
| :50 "Rev 4 CONF:15" (never certified) | :15 | :17 | changed in place (R4-3 merge); sentence kept |
| :99 run-id source, option (a)/(b) | :246-269 | :257-280 | heading at :257 |
| :176 frozen-stub quote ("per CONF:269") | :269 (WRONG in a008a018) | :278, also :168 | rev 4 quote is at :267 and :166; :269 is the next bullet (D4) |
| :197, :380 M5 | :209-223 | :219-234 | :221 new (RF2) |
| :386 "CONF:102, :223" | :102, :223 | :104, :234 | |
| :388, RF3 :553 M6 | :225-229 | :236-240 | :238 changed (J1:854-863) |
| :426, :432, :454, RF1 :533/:541 SPEC:293 bullet | :205 | :207 (SPEC:293 bullet); R4-1 refusal paths :208-212; no-row :213; tests :214 | |
| :431, :491 M4 | :198-207 | :200-217 | |
| :502 "Sources" | :19 | :21 | |
| :502 "Missing or unverifiable citations" | :271 | :282 | |
| :506, :518 "Rev 4 proposes no new resolutions" | :7 | :7 (rev 5 equivalent at :9) | |
| :507 J1A/J1W rows | :28-29 | :30-31 | |
| :510 conflict 4 C5 withdrawal | :102 | :104 | |
| :511 5eb51efb | :105 | :107 | changed (UTF-16 wording) |
| :512, RF5 :557 1254b0d1 / Sources | :38(-39), :276 | :40(-41), :287 | |
| RF5 :557 J1T blob | :32 | :34 | |
| :520-529 superseded table | :51, :68, :82, :101-105, :116, :136, :153, :176 | :53, :70, :84, :103-107, :118, :138, :155, :178 | all 8 now carry the superseded label (R4-5) |
| :621-663 Appendix C (rev 3 → rev 4) | — | — | historical; keep, add this table as Appendix D |

## Appendix E: CONF line shifts, rev 5 (672d1358, 287 lines) → rev 6 (8b5d5233, blob 9cf820e5, 294 lines)

Every CONF:n citation in this doc refers to rev 5 (672d1358) unless it says otherwise. Use this table, copied from Cosmo's rev 6 L292-294 (Skywalker verified it as exact), to read them against rev 6:
- :1-9 stay the same.
- :10-34 become :12-36.
- :35-206 become :38-209.
- :207-215 become :211-219.
- :216 becomes :210 (M4 was reordered).
- :217-287 become :220-290.
- Section headers: Sources :21 → :23; M4 :200 → :203; M5 :219 → :222; Missing or unverifiable citations :282 → :285.
- Examples: the frozen-stub quote moves from :278 and :168 to :281 and :171. M4's :207-214 moves to :211-218, and :224 moves to :227.

## Appendix F: CONF line shifts, rev 6 (8b5d5233, blob 9cf820e5, 294 lines) → rev 7 (8b0e71d2, blob 2f4eb6d4, 301 lines) [F]

CONF citations in this doc stay pinned to rev 5 (672d1358). Read them against rev 6 with Appendix E, then against rev 7 with this table. The table is copied from Cosmo's rev 7 L299-301 (Skywalker: PASS, no findings), and I checked it against `diff` of the two blobs:
- :1-11 stay the same.
- :12-37 become :14-39. Two lines (a blank and the rev 7 note) are inserted after rev 6 :11. Rev 6 :37 (RES) is changed in place at rev 7 :39 (re-pinned to this doc's rev 6, 4515c548).
- :38-294 become :41-297. Rev 7 :40 is the new RES-r4 row (the historical 7773fc53 pin).
- Section headers: Sources :23 → :25; M4 :203 → :206; M5 :222 → :225; Missing or unverifiable citations :285 → :288.

Combined rev 5 → rev 7, for this doc's CONF:n citations:
- :1-9 stay the same.
- :10-34 become :14-38.
- :35-206 become :41-212.
- :207-215 become :214-222.
- :216 becomes :213.
- :217-287 become :223-293.
- Headers: Sources :21 → :25; M4 :200 → :206; M5 :219 → :225; Missing or unverifiable citations :282 → :288.
- Example: the frozen-stub quote at rev 5 :278 and :168 is at rev 7 :284 and :174.
