# Wonderland's hosted store: from nothing to a bridge that is ready

**Status:** the procedure and its tooling are built and rehearsed on real PostgreSQL.
- **AWAITING INDEPENDENT REVIEW (SECOND Wonderland).**
- **Running it against a real hosted database is a reviewed decision that has not been taken.** It also waits on its preconditions below: 031–033 landed on `main`, and a database the founder provisions.
- `DATABASE_URL` stays parked. Nothing here reads it unless it is named explicitly, and this procedure never names it.

## Why this exists

The hosted bridge never migrates at boot. Without a migrated database, social answers `503 social_store_unavailable`, and voice answers `503` until 035 is applied and EOS is configured. Final R16 needs:
- the hosted HTTPS backend with durable state;
- three real identities;
- the shipped RC;
- EOS voice.

So the bridge needs a store, brought up by a procedure that can only do what it rehearsed, and a way for the operator to see that it is ready without a database client.

## The two pieces

| Piece | What it is |
|---|---|
| `relay-bridge/wonderland-store.ts` (`npm run relay:wonderland-store:build`, then `node dist-relay-bridge/wonderland-store.cjs`) | `inspect` and `bootstrap`. The URL comes from the variable `--database-env` names (default `JULIUS_DATABASE_URL`), and is never printed or recorded |
| `GET /relay-api/wonderland/readiness` (operator `Bearer` only) | The bridge's own view of its store, as facts: the database `NOT_CONFIGURED` (by variable name), `UNREACHABLE` (a driver code, never its words) or `CONNECTED`; the ledger against the chain this build ships (`through`, `pending`, `gapFree`, `unknown`); social, the voice schema, and the EOS client and trusted-server configuration (presence only); sessions `IN_MEMORY_REVOKED_ON_RESTART`; and which build and start is answering (`bridge`: the commit Railway attests through `RAILWAY_GIT_COMMIT_SHA` or null, whether the gates take their production branch, a boot id drawn per start) |

## What the tool will touch, decided before anything is written

| The database is | The tool |
|---|---|
| **EMPTY**: no schema but an empty `public`, and no marker | Marks it (`COMMENT ON DATABASE … 'relay-wonderland-hosted-store:<uuid>'`), then migrates it |
| **HOSTED_STORE**: this tool's marker, nothing but `relay_wonderland`, and a ledger that is a gap-free prefix of the shipped chain | Applies what is pending, which may be nothing (a second bootstrap changes nothing) |
| Content and no marker. **This is the permanent Julius store's case** | `REFUSED NOT_EMPTY_NOT_MARKED`; nothing is written |
| A gap, or stamps out of order | `REFUSED LEDGER_NOT_A_PREFIX` |
| A stamp this build neither ships nor stages | `REFUSED AHEAD_OF_THIS_BUILD` |

Then:
1. **Migrate**, with the same `TransactionalWonderlandDatabase.migrate()` the paid job runs over its own fresh database.
2. **Postcheck:** the whole shipped chain is applied and gap-free, and social is READY.
3. **Fingerprint**, with the migration window's instrument (`docs/julius-migrations/030/fingerprint-store.sql`).
   - It is recorded **raw**, which is comparable only between stores owned by the same role.
   - It is also recorded **role-neutral**, with the connected role written `<owner>`. That form is comparable between a Railway store and a local rehearsal.
4. **Record:** `RECORD.txt` names the tool, the commit, `tree_clean`, the variable name, every classification line and the fingerprint. It never holds a URL or a credential. A dirty tree is refused: a record that cannot name what ran is not one.

## The procedure

Each step names its owner.

0. **Preconditions (reviewed).**
   - #321 (031, 032) and #323 (033) have landed on `main`. **No unlanded migration may touch a store that will hold real players' state.**
   - SECOND has reviewed this procedure.
1. **The founder provisions a dedicated PostgreSQL** in the bridge's Railway project. Do not attach it to the bridge yet. This is account and billing, the founder's only step. It is never the permanent Julius store.
2. **JUJU, from a clean checkout of `main`'s reviewed tip:**
   ```sh
   npm ci && npm run relay:wonderland-store:build
   HOSTED_STORE_URL='<the new database's URL>' node dist-relay-bridge/wonderland-store.cjs inspect --database-env HOSTED_STORE_URL
   # expect: database: CONNECTED · classification: EMPTY
   HOSTED_STORE_URL='…' node dist-relay-bridge/wonderland-store.cjs bootstrap --database-env HOSTED_STORE_URL \
     --record hosted-store-record --confirm "BOOTSTRAP THE HOSTED WONDERLAND STORE"
   # expect: RESULT: PASS, and RECORD.txt
   ```
3. **SECOND compares the record.**
   - Run the same tool, at the same commit, against a fresh local database (e.g. `docker run postgres:16`).
   - The two `role_neutral_sha256` values must be equal. The rehearsal suite proves this equality against a reference built by applying the chain's files directly.
