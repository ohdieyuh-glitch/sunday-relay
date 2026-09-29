# Julius MVP capabilities — the generality lane's handoff

Branch `relay/julius-mvp-capabilities`, local only (never pushed), worktree
`C:\dev\iwonder\julius-mvp-capabilities`, cut from authoritative main
`c833e268` (#288 squashed). **Nothing here lands before the Priority 10 paid
run**, by agreement with the qualification lane: main moving would force a new
accept-main and a new zero-dispatch preflight. Expect to rebase onto main after
the qualification follow-up lands. The overlap is real: `hosted-runner.ts`,
`hosted-envelope.ts`, `claude-code-coding-provider.ts`, `live-workers.ts`,
`live-composition.ts`, `julius-live-mission.ts`, `julius-router.ts`,
`julius-coding-agent.ts` and `julius-live-evidence-dump.sh` are edited on both
sides.

Readiness stays **80%**. Nothing below is evidence of Julius completing a real
mission; it is a capability built and proven offline.

## P0 — bounded file creation: DONE, offline

| | |
|---|---|
| kernel | `julius-workspace-paths.ts` (the one path normaliser), `julius-file-creation.ts` (creation + edit decisions, the grant, the closed refusal set) |
| enforcement | `relay-bridge/hosted-coding-agent/hosted-tool-authority.ts`, a `PreToolUse` hook installed on EVERY hosted run |
| grant | the operator mission contract's optional `fileCreation` field; nothing else can grant creation |
| commits | `15ef6947` kernel · `d0926adb` wiring and confinement · `53c9a0ea` contract grant and evidence export |

**Why a hook.** The Agent SDK decides a tool call in this order: hooks, deny
rules, ask rules, permission mode, allow rules, `canUseTool`.
"Auto-approved tools never reach `canUseTool`" (Anthropic, *Configure
permissions*). A bare `allowedTools` entry and `acceptEdits` both auto-approve,
so an authority installed as `canUseTool` — the first design, on
`relay/julius-task-generality` — would never be asked.

**Who may create.**
- **Only the mission grants it.** The operator contract's `fileCreation`
  (`{ permittedPaths, maxBytes?, mayOverwrite? }`) is parsed strictly and
  checked against the kernel's rules at parse time.
- **The contract can only narrow it.** The locked task contract (which the
  Prompt Architect drafts) narrows where files land (`alsoWithin`) and
  excludes (`outOfScope`); it can never grant or widen.
- **No grant, no creation.** Absent means no `Write` tool at all, which is the
  default. An absent field is not spread into the parsed contract, so every
  existing contract — Mission 6 included, proven against its real
  `contract.json` — keeps its binding digest.

**What every write must pass.**
- It is a workspace-relative path by REAL path, including through a junction or
  symlink.
- No `..`; this is refused before anything resolves it.
- No absolute, home-relative or drive-qualified spelling; no NTFS stream
  (`:`); no trailing-dot or trailing-space segment (`.git.` is `.git` on
  Windows); no reserved device name.
- Not a control location (`.git`, `.claude`, `.husky`, `.githooks`,
  `.julius`, `node_modules`, `.envrc`), a credential location (`.ssh`,
  `.aws`, `.npmrc`, `.env`, keys — but `.env.example` is fine), or a CI
  workflow. Checked **case-insensitively**, because `.GIT/hooks` is the real
  hook on Windows and macOS.
- Inside a permitted prefix, outside every excluded one, at most `maxBytes`
  (256 KiB default, 1 MiB hard), and no overwrite unless granted.

**Evidence.**
- **In the DIFF.** Created files appear in the attempt's DIFF: the snapshot is
  `git add -A` into a temporary index, so an untracked file is observed, and a
  new-file mission cannot park silently (real-git test).
- **The one boundary.** A file created under a path `.gitignore` excludes is
  NOT observed.
- **Recorded.** Every decision is recorded. The durable diagnostics carry
  counts and the first refusal's name from a closed set, and the evidence
  dump exports them. No path and no host path reaches a record.

## A security gap on main, closed by the same hook

Main's envelope allows bare `Read`/`Glob`/`Grep`/`Edit` under `acceptEdits`
with no hook. Per the SDK's documented order, that approves those tools for
**any** path the bridge user can reach, not only the workspace. The hosted
coder, a child process on the runner, could therefore read or edit:
- the runner's checkout of Julius itself, including the reviewer and
  evidence scripts;
- `/proc/<parent>/environ`, the mission process's environment. Reading it
  undoes the child-environment credential isolation.

The hook confines every file tool by real path on every run, and refuses edits
in control locations (`Edit .git/config` was possible). This was reported to
the qualification lane for the founder's decision about Priority 10, which
runs on main.

## Bugs found and fixed

1. The first creation authority would never have been consulted: it used
   `canUseTool` beside `Write` in `allowedTools`.
2. It passed the runtime's absolute `file_path` to a decision that refuses
   absolute paths, so every live creation would have been refused. Its tests
   used relative paths.
3. Control locations were matched case-sensitively, so `.GIT/hooks/pre-commit`
   passed.
4. A grant naming the `.github/workflows` directory itself was accepted.
5. My own first draft checked containment lexically against the resolved root.
   That would have refused every path in a workspace reached through a link,
   and trusted `link/../x`. Fixed before commit.
6. The ported real-git test ran WSL's bash on Windows, because CreateProcess
   searches System32 before PATH, and failed 4/4. It now uses Git's bash on
   win32.

## P0 — mediated command execution: NOT BUILT

Designed, with its seams verified, and not implemented in this window. Its
substrate exists: `ShellEffectPort.run` already gives confinement (the
container, `--network none`), a timeout, an output cap, captured
stdout/stderr, provenance (`invocationId`), authority (the task claim),
deduplication and cancellation. Missing: a command policy, a request path for
the agent, and a per-dispatch step budget.

The request path is an in-process MCP tool. The installed SDK (0.3.220)
exports `createSdkMcpServer` and `tool`, and `query` takes `mcpServers`. The
handler runs in the bridge, never in the Claude CLI child. The design:
1. A pure kernel decision over `{ toolId, arguments }`: structured tools
   (`test.run <file>`, `typecheck.run`, `lint.run`, `format.check`,
   `git.status`, `git.diff`). The agent supplies arguments, never a command
   line, which removes shell injection as a category.
2. The handler asks the kernel. It runs through `ShellEffectPort.run` with the
   dispatch's own claim, a step budget and a timeout, and returns capped
   output.
3. Results are ITERATIVE evidence (`COMMAND`, stage `iterative`), which never
   satisfies a criterion requiring `TEST`. The declared final check stays
   Julius's own.
4. `loadHostedQuery` must also return `createSdkMcpServer` and `tool` from the
   same dynamically loaded module.

## P1 — measured on `relay/julius-task-generality`, not re-measured here

`docs/JULIUS_MVP_EXECUTION_BLOCKERS.md` on that branch is the measurement.
Its findings, briefly:
- **The 4 MiB ceiling.** It protects host RAM through the tmpfs backing the
  workspace. The control (`statfs` on the bind mount) is correct, but no
  derivation defends the number. It is not about model context (the context
  packet is built from Project Brain entries against a character budget), and
  real missions used at most 2.7%. Raising it alone admits a repository
  without making it workable.
- **Network.** The MVP need is dependency installation, and the safe form is
  installing BEFORE the sandbox is sealed, never network inside it. Research
  is already a separate mediated channel.
- **Game development.** The image is Node-only. The honest path today is
  edit-and-review. The stronger path is a mediated HOST build tool, the same
  shape as the executor; not a bigger container.

## Environmental failures seen on this Windows machine (not regressions)

- `julius-research-authority.test.ts` "22": `spawnSync npx ENOENT`. `npx` is
  `npx.cmd`, which `spawnSync` cannot resolve without a shell. This is the
  qualification lane's measured baseline.
- A 5-second timeout flake in an F6 guard mutation test under load; it was
  green on two re-runs.
