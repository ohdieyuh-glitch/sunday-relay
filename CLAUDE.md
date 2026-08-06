# Sunday Relay — working notes for Claude Code

Read this before touching anything. It exists because six of the seven
milestones shipped on 2026-07-31 began with a plan to *build* something that
already existed.

---

## The single most important habit

**Search before you build.** Every milestone in this repository has arrived
phrased as "implement X", and in almost every case a substantial X was already
present under a name you would not have guessed:

| The ask | What already existed |
|---|---|
| "durable mission persistence" | `src/relay/persistence/` — journal-as-authority, snapshots, atomic writes, locks, migrations, redaction, `recoverRun`, two verification drills (ADR-016) |
| "isolated mission worktrees" | `src/relay/workspace/worktree-manager.ts` — real `git worktree add/remove` with post-create verification, `.relay-workspaces` containment, branch-name validation |
| "real Claude Code adapter" | `src/relay/connectors/claude-code/` — 18 files, cancellation, session resume, hidden-reasoning omission, all proven offline |
| "GPT Prompt Architect" | `relay-bridge/openai-architect.ts` — server-side, key-from-env (on Chat Completions) |
| "Reviewer harness" | `src/relay/connectors/codex-reviewer/`, `mission/reviewer-gate.ts`, `RelayFinding`, `RelayReview` |

Start with `find`/`grep` over `src/relay` and `relay-bridge`, then read the
barrels. The real work is nearly always **binding an existing engine to the
mission-scoped, durable, customer-facing layer** — not writing the engine.

---

## Architecture in one paragraph

`src/relay/mission/<feature>/` holds **pure domain**: contracts, a projection,
validation, a store built on a shared key/value backing. It has no Node, no
network, no clock (time is an injected ISO string), so the browser and the CLI
can both read the same record and reach the same conclusions. Node-only
implementations live in `src/relay/connectors/<x>/` or `src/relay/persistence/`.
The website (`src/relay/ui/`) consumes the domain and never the reverse.

## Boundaries that will fail your build (all structurally tested)

- **UI is a consumer.** Nothing outside `src/relay/ui` may import something
  inside it.
- **The browser may never reach** `src/relay/persistence`, `src/relay/workspace`,
  the CLI, or a provider SDK. Proven by walking the real import graph from
  `src/relay/main.tsx`.
