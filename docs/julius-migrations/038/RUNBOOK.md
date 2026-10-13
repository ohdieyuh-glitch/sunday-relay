# Migration 038 — Wonderland LFF, the "Looking For Feed" (PROVISIONAL number)

The private-Alpha launch gate (the founder, 2026-10-12; contract `_qa_handoff/lff/LFF_ALPHA_CONTRACT_r1_20261012.md`, with its
AMENDMENT r2 / r2.1 / r2.4 / r2.5). A player posts what they are looking for (TEAMS, BUILDERS, AI_ENGINEERS, DESIGNERS, COMPETITORS,
COLLABORATORS); others ask to join; the owner accepts or declines. The rules live in `src/relay/social/social-lff.ts` (pure) and
`social-commands.ts` (input validation). 038 persists what they decide, so a bridge restart loses no post, no request, no cap and no
moderation evidence:

| table | written by | holds |
|---|---|---|
| `relay_wonderland.lff_posts` | the social store only (`social-postgres.ts`, slice B2b) | one row per post: owner, category, title, description, project/activity label, skills, open slots, status, server times, `version`, and `held_at` (NULL while the post is a player's; set when an EVIDENCE post is held instead of deleted, founder D-L5) |
| `relay_wonderland.lff_join_requests` | the social store only (`social-postgres.ts`, slice B2b) | one row per request to join a post: requester, optional message, status, server times. **No `version`** (contract r2) |
| `relay_wonderland.lff_post_creations` | the social store only (`social-postgres.ts`, slice B2b), with the post, in the same transaction | one row per post a player CREATED: owner, post id (NO foreign key), created time. It outlives the post's close or delete, so the creation cap (r2: 10 posts per rolling 24 h, deleted and closed ones counted) survives a delete and a restart. The domain prunes rows older than 24 h when it writes |
| `relay_wonderland.lff_post_snapshots` | the social store only (`social-postgres.ts`), INSERT only, in the transaction of the report or the edit it records | one row per capture of an EVIDENCE post, keyed `(post_id, seq)`: every column of the post as it read then, `cause` (`REPORTED` for seq 1, naming `report_id`: the report that made the post evidence; `EDITED` for each later edit, seq 2, 3, ...), `captured_at`. APPEND-ONLY: never updated or deleted by the app (D-L5 r2, the security review's M-1: the content AS REPORTED survives the owner's edits). Its first row IS the record that the post is evidence |
| `relay_wonderland.lff_moderation_evidence` (a VIEW) | nobody: it writes nothing, and no app route reads it | one row per EVIDENCE post (a snapshot names it, or it is held): the post as last written, `reports` (every `social_reports` row naming it, qualifying or not), `requests` (every request on it) and `snapshots` (as reported, then each edit, by seq), as jsonb arrays. For database operators: the founder's "authorized moderators" until a role and a surface are named (D-L5 R-4) |

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
3. Rollback: `down.sql` (refuses while a later migration is applied, and while any of the four tables holds a row: no down script
   of this chain loses data, dropping a creation record would reset a cap, and a HELD post or a snapshot is moderation evidence). It
   drops the view first, then the tables. Then the deployed code must no longer list 038. 037's own `down.sql` refuses while 038 is
   stamped.
4. **PostgreSQL 15 or later**: the evidence view is `security_invoker` (CI runs 16; O1 ran 16.15 at its 10-12 bootstrap). Before 038 is
   applied to O1 or production, RECORD `SHOW server_version` (>= 15) in the apply record (the correctness review's n-d). On an older
   server the `CREATE VIEW` fails and the whole migration rolls back, changing nothing -- clean, but late.
5. **No default ACL** (the security review's m-4): 038 grants nothing, and its post-check REFUSES (rolling back) if any `lff_*` table or
   the view carries a privilege -- which on this store could only come from `ALTER DEFAULT PRIVILEGES` and would hand the evidence to
   another role. Before applying, read `SELECT * FROM pg_default_acl` for the target; a refusal here is a recorded decision, never a
   workaround.
6. **038 WAS AMENDED IN PLACE (D-L5 r1, then r2), under the same version string.** `migrate()` keys only on the stamp
   `038_wonderland_lff` (no checksum), so a database stamped by OLDER 038 bytes is SKIPPED and keeps the old schema: no `held_at`, no
   `lff_post_snapshots`, no view -- every LFF write there then fails (42703; fail closed, no data lost, but an outage). Every such
   database (a CI throwaway, a local dev store, an A4/A5 `sw_r16_<n>` / `sw2_r16_<n>` migrated at debbae15 or 4558c5cb + r1) is
   DISCARDED, never reused. A5 runs on a FRESH database migrated by this tree, and its record states that `lff_posts.held_at`,
   `lff_post_snapshots` and `lff_moderation_evidence` exist. No persistent store holds 038 (LFF is not on main and not on O1). Earlier
   038 fingerprints and approvals describe different bytes; these bytes get their own review.

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
- A `held_at` before the post's `updated_at` (`lff_posts_held_at`): the evidence is the post as last written.
- A snapshot (`lff_post_snapshots`): a cause other than `REPORTED` at seq 1 naming its report, or `EDITED` at seq 2+ naming none
  (`lff_post_snapshots_cause`); `captured_at` before the captured `updated_at`, or `updated_at` before `created_at`
  (`lff_post_snapshots_times`); a second row for one `(post_id, seq)` (the primary key: append-only, never an overwrite); a snapshot
  of a post that does not exist.
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

- The owner's delete of a post that is NOT evidence is a HARD delete: the post row goes, and its requests cascade (ON DELETE
  CASCADE). So is retention's purge of such a post no longer open and more than 30 days old (PROPOSED). The creation record STAYS (no foreign
  key), so a delete still counts toward the creation cap until the domain prunes it.
- Deleting a PLAYER cascades into all four tables: their posts (and every request to them and every snapshot of them), their own
  requests and their creation records go with the account -- **held evidence and snapshots included**, and `social_reports`
  cascades from players too (033). A REPORTER's deletion no longer un-evidences a post (evidence is the snapshot, which names the
  report without a key), but the owner's deletion takes it. No app path deletes a player today (a unit tripwire,
  `social-writer-choke-point.test.ts`, fails if one appears); what an account erasure must do to evidence is OPEN for counsel and the
  founder (FQ-3).

