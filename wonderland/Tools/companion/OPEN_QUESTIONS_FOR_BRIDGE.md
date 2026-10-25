# Open questions for BRIDGE: companion client (v0.2, after 7e5e1e30)

From Cosmo, Sat Oct 24 2026, about 6:30 AM PT. Only questions that are still **open** are listed here. Everything BRIDGE's code settled was applied to the client; the list of what was settled, with citations, is in `README.md` under "Aligned with BRIDGE 7e5e1e30".

Read against branch `bridge/wonderland-julius-companion-route-20261024` at `7e5e1e306be1b3f155e7066221f1ca177f46fc33` (tree `cf15fe68`):

| File | Blob |
|---|---|
| `docs/companion/universal-companion-contract-v0.2.md` | `2d52744bb03f90f8a0cc67f45bacae446e4f609f` |
| `relay-bridge/wonderland-companion-route.ts` | `d0f5bae171c452d3c143f3f7ab27da44d160c42f` |
| `relay-bridge/wonderland-companion-registry.ts` | `6cc93aa168c6b7e61bdeb94d81e01881ed71843e` |
| `relay-bridge/wonderland-admission-route.ts` | `7790dfd9be63539e35d1fd10318dd0d6bc4a2279` |

Each open item names what the client does today. Every choice fails closed, sits in one place in `WonderlandCompanionLogic.h/.cpp` or `WonderlandCompanionClient.cpp`, and takes one line plus KAT rows to change.

## Chat and history (no route at 7e5e1e30)

**O1. Chat and history routes and envelopes.** contract-v0.2 lines 46 and 139 say paths under `/companions/agents/{agentId}/` are not served, and route.ts:55-57 matches only `agents` and `agents/{agentId}`.
- Client today:
  - `FCompanionSession` takes `bChatRouteServed`, which is false by default and in the adapter.
  - While it is false, no agent can send. The HUD says "Chat with agents is not available on this relay yet", and nothing is sent to `…/chat` or `…/conversations/{cnv}`.
  - The provisional paths are still `POST …/agents/{agentId}/chat?projectId=` and `DELETE …/agents/{agentId}/conversations/{cnv}?projectId=`, with the v0.1 body and SSE grammar.
- Which paths, bodies and stream will ship? Please flip the switch only with the real ones.

**O2. The chat capability word, and the capability grammar.** registry.ts accepts any string as a capability and names none (A3).
- Client today: it chats only when `authorizedCapabilities` contains exactly `chat`. A capability word is 1-64 bytes of `[A-Za-z0-9_.:-]`, at most 64 per list, and a duplicate faults the slot.
- What is the word for chat? What are the limits?

**O3. Chat meta identity (A7).** The client requires the v0.1 meta `provider` to equal the agent's `providerId` byte for byte. Will meta carry the providerId, the agentId, or both?

**O4. v0.1 chat confirmations still pending.** These only matter once O1 ships:
- Replays are one delta of at most 64 KiB (Q3/Q5).
- `meta` comes first on every stream, replays included.
- `replayed` is a bool.
- The resend pins `conversationId`/`messageId`.
- `id:`/`retry:` are forbidden.
- Retry-After and `retryAfterMs` are per agent (A19).
- The "key rejected" mark from `provider_auth_failed` is sticky until a successful connect (Q12).

## Credentials and session

**O5. How does a player's own provider credential reach an adapter?** route.ts refuses `apikey`/`token`/`password` at any depth with `400 companion_credentials_rejected` (route.ts:58, 288-290, 367-375), and no other route takes a credential.
- Client today: connect sends `{providerId[, wljRunId][, displayName]}` only. No key is collected or sent.
- `FMaskedKeyField` (wipe-on-destroy, never logged) is kept but not used, so a future adapter auth flow has somewhere to start.
- Is BYOAI credential entry out of the game client entirely (adapter-side sign-in), or will a separate route take it?

**O6. Relay-Session on the companion routes.** juliusLoopbackGuard runs on every agent route (route.ts:258) and needs `authorization: Relay-Session <token>` for a paired session (admission-route.ts:272-274).
- Client today: the core's `FRelayRequest` has no auth field. The UE seam (`WonderlandCompanionClient.cpp`) does not set the header and must reuse #433's paired session.
- Confirm that the companion routes take the same token as `/julius/dispatch`, and that the adapter should copy #433's header code rather than a new one.

**O7. Browser `Origin`.** The guard refuses any request carrying an `Origin` header (admission-route.ts:266-268). UE's HTTP module sends none by default; the seam adds none. Confirm that no proxy in the paired setup adds one.

## Descriptor details the code leaves open

**O8. `adapterVersion` bounds.** registry.ts:195 publishes any non-blank string or null.
- Client today: it accepts null or 1-64 printable ASCII bytes. Anything else faults the slot (`bad_adapter_version`).
- Is there a format (semver?) or a cap?

**O9. List and registry limits (A15).** route.ts and registry.ts set no count limit on `agents[]` (`agentsFor`, registry.ts:284).
- Client today: it reads at most 64 entries per list (one anonymous `too_many` slot past that) and holds at most 32 agents per session.
- What are the server's limits per mission and per player?

**O10. Why an agent is in `error` (A20).** An `error` descriptor carries no reason (registry.ts:200-209). The client shows a fixed "Connection error; reconnect your agent" line. Will a reason word be added?

**O11. `wakeId` format.** route.ts:598 accepts any string or null.
- Client today: null or a string of at most 256 bytes, sanitized before display, never parsed.
- Is it a known id shape with a known cap?

## Status route (v0.1, unanswered)

**O12. `workflowRunId`.**
- Client today: absent, null, or 1-128 bytes of printable ASCII without space are accepted (and ignored).
- An empty string, an over-cap or non-printable string, or a JSON number is `bad_workflow_run_id`.
- Can the server send a GitHub run id as a number, or a value longer than 128 bytes?

## traceId (#447, 081d46e6)

**O13. Checking the derivation on the client.**
- Client today: `traceId` is read as reported (32 lowercase hex, not all zero). The core has no SHA-256, so it cannot check that the id is `julius-trace.v1:` + the `wlj_` id. A well-formed id for another run is shown as is.
- Should the client re-derive it in the adapter (an engine SHA-256 API, UNVERIFIED), or is "parse, don't compute" the rule?
