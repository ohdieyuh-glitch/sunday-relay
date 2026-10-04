# Wonderland R16: three players, one running backend, every privacy rule

**Status:** the harness exists and passes against the real bridge process.
- **AWAITING INDEPENDENT REVIEW (SECOND Wonderland).**
- Final R16 needs the hosted HTTPS backend, three real identities, actual EOS voice, and the shipped final RC. It is **not** claimed here.

## What the harness asks

The privacy wall is already proven in the domain and on PostgreSQL. R16 asks the question those cannot: does a **running** backend keep every rule for three players talking to it over HTTP, and does what they did survive a restart?

The answer comes from the real server composition, its sessions, its routes and its database. `scripts/wonderland-r16-harness.mjs` asks it the same way against a local bridge, a CI bridge or the hosted one.

| Player | Role in the scenario |
|---|---|
| A | will hide from strangers, leads a party, owns a private server |
| B | A's friend |
| C | a stranger to both |

The 24 checks (`R16_CHECKS`) form a closed list. A check that did not run counts as a failure.

| Rule | What is checked over HTTP |
|---|---|
| Sessions | each session acts as exactly its player |
| **P3** | settings are exactly `{visibility}`; a request carrying `appearInRecentPlayers` is refused (`400 INVALID`) and changes nothing |
| Friends | a request accepted is a friendship on both sides, and nobody else's |
| **P1** | (1) By default a stranger sees everyone, Dog and name included. (2) Hiding removes the player from a stranger's roster **and** population count. (3) A stranger's lookup of, or message to, the hidden player is answered **exactly** as for a player who does not exist. (4) **A stranger's views with the hidden player present are identical to the views with them absent.** (5) A friend still sees them and finds them by lookup. |
| **P2** | an encounter between visible players is recorded on both sides; Recent Players drops a now-hidden player **at read time** |
| Party | (1) A party-mate sees a hidden leader. (2) A non-leader who blocks a member **leaves**. (3) A leader who blocks a member **removes** them. |
| No inference | a blocked pair sees no roster entry, presence or count of each other, either way; the blocked player's views with the other present **are** the views with them absent |
| **P4 / P5** | (1) An owner who blocks a member removes them, and the owner stays. (2) A member who blocks the owner leaves, and the owner and server stay. |
| DM | (1) A message between friends is delivered. (2) A block hides the conversation from **both** sides and refuses a new message. (3) Lifting the block shows the conversation again, with nothing written during the block. |
| Lease | every player standing in the instance kept their presence alive by heartbeat, as a client must, and is still there at the end |
| Restart | `--state` records every player's views (never a token). After the backend restarts (which revokes every browser session by design), `--phase verify` signs the same players in again, then checks DURABLE, RECONNECT and PRESENCE in that order (below) |

**Presence is a lease** (`WONDERLAND_SOCIAL.md` decision 6): a presence not refreshed for 120 s is absent everywhere. Two things follow for the harness.
- **During the scenario, it keeps the client's half.** Every player standing in the instance is refreshed every 20 s (`R16_HEARTBEAT_MS`).
  - Without that, a slow hosted backend could let a lease lapse mid-run.
  - A player who is simply not there makes privacy checks pass for the wrong reason: "B is not in C's roster" is trivially true when C has no roster.
  - The LEASE check fails on any refused refresh, and on anyone not still standing in the instance at the end.
- **A restart can outlast a lease**, and then every presence has ended, as a disconnection ends it. So the restart check judges two parts of each view separately, in this order:
  1. **DURABLE**, read before anything is sent: friends and requests, blocks, the party, servers, the inbox, conversations, Recent Players, names and settings must be shown exactly as stored.
  2. **RECONNECT:** each player who stood in the instance does what a client does.
     - It refreshes its presence: `HELD` if the lease outlived the restart.
     - On `NOT_IN_INSTANCE` it enters again: `REENTERED`.
  3. **PRESENCE:** the roster, the population, every presence lookup, and each friend's and party-mate's presence must be shown exactly as before.

  An unsplit comparison would report an ended presence as lost state. The in-process suite shows that the difference such a comparison finds lies exactly on these lease-derived paths, and nowhere else.

**Voice is reported, not checked.** The harness says whether the backend serves EOS client configuration (`CONFIGURED` / `NOT_CONFIGURED_<status>` / `NOT_MOUNTED`). Proving voice needs EOS identities on a configured EOS product, which is CORE's final step.

## Running it

