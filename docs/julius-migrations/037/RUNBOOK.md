# Migration 037 — Wonderland private servers (PROVISIONAL number)

The founder's private-server rules (2026-10-11): free creation, a Free active window then a cooldown (approved 6–8 h and 4–5 h;
the exact values are PROPOSED, not frozen: `PRIVATE_SERVER_POLICY` in `src/relay/social/private-server-lifecycle.ts`), Pro / Max
continuous, no Team tier, server time only, fail closed. 037 persists what those decisions are made from:

| table | written by | holds |
|---|---|---|
| `relay_wonderland.private_server_entitlements` | an OPERATOR (or a future billing service) — never a social route | a player's PRO / MAX for a period |
| `relay_wonderland.private_servers` | the social store only (`private-server-postgres.ts`, compare-and-set on `version`) | one row per owner: name, status, the tier and policy the cycle opened under, its three times |

Numbering (agreed with MAIN JUJU, 10-11): 036 WonderFS, **037 this**, 038 Project Brain file-memory. Each number is claimed at
landing, in order; whichever lands later renumbers.

## Order of deployment

1. **Apply 037 BEFORE deploying code that reads it.** Code without the tables answers every private-server open and invite 503
   (fail closed: nothing opens), and members' reports close the servers they are in. Nothing else breaks.
2. 037 follows 036 directly (its guard refuses otherwise). It is never applied to the Julius live store by a runner
   (`protected-store.ts`); there, only under the founder's protections, and only as the empty schema.
3. Rollback: `down.sql` (refuses while either table holds a row: no down script of this chain loses data). Then the deployed code
   must no longer list 037.

## Operator: granting and ending a tier

- Grant: `INSERT INTO relay_wonderland.private_server_entitlements(player_id, tier, valid_from, valid_until, source, note)
  VALUES ('<player>', 'PRO' | 'MAX', now(), <end or NULL>, 'operator', '<why>')`.
- **End a tier by setting `valid_until`, never by deleting the row.** A deletion is safe (a lapse the server has already seen is
  written into `private_servers` and cannot move), but `valid_until` says WHEN it ended, so the owner's Free window counts from
  the real lapse instead of the cycle's opening.
- A change reaches a server that is in use within a minute (the gate reader's cache), and every open / join reads fresh.
- Deleting a PLAYER cascades into both tables (ON DELETE CASCADE): their lifecycle row and their tier row go with the account.

## What 037 refuses in the database itself

- A tier other than PRO / MAX (no TEAM; FREE is the absence of a row); a period out of order; an owner who is not a player.
- A Free cycle outside the founder's ranges (window 6–8 h, cooldown 4–5 h), with only some of its times, or with times out of order.
- A PRO / MAX row with a window, or not CONTINUOUS. A name with a control character or over 60 characters. `version` < 1.
- `updated_at` before `created_at` or before the cycle's opening.

## Evidence

- `src/relay/persistence/wonderland-migration-037.real-postgres.test.ts` (A, G, C, H, CAS, STORE, ROLE) on a THROWAWAY server.
- `src/relay/social/private-server-lifecycle.test.ts`, `private-server-store.test.ts`,
  `relay-bridge/wonderland-social-private-servers.test.ts`: the directive's Rule H list.
