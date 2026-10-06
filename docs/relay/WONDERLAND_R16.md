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
| Restart | `--state` records every player's views (never a token) and the backend's boot. After the backend restarts (which revokes every browser session by design), `--phase verify` signs the same players in again, then checks RESTART, DURABLE, RECONNECT and PRESENCE in that order (below) |

### The voice wall (`--voice`): eight more checks

EOS voice has no per-listener mute, so the voice wall **is** which rooms each player is given a token for: every room is one mutually visible pair ([WONDERLAND_VOICE.md](WONDERLAND_VOICE.md)). Room names are opaque digests, so the harness never learns who is in a room from its name. It judges the wall the way the wall is defined: **by which rooms two players are both given.**

With `--voice`, each player joins (`POST /wonderland/voice/join`) at five points of the same scenario, and `R16_VOICE_CHECKS` join the closed list: a voice check not run is a voice check failed.

| Check | What is checked over HTTP |
|---|---|
| Identity | Each player holds a proven EOS identity and voice admits them. Identities the harness binds itself are three different ones |
| Pairs | With everyone visible to everyone, each pair shares exactly one instance room, and no room holds three. Every room comes with its token |
| **P1** | (1) After A hides: A keeps only the room with her friend B, the stranger C keeps only the room with B, and A and C share nothing. (2) The hide takes back, at once and from both, the one room A shared with C. A's own answer counts exactly that room; C's next join, sent before any heartbeat, has nothing left to take back |
| **No inference (hidden)** | C is given, with the hidden A present, exactly the rooms C is given with A absent |
| Party | Party-mates share exactly one party room per pair, the hidden leader included, and no party room is an instance room |
| **No inference (block)** | (1) After C blocks B: the block takes back at once every room it ends: C's room with B, and both of C's party rooms, since C left the party. C's own answer counts them, and B's next join has nothing left to take back. The pair shares no room in the instance or the party. (2) Each of the pair is given, with the other present, exactly the rooms they are given with the other absent. For B, who still has A, that is not an empty comparison |

**What "at once, from both" proves, and what it does not.**
- Every room is a pair, so taking out **either** member separates the pair at once.
- A backend that took back only the actor's rooms would leave the other member alone in an emptied room: no one hears anyone. That is a **contract violation** (the documented reconcile takes back every room the command ends), never a privacy leak, and the harness reports it as exactly those two checks.
- The real leak class is different: a record that says a token was taken back while it still admits its player. That was a race in the routes, and is fixed and proven in [WONDERLAND_VOICE.md](WONDERLAND_VOICE.md) decision 4.

**Identities.**
- Each player's EOS identity is bound by their game client.
- Or the harness binds it first from `WONDERLAND_R16_EOS_ID_TOKENS`: JSON `{"<playerId>": "<EOS Connect ID token>"}`, from the environment only.
- Those tokens, and the room tokens a join returns, are never printed and never recorded.

**Restart.**
- `--state` records each player's rooms at the end (ids only).
- The verify phase checks that each reconnected player is given exactly those rooms. Their identity is stored (035) and their plan is a function of what is stored and who is present.
- **The verify phase never binds.** An identity that did not survive the restart must fail there, not be bound again.

**The harness never talks to Epic.** The backend does, with its own trusted credentials, and that is what is being checked.

**Presence is a lease** (`WONDERLAND_SOCIAL.md` decision 6): a presence not refreshed for 120 s is absent everywhere. Two things follow for the harness.
- **During the scenario, it keeps the client's half.** Every player standing in the instance is refreshed every 20 s (`R16_HEARTBEAT_MS`).
  - Without that, a slow hosted backend could let a lease lapse mid-run.
  - A player who is simply not there makes privacy checks pass for the wrong reason: "B is not in C's roster" is trivially true when C has no roster.
  - The LEASE check fails on any refused refresh, and on anyone not still standing in the instance at the end.
