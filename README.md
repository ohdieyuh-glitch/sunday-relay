# Sunday Relay

**Sunday Relay turns separate AI tools, agents and human collaborators into one
coordinated, supervised and independently verified project workforce.**

Sunday Relay is a product of Aquala Technologies. It is developed in this
repository, independently of [Sunday Alcatraz](https://github.com/ohdieyuh-glitch/turbo-broccoli).
Relay accepts Relay product work only; Alcatraz implementation does not belong
here, and Relay implementation does not belong there — see
[`docs/REPOSITORY_GOVERNANCE.md`](docs/REPOSITORY_GOVERNANCE.md).

---

## What Relay does

Relay coordinates a mission across more than one agent and more than one
human, and refuses to call the result finished until the evidence says so.

- **Mission Operations** — a mission has a contract, a status model, commands,
  execution capsules, a trace ledger and economics. Status is *computed* from
  evidence, never asserted by the agent that did the work.
- **Structured handoffs** — a Prompt Architect turns intent into an
  implementation handoff; a coding agent works only inside its claimed scope;
  an *independent* reviewer sees the result. No agent grades its own homework.
- **A verification gate** — every completion is a CLAIM until Relay verifies
  it. Reports are treated as claims, evidence is checked, and output is held
  back when the claim does not survive.
- **Execution Capsules and the Trace Ledger** — what ran, where it ran, what it
  touched, what it cost, and what proved it.
- **Supervision, not autopilot** — modes bound what an agent may do without a
  human, and boundary actions stop for consent.

## Two surfaces, one product

Relay has a website/application and a terminal CLI. They are two interfaces to
the same Relay Core — the same domain, status model, commands, capsules,
ledger, economics, PSP models and the official Relay Dog. That equivalence is
enforced, not assumed: `npm run relay:surface-parity:check` verifies the
website/CLI parity registry.

```
src/relay/core, protocol, ledger,      Relay Core — pure, framework-free
             storage, coordination,     (no React, no zustand, no provider SDKs;
             handoff, verification      enforced by relay-core-boundary.test.ts)
src/relay/mission                       Mission Operations
src/relay/cli                           the terminal surface
src/relay/ui                            the web surface
src/relay/psp                           PSP Agent ID + entitlement
src/relay/persistence                   durable local state + crash recovery
relay-bridge                            local bridge server for real agents
docs/relay                              the authoritative specification set
```

## Getting started

```bash
npm install

npm run dev                  # the Relay web surface (http://localhost:5173/relay.html)
npm run relay                # the Relay CLI
npm test                     # the full suite
npm run typecheck            # application + bridge
npm run build                # production build
```

Offline, no-cost demonstrations (no provider is contacted, no file is changed):

```bash
npm run relay:cli:demo       # the CLI product demo
npm run relay:cli:demo:plain # the same walkthrough, plain text
npm run relay:yc-demo:check  # the demo preflight
```

Commands that reach a real provider are opt-in and require an explicit
`--confirm-live` flag. Nothing in the default test, build or demo path
dispatches to a provider.

## Documentation

`docs/relay/` is the authoritative specification set. Start with:

| Document | What it settles |
| --- | --- |
| `ARCHITECTURE.md` | placement, boundaries, hybrid local/cloud execution |
| `RELAY_MVP_SPEC.md` | product scope |
| `PROTOCOL.md` | the Relay protocol and envelopes |
| `MISSION_CONTRACT.md`, `MISSION_STATUS_MODEL.md` | Mission Operations |
| `EXECUTION_CAPSULES.md`, `AQUALA_TRACE_STANDARD.md` | execution evidence |
| `MISSION_ECONOMICS.md` | cost receipts, budgets, approvals |
| `PSP_AGENT_ID_AND_ENTITLEMENT.md` | PSP Agent ID and entitlement |
| `SECURITY_BOUNDARIES.md`, `WORKSPACE_SECURITY.md` | dispatch, credentials, workspace |
| `WEBSITE_CLI_PARITY_CONTRACT.md` | the two-surface guarantee |
| `OFFICIAL_RELAY_DOG_IDENTITY.md`, `UI_VISION.md` | product identity |
| `TEST_STRATEGY.md`, `DECISIONS.md` | how it is proven, and why |

`RELAY_STATUS.md` and `RELAY_INTEGRATION.md` at the repository root are
**historical records** from the period when Relay was developed inside the
Alcatraz repository. They are superseded by `docs/relay/` and are kept because
they are the honest provenance of this work.

## Contributing

Branches use the `relay/*` namespace, every material change opens a pull
request against `main` in this repository, and merges are **squash merges with
founder authorization**. Relay changes never open pull requests against the
Alcatraz repository. See [`docs/REPOSITORY_GOVERNANCE.md`](docs/REPOSITORY_GOVERNANCE.md).

## License

MIT — see [`LICENSE`](LICENSE).
