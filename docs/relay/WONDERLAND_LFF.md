# Wonderland Looking for Feed

**Status: PROPOSED, pending acceptance.** There is no accepted requirements
document for Looking for Feed. The criteria below are the contract this change
implements. They are not accepted product requirements until someone accepts
them. This change claims **no readiness change**: it does not edit a scorecard
and it does not set a readiness percentage.

The route paths follow the LFF 037 list already written in
`wonderland/Tools/b33_v3_1b/server_check/ROUTES_cbe584be_vs_client_1e7cdebb.md`.
That note is a diagnostic, not an accepted spec. It writes
`withdraw|accept|decline` as one bullet; this contract serves those three paths
separately. Listing withdraw is the path that note names `close`.

## Proposed acceptance criteria

Each criterion names the test that proves it.

1. **Five categories, closed.** A listing names exactly one of `teams`,
   `builders`, `ai_engineers`, `designers`, `competitors`. The feed labels are
   "Looking for Teams", "Looking for Builders", "Looking for AI Engineers",
   "Looking for Designers", "Looking for Competitors". Any other category is
   `invalid_category`.
   Proved by `AC-1 the five categories are closed and labeled` in
   `src/relay/mission/wonderland/wonderland-lff.test.ts`.

2. **Create.** The caller can post an open listing with a title, a body, a
   display name, and a contact method. The stored author is the caller. The
   answer is the listing that was stored.
   Proved by `AC-2 create stores an open listing posted by the caller`.

3. **List and filter.** An open feed can be read unfiltered, or filtered by
   each of the five categories. A filter returns only that category. An unknown
   category is rejected, and is not reported as an empty feed.
   Proved by `AC-3 each of the five category filters returns only that category`,
   `AC-3 an unknown category is rejected, not an empty feed`, and
   `AC-3 a category query on the route filters the feed` in
   `relay-bridge/wonderland-lff-routes.test.ts`.

4. **Who posted, and how to connect.** A visible listing carries `authorId`,
   `authorDisplayName`, `contactMethod`, `contactLabel`, and `contactValue`.
   Proved by `AC-4 a listing view names who posted and how to connect`.

5. **Update.** The author can change title, body, display name, category, and
   contact on an open listing. Another player cannot.
   Proved by `AC-5 the author can update an open listing` and
   `AC-5 another player cannot update, withdraw, or delete an open listing`.

6. **Withdraw and delete.** `POST /lff/posts/:id/close` withdraws the author's
   open listing. It leaves every open feed. The author can still read it with
   status `withdrawn`. Another player cannot read it. `POST .../delete` removes
   it for the author as well. Another player cannot close or delete it.
   Proved by `AC-6 withdraw removes the listing from every open feed`,
   `AC-6 the author can still read a withdrawn listing and other players cannot`,
   and `AC-6 delete removes the listing for the author as well`.

7. **Expiry.** A read at or after `expiresAt` marks an open listing `expired`.
   Expired is a different status from `withdrawn`. The listing leaves every
   open feed. One millisecond earlier it is still open. The author can read the
   expired row. Another player cannot. An expired row no longer counts toward
   the author's open-listing cap.
   Proved by `AC-7 at expiresAt the listing leaves the open feed marked expired`,
   `AC-7 a moment before expiresAt the listing is still open`, and
   `AC-8 an expired listing frees the player's open-listing cap`.

8. **Validation and abuse limits**, sized for a first group of 10 to 25 players
   and about 50 early testers:
   - at most 3 open listings per player
   - at most 1 open listing per player per category
   - title ≤ 80, body ≤ 400, display name ≤ 32, contact value ≤ 120, request
     message ≤ 200 (JavaScript string length)
   - blank text is refused; a control character (U+0000–U+001F, U+007F, U+2028,
     U+2029) is refused and is not trimmed away
   - `lifetimeHours` is a whole number from 1 to 168, default 72
   - an unexpected field is refused
   - a body that names a different actor is refused
   - `nowIso` must be a real UTC timestamp
   - a `profile` contact must be the caller's own id
   - at most 10 open connect-requests per player, and one open request per
     player per listing
   Proved by the `AC-8` tests in `wonderland-lff.test.ts` and
   `AC-11 request caps and a second open request are refused`.

