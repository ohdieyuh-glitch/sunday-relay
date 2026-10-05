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

## State as of 2026-10-04 (JUJU MAIN, cloud)

**Read this first. Do not trust remembered readiness, PR numbers, migration
numbers, scores or blockers from any earlier session.** Re-verify against live
GitHub (`git fetch origin --prune`, open PRs, the Actions runs named below)
before acting. Where a figure below says *founder canon*, the record behind it
lives outside this repository (the local `landing/`, `row13i/`, `alpha_beta/`
qualification records); it was NOT re-derived from repo evidence in this
session.

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

### Work in flight from the JUJU MAIN cloud session (2026-10-04; all draft, AWAITING INDEPENDENT REVIEW)

| PR | What | Stack | CI (2026-10-04) |
|---|---|---|---|
| **#322** | Decision C corrected carry (`julius-carry.v2`). Only verified repair findings and accepted decisions travel; every exclusion is recorded by code; four-point proof | base `main` | green |
| **#326** | C on the **paid venue**: a WITH arm learns from its pair's verified evidence bundle (`carryFrom`, input `carry_source_run`, `verify-carry`, `carry-export.json`, `carry.tsv`) | on #322 | green (6/6) |
| **#331** | C **option B prepared, not chosen**: the reviewer names each finding's kind, a contract may promote kinds (`promotedWarningCategories`), and the bundle records each warning's kind (`review-warnings.tsv`). Rehearsed on real PostgreSQL: a promoting WITHOUT arm teaches a WITH arm; its control is refused for free. The four frozen missions' binding digests are pinned and unchanged | on #326 | green (6/6) |
| **#324** | 031+032 (+033) migration window tooling (`docs/julius-migrations/window/`) and its Docker rehearsal records | base `relay/julius-13i-completion-r2` | n/a |
| **#323** | Wonderland social backend and privacy wall P1–P5, migration **033** | on #321 | green |
| **#325** | Wonderland voice/EOS: rooms are cliques of mutual visibility, PUID binding, **035 staged** behind 034 | on #323 | green |
| **#328** | Wonderland social display names: the verified GitHub login is recorded at sign-in, and a nameless request never erases it | on #325 | green |
| **#330** | Wonderland presence is a **lease**: a presence not refreshed for 120 s is absent everywhere (reads and decisions), a stale heartbeat is `NOT_IN_INSTANCE`, and the next live heartbeat moves live players out of a departed player's voice room | on #328 | green (6/6) |
| **#327** | Wonderland R16 harness: 24 closed-list checks over HTTP against the real bridge **process**. The scenario keeps the heartbeat, and LEASE fails on a lapse. The restart check is split: DURABLE as stored, then RECONNECT (HELD/REENTERED), then PRESENCE | **restacked on #330** (it must sit above every product change) | green (6/6) on the restacked head |
| **#332** | Wonderland **hosted store**: `relay-bridge/wonderland-store.ts` (`inspect`/`bootstrap`) brings the bridge's store from nothing to migrated on a record and REFUSES every database it did not create (the permanent store's case included). `GET /relay-api/wonderland/readiness` (operator only) reports the store as facts. Rehearsed on real PostgreSQL through the real bridge process and the whole R16 scenario | on #327 | green (6/6) |
| **#333** | Julius **local qualification reliability**, three fixes. `migrate()` serialises itself under a session advisory lock (`WONDERLAND_MIGRATION_LOCK`): 7 of 8 concurrent migrators of an EMPTY store used to be refused. The login-probe test clears the probe's own override table (`CLAUDE_AUTH_PROVIDER_OVERRIDES`). The drill suite drops the two databases it used to leak every run. The full suite against ONE fresh database, every real-PG suite live: 13,783 passed, 0 failed | base `main` | green (6/6) at `62a78d5d` |
| **#334** | Wonderland **R16 venue**. The bridge reports, operator-only, the commit its platform attests (`RAILWAY_GIT_COMMIT_SHA`, nothing else believed) and a boot id per start. Every R16 run is judged **HOSTED_FINAL** or **REHEARSAL** (19 named reasons) apart from its checks; `--final` refuses a rehearsal. The verify phase gains a **RESTART** check (boot id changed), which found that #327's own CLI test never restarted | on #332 | green (6/6) |
| **#336** | Wonderland **deploy check** (`scripts/wonderland-deploy-check.mjs`): by reads alone, the hosted bridge is the expected build (attested commit), production-gated, ready (store, social) and closed (health says only ok, report operator-only, foreign origin refused). R16 is now rehearsed **under the production gates**: a bridge refusing pairing on the production branch only passed every R16 test before (7/7, measured) and fails now | on #334 | see the PR |
| **#335** | **[DO NOT MERGE] landing rehearsal**: all thirteen open PRs merged in material order on one head. One conflict, the generated `JULIUS_HARNESS_MANIFEST.md`. Full suite on it: 742 files, 14,154 passed, 0 failed | base `main` | CI only; close once it has spoken |

