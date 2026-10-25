# BRIDGE audit — Wonderland player to paid Julius mission

Date: 2026-10-23. Auditor: BRIDGE (integration seam only).
Base: `main` `f539cab2530b7733bd987068be676308440e04a5` (`f539cab2`, PR #395).
No provider was called. No workflow was dispatched. No secret was read.

This is a read of the seam. It is not a claim that a Wonderland player can spend.

## 1. Records read

### C2 / J1 resolutions

Not on `main`. Current proposal is YUJI rev 7:

- Branch `docs/julius-c2-j1-resolutions-20261023`
- Commit `af3c105f0449f42efbaaea407ea261dda998f155`
- File `docs/C2_J1_RESOLUTIONS_20261023.md` (blob noted by YUJI as `cf528758` in the client header)

Status on that commit: **PROPOSAL ONLY**. It says none of the seven resolutions needs a J1 code change, and that the passed J1 tree stays at `31bfc58b`. Two founder rulings are marked DECIDED (07:27 PT, 2026-10-23):

- **R4-F.** A scrubbed or cut artifact qualifies only when an independent check holds the original and reproduces the shown text with J1's scrub, cut, and trim. A `[redacted]` marker or an 8,000-unit length is not proof.
- **(c) / FR-c.** Run ids are client-minted lowercase UUIDv4s. After any refusal the client mints a new run id and a new idempotency key. `wlj_` plus that UUID passes the bridge `RUN_ID` rule.

Conflict 2 on that doc says `POST /relay-api/julius/missions` stays out of the J1 path because it is operator-only and mints its own run id. YUJI's later instruction (this engagement) puts the unpaid admission adapter on BRIDGE and points it at that POST's gap (`dispatched: false`), without mounting the provider chain.

### J1 dispatch contract (not on main)

`relay-bridge/julius-dispatch.ts` exists at `31bfc58b89de137670e5dbaf752c3328b31163f7` (blob `018fb582` per the client). That commit is **not** an ancestor of `f539cab2`. The file is absent on main. It is a loopback, founder-only, flag-gated route that can call role ports. BRIDGE did not copy that chain.

Kinds this audit treats as frozen, from that file:

| Status | Kind | Client class at a821a467 |
|---|---|---|
| 202 / 200, no error object | — | Accepted |
| 429 | `julius_dispatch_cap_reached`, `julius_dispatch_mission_cap_reached` | Refused (fresh pair) |
| 429 | `julius_dispatch_busy` or any other kind | NoAnswer (same pair) |
| 4xx/5xx with an error kind | the existing J1 kinds | Refused |
| bare 5xx, no kind | — | NoAnswer |

Path: `POST /wonderland/julius/dispatch`. Run id rule `^[A-Za-z0-9:_-]{1,128}$` (line 962). Idempotency key `^[A-Za-z0-9_-]{8,80}$` (line 964). Success body `{ data: { runId, dispatchId, state, replayed, ledgerRef, mode } }`. Error body `{ error: { kind, message } }`.

### Wonderland client (not on main)

Cosmo r2, not merged:

- Branch `wonderland/j1-client-recut-r2-20261023`
- Commit `a821a46786ba51779e7a1bfb7c40b9ad453b5ce8` (parent is `f539cab2`)
- `wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.h`
- `wonderland/Source/Wonderland/WonderlandJuliusMissionLogic.cpp`
- `wonderland/Tools/j1_logic_kat.cpp`
- `src/relay/mission/wonderland/wonderland-j1-logic.test.ts`

Frozen draft #396 is the earlier cut (`b86efac5` on `wonderland/j1-client-logic-20261023`). r2 is the logic BRIDGE read. BRIDGE did not edit those files.

The pure logic mints `wlj_` + UUIDv4, a separate UUIDv4 key, and classifies answers in `ClassifyDispatchAnswer`. Resends of a NoAnswer use 2s, 4s, 8s, 16s, then 30s, at most 8 resends or 180s (`NextResend`). There is no HTTP, JSON parser, or display in that layer. The header says the Unreal wrapper is later work.

### Mission contracts on main

| Record | Path |
|---|---|
| Julius ↔ Wonderland read contract | `docs/JULIUS_WONDERLAND_CONTRACT.md` |
| Wonderland backend contract | `docs/relay/WONDERLAND_BACKEND_CONTRACT.md` |
| Live mission file parsed by the bridge | `relay-bridge/julius/mission-contract.ts` (`LiveMissionContractFile`) |
| Relay mission contract → bootstrap request | `src/relay/integration/julius/mission-bootstrap-adapter.ts` |
| HTTP create | `relay-bridge/julius-mission-routes.ts` |
| Mount | Existing `isJuliusMissionRoute` call in `relay-bridge/server.ts`, widened by `isWonderlandAdmissionRoute`. The Wonderland catch-all does not claim this path. |

`POST /relay-api/julius/missions` parses the contract with the job's parser, bootstraps a `READY` run through `createLiveJuliusBootstrapPort`, and returns `dispatched: false` (`julius-mission-routes.ts` lines 26–35 and 189–198). Creation does not compose a provider.

### Reviewed provider / model contract

The pin that the paid workflow enforces is `.github/workflows/julius-first-live-mission.yml`:

```yaml
OPENAI_PROMPT_ARCHITECT_MODEL: gpt-5.6-sol
RELAY_HOSTED_CODING_MODEL: claude-opus-5-5
RELAY_HERMES_PROVIDER: xai
RELAY_HERMES_MODEL: grok-build-0.1
```

Those assignments are the env block at lines 292–308. The preflight then refuses any other resolution (lines 1149–1151):

```bash
grep -q 'architect=gpt-5.6-sol'
grep -q 'coder=claude-opus-5-5'
grep -q 'reviewer=xai/grok-build-0.1'
```

The workflow comment at 296–300 says the coder pin is Claude Opus 5.5 on the founder's Claude Max subscription (`CLAUDE_CODE_OAUTH_TOKEN` is what the smoke step passes). YUJI described this as mid-migration toward Anthropic API billing. The identifier in the file is `claude-opus-5-5` either way. BRIDGE did not change it.

`relay-bridge/julius/live-composition.ts` reads the architect model from the architect env config and the coder model from `RELAY_HOSTED_CODING_MODEL`. An absent coder model stays null. It does not embed these three ids.

### Accepted tests and recent main

`main` tip `f539cab2` is landing v3.5i package 3 (PR #395). Recent parents include `689d2be9` (PR #394, B33 tools) and `3f20fc1a` (PR #392). BRIDGE did not re-run the full historical suite as a release certification.

Open pull requests sampled on 2026-10-23 (not merged, not edited here):

| PR | What it is | Why BRIDGE stayed out |
|---|---|---|
| #396 | J1 client pure logic, draft, do not merge | Cosmo / frozen client |
| #400 | Allowlist line for a J1 re-cut branch | `allowed-branches.txt`, founder-governed |
| #397, #398 | Landing identity and clearance | landing / provenance |
| #399 | Slot-view evidence projection | `julius-runtime-api.ts` in flight |
| #401 | Halt when architect or reviewer is not the requested model | YUJI live path |
| #403 | Reviewer provider request id | YUJI |
| #404 | Namespace spend ceilings | YUJI |
| #406 | FORGE LFF draft; will mount routes in `server.ts` | Left `server.ts`'s Wonderland block untouched |
| #391 | Landing v3.4 package 2, still open | Gatekeeper |

## 2. End-to-end hops

| Hop | Status on main `f539cab2` | Evidence |
|---|---|---|
| Wonderland player action | **Missing** on main. **Partial** on `a821a467`: pure mint + classify only. No Unreal call, no HTTP. | Client header at a821a467. `wonderland/` on main has no `WonderlandJuliusMissionLogic`. |
| Mission creation | **Implemented**, operator-only, bootstrap only. | `julius-mission-routes.ts`, `docs/JULIUS_WONDERLAND_CONTRACT.md` "How a mission is created". Run id is `run:<identity>` from `relay-bridge/julius/bootstrap.ts`, not `wlj_`. |
| Authorized dispatch into the paid workflow | **Missing** as a join. The workflow and its gates **exist**. Nothing HTTP-side calls them. | `.github/workflows/julius-first-live-mission.yml` lines 1–20 and 136–138 (`paid-slot` runs only when `confirm_live == 'RUN LIVE MISSION'`). `scripts/julius-paid-slot.mjs`, `scripts/julius-paid-dispatch.mjs`. |
| Julius agent execution | **Implemented inside the workflow**, unreachable from the game. | Same workflow, live step passes `--confirm-live` only after the phrase, the environment, contract check, and paid-slot. |
| Progress events | **Partial**. Operator read routes serve Julius views. The game has no progress renderer. J1's event route is only at 31bfc58b. | `docs/JULIUS_WONDERLAND_CONTRACT.md` read routes. PR #359 (`b7f9cc24`) keeps Julius ledger rows out of the browser replay. |
| Result artifact | **Partial**. Julius `result` view exists for the operator. J1's `{ data: { runId, state, mode, resultText, resultSha256 } }` is at 31bfc58b line 913 and is not mounted on main. | Contract doc. Dispatch file at 31bfc58b. |
| Artifact verification | **Partial**. Client hash check exists only on a821a467. R4-F says the shown artifact is not qualifying without an independent reproduction. Skywalker owns that acceptance. | Resolutions rev 7. Client `CheckArtifactDigest`. |
| In-game display | **Missing**. | Client header: wrapper is later work. Cosmo owns the trace. |

`julius-dispatch.ts` at 31bfc58b is a **divergent** execution path relative to the paid workflow: it drives role ports in-process. It is not the GitHub workflow. Mounting it would be a second spender. It is not on main, and this change does not add it.

## 3. Why creation and paid execution are separate

Creation (`POST /relay-api/julius/missions`) writes a durable `READY` run and says `dispatched: false`. The only workflow that may spend is `julius-first-live-mission.yml`. It has no `push`, `pull_request`, or `schedule` trigger. A person must type `confirm_live = RUN LIVE MISSION`. The job then runs in the `julius-live-validation` environment, runs the contract check and preflight, and passes `--confirm-live` only when that phrase was present. `paid-slot` (`scripts/julius-paid-slot.mjs`) admits at most one paid run and refuses a second run that carries an earlier dispatch key.

Those two sides do not call each other. A client that treated "created" as "running" would draw a mission nobody is driving (the contract doc says this in those words).

Joining them without a second mechanism means recording **one admission ticket** whose dispatch key the existing paid-slot rule already understands, and leaving `confirm_live` empty so the ticket cannot satisfy the spend phrase. A human, later, can hand that key to the existing `scripts/julius-paid-dispatch.mjs` / workflow inputs. This repository change does not perform that handoff.

## 4. Model identifiers

From `.github/workflows/julius-first-live-mission.yml` lines 295, 301, and 303, confirmed by the preflight greps at 1149–1151:

| Role | API | Model id |
|---|---|---|
| Prompt Architect | OpenAI | `gpt-5.6-sol` |
| Coding Agent | Anthropic (pin is Opus 5.5; workflow comment says Claude Max subscription, migration toward API billing is not a second id) | `claude-opus-5-5` |
| Reviewer | xAI | `grok-build-0.1` (`RELAY_HERMES_PROVIDER: xai`) |

The adapter parses those four env names from workflow text. If a name is missing or duplicated, the field is null. It does not substitute another model.

### Disagreements (not changed; YUJI-owned)

- `src/relay/mission/role-slots/role-slot-registry.ts`: Prompt Architect and Coding Agent `qualifiedServedModels` are empty. `hermes_local` lists only `grok-build-0.1`. The workflow pins are stricter than the registry for the first two roles, and the registry does not record `gpt-5.6-sol` or `claude-opus-5-5` as verified served models.
- Test fixtures still inject `claude-fable-5` as `RELAY_HOSTED_CODING_MODEL`, including `relay-bridge/julius/julius-live-composition.test.ts` (the `LIVE_ENV` block). That is not the workflow pin. Production composition reads the env var; the fixtures do not follow the workflow.
- `CLAUDE.md` still mentions `OPENAI_PROMPT_ARCHITECT_MODEL=gpt-4o` in the 2026-08-02 notes. The workflow on this main does not.

## 5. Cross-cutting assessment

| Concern | What exists | Gap |
|---|---|---|
| Mission identity | Server bootstrap id `run:…`. Client id `wlj_` + UUIDv4, decided in FR-c, implemented only on a821a467. | The two ids are not the same record. This adapter admits the client pair and does not create a second Julius `READY` run. |
| Idempotency | Mission POST is content-addressed. Paid workflow keys are `[A-Za-z0-9._@#-]{8,96}` and `paid-slot` returns `REFUSE_DUPLICATE`. J1 replays a matching key as HTTP 200. | Nothing on main tied a game resend to that key. The adapter now reserves the pair before the ledger write. |
| Progress | Operator `GET /relay-api/julius/runs/<id>/<view>`. Ordering is ledger sequence. | Game does not render it. `null` is Unknown. |
| Failure | J1: refused, cap, busy, orphan, ledger failure. Workflow: preflight stops without `--confirm-live`. Paid-slot does not retry a duplicate. | A failed or interrupted game mission must not auto-dispatch. The adapter has no retry loop. |
| Result delivery | Operator `result` view. J1 result body is hashed `resultText`. | Not mounted for the game on main. |
| Artifact verification | Client check on a821a467. R4-F fail-closed. | Display must not show a scrubbed artifact as qualifying. Wrapper not in this PR. |
| Correlation | J1 binds `clientTriggerId`, `clientLogSha256`, `clientUiActionUtc` into the accept path before provider calls. | Adapter stores run id, request id, key **hash**, timestamps, ledger ref, and `resultSha256` (null until bound once). |
| Session auth | Mission POST is operator `Bearer`. J1 dispatch refuses the operator bearer and requires a native session, loopback, one founder, one project. | Adapter uses that J1 order. `JULIUS_WONDERLAND_ADMISSION` defaults off. |
| Player authorization | Wonderland routes resolve `playerId` from the session, not the body (`docs/relay/WONDERLAND_BACKEND_CONTRACT.md`). | Admission uses the native session's player and refuses anyone but `JULIUS_J1_FOUNDER_PLAYER_ID`. |
| Credential isolation | Operator token is server-only. Workflow credentials sit on the GitHub Environment. | Adapter does not read provider keys. The idempotency key is hashed before it is stored. |
| Replay | Same pair returns the existing run. A different key for the same run is `409 julius_dispatch_already_dispatched`. A reused key is `409 julius_dispatch_key_reused`. | 409 carries an error kind, so the **client** classifies it as Refused and mints a fresh pair. That matches `ClassifyDispatchAnswer`. It is not a same-pair resend. |
| Spend caps / landing | See the spend-cap note below. Landing is G6 / `allowed-branches.txt` (PRs #397, #398, #400). | Adapter 429s are the existing J1 **count** caps. Dollar and repair ceilings stay on the workflow path. |

### Spend caps (founder room directive, 2026-10-23)

The room directive is **$30 per run, 3 repair cycles, and $60 combined**. Those three figures are not a global pin in this repo. This adapter does not hard-code them. `30_000` in the admission contract is the client resend delay cap in milliseconds.

Where a real spend is limited today, on main `f539cab2`:

- `.github/workflows/julius-first-live-mission.yml` runs `scripts/julius-live-contract-check.mjs` on the paid-slot job (line 203, with `--lane`) and again in preflight (lines 954 and 956). The script refuses a contract with no `limits`, and refuses `spendUsd` or `repairCycles` above `ceilingsFor(namespace)`.
- `ceilingsFor` on main is per namespace. `DEFAULT_LIMITS` is `spendUsd: 5`, `repairCycles: 1`. Examples already at 30/3 include `julius-live-mission-5`, `julius-unreal-mission-1`, and the learning pairs. `julius-continuous-1` is 60/3. Some diagnostic namespaces are 100/3. That table is not the room directive, and it is not applied as one ceiling to every run.
- Inside a run that has passed that check, `julius-allocation.v1` sets the coder share to `floor(spendUsd / (1 + repairCycles))`, bounded by what remains.
- The paid job runs only when `confirm_live` is exactly `RUN LIVE MISSION` (workflow line 138), inside the `julius-live-validation` environment, and the live step passes `--confirm-live` only after those gates. `scripts/julius-paid-slot.mjs` then admits one dispatch key.
- `JULIUS_J1_COMBINED_CAP_USD` exists in `julius-dispatch.ts` at 31bfc58b. That file is not on main. This adapter does not read it.

YUJI's durable cap work in `scripts/julius-live-contract-check.mjs` is in flight. That script is where the $30 / 3 / $60 directive would be enforced for a paid run. BRIDGE did not edit it.

This adapter spends nothing. `confirmLive` is `""`, `submittedToPaidWorkflow` is false, and `dispatched` is false. The handler does not call the workflow, `scripts/julius-paid-dispatch.mjs`, or a provider, so an admission cannot reach a paid call without the gates above. A later spend of an admitted ticket still has to be a `workflow_dispatch` that types the phrase, enters the environment, passes contract-check and preflight, and takes the paid slot.

The 429s this adapter returns are the existing J1 count caps: `JULIUS_J1_DAILY_CAP` and `JULIUS_J1_MAX_RUNS_PER_MISSION`, default 2 and 2. A bad value answers `503 julius_dispatch_not_configured` and reserves nothing. Those counts are separate from dollars and repair cycles.

## 6. Ranked obstacles

| Rank | Obstacle | Owner | Isolated module? |
|---|---|---|---|
| 1 | No admission record joined a client `(wlj_ run, idempotency key)` to the existing paid-slot key, and a mid-write resend could have been treated as a second slot or as `julius_dispatch_busy`. | **BRIDGE** | Yes. Done in `src/relay/integration/wonderland-admission/` and `relay-bridge/wonderland-admission-route.ts`. |
| 2 | The ticket is not submitted to `julius-first-live-mission.yml`. Submitting it from this process would be a new caller of the only spend path. A person still has to type `RUN LIVE MISSION` through the existing dispatch client. | **Gatekeeper** to run it, **YUJI** if `scripts/julius-paid-dispatch.mjs` must learn the Wonderland key hash | No. Those scripts and the workflow are outside BRIDGE. |
| 3 | `julius-dispatch.ts` at 31bfc58b is a second, in-process role chain and is not on main. It must not be mounted beside the workflow. | **YUJI** | Their tree. |
| 4 | Unreal wrapper: HTTP, JSON, CSPRNG, missionId check, lone-surrogate decode, display. Pure logic is on a821a467 only. | **Cosmo** | Client tree. Not this PR. |
| 5 | `ClassifyDispatchAnswer` treats every 2xx without an error as Accepted and spends the pair. Our 202 means "admission reserved", `dispatched: false`, state `ADMISSION_HELD`. The wrapper must not draw that as providers running. Proposed fields are below. | **Cosmo** and **YUJI** to agree | Client change. Server fields are additive. |
| 6 | The admission store now mints one `run:` id (`serverRunId`) with the `(wlj_, idempotency key)` pair and returns it on the 202 and the same-pair 200. The mapping lives only there. Paid-dispatch and bootstrap do not yet refuse a run that lacks a matching admitted pair. That refusal is later, through G6, after #404 and the migration. The create branch of `julius-mission-routes.ts` is unchanged and still returns `dispatched: false`. | **YUJI** (paid-dispatch and bootstrap refusal, after #404) and **Cosmo** (which id the game shows) | Admission mint is in this change. The later refusal is not. |
| 7 | Role-slot registry and the `claude-fable-5` fixtures disagree with the workflow pin. | **YUJI** | No. Forbidden files. |
| 8 | Coder billing is mid-migration (subscription smoke vs API). The model id stays `claude-opus-5-5`. | **YUJI** | No. |
| 9 | The admission ledger is the file at `JULIUS_WONDERLAND_ADMISSION_STORE`. A clean restart replays the same `serverRunId` and the same caps. A held writer lock, or corrupt or unknown file content, answers 503 and does not rewrite the file. `dispatched` stays false. The founder operator claim tool is the only writer of that transition. | **BRIDGE** | Done in `admission-file.ts`. The claim tool is a later change. |
| 10 | Loopback + native session means the public website cannot admit. That matches J1. A deployed game client needs a loopback bridge. | **Gatekeeper** | Deploy config. Not touched. |
| 11 | R4-F independent acceptance of shown artifacts. | **Skywalker** | Judge. Not this PR. |
| 12 | Source branch is not on the landing allowlist. App branch to add later: `relay/julius-bridge-mission-adapter-20261023`. | **YUJI / Gatekeeper** | `allowed-branches.txt`. Not touched. |

## 7. What this change implements

Flag `JULIUS_WONDERLAND_ADMISSION=1`. Default off (`503 julius_dispatch_disabled`).

`POST /relay-api/wonderland/julius/dispatch` is served by `handleJuliusMissionRoute`, on the existing mission registration in `server.ts`. The exclusion is that pathname. A query on `/wonderland/julius/dispatch` is still admission, because the handler reads `projectId` from it. A trailing slash, a different case, or a child segment stays on the Wonderland catch-all and is refused as every other unknown `/wonderland/` path is refused. `isWonderlandRoute` returns false for that pathname with or without a query, so the catch-all does not answer it. There is no second `if` beside that catch-all (FORGE #406 will mount there). The create branch of the mission handler is not on this path:

1. Loopback, no browser origin, no operator bearer, native session, founder, project. Same kinds as 31bfc58b.
2. Synchronously reserve one run for `(runId, sha256(idempotency key))` and mint one `serverRunId` (`run:` plus 24 lowercase hex, from `randomBytes(12)`) inside that reservation, **before** `ledger.append`. A resend returns that id and does not mint another.
3. A resend, including one that arrives while `append` is in flight, gets **200**, no error object, and that run's current state (`RESERVED` until the write finishes, then `ADMISSION_HELD`).
4. Cap hits return **429** `julius_dispatch_cap_reached` or `julius_dispatch_mission_cap_reached`, with no row and no run.
5. The route never returns `julius_dispatch_busy`.
6. `confirmLive` is `""`. `submittedToPaidWorkflow` is false. `dispatched` is false.
7. Ledger failure sets `LEDGER_UNWRITTEN` on the same run and does not try the write again.
8. `markTerminal(INTERRUPTED|FAILED)` and a second result hash do not open a run. There is no timer and no retry.

`POST /relay-api/julius/missions` is unchanged and still returns `dispatched: false`.

### Proposed J1 response contract (for YUJI and Cosmo; not client code)

Success body, additive on the 31bfc58b data object:

```json
{
  "data": {
    "runId": "wlj_<uuidv4>",
    "serverRunId": "run:<24 lowercase hex>",
    "dispatchId": "adm_<32 hex>",
    "state": "RESERVED | ADMISSION_HELD | LEDGER_UNWRITTEN | INTERRUPTED | FAILED",
    "replayed": false,
    "ledgerRef": "julius-wonderland-admission:<dispatchId>",
    "mode": "admission",
    "dispatched": false,
    "confirmLive": "",
    "submittedToPaidWorkflow": false,
    "correlation": {
      "runId": "wlj_<uuidv4>",
      "requestId": "<clientTriggerId>",
      "idempotencyKeyHash": "<sha256 hex>",
      "clientUiActionUtc": "<client timestamp>",
      "receivedAt": "<server timestamp>",
      "ledgerRef": "julius-wonderland-admission:<dispatchId>",
      "resultSha256": null
    },
    "modelPins": {
      "architectModel": null,
      "codingModel": null,
      "reviewerProvider": null,
      "reviewerModel": null
    },
    "gatesRemaining": []
  }
}
```

`modelPins` are null when the workflow text cannot be read. When it can, they are the env values above, not copies typed into the adapter.

`ledgerRef` uses the prefix `julius-wonderland-admission:` because this adapter does not write the J1 ledger prefix `julius-j1-ledger:` from 31bfc58b. YUJI can say if those rows should be the same ledger.

`mode: "admission"` is not J1's `live` / `fake`. The current client classifier ignores `mode` on the dispatch answer. A later result wrapper must not treat `admission` as a finished provider mode.

### Kinds and codes deliberately left as they are

- Same-pair resend: 200, no error. Not 429 busy.
- Caps: 429 and the two kinds above.
- Busy, bare 5xx, unlisted 429 kind: classified NoAnswer. This route does not emit them on the admission path. An unexpected throw before reserve is a bare 500 (`{}`) so the client resends the same pair.
- 400 validation kinds and 409 conflicts keep the 31bfc58b names. The C++ classifier treats a 4xx **with a kind** as Refused. The summary "only the two 429s are refusals" matches the 429 branch. It does not match the following line of `ClassifyDispatchAnswer`, which refuses any other 400–599 that carries a kind. BRIDGE did not change that. A same-pair resend is never given one of those 4xx responses.
- A 5xx **with** an error kind would be Refused by the client (fresh pair). The adapter therefore does not attach a kind to a failure that should keep the pair.

## 8. Ownership boundary requests

Shared files touched:

- `relay-bridge/server.ts`. No new route block. The existing mission `if` also matches `isWonderlandAdmissionRoute`, and passes the request facts the admission route already required (`authorization`, loopback, idempotency header, raw body, clock). `juliusMissionPorts` takes this process's admission service, built beside `browserSessions`, and does not cache that service in the process-global mission cache. The Wonderland-family block is unchanged, so a later mount from FORGE #406 does not have to merge a new `if` in that spot.
- `relay-bridge/julius-mission-routes.ts`. Early return when the path is `/wonderland/julius/dispatch`, before operator, contract, and bootstrap checks. `isJuliusMissionRoute` is still only `/julius/missions`. `POST /julius/missions` still returns `dispatched: false`.
- `relay-bridge/wonderland-routes.ts`. `isWonderlandRoute` is false for the admission path only. The catch-all refuses a native session before it reads a path, so admission cannot be answered from inside `handleWonderlandRoute` without changing that refusal. Every other `/wonderland/` path is unchanged.

Not touched, on purpose:

- `wonderland/Tools/syntax-check.sh` (FORGE edited it)
- `relay-bridge/julius/**`, hosted coder, Hermes, `src/relay/mission/julius/**`, `src/relay/mission/role-slots/**`, `src/relay/connectors/gpt-architect/**`
- `scripts/julius-*`, including `julius-live-contract-check.mjs` (YUJI's durable cap work, in flight)
- `.github/workflows/**`, `.github/julius-landing/**`, landing allowlist
- Cosmo's client files (present only on `a821a467`)

The founder figures $30 / 3 repair cycles / $60 combined are not hard-coded here. Enforcement for a paid run remains the workflow's contract-check, and that is where YUJI's in-flight cap change belongs.

### What BRIDGE needs from YUJI

- Confirm the reservation (one run, memory index before `append`, resend returns that run) against `julius-dispatch.ts` at 31bfc58b.
- Say whether `julius-wonderland-admission:` should be written into the J1 ledger or stay a side record.
- Do not mount 31bfc58b's provider chain as the way this ticket spends.
- Add `relay/julius-bridge-mission-adapter-20261023` to the allowlist only when this source branch is re-authored. Source branch: `bridge/julius-mission-adapter-20261023`.

### What BRIDGE needs from Cosmo

- Do not treat HTTP 202/`dispatched: false`/`state: ADMISSION_HELD` as "Julius is running" until the proposed fields above are agreed.
- Keep same-pair resends on the 2/4/8/16/30 schedule. The server will return the same run.
- Mint a new pair only after a real refusal (the two cap 429s, or any other 4xx/5xx that carries a kind). Do not mint on busy, bare 5xx, or a 200 replay.
- The wrapper, trace, and in-game hashes stay on your side.
