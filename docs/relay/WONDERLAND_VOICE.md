# Wonderland voice and EOS: the room is the wall

**Status:** implemented on `relay/wonderland-voice-eos`, a draft stacked on the social backend (#323), which is itself stacked on #321.
- Migration 035 is **staged** behind 034.
- **AWAITING INDEPENDENT REVIEW (SECOND Wonderland).**
- Live EOS is **READY FOR LOCAL QUALIFICATION**: the founder's EOS product, the second Windows account, and the third real identity for the three-party proof.

## The problem the design answers

EOS voice has **no server-side, per-listener mute**:
- a hard mute silences a participant for the whole room;
- per-listener muting is a client call, and a modified client skips it;
- every member of an EOS room is told who else is in it.

So a voice room is a disclosure, and **the only enforcement a trusted server has is which rooms each player holds a token for**.

## The design

1. **Every room is a pair of mutually visible players** (`planWonderlandVoiceRooms`):
   - every mutually visible pair in the channel has exactly one room, so they are heard, and heard once;
   - a pair that is not mutually visible shares none;
   - **a player's rooms never depend on anyone that player cannot see** (P1, no inference).

   A hidden player can neither be heard by strangers nor hear them, because hearing them would place her in a room they can see.

   **Why pairs (2026-10-05).** The first planner grouped mutually visible players into larger rooms (a greedy clique partition). An adversarial review found that the grouping of the players a viewer CAN see depended on players they CANNOT:
   - a hidden player's arrival split a stranger's room into two;
   - the reconcile then kicked the stranger from voice;
   - the same happened for a block.

   **No grouping of three or more can avoid this in general.** Suppose two players cannot see each other (a block), and both see a and c:
   - with only one of them present, the natural room for a, c and that one is a single room;
   - with both present, the pair a–c can be in only one room;
   - so one of the two must find their rooms changed by the arrival of someone they cannot see.

   A pair room depends on nothing but the pair. A block also ends exactly one room, so nobody else's voice is touched.

   **The cost is rooms:** one per mutually visible channel mate (three each in a full party of four). How many rooms an EOS client may hold at once, and so how large a voice channel can be, is CORE's question, and a product decision for the founder if it bounds instance voice. The wall does not bend to it.
2. **A token is the only key, and the planner decides who gets one.**
   - `POST /wonderland/voice/join` issues tokens only for the rooms in the asking player's plan.
   - Room names are opaque digests that name no player or scope.
3. **The wall moves, and the server takes back what it no longer allows.**
   - Every committed social command (a block, a hide, a departure, a party change) reconciles everyone it can move (`reconcileWonderlandVoiceAfterCommand`):
     - **the actor's own rooms before the answer**, counted on it;
     - **everyone else's after the answer**, never inside it (below);
     - "everyone it can move" is the actor, the target, and each channel mate who could share a room with one of them, before or after (`wonderlandVoiceAffected`). A channel mate who could see neither holds no room the command can end. Reconciling them would remove nothing, and the work would be the only trace that an invisible player had acted, so they are left out.
   - Each open issuance the new plan does not hold becomes a trusted-server `removeParticipant`, then is recorded as revoked.
   - **A failure is reported** on the social response (`voice.revocationFailures`) when it is the actor's. A failure after the answer goes to the bridge's log as a count. Either way the issuance stays open, and the player's next reconcile retries it.
   - **A departure without a word is a departure too.**
     - A presence that has expired is not presence (`WONDERLAND_SOCIAL.md` decision 6), so the departed player stands in no instance and is planned into no room.
     - A live player's heartbeat reconciles them, and every channel mate who can see them, out of the rooms they shared with the departed player. At the latest, each live player's own next heartbeat does.
     - That player's own issuances stay open, truthfully; nobody live shares those rooms.
   - **The social response counts the ACTOR's own rooms only** (`voice.revoked`, `voice.revocationFailures`). The reconcile also moves channel mates the actor may not see, and a count over them told the actor someone was there (review finding, 2026-10-05).
   - **The answer never waits for anyone else's removal** (review finding, 2026-10-05).
     - The finding: removals are Epic round trips. An answer that waited for them took longer exactly when the command ended rooms of players the actor cannot see. An owner's answer took 242 ms without a member's hidden friend and 484 ms with her (120 ms per Epic call), and on PostgreSQL 64 against 101 statements per request: a timing channel through the wall (P1, no inference).
     - The fix: everyone else's reconcile is queued before the answer leaves and runs after it. Their steps are queued first, so none of them can be issued anything before their reconcile has run.
4. **One player's voice, one step at a time** (review findings, 2026-10-05). A token and its record are two writes on two systems, Epic's room and our issuance, and so are a removal and its revocation. Interleaved for one player, they disagreed:

   | Finding | Classification |
   |---|---|
   | A re-issue landing between a removal and its revocation was recorded as revoked while its token still admitted the player. No later reconcile took it out. Done on both sides (a player who hides and shows again, while the other side's client rejoins), a block afterwards left the blocked pair in one room | **Privacy leak**, under a race: a blocked pair could hear each other |
   | A join that had read the player's identity before a re-bind minted a fresh token for the former identity after the re-bind had taken it out. A second join racing it could fail with a 500 | **Contract violation** ("a re-bind takes the former identity out of every room it held"). The former identity is the same player's earlier EOS account, and the next reconcile removed it |
   | A join that had planned before a block issued the blocked pair's room after the block's reconcile had run | **Contract violation** ("a block takes back at once"). Not a leak by itself: the blocker had already been taken out of that two-person room. The next reconcile removed it |

   So every step that issues, binds or takes back one player's voice runs under that player's lock (`underVoiceLock`): a join, a bind, and each player's reconcile.
   - A step never holds two players' locks, so no two steps can wait on each other.
   - **The lock lives in the bridge process.** The hosted bridge is one instance; a second instance would need the same lock in the database.
   - **Every room is a pair, so taking out either member separates the pair at once.** "From both" is the reconcile's contract and keeps the record true; the privacy of the moment rests on either side's removal.
5. **A player proves their EOS identity**: `POST /wonderland/voice/identity` with the EOS Connect ID token.
   - **The signature** is RS256 against Epic's published JWKS. `none` and HMAC are refused before any key lookup, and keys that cannot be fetched are a refusal.
   - **The claims:** issuer, a PUID-shaped `sub`, and our product, sandbox, deployment and client; not expired, and not from the future.
   - **One PUID per player**, enforced by `UNIQUE(product_user_id)`. A PUID bound to another player is refused.
   - **A re-bind takes the former identity out of every room it held.** Each issuance records the identity its token ADMITS (`voice_issuances.product_user_id`). A removal always takes out that identity, never the player's current one: removing the current identity from a room a former one holds removes nobody (review finding, 2026-10-05).
   - A room still held open by a former identity, because its removal failed, is not issued again until that identity is out. An issuance is recorded **before** its token is asked for, so every token Epic issues is on the record the reconciler reads.
6. **Two credentials, never confused.**
   - The **game client's** EOS credentials are served at runtime by `GET /wonderland/eos/client-config`, `no-store`, to a signed-in player. They are never packaged.
   - The **trusted server's** credentials never leave the backend. The config reader does not read them, and a test plants markers in them and proves no client-facing value carries one.

## Proof

| Suite | What it proves |
|---|---|
| `wonderland-voice.test.ts` (24) | **300 seeded random social worlds** (hidden players, friendships, blocks, parties): invariants (a)–(c) every time, and determinism. **(d) over the same 300 worlds:** every player's rooms are identical with and without every player they cannot see, all at once and one at a time. The review's two cases: a hidden arrival, and a blocked player's arrival. The named cases: a room per pair in the common case, the hidden player and the strangers, the blocked pair, the party, opaque names, and a block ending exactly one room. The EOS claim checks cover every refusal. One player, one PUID |
| `wonderland-voice-routes.test.ts` (29) | A real RSA key pair and real RS256 tokens: forged, `alg none`, unknown kid, another deployment, expired, garbage, and keys unavailable are all refused. Client config is `no-store` and never carries the trusted markers. Join issues tokens only for the plan. A hidden player is never issued the strangers' room. **A mid-session block ends exactly the blocked pair's room on the trusted server; a mid-session hide removes the hidden player.** A failed removal is reported to the player it concerns, stays open, and is retried. **An owner who removes a member whose hidden friend is present is told exactly what he is told without her. A re-bind removes the former identity from its rooms; a former identity Epic would not remove is never issued over, and is removed on the retry. A player whose presence expired is planned into no room, and the next live heartbeat moves the live players out of the rooms they shared with them.** The port sends the trusted secret only in its Basic header to Epic's OAuth endpoint. **The concurrency findings, each forced deterministically** (a removal Epic has made but not yet answered, a read held open inside a join): a re-issue racing a removal leaves nothing unrecorded, and a later block empties the pair's room; a re-bind inside a join leaves the former identity in no room; a block inside a join leaves the joiner nothing the block ended; an owner is answered while a hidden friend's removal is still in flight; a command by a player nobody else can see reconciles nobody else. **Four mutants of the fix are each killed:** no per-player lock (all three races), others reconciled inside the answer, every channel mate reconciled, and a re-bind outside the lock |
| `wonderland-voice.real-postgres.test.ts` (6) | Staged 035: it refuses without 034, refuses before 033, refuses a second application, and has no token or secret column. **Three players race for one PUID, 10 rounds: exactly one binds each time.** Re-bind history. Issuances record the identity they admit, open, revoke and re-open, and are never recorded over another identity's open token. DOWN is guarded |

## Not done here

- **The live EOS calls.** The Web API shapes (OAuth client credentials, `rtc/v1/{deployment}/room/{room}`, participant DELETE) and the ID-token claim names follow Epic's documentation as known on 2026-10-04. The first live call confirms them: CORE, with the founder's EOS product.
- **The client (CORE).** The RC fetches the config at runtime, binds its identity, joins its plan's rooms, and leaves rooms it is no longer given.
- **Native clients.** Off (`allowNative: false`), as for social.