- **A restart can outlast a lease**, and then every presence has ended, as a disconnection ends it. So the restart check judges two parts of each view separately, after proving the restart happened:
  0. **RESTART:** the backend's boot id, read from its own report (operator only), must differ from the one the scenario recorded.
     - The bridge draws a boot id when its server is created (`relay-bridge/bridge-identity.ts`), so a new id is a new start.
     - Without this, a verify phase run against a backend that never restarted reads its own unchanged memory and passes DURABLE and PRESENCE for the wrong reason. This harness's own CLI test did exactly that until this check found it.
  1. **DURABLE**, read before anything is sent: friends and requests, blocks, the party, servers, the inbox, conversations, Recent Players, names and settings must be shown exactly as stored.
  2. **RECONNECT:** each player who stood in the instance does what a client does.
     - It refreshes its presence: `HELD` if the lease outlived the restart.
     - On `NOT_IN_INSTANCE` it enters again: `REENTERED`.
  3. **PRESENCE:** the roster, the population, every presence lookup, and each friend's and party-mate's presence must be shown exactly as before.

  An unsplit comparison would report an ended presence as lost state. The in-process suite shows that the difference such a comparison finds lies exactly on these lease-derived paths, and nowhere else.

## The venue: where the run happened, judged apart from what it found

The checks say whether a backend kept the privacy wall. They do not say whether it was **the** backend final R16 is about: a laptop, a CI bridge or a stale deployment can pass every check. So every run is also judged for its venue (`judgeR16Venue`), from facts the run reads for itself.

**HOSTED_FINAL** needs every fact below. Anything less is a **REHEARSAL**, and every reason is named from a closed list (`R16_VENUE_REASONS`):

| Fact | Read from | Reason when it fails |
|---|---|---|
| HTTPS | the bridge URL | `NOT_HTTPS` |
| A public host | the URL's host: a loopback, private (incl. 100.64/10), link-local or local name is a machine. A name is resolved, and every address must be public | `HOST_NOT_PUBLIC`, `HOST_RESOLVES_PRIVATE`, `HOST_UNRESOLVED` |
| Three signed-in players | how the sessions were supplied (`WONDERLAND_R16_SESSIONS`, not operator pairing) | `SCRIPTED_PLAYERS` |
| Each named by a verified sign-in | the name the backend itself shows for each player while all three are visible: non-empty, and three different ones | `PLAYERS_NOT_VERIFIED` |
| The backend's own report | `GET /relay-api/wonderland/readiness`, which needs `RELAY_BRIDGE_TOKEN` in either form | `READINESS_UNREAD` |
| Production gates | the report: the process takes the production branch of its gates | `NOT_PRODUCTION` |
| A current store | the report: connected, gap-free, nothing pending, no unknown stamp, social READY | `STORE_NOT_CONNECTED`, `STORE_NOT_CURRENT`, `SOCIAL_NOT_READY` |
| On accepted main | the report: the commit the **platform** attests (`RAILWAY_GIT_COMMIT_SHA`, nothing else), equal to `--expect-commit` | `COMMIT_UNKNOWN`, `COMMIT_NOT_EXPECTED`, `NO_EXPECTED_COMMIT` |
| One package (verify only) | the scenario's state file: it was HOSTED_FINAL; the boot changed; the commit did not; the bridge is the same | `SCENARIO_NOT_FINAL`, `NOT_RESTARTED`, `RESTART_UNPROVEN`, `BUILD_CHANGED`, `BACKEND_CHANGED` |

- **`--final`** makes a REHEARSAL exit 1, however clean its checks.
- **HOSTED_FINAL is the backend's half of final R16.** The shipped RC and EOS voice are CORE's half, on the same package.
- **A rehearsal is still evidence**, about the code. It is never evidence about the deployment.

**Voice.**
- Without `--voice`, the harness only reports whether the backend serves EOS client configuration (`CONFIGURED`, `NOT_CONFIGURED_<status>` or `NOT_MOUNTED`).
- With `--voice`, it checks the voice wall (above).
- **`--final` refuses a run that did not check the voice wall:** final R16 is the whole wall, voice included.

## Running it

```sh
# Scripted players: the operator token pairs three fresh players through the bridge's own /browser/pair.
RELAY_BRIDGE_TOKEN=... node scripts/wonderland-r16-harness.mjs --bridge <url> --origin <allowed origin> --state r16.json
# ... restart the backend ...
RELAY_BRIDGE_TOKEN=... node scripts/wonderland-r16-harness.mjs --bridge <url> --origin <allowed origin> --phase verify --state r16.json

# FINAL R16 form: three real signed-in players, by their session tokens (JSON), named in order; the operator token reads
# the backend's own report; --expect-commit is the accepted main commit; --final refuses anything less than HOSTED_FINAL.
WONDERLAND_R16_SESSIONS='{"<idA>":"<token>","<idB>":"<token>","<idC>":"<token>"}' RELAY_BRIDGE_TOKEN=... \
  node scripts/wonderland-r16-harness.mjs --bridge https://<bridge> --origin <origin> --players <idA>,<idB>,<idC> \
  --state r16.json --voice --expect-commit <main sha> --final
# ... a Railway redeploy of the SAME commit (the restart). The restart revokes every session, by design, so each real player
# signs in again, and the verify phase is given their NEW tokens ...
WONDERLAND_R16_SESSIONS='{"<idA>":"<new token>",…}' RELAY_BRIDGE_TOKEN=... node scripts/wonderland-r16-harness.mjs --bridge https://<bridge> --origin <origin> \
  --players <idA>,<idB>,<idC> --phase verify --state r16.json --voice --expect-commit <main sha> --final
```

