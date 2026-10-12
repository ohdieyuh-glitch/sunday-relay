# Migration 038 — Wonderland LFF, the "Looking For Feed" (PROVISIONAL number)

The private-Alpha launch gate (the founder, 2026-10-12; contract `_qa_handoff/lff/LFF_ALPHA_CONTRACT_r1_20261012.md`, with its
AMENDMENT r2 / r2.1). A player posts what they are looking for (TEAMS, BUILDERS, AI_ENGINEERS, DESIGNERS, COMPETITORS,
COLLABORATORS); others ask to join; the owner accepts or declines. The rules live in `src/relay/social/social-lff.ts` (pure) and
`social-commands.ts` (input validation). 038 persists what they decide, so a bridge restart loses no post, no request and no cap:

| table | written by | holds |
|---|---|---|
| `relay_wonderland.lff_posts` | the social store only (`social-postgres.ts`, slice B2b) | one row per post: owner, category, title, description, project/activity label, skills, open slots, status, server times, `version` |
| `relay_wonderland.lff_join_requests` | the social store only (`social-postgres.ts`, slice B2b) | one row per request to join a post: requester, optional message, status, server times. **No `version`** (contract r2) |
| `relay_wonderland.lff_post_creations` | the social store only (`social-postgres.ts`, slice B2b), with the post, in the same transaction | one row per post a player CREATED: owner, post id (NO foreign key), created time. It outlives the post's close or delete, so the creation cap (r2: 10 posts per rolling 24 h, deleted and closed ones counted) survives a delete and a restart. The domain prunes rows older than 24 h when it writes |

The prefix is `lff_`, never `social_`: 033's committed `postcheck.sql` and `down.sql` match every `social\_%` relation and count its
foreign keys, so a `social_lff_*` table would make them fail or misreport.

Numbering: 037 names 038 as "Project Brain file-memory", and no 038 exists in any ref. Each number is claimed AT LANDING, in order;
whichever of LFF and the Julius file-memory lands second renumbers (founder decision D-L4). A renumber moves the file name, the guard
strings (and the guard's predecessor), the stamp, the `WONDERLAND_MIGRATION_0NN` constant, this folder, the test file and its stamp
constants; the guard compares exact versions, so a stale number refuses at apply rather than corrupting anything.

## Order of deployment

1. **Apply 038 BEFORE deploying code that reads it.** Code that lists 038 cannot load its state without the tables.
2. 038 follows 037 directly (its guard refuses otherwise, and refuses a second apply and any existing `lff_*` relation). It is never
   applied to the Julius live store by a runner (`protected-store.ts`); there, only under the founder's protections, and only as
   the empty schema.
3. Rollback: `down.sql` (refuses while a later migration is applied, and while any of the three tables holds a row: no down script
   of this chain loses data, and dropping a creation record would reset a cap). Then the deployed code must no longer list 038.
   037's own `down.sql` refuses while 038 is stamped.

## What 038 refuses in the database itself (a BACKSTOP: the domain refuses first)

- A category outside the six. A stored status other than exactly what `social-lff.ts` stores: `OPEN` / `CLOSED` for a post
  (`LffStoredPostStatus`), `PENDING` / `ACCEPTED` / `DECLINED` / `WITHDRAWN` / `CANCELLED` for a request (`LFF_REQUEST_STATUSES`;
  `CANCELLED` = crossed by a block: it survives an unblock, may cancel an ACCEPTED request and free its slot, and is shown to nobody).
  **`EXPIRED` is never stored**: the domain reads it from the server's time, only STRICTLY AFTER `expires_at` (`lffPostStatusAt`; at
  exactly `expires_at` an OPEN post still reads OPEN). The requester's NO LONGER AVAILABLE is a view, never stored.
- An id not shaped `lffp_<serial>` / `lffr_<serial>` (a creation record's post id too); an owner or requester who is not a player;
  a request to a post that does not exist; the same post recorded twice for one owner.
- Text out of bounds, counted in code points: a title of 0 or over 80, a description over 1000, a label over 80, a message over 200.
- **Any character the domain refuses, in any text, line breaks included** (the description too: the contract refuses control
  characters everywhere, the 10-07 log-injection rule): C0 U+0001-U+001F, DEL U+007F, C1 U+0080-U+009F, U+2028 and U+2029
  (`social-commands.ts` `hasControlCharacter` + `hasC1Control`). The CHECKs spell this set as an EXPLICIT class of code points, so
  it means the same under every locale and collation provider: the POSIX `[[:cntrl:]]` class would miss C1 and U+2028/9 under a C
  ctype, and under ICU would also refuse format characters the domain accepts (U+200D ZWJ, in every multi-person emoji; U+200C;
  U+00AD; U+200B; U+FEFF). U+0000 cannot occur in PostgreSQL text.
- Skills: more than 8; an item of 0 or over 32 code points; a refused character or a NULL item; a multi-dimensional array. A CHECK
  may not use a subquery or `unnest`, so the per-item rule is two whole-array regexes over `array_to_string` (see the migration's
  header). Case and duplicates are the domain's.
- Open slots outside 1-20; a post's `version` < 1; `updated_at` before `created_at`; `expires_at` not after `created_at`, or more
  than **30 days** after it. 30 days is a SANITY bound, not policy: the 14-day expiry is PROPOSED (founder decision D-L2) and lives
  in `LFF_POST_TTL_MS`, so the founder's choice needs no new migration. The caps (5 open posts, 10 creations per rolling 24 h,
  20 pending out, 50 pending per post) and the 10-minute re-request window after a withdraw are PROPOSED too, and the domain's alone.
- **A second LIVE request for the same (post, requester)**: a partial unique index over `PENDING` and `ACCEPTED`, the domain's own
  rule (`createLffRequest` refuses a new request while the pair holds a PENDING or an ACCEPTED one). A declined, withdrawn or
  cancelled request does not hold the slot.

## What only the domain enforces (no plain CHECK can say it)

- A requester is never the post's owner (a rule across two tables).
- A request is made only to an OPEN, unexpired post; an edit only on an OPEN post; ownership on edit, close, delete, accept, decline.
- A block either way hides the post (a uniform 404) and cancels the requests it crosses.
- The caps and the re-request window, and pruning the creation records older than 24 h.

## Deleting

- The owner's delete is a HARD delete: the post row goes, and its requests cascade (ON DELETE CASCADE). Its creation record STAYS
  (no foreign key), so the delete still counts toward the creation cap until the domain prunes it.
- Deleting a PLAYER cascades into all three tables: their posts (and every request to them), their own requests and their creation
  records go with the account.

## Evidence

- `src/relay/persistence/wonderland-migration-038.real-postgres.test.ts` (A, G, POST, C, H, CHAIN, ROLE, and a static block pinned
  to `social-lff.ts`'s constants) on a THROWAWAY server (`JULIUS_TEST_DATABASE_URL`, never `DATABASE_URL`; `todo` elsewhere). The
  store's durability across a restart (STORE) arrives with slice B2b's wiring.
- There is no separate `precheck.sql` / `postcheck.sql` (037 has none either): the migration prints one `migration_038_precheck`
  NOTICE and runs its post-check inside its own transaction.
