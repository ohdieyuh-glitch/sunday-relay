# Wonderland social: the hosted backend and its privacy wall

**Status:** implemented on `relay/wonderland-social-backend`, a draft stacked on #321 so that migration 033 follows 032.
- **AWAITING INDEPENDENT REVIEW (SECOND Wonderland: backend and privacy correctness).**
- No readiness row is claimed. The privacy wall is earned only by the final RC, against the hosted backend, in the R16 run.

## What exists

| Layer | File | What it is |
|---|---|---|
| Domain (pure) | `src/relay/mission/wonderland-social/` | Contracts, the relation, one decider (`decideWonderlandSocialCommand`), one applier, every projection, and the memory store |
| Durable state | `src/relay/persistence/wonderland-migrations/033_wonderland_social.sql` | 15 `social_*` tables and one sequence. Additive. Runbook, pre-check, post-check and down: `docs/julius-migrations/033/` |
| Store | `src/relay/persistence/wonderland-social-postgres.ts` | Decides with the SAME decider, writes the SAME mutations as SQL, under one social advisory lock. Reads are one REPEATABLE READ snapshot of the viewer's neighbourhood |
| API | `relay-bridge/wonderland-social-routes.ts`, mounted in `server.ts` | `/relay-api/wonderland/social/*`, authenticated by the player's session |

## The privacy wall, rule by rule

There is one relation, `wonderlandRelationOf`: `SELF`, `BLOCKED` (either direction, and it outranks everything), `FRIEND`, `PARTY` or `STRANGER`. There is one visibility rule, `isWonderlandVisibleTo`: self, friends and party-mates always; strangers only when the subject is `EVERYONE`; a blocked pair never. Every projection asks that rule and nothing else.

| Rule | Where it holds | Hostile test |
|---|---|---|
| **P1:** hidden from strangers means no Dog, name, population count, or presence/location/activity inference | roster, instance listing, presence lookup, server member list, voice routing | A stranger's WHOLE view with the hidden player present is deep-equal to the view with them absent. A lookup cannot tell hidden from offline from unknown. Voice is inaudible to strangers |
| **P2:** Recent Players is filtered at read time | `projectWonderlandRecentPlayers`; also never recorded when unseen (`encountersOnEnter`) | A hidden meeting does not surface after un-hiding. A block in either direction removes the row; an unblock restores it. A player who later hides drops out for strangers and stays for friends |
| **P3:** the dead "appear in Recent Players" switch is removed | settings are exactly `{ visibility }`; `parseWonderlandSocialSettings` refuses `appearInRecentPlayers` by name; the route refuses any unknown command field; 033's post-check refuses any `recent` column | The switch is refused; a command carrying it changes nothing |
| **P4:** the owner blocks a member → the member is removed, the owner stays | the block cascade | The member is removed and ejected from the instance, cannot rejoin, cannot be re-invited, and the refusal is identical to a nonexistent server's |
| **P5:** a member blocks the owner → the blocker leaves, the owner stays | the block cascade | The owner and the other members stay |
| **Party** | the block cascade | A leader blocking a member removes them. A non-leader blocking the leader or another member leaves. Invitations die with the block. A blocked pair can never share a party |
| **DM** | `projectWonderlandConversation`, `projectWonderlandInbox`, `SEND_MESSAGE` | History is hidden from both while the block exists; nothing can be sent or stored; an unblock shows the history again, without anything "sent during" the block |
| **No inference** | all projections | A blocked player's whole view with the blocker present equals the view without them, in both directions: roster, voice, presence, party, inbox, conversations |

**Mutation-tested.** Five mutants of the wall were each killed by the suite:
- strangers see hidden players;
- the P4 removal is missing;
- population counts everyone;
- encounters are recorded blind;
- a DM ignores a block.

**The PostgreSQL store's neighbourhood** is proven by a contract suite. One scripted world (16 players, every rule) runs against both stores, and every projection for every player is equal. Each read path of the loader is necessary: removing it fails the suite. Four expansions that the suite proved unnecessary were removed.

## Decisions recorded for SECOND Wonderland and the founder

1. **OWNER_NOT_EXEMPT.** A private server's owner is a stranger to a member who is not their friend. A member hidden from strangers is therefore hidden from the owner's member list and roster too, because P1 says "no name". The owner can still remove a member by the id they invited.
2. **Native social is OFF** (`allowNative: false` in `server.ts`).
   - The `native_world` scope was confined to the Julius world stream (founder, 2026-09-27).
   - The final RC needs social from the native client, so widening the scope is a one-line, reviewed change. The code path and its tests already exist.
   - **The copy guard:** with no Origin, only a native credential is accepted, never a copied browser token.