- **Exit codes:**
  - 0 when every check passed (and, with `--final`, the venue is HOSTED_FINAL and the voice wall was checked);
  - 1 when a check failed, the backend could not be reached, or `--final` met a REHEARSAL or a run without voice;
  - 2 for usage.
- **The players' voice identities:** bound by their own game clients before the run, or by the harness from `WONDERLAND_R16_EOS_ID_TOKENS` (scenario phase only).
- **What it prints:**
  - one `R16 PASS|FAIL <rule>` line per check;
  - `R16 BACKEND commit=… attested_by=… production=… boot=… store=… through=… pending=… social=…`, or `R16 BACKEND UNREAD <reason>`;
  - `R16 VENUE HOSTED_FINAL|REHEARSAL reasons=…`, then one `R16 VENUE REASON <code> — <words>` line per reason;
  - `R16 VOICE <probe> (checked: …)` or `R16 VOICE <probe> (reported, not checked: …)`;
  - with `--final` and a rehearsal, `R16 FINAL REFUSED`; and without `--voice`, `R16 FINAL REFUSED — the voice wall was not checked`;
  - a summary ending `venue=… voice=CHECKED|NOT_CHECKED`.

  The verify phase also prints `R16 RECONNECT <player>=HELD|REENTERED|ABSENT|REFUSED_…` for each player, and seven results: RESTART, three DURABLE, three PRESENCE. When the scenario recorded voice, three VOICE results follow: one per player.
- **The state file** also records the bridge's origin, the backend's report (commit and boot), the venue, and how the players were identified.
- **What it never prints:** the operator token, any session token, an EOS ID token or a room token.
- **A backend with no social database** answers `503 social_store_unavailable`. The harness then says so and stops.
- **With real players**, the harness changes their social state: a friendship, blocks, a party, a server and messages. It lifts every block it makes. A block's cascade (lost friendship or party seat) stays, as it would for anyone.

## Proof

`relay-bridge/wonderland-r16-harness.real-postgres.test.ts` builds `server.ts` exactly as it ships. It runs it as a **separate process** on a throwaway PostgreSQL migrated through 033.

- **All 24 checks pass over HTTP.**
- The process is then **killed and restarted**. A pre-restart session answers 401, and the same players sign in again. DURABLE and PRESENCE then both pass for all three, after a reconnect that held or re-entered.
- **The harness can fail.** A fetch that leaks a hidden player into a stranger's roster, or shows a blocked conversation, is reported as exactly the rules it breaks.
- The CLI runs both phases around a **real restart** on the same address, exits 0 with RESTART passing, and prints no credential.
  - Before the RESTART check existed, this case ran its verify phase with no restart at all and passed 6/6.
  - Run against today's harness, that original case fails: `R16 FAIL RESTART … the boot id is still 5174d21791a5: this backend did not restart`.
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

**The venue** (`relay-bridge/wonderland-hosted-store.real-postgres.test.ts`, the real bridge process on a bootstrapped store, with a platform-attested commit, **under the production gates** as Railway runs it):
- **Every check passes, and the run is still a REHEARSAL for exactly** `NOT_HTTPS, HOST_NOT_PUBLIC, SCRIPTED_PLAYERS, PLAYERS_NOT_VERIFIED`. The commit is attested and expected, the gates are production's, and the store is connected, current and social-ready, so none of those is a reason.
- **Why the production gates:** a bridge that refused pairing on the production branch alone passed every R16 test while they ran on the development branch. It fails this one.
- **With no restart,** the restart check fails on the same process. After a restart on the same address, the boot is new, the commit unchanged, and the check passes.
- **The CLI:**
  - `--final` exits 1 with `R16 FINAL REFUSED`, though all 24 checks passed;
  - a verify phase with no restart fails RESTART;
  - after a real restart it passes 7/7, a REHEARSAL because its scenario was one.
