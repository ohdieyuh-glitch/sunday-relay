# Project Brain persistence: the architecture and the production database contract

**Status**

- **Architecture:** decided by the founder on 2026-09-15.
- **Security contract:** drafted here, with **no vendor chosen**.
- **Deployment proposal:** due after the continuous-worker qualification passes,
  and before any live wiring. It must satisfy this contract.

> Project Brain remembers. Julius acts and decides. Python computes. GVE
> proves. **PostgreSQL persists. Exports carry and recover.**

## The decision

```
LIVE JULIUS ──▶ PROJECT BRAIN ──▶ DEDICATED PERSISTENT POSTGRESQL        (canonical)

PAID GITHUB RUN ──▶ redacted paid-run archive artifact ──▶ temporary archive importer
                ──▶ Project Brain typed import boundary ──▶ dedicated Brain PostgreSQL

PROJECT BRAIN ──▶ self-verifying export ──▶ backup · portability · disaster recovery
                                            · TEMPORARY carry between disposable jobs
```

**Three rules frame the rest:**
- **The laptop instance stays private.** The development database
  (`project-brain-postgres`, `127.0.0.1:5442`) stays a development and proof
  instance. It is never made reachable from outside the machine, and no
  authentication or firewall setting is weakened for GitHub-hosted runners.
- **Exports are not primary storage.** They carry and recover. The canonical
  live database is PostgreSQL.
- **Storage never grants retrieval.** A record can exist in PostgreSQL forever
  and be invisible to a FRESH mission. FRESH, CONTINUATION, LEARNING and
  REGRESSION are unchanged, and nothing about persistence weakens them.

## Three persistence concerns, kept apart

| Concern | What it is | Owner | Storage | Lifetime | Authority |
|---|---|---|---|---|---|
| **Project Brain** | canonical mission, state, evidence and provenance memory | Julius | dedicated persistent PostgreSQL (`julius_brain` schema) | permanent | the ledger is the truth |
| **Paid-run archive** | temporary holding area for real paid-run evidence until imported | the Formal lane | the Formal lane's own schema | until imported | none over the Brain. The Brain reads only `julius-paid-run-archive-export.v1`, never the archive's schema |
| **Brain export** | portable, self-verifying representation | Julius | files and object storage | per purpose (backup retention, one carry hop) | none. A copy that must verify before it is believed |

The Julius **runtime** database (`relay_wonderland`) is a fourth thing again. It
is disposable in a paid run, and it never holds the Brain.

## What is already built and proven (non-live, local branch)

| Property | Where | Proof |
|---|---|---|
| **Dedicated.** The Brain has its own schema and migration chain. A database holding the runtime schema is refused for migration and for use. The runtime chain creates no Brain table. | `julius-brain-database.ts`, `julius-brain-migrations/` | `julius-brain-migration-chain.test.ts`; `scripts/julius-brain-database-postgres.test.ts` |
| **Identified.** The environment (development, test, production) is fixed at first migration. Every open names the environment it expects, so development configuration cannot open production. | `migrateJuliusBrainDatabase`, `assertJuliusBrainDatabase` | same |
| **Encrypted.** Production refuses an unencrypted connection, for migration and for use, with no opt-out. | same | same, against a TLS-enabled server |
| **Current.** Pending migrations are refused on use. A database migrated by newer code is refused. Migration runs under an advisory lock. | same | same, including five processes migrating at once |
| **Immutable.** The database itself refuses UPDATE, DELETE and TRUNCATE of records, links and artifact bytes. Brains, entities, executions and projects are never deleted. A head never rolls back, and an identity never changes. | migration `004_julius_brain_immutability` | same |
| **Least privilege.** The owner migrates. The service appends and advances heads, and cannot delete, rewrite, disable the guard or migrate. The reader only reads. | `julius-brain-roles.ts` | `scripts/julius-brain-roles-postgres.test.ts`, which runs the whole Brain + Python flow as the service role |
| **Artifact bytes are as durable as their records.** | `julius_brain.content`, `PostgresJuliusBrainContentStore` | database test: dedupe, in-place tamper refused, corruption refused on read |
| **Unavailability has a defined answer.** A FRESH run proceeds, unpreserved. A run that needs prior state does not start. The binding detaches, and *preserved* is claimed only when true. | `relay-bridge/julius/project-brain-binding.ts` | `project-brain-binding.test.ts` |
| **The temporary carry.** An HMAC-sealed, lineage-checked export with its artifact bytes, plus a journal that permits destroying disposable state only after upload is confirmed. | `julius-brain-carry.ts` | `julius-brain-carry.test.ts` |