9. **Multiplayer visibility.** Two callers of one board see the same feed. The
   second caller sees a listing the first caller just created, and stops seeing
   it after withdraw or expiry. The same is true through `handleLffHttp`.
   Proved by `AC-9 another player sees a new listing and stops seeing it when it is withdrawn`,
   `AC-9 another player stops seeing a listing when it expires`, and
   `AC-9 a second caller sees a listing through the route and loses it after close`
   in `relay-bridge/wonderland-lff-routes.test.ts`.

10. **Routes.** The handler serves each path the LFF 037 note names:
    `GET /lff/posts`, `POST /lff/posts`, `GET /lff/posts/:id`,
    `POST /lff/posts/:id/edit`, `POST /lff/posts/:id/close`,
    `POST /lff/posts/:id/delete`, `GET /lff/posts/:id/requests`,
    `POST /lff/posts/:id/requests`, `GET /lff/requests`,
    `POST /lff/requests/:id/withdraw`, `POST /lff/requests/:id/accept`,
    `POST /lff/requests/:id/decline`.
    The caller's id is the only actor. A path may be prefixed with
    `/wonderland/social`.
    Proved by `AC-10 every documented LFF path is served` and
    `AC-10 the social prefix and a hostile path`.

11. **Connect requests.** A player other than the author can request to connect.
    The author can accept or decline. The requester can withdraw. A third player
    does not see the request. Accept and decline change the request status only.
    Proved by `AC-11 a request can be accepted, declined, or withdrawn, and a third player does not see it`.

12. **Out of scope.** A body that carries `privateServer`, `privateServerId`,
    `gve`, `gveId`, `serverKind`, or `serverId` is refused with `out_of_scope`.
    An accepted request does not grow a private-server field or a GVE field.
    Proved by `AC-12 a private server or GVE field is refused` and
    `AC-11 accepting a request does not add a private server or GVE field`.

13. **Feed row on the C++ side.** The five category ids map to the same labels,
    an unknown id is not a category, and a row is on the open feed only when its
    status is `open` and `now` is before `expiresAt`.
    Proved by `AC-13 the feed row labels and the open-feed predicate`
    in `src/relay/mission/wonderland/wonderland-lff-feed-cpp.test.ts`, which
    compiles `wonderland/Tools/lff-feed-logic-test.cpp` with g++ and runs it.
    `wonderland/Tools/syntax-check.sh` syntax-checks `WonderlandLffFeed.cpp`.
    This does not prove an Unreal build.

14. **No readiness change.** The domain module does not define a readiness score
    or a scorecard. This document stays marked PROPOSED and states no readiness
    percentage.
    Proved by `AC-14 the domain module does not define a readiness score` and
    `AC-14 the contract doc is marked PROPOSED and claims no readiness change`.

15. **A restart keeps the board.** Listings and connect-requests are written to
    `board.json` under the store root, with `board.previous.json` kept beside
    it, using the existing atomic file write. A new board opened on that
    directory sees the same rows. A read at `expiresAt` still marks a listing
    expired, and that expired status is what the next board reads. A snapshot
    that does not parse is `store_corrupt`. It is not treated as an empty board,
    and it is not overwritten while it is the only copy.
    Proved by `AC-15 a restarted file store still has listings and requests, and expiry still holds`
    and `AC-15 a corrupt snapshot is not loaded as an empty board` in
    `src/relay/persistence/wonderland-lff-file-store.test.ts`.

16. **The desktop client at f1fbb264 can call the same paths.** That view's live
    service sends the bodies and reads the `data` objects described in
    "Desktop client contract" below. A v1 caller still receives `result` and
    still receives HTTP 201 when it creates with `displayName`. A desktop
    create, which sends no `displayName`, receives HTTP 200 and `data.postId`.
    Proved by `AC-18 the f1fbb264 desktop client can post, filter, request, and read its own shapes`
    in `relay-bridge/wonderland-lff-routes.test.ts`.

## Data model

Schema `relay-wonderland-lff.v1`.