```sh
# Scripted players: the operator token pairs three fresh players through the bridge's own /browser/pair.
RELAY_BRIDGE_TOKEN=... node scripts/wonderland-r16-harness.mjs --bridge <url> --origin <allowed origin> --state r16.json
# ... restart the backend ...
RELAY_BRIDGE_TOKEN=... node scripts/wonderland-r16-harness.mjs --bridge <url> --origin <allowed origin> --phase verify --state r16.json

# FINAL R16 form: three real signed-in players, by their session tokens (JSON), named in order.
WONDERLAND_R16_SESSIONS='{"<idA>":"<token>","<idB>":"<token>","<idC>":"<token>"}' \
  node scripts/wonderland-r16-harness.mjs --bridge <url> --origin <origin> --players <idA>,<idB>,<idC> --state r16.json
```

- **Exit codes:** 0 when every check passed; 1 when a check failed or the backend could not be reached; 2 for usage.
- **What it prints:** one `R16 PASS|FAIL <rule>` line per check, then a summary. The verify phase also prints `R16 RECONNECT <player>=HELD|REENTERED|ABSENT|REFUSED_…` for each player, and six results (three DURABLE, three PRESENCE).
- **What it never prints:** the operator token or any session token.
- **A backend with no social database** answers `503 social_store_unavailable`. The harness then says so and stops.
- **With real players**, the harness changes their social state: a friendship, blocks, a party, a server and messages. It lifts every block it makes. A block's cascade (lost friendship or party seat) stays, as it would for anyone.

## Proof

`relay-bridge/wonderland-r16-harness.real-postgres.test.ts` builds `server.ts` exactly as it ships. It runs it as a **separate process** on a throwaway PostgreSQL migrated through 033.

- **All 24 checks pass over HTTP.**
- The process is then **killed and restarted**. A pre-restart session answers 401, and the same players sign in again. DURABLE and PRESENCE then both pass for all three, after a reconnect that held or re-entered.
- **The harness can fail.** A fetch that leaks a hidden player into a stranger's roster, or shows a blocked conversation, is reported as exactly the rules it breaks.
- The CLI runs both phases, exits 0, and prints no credential.
- **Three backend mutants, each killed through the live process:**

| Mutant | Checks that failed |
|---|---|
| P4 removal disabled | the P4 check |
| Blocked conversations visible | the DM block check |
| Strangers see hidden players | P1 roster and population, P1 present-equals-absent, and P2 read-time |

`relay-bridge/wonderland-r16-harness.test.ts` runs the same harness against the same social routes, in process. Its backend clock moves the way a slow hosted backend's does (every request costs seconds), so leases actually run out:
- **The scenario on a backend slow enough to outlast a lease twice over:** every standing player is refreshed, and all 24 checks pass.
- **A client whose heartbeat never fires** loses its presence mid-run, and the LEASE check fails on it.
- **A restart longer than a lease:**
  - an unsplit comparison differs only on lease-derived paths;
  - the split check passes all six results after every player re-enters (`REENTERED`).
- **A restart inside the lease:** every refresh holds (`HELD`), and nothing is re-entered.
- **Stored state that changed across the restart** (a server C never created) is a DURABLE failure for C alone.

**Four harness mutants, each killed:**
- the heartbeat never fires;
- the restart check does not split;
- the reconnect never enters again;
- the LEASE check trusts the refreshes alone.

## What the hosted final R16 still needs

Each item names its owner.

1. **A hosted PostgreSQL for the bridge.**
   - The hosted bridge does not migrate at boot. Without a database, social answers 503.
   - Provisioning is the founder's (account and billing).
   - Applying the chain through 033 (and 035 once 034 exists) is JUJU's, under the procedure in [WONDERLAND_HOSTED_STORE.md](WONDERLAND_HOSTED_STORE.md). That procedure is built and rehearsed (including this whole scenario on a store it bootstrapped) and **AWAITING INDEPENDENT REVIEW**. It runs only after 031–033 land.
   - `DATABASE_URL` stays parked: the bridge is attached through `JULIUS_DATABASE_URL`.
   - The operator checks the result at `GET /relay-api/wonderland/readiness`.
2. **Three real identities** signed in through the hosted site's own sign-in.
   - The third identity is the founder's.
   - The second game client uses a second Windows account.
3. **EOS voice live.** This is CORE's, with the founder's EOS product, using `docs/relay/WONDERLAND_VOICE.md`.
4. **The shipped final RC** reaching the hosted backend, not the founder's laptop or 127.0.0.1. This is CORE's.
5. **Native social.** The final RC's native client needs `allowNative` for social. That is a reviewed decision for SECOND Wonderland and the founder, and costs one line.
