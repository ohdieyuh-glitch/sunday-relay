# Project Brain v2 → live Julius: the integration plan

Status: **PLAN. Nothing here is wired.** Each step starts only after the
continuous-worker qualification gate has passed, and lands as its own logical,
proven commit. Nothing is merged to `main` while the qualification ceremony
is active.

> Project Brain remembers. Julius acts and decides. Python computes. GVE
> proves. GVE is not built by any step below.

Function names are the anchors. Line numbers drift, so find each seam by name
at rebase time.

## What landing the branch alone would change

Nothing is composed. **But migrations 024 and 025 are registered in
`WONDERLAND_MIGRATIONS`**, and the live entrypoint calls `migrate()`, so every
live database would gain the Brain and Python tables. They would be empty and
unreferenced. It is still a schema change to the qualification runtime, so it
too waits for the gate.

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

## Step 1 — Brain persistence and bootstrap

**Seam: `relay-bridge/julius-live-mission.ts` `main()`**, using the prepared
`createLiveJuliusProjectBrainBinding` (`relay-bridge/julius/project-brain-binding.ts`).

- **Construct** `JuliusBrainPostgresStore(pool)` right after the pool is created
  and migrated. Then build the binding:
  - `runs` is the runtime store;
  - `legacyEntries` is `readJuliusLegacyBrainAppends(pool, …)`;
  - `onReport` writes into the run's timeline and evidence.
- **Call `binding.bootstrap({ runId })` after `bootstrap.submit`.**
  `julius_brains.project_id` references the project row the seed creates.
  `REFUSED` (ledger or checkpoint does not verify) refuses the start, the same
  way the ledger-bound check does.
- **Preflight** (`scripts/julius-live-preflight.ts`): add the Brain and Python
  tables to its required-tables list.
- **Harness:** remove each file that becomes reachable from
  `DECLARED_NOT_COMPOSED`, and regenerate.

**⚠ Decision needed first: where the Brain lives.** The paid-run database is a
per-job container, deleted at cleanup. A Brain inside it is lost after every
run. Two options:

| Option | Shape | Trade-off |
|---|---|---|
| **A. Carry** | export at cleanup (`exportJuliusBrain`) as a workflow artifact; `restoreJuliusBrainFromExport` + bundle hash check before bootstrap | no new infrastructure; artifacts expire; one lane at a time |
| **B. Durable home** | a persistent PostgreSQL for the Brain; the rest of the live runtime stays per-job | the Brain is actually durable; one more secret and service |

**Recommendation:** B is the authority. A can serve as the bridge until B
exists. The binding takes a store, so either option works without changing it.

**Proof:**
- Bootstrap twice: `created: true`, then VERIFIED with `created: false`.
- A tampered head is refused.
- `npm run julius:brain:drill` in real-infra.
- Preflight identity passes.

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
2. Seal, then import one run per commit.
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
- **End of drive:** call `binding.checkpoint(label)` after
  `driveJuliusRunToTerminal`.
- **Across paid runs:** under option A, export at cleanup (next to the evidence
  upload) and restore before bootstrap. Under option B, nothing extra.
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

`relay-bridge/server.ts` mounts no Julius routes and holds no pool. Add a pool
dependency and a route block for `handleJuliusBrainApi`.

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
- the Python isolation proof
- `relay:persistence:recovery-drill`

Then run the full gate in `CLAUDE.md`, and one founder PR per the batch cadence,
with logical commits.

## What is blocked, and on what

| Work | Blocked on |
|---|---|
| Rebase, landing, every step above | the continuous-worker qualification gate |
| Where the Brain lives (step 1) | a founder decision: carry or durable home |
| The paid-history adapter (step 2) | the Formal lane's archive schema becoming final |
| Typed evidence decorators (step 4) | the rebase, so they are written against current row shapes |
| Building the container Python runner (step 6) | the qualification gate, because it changes the executor image, script and adapter the qualification runtime uses |
| Exposing `python.run` (steps 6–7) | the isolation proof |
| `ALLOWLIST` network | the egress proxy and proof item 18 |