3. **Default visibility is `EVERYONE`**, stated as a constant, not inferred. Changing it is a product decision.
4. **Display names come from the account layer.**
   - At GitHub sign-in, the bridge records the **verified login** (GitHub's own answer, keyed by the stable account id `ghu-<id>`) as the player's display name, through `onIdentityVerified`.
   - A rename on GitHub arrives with the next sign-in.
   - A social request that knows no name only makes sure the player exists (`ensureProfile`). It never writes `null` over a recorded name.
   - A player with no recorded name (e.g. a paired native session) is `null` and renders "Unknown", never a guess.
   - A failure to record a name never fails a sign-in.
   - No client can name itself.
   - Proven end to end by `relay-bridge/wonderland-social-names.real-postgres.test.ts`: two GitHub sign-ins, each player shown the other's login, a rename, and hiding taking the name away. Two mutants are killed: a nameless upsert, and no recording at sign-in.
5. **Two ordinary members of one server who block each other both stay.** Neither has authority over the other, and the wall makes them invisible and inaudible to each other.
6. **Presence is a lease, not a record** (`social-liveness.ts`).
   - **The problem.** A client that crashes, loses its network or is closed never sends `LEAVE_INSTANCE`. Before this decision its presence stayed true forever. A friend's lookup, a roster, an instance's population, an encounter recorded on someone else's entry, and a voice plan all went on reporting a player who had gone.
   - **The rule.** A presence not refreshed within `WONDERLAND_PRESENCE_TTL_SECONDS` (120, four heartbeats) is not presence. The client refreshes it with `UPDATE_PRESENCE` every `WONDERLAND_PRESENCE_HEARTBEAT_SECONDS` (30).
   - **One filter, everywhere at once.** `wonderlandLiveState` is applied by every store read (`stateFor` and `voiceStateFor` now take the request's `now`) and by every decision (`decideWonderlandSocialCommand`, at the command's time). No reader can see a presence the others do not.
   - **What follows:**
     - an entry records no encounter with someone who has gone;
     - a heartbeat from an expired presence is refused `NOT_IN_INSTANCE` (409), never silently revived;
     - the client then enters again;
     - **a member removed from a private server loses their stored presence row in its instance, lapsed or not, and a heartbeat re-checks membership** (`NOT_IN_INSTANCE` otherwise). Before this (review finding, 2026-10-05):
       - a member removed a moment after their lease ran out kept the expired row;
       - a heartbeat stamped just before the expiry, but decided after the removal, made it live again, so a non-member stood in the server.
       - Proven in both stores, by the review's own out-of-order sequence. Two mutants are killed.
   - **Nothing is deleted.** The row stays until the player's next entry overwrites it. It simply stops counting, in both stores. The parity suite reads the row back from PostgreSQL, and both stores agree on every projection after an expiry.
   - **Voice.**
     - The room planned without the departed player has different members, so it is a different room.
     - The next heartbeat of anyone live in that instance reconciles them, and the trusted server moves every live player out of the room the departed player is still in.
     - The departed player's own issuance is not pretended revoked; nobody took it back. But nobody live shares that room any more, and their next entry reconciles them like anyone else.
     - So a player who has gone is reported present for at most the lease. For at most one heartbeat after that, they may still share a room nobody sees them in.
   - **Proven by:**
     - the domain suite (`wonderland-social-liveness.test.ts`);
     - the route suites (a ghost at every social route; a ghost planned into no room; the next heartbeat moving the live players out);
     - the real-PostgreSQL parity case.

     **Four mutants are killed:** liveness off, the decider ignoring it, the PostgreSQL read ignoring it, and the voice read ignoring it.
7. **Each player's social commands have a budget** (`relay-bridge/wonderland-social-rate-limit.ts`). **PREPARED, NOT CHOSEN:** the limits are a product decision.
   - **The problem.** A block ends a flood aimed at one victim. Nothing ended a flood aimed at everyone: one signed-in account could send friend requests, invitations and messages as fast as the bridge answers.
   - **The key is the session's verified player**, never a header or an address a caller could rotate.
   - **Four token buckets per player:**

     | Bucket | Drawn by | Burst | Then |
     |---|---|---|---|
     | `all` | every ordinary command | 60 | one a second |
     | `message` | `SEND_MESSAGE` | 20 | one every 3 s |
     | `invitation` | `FRIEND_REQUEST`, `PARTY_INVITE`, `SERVER_INVITE` | 10 | one every 30 s |
     | `protect` | `BLOCK`, `SET_SETTINGS`, `LEAVE_INSTANCE`, `PARTY_LEAVE`, `SERVER_LEAVE`, and nothing else | 30 | one every 2 s |

     A client's own heartbeat (`UPDATE_PRESENCE` every 30 s) is one token in thirty of what `all` returns.
   - **A player can always protect themselves** (review finding, 2026-10-05).
     - What a player does to protect themselves (a block, a change of visibility, leaving an instance, a party or a server) draws only on `protect`, never on `all`.
     - Before this, a client whose own routine traffic had spent `all` (sixty presence updates while moving, say) was answered 429 to a block, and the block was not executed for up to a second.
     - `protect` still bounds them, so toggling a block or a setting cannot become a flood of its own. Lifting a block (`UNBLOCK`) is ordinary traffic.
   - **The answer.**
     - A command is admitted only when every bucket it draws on holds a token, and then takes one from each.
     - Otherwise it is answered `429 rate_limited`, with the `bucket`, `retryAfterSeconds` and a `Retry-After` header. **The command is not executed, and it takes nothing:** a caller who keeps knocking does not dig their own wait deeper.
     - The budget is checked after the session is verified and the command is parsed, so a malformed or unauthenticated request draws nothing. The player's profile is still ensured first, as for every social request.
     - A command the wall refuses (for example `NOT_IN_INSTANCE`) was admitted and decided, so it has drawn its token. So has the replay of a `commandId` already executed: it answers its first result once the budget allows.
   - **What it is not:**
     - Reads (`GET /social/*`) are not limited.
     - The budget lives in the bridge process's memory. A restart forgets it, which gives every player a full bucket again. That is the safe direction, and a restart revokes every session anyway.
     - Each bridge instance would hold its own budget. The hosted bridge is one instance.
     - Memory is bounded at 10,000 players: past it, the player not seen longest is forgotten and starts full again.
   - **The clock is integer milliseconds** (GCRA). A clock that steps backwards refills nothing and locks nobody out. A first version on fractional tokens never returned an invitation token at exactly 30 s: `29.999/30 + 0.001/30` is `0.9999999999999999`.
   - **Proven by:**
     - the unit suite (`wonderland-social-rate-limit.test.ts`): every boundary to the millisecond;
     - the route suite: a flood refused at twenty, exactly twenty stored, everyone else untouched;
     - the R16 suites: the whole scenario fits the budget with no time passing at all, and the real bridge process refuses a flood past twenty and stores nothing past it.

     **Eight mutants are killed:**
     - the limiter not composed in the bridge;
     - the route ignoring a refusal;
     - a refused command still taking its tokens;
     - one budget shared by every player;
     - a backwards clock read as it is;
     - messages drawing only on `all`;
     - the bridge dropping the `Retry-After` header;
     - protective commands also drawing on `all`.

## Not done here, and where it goes

- **Voice (035):** EOS has no per-listener mute, so the wall is enforced by which rooms each player holds a token for. Every room is one mutually visible pair, so a player's rooms never depend on anyone they cannot see. See [WONDERLAND_VOICE.md](WONDERLAND_VOICE.md). `wonderlandVoiceRouting` and `projectWonderlandVoiceRoster` here state who may hear whom; the voice route plans its rooms with `planWonderlandVoiceRooms`, and that planner carries its own P1 and no-inference property tests.
- **The client (CORE):**
  - The final RC calls these routes against the hosted HTTPS backend, not `127.0.0.1`.
  - While in an instance, it sends `UPDATE_PRESENCE` at least every 30 s, and answers `NOT_IN_INSTANCE` by entering again (decision 6).
- **A sweep of departed players' own voice issuances.** Not built: nobody live shares those rooms (decision 6). A server-side sweep would make the issuance record tidier, not the wall stronger.
- **The live store:** applying 033 is JUJU's sequenced local operation (`docs/julius-migrations/033/RUNBOOK.md`), after 031 and 032 are landed and applied. It is **READY FOR LOCAL QUALIFICATION** once the branch lands.