**Findings to act on:**
- **The social command route has no rate limit** (noted in #336). A signed-in player could flood friend requests or messages. What limits a hosted launch needs is a backend-correctness decision for SECOND Wonderland and the founder.
- **Landing order is clean (#335).** Every open PR composes on one head. Only two files are touched by more than one stack:
  - `JULIUS_HARNESS_MANIFEST.md` (Wonderland and C): **the second of those two stacks to land regenerates it** (`npm run julius:harness:export`);
  - `wonderland-postgres.ts` (Wonderland and #333): it auto-merges, and was read by hand.
- **C could not run on the paid venue.** Every paid job's database is fresh, so a WITH arm was always `CARRY_EMPTY`. #326 is the transport. Without it, no C pair can run.
- **#321 should fold a one-line test fix** in `julius-migration-031.real-postgres.test.ts`: `pool.on('error', () => undefined)` before `pool.end()`.
  - Without it, a terminated idle client (57P01) raised unhandled errors that failed `first-live-topology (executor-private)` on a stacked PR.
  - The fix was proven on #323 as `0873f6e2`.
- **#321's migration-032 suite teardown can time out under CI load.** Its `afterAll` runs a plain `DROP DATABASE` per database, and each can wait up to about 5 s for terminated backends to exit, against the 10 s hook default.
  - Seen on #327's run 37237672139 with 219/219 tests passing.
  - Proposed one-line fix: give that `afterAll` an explicit timeout (e.g. `}, 90_000)`), next to the 031 fix above.
- **034 (Project Brain) has no spec in the repo.** The founder and SECOND must define it. 035's guard requires a `034_%` stamp.
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
| 027 | **reserved** for the integration lane (`project_execution_profiles`, `player_mission_contracts`) by agreement | not on any branch (see the code comment in `wonderland-postgres.ts`) |
| 029 | Project Brain v1 (`029_julius_project_brain.sql`) | landed in #309 |
| 030 | outbox stops re-reading its event (row 13 (i)) | landed in #313 |
| **031** | Julius 13 (i): run transition is a HOT update, plus task-claim work | #321 |
| **032** | repair of 030's orphan/outbox invariant (two orphan paths closed) | #321 |
| **033** | Wonderland social (15 `social_*` tables) | #323, stacked on #321; applied in the #324 window rehearsal only |
| **034** | Project Brain (the next Brain migration; 029 is already the first) | not on any branch; **no spec in the repo** |
| **035** | voice (`voice_identities`, history, issuances; never a token) | **staged** in #325 (`docs/julius-migrations/035/`); not in the chain until 034 exists |

- **`DATABASE_URL` stays PARKED** unless an explicit, reviewed live-store
  procedure says otherwise. No unlanded migration may touch the permanent store.
  A landed migration reaches the live store only through its reviewed apply
  procedure (`docs/julius-migrations/<nnn>/RUNBOOK.md`), never an ordinary
  `migrate()` entry point.
- **No migration gaps.** **OPEN QUESTION:** `main` already skips 027 (reserved,
  unlanded). Settle with the founder whether 027 lands before 033, or the
  reservation is released, before 033 takes its number.

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

### Open PRs (live GitHub, 2026-10-04)

- **#321**: above. The only active landing candidate.
- **#298**: `[DO NOT MERGE]` stack rehearsal, CI only.
- **#290–#297** (last touched 2026-09-29). Triaged 2026-10-04: **#290, #291 and
  #293–#297 are fully folded into `main`** by test title and content (via
  #301/#304/#305/#310/#311). Recommend closing; that is the founder's decision.
  Never merge them on their old evidence.
- **#322–#328**: see "Work in flight" above.
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

The **frozen 13 (i) rerun at #321's head `aeba8b2c`**: +0.467 is at stake. After
it come the apply rehearsal (cloud Docker rehearsal recorded in #324) and SECOND's
verdict; then #321 lands. C (+1.10) is the next score-bearing work, after 033–035.
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
