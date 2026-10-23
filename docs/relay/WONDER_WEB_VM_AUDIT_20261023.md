# Wonder Web VM audit — Julius, 2026-10-23

**Base:** `f539cab2` (frozen main). This note is Julius only: working cards, the authorization Julius already has, and whether Julius calls Wonder Web. It is not a UI, Unreal, or provider inventory. BRIDGE owns providers and the session service. Nothing here is an R1 or R6 pass.

Cosmo's `/workspace/wonder-web/AUDIT.md` and Skywalker's `/workspace/wonder-web/BASELINE.md` were not in this checkout. Client line `aa930c26` (`WonderlandLiveTerminal.h`) is not in this tree either. Citations below are this tree.

## What Julius calls today

Julius does not call Wonder Web. `src/relay/mission/julius/index.ts` exports the kernel and does not export `wonder-web`. A search of `src/relay/mission/julius` and `relay-bridge/julius` finds no `WonderWeb` import. `docs/relay/WONDER_WEB.md:136-138` states the same fact from the other side: no live Julius integration; creations arrive through a deterministic fixture.

Wonder Web, as built, is a creation pipeline (static bundle on loopback), not a VM. `docs/relay/WONDER_WEB.md:77-81` says `node_service` and `native_process` are not beta-eligible because this repository has not built a container or a VM. `relay-bridge/wonder-web/wonder-web-runtime.ts:24-31` drives that creation lifecycle. It does not open a browser VM.

## Requirement status

| # | Requirement | Status | Evidence |
|---|---|---|---|
| 1 | Isolated VM, real browser, streamed picture | **ABSENT** | No Julius VM session. The Docker adapter is a code-tool sandbox: `docker-sandbox-adapter.ts:138` refuses `MEDIATED` network, and `:153` creates the container with `--network none`. `julius-sandbox.ts:12-14` is a tool-execution port, not a browser. Not R1. |
| 2 | Per-owner identity, terminal accent, Julius's own | **ABSENT** | Wonder Web compares two caller-supplied user id strings (`wonder-web-sandbox.ts:204-215`). Julius has no accent token and no per-card VM owner. A Project Brain C.A.R.D. is a loadout (`project-brain-components.ts:4-8`), not a working card. |
| 3 | Several windows, no serialization on focus | **ABSENT** | No Wonder Web window in Julius. `JuliusCardPolicy.concurrency` (`julius-policy.ts:5`, dispatch at `:37`) bounds worker dispatch, not VM windows. |
| 4 | Open / multi-spawn / close animations | **ABSENT** | No Julius module owns those animations. |
| 5 | Auto-minimize, surface, pin, background status | **ABSENT** | No Julius module owns that visibility. |
| 6 | Paid computer-use chain (mission → execution → VM → browser → result → artifact → display) | **ABSENT** | `JuliusBudgetPort` (`julius-runtime-ports.ts:375-417`) reserves mission spend for tasks and tools (`julius-tools.ts:41-43`). It is not a VM session, a browser action, or a display. Not R6. |

## What is simulated

Wonder Web's tested path serves a built creation. Julius never opens it. The Docker sandbox runs a tool with no network. Treating either as a live browser VM would be false. Provider keys are not configured on this checkout, and this audit does not claim access to any.

## Identity Julius already issues

The stable server-side id of one working card is the Julius **task id**, written when a run is created:

- `juliusBootstrapRunId` derives `run:<identity>` from the contract idempotency key (`relay-bridge/julius/bootstrap.ts:82-87`).
- `planTaskId` / `buildTaskId` are `` `${runId}:plan` `` and `` `${runId}:build` `` (`bootstrap.ts:74-75`).
- Those ids are inserted with `addTask` (`bootstrap.ts:222-236`) into `julius_tasks.task_id`.

That is the server equivalent of the client task GUID. A `pbcard:` loadout id is a different object (`project-brain-components.ts:70`, `:274-277`). `julius_runs.card_revision` stores a policy revision string and not the policy, and not a VM owner (`docs/relay/JULIUS_RUNTIME.md:142-144`).

`JuliusBudgetPort` is on this commit. The namespace ceiling in PR #404 (`authorizeJuliusLiveSpend`, `julius-spend-ceiling.ts`) is **not** on `f539cab2`. This checkout has no `src/relay/mission/julius/julius-spend-ceiling.ts`.

## Slice this PR adds (not a VM pass)

One issued Julius task registers under the Julius terminal through BRIDGE's registry port. `agentDisplayName` is the trimmed card label only when that name is non-empty, at most 64 Unicode code points, and free of C0, U+007F, C1, U+2028, U+2029, and lone surrogates. Otherwise the field is omitted and the open trace notes `label_omitted:<reason>`. A provider label is never sent. A bad label does not block the VM. The client composes the window. Julius does not send or store a window title, and it does not mint agent ids, session ids, or window numbers. The fake in the test file is not a provider.

Spend goes only through a port shaped for PR #404's decision plus `JuliusBudgetPort`. This PR does not copy the ceiling table and does not import the unmerged file. `usdMicros <= 0` is refused. `maxLifetimeMs` is a required injected config. The number comes from BRIDGE's wonder-web-vm session-layer constant once that module lands. This package does not hardcode one and does not import that module. A missing, non-finite, or non-positive value refuses the open. A `hardTtlAt` strictly after now plus that span is rejected. Closing a window does not terminate and is not an end cause; paid actions stay allowed on that live session. Task end (`SUCCEEDED`, `FAILED`, `CANCELLED`) and run end (`JULIUS_TERMINAL_MISSION_STATES` in `julius-runtime.ts:25-26`) call owner terminate once, with end cause `owner_terminated` from `wonder-web-vm-session.v1`. Any other or unknown cause the port reports ends the session with no retry and no new reservation. A failed terminate poisons the session: later actions, open reuse, and extend are refused, nothing is retried, and nothing is reserved again. `onRunEnded` surfaces that failure instead of hiding it behind a later success. If commit throws after the VM opened, Julius terminates with `owner_terminated` and releases the reservation only when that terminate is confirmed; otherwise the reservation stays held and the session is closed. If commit throws after a paid action, the reservation stays `UNRECONCILED` and further paid actions on that session stop. Idle TTL, hard TTL, and the orphan sweep stay server-side and are charged to PR #404.

### Files

Not under `src/relay/integration/wonder-web-vm/` or `relay-bridge/wonder-web-vm/`. Placed under `src/relay/integration/julius/`, which the harness already classifies by directory prefix, and exported from that folder's existing `index.ts` so the exporter reaches them without an edit to `scripts/export-julius-harness.mjs`.

- `src/relay/integration/julius/julius-wonder-web-vm-types.ts`
- `src/relay/integration/julius/julius-wonder-web-vm-port.ts`
- `src/relay/integration/julius/julius-wonder-web-vm-authorization.ts`
- `src/relay/integration/julius/julius-wonder-web-vm-orchestrator.ts`
- `src/relay/integration/julius/julius-wonder-web-vm.test.ts` (fake port lives here and is labelled fake)
- `src/relay/integration/julius/index.ts` (exports only)
- `JULIUS_HARNESS_MANIFEST.md` if the exporter's file list changes

### Client line, not this PR

`WonderlandLiveTerminal.h` and the Julius Connect client are not edited here. A later client-line branch needs to:

1. Send the working-card task GUID and the card label into BRIDGE's registry. Do not send a C.A.R.D. loadout id as that key.
2. Route web-lookup auto-open through the session's `vmSessionId`, not a reused global window id.
3. Paint the Julius outline from the accent token on that session.
4. Bind the window-close control to close-window, and leave terminate to card end and run end.