- **Before any player:** `scripts/wonderland-deploy-check.mjs` reads, and only reads, whether the hosted bridge is the expected build, production-gated, ready and closed. See [WONDERLAND_HOSTED_STORE.md](WONDERLAND_HOSTED_STORE.md) step 5.
- `relay-bridge/wonderland-r16-venue.test.ts` holds the judge with a table: a HOSTED_FINAL baseline, then one fact changed per row, each producing exactly its own reason. Every one of the 19 reasons has a row.

**Ten mutants of the venue and the bridge's identity, each killed:**

| Mutant | Tests that failed |
|---|---|
| Any stated commit is believed | the identity unit |
| An operator-chosen variable also names the commit | the identity unit |
| The boot id derived from the start time | the identity unit |
| A boot per request, not per server | the real-process case |
| Two players under one sign-in accepted | the venue table |
| Carrier-grade NAT (100.64/10) counted public | the host unit |
| A name public if ANY address is | the host unit |
| The restart check compares commits, not boots | the restart unit and the real-process case |
| `--final` does not change the exit code | the real-process case |
| The verify phase has no restart check | the real-process case |

**The voice wall, proven in process** (`relay-bridge/wonderland-r16-voice.test.ts`, 12, and `relay-bridge/wonderland-r16-voice.real-postgres.test.ts`).
- **Why in process.** The shipped bridge reaches Epic and nothing else, and nothing may point it elsewhere. So the social and voice routes are composed exactly as `server.ts` composes them (`relay-bridge/wonderland-r16-voice.fixture.ts`):
  - real RS256 ID-token verification;
  - the reconcile after every committed command;
  - Epic's trusted server replaced by a fake that keeps who each room admits.
- **All 24 + 8 checks pass**, and after every request, once the bridge has finished what it started, the trusted server admits nothing the wall forbids.
- **On PostgreSQL through 035,** a restart (every session gone, the pool closed and reopened):
  - keeps every identity;
  - each reconnected player is given exactly the rooms they had;
  - the issuance record ends with exactly the one room the scenario leaves open.
- **The harness can fail, as exactly the rules broken:**

  | Backend fault | Checks that fail |
  |---|---|
  | Takes nothing back when the wall moves | the two "at once" checks, and the trusted server shows the hidden player and the stranger in one room |
  | Takes back only the actor's rooms | the same two checks, with no breach on the trusted server: a contract violation, not a leak |
  | Hands the stranger the hidden player's rooms | the wall checks that see it, and no other |
  | Serves no voice | the identity check names why; the other seven are "not run"; the 24 still pass |
  | A forged ID token, or two players proving one identity | the identity check |
  | Loses identities across a restart | each player's VOICE restart check |

- **The CLI against the real bridge process,** which serves no voice:
  - `--voice` exits 1, every voice check is named, and the 24 pass;
  - no EOS ID token is printed or recorded;
  - the verify phase refuses to bind;
  - `--final` without `--voice` is refused.
- **Eight harness mutants, each killed:**
  - the everyone-visible shape not checked;
  - the stranger's rooms not checked after the hide;
  - the stranger's side of the hide not checked;
  - the block's takeback not checked;
  - the restart's voice half comparing nothing;
  - a voice run counting only the 24;
  - `--final` not requiring voice;
  - the verify phase binding again.

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
3. **EOS voice live.**
   - The backend's half of the voice wall is `--voice` against the hosted backend, once EOS is configured there (the founder's EOS product, secrets on Railway) and 035 is applied.
   - The live Epic calls themselves, and the RC's audio, are CORE's, using `docs/relay/WONDERLAND_VOICE.md`.
4. **The shipped final RC** reaching the hosted backend, not the founder's laptop or 127.0.0.1. This is CORE's.
5. **Native social.** The final RC's native client needs `allowNative` for social. That is a reviewed decision for SECOND Wonderland and the founder, and costs one line.
6. **The run itself is judged HOSTED_FINAL** (`--expect-commit <accepted main sha> --final`, above).
   - It needs the operator token, to read the backend's report.
   - It needs a Railway deployment from GitHub, whose attested commit is the accepted one.
   - The restart must be a redeploy of the same commit.