## Moderation evidence (founder decision D-L5, contract AMENDMENT r2.4)

- **Evidence (contract r2.5 R-6, MAIN's DEFAULT for the founder's FQ-1, flagged, not final).** A report filed through the existing
  `reports.file` flow makes a post EVIDENCE only if, when it is filed: (a) its `reportedId` is the post's owner, (b) the post exists
  and the report is filed no earlier than the post was created, and (c) its reporter may see the post (the feed's and get's own
  rule: no block either way, the author's presence audience admits them, and an OPEN post or one they were accepted on). Any other
  report is still filed, and moderators read it in the view's `reports`; it just holds nothing -- so nobody can pre-report post ids to
  make other players' posts un-deletable. The decision is the domain's, made once, and RECORDED as the post's first snapshot; every
  database predicate (the DELETE's guard, the backstop, the view) reads `lff_post_snapshots`, never `social_reports`.
- **R-2a: the content AS REPORTED** (the security review's M-1). The qualifying report writes snapshot seq 1 (`REPORTED`, naming the
  report) in its own transaction; every later edit of the post appends one (`EDITED`). Silently: the reporter's answer, the owner's
  edit answer and every event are byte for byte what they would be without it.
- **R-1, R-2: an evidence post is never deleted by the app.** The owner's delete and retention's purge HOLD it: whatever that very write
  changed on the post or its requests is written first (a decline or withdraw whose own write purges the post: the correctness
  review's m1), then one `UPDATE ... SET held_at = GREATEST(<the domain's stamp>, updated_at)` on its OWN row (same owner and
  created_at: no graft), no DELETE, so its requests and snapshots stay (no cascade). The store's only post DELETE requires its own row,
  `held_at IS NULL` and no snapshot; should the database hold a snapshot the store's state lacks (a second bridge recorded the report),
  that DELETE removes nothing and the post is held instead.
- **The store never writes a held row again**: its post upsert requires `held_at IS NULL`; its request upsert writes nothing at all --
  no new row, no change -- on a held post (`INSERT ... SELECT ... WHERE NOT EXISTS`), and its request DELETE requires the post not to
  be held; a stale store's write there is refused whole (fail closed). A snapshot is only ever INSERTed.
- **One bridge per store** (the security review's m-1): during a deploy overlap a stale bridge answers some LFF writes differently
  (a refusal, an outage), so R-3 holds only with ONE bridge per store. Keep O1 at one replica with no overlap.
- **R-3: to every player a held post IS a deleted post.** The store reads held rows apart (`lffHeld`), never into the posts and
  requests every player surface reads, before a restart and after it.
- **R-4: authorized moderators = database operators**, through the view `relay_wonderland.lff_moderation_evidence` only. 038 has no
  GRANT; the view is `security_invoker`, so it reads with its CALLER's privileges on `lff_posts`, `lff_join_requests`,
  `lff_post_snapshots` and `social_reports` and widens no one's access. Read it as the owner role, e.g.
  `SELECT post_id, held_at, reports, requests, snapshots FROM relay_wonderland.lff_moderation_evidence ORDER BY held_at NULLS LAST;`
- **Who that is, plainly** (the security review's m-7): the bridge's own database role (`julius` on O1) APPLIES the migrations, so it
  OWNS these tables and the view and can read the evidence -- as can anyone holding its credentials (the bridge process, anyone with
  Railway variable access) and the `postgres` superuser. `security_invoker` only keeps out a role granted the view alone; no such
  role exists today. There is NO read audit. A moderator role, a surface and an audit are the founder's to name (FQ-5).
- **R-5**: an OPEN reported post stays a player's (and is listed in the view with `held_at` NULL).
- **Not decided here (OPEN for counsel and the founder)**: FQ-1 (the evidence rule above is MAIN's default), FQ-2 (keep the full edit
  history of reported posts: today, yes), FQ-3 (account erasure vs held evidence), FQ-4 (how long held evidence is kept), FQ-5 (the
  moderators, their role, tool and audit), FQ-6 (reported JOIN REQUESTS as evidence: today a report naming an `lffr_` id holds
  nothing). Nothing ever deletes a held row or a snapshot today, so they are kept until these are decided.

## Evidence

- `src/relay/persistence/wonderland-migration-038.real-postgres.test.ts` (A, G, POST -- a default ACL included --, C -- the snapshot
  rules included --, V, H, CHAIN, ROLE, and a static block pinned to `social-lff.ts`'s constants) on a THROWAWAY server
  (`JULIUS_TEST_DATABASE_URL`, never `DATABASE_URL`; `todo` elsewhere). V is the evidence view: its rows (a post only a
  non-qualifying report names is not one), its snapshots, and its privileges (a role granted the view alone is refused).
- `src/relay/persistence/social-postgres-lff.real-postgres.test.ts` (slice B2b, and for D-L5: EVIDENCE -- holds by delete and by
  purge beside deleted controls, the view, a restart, a stale store, the backstop and its control --, SNAPSHOTS, HOLD RULE and the
  m1 restart parity) on the same kind of server.
- The unit tripwires in `src/relay/persistence/social-writer-choke-point.test.ts` (D-L5): no app source names the view or reads the
  held posts or snapshots outside the domain, state and store; no statement clears `held_at`, rewrites a snapshot or deletes a
  player; every post DELETE carries both evidence guards.
- There is no separate `precheck.sql` / `postcheck.sql` (037 has none either): the migration prints one `migration_038_precheck`
  NOTICE and runs its post-check inside its own transaction.