| Field | Meaning |
|---|---|
| `listingId` | Generated id, `[A-Za-z0-9_-]{1,80}` |
| `category` / `categoryLabel` | One of the five categories and its feed label |
| `title`, `body` | Text the author wrote |
| `authorId`, `authorDisplayName` | Who posted. `authorId` is the caller, never a body field |
| `contactMethod` | `in_world_message`, `party_invite`, or `profile` |
| `contactLabel`, `contactValue` | How another player reaches the author. `profile` stores the author's own id |
| `status` | `open`, `withdrawn` (author closed it), or `expired` (a read at or after `expiresAt`) |
| `createdAt`, `updatedAt`, `expiresAt` | Injected UTC timestamps |

A connect request stores `requestId`, `listingId`, `requesterId`,
`requesterDisplayName`, `message`, and `status` (`open`, `withdrawn`,
`accepted`, `declined`). Its view copies the listing's current contact fields
so both sides still see how to connect.

The default store is memory. `createWonderlandLffFileStore` writes the same
snapshot under `<root>/wonderland-lff/board.json` and keeps the previous file.
There is no SQL migration in this change. Two players see the same rows when
they are handed one board, including a board opened later on the same directory.

## API

`handleLffHttp` in `relay-bridge/wonderland-lff-routes.ts` takes the board, the
caller id, the method, the path, a JSON body, a query map, and `nowIso`. It is
not registered on `server.ts` or in `SOCIAL_OPERATIONS` here, so the live bridge
does not answer these paths until a composition root calls the handler.

Success answers are `{ ok: true, result }` with HTTP 201 for create and 200
otherwise. Failures are `{ ok: false, error: { code, message } }`.

`GET /lff/posts` reads `query.category`. Omit it to read every open category.

The caller is the actor. `authorId`, `actorId`, `fromUserId`, `ownerId`,
`posterId`, or `requesterId` in a body must match the caller when present.

## UI flow

1. The player opens Looking for Feed in the Social Hub.
2. They pick one of the five labels, or all of them.
3. The client calls `GET /wonderland/social/lff/posts` with an optional
   `category`.
4. Each row shows the category label, title, body, the poster's display name
   and id, and the contact label plus contact value.
5. The player posts with `POST /lff/posts`.
6. Another player sees that row on their next list of the same board.
7. The author edits with `POST /lff/posts/:id/edit`, withdraws with
   `POST /lff/posts/:id/close`, or deletes with `POST /lff/posts/:id/delete`.
8. The next read at or after `expiresAt` drops the row from every open feed.
   The author's own read shows `expired`.
9. Another player may `POST /lff/posts/:id/requests`. The author accepts or
   declines. The requester withdraws with `POST /lff/requests/:id/withdraw`.
   That answers the request. It does not open a private server and it does not
   start a GVE match.

`WonderlandLffFeed.h` is the row the hub can draw: category id, label, poster,
contact, status, and expiry. The client should draw rows the handler already
returned; the C++ predicate is the same open-feed rule for a local row.

## What this change does not do

It does not implement private servers or GVE. It does not mint a party. It does
not change a readiness percentage or a scorecard. It does not mount the handler
on the running bridge. It does not serve `POST /reports`. It does not apply a
block list. The desktop author row's presence is a stand-in, not a live
presence. Unreal Engine was not available to compile the client. The client
view itself is not in this branch: it lives on
`backup/wonderland/r16reh16w-aa930c26` at `f1fbb264f1936924ce685a4b0234df3dc28fcae5`,
which is contained in tip `aa930c269c43a52fc31c785f7bdcc231c8af6cf0`.

## Desktop client contract

Source of truth for the client:
`wonderland/Source/Wonderland/WonderlandSocialLffView.cpp` and
`WonderlandSocialLffView.h` as of `f1fbb264f1936924ce685a4b0234df3dc28fcae5`
on `backup/wonderland/r16reh16w-aa930c26`. Those two files are unchanged
between that commit and the branch tip `aa930c269c43a52fc31c785f7bdcc231c8af6cf0`.
The view calls `IWonderlandSocialService`. The HTTP paths and JSON bodies are
the ones `WonderlandSocialLive.cpp` on that same commit sends for those calls.
The URL is `baseUrl + "/relay-api/wonderland/social" + path`.

The paths match. Both sides use:

- `GET /lff/posts`
- `POST /lff/posts`
- `GET /lff/posts/:id`
- `POST /lff/posts/:id/edit`
- `POST /lff/posts/:id/close`
- `POST /lff/posts/:id/delete`
- `GET /lff/posts/:id/requests`
- `POST /lff/posts/:id/requests`
- `GET /lff/requests`
- `POST /lff/requests/:id/withdraw`
- `POST /lff/requests/:id/accept`
- `POST /lff/requests/:id/decline`

