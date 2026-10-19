# Relay Claude Code Local Adapter (Prompt 8)

> **What is live:** isolated workspace management, Claude Code coding-agent
> execution, agent session capture + explicit resume, workspace inspection,
> file-claim detective enforcement, and Relay-controlled verification — all
> `provenance: live`, verifier identities kept distinct.
> **What is NOT available:** Codex independent reviewer, Hermes execution,
> durable run persistence, production deployment, Git push. This is one real
> local coding agent behind Relay's boundary — not a complete cross-agent
> workflow. The simulated YC demo still shows the full Architect → Claude →
> independent Codex → review → repair → audit flow.

## Module boundary

`src/relay/connectors/claude-code/` implements the provider-neutral
`CodingAgentAdapter` port. Relay Core never imports it (boundary-tested); it
is composed by the CLI's approved Claude composition root only.

| File | Role | Node? |
| --- | --- | --- |
| `contracts.ts` | capability profile, auth class, tool policy, session/usage records | no |
| `capability-probe.ts` | read-only executable + flag + auth probing | yes |
| `config.ts` | project settings / MCP / hook risk detection (structural) | yes |
| `environment.ts` | credential-stripping child environment | no |
| `permission-compiler.ts` | file claims → tool policy | no |
| `prompt-compiler.ts` | handoff → Claude responsibility prompt | no |
| `process-runner.ts` | bounded `spawn(shell:false)` + streaming | yes |
| `stream-parser.ts` | incremental stream-json parsing | no |
| `event-normalizer.ts` | Claude activity → normalized Relay events | no |
| `report-parser.ts` | strict Agent Execution Report parsing | no |
| `session-manager.ts` | session capture + explicit resume (volatile) | no |
| `adapter.ts` | the port implementation + `invoke` | yes (via runner) |
| `live-runner.ts` | the full live proof orchestration | yes (via workspace) |
| `doctor.ts` | truthful capability + auth report | yes |
| `fixture.ts` | safe-edit throwaway fixture repo | yes |
| `fake-executable.ts` | deterministic offline fake Claude | yes |
| `contract-verify.ts` | full offline pipeline proof (no provider call) | yes |

Only the process runner spawns the Claude executable; only the workspace
module and this adapter use `child_process` in `src/relay` (boundary-tested).

## Installed capability probe (v2.1.217)

`relay claude doctor` probes the installed executable read-only and reports:

| Capability | Flag | Status |
| --- | --- | --- |
| Non-interactive | `-p/--print` | available |
| Streaming | `--output-format stream-json` | available |
| Explicit resume | `-r/--resume <id>`, `--session-id` | available |
| Max turns | (none) | **unavailable** — bounded by runtime/output/call-count |
| Tool controls | `--tools`, `--allowedTools`, `--disallowedTools` | available |
| Permission mode | `--permission-mode acceptEdits` | available |
| Structured schema | `--json-schema` | available (marker approach used) |
| Settings isolation | `--safe-mode`, `--setting-sources` | available |
| MCP isolation | `--strict-mcp-config` | available |
| Cancellation | process termination | available |

Nothing is claimed on documentation alone — only flags present in the
installed `--help` are marked available; the rest are `unverified`.

## Authentication boundary — `claude_local_subscription`

