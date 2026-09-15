# Project Brain v2 → live Julius: the integration plan

Status: **PLAN. Nothing here is wired.** Each step starts only after the
continuous-worker qualification gate has passed, and lands as its own logical,
proven commit. Nothing is merged to `main` while the qualification ceremony
is active.

> Project Brain remembers. Julius acts and decides. Python computes. GVE
> proves. GVE is not built by any step below.

Function names are the anchors. Line numbers drift, so find each seam by name
at rebase time.

## Where the Brain lives (decided 2026-09-15)

**A dedicated persistent PostgreSQL**, never the Julius runtime database. The
architecture, the three separated persistence concerns, and the infrastructure
and security contract are in `docs/JULIUS_BRAIN_PERSISTENCE.md`. The
self-verifying export is backup, portability and disaster recovery. As a
**temporary** carry between disposable jobs it is approved only until the
database exists.

## What landing the branch alone would change

**Nothing in any runtime database.** The Brain has its own schema and migration
chain, and `wonderland-postgres.ts` is byte-identical to base. The runtime
chain creates no Brain table (held by a static test). Brain tables exist only
where `migrateJuliusBrainDatabase` is run against a dedicated database.

## Step 0 — refresh

1. `git fetch origin --prune`, then rebase `local/project-brain-python` onto the
   trusted `main`.
2. Regenerate `JULIUS_HARNESS_MANIFEST.md` (`npm run julius:harness:export`).
   The manifest is generated, so it conflicts on every rebase.
3. `julius-brain-contracts.ts` imports types from `julius-memory-trust.ts`, a
   file sliced into paid missions. If a mission changed those types, fix the
   Brain side, never that file.
4. **Proof:** the focused Brain, Python, SDK and flow suites; the real-PostgreSQL
   Brain, Python, archive and binding tests; the harness gate; the four-pass
   typecheck; the repository boundary scanner.

## Step 0.5 — the production Brain database proposal (a gate)

Before any live wiring, return to the founder with a concrete deployment
proposal that satisfies every item of the contract in
`docs/JULIUS_BRAIN_PERSISTENCE.md`:

- placement, authentication, credential scoping;
- network boundary, encryption, backup, restore;
- migrations, pooling, failure behaviour;
- controlled service vs direct access;
- development isolation, operational complexity.

No vendor is chosen before the contract is agreed. The proposal must also pass
that document's acceptance tests before step 1 goes live.

**The Brain service is part of that proposal.** GitHub-hosted runners never hold
a Brain database credential, so a live Julius run reaches the Brain through a
controlled service that verifies GitHub OIDC tokens and issues run-scoped
sessions. The binding is store-agnostic, but **the remote contract is not the
raw `JuliusBrainStore`**. A client that could name any principal or read any
entity would carry governance out of the service. The service must:

- **bind principals server-side:** the session's run, and the principals that
  run may act as;
- **apply state-mode selection server-side**, so retrieval authority holds even
  against a faulty client;
- **expose handle-level operations:** bootstrap, commit as a session principal,
  mode-selected context, seal, resume, archive import.

**The access contract already exists, locally and proven:**
`julius-brain-access.ts`. The proposal decides where it runs and how it is
deployed, not what it enforces.

## Step 1 — Brain persistence and bootstrap

**Seam: `relay-bridge/julius-live-mission.ts` `main()`**, using the prepared
`createLiveJuliusProjectBrainBinding` (`relay-bridge/julius/project-brain-binding.ts`).

- **Construct the Brain client.** Normally this is the remote client of the
  Brain service, authenticated with the job's OIDC token. The binding gets:
  - `runs`: the runtime store, the run's own authority;
  - `brainRunIdFor`: `workflow:<GITHUB_RUN_ID>/<GITHUB_RUN_ATTEMPT>`. This is
    **required, with no default**. The Julius run id repeats across attempts
    of one mission contract. The Brain run id is the identity every mirrored
    record, typed-context selection and state-mode policy uses, and it is the
    same identity the archive importer uses;
  - `legacyEntries`: `readJuliusLegacyBrainAppends(runtimePool, …)`;
  - `onReport`: writes into the run's timeline and evidence.