Mismatches between that view and `relay-wonderland-lff.v1`, and what this
handler does about each one:

1. The view treats every status other than 200 as failure, and reads the object
   `data`. v1 answers `{ ok, result }` and uses 201 for create. A desktop
   create (no `displayName`, no `body`, no `contactMethod`) is HTTP 200 with
   `data.postId` and still carries `result` for v1. A v1 create stays 201.
   A desktop join request (no `displayName`) is HTTP 200 with `data.requestId`.
   A v1 request that sends `displayName` stays 201. Reads are 200 and carry
   both `result` and `data`.

2. The view's categories are `TEAMS`, `BUILDERS`, `AI_ENGINEERS`, `DESIGNERS`,
   `COMPETITORS`, `COLLABORATORS`. Its labels are "Teams", "Builders",
   "AI engineers", "Designers", "Competitors", "Collaborators". v1 stores
   `teams`, `builders`, `ai_engineers`, `designers`, `competitors` and the
   "Looking for …" labels, and does not name collaborators. Both spellings of
   the five are accepted. `COLLABORATORS` is stored as `collaborators`.
   `data.category` is the view's token and `data.categoryLabel` is the view's
   label. `result.category` stays the stored spelling.

3. The view's create and edit body is `category`, `title`, `description`
   (empty allowed, at most 1000), `projectLabel` (empty allowed, at most 80),
   `skills` (at most 8 strings, each at most 32), `openSlots` (1 to 20).
   v1 create requires `body` (at most 400), `displayName`, and a contact pair.
   The desktop fields are stored. A missing display name and contact are filled
   from the caller id so the v1 row still has them. A v1 body still validates
   as before.

4. The view's feed query is `limit` (1 to 50), `category`, `projectLabel`
   (substring), `skill` (one whole skill), `mine=1`, `hasOpenSlots=1`, and
   `cursor` as `<milliseconds>.<serial>`. v1's query is `category` only.
   `data` is `{ posts, nextCursor }` newest first, one page, `nextCursor` null
   on the last page. `result` stays the unpaged v1 open feed.

5. The view's post object uses `postId`, `description`, `projectLabel`,
   `skills`, `openSlots`, `availableSlots` (a number for the owner, null for
   everyone else), `status` of `OPEN`, `CLOSED`, or `EXPIRED`, `createdAtIso`,
   `updatedAtIso`, `expiresAtIso`, `version`, `author` (a person row whose
   `presence` has `userId`, `onlineState`, and a non-empty `headline`),
   `viewerIsOwner`, and `viewerRequest` (null, or `{ requestId, status }` of
   `PENDING`, `ACCEPTED`, `DECLINED`, `NO_LONGER_AVAILABLE`). v1 uses
   `listingId`, `body`, `authorId`, `authorDisplayName`, the contact fields,
   and `open`, `withdrawn`, `expired`. `data` uses the view's names.
   `withdrawn` is `CLOSED` in `data` and `withdrawn` in `result`.

6. Detail adds `authorProfile` and `accepted`. This board has no profile
   card, so `authorProfile` is null. `accepted` is the accepted people for the
   owner and for a player who was accepted, and null otherwise.

7. `GET /lff/requests` for the view is the caller's own requests, with `post`
   null once the listing is not open, a pending request on that listing shown
   as `NO_LONGER_AVAILABLE`, and a withdrawn request left out. `truncated` is
   true when the list was cut at 100. v1 `result.requests` is unchanged and
   still includes requests the caller is a party to.

8. `GET /lff/posts/:id/requests` for the view is `{ postId, requests }` and
   lists only `PENDING` and `ACCEPTED`, each with a `requester` person row.
   v1 `result` still includes a declined request and is still readable by the
   requester. `data.requests` is that inbox for the owner, and empty when the
   caller is the requester rather than the owner.

9. Close is the same path. The view calls it `lff.post.close` with an empty
   object and then shows `CLOSED`. The stored status remains `withdrawn`.

10. The view's report is `POST /reports` with `reportedId` set to the author,
    `reason` set to `OTHER`, and `subjectRef` set to the post id. That is the
    social reports route, not this handler.

