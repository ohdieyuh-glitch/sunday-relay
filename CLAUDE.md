# Sunday Relay — working notes for Claude Code

Read this before touching anything. It exists because six of the seven
milestones shipped on 2026-07-31 began with a plan to *build* something that
already existed.

---

## The single most important habit

**Search before you build.** Every milestone in this repository has arrived
phrased as "implement X", and in almost every case a substantial X was already
present under a name you would not have guessed:

| The ask | What already existed |
|---|---|
| "durable mission persistence" | `src/relay/persistence/` — journal-as-authority, snapshots, atomic writes, locks, migrations, redaction, `recoverRun`, two verification drills (ADR-016) |
| "isolated mission worktrees" | `src/relay/workspace/worktree-manager.ts` — real `git worktree add/remove` with post-create verification, `.relay-workspaces` containment, branch-name validation |
| "real Claude Code adapter" | `src/relay/connectors/claude-code/` — 18 files, cancellation, session resume, hidden-reasoning omission, all proven offline |
| "GPT Prompt Architect" | `relay-bridge/openai-architect.ts` — server-side, key-from-env (on Chat Completions) |
| "Reviewer harness" | `src/relay/connectors/codex-reviewer/`, `mission/reviewer-gate.ts`, `RelayFinding`, `RelayReview` |

Start with `find`/`grep` over `src/relay` and `relay-bridge`, then read the
barrels. The real work is nearly always **binding an existing engine to the
mission-scoped, durable, customer-facing layer** — not writing the engine.

---

## Architecture in one paragraph

`src/relay/mission/<feature>/` holds **pure domain**: contracts, a projection,
validation, a store built on a shared key/value backing. It has no Node, no
network, no clock (time is an injected ISO string), so the browser and the CLI
can both read the same record and reach the same conclusions. Node-only
implementations live in `src/relay/connectors/<x>/` or `src/relay/persistence/`.
The website (`src/relay/ui/`) consumes the domain and never the reverse.

## Boundaries that will fail your build (all structurally tested)

- **UI is a consumer.** Nothing outside `src/relay/ui` may import something
  inside it.
- **The browser may never reach** `src/relay/persistence`, `src/relay/workspace`,
  the CLI, or a provider SDK. Proven by walking the real import graph from
  `src/relay/main.tsx`.