- **Call `binding.bootstrap({ runId })` after `bootstrap.submit`.** The answer
  decides whether the run may start:
  - READY: proceed.
  - REFUSED (the Brain does not verify) or UNAVAILABLE: proceed only when
    `proceed` is true, meaning a FRESH run, which the Brain only adds to. A
    CONTINUATION, LEARNING or REGRESSION run refuses to start.
  - After a non-READY answer the binding is detached.
- **At the end of the run:** call `binding.seal({ runId })`. It records how
  many of the run's v1 entries the Brain holds with the right content, then
  checkpoints, and returns the preservation **derived from the Brain**:
  PRESERVED, PARTIALLY_PRESERVED or NOT_PRESERVED, with reasons. Record that in
  the run's evidence. **Never report the run as preserved unless the derived
  status says so.** An unreadable Brain is UNREADABLE, never PRESERVED.
- **Preflight:** `assertJuliusBrainDatabase(production)` runs **in the Brain
  service**, over TLS. Runner preflight checks the service's health and its own
  OIDC exchange, not a database.
- **Harness:** remove each file that becomes reachable from
  `DECLARED_NOT_COMPOSED`, and regenerate.

**Only if live wiring must precede the database — the temporary carry:**

- The job runs a Brain in its **own disposable dedicated database**. That is a
  second database in the job's container, never the runtime database.
- It follows the carry journal (`julius-brain-carry.ts`):
  1. Open the prior sealed carry against the rollback floor.
  2. Restore.
  3. Run.
  4. Checkpoint and export.
  5. Seal.
  6. Verify the read-back.
  7. Upload.
  8. Confirm the stored digest.
- Disposable state is destroyed only when the journal says preserved.
- The rollback floor and the carry key live where jobs cannot rewrite them.
- This is removed from the live path when the database exists.

**Proof:**
- Bootstrap twice: `created: true`, then VERIFIED with `created: false`.
- A tampered head is refused.
- The unavailability rules hold: FRESH proceeds unpreserved, CONTINUATION
  refuses.
- `npm run julius:brain:drill` against a dedicated database.
- The deployment acceptance tests in `JULIUS_BRAIN_PERSISTENCE.md`.

## Step 2 — mirror live writes, import paid history

**Live writes.** In the entrypoint, before `createContextAndClaimHandoffs`,
build `{ ...baseStore, appendBrainEntry: binding.wrapWriter(baseStore).appendBrainEntry }`.
The spread keeps `timeline`, so the ledger-bound check still sees it.

- Do not wrap inside `postgres-store.ts`: the recovery drill uses that module
  directly.
- The prepared wrapper normalises each append to the table's shape, so the
  mirror and the backfill never conflict (proven on PostgreSQL).

**Paid history** follows "Migrating paid history into the Brain" in
`JULIUS_PROJECT_BRAIN_V2.md`:

1. Write the adapter from the Formal lane's **final** archive tables to
   `julius-paid-run-archive-export.v1`, read-only against `julius-postgres`.
   Coordinate its shape with the Formal lane when they freeze the archive.
2. Seal, then import one attempt per commit. Imports go **through the Brain
   service**, never from a runner holding a database credential. The import
   derives the attempt's preservation first:
   - a preserved attempt is refused;
   - a partially preserved one is **reconciled**: what the live mirror recorded
     is linked, not recorded again;
   - one never preserved is **reconstructed**.

   A history that contradicts the live run is refused. The mirror/recovery
   rule below is now built and proven
   (`julius-brain-archive-reconciliation.test.ts`).

   **The mirror/recovery rule (accepted 2026-09-15, built and proven).** One
   workflow attempt never reaches the Brain as two representations, even though
   the live mirror writes `legacy:<attempt>:…` and the import writes
   `archive:<attempt>:…`.
   - **Refusals:** a fully preserved attempt is refused. A history that
     contradicts the live run (mission, Julius run, accepted main, unlisted
     live entries, seal count) is refused.
   - **Reconciliation:** a partial attempt is reconciled. Live v1 entries and
     verification decisions are matched deterministically and linked, not
     recorded again.
   - **Guarantees:** every recovery is recorded as a RECOVERY trace. A repeat is
     a no-op. A commit guarded by the attempt's record count re-plans if the
     attempt changed in between.
