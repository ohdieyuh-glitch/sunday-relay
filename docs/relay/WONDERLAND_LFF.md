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

The store is one `WonderlandLffBoard` in memory. Every player who is handed that
instance sees the same rows. A process restart clears them. There is no SQL
migration in this change.

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
on the running bridge, and it does not persist the board across a restart.
Unreal Engine was not available to compile or run the client.
