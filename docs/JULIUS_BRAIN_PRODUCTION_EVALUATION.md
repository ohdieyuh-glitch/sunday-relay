# Project Brain production: the evaluation matrix

**Status**

- **Vendor-neutral.** No vendor, product or provider is chosen or preferred here.
- **Use:** after the continuous-worker qualification passes, each concrete
  candidate deployment is scored against this matrix. The deployment proposal
  (`docs/JULIUS_BRAIN_PERSISTENCE.md`, "What the deployment proposal must
  contain") presents the filled-in matrix, and the founder decides.
- **Nothing is provisioned, deployed or wired.**

A **candidate** is a complete deployment: where the database runs, where the
Brain service runs, and how they are operated. Two candidates that share a
database but host the service differently are two candidates.

## How to score

- **MUST** rows are gates. One FAIL disqualifies the candidate, whatever else
  it scores.
- **SHOULD** rows are scored 0–3:
  - 0: absent;
  - 1: possible, with significant work or risk;
  - 2: supported, with ordinary work;
  - 3: supported and verified in a drill.
- **Every entry cites evidence.** Evidence is a drill output, a test run
  against the candidate, or the provider's own documentation for that exact
  feature and tier. A sales claim is not evidence. Where a check below has a
  command, running it is the evidence.
- **Unknown is scored Unknown**, never assumed to pass. A MUST that is Unknown
  blocks the proposal until it is known.

## Hard disqualifiers

A candidate is out if any of these holds:

1. A GitHub-hosted runner would need a database credential.
2. The database would listen publicly without an allowlist limited to the
   Brain service, the migration step and the backup system.
3. The service role would have to be a superuser or the schema owner. The
   immutability triggers hold only against a non-owner.
4. TLS to the database cannot verify the server (CA and hostname).
5. There is no point-in-time recovery, or no way to take a logical export out
   of the provider.
6. Production and development cannot be separated into distinct database
   identities.
7. The laptop instance (`127.0.0.1:5442`) would have to be exposed or weakened.

## A. Database

| # | Criterion | Level | How it is verified | What the code already needs or proves |
|---|---|---|---|---|
| A1 | PostgreSQL 15 or later (16 tested) | MUST | `SELECT version()` | migrations 001–006 |
| A2 | `plpgsql` triggers, including `BEFORE TRUNCATE` | MUST | migrate a scratch database | `004_julius_brain_immutability`, `006_julius_brain_access` |
| A3 | Non-owner roles the operator controls; no superuser needed at runtime | MUST | apply `juliusBrainRoleGrants`, run the roles test as that role | `scripts/julius-brain-roles-postgres.test.ts` |
| A4 | TLS with server verification (CA and hostname) | MUST | connect with verification on; a plain connection refused | `assertJuliusBrainDatabase(production)`; `scripts/julius-brain-failure-postgres.test.ts` (TLS) |
| A5 | `pg_stat_ssl` readable by the service role | MUST | `SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()` as the service role | the production TLS assertion reads it |
| A6 | Private reachability from the Brain service; no public listener, or an allowlist of exactly the service, migration step and backup system | MUST | an external probe from outside the network is refused | — |
| A7 | Encryption at rest, including backups | MUST | provider documentation for the tier | — |
| A8 | Point-in-time recovery, with a retention window that can meet the chosen RPO | MUST | a PITR restore into a new instance, then `resumeJuliusBrain` VERIFIED | restore procedure, persistence item 7 |
| A9 | Logical export out of the provider | MUST | `exportJuliusBrain` by the reader role, restored elsewhere | `restoreJuliusBrainFromExport` |
| A10 | Session and transaction advisory locks; `SELECT … FOR UPDATE`; `ON CONFLICT`; `jsonb` | MUST | the database, archive, access and failure tests against the candidate | migration lock, Brain row lock, audit append lock |
| A11 | Per-role `statement_timeout`, `lock_timeout`, `idle_in_transaction_session_timeout` | MUST | `ALTER ROLE … SET`, then observe 57014 and 55P03 | timeouts are classified NOT_APPLIED and retried once |
| A12 | Failover behaviour: how long writes fail, with which errors, and whether a failover can lose a committed transaction | MUST (known) | a failover drill during a commit loop; count lost acknowledged commits | 25006, 57P01 and connection loss are classified; an unknown outcome is reconciled, never assumed |
| A13 | Connection limit, and headroom for service, migration, backup and reader | SHOULD | provider limits for the tier | a small pool per service process suffices; commits serialise per Brain |
| A14 | A transaction-mode pooler, if one is used, leaves migrations on a direct connection | SHOULD | run the concurrent-migration test through the candidate's path | five processes migrating at once |
| A15 | Latency from the Brain service to the database | SHOULD | p50/p95 of a commit and a context read | — |
| A16 | Major-version upgrade path without restoring from an export | SHOULD | provider documentation, then a rehearsal | — |
| A17 | Administrative actions audited (a trigger disabled, a role altered) | SHOULD | provider audit log shows a test `ALTER TABLE … DISABLE TRIGGER` | the audit hash chain exposes a rewrite afterwards; this catches it when it happens |
| A18 | Region and data residency acceptable to the founder | SHOULD | stated | — |
| A19 | Exit path: a standard dump and restore elsewhere, without provider-specific features | SHOULD | restore a dump into a plain PostgreSQL | the schema uses no extension |

## B. Brain service

| # | Criterion | Level | How it is verified | What the code already needs or proves |
|---|---|---|---|---|
| B1 | Runs Node.js 22 with outbound HTTPS to GitHub's OIDC issuer keys | MUST | deploy, fetch the issuer's JWKS | `verifyJuliusBrainOidcToken` |
| B2 | An HTTPS endpoint GitHub-hosted runners can reach, while the database stays private | MUST | a runner reaches the service; the same runner cannot reach the database | — |
| B3 | The database credential lives only in the service's secret store | MUST | inspect runner environment and workflow: no credential | — |
| B4 | Access state is durable: token claims, registrations, sessions and audit in the Brain database | MUST | migration 006 applied; restart the service mid-session | `scripts/julius-brain-access-postgres.test.ts` |
| B5 | Every refusal in the security suite holds against the deployed service | MUST | run the suite's cases over the service's transport | `julius-brain-access-security.test.ts` |
| B6 | The service refuses to start against a database of another environment | MUST | point a production service at a test database | the binding check in `createJuliusBrainAccessService` |
| B7 | Clock synchronised; skew stays inside 60 seconds | MUST | host documentation, then a drift check | token time checks allow 60 seconds |
| B8 | JWKS fetched and cached with key rotation handled (unknown key id refreshes once, then refuses) | MUST | rotate a test issuer key | not yet built: key fetching is deployment |
| B9 | Audit head anchored outside the database on a schedule | SHOULD | compare the anchored head with `verifyJuliusBrainAuditChain` | truncation of the newest audit events is caught only against an anchor |
| B10 | Rate limits per workflow run and per source | SHOULD | exceed them in a test | — |
| B11 | Request size limits and bounded batch sizes | SHOULD | send an oversized write | archive import commits in groups of 400 drafts |
| B12 | Bounded retries with jitter, per the failure model; circuit breaking on sustained database failure | SHOULD | the unavailability drill | classifier and decision table built; the retry loop is deployment |
| B13 | Zero-downtime deploys: sessions survive a restart | SHOULD | deploy during a live session | durable sessions proven |
| B14 | Horizontal scaling without shared in-process state | SHOULD | two service instances, concurrent token exchange | four processes: one token issues once; one attempt registers once |
| B15 | Logs carry no token, token id, session token or connection string | MUST | grep the service logs after the security suite | the audit stores none; the classifier keeps codes, never messages |
| B16 | Health and readiness answer from `assertJuliusBrainDatabase` | SHOULD | stop the database; readiness fails | — |
| B17 | Cold-start and steady-state latency for a context read | SHOULD | p50/p95 from a runner | — |

## C. Operations

| # | Criterion | Level | How it is verified |
|---|---|---|---|
| C1 | RPO stated and met (proposed ≤ 5 minutes) | MUST | PITR drill: the recovered head against the last acknowledged commit |
| C2 | RTO stated and met (proposed ≤ 1 hour) | MUST | a timed restore into a new instance, resume VERIFIED, cutover |
| C3 | Retention stated for PITR, logical exports and the access audit | MUST | provider settings and the export store's lifecycle rules |
| C4 | Logical exports sealed under a backup key, stored in a different account or provider, with object lock | MUST | write, attempt to delete, restore |
| C5 | Restore drills scheduled and automated; a failed drill alerts | MUST | one scheduled drill run, one forced failure |
| C6 | Protected GitHub environment for paid runs, with named approvers | MUST | environment settings; a token from another environment refused |
| C7 | The migration step runs as the owner, outside paid runs, with approval, before the code that needs it | MUST | a rehearsal of release N+1 against release N's database |
| C8 | Development, test and production are separate database identities; production credentials never on a development machine | MUST | open production with development configuration: refused, both ways |
| C9 | Monitoring and alerts: availability, NOT_PRESERVED and PARTIALLY_PRESERVED runs, refused tokens, backup and restore-drill results, connection saturation, audit chain verification | MUST | trigger each alert once |
| C10 | Credential rotation without downtime, on a schedule and on suspicion | SHOULD | rotate during a session |
| C11 | Runbooks for every row of the failure model | SHOULD | a tabletop walk-through |
| C12 | Access review of who holds owner and operator credentials | SHOULD | stated cadence |
| C13 | Estimated monthly cost at expected load, and a ceiling | MUST (known) | provider pricing for the tier, with backups and egress |
| C14 | Operator hours per month | SHOULD | estimate, revised after the first quarter |

## D. The failure drills every candidate must pass

Each row is produced on the candidate, not simulated. The expected behaviour is
`decideJuliusBrainFailure` (`src/relay/mission/julius/julius-brain-failure-model.ts`).

| Failure | How to produce it on the candidate | Expected |
|---|---|---|
| Brain service unavailable | stop the service | FRESH proceeds unpreserved; CONTINUATION, LEARNING, REGRESSION do not start; a mid-run context read for those modes refuses the dispatch |
| PostgreSQL unavailable | stop or firewall the database | the same; the service reports DATABASE_UNAVAILABLE and retries within its bound |
| PostgreSQL read-only | force a failover, or set the database read-only | writes refused, nothing applied; reads answer; preservation derived, never claimed |
| TLS validation failure | present a certificate from another CA | refused, never retried without verification; an operator is alerted |
| Transaction timeout | hold the Brain row lock past `lock_timeout` | rolled back, retried once, written once |
| Partial network loss | drop the connection mid-commit, and after a commit | outcome UNKNOWN; the Brain is read again; the retry is a no-op if it landed |
| OIDC unavailable | block the runner's token endpoint during renewal | OIDC_UNAVAILABLE; the run's mode decides; no session reuse past expiry |
| Service restart during a session | restart the service mid-run | the session continues; no token replay; the mode unchanged |
| Session expiring mid-operation | shorten the session TTL below a seal | one renewal with a new token, same attempt and mode; the operation completes |

**No row falls back** to the v1 table, a local file, a cache or an earlier
export standing in for the Brain.

## E. Placement shapes: what to look at hardest

These are the shapes named in the persistence contract, item 1. None is
preferred. Each shifts where the risk sits.

| Shape | Look hardest at |
|---|---|
| Managed PostgreSQL on the same private network as the Brain service | whether the service role can be a true non-owner (A3); trigger support (A2); failover write loss (A12); off-provider export (A9, C4) |
| A dedicated managed PostgreSQL provider, reached over private link or an allowlist | the network boundary (A6) and its failure modes; TLS verification details (A4); latency (A15); egress cost (C13) |
| Self-managed PostgreSQL on a VM | PITR and backups built and drilled by us (A8, C1, C2, C5); encryption at rest (A7); patching and upgrades (A16); operator hours (C14) |

## F. The candidate sheet

Copy once per candidate. Every cell holds PASS, FAIL, Unknown or a score, and
a link to its evidence.

| Candidate: … | Database host: … | Service host: … | Operated by: … |
|---|---|---|---|
| Hard disqualifiers 1–7 | | | |
| A1–A12 (MUST) | | | |
| A13–A19 (SHOULD, 0–3) | | | |
| B1–B8, B15 (MUST) | | | |
| B9–B14, B16–B17 (SHOULD, 0–3) | | | |
| C1–C9, C13 (MUST) | | | |
| C10–C12, C14 (SHOULD, 0–3) | | | |
| Failure drills D (each) | | | |
| Estimated monthly cost | | | |
| Setup effort | | | |
| Open questions for the founder | | | |