3. Run `verifyJuliusBrainLedger`.
4. Re-import: expect `ALREADY_IMPORTED`.
5. Reconcile `accounting` against the paid-run ledger.

**Proof:**
- The recovery, failure-recovery and repair-loop capability drills pass with the
  mirror wired, and report zero `FAILED` mirrors.
- **Persisted worker context snapshots are byte-identical with and without the
  mirror.** The mirror writes and never reads.
- Every imported run verifies.

## Step 3 — worker context from the Brain

**Seam:** hand `binding.wrapContextReader(store)` in place of
`brainEntriesForRun` to the context wrapper in the entrypoint. This does **not**
touch `compileJuliusContext`, `julius-context-snapshot.ts` or
`julius-context-integrity.ts`: typed entries arrive as ordinary v1 entries, after
v1's own.

**State mode, per run:**

- An optional `stateMode` clause in the live Mission Contract, parsed in
  `julius-live-mission.ts`. Absent means **FRESH**, which is today's semantics
  (v1 context is run-scoped).
- The contract digest skips absent keys, so existing contracts keep their
  idempotency keys.
- Qualification and lab evaluations run FRESH. LEARNING and CONTINUATION must
  name their runs.

**This step changes behaviour.** Once typed entries exist, context contents
change, and so do their hashes. The risks are:

- **Findings can be pushed out.** The pipeline appends findings after brain
  entries and refuses a repair dispatch whose findings were dropped. Typed
  context has its own per-role budget (default 4,000 of the 24,000 characters).
  Prove it with the repair-loop drill at the largest v1 context. If findings
  can be displaced, lower the typed budget. Raising the total is a separate
  decision.
- **Authority can be truncated.** Typed context is withheld whole and reported
  when the budget would cut authority. It is never partial.

**Proof:**
- A lab FRESH run over a Brain holding imported paid history.
- `CONTEXT` reports show `excluded.PRIOR_RUN_STATE > 0`.
- **No persisted context snapshot contains `archive:`.**
- A LEARNING clause admits exactly what it names.

## Step 4 — evidence, evals, provenance

**Seam:** decorate the store's result, finding and decision writers in the
entrypoint, the same pattern as the mirror. Each decorator maps to typed
records:

| Live write | Typed record |
|---|---|
| Evidence | EVIDENCE, **UNVERIFIED** until the reviewer's decision |
| Finding | FINDING, with severity when known, else `UNKNOWN` |
| Decision | DECISION `VERIFICATION` |

Provenance is `run_observed`, with the accepted commit and the executor receipt
ids.

- **Avoid `julius-memory-trust.ts`.** It is unimplemented stubs and a
  paid-mission target.
- **Not built yet:** these decorators. They must be designed against the real
  row shapes at rebase time, not guessed now.

**Proof:**
- A completed lab run's Brain export holds its evidence, findings and decisions
  with receipts.
- The ledger verifies.
- The Coding Agent cannot verify its own evidence (policy suite).
- No write is refused for credential content.

## Step 5 — continuation and resume

- **Start:** `binding.bootstrap` already verifies the ledger and the last
  checkpoint.
- **End of drive:** call `binding.seal({ runId })` after
  `driveJuliusRunToTerminal` (step 1).
- **Across paid runs:** nothing extra. The Brain is in its durable database and
  the runtime database is disposable. Only while the temporary carry is in use
  does a job restore and re-export, per the carry journal (step 1).
- **CONTINUATION** is a `stateMode` clause naming `resumes`. The resumed runs
  must exist in the Brain.

**Proof:**
- The existing recovery drill kills the entrypoint mid-drive. On restart,
  bootstrap is VERIFIED, the drive resumes, and the next checkpoint re-derives.
- A tampered restore bundle is refused.

## Step 6 — `python.run` exposure

**Blocked on the isolation proof** (`JULIUS_PYTHON_ISOLATION_DESIGN.md`,
items 1–17). The host runner never serves live Julius.

- **Runner:** `ContainerJuliusPythonRunner` through the executor control plane.
- **Registration:** register `python.run` in the tool id union, the envelope,
  the registry and `allowedTools`.
