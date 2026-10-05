# Wonderland voice and EOS: the room is the wall

**Status:** implemented on `relay/wonderland-voice-eos`, a draft stacked on the social backend (#323), which is itself stacked on #321.
- Migration 035 is **in the chain after the reserved 034**, prepared and not chosen (#337 option 4). Without that, it is staged behind 034.
- **AWAITING INDEPENDENT REVIEW (SECOND Wonderland).**
- Live EOS is **READY FOR LOCAL QUALIFICATION**: the founder's EOS product, the second Windows account, and the third real identity for the three-party proof.

## The problem the design answers

EOS voice has **no server-side, per-listener mute**:
- a hard mute silences a participant for the whole room;
- per-listener muting is a client call, and a modified client skips it;
- every member of an EOS room is told who else is in it.

So a voice room is a disclosure, and **the only enforcement a trusted server has is which rooms each player holds a token for**.

## The design

1. **Rooms are cliques of mutual visibility** (`planWonderlandVoiceRooms`). A deterministic edge clique *partition* of the channel's mutual-visibility graph:
   - every room's members may all see one another;
   - every mutually visible pair shares exactly one room, so they are heard, and heard once;
   - a pair that is not mutually visible shares none.

   In the common case, with no hidden player among strangers and no block, the whole channel is one room. A hidden player can neither be heard by strangers nor hear them, because hearing them would place her in a room they can see.
2. **A token is the only key, and the planner decides who gets one.**
   - `POST /wonderland/voice/join` issues tokens only for the rooms in the asking player's plan.
   - Room names are opaque digests that name no player or scope.
3. **The wall moves, and the server takes back what it no longer allows.**
   - Every committed social command (a block, a hide, a departure, a party change) runs `reconcileWonderlandVoice` for everyone the command could move.
   - Each open issuance the new plan does not hold becomes a trusted-server `removeParticipant`, then is recorded as revoked.
   - **A failure is reported** on the social response (`voice.revocationFailures`). The issuance stays open, and the next reconcile retries it.
   - **A departure without a word is a departure too.**
     - A presence that has expired is not presence (`WONDERLAND_SOCIAL.md` decision 6), so the departed player stands in no instance and is planned into no room.
     - The next heartbeat of a live player in that instance reconciles them out of the room the departed player is still in.
     - That player's own issuance stays open, truthfully; nobody live shares that room.
4. **A player proves their EOS identity**: `POST /wonderland/voice/identity` with the EOS Connect ID token.
   - **The signature** is RS256 against Epic's published JWKS. `none` and HMAC are refused before any key lookup, and keys that cannot be fetched are a refusal.
   - **The claims:** issuer, a PUID-shaped `sub`, and our product, sandbox, deployment and client; not expired, and not from the future.
   - **One PUID per player**, enforced by `UNIQUE(product_user_id)`. A PUID bound to another player is refused; a re-bind moves the player and takes the old identity out of its rooms.
5. **Two credentials, never confused.**
   - The **game client's** EOS credentials are served at runtime by `GET /wonderland/eos/client-config`, `no-store`, to a signed-in player. They are never packaged.
   - The **trusted server's** credentials never leave the backend. The config reader does not read them, and a test plants markers in them and proves no client-facing value carries one.

## Proof

| Suite | What it proves |
|---|---|
| `wonderland-voice.test.ts` (21) | **300 seeded random social worlds** (hidden players, friendships, blocks, parties): invariants (a)–(c) every time, and determinism. The named cases are one room in the common case, the hidden player and the strangers, the blocked pair, the party, opaque names, and the plan diff. The EOS claim checks cover every refusal. One player, one PUID. **Two planner mutants are killed** (a clique checked against one member only; a doubled pair) |
| `wonderland-voice-routes.test.ts` (20) | A real RSA key pair and real RS256 tokens: forged, `alg none`, unknown kid, another deployment, expired, garbage, and keys unavailable are all refused. Client config is `no-store` and never carries the trusted markers. Join issues tokens only for the plan. A hidden player is never issued the strangers' room. **A mid-session block removes all three from the shared room on the trusted server; a mid-session hide removes the hidden player.** A failed removal is reported, stays open, and is retried. **A player whose presence expired is planned into no room, and the next live heartbeat moves both live players out of the room they shared with them.** The port sends the trusted secret only in its Basic header to Epic's OAuth endpoint |
| `wonderland-voice.real-postgres.test.ts` (7) | 035 after the reserved 034: it refuses without 034, refuses before 033, refuses a second application, and has no token or secret column. 034 refuses without 033 and a second 034, and changes no table. `migrate()` applies both on a fresh database. **Three players race for one PUID, 10 rounds: exactly one binds each time.** Re-bind history; issuances open, revoke and re-open; DOWN is guarded |

## Not done here

- **The live EOS calls.** The Web API shapes (OAuth client credentials, `rtc/v1/{deployment}/room/{room}`, participant DELETE) and the ID-token claim names follow Epic's documentation as known on 2026-10-04. The first live call confirms them: CORE, with the founder's EOS product.
- **The client (CORE).** The RC fetches the config at runtime, binds its identity, joins its plan's rooms, and leaves rooms it is no longer given.
- **Native clients.** Off (`allowNative: false`), as for social.
