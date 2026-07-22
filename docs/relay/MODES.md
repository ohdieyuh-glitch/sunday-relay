# Sunday Relay — Operational Modes (authoritative)

> Added in Prompt 8.2 (2026-07-22). Modes are **canonical Relay policies**,
> not a UI preference. Relay Core owns the mode; a client may *submit* a mode
> command but never decides what a mode permits. Source: `src/relay/mission/
> modes.ts`; boundary-tested in `relay-core-boundary.test.ts`.

## The three modes

Relay has exactly three operational modes (`RELAY_MODES`): **guided**,
**semi**, **autonomous**. Each is a deterministic policy that materially
changes what Relay will do without asking. `defaultModePolicy(mode, now)`
compiles the policy; the mode is never a cosmetic flag.

| Mode | Steps | Repairs | Spend ceiling | Asks | Credential handles |
| --- | --- | --- | --- | --- | --- |
| guided | ≤ 6 | ≤ 1 | ≤ $1 | often | disabled |
| semi | ≤ 20 | ≤ 2 | ≤ $2 | high-impact only | scoped, per-action |
| autonomous | ≤ 60 | ≤ 3 | ≤ $5 | boundary only | scoped, pre-authorized |

Guided is the default and the safest: one repair maximum (the 15 founder
conditions from Decision 4 still gate it), asks frequently, and refuses all
credential-handle use. Autonomous is the widest and is the only mode that may
proceed across most boundaries without a per-step prompt — but it can never
release output that has not cleared the reviewer gate (see REVIEWER_GATE.md),
and it can never bypass a Manual Task.

## Escalation requires immutable consent

`selectMode(current, target, now, consent?)` enforces the transitions:

- **Escalating to autonomous** requires an explicit consent record
  (`buildAutonomousConsent`) — a bounded, immutable event minted at the moment
  of consent (scope, expiry, granted-by). Escalation without consent is
  rejected; a `'*'`/`'all'` scope is rejected (`validateAutonomousAccess`).
- **Reducing autonomy** (autonomous→semi, semi→guided, any→guided) is
  **immediate** and never needs consent — a stop is always available.
- Every transition mints an event; consent is never inferred from a prior
  session, a TTY, or an adapter request.

## Boundary stops

`actionRequiresStop(mode, action, preauthorizedDeployment)` returns whether an
action must stop for confirmation. `AUTONOMOUS_STOP_ACTIONS` (17 actions —
deploy, push, delete-branch, rotate-credential, external-send, spend-over-
ceiling, …) always stop even in autonomous, unless a deployment is explicitly
pre-authorized in the consent scope. `SEMI_STOP_ACTIONS` is a superset that
also stops on high-impact edits. Guided stops on nearly everything.

## What adapters cannot do

An adapter (Claude Code, a future Codex, any coding agent) **cannot**:
increase the mode, grant itself a credential handle, or widen a stop list.
Mode is Relay Core state; the adapter port carries no mode-mutation channel.
Boundary tests assert the connectors directory never calls `selectMode`,
`buildAutonomousConsent`, or the policy compiler.

## CLI

`/mode` shows the current mode and policy; `/mode <guided|semi|autonomous>`
submits a change (autonomous prints the consent requirement and the bounded
scope in the interactive session). The mission-control demo
(`npm run relay:mission-control`) renders all three policies and the
autonomous consent screen deterministically.

## Truthfulness — status of each part

- **Functional now:** the mode policy engine, escalation/reduction rules,
  consent minting and validation, boundary-stop computation, CLI submission,
  and the deterministic demo projection. All pure and browser-safe.
- **Simulated / presentation in the demo:** the *values* driving the demo
  (spend, steps) come from the deterministic competitive scenario, not a live
  agent.
- **Unavailable until persistence:** consent records and mode history are
  **volatile** — they live only for the process. Durable consent survives with
  the relay-storage persistence phase (ADR-016).
- **Not built this phase:** no billing tie-in; autonomous does not imply any
  paid provider call — verification and the demo make **no provider call**.

See MISSION_CONTROL.md for how modes surface in the graphical UI, and
SECURITY_BOUNDARIES.md for the trust rationale.
