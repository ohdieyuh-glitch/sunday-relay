# Sunday Relay — Codex Reviewer Adapter (authoritative)

> Added in Prompt 8.3 (2026-07-22). The REAL local **Codex independent
> reviewer** behind Relay's provider-neutral Reviewer port. It is READ-ONLY,
> runs only inside an isolated Relay worktree, uses the user's existing local
> Codex login (never a stored credential), returns an unverified review claim
> that Relay validates and attests, and NEVER falls back to a simulated
> reviewer. Source: `src/relay/connectors/codex-reviewer/`. No provider call
> occurs in any test, build, doctor, or contract verification.

## Where it sits

The adapter implements `ReviewerAdapterPort` (`src/relay/connectors/ports.ts`)
— the same provider-neutral port the deterministic reviewer used. The sync
`review()` method **refuses live execution**; a real review runs only through
the explicit async live path (`relay codex run --confirm-live`) with an
isolated workspace and founder approval. Relay Core never imports the adapter
(boundary-tested); the CLI composes it directly.

## Installed capability probing (no model call)

`capability-probe.ts` runs `codex --version`, `codex exec --help`,
`codex exec review --help`, and `codex login status` — **no model call, no
repository modification, no credential read**. It distinguishes an INSTALLED
binary from a READY login, and documented flags from confirmed ones.

Login readiness uses **one canonical probe** (`probeCodexLoginStatus` +
`classifyCodexLoginOutput`) shared by `relay codex doctor`, the Gate-B
preflight, live-launch eligibility, and the Manual Task recheck: `spawnSync`
with `shell:false`, the same filtered child environment used to launch the
review (`buildCodexEnvironment` — HOME/PATH/USER/LOGNAME/LANG/TMPDIR/XDG paths
preserved, provider keys/tokens/gateway URLs stripped), and **both stdout and
stderr captured** — the real CLI prints `Logged in using ChatGPT` on
**stderr** with exit 0. The classifier requires exit 0 plus a logged-in phrase
(`logged in` / `signed in` / `authenticated`) for `ready`; explicit
not-logged-in wording is `not_ready`; anything else is `unverified`; a
non-zero exit is **never** `ready`. Probe text is sanitized (account/email and
secret-shaped material redacted, ANSI stripped) before it is ever inspected. The probed
`CodexReviewerCapabilityProfile` records: executable path, version,
non-interactive exec, JSON events, output schema, output-last-message, exact
resume, native review, uncommitted/base/commit review, read-only and
workspace-write sandboxes, ignore-user-config / ignore-rules / strict-config,
cancellation, a coarse `authenticationStatus`, and the selected runtime
strategy.

### Selected runtime strategy

The installed CLI (codex-cli 0.144.4 at authoring) supports
`codex exec --json --output-schema --output-last-message --sandbox read-only
--cd --ignore-user-config --ignore-rules --strict-config` and
`codex exec resume <uuid>`. The native `codex exec review` subcommand does
**not** expose `--json`, `--output-schema`, `--sandbox`, `--cd`, or
`--output-last-message`, so it cannot provide structured output, session
identity, or a read-only sandbox. Relay therefore selects
**`exec_structured_review`** — never sacrificing structured validation,
session identity, execution attestation, event normalization, or truthful
failures to use the native subcommand. Recorded strategies:
`exec_structured_review` | `native_review` | `unavailable`.

## Authentication boundary (`codex_local_login`)

The approved profile uses the EXISTING local Codex login. Relay does **not**:
ask for an OpenAI API key, read Codex credential storage, copy/print/store any
authentication material, expose account identity, call an OpenAI/Azure/Bedrock
endpoint, or set a custom base URL / gateway. `environment.ts` strips explicit
provider sources from the child environment (`OPENAI_API_KEY`, `OPENAI_ORG_ID`,
`OPENAI_PROJECT_ID`, `AZURE_OPENAI_*`, `AWS_ACCESS_KEY_ID/SECRET/SESSION`,
`OPENAI_BASE_URL`, `CODEX_API_KEY/ACCESS_TOKEN/BASE_URL`, and any
TOKEN/SECRET/KEY/BASE_URL-shaped name) while preserving the minimum non-secret
runtime (PATH, HOME, **CODEX_HOME**, XDG dirs). If an explicit API-key source
is present, Relay does **not** launch — it raises a Manual Task explaining the
profile uses the local login, never revealing the value.

## Configuration isolation

`configuration.ts` structurally inspects the workspace (existence only, never
contents) for AGENTS.md, project Codex instructions, `.codex`, execpolicy
`.rules`, hooks, plugins, MCP, and custom-provider/base-URL/network surfaces.
Repository review instructions may carry task context but MUST NOT override the
Relay Reviewer Contract, so — when supported — Relay applies `--ignore-user-
config`, `--ignore-rules`, and `--strict-config`, an explicit read-only
sandbox, and an explicit working directory. Hooks, plugins, MCP, apps, network
access, and additional writable directories are **never** enabled;
`--dangerously-bypass-approvals-and-sandbox` and `--dangerously-bypass-hook-
trust` are **never** used (boundary-tested).

## Read-only permission compilation