Connection strings stay separate. The Brain uses `JULIUS_BRAIN_DATABASE_URL`;
the runtime keeps `DATABASE_URL`.

## Temporary transition: the carry

This path is used only if live Brain wiring is needed before the durable
database exists.

1. Job start: obtain the prior sealed carry. Only an explicitly authorised
   genesis may start without one.
2. `openJuliusBrainCarry` checks, in order:
   - the seal;
   - environment and Brain identity;
   - the rollback floor;
   - the bundle hash, ledger and state hash;
   - lineage;
   - the exact artifact-byte manifest.
3. `restoreJuliusBrainFromExport` into the job's disposable database, then
   verify.
4. Execute.
5. Checkpoint, export, then `sealJuliusBrainCarry`. Only a restorable bundle
   with every byte it names is sealed.
6. Verify the export: read back what was written and open it exactly as the next
   job will.
7. Upload. Confirm against the digest the store reports for what it now holds.
8. **Only now** is the Brain preserved, and only now may disposable state be
   destroyed.

If export, verification or upload fails, the journal ends NOT preserved and says
why.

**Stated limits:**
- The symmetric seal proves possession of the key, not which job used it.
- Without a durable pointer, "the newest carry" is whatever the opener is told.
  The rollback floor must come from somewhere the jobs cannot rewrite.

Nothing permanent depends on artifact retention. The carry is removed from the
live path when the durable database is in service.

---

## The production database: infrastructure and security contract

Each item states what the deployment **must** do, what the code **already
enforces**, and what the proposal must **decide**.

### 1. Where it runs

**Must:**
- A PostgreSQL service designed for persistent remote access, not a laptop.
- PostgreSQL 16, the version tested; 15 or later is acceptable.
- `plpgsql` triggers.
- Roles and grants the operator controls.
- Encryption at rest.
- Continuous backup with point-in-time recovery.
- Private network reachability from the Brain service.

**Already enforced:** none of this can be enforced from code, except that
production refuses unencrypted connections.

**Decide:** the placement, evaluated against this contract rather than
convenience. The candidate shapes are:

- managed PostgreSQL on the same private network as the Brain service;
- a dedicated managed PostgreSQL provider reached over private link or
  allowlisted TLS;
- self-managed PostgreSQL on a VM.

**Criteria:**
- private networking;
- TLS with a verifiable CA;
- PITR and its retention;
- encryption at rest;
- non-superuser role management;
- trigger support;
- off-provider logical export;
- region;
- availability SLA;
- cost;
- operator burden;
- exit path.

### 2. How Julius authenticates

**Must:** **no GitHub-hosted runner holds a Brain database credential.**
Julius, wherever it runs, reaches the Brain through a **controlled Brain
service** (see item 11). The service authenticates callers:

- **A live Julius run in GitHub Actions** presents a **GitHub Actions OIDC token**.
  The service verifies:
  - signature, issuer and expiry;
  - an audience dedicated to the Brain;
  - `repository_id` and `repository_owner_id`, which survive renames;
  - `workflow_ref` (or `job_workflow_ref`) pinned to the paid workflow on
    `refs/heads/main`;
  - `ref`, `event_name` (pull-request events refused outright), and the
    protected `environment`;
  - `run_id` and `run_attempt`.

  It then issues a **run-scoped session**: one project, one mission, one run,
  the Julius write grant for that run, and an expiry no later than the job
  timeout.
- **Operators** use the bridge's existing operator credential. It never reaches
  a browser.
- **Browsers** use `Relay-Session`: read-only and project-scoped.

The service authenticates to PostgreSQL as the **service role** over TLS with
server verification, using a credential held only in the service's secret store.

**Decide:**
- where the Brain service runs: inside the existing bridge process, or as its
  own process;
- the protected environment's name and approval rules.

### 3. How credentials are scoped

**Must:**

| Role | Held by | May | May not |
|---|---|---|---|
| owner | the migration step only | DDL on `julius_brain`, run migrations | be used by any running service |
| service | the Brain service | the grants in `juliusBrainRoleGrants` | DELETE, TRUNCATE, DDL, disable triggers, migrate, change identity |
| reader | exports, backup verification, inspection | SELECT | write |

- **Per-role timeouts:** `statement_timeout`, `lock_timeout` and
  `idle_in_transaction_session_timeout` are set on each role.
