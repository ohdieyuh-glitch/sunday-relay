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
4. **Display names come from the account layer.** The bridge has no account-name source yet, so names are `null` and render "Unknown". The route registers every signed-in player so that they can be found.
5. **Two ordinary members of one server who block each other both stay.** Neither has authority over the other, and the wall makes them invisible and inaudible to each other.

## Not done here, and where it goes

- **Voice (035):** EOS has no per-listener mute, so the wall is enforced by which rooms each player holds a token for. Every room is one mutually visible pair, so a player's rooms never depend on anyone they cannot see. See [WONDERLAND_VOICE.md](WONDERLAND_VOICE.md). `wonderlandVoiceRouting` and `projectWonderlandVoiceRoster` here state who may hear whom; the voice route plans its rooms with `planWonderlandVoiceRooms`, and that planner carries its own P1 and no-inference property tests.
- **The client (CORE):** the final RC calls these routes against the hosted HTTPS backend, not `127.0.0.1`.
- **The live store:** applying 033 is JUJU's sequenced local operation (`docs/julius-migrations/033/RUNBOOK.md`), after 031 and 032 are landed and applied. It is **READY FOR LOCAL QUALIFICATION** once the branch lands.