11. The view drops a post whose author it may not see, and drops a request a
    block crossed. This board has no block list, so it does not do that.

12. The view's author presence comes from the social presence authority. The
    `data.author.presence` on this board is a stand-in: `onlineState` is
    `OFFLINE` and `headline` is the display name. It is enough for the view's
    parser and it is not a live presence.

13. Filling every `openSlots` does not by itself close the post. `availableSlots`
    counts acceptances for the owner. Close, delete, and expiry are unchanged.

`POST /lff/posts/:id/edit`, `delete`, and the three request decisions stay on
the same paths. The view sends an empty object for close, delete, withdraw,
accept, and decline, and does not read those success bodies beyond HTTP 200.

## Mount, not applied

`handleLffHttp` is not called from `relay-bridge/server.ts` in this change.
`isSocialRoute` matches every `/wonderland/social` path, so a later handler
would never see `/wonderland/social/lff`. The block below is the one to place
immediately before `if (isSocialRoute(path.replace('/relay-api', '')))`. It is
not applied here. The query decoder keeps a decoded `projectLabel` and `skill`,
including spaces, and leaves a plus sign as a plus sign. One decode only.

```typescript
import { createWonderlandLffFileStore } from '../src/relay/persistence/wonderland-lff-file-store';
import { WonderlandLffBoard } from '../src/relay/mission/wonderland/wonderland-lff';
import { handleLffHttp } from './wonderland-lff-routes';

const lffBoard = new WonderlandLffBoard(
  () => `lff_${randomUUID().replace(/-/g, '')}`,
  createWonderlandLffFileStore({ root: process.env.WONDERLAND_LFF_DIR?.trim() || '/data/wonderland-lff' }),
);

const lffPath = (req.url ?? '/').replace(/^\/relay-api/, '');
const lffPathname = lffPath.split('?')[0] ?? lffPath;
if (lffPathname === '/wonderland/social/lff' || lffPathname.startsWith('/wonderland/social/lff/')) {
  if (!socialEnabled) {
    send(res, 503, { error: { kind: 'social_unavailable', message: 'Social is not available on this server.' } }, cors);
    return;
  }
  if (origin !== undefined && origin !== '') {
    send(res, 403, { error: { code: 'desktop_only', message: 'Wonderland social is reached from the Wonderland desktop client.' } }, cors);
    return;
  }
  const lffHeader = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined;
  const lffToken = lffHeader?.match(/^Relay-Session\s+(.+)$/i)?.[1] ?? null;
  const lffFacts = lffToken === null ? null : browserSessions.verifyNativeSocialSession({ token: lffToken, now: Date.now() });
  if (lffFacts === null || !lffFacts.ok) {
    send(res, 401, { error: { code: 'session_required', message: 'Sign in to Wonderland to use social.' } }, cors);
    return;
  }
  const lffQuery: Record<string, string | undefined> = {};
  const lffSearch = lffPath.split('?')[1] ?? '';
  for (const pair of lffSearch.split('&')) {
    if (pair.length === 0) continue;
    const at = pair.indexOf('=');
    const rawKey = at < 0 ? pair : pair.slice(0, at);
    const rawValue = at < 0 ? '' : pair.slice(at + 1);
    const decode = (text: string): string | null => {
      try { return decodeURIComponent(text.replace(/\+/g, '%2B')); }
      catch { return null; }
    };
    const key = decode(rawKey);
    const value = decode(rawValue);
    if (key === null || value === null) continue;
    if (!['limit', 'category', 'projectLabel', 'skill', 'mine', 'hasOpenSlots', 'cursor'].includes(key)) continue;
    if (key.length > 32 || value.length > 200) continue;
    if (/[\u0000-\u001f\u007f]/.test(key) || /[\u0000-\u001f\u007f]/.test(value)) continue;
    lffQuery[key] = value;
  }
  const lffResult = handleLffHttp(lffBoard, {
    method,
    path: lffPathname,
    actorId: lffFacts.participantId,
    body: method === 'POST' ? await readBody(req) : undefined,
    query: lffQuery,
    nowIso: new Date().toISOString(),
  });
  send(res, lffResult.status, lffResult.body, { ...cors, 'cache-control': 'no-store' });
  return;
}
```