- **Rotation:** credentials are rotated on a schedule and on suspicion.
- **No sharing:** no person's credential is shared with a service.
- **No carry-over:** no production credential is ever on a development machine.

**Already enforced:** the grants, proven against a real non-owner role running
the whole flow; immutability triggers that hold against that role.

**Decide:** the rotation interval and mechanism.

### 4. Network boundary

**Must:**
- The database accepts connections **only** from the Brain service, the
  migration step and the backup system.
- There is no public listener, or a listener allowlisted to exactly those
  sources.
- GitHub-hosted runners reach **only** the Brain service, over HTTPS.
- Port 5442 on the laptop is never exposed.

**Proof:** an external probe shows the database port is unreachable from the
public internet.

**Decide:** private link vs. allowlist, according to the placement chosen in
item 1.

### 5. Encryption in transit (and at rest)

**Must:**
- **Service ↔ database:** TLS 1.2 or later, preferably 1.3. The server is
  verified against a pinned CA and hostname (`verify-full` semantics).
- **Runner ↔ service:** HTTPS.
- **At rest:** the provider encrypts storage. Backups and exports are encrypted
  wherever they rest.
- **No secrets in the Brain:** credential-shaped content is refused on write
  (existing).

**Already enforced:** production refuses a connection that negotiated no TLS,
for migration and use alike. Verifying the server's identity is connection
configuration, which the proposal must specify.

### 6. Backup strategy

**Must:** two independent layers.

1. **Physical:** provider PITR with WAL archiving. The retention window is to
   be decided (30 days proposed).
2. **Logical:**
   - A scheduled self-verifying export of every Brain, plus its artifact bytes,
     taken by the reader role.
   - Sealed under a **backup** key that is distinct from any carry key.
   - Stored in a **different account or provider**, with immutability (object
     lock) and its own retention.
   - Taken after every paid run, and daily.

Every logical backup is **verified by restoring it** into a scratch database on
a schedule: migrate, restore, resume VERIFIED, state hash equal. A backup that
has never been restored does not count as a backup.

**Decide:** RPO (proposed ≤ 5 minutes through PITR), the logical-export cadence,
and both retention windows.

### 7. Restore strategy

**Must:**
- **Never restore in place.** Restore into a **new** instance, verify it, then
  cut over, keeping the old instance read-only for a grace period.
- **From PITR:**
  1. Recover to a timestamp.
  2. Run `assertJuliusBrainDatabase`.
  3. Run `resumeJuliusBrain` for every Brain: all must be VERIFIED.
  4. Compare heads to the last known heads.
  5. Point the service at the new instance.
- **From a logical export:**
  1. `migrateJuliusBrainDatabase` on a fresh instance.
  2. `restoreJuliusBrainFromExport` per Brain. This refuses to merge into an
     existing Brain.
  3. Restore the artifact bytes.
  4. Resume VERIFIED.
  5. Cut over.
  6. State explicitly that the loss window is "since that export".
- **Restore drills:** quarterly, and whenever the backup system changes.

**Decide:** RTO (proposed ≤ 1 hour) and who may authorise a cutover.

### 8. Schema migrations

**Must:**
- Only the Brain's own chain applies.
- It runs as the owner, from a migration step that is **not** a GitHub-hosted
  paid run, **before** deploying code that needs it.
- Take a logical export first.
- Forward-only, over a direct (unpooled) connection, since the migration lock is
  a session advisory lock.
- Breaking changes are expand/contract across two releases.
- Running services never migrate; they assert.

**Already enforced:**
- one transaction per migration, each stamping its own version;
- an advisory lock;
- refusal of pending migrations on use;
- refusal of a database newer than the code;
- a static test holding the chain to `julius_brain`.

**Decide:** where the migration step runs, and who approves it.

### 9. Connection pooling

**Must:**
- **Pool size:** a small `pg` pool per service process. Commits serialise per
  Brain on the Brain row lock, so more connections than concurrent Brains buy
  nothing.
- **Connection budget:** the service's total must stay under the database's
  limit, with headroom for migration, backup and reader.
- **Transaction-mode pooler:** acceptable for the service. Each commit is one
  `BEGIN…COMMIT` on one checked-out client.
- **Migrations:** session advisory locks, so migrations bypass any pooler.
- **Timeouts:** per role, as in item 3.

**Decide:** whether a pooler is needed at all at the expected concurrency.

### 10. Failure behaviour when the Brain database is unavailable