- **Adapters may not import `/mission`** ("adapters cannot own mission
  verdicts"). If a connector needs a domain type, invert it: the domain declares
  the shape it needs and a composition root (usually the CLI) wires the two.
  This caught me twice.
- **The CLI may import only** its own listed modules, `../mission` (the barrel —
  never a deep path), `../workspace` (facade only), `../persistence`, and
  allowlisted connectors. Both allowlists are hand-maintained arrays in
  `relay-core-boundary.test.ts`; adding a name there is the sanctioned fix.
- **No new dependency is forbidden**, but nothing may add deployment config
  (`vercel.json`, etc.) — the boundary scanner hard-fails on it.

When a boundary test fails, **fix the code, not the rule**. Every time I
restructured instead of widening, the result was better architecture.

## Truthfulness rules the tests enforce

These are the product's whole thesis. Violating one is a real bug:

- **Unknown is not zero.** A missing value is `null` and renders `Unknown`.
  Never a default, never `0`, never inferred from configuration.
- **Requested vs actual are separate fields.** The runtime/provider response is
  the only authority for what actually ran or answered.
- **Announce facts, not intentions.** "Saved" only after the durable write
  resolves; "Connected" only after a verified launch; "Completed" only after a
  real exit plus validated output; "Stopped" only after confirmed termination.
- **A disconnection is never a completion.** After a restart, an unconfirmable
  in-flight run becomes `disconnected`, is never replayed, and never relaunched.
- **Simulated data says so**, and normal production navigation must never load
  it.

## Working rhythm that has worked

1. `git fetch origin --prune`, verify `origin/main` matches what you were told.
2. `git worktree add /home/kaisinrogodfree5/sunday-relay-<task> -b relay/<task> origin/main`
   then `npm ci` in it. Never work in the primary checkout.
3. Map first (a parallel read-only fan-out pays for itself), then implement.
4. `git add -N` new files **before** the authoritative `npm test` — the CI
   accounting and boundary scanners enumerate via `git ls-files` and cannot see
   untracked files.
5. Full gate: `npm test`, `typecheck`, `build`, `relay:build`,
   `relay:bridge:build`, `relay-repository-boundary.mjs`, `relay-parity-gate.mjs`,
   `relay:surface-parity:check:strict`, `relay:yc-demo:check`,
   `relay:cli:contract-verify`, `git diff --check`, plus the drills:
   `relay:persistence:contract-verify`, `relay:persistence:recovery-drill`,
   `relay:workspace:verify`, `relay:claude:contract-verify`.
6. PR → wait for CI → `gh pr merge --squash --match-head-commit <sha>` → sync
   main → confirm Vercel deployed that exact commit → remove worktree, delete
   both branches, `git worktree prune`.

**Adding a `relay mission <x>` CLI action breaks one test every time**:
`src/relay/cli/mission-economics.test.ts` asserts the exact action list in the
error message. Update it in the same change.

## Verifying a deployment

The served bundle embeds `VITE_VERCEL_GIT_COMMIT_SHA`, so you can prove which
commit is live without a browser. Grep the bundle for strings that must be
present (offline-honesty labels) and absent (Node-only code, credential names).
Beware false positives: Vercel injects the **commit message** as an env var, so
words from your own commit appear in the bundle; and `sk-` matches inside
`task-`.

---

## State as of 2026-10-06 (JUJU MAIN, cloud)

**Read this first. Do not trust remembered readiness, PR numbers, migration
numbers, scores or blockers from any earlier session.** Re-verify against live
GitHub (`git fetch origin --prune`, open PRs, the Actions runs named below)
before acting. Where a figure below says *founder canon*, the record behind it
lives outside this repository (the local `landing/`, `row13i/`, `alpha_beta/`
qualification records); it was NOT re-derived from repo evidence in this
session.

### Read first: what changed 2026-10-05 → 10-06

**Founder rulings in force:**
1. **#321 ordering.** The 13 (i) qualification package is pinned to #321's head
   `aeba8b2c2abfb113ccd86be6d9ade5fb62550d30`; a docs-only `main` commit before
   #321 would move its base. So **this State does not merge into `main` before
   #321**. It lives on `relay/claude-md-state-2026-10-04` (#329) and in the cloud
   session's `scratchpad/state.md`, which together are the canonical handoff.
   Preferred landing: the frozen 13 (i) rerun on #321's exact head → land #321 →
   accept-main → rebase this branch and merge it before the 033/034/035/C
   campaign, if no exact-head qualification is in flight. A CLAUDE.md update
   earns no readiness.
2. **Migration 027.** Do not release, reuse, renumber or invent 027; do not touch
   the permanent store; keep 031–035 RESERVED and apply no later migration.
   **Investigated 2026-10-06** (see Migrations below). The decision is the
   founder's.

**Current rules (founder, 2026-10-06):**
- `main` stays untouched unless an already-approved landing sequence permits it.
- `DATABASE_URL` stays PARKED.
- #329 stays UNMERGED until after #321's exact-head qualification and landing.
- 031–035 remain reserved.
- No readiness is self-awarded from cloud implementation.
- Read-only review agents are internal adversarial QA only. They never substitute
  for an independent SECOND qualification.
- No new PR for a small follow-up: update the existing draft.

**The canonical migration numbering** (recorded by JUJU MAIN closing #337):
- 031 = 13 (i);
- 032 = the 030 repair;
- 033 = Wonderland social;
- **034 = Project Brain components**, which exists locally in the Project Brain
  lane and is not on GitHub;
- 035 = voice.

**Closed unmerged by JUJU MAIN, 2026-10-06 14:27Z (branches kept):**
- **#324** (`window.sh`), superseded. The live 031+032 window does not use it:
  MAIN and SECOND JUJU rejected it as the live procedure. It has no landed-commit,
  file-hash or store-identity pin, and no ledger classifier gate. Its single
  backup's restore check creates a scratch database inside the live cluster, and
  it has no rollback-order guard.
  - The reviewed procedure is `FOUNDER_031_032_APPLY r2` +
    `FOUNDER_031_032_ROLLBACK r1` (operator tooling, outside the repo), with its
    own Docker rehearsal.
  - #324's fingerprints (`6040e517` → `a7fb4199` → `6b59133d`) remain a cross-check
    only.
- **#337** (034 options): answered by the numbering above.
- **#338** (034 as a reserved stamp): contradicts the canon, and SECOND JUJU does
  not recommend it. Once applied to any persistent store, a reserved 034 cannot
  give its place back. Its voice-registration work is reusable on top of the
  real 034.
- **#341** (window through 035): it depended on #338 and on unlanded 033/035.
  **Nothing unlanded enters a migration window.**

**Another session's branch, `relay/wonderland-social-r16`:**
- Author `julius-stack-rehearsal`, tip `0cbbc313` (2026-10-06), 50 commits on the
  2026-10-02 `main`.
- It is a separate social implementation under `src/relay/social/`, with its own
  033/035 SQL. It applies SECOND's R16 reviews (10-04, 10-06), including a 60 s
  presence lease and per-player command budgets.
- It overlaps #323, #330 and #340 (this session's 120 s lease and budgets).
- Left untouched here. **Which implementation is canonical is the founder's and
  SECOND Wonderland's call.**

**Cloud progress, 10-05 → 10-06** (all draft, AWAITING INDEPENDENT REVIEW; no
score change):
- **The wall review of 10-05:** six findings, each reproduced and classified.
  Each fix killed its mutants:
  - #325 `98cfad35`: one player's voice moves one step at a time (a per-player
    lock; the race leaked a room). The actor's answer no longer waits on other
    players' reconcile, and an invisible actor reconciles nobody else.
  - #340 `b22ad0b0`: a player can always protect themselves. Block, visibility
    and leave draw only on a `protect` bucket.
  - #323 `4433f84c`: no party inference through an invitation.
  - **Actor-only room takeback** is a reconcile-contract violation, not a leak:
    removing either member separates a pair room.
- **#336 `c5fe7470`:** R16 checks the voice wall over HTTP.
  - `--voice` adds 8 checks, and `--final` requires them.
  - The PostgreSQL-through-035 restart case and the CLI case against the real
    bridge are green.
  - The full gate passed at `84429d1a` except the container-only login probe (#333 fixes it): 14,031 passed. CI is 6/6 at `c5fe7470`.
- **A CI root cause (#336, #327):**
  - #321's 032 suite drops about 13 databases one at a time, and on PostgreSQL
    15+ every `DROP DATABASE` waits on an immediate checkpoint.
  - Reproduced locally ("Hook timed out in 10000ms" under write load) and fixed
    by the hook's own timeout, carried in #336 and #327. **#321 should fold the
    same line.**
- **Migration 027:** investigated (Migrations below).
- **Julius block, 10-06** (no score change):
  - **Decision C is one package: #322 at `079831b8`, with #326 folded in.** #326 sat exactly on #322's head; it is closed as consolidated, and its branch is kept. #331 (option B) is re-stacked on it at `980ab636`. New in the package:
    - **in force, not merely adopted:** `DECISION_SUPERSEDED`, 18 codes, 4 mutants killed. It is latent today: the paid export carries no decisions, and no store writes an adopted decision yet;
    - **repair counters agree** on real PostgreSQL, 2 mutants killed. The dead `repairRoundsFor` is removed: PostgreSQL read a table the live path never writes, and answered 0;
    - **the package, condition by condition**, in `docs/JULIUS_DECISION_C_CARRY.md`.
  - **#321's two teardown folds are prepared** on `relay/julius-321-teardown-folds` (`69cb99bc`, two test files on `aeba8b2c`, product bytes identical, 33/33). There is no PR, and the founder chooses whether and when.

### Repository

- `origin/main` = `0a2b4d162a09cbe772d5dc875eb274cf4b56c490` (#320, Julius
  Missions 2, 3 and 5 frozen at their reviewed definitions), 2026-10-04.
  - Relay CI on that push: run 37221190268, **success**.
  - Julius accept-main: run 37221274276, **success**.
- Nearly all work since August is **Julius** (multi-agent mission runner with
  paid provider runs), plus Wonderland and Project Brain (#309). The newest
  in-repo engineering handoff is `docs/handoffs/JULIUS_CURRENT.md` §000h
  (2026-09-28); it predates everything in this section.
- The only path that can spend provider money is
  `.github/workflows/julius-first-live-mission.yml` behind the paid-slot queue
  (`docs/JULIUS_PAID_RUN_QUEUE.md`).

### Roles

- **JUJU MAIN**: primary Julius implementation, integration and landing owner.
  It runs routine accept-main, preflights, CI, paid dispatches and watchers
  autonomously. The founder has standing authorization for every genuinely
  required paid Julius run. Do not ask the founder to paste routine blocks.
- **SECOND JUJU** / **SECOND Wonderland**: independent reads and verdicts. An
  implementer session never self-awards evidence that requires independent
  verification; it marks the work `AWAITING INDEPENDENT REVIEW` and prepares it
  for a quick check.
- Cloud sessions do repo implementation, worker PRs, tests, CI, migration
  tooling, the C carry, Project Brain, the hosted Wonderland backend,
  static/repo-native qualification and GitHub evidence review. **A qualification
  frozen to a specific local venue is never substituted with a cloud run**: mark
  it `READY FOR LOCAL QUALIFICATION` and continue non-conflicting work.

### Julius readiness (founder canon, independently verified)

| Item | Value |
|---|---|
| **Verified readiness** | **94.524%** |
| Decision A | **EARNED**, +1.44 (93.084% → 94.524%) |
| A's paid evidence | M2, run **37222057584** (`lane=regression mode=paid`, key `julius-live-mission-2@0a2b4d162a09#regression#a7`), **success**, on main `0a2b4d16`; preflight was run 37221610945, success (both re-checked on GitHub 2026-10-04) |
| A's verdict | SECOND independently resolved M2's evidence off-machine under the preregistered strict procedure |
| Alpha streak | **0/3**. M2 does **not** count toward it. The streak starts only after every planned material change has landed and main is frozen |
| Row 13 (i) | Earned on judged candidate r5 `821b55ac` (zero 40001 in two 8-writer stress runs; census C7b 5/5; independently verified). **At risk**: see #321 below. A real failure of the frozen rerun moves **94.524% → 94.057%** (−0.467), not back to the pre-A number |
| Decision C | Potential **+1.10 → 95.624%** if fully earned. Not started on paid runs |
| Everything else | UNKNOWN until it actually qualifies. Never infer a score |

### PR #321: the active front (draft, do not land yet)

Row 13 (i) completion plus the 030 invariant repair: migrations **031 + 032**.

- Base `0a2b4d16`. Reviewed head **`aeba8b2c2abfb113ccd86be6d9ade5fb62550d30`**
  (10 `julius-worker[bot]` commits), `mergeable_state: clean`.
- **CI green** at that head: Verify Relay, real-infra-julius, sibling-control-plane,
  and first-live-topology (host-visible and executor-private).
- Folded migration 032, real PostgreSQL: **89/89 passing**. The three 032 mutants
  each kill their intended cases.
- 13 (i) product-byte precondition against candidate `821b55ac` **holds**: non-test
  13 (i) product files are byte-identical. `wonderland-postgres.ts` differs only
  by 032's chain registration. `821b55ac` is not on any branch on GitHub; it is
  a local candidate.
- The 13 (i) frozen-rerun addendum (ADDENDUM 3) is **approved**.
- **Owed before landing, in order:**
  1. The **unchanged frozen 13 (i) rerun** (stress plus census, the same bar) at
     the integrated head. Founder ruling: if it FAILS, 13 (i) loses +0.467 and
     #321 does not land.
  2. The combined 031+032 apply procedure and its Docker rehearsal.
  3. SECOND's verdicts, then the founder's merge authorization.

  Venue of the frozen rerun: if it is frozen to a local machine, it is
  `READY FOR LOCAL QUALIFICATION`, never a cloud substitute.

### Decision queue: what gates progress now (2026-10-06)

Every open JUJU PR below is green, or running on a test-only push. What moves the material order next is a decision, in this order:

| # | Decision | Owner | Where | JUJU's recommendation |
|---|---|---|---|---|
| 1 | The frozen 13 (i) rerun at #321's head | founder / SECOND (local) | #321 | **READY FOR LOCAL QUALIFICATION**; it gates everything after #321 |
| 2 | Fold the 031 and 032 teardown fixes into #321 | founder | Findings below | yes: two test-only fixes, **ready on `relay/julius-321-teardown-folds` (`69cb99bc`)**. 032's root cause was measured 10-06, and the same line is carried in #336 and #327. Either keep `aeba8b2c` for the frozen rerun and fold after, or fold first (product bytes identical) |
| 3 | ~~What 034 is~~ **Answered by the canon:** 034 = Project Brain components (local Project Brain lane). Owed: that 034 reaching GitHub, reviewed | Project Brain lane / founder | closed #337, #338, #341 | none: 035 stays staged behind 034's guard until the real 034 lands |
| 4 | C pair validity: option A, B or C | founder / SECOND | #322 (doc), #331 | B is prepared in #331, re-stacked on the package |
| 5 | `allowNative` (native social for the RC) | SECOND Wonderland / founder | #339 | its evidence holds; a one-line change. Players must OWN their client's project |
| 6 | A rate limit on social commands | SECOND Wonderland / founder | #340 | adopt #340's budgets (60 commands then 1/s; 20 messages then 1 per 3 s; 10 invitations then 1 per 30 s) before any public hosted launch |
| 7 | Close the stale PRs #290, #291 and #293–#297 | founder | Findings below | close: folded into `main` |
| 8 | Voice room count: pair rooms cost one EOS room per mutually visible channel mate. Is that within an EOS client's limit, or must instance voice be bounded? | CORE / founder | #325 | pair rooms are the only inference-free construction; bound the channel rather than the wall if EOS requires it |
| 9 | Migration 027 | founder (+ one read-only check by the founder or SECOND) | Migrations below | declare 027 **permanently vacant**, never filled; add a chain guard that refuses any back-filled number |
| 10 | Which social implementation is canonical: this session's #323, #330 and #340, or `relay/wonderland-social-r16` | founder / SECOND Wonderland | "Read first" above | not JUJU's to choose. They agree on the message and invitation budgets and differ on the lease (120 s vs 60 s) and the classes. Theirs charges a block to the shared `write` budget (60, then 1/s), the shape #340 removed on 10-06 so that a player's own traffic can never stop them protecting themselves |

### Work in flight from the JUJU MAIN cloud session (2026-10-04, updated 10-06; all draft, AWAITING INDEPENDENT REVIEW)

| PR | What | Stack | CI (2026-10-04) |
|---|---|---|---|
| **#322** | **The Decision C package (10-06):** the corrected carry (`julius-carry.v2`; only verified repair findings and adopted, in-force decisions travel; every exclusion is recorded by code, 18 codes; four-point proof), with #326's paid-venue transport folded in, repair counters that agree, and the package's conditions in `docs/JULIUS_DECISION_C_CARRY.md` | base `main` | `079831b8`: real-infra 4/4 green; Verify Relay running |
| ~~**#326**~~ | **CLOSED 10-06, consolidated into #322**: C on the **paid venue**, a WITH arm learns from its pair's verified evidence bundle (`carryFrom`, input `carry_source_run`, `verify-carry`, `carry-export.json`, `carry.tsv`) | was on #322 | closed |
| **#331** | C **option B prepared, not chosen**: the reviewer names each finding's kind, a contract may promote kinds (`promotedWarningCategories`), and the bundle records each warning's kind (`review-warnings.tsv`). Rehearsed on real PostgreSQL: a promoting WITHOUT arm teaches a WITH arm; its control is refused for free. The four frozen missions' binding digests are pinned and unchanged | on #322 (re-stacked `980ab636`) | real-infra 4/4 green; Verify Relay running |
| ~~**#324**~~ | **CLOSED 10-06, superseded** (see "Read first"): 031+032 (+033) window tooling (`docs/julius-migrations/window/`); its rehearsal fingerprints stay a cross-check only | base `relay/julius-13i-completion-r2` | closed |
| **#323** | Wonderland social backend and privacy wall P1–P5, migration **033**. 10-06: no party inference through an invitation | on #321 | green at `4433f84c` |
| **#325** | Wonderland voice/EOS: every room is one mutually visible pair, PUID binding, one player's voice one step at a time, **035 staged** behind 034 | on #323 | green at `98cfad35` |
| **#328** | Wonderland social display names: the verified GitHub login is recorded at sign-in, and a nameless request never erases it | on #325 | green |
| **#330** | Wonderland presence is a **lease**: a presence not refreshed for 120 s is absent everywhere (reads and decisions), a stale heartbeat is `NOT_IN_INSTANCE`, and the next live heartbeat moves live players out of a departed player's voice room | on #328 | green (6/6) |
| **#327** | Wonderland R16 harness: 24 closed-list checks over HTTP against the real bridge **process**. The scenario keeps the heartbeat, and LEASE fails on a lapse. The restart check is split: DURABLE as stored, then RECONNECT (HELD/REENTERED), then PRESENCE | **restacked on #330** (it must sit above every product change) | green (6/6) at `3e36af29` (10-06: the 032 teardown and lease-renewal timeouts) |
| **#332** | Wonderland **hosted store**: `relay-bridge/wonderland-store.ts` (`inspect`/`bootstrap`) brings the bridge's store from nothing to migrated on a record and REFUSES every database it did not create (the permanent store's case included). `GET /relay-api/wonderland/readiness` (operator only) reports the store as facts. Rehearsed on real PostgreSQL through the real bridge process and the whole R16 scenario | on #327 | green (6/6) |
| **#333** | Julius **local qualification reliability**, three fixes. `migrate()` serialises itself under a session advisory lock (`WONDERLAND_MIGRATION_LOCK`): 7 of 8 concurrent migrators of an EMPTY store used to be refused. The login-probe test clears the probe's own override table (`CLAUDE_AUTH_PROVIDER_OVERRIDES`). The drill suite drops the two databases it used to leak every run. The full suite against ONE fresh database, every real-PG suite live: 13,783 passed, 0 failed | base `main` | green (6/6) at `62a78d5d` |
| **#334** | Wonderland **R16 venue**. The bridge reports, operator-only, the commit its platform attests (`RAILWAY_GIT_COMMIT_SHA`, nothing else believed) and a boot id per start. Every R16 run is judged **HOSTED_FINAL** or **REHEARSAL** (19 named reasons) apart from its checks; `--final` refuses a rehearsal. The verify phase gains a **RESTART** check (boot id changed), which found that #327's own CLI test never restarted | on #332 | green (6/6) |
| **#336** | Wonderland **deploy check** (`scripts/wonderland-deploy-check.mjs`): by reads alone, the hosted bridge is the expected build (attested commit), production-gated, ready (store, social) and closed (health says only ok, report operator-only, foreign origin refused). R16 is now rehearsed **under the production gates**: a bridge refusing pairing on the production branch only passed every R16 test before (7/7, measured) and fails now. 10-06: the **voice wall over HTTP** (`--voice`, 8 checks, `--final` requires them), with the wall review's fixes merged in | on #334 | green (6/6) at `c5fe7470` |
| **#335** | **[DO NOT MERGE] landing rehearsal**: all thirteen open PRs merged in material order on one head. One conflict, the generated `JULIUS_HARNESS_MANIFEST.md`. Full suite on it: 742 files, 14,154 passed, 0 failed | base `main` | **green (6/6), closed** as planned |
| ~~**#337**~~ | **CLOSED 10-06**, answered by the canonical numbering: Migration 034 options (`docs/JULIUS_MIGRATION_034_OPTIONS.md`) | base `main` | closed |
| **#339** | Wonderland **R16 over native sessions** (the RC's session kind). The harness speaks as the native client (`--native`, no Origin, `pairR16NativeSessions`). In process with `allowNative` true only in the test: 24/24 plus the restart over native sessions, identical results and views to browser sessions, and the copy guard both ways. The real bridge refuses native social as shipped, and the harness reports it as the decision. **Found: today only a project OWNER can pair a desktop client** (MEMBER decided, not written) | on #336 | green (6/6) at `be8807b3` |
| ~~**#338**~~ | **CLOSED 10-06**: option 4 contradicts the canon. The branch keeps the voice-registration work (035 in the chain) for reuse on the real 034 | on #336 | closed |
| **#340** | Wonderland social **command budgets, PREPARED, not chosen**: per verified player, `all` 60 then 1/s, `message` 20 then 1 per 3 s, `invitation` 10 then 1 per 30 s. Past it, `429 rate_limited` with `Retry-After`; the command is not executed and takes nothing. Integer-ms GCRA (a fractional first version never returned a due token). The R16 scenario fits the budget with the clock frozen. 7 mutants killed. 10-06: protective commands draw only on a `protect` bucket (30, then 1 per 2 s) | on #336 | green at `b22ad0b0` |
| **#341** | **Migration window through 035, PREPARED on option 4, not chosen.** 034 and 035 get pre-check, post-check and DOWN SQL. `window.sh --through 034\|035` reads their PASS conditions, lets 035 add only empty `voice_*` tables, and requires 034 to leave the catalog fingerprint IDENTICAL. Docker rehearsal of record: R1–R5 PASS, 71 conditions, every 2026-10-04 fingerprint reproduced, after-035 `9f65bb10`. Three mutant migrations each STOP the window. **CLOSED 10-06**: nothing unlanded enters a migration window | on #338 + #324 | closed |

**Findings to act on:**
- **Native social for the final RC (`allowNative`) stays SECOND's and the founder's decision**, and #339 is its evidence.
  - **A prerequisite either way:** each real player must OWN the project their desktop client follows. MEMBER's capabilities (founder decisions 4 and 5) are not yet written, and a MEMBER cannot pair a native client today.
- **The social command route has no rate limit on the stack as it stands** (noted in #336). Budgets are prepared, not chosen, in #340 (decision 6 above).
- **Adversarial reviews of JUJU's own stacks (2026-10-05) found seven defects.** Each was reproduced by the reviewing agent or confirmed by JUJU reading the code; none is on `main`. JUJU is fixing them in its own PRs; **do not land the affected PRs before those fixes:**
  - **Decision C carry (#322, carried up through #326 and #331). FIXED 2026-10-05** in #322 `cdb41364`, merged through #326 `4eeacfb1` and #331 `eb1dbf4a`. Each defect was reproduced first by a test that failed on the old head, and 8 mutants were killed. Full suite on #331's head, against one fresh database: 13,951 passed, 1 failed (the login probe). The defects, for the record:
    - **HIGH:** a copy's id (`carried:<source run>:<ref>`) is not scoped to the receiving run, and the insert is a bare `ON CONFLICT DO NOTHING`. On any long-lived store, the second run to inherit a fact gets nothing, its standing is deduplicated away, and a WITH arm is still accepted (`selected=1 written=0`). Each paid job's database is fresh, so the paid venue is not affected.
    - **MEDIUM:** a restore that failed halfway and is replayed drops copies and standings permanently (revisions advance only on inserts, and a `(run_id, revision)` collision is swallowed).
    - **LOW, latent:** eligibility never checks `blocking`, so a non-blocking warning resolved after a repair could count as a VERIFIED_REPAIR_FINDING. #331 records a promoted warning as `blocking: true`, so requiring it is compatible.
  - **Wonderland wall (#325, #330). FIXED 2026-10-05:**
    - #325 `4ae3683b`: pair rooms, the actor's own counts, and re-bind. 8 mutants killed; full suite 13,902 passed.
    - #330 `9586bf81`: the removal. 2 mutants killed; full suite 13,928 passed.
    - Merged up through #328, #327, #332, #334 and #336 into #338, #339 and #340. Full suite on #336: 14,009 passed.
    - Each defect was reproduced first. **Every voice room is now one mutually visible pair**: the only construction under which a player's rooms never depend on anyone they cannot see. The defects, for the record:
    - **HIGH (P1 / no inference), #325:** the voice room plan for players a viewer CAN see depends on players they CANNOT. A hidden player's arrival splits a stranger's room, and the reconcile kicks that stranger out of voice; the same holds for blocks. The P1 and no-inference "identical view" tests check `wonderlandVoiceRouting`, which nothing in production calls. **A shared-room clique partition cannot be inference-free in general**, so this is a design question for SECOND Wonderland and the founder.
    - **HIGH, #325:** `voice.revoked` on a command's answer counts revocations of players the actor cannot see.
    - **MEDIUM, #325:** a re-bind never removes the old PUID from its rooms. Later removals target the new PUID and are recorded as done.
    - **LOW, #323/#330:** a member removed while their lease had just lapsed can be made present again by a heartbeat stamped earlier and decided later. `UPDATE_PRESENCE` never re-checks membership.
- **Landing order is clean (#335).** Every open PR composes on one head. Only two files are touched by more than one stack:
  - `JULIUS_HARNESS_MANIFEST.md` (Wonderland and C): **the second of those two stacks to land regenerates it** (`npm run julius:harness:export`);
  - `wonderland-postgres.ts` (Wonderland and #333): it auto-merges, and was read by hand.
- **C could not run on the paid venue.** Every paid job's database is fresh, so a WITH arm was always `CARRY_EMPTY`. #326 is the transport. Without it, no C pair can run.
- **#321 should fold a one-line test fix** in `julius-migration-031.real-postgres.test.ts`: `pool.on('error', () => undefined)` before `pool.end()`.
  - Without it, a terminated idle client (57P01) raised unhandled errors that failed `first-live-topology (executor-private)` on a stacked PR.
  - The fix was proven on #323 as `0873f6e2`.
- **#321's migration-032 suite teardown times out under CI load.** Root cause measured 2026-10-06:
  - Its `afterAll` drops the ~13 databases it made one at a time.
  - On PostgreSQL 15+ every `DROP DATABASE` requests an immediate checkpoint of the whole cluster and waits for it. `CREATE DATABASE` does not; each drop logs `checkpoint starting: immediate force wait`.
  - With the real-PostgreSQL step run locally, one such checkpoint took 6.96 s.
  - It failed #327 (10-05) and both of #336's runs before the fix, every case passing each time.
  - Reproduced: the suite alone beside an 8-client `pgbench` write load fails exactly as CI did; with the hook's own `120_000` it passes under the same load.
  - Carried in #336 (`c5fe7470`) and #327 (`3ca664f4`). **The same line should fold into #321**, next to the 031 fix above.
- **034 is Project Brain components (founder canon, 2026-10-06).** It exists locally in the Project Brain lane and is not on GitHub. It gates 035 (EOS voice for final R16, behind its guard) and C after 035 in the material order.
  - #337 and #338 are closed. #338's voice-registration work is reusable once the real 034 is on GitHub.
  - If the real 034 carries UNRESOLVED findings across missions, settle its relation to Decision C before C's registration is frozen (#337's memo, option 1).
- **Hosted R16 needs a hosted PostgreSQL** for the Railway bridge, because the bridge never migrates at boot.
  - Provisioning is the founder's.
  - The procedure is built and rehearsed (`docs/relay/WONDERLAND_HOSTED_STORE.md`, #332) and **AWAITING INDEPENDENT REVIEW**. It runs only after 031–033 land.
  - It attaches the store through `JULIUS_DATABASE_URL`; `DATABASE_URL` stays parked.
- **Stale PRs:** #290, #291 and #293–#297 are fully folded into `main` (via #301/#304/#305/#310/#311). Recommend closing; that is the founder's call.
- **Do not dispatch C's four paid runs yet.** On the retained paid record, **0 of 5** bundles would have been a valid WITHOUT arm. All three completed runs passed review with no blocking finding, so a WITH arm would be refused in preflight (`CARRY_SOURCE_NOT_A_VALID_PAIR`).
  - Two facts the design must respect: the same contract gives the same Julius run id, and, on `main`, warning promotion is unreachable: no contract field reaches it, and the reviewer was never asked a finding's kind.
  - Options A, B and C are in `docs/JULIUS_DECISION_C_PAIR_VALIDITY.md` (#326). **Option B is prepared in #331.** The choice belongs to the founder and SECOND.
  - Whether M2's two warnings would have been promoted is UNKNOWN: its bundle kept no declared kinds.
- **Local-run caveats** (CI is unaffected). **#333 fixes the first three; until it lands, each still holds on `main`:**
  - **The login-probe test fails only inside a Claude Code cloud container:** `relay-bridge/julius/coding-agent-child-env.runtime.test.ts` "the login probe approves a first-party Max login…".
    - The container sets `ANTHROPIC_BASE_URL` for its own proxy, and `classifyClaudeAuth` classifies that as a gateway before it reads the fake CLI. The test cleared only `ANTHROPIC_API_KEY`.
  - **Concurrent `migrate()` calls on an EMPTY store race:** 001's `CREATE SCHEMA IF NOT EXISTS` is not safe against a concurrent creator (`pg_namespace_nspname_index`).
    - A full `npm test` with `JULIUS_TEST_DATABASE_URL` naming ONE fresh database runs every real-PG suite in parallel against it, so they met it (`julius-approval-at-dispatch`).
    - CI never did, because its single-suite steps had migrated the database first.
  - **`scripts/julius-drill-support.test.ts` leaks two `juliusdrill…` databases every run.** Drop them by hand on a local cluster.
  - **What still holds after #333**, against ONE database under a full parallel run:
    - `real-infra-julius.test.ts` seeds fixed ids, so it collides with an earlier run's rows. It is row 13(iii)'s own-job venue: give it its own database, as CI does.
    - `julius-handoff-fence` (a2) can meet a cross-run 40001. Alone it passes 14/14. It is the 13(i) residual, #321's.
    - Neither failed on #333's second full run (13,783 passed, 0 failed).

### Migrations

| No. | What | Where |
|---|---|---|
| 001–026, 028–030 | landed | `main` (`src/relay/persistence/wonderland-migrations/`) |
| 027 | **reserved** for the integration lane (`project_execution_profiles`, `player_mission_contracts`) by agreement, 2026-09-28. **Never existed; never applied anywhere** (investigated 2026-10-06, below) | not on any branch (see the code comment in `wonderland-postgres.ts`) |
| 029 | Project Brain v1 (`029_julius_project_brain.sql`) | landed in #309 |
| 030 | outbox stops re-reading its event (row 13 (i)) | landed in #313 |
| **031** | Julius 13 (i): run transition is a HOT update, plus task-claim work | #321 |
| **032** | repair of 030's orphan/outbox invariant (two orphan paths closed) | #321 |
| **033** | Wonderland social (15 `social_*` tables) | #323, stacked on #321; applied in the #324 window rehearsal only |
| **034** | **Project Brain components** (founder canon, 2026-10-06; 029 is the first Brain migration) | local Project Brain lane; **not on GitHub** |
| **035** | voice (`voice_identities`, history, issuances; never a token) | **staged** in #325 (`docs/julius-migrations/035/`); not in the chain until 034 exists. It refuses without a 034 stamp, so it can never leave a silent hole |

- **`DATABASE_URL` stays PARKED** unless an explicit, reviewed live-store
  procedure says otherwise. No unlanded migration may touch the permanent store.
  A landed migration reaches the live store only through its reviewed apply
  procedure (`docs/julius-migrations/<nnn>/RUNBOOK.md`), never an ordinary
  `migrate()` entry point.
- **No migration gaps.** `main` skips 027. **Investigated 2026-10-06**, read-only,
  with the permanent store untouched.
  - **What it was.** A number reserved on 2026-09-28 by agreement between two
    sessions working in parallel. The Julius worker took 028; the Wonderland↔Julius
    integration lane (branch `relay/julius-mvp-capabilities`, never pushed) was
    to take 027 for `project_execution_profiles` and `player_mission_contracts`.
  - **Did it exist?** No `027_*.sql`, `MIGRATION_027` constant, `'027_…'` stamp or
    SQL naming either table exists in any commit on any of origin's 333
    branches. No PR, open, merged or closed, carried one.
  - **Why the gap is safe today.** Nothing measures the integers:
    - `migrate()` applies by stamp membership;
    - the chain test checks filename order and self-stamping;
    - the R1 bootstrap requires the ledger to equal the build's list;
    - `classify-store.sql` rule 10 defines a gap against the build's chain.
  - **The live store.** It was EMPTY on 2026-10-03 (030 RUNBOOK). The only
    reviewed path from EMPTY is the R1 bootstrap, which writes exactly
    001–026 and 028–030, so its ledger has no 027 by construction. The repo
    holds no copy of that record. **Owed: one read-only check by the founder or
    SECOND:** `SELECT version FROM relay_wonderland.schema_migrations ORDER BY
    applied_at, version;` (expect 29 rows, none `027…`).
  - **The latent defect is the word "reserved".** A 027 landing now would sort
    before 028. A fresh database would apply it between 026 and 028, while the
    live store would apply it last. `classify-store` would call the live store
    UNEXPECTED, and the hosted-store readiness (#332) would report
    `LEDGER_NOT_A_PREFIX`.
  - **Smallest correct fix (the founder's call; NOT applied):** declare 027
    **permanently vacant**, never to be used. The comment beside the constant
    says so, and the chain test refuses any number below the chain's top except
    the documented vacancies (`[27]`). No schema change, no store touch. The
    integration lane's tables, if they come, take the next free number after
    031–035.

### Material pre-freeze order (founder canon)

1. Decision A: **DONE**.
2. **031/032 (#321)**: next.
3. 033 social.
4. 034 Project Brain.
5. 035 voice.

   Social and voice are MATERIAL to Julius: they touch the shared migration and
   Julius surfaces.
6. Decision C plus the corrected carry.
7. **Freeze main.**
8. Four paid C runs.
9. The final consecutive Alpha qualification sequence (3/3 needed).
10. Continue toward 97–98%, then 100% Beta readiness.

### Decision C rules (binding)

- The **corrected carry lands before any C paid run**. The carry defect is a
  **Beta-blocking P2**.
- Carry only **verified reviewer findings** and **explicitly accepted, in-force
  decisions**. Never promote proposed or not-in-force architecture, rejected
  findings, unverified observations, or task-scoped information into global
  truth. Preserve the source run/task provenance and scope.
- **Every valid WITH arm must carry at least one VERIFIED REPAIR FINDING.**
  Design-only carry does not satisfy the pair. **Empty carry makes the pair
  invalid before paid dispatch.**
- Prove all four points:
  1. what WITHOUT wrote;
  2. what became carry-eligible;
  3. what WITH restored;
  4. what the WITH planner actually received.
- All four paid arms run under the frozen registration, in order
  **WITHOUT-1 → WITH-1 → WITHOUT-2 → WITH-2**, with no early-stop rule.
- **13 (i) compatibility gate.** The corrected carry adds a database write on a
  path relevant to 13 (i). Before C lands, the relevant unchanged concurrency test
  must show **zero conflicts at C's final head**. This gate does not
  retroactively change 13 (i)'s earned score.

### Open PRs (live GitHub, 2026-10-04; updated 10-06)

- **#321**: above. The only active landing candidate.
- **#298**: `[DO NOT MERGE]` stack rehearsal, CI only.
- **#290–#297** (last touched 2026-09-29). Triaged 2026-10-04: **#290, #291 and
  #293–#297 are fully folded into `main`** by test title and content (via
  #301/#304/#305/#310/#311). Recommend closing; that is the founder's decision.
  Never merge them on their old evidence.
- **#322–#340**: see "Work in flight" above. **#324, #337, #338 and #341 were closed unmerged on 2026-10-06** ("Read first"); do not reopen them.
- **#255** (brand docs, 2026-09-12), **#138–#144** (Coliseum, Wonderland domain,
  mission ownership, error propagation, 2026-08), **#129** (docs): stale.
- PR #6 from the August notes is no longer open.

### Wonderland (founder canon plus repo evidence, 2026-10-04)

**What is on GitHub (`main`):**
- **Unreal project:** `wonderland/` (`Wonderland.uproject`, `Source/Wonderland/`
  with the Dog pawn, hub game mode and world state).
- **Hosted backend contract:** `docs/relay/WONDERLAND_BACKEND_CONTRACT.md`. It
  covers the `/relay-api/wonderland/*` routes (session-authenticated SSE,
  presence, challenges, battles, the Project Brain and native pairing) on the
  Relay Bridge.
- **Pure domain modules** under `src/relay/mission/`:
  - `wonderland/`: battles, GVE, ratings, swarm, entities;
  - `multiplayer/`: sessions of at most 8, join codes, a 120 s reconnect
    window, participant views;
  - `wonderland-account/`: GitHub identity, preferences, owned state;
  - `wonder-web/`, `project-workspace/`, `wallet/`.

  These came from #273 (2026-09-16) and the Wonderland store migrations 001–010.
- **The internal landing branch** `landing/wonderland-internal-2026-09-23` is
  799 commits off `main` and is mostly art and recovery evidence. It holds no
  social or privacy code.

**On GitHub as draft PRs, not on `main` (2026-10-04):**
- the hosted social layer and privacy wall (#323): friends, blocks, parties,
  private servers, Recent Players, DMs and presence privacy, migration 033;
- the voice/EOS backend (#325): client config at runtime, ID-token
  verification, PUID binding, server-enforced room planning, 035 staged;
- the scripted R16 harness (#327): `scripts/wonderland-r16-harness.mjs`;
- account display names from the verified GitHub login (#328);
- presence liveness (#330). Presence is a lease, and CORE's client must send `UPDATE_PRESENCE` at least every 30 s and re-enter on `NOT_IN_INSTANCE` (`WONDERLAND_BACKEND_CONTRACT.md`).

**What is NOT on GitHub anywhere:**
- the RC12/RC14 packages and their evidence;
- real R16 runs: three real identities, the hosted HTTPS backend, actual EOS
  voice, the shipped RC;
- the EOS client integration (Unreal).

That is either local-only (the Unreal and EOS client) or not yet built (the
hosted social backend). Treat any RC or R16 score as UNKNOWN until its package's
evidence is produced.

**Rules (binding):**
- **Final readiness is ONE package.** Never combine RC12 evidence with RC14
  evidence into a score. The final RC is one shippable package and re-earns
  every required row.
- **Final R16 requires all of these:**
  - the backend landed on accepted `main`;
  - a hosted HTTPS backend;
  - the shipped final RC reaches it;
  - actual EOS voice and real identities;
  - restart/reconnect and durable state;
  - the complete privacy wall.

  The hosted final RC must not depend on the founder's laptop or on `127.0.0.1`.
- **Ownership:**
  - JUJU: migrations, the live store and deployment sequencing;
  - SECOND Wonderland: backend and privacy correctness;
  - CORE: the client endpoint, the RC and the final R16;
  - Founder: only an unavoidable account, credential or billing step.
- **Privacy wall (all hostile-tested):**
  - **P1:** a user hidden from strangers shows no Dog, no name, and no
    population count, and gives nothing from which presence, location or
    activity can be inferred.
  - **P2:** Recent Players is filtered at read time.
  - **P3:** the dead "appear in Recent Players" switch is removed.
  - **P4:** a server owner blocks a member → the member is removed and the
    owner stays.
  - **P5:** a member blocks the private-server owner → the blocker leaves and
    the owner stays.
  - **Party:** a leader who blocks a member removes them; a non-leader who
    blocks leaves.
  - **DMs:** blocked DMs are hidden from both sides while the block exists.
  - **No inference:** no voice, roster, role, location, activity or party
    inference about a blocked user.
- **EOS:**
  - the backend supplies the minimum game-client configuration at runtime,
    with no persistence or package exposure;
  - the trusted server secret stays backend-only;
  - the second real client uses a second Windows account;
  - the founder supplies the third real identity for the final three-party
    proof.
- **Migrations** share the Julius order: social is **033** and voice is **035**,
  and neither may land before 031/032.

**Local-only for Wonderland:**
- Unreal packaged-client boots;
- real keyboard/mouse qualification;
- EOS Windows-account voice;
- the actual 2- and 3-client R16;
- laptop-tied performance and soak runs.

Cloud does the hosted backend, the privacy semantics and their tests,
migrations 033/035, endpoint/config delivery and the qualification harnesses.

### Next score-bearing action

The **frozen 13 (i) rerun at #321's head `aeba8b2c`**: +0.467 is at stake. It is
`READY FOR LOCAL QUALIFICATION`. After it come the reviewed live apply procedure
(`FOUNDER_031_032_APPLY r2` + `ROLLBACK r1`, outside the repo, with its own Docker
rehearsal; #324's cloud rehearsal is a cross-check only) and SECOND's verdict;
then #321 lands. C (+1.10) is the next score-bearing work, after 033–035.
C needs #322 and #326 landed before the freeze, plus the four C contracts
(WITHOUT/WITH with `carryArm`/`carryFrom`), which belong to the founder and SECOND.
Those contracts first need a pair-validity choice: see "Do not dispatch C's four
paid runs yet" above.

---

## HISTORICAL: State as of 2026-08-02 (superseded; kept for context)

> Superseded by the State section above. In particular, "provider calls made,
> ever: zero" stopped being true in September: paid Julius runs go through
> `julius-first-live-mission.yml`. The surfaces, security shape and "facts
> worth not rediscovering" below are still useful; the commit, the open items
> and PR #6 are not current.

`origin/main` = `86c1e935a04e31c71b87a9e211676028106ce697`. Primary checkout
clean on `main`. Suite 3,724 passing across 188 files, 0 failed, 0 skipped.

**Relay is no longer a static demo.** There are now three live surfaces:

| Surface | Where | State |
|---|---|---|
| Frontend | https://sunday-relay.vercel.app | live mode ON, pointed at the Bridge |
| Bridge | https://sunday-relay-production-7d60.up.railway.app | authenticated, healthy |
| Volume | Railway `/data` | mounted, write-probed at boot |

Railway project `265bbb82-5f7a-4874-bad7-b1ec9d469808`, environment
`profound-insight / production`, autodeploys `main` via the GitHub integration.
Build `npm run relay:bridge:build`, start `node dist-relay-bridge/server.cjs`,
healthcheck `/health`.

**Provider calls made, ever: zero.** No provider credential is configured
anywhere.

### Shipped 2026-08-01 → 08-02

Reviewer harness catalog UI (#13), Hermes Reviewer harness adapter (#14),
Reviewer bridge client + CLI controls (#15), fullscreen moved to the Live
Terminal (#16), bridge production hosting (#17, #18), secure browser pairing
(#19), **mission-route authentication (#20)**, browser pairing form (#21),
architect live-proof readiness (#22).

### The security shape, in one paragraph

There is ONE operator credential, `RELAY_BRIDGE_API_TOKEN`, server/CLI only —
it must never reach a browser. The CLI mints a **pairing grant** (256 bits, one
exact origin, 2 minutes, single-use, stored hashed); the founder carries it
across by hand; the browser redeems it for a **read-only session**
(origin-bound, 30 min, revocable, in memory so a restart revokes everything).
Operator uses `Bearer`; browser uses `Relay-Session` — deliberately different
schemes so neither can be mistaken for the other. Browser sessions may READ
reviewer readiness/status/inspect and one mission; everything that spends money
or mutates a run is operator-only. CORS is exact-match with no wildcard branch.

### Open items, most actionable first

1. **The browser has never actually been paired.** Everything is deployed and
   verified; no grant has been minted. Open the Reviewer panel →
   `Relay Bridge`, then run (grant lives 120s):
   `RELAY_BRIDGE_URL=https://sunday-relay-production-7d60.up.railway.app RELAY_BRIDGE_TOKEN='<token>' node dist-relay/cli.cjs reviewer pair-browser https://sunday-relay.vercel.app`
2. **Prompt Architect awaits its one live call.** Set `OPENAI_API_KEY`
   (secret), `OPENAI_PROMPT_ARCHITECT_MODEL=gpt-4o` and
   `RELAY_PROMPT_ARCHITECT_MODE=live` on **Railway**, then POST
   `/relay-api/architect/verify` with operator auth and `{"authorized":true}`.
   Capped at 16 output tokens, ≈$0.0002. Founder must authorize explicitly.
3. **PR #6 is open and stale** — needs a rebase. Repeatedly told not to touch it.
4. **The stray worktree** `/home/kaisinrogodfree5/sunday-relay-agent-team-setup`
   on `relay/claude-agent-team-setup` at `9c14b69`. Not mine; confirm before removing.

### Facts worth not rediscovering

- **`dist-relay/` is gitignored**, so the CLI binary is per-checkout. A merged
  CLI command will NOT exist in `dist-relay/cli.cjs` until you run
  `npm run relay:build` *in that checkout*. This cost a founder-facing failure:
  `reviewer pair-browser` was merged and deployed but the binary they ran was
  three hours stale.
- **`npm test` takes 12–16 minutes**, past the 600s command timeout. Run it in
  the background. Under parallel load, tests that spawn processes exceed
  vitest's 5s default — give them `}, 30_000)`.
- **Never run two Claude sessions in one checkout.** Two collided here: one
  committed the other's working tree, and a `pkill -f vitest` killed the other's
  suite. A 3,100s test run with 15 "failures" was pure CPU contention.
- **Vercel injects the commit message** as `VITE_VERCEL_GIT_COMMIT_MESSAGE`, so
  any word you write in a commit appears in the browser bundle. Scan for
  SYMBOLS (`createReviewerBridgeClient`) or key-SHAPED regexes, never bare
  strings. `sk-` also matches inside `task-` and inside Relay's own redaction
  regexes.
- The bridge tsconfig **forbids `import.meta`**; `npm run typecheck` runs two
  passes and the bridge one is easy to skip locally.
- Adding a `relay mission <x>` or `relay reviewer <x>` action breaks the test
  asserting the exact action list in the error message. Update it in the same change.
- **A Julius task is claimable only when Julius released it.** The claim
  query offers RUNNABLE tasks only; BLOCKED becomes RUNNABLE solely inside
  `appendDecision({ releaseTaskIds })`, computed by `evaluateJuliusRelease`
  (accepted dependency, or SKIPPED). Seed dependents BLOCKED; create reviews,
  repairs and sub-agents RUNNABLE. A test that seeds a BLOCKED task expecting
  the claim query to pick it up once its dependency SUCCEEDED is wrong now.
- **A repair inherits its subject's role and stage** (`repair:plan` on the
  Prompt Architect, `repair:build` on the coder, never `repair:repair:*`), is
  proven routable before it is created (`REPAIR_UNROUTABLE` otherwise), and
  every deployment fixture must register the repair type on the right role.
- **Coding Agent spend is governed by `julius-allocation.v1`**: share =
  floor(spendUsd / (1 + repairCycles)), bounded by what remains, reserved
  exactly, and passed to the hosted adapter as its limit. No policy → the
  adapter's 50¢ default. Do not raise `DEFAULT_HOSTED_LIMITS.maxCostCents`.
  Design: `docs/JULIUS_PAID_RUN_34037313976_REPAIRS.md`.
- Hermes Agent v0.18.2 at `~/.local/bin/hermes`. `-z` one-shot + `--usage-file`
  is the chosen transport. Read-only is STRUCTURAL: an isolated `HERMES_HOME`
  disables all 23 toolsets (verified against the real binary), so the model gets
  no tool at all. Never mutate the founder's `~/.hermes`.

### Julius harness map (generated, gated)

`JULIUS_HARNESS_MANIFEST.md` is GENERATED by `scripts/export-julius-harness.mjs`
from the live composition roots; `scripts/export-julius-harness.test.ts` fails
when it is stale. After changing Julius's production file set or wiring, run
`npm run julius:harness:export` and commit the manifest. The single-file export
it also writes (`generated/JULIUS_HARNESS_SOURCE.txt`) is gitignored and is not
source of truth.

### If a session limit interrupts you

Stop cleanly and say so. Leave the worktree in place with deps installed and
write down exactly where you stopped.