`permission-compiler.ts` builds the strictest supported read-only `codex exec`
invocation: `--sandbox read-only`, `--cd <worktree>`, config isolation,
`--json`, `--output-schema` (when supported), `--output-last-message`, and
`resume <uuid>` for a re-review. It emits **no** forbidden flag
(`FORBIDDEN_FLAGS`) and never requests workspace-write or full-access. The
Prompt-7 workspace inspection runs before AND after as the enforced control; a
reviewer that changes any file fails the review-attestation gate.

## Reviewer handoff + structured report

`reviewer-prompt-compiler.ts` compiles the neutral Reviewer Handoff into a
Codex review contract: mission/task ids + revisions, review id, reviewer role,
independence requirement, objective, binding requirements, blocking acceptance
criteria, actual workspace revision + changed files, a bounded diff/evidence
summary, the untrusted implementer identity, out-of-scope/protected paths, the
rubric, and the required `RELAY_REVIEW_REPORT_V1` schema. It never forwards the
transcript, hidden reasoning, raw session content, unrelated ledger entries,
credentials, or platform/provider system prompts.

`report-parser.ts` strictly validates the returned report (schema output or a
marked block): ids/revisions/workspace-revision must match the assigned review
(a mismatch is a REJECTION, never a rewrite); `changes_required` needs an
actionable finding; `approved` may carry only non-blocking observations; a
blocking finding requires an affected criterion, evidence, and a bounded
required action; secret-shaped and hidden-reasoning content are rejected;
malformed output is a typed failure — never an invented approved verdict.

## Streaming, sessions, cancellation

`stream-parser.ts` incrementally parses the `--json` event stream (partial
chunks, blank lines, unknown future events counted safely, initialization,
session identity, activity, completion, errors), dropping hidden reasoning
(only the omission count is kept). `process-runner.ts` spawns `shell:false`
with bounded runtime (6 min), stdout (1 MiB), and stderr (256 KiB), honest
SIGTERM→SIGKILL cancellation with termination reporting, and reads the
structured report from `--output-last-message`. `session-manager.ts` captures
the Codex session UUID + association only (never tokens) and supports **exact-
session re-review** (resume by id; wrong/missing id rejected; single attempt).
Because storage is volatile, durable cross-process reviewer recovery is
**unavailable** (disclosed).

## Normalized events

`event-normalizer.ts` emits `reviewer.*` events (process_started,
session_created, initialization_verified, activity_observed,
diff_inspection_observed, evidence_inspection_observed, report_received,
process_completed/failed/timed_out/cancelled, output_malformed) with
provenance `live` and classification `unverified-claim`; the orchestrator adds
`reviewer.attestation_created`, `reviewer.finding_created`,
`reviewer.verdict_accepted/rejected`, and the `output.*` visibility events.
These feed the Live Terminal, Relay Dog (REVIEWING), Reviewer Gate, Mission
Timeline, and Final Audit.

## Attestation, independence, and the gate

Relay — never Codex — builds and validates the Reviewer Execution Attestation
(`attestation.ts` over the Prompt-8.1 model): requested vs actual reviewer
(both Codex), launch verified only after initialization evidence, read-only
isolated workspace, live provenance, **no fallback**, digests over safe
bounded summaries only. The single Relay-owned composite `evaluateReviewerGate`
(`src/relay/mission/reviewer-gate.ts`) computes structural independence,
projects the finding/repair ledger, and derives the output-visibility release
state — the adapter never decides independence, findings, or release itself.

## Commands + verification

- `relay codex doctor` — truthful capability + auth report, no model call, no
  secrets. `npm run` has no doctor script (run via the CLI).
- `relay codex contract-verify` / `npm run relay:codex:contract-verify` — the
  offline pipeline proof via a deterministic fake Codex (58 checks including
  the Gate-B login preflight, no provider call).
- `relay codex run --fixture review-defect --confirm-live` /
  `npm run relay:codex:live` — the explicit REAL review proof (never in
  tests/CI; approval never inferred from a TTY). See LIVE_CODEX_REVIEW.md.

## Truthfulness — status of each part

- **Functional now:** capability probing, strategy selection, environment
  filtering, config isolation, read-only permission compilation, prompt
  compilation, stream parsing, report parsing/validation, session capture +
  exact-session re-review, event normalization, Reviewer Execution
  Attestation, the reviewer gate integration, the fake executable, the fixture,
  the doctor, the offline contract verifier, and the CLI. All proven offline
  with no provider call.
- **Proven live (Gate B, 2026-07-22):** one real founder-run Codex review
  (codex-cli 0.145.0) — launch verified, session captured, read-only, no
  fallback, verdict changes_required with the seeded defect found, F-1/R-1
  created, output held, RELAY STOPPED SAFELY. Passed on the second command
  attempt; the first stopped pre-launch (no call) on the since-repaired
  stdout-only login probe. See LIVE_CODEX_REVIEW.md §Gate-B result.
- **Requires the founder:** the live review needs an approved local Codex login
  and explicit `--confirm-live`. When Codex is not signed in, the live command
  stops with a "Sign in to Codex" Manual Task and makes no call.
- **Unavailable until later phases:** durable cross-process reviewer recovery
  (needs persistence); live Claude→Codex→Claude repair loop (Prompt 8.4). No
  Hermes/OpenClaw, no billing, no network-enabled review.