**Must:**
- **Runs:**
  - A FRESH run proceeds on its own context **unpreserved**, and says so.
  - CONTINUATION, LEARNING and REGRESSION runs do not start.
  - A mirror failure never fails a mission, and is never silent.
  - An unpreserved run reaches the Brain later **through its paid-run archive
    import**.
- **`python.run`:** refused (settlement is one transaction with the Brain) with
  a truthful reason. It is never run without a place to settle.
- **Bridge read routes:** answer "unavailable", never empty data.
- **Service retries:** bounded, with jitter, on transient errors (connection
  refused, admin shutdown, serialisation or deadlock). Retries are safe because
  every write is idempotent by key.
- **Alerts** on unavailability and on unpreserved runs.

**Already enforced:** the binding's READY, REFUSED and UNAVAILABLE outcomes;
ADDITIVE vs REQUIRED; detach; `preservation()`.

**Not yet built:** service-level retry and circuit breaking; the
`python.run` unavailable reason; the routes' unavailable answer.

### 11. GitHub-hosted paid runs: direct or through a controlled service

**Must: through a controlled service. Direct connections are rejected.**

A direct connection would require all of the following, and each is refused:
- a database reachable from GitHub's large and changing address ranges, which
  cannot usefully be allowlisted;
- a long-lived database credential stored in GitHub secrets;
- SQL-level power in the runner, which bypasses the domain's principals, grants
  and policy (those run in whichever process holds the connection).

**Through the service:**
- Runners hold a short-lived OIDC token.
- The service holds the credential and runs governance **server-side**.
- Sessions are scoped to one run and expire.
- The database stays private.

**Archive imports** of paid-run artifacts run in the service, never in a runner
holding a database credential.

### 12. Local development stays isolated from production

**Must:**
- **Development databases:** the laptop instance and test databases carry
  `development` or `test` identity, and code configured for them refuses a
  `production` Brain.
- **Credentials:** production credentials never exist on development machines.
- **Connection strings:** `JULIUS_BRAIN_DATABASE_URL` is always separate from
  the runtime's `DATABASE_URL`.
- **Tests:** tests create throwaway databases and never touch a named one.
- **Staging:** any staging deployment is `test` identity, on its own instance.

**Already enforced:** identity refusal both ways; dedicated-database refusal;
drills write only to `JULIUS_BRAIN_DATABASE_URL`.

### 13. Estimated operational complexity

These are estimates, to be revised with the chosen placement.

| Component | Setup | Ongoing |
|---|---|---|
| Managed PostgreSQL with PITR and TLS | low: hours | low: alerts, version upgrades yearly |
| Roles, grants, timeouts, rotation | low: scripted from `juliusBrainRoleGrants` | low: quarterly rotation |
| Brain service with OIDC verification and run-scoped sessions | **moderate: the largest piece of new code**, 2–3 days including its security tests | low, but it is the component to review most carefully |
| Logical export, off-provider storage, scheduled restore verification | moderate: about a day | low: review drill results monthly |
| Migration step | low | per release |
| Monitoring: availability, unpreserved runs, backup and restore-drill success, connection saturation | low to moderate | low |

**Overall:** about 4–6 engineering days to set up and pass the acceptance tests
below, then a few hours a month. The main risks are the OIDC policy (a mistake
widens who may write) and the restore drill silently decaying. Both are covered
by acceptance tests.

## Acceptance tests the chosen deployment must pass before live wiring

1. **TLS:** over TLS with server verification,
   `assertJuliusBrainDatabase(production)` succeeds, and a plain connection is
   refused.
2. **Network:** the database port is unreachable from the public internet; the
   Brain service can reach it.
3. **Least privilege:** the least-privilege test runs against the deployment's
   real roles. The service role is not an owner, and every forbidden mutation is
   refused.
4. **OIDC policy:** each of these is refused:
   - a token from another repository, a non-main ref, another workflow, a
     pull-request event, or an unprotected environment;
   - an expired token;
   - a run-scoped session writing to another run.
5. **Restore:** a restore drill from PITR and from a logical export ends VERIFIED
   with equal state hashes.
6. **Unavailability drill:** with the database stopped, a FRESH run proceeds
   unpreserved, a CONTINUATION run refuses, and a later archive import brings
   the run in.
7. **Rotation:** credential rotation without downtime.
8. **Identity:** development configuration refuses the production Brain, and the
   reverse.

## Decisions the proposal will ask for

- The placement, from the item 1 criteria.
- Where the Brain service runs.
- RPO, RTO and retention windows.
- The protected environment and its approvers.
- A budget ceiling for the database and the backups.
