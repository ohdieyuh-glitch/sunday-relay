# Does cbe584be's own dev-social-server.ts serve every route the B33 client uses? (W2DEV, 2026-10-20, read-only)

DIAGNOSTIC record, W2DEV, not evidence by itself. Nothing was built or run. Everything below was read with `git show`.

## Sources

| Side | Repo | Commit | Files read |
|---|---|---|---|
| Server | `C:\dev\iwonder\sunday-relay` | `cbe584becf417c48cc4de8efe8a2fa16f404c0bf` | `relay-bridge/dev-social-server.ts`, `relay-bridge/wonderland-social-routes.ts`, `relay-bridge/wonderland-social-scope.ts` (SOCIAL_OPERATIONS), `src/relay/social/world-presence.ts` |
| Client | `C:\dev\iwonder\wonderland-w2dev` | `1e7cdebb` | `wonderland/Source/Wonderland/WonderlandSocialLive.cpp` (Call: URL = BaseUrl + "/relay-api/wonderland/social" + path, L133/L369), `WonderlandSocialSubsystem.cpp` (ConnectDevSession) |

The import closure is in `import_closure_cbe584be.txt`, from `..\relay_import_closure.py`.
- `dev-social-server.ts` at cbe584be pulls in 31 files, all under `relay-bridge/` or `src/`.
- Its one bare package is `pg`. It is present in `C:\dev\iwonder\_r16fix_relay_pristine_20261020\node_modules`. That tree's package-lock.json blob is `c44cfffc91a81cc639b9d527e919a127bfd83c38`, identical to cbe584be's.
- So `git archive cbe584be relay-bridge src package.json` covers everything the bundle needs.

## How the dev server routes a request

From `dev-social-server.ts` at cbe584be:
- It strips a leading `/relay-api`.
- `POST /dev/session` mints a session: player `^[a-z][a-z0-9_]{1,23}$`, holding the `social` capability, with no scope field, which is read as `native_world`.
- Every other path goes to `handleSocialRoute`. That function admits exactly the method and path pairs in `SOCIAL_OPERATIONS` (`wonderland-social-scope.ts`), under `/wonderland/social`, and answers 404 to anything else.
- The bundle listens only if its file name matches `/dev-social(-server)?\.(m?js|ts)$/`, so the launcher names it `dev-social.mjs`.

## Routes the client's world presence and dev session use (1e7cdebb), all served at cbe584be

| Client call (1e7cdebb) | Server at cbe584be | Served |
|---|---|---|
| `wl.Social.Dev` -> ConnectDevSession: `POST <base>/dev/session` `{"player": lower(name)}` (SocialSubsystem L482-485) | dev-social-server.ts `POST /dev/session` | yes (`wlautoa`/`wlautob` match the player rule) |
| world join: `POST /world/join` (SocialLive L952) | `world.join` POST `/wonderland/social/world/join` | yes |
| world report: `POST /world/state` (L793) | `world.state` POST `/wonderland/social/world/state` | yes |
| world leave: `POST /world/leave` (L1072) | `world.leave` POST `/wonderland/social/world/leave` | yes |
| population: read from the join/report answer, `context.population` (L183); avatars with `ageMs` (L205) | `worldViewFor` (world-presence.ts L340-372): `context.population`, `avatars[].ageMs`, `reportedAtMs` | yes |
| social reads at sign-in: `GET /snapshot` (L512), `GET /events?after=` (L1119), `POST /presence` (L1608) | `snapshot.read`, `events.stream`, `presence.update_self` | yes |
| voice config `GET /voice/eos-client-config` (L361) | `voice.eos_client_config` | yes (no EOS config on the dev server: 503, which the client maps to voice unavailable) |
| `GET /profiles/:id` (L1545/1574), friends, requests, blocks, mutes, reports, conversations, parties, party-invites, world invites | all in SOCIAL_OPERATIONS | yes |

## Missing at cbe584be: the LFF routes only

The 11 LFF routes are not in cbe584be's SOCIAL_OPERATIONS, so its dev server would answer 404:
- `GET /lff/posts`, `GET /lff/posts/:id`, `GET /lff/posts/:id/requests`, `GET /lff/requests`
- `POST /lff/posts`, `/lff/posts/:id/edit`, `/lff/posts/:id/close`, `/lff/posts/:id/delete`, `/lff/posts/:id/requests`
- `POST /lff/requests/:id/withdraw|accept|decline`

They are LFF 037, in the integration branch.

At 1e7cdebb these are called only from the Social Hub's LFF view (`WonderlandSocialLffView.cpp` L887 and the LFF list/create paths) and from the LFF QA module (`WonderlandSocialLffQa.cpp`). They are not called from world presence or sign-in. The B33 drive never opens the hub, so B33 does not reach them.

**None of the routes the B33 world presence or the dev session needs is missing.** No other tree is substituted.