The only permitted Prompt-8 profile uses Claude Code's existing local login
(the user's Claude Max OAuth). Relay never reads, copies, stores, or prints
credentials. `claude auth status --json` is classified into a SAFE label
(`local_subscription` / `api_key` / `bedrock` / `vertex` / `gateway` /
`not_logged_in`) with email, org, and tokens redacted and discarded.

- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, base-URL, Bedrock, and Vertex
  variables are stripped from the child environment (defense in depth — OAuth
  does not use them). API-key detection is by NAME only.
- If Claude reports an API-key / third-party source, the run stops with a
  Manual Task ("Use an approved Claude sign-in"); the key/source value is
  never revealed. Relay does not permit API-billed execution by default.

## Process invocation

`spawn(claudeExecutable, args, { shell:false, cwd: workspace, env: filtered })`.
Args: `-p --output-format stream-json --verbose --safe-mode
--strict-mcp-config --tools … --allowedTools … --disallowedTools …
--permission-mode acceptEdits [--resume <id>]`. The prompt is delivered on
stdin (kept out of argv). Bounds: 6-minute runtime, 1 MiB stdout / 256 KiB
stderr (overflow terminates), SIGTERM→SIGKILL with honest termination
reporting, cancellation by command id. `--dangerously-skip-permissions` is
never used. `--safe-mode` disables project CLAUDE.md, skills, plugins,
hooks, MCP, and custom commands while keeping OAuth auth working.

## Permission compilation

Safe-edit fixture: `Read, Glob, Grep, Edit` only (Write added only when a
task claims a new file). Forbidden always: Bash, WebFetch, WebSearch, MCP,
Task, and other shell/network tools. Path-scoped Edit rules are ADVISORY on
this CLI version — the authoritative control is the post-execution
workspace inspection gate, never claimed as enforced beforehand.

## Prompt compilation

The provider-neutral `AgentHandoffPackage` compiles into a bounded Claude
prompt with run/task ids, responsibility, objective, workspace boundary,
claimed / read-only / protected files, allowed tools, prohibited actions,
acceptance criteria, the commands **Relay** will run afterward, the limits,
the hard rules (work in cwd only; no parent access; no protected/unclaimed
edits; no secrets; no deploy/push/commit; no install; no network; a
completion statement is a claim), and the required `RELAY_AGENT_EXECUTION_
REPORT_V1` marker + JSON schema. The full ledger, transcripts, unrelated
files, hidden reasoning, secrets, and other sessions are never pasted. The
repair prompt for a resume is NARROW (findings + unchanged constraints
only).

## Stream parsing + hidden reasoning

The parser is incremental and tolerant: partial chunks, blank lines,
unknown future record types (counted, ignored), and noncritical malformed
lines never crash it. `thinking` / `reasoning` blocks are counted and
DROPPED — never emitted, persisted, logged, or audited. Only safe activity
(reading/searching/editing named files) surfaces, with tool arguments
sanitized to file names/patterns. A missing REQUIRED record (init, session
id, result) stops the run honestly.

## Session capture + explicit resume

The Claude session UUID is captured from the stream and stored with its
association ONLY (never a token), volatile in-memory. One focused repair
resumes the EXACT captured id (`-r <id>`) in the same workspace and task,
with a narrow RevisionContract prompt; a resumed stream reporting a
different session id is rejected (never silently a new session). A second
repair is prohibited. Durable cross-process resume is not claimed.

## Workspace inspection gate

After Claude exits, Relay independently inspects the worktree (source vs
workspace revision, claims, changed/untracked files, protected/read-only
paths, symlink escapes, source status). The agent report cannot override
this gate. An unclaimed / protected / escaping change stops the run,
records failed evidence, preserves the workspace, and never expands claims.

## Relay-controlled verification

Only Relay runs the deterministic checks, through the Prompt-7 command
runner (`node --test`, allowlisted, shell-free), producing live
EvidenceRecords (exact executable, redacted args, exit code, bounded
output, revision, workspace/task ids, verifier, timestamp). Claude's own
"tests passed" is only a claim. A low-risk CompletionPolicy
(`acceptedProvenance: ['live']`, no reviewer) then evaluates the evidence.

## Usage classification

Safe metadata only (turns, duration, api-duration, reported cost, model,
session id, status). A reported USD value is labeled `provider-reported` /
`subscription-associated` — never an invoice or billed truth. No
authentication-source detail beyond the safe class is exposed.

## Manual Task cases

Missing executable, not signed in, disallowed auth source, project settings
needing review, unavailable isolation, missing approval, non-resumable
session, or a needed credential Relay may not collect → a simple Manual
Task ("Sign in to Claude Code", "Use an approved Claude sign-in", …). Users
are never asked to paste a token into Relay.

## Offline testing

A deterministic fake Claude executable emits stream-json for every scenario
(success, resume, malformed line, missing init/session, wrong resume id,
max-turns, execution error, timeout, cancellation, output overflow, hidden
reasoning, wrong task, unclaimed file, manual request) and makes REAL edits
so the whole pipeline is proven with no provider call. Fake-executable tests
are never described as live Claude.

## Known limitations

- No `--max-turns` on this CLI — bounded by runtime, output, and a 2-call
  ceiling per run; disclosed truthfully.
- Volatile sessions and workspace registry (durable resume is a later
  phase).
- Edit path-scoping is advisory; enforcement is the inspection gate.
- Nested Claude-in-Claude execution is not assumed safe — the live smoke
  runs in a separate terminal.

## Exact next phase

**Real Codex Independent Reviewer Adapter** — a live, independent reviewer
behind the reviewer port, so a live run can require and satisfy independent
review (the low-risk fixture deliberately does not).