- **Adapters may not import `/mission`** ("adapters cannot own mission
  verdicts"). If a connector needs a domain type, invert it: the domain declares
  the shape it needs and a composition root (usually the CLI) wires the two.
  This caught me twice.
- **The CLI may import only** its own listed modules, `../mission` (the barrel —
  never a deep path), `../workspace` (facade only), `../persistence`, and
  allowlisted connectors. Both allowlists are hand-maintained arrays in
  `relay-core-boundary.test.ts`; adding a name there is the sanctioned fix.
- **No new dependency is forbidden**, but nothing may add deployment config
  (`vercel.json`, etc.) — the boundary scanner hard-fails on it.

When a boundary test fails, **fix the code, not the rule**. Every time I
restructured instead of widening, the result was better architecture.

## Truthfulness rules the tests enforce

These are the product's whole thesis. Violating one is a real bug:

- **Unknown is not zero.** A missing value is `null` and renders `Unknown`.
  Never a default, never `0`, never inferred from configuration.
- **Requested vs actual are separate fields.** The runtime/provider response is
  the only authority for what actually ran or answered.
- **Announce facts, not intentions.** "Saved" only after the durable write
  resolves; "Connected" only after a verified launch; "Completed" only after a
  real exit plus validated output; "Stopped" only after confirmed termination.
- **A disconnection is never a completion.** After a restart, an unconfirmable
  in-flight run becomes `disconnected`, is never replayed, and never relaunched.
- **Simulated data says so**, and normal production navigation must never load
  it.

## Working rhythm that has worked

1. `git fetch origin --prune`, verify `origin/main` matches what you were told.
2. `git worktree add /home/kaisinrogodfree5/sunday-relay-<task> -b relay/<task> origin/main`
   then `npm ci` in it. Never work in the primary checkout.
3. Map first (a parallel read-only fan-out pays for itself), then implement.
4. `git add -N` new files **before** the authoritative `npm test` — the CI
   accounting and boundary scanners enumerate via `git ls-files` and cannot see
   untracked files.
5. Full gate: `npm test`, `typecheck`, `build`, `relay:build`,
   `relay:bridge:build`, `relay-repository-boundary.mjs`, `relay-parity-gate.mjs`,
   `relay:surface-parity:check:strict`, `relay:yc-demo:check`,
   `relay:cli:contract-verify`, `git diff --check`, plus the drills:
   `relay:persistence:contract-verify`, `relay:persistence:recovery-drill`,
   `relay:workspace:verify`, `relay:claude:contract-verify`.
6. PR → wait for CI → `gh pr merge --squash --match-head-commit <sha>` → sync
   main → confirm Vercel deployed that exact commit → remove worktree, delete
   both branches, `git worktree prune`.

**Adding a `relay mission <x>` CLI action breaks one test every time**:
`src/relay/cli/mission-economics.test.ts` asserts the exact action list in the
error message. Update it in the same change.

## Verifying a deployment

The served bundle embeds `VITE_VERCEL_GIT_COMMIT_SHA`, so you can prove which
commit is live without a browser. Grep the bundle for strings that must be
present (offline-honesty labels) and absent (Node-only code, credential names).
Beware false positives: Vercel injects the **commit message** as an env var, so
words from your own commit appear in the bundle; and `sk-` matches inside
`task-`.

---

## State as of 2026-08-02 (end of session)

`origin/main` = `86c1e935a04e31c71b87a9e211676028106ce697`. Primary checkout
clean on `main`. Suite 3,724 passing across 188 files, 0 failed, 0 skipped.

**Relay is no longer a static demo.** There are now three live surfaces:

| Surface | Where | State |
|---|---|---|
| Frontend | https://sunday-relay.vercel.app | live mode ON, pointed at the Bridge |
| Bridge | https://sunday-relay-production-7d60.up.railway.app | authenticated, healthy |
| Volume | Railway `/data` | mounted, write-probed at boot |

Railway project `265bbb82-5f7a-4874-bad7-b1ec9d469808`, environment
`profound-insight / production`, autodeploys `main` via the GitHub integration.
Build `npm run relay:bridge:build`, start `node dist-relay-bridge/server.cjs`,
healthcheck `/health`.

**Provider calls made, ever: zero.** No provider credential is configured
anywhere.

### Shipped 2026-08-01 → 08-02

Reviewer harness catalog UI (#13), Hermes Reviewer harness adapter (#14),
Reviewer bridge client + CLI controls (#15), fullscreen moved to the Live
Terminal (#16), bridge production hosting (#17, #18), secure browser pairing
(#19), **mission-route authentication (#20)**, browser pairing form (#21),
architect live-proof readiness (#22).

### The security shape, in one paragraph

There is ONE operator credential, `RELAY_BRIDGE_API_TOKEN`, server/CLI only —
it must never reach a browser. The CLI mints a **pairing grant** (256 bits, one
exact origin, 2 minutes, single-use, stored hashed); the founder carries it
across by hand; the browser redeems it for a **read-only session**
(origin-bound, 30 min, revocable, in memory so a restart revokes everything).
Operator uses `Bearer`; browser uses `Relay-Session` — deliberately different
schemes so neither can be mistaken for the other. Browser sessions may READ
reviewer readiness/status/inspect and one mission; everything that spends money
or mutates a run is operator-only. CORS is exact-match with no wildcard branch.

### Open items, most actionable first

1. **The browser has never actually been paired.** Everything is deployed and
   verified; no grant has been minted. Open the Reviewer panel →
   `Relay Bridge`, then run (grant lives 120s):
   `RELAY_BRIDGE_URL=https://sunday-relay-production-7d60.up.railway.app RELAY_BRIDGE_TOKEN='<token>' node dist-relay/cli.cjs reviewer pair-browser https://sunday-relay.vercel.app`
2. **Prompt Architect awaits its one live call.** Set `OPENAI_API_KEY`
   (secret), `OPENAI_PROMPT_ARCHITECT_MODEL=gpt-4o` and
   `RELAY_PROMPT_ARCHITECT_MODE=live` on **Railway**, then POST
   `/relay-api/architect/verify` with operator auth and `{"authorized":true}`.
   Capped at 16 output tokens, ≈$0.0002. Founder must authorize explicitly.
3. **PR #6 is open and stale** — needs a rebase. Repeatedly told not to touch it.
4. **The stray worktree** `/home/kaisinrogodfree5/sunday-relay-agent-team-setup`
   on `relay/claude-agent-team-setup` at `9c14b69`. Not mine; confirm before removing.

### Facts worth not rediscovering

- **`dist-relay/` is gitignored**, so the CLI binary is per-checkout. A merged
  CLI command will NOT exist in `dist-relay/cli.cjs` until you run
  `npm run relay:build` *in that checkout*. This cost a founder-facing failure:
  `reviewer pair-browser` was merged and deployed but the binary they ran was
  three hours stale.
- **`npm test` takes 12–16 minutes**, past the 600s command timeout. Run it in
  the background. Under parallel load, tests that spawn processes exceed
  vitest's 5s default — give them `}, 30_000)`.
- **Never run two Claude sessions in one checkout.** Two collided here: one
  committed the other's working tree, and a `pkill -f vitest` killed the other's
  suite. A 3,100s test run with 15 "failures" was pure CPU contention.
- **Vercel injects the commit message** as `VITE_VERCEL_GIT_COMMIT_MESSAGE`, so
  any word you write in a commit appears in the browser bundle. Scan for
  SYMBOLS (`createReviewerBridgeClient`) or key-SHAPED regexes, never bare
  strings. `sk-` also matches inside `task-` and inside Relay's own redaction
  regexes.
- The bridge tsconfig **forbids `import.meta`**; `npm run typecheck` runs two
  passes and the bridge one is easy to skip locally.
- Adding a `relay mission <x>` or `relay reviewer <x>` action breaks the test
  asserting the exact action list in the error message. Update it in the same change.
- Hermes Agent v0.18.2 at `~/.local/bin/hermes`. `-z` one-shot + `--usage-file`
  is the chosen transport. Read-only is STRUCTURAL: an isolated `HERMES_HOME`
  disables all 23 toolsets (verified against the real binary), so the model gets
  no tool at all. Never mutate the founder's `~/.hermes`.

### If a session limit interrupts you

Stop cleanly and say so. Leave the worktree in place with deps installed and
write down exactly where you stopped.