4. **The founder or JUJU attaches the store:**
   - set `JULIUS_DATABASE_URL` on the bridge service (a Railway reference to the new database's private URL);
   - redeploy.
5. **Verify it, without a database client, with the deploy check** (`scripts/wonderland-deploy-check.mjs`). It only reads: the public liveness probe, the readiness report with and without the token, and the probe from a foreign origin and from the allowed one.
   ```sh
   RELAY_BRIDGE_TOKEN=... node scripts/wonderland-deploy-check.mjs \
     --bridge https://<bridge> --origin https://sunday-relay.vercel.app --expect-commit <main's reviewed tip>
   # expect: DEPLOY SUMMARY passed=8 failed=0 of=8
   ```

   | Check | Passes when |
   |---|---|
   | HEALTH | the public liveness probe answers `{"status":"ok"}` and nothing else |
   | HOSTED | the bridge is HTTPS, and its name resolves only to public addresses |
   | OPERATOR ONLY | the readiness report refuses a request without the token (401) |
   | CORS | a foreign origin is refused (403) and gets no allow-origin; the allowed origin is echoed exactly |
   | BUILD | the commit Railway attests (`RAILWAY_GIT_COMMIT_SHA`) is `--expect-commit` |
   | PRODUCTION | the bridge takes the production branch of its gates |
   | STORE | connected, gap-free, nothing pending, no stamp this build does not know |
   | SOCIAL | the social store is ready |

   The voice schema, the EOS configuration and the boot are reported, never judged. Run it after **every** deploy: Railway deploys `main` by itself, and this is how an operator learns which commit it deployed.
6. **The scripted R16 against the hosted bridge** (`docs/relay/WONDERLAND_R16.md`):
   - `scripts/wonderland-r16-harness.mjs --bridge https://<bridge> --origin <origin> --state r16.json --expect-commit <main sha>`;
   - a Railway redeploy of the same commit (the restart: the boot id must change, the commit must not);
   - `--phase verify`.

   Scripted players make it a REHEARSAL by name (`SCRIPTED_PLAYERS`, `PLAYERS_NOT_VERIFIED`). Then CORE's run with three real identities, EOS and the shipped RC, on the same store, adds `--final`. That run must be judged HOSTED_FINAL.

**035 (voice), behind 034.** With 034 reserved (prepared, not chosen: #337 option 4), the same `bootstrap` sees a store it left at 033 as a HOSTED_STORE. It applies exactly 034 and 035, keeps every row and its marker, and adds only the three voice tables. That is rehearsed below.

## Rollback

- **Before step 4,** nothing depends on the store: the founder drops the database.
- **After step 4,** the store holds players' state. Rolling back means unsetting `JULIUS_DATABASE_URL`, after which social answers 503 again. The data stays.
- Dropping the store after real players have used it is a founder decision. Railway's backups are the only copy.

## Proof (rehearsed, nothing hosted touched)

**`relay-bridge/wonderland-hosted-store.real-postgres.test.ts` (5/5):**
1. **An EMPTY database:**
   - it is refused without the exact phrase, and with a dirty tree, writing nothing;
   - then it is marked, migrated through the shipped chain and fingerprinted. The fingerprint equals a reference built by applying the same SQL files directly to a database the tool never touched;
   - a second bootstrap changes nothing.
2. **Every database the tool must not touch is refused by name,** and its fingerprint and rows are unchanged:
   - the permanent store's case (migrated, a real row, no marker);
   - a marked store with a gap in its ledger, with a stamp from a later build, and with a foreign schema.
3. **A store the tool left at 033 takes 034 and 035 as pending** (prepared on the reserved 034, #337 option 4):
   - it is a HOSTED_STORE with exactly those two pending;
   - the bootstrap applies them;
   - voice is READY, every row and the marker are kept, and only the three voice tables are new;
   - a second bootstrap changes nothing.
4. **The real bridge PROCESS, from `server.ts`, run the way Railway runs it** (`RAILWAY_ENVIRONMENT`, `NODE_ENV=production`, an attested commit):
   - with no database, readiness is `NOT_CONFIGURED`, by variable name;
   - pointed at a closed port, it is `UNREACHABLE ECONNREFUSED`, with no host in the body;
   - on the bootstrapped store, readiness answers 401 to anyone but the operator, and `CONNECTED`, gap-free and social READY to the operator;
   - then the **whole R16 scenario passes (24/24)** under the production gates, the process restarts, and the restart check passes (7/7);
   - **the deploy check** passes every row but HOSTED, since loopback over HTTP is not a hosted bridge, and the store's fingerprint is the same after it as before;
   - before this rehearsal ran under the production gates, a bridge that refused pairing on the production branch alone passed every R16 test. It now fails this one.
5. **The built CLI:**
   - `inspect` reads EMPTY;
   - `bootstrap` refuses a dirty tree and passes on a clean one;
   - the record names the commit and the fingerprint;
   - neither the URL nor its host appears in any output or the record;
   - an unset variable is `BLOCKED`, and no database is contacted.

**`relay-bridge/wonderland-store-readiness.test.ts`:** the ledger judgement (gap, through, unknown; nothing staged once voice is in the chain), failure codes that drop every driver message, and the route's operator-only, GET-only answer.

**Five mutants, each killed:**

| Mutant | Tests that failed |
|---|---|
| An unmarked store with content reads as EMPTY | the refusals case |
| The route answers anyone | the route unit and the real-process case |
| Every ledger is gap-free | the judgement unit and the refusals case |
| An EMPTY store is migrated but never marked | the bootstrap, CLI and real-process cases |
| A failure carries the driver's words | the code unit and the real-process case |