- **Exposure:** a bridge-side mediator, the same pattern as the research
  mediator, so the pipeline is not edited unless the post-qualification lane
  explicitly permits it.
- **Startup:** call `recoverDisconnected()`.
- **Run identity:** a Python request's `runId`, and its state-mode policy, carry
  the **Brain** run id (workflow run and attempt), never the Julius run id.

**Proof:**
- The isolation proof in real-infra evals.
- The Brain + Python flow drill against the container runner.

## Step 7 — C.A.R.D. authorisation

- **Today, every `python.run` is DENIED**, because the live card grants only
  plan, implement and review. That is the correct inert state.
- **Grant per mission:** `python` and `process`, plus `secret:<id>` per secret.
  Seal the grant as `researchPolicyFor` does, and bump
  `RELAY_JULIUS_CARD_REVISION`.
- **Network:** DENY only. The card's boolean becomes a scoped egress grant and
  replaces the hard-coded DENY in `executor-effects.ts` only once the egress
  proxy and proof item 18 exist.

**Proof:**
- A missing capability settles DENIED and is recorded.
- The card revision is on every `PYTHON_EXECUTION`.

## Step 8 — the live budget ledger

- **Build `createRunSpendBudget` in the entrypoint**, not inside
  `assembleLiveJuliusRuntime`. Pass it to both the runtime and the Python
  service.
- **Gap:** that ledger counts USD only. A Python execution reserves 0 USD plus
  tool calls and runtime, so today it can never be denied.
  - Add tool-call and runtime dimensions.
  - Rebuild from durable rows, `budget.reserved` and `budget.settled`, plus the
    executor's `budget_reservations`.
  - Retire the in-process ledger debt.

**Proof:**
- An execution beyond the tool-call budget is DENIED.
- A restart does not re-spend.

## Step 9 — bridge API routes

`relay-bridge/server.ts` mounts no Julius routes and holds no pool. Mount
`handleJuliusBrainApi` in the Brain service (the bridge, if the proposal places
the service there). Its pool is the Brain database's **service role** over TLS.
Read routes answer "unavailable" when the database is down, never empty data.

**⚠ Naming:** `brainStore` is already Relay's v1 `BrainMemoryStore`. Name the
new dependency `juliusProjectBrain`.

| Route | Auth |
|---|---|
| export, context, create/revise/retire, archive import, restore, Python execute/cancel | operator `Bearer` only |
| surface, overview, entity, history, provenance | browser `Relay-Session`, read-only, project-scoped |

`RELAY_BRIDGE_API_TOKEN` never reaches a browser. The export is always the
redacting export.

**Proof:**
- A session cannot mutate.
- Another project's entity is not found.
- The export route redacts.
- The bundle scan finds no credential names.

## Step 10 — full durability and security regression

Add to `julius-real-infra.yml` (none of these run in any workflow today):

- `npm run julius:brain:drill`
- `npm run julius:brain:python-drill`
- `scripts/julius-brain-archive-postgres.test.ts`
- `scripts/julius-brain-live-binding-postgres.test.ts`
- `scripts/julius-brain-database-postgres.test.ts`, which needs a TLS-enabled
  server
- `scripts/julius-brain-roles-postgres.test.ts`
- the deployment acceptance tests (OIDC policy, network probe, restore drills,
  unavailability drill)
- the Python isolation proof
- `relay:persistence:recovery-drill`

Then run the full gate in `CLAUDE.md`, and one founder PR per the batch cadence,
with logical commits.

## What is blocked, and on what

| Work | Blocked on |
|---|---|
| Rebase, landing, every step above | the continuous-worker qualification gate |
| Live Brain wiring (step 1) | the production database proposal (step 0.5) being accepted, and its acceptance tests |
| The Brain service with OIDC and server-side governance | the proposal: where it runs, the protected environment |
| The paid-history adapter (step 2) | the Formal lane's archive schema becoming final |
| Typed evidence decorators (step 4) | the rebase, so they are written against current row shapes |
| Building the container Python runner (step 6) | the qualification gate, because it changes the executor image, script and adapter the qualification runtime uses |
| Exposing `python.run` (steps 6–7) | the isolation proof |
| `ALLOWLIST` network | the egress proxy and proof item 18 |
