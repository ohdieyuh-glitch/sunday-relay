#!/usr/bin/env node
/**
 * JULIUS HARNESS EXPORT — the canonical inspection/export generator.
 *
 * WHAT THIS IS. A deterministic, read-only generator that DISCOVERS the
 * production source constituting Julius (Relay's Compound AI harness) by
 * tracing imports from the real live composition roots, writes the canonical
 * map (`JULIUS_HARNESS_MANIFEST.md`) and a single-file inspection export
 * (`generated/JULIUS_HARNESS_SOURCE.txt`) in which every included file is
 * reproduced byte-for-byte between FILE / END FILE boundary lines.
 *
 * WHAT THIS IS NOT. Not a build step, not a bundler, not a refactor. The
 * generated file is NOT source of truth — the modular production files are.
 * Nothing here is imported by runtime code and nothing here changes runtime
 * behaviour. The export is gitignored; the generator and the manifest are
 * committed.
 *
 * HOW DISCOVERY WORKS, IN ORDER.
 *   1. ROOTS. Two production processes: the live Julius Mission entrypoint and
 *      the independent executor control plane Julius reaches only over HTTP.
 *   2. STATIC IMPORT CLOSURE. Every `import` / `export … from` / `import()` /
 *      `require()` specifier is read from the TypeScript AST (never a regex
 *      over comments), resolved to a file, and followed — value AND type
 *      edges, because a reader needs the contracts too.
 *   3. BOUNDARIES. The trace stops at declared directories that are Relay's
 *      Mission layer rather than the harness, and records every crossing edge
 *      so nothing is hidden. Test files, fixtures, fakes and UI are refused or
 *      excluded by category, each with a stated reason.
 *   4. DECLARED MODULES. Production Julius modules that implement a Julius
 *      port but are not reached from either root (the live root composes a
 *      subset) are included and FLAGGED "not composed by the live root".
 *   5. PATH-LOADED ASSETS. The Julius schema migrations the migration runner
 *      registers by filename, and the in-sandbox executor script.
 *   6. DRIFT GATE. Every production file that imports the Julius kernel or the
 *      Julius port must be reached, declared, or explicitly excluded here —
 *      an unclassified one fails the run. A declared file that becomes
 *      reachable, or an excluded file that is reached, also fails: the
 *      manifest may never describe a wiring that no longer exists.
 *   7. SUBSYSTEMS. Every included file maps to exactly one of the twenty
 *      required subsystems, and every subsystem must map to at least one real
 *      production file, or the run fails.
 *
 * USAGE
 *   node scripts/export-julius-harness.mjs            write export + manifest, print the report
 *   node scripts/export-julius-harness.mjs --check    verify both are current and byte-exact; write nothing
 *   node scripts/export-julius-harness.mjs --json     machine-readable report on stdout
 *   --out <file>            export path      (default generated/JULIUS_HARNESS_SOURCE.txt)
 *   --manifest-out <file>   manifest path    (default JULIUS_HARNESS_MANIFEST.md)
 *   --no-manifest           do not write the manifest
 *
 * Exit 0 = success, 1 = an invariant failed (the report names it), 2 = usage.
 * Reads the repository and `git`; never contacts a network.
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toPosix = (p) => p.split(sep).join(posix.sep);
const rel = (abs) => toPosix(relative(REPO_ROOT, abs));
const abs = (relPath) => resolve(REPO_ROOT, ...relPath.split('/'));

/* ========================================================================== *
 *  DECLARATIONS — the only judgement in this file, every entry with a reason
 * ========================================================================== */

const GENERATOR_PATH = 'scripts/export-julius-harness.mjs';
const DEFAULT_EXPORT_PATH = 'generated/JULIUS_HARNESS_SOURCE.txt';
const DEFAULT_MANIFEST_PATH = 'JULIUS_HARNESS_MANIFEST.md';

/** Production composition roots. Order matters only for "reached from" attribution. */
const ROOTS = [
  {
    path: 'relay-bridge/julius-live-mission.ts',
    label: 'THE LIVE JULIUS MISSION ENTRYPOINT (process A)',
    detail: 'Mission Contract file → live C.A.R.D. role resolution → PostgreSQL + executor control plane → JuliusBootstrapPort.submit → run loop to a terminal state. `npm run relay:julius:mission -- run --contract <file> [--confirm-live]`.',
  },
  {
    path: 'src/relay/workspace/julius-tools/executor-control-plane-main.ts',
    label: 'THE INDEPENDENT EXECUTOR CONTROL PLANE (process B)',
    detail: 'The separate process that owns Docker sandboxes, receipts and attestation. Julius reaches it only through `RemoteExecutorControlPlane` over authenticated HTTP with per-operation credentials; it is a network dependency, not an import. `npm run relay:executor:build`.',
  },
];

/**
 * Production Julius modules that depend on the kernel or the port but are NOT
 * reached from either root. Included because they implement a Julius port
 * against the Julius schema (or the bootstrap port), flagged in every output
 * as "not composed by the live root". If one becomes reachable, remove it
 * here — the run fails until you do.
 */
const DECLARED_NOT_COMPOSED = [
  { path: 'src/relay/integration/julius/mission-bootstrap-adapter.ts', reason: 'the Relay-side compiler from an authorized RelayMissionContract + Compound Agent configuration to a JuliusBootstrapRequest; the live entrypoint compiles its request from a contract FILE instead, so the web/CLI mission flow that would call this is not yet wired to Julius' },
  { path: 'src/relay/integration/julius/index.ts', reason: 'the Relay-side barrel for the Julius port and the bootstrap compiler' },
  { path: 'src/relay/persistence/julius-lifecycle-postgres.ts', reason: 'durable approvals and lifecycle facts (JuliusLifecycleStore / JuliusApprovalStore) for julius-lifecycle-runtime; the live root does not yet compose an operator lifecycle channel' },
  { path: 'src/relay/persistence/julius-subagent-postgres.ts', reason: 'durable sub-agent grants (JuliusSubagentStore) for julius-subagent-runtime; the live C.A.R.D. policy sets subagents.allowed=false' },
  { path: 'src/relay/persistence/julius-repair-postgres.ts', reason: 'durable repair-cycle scheduling against julius_tasks and julius_repair_cycles; the live root reaches repair through the store aggregate, not this repository' },
  { path: 'src/relay/persistence/julius-timeline-postgres.ts', reason: 'the safe timeline read from the event ledger (JuliusTimelineReader); a read model no live surface consumes yet' },
  { path: 'src/relay/workspace/julius-tools/registry.ts', reason: 'the default tool catalogue (DEFAULT_JULIUS_TOOL_IDS, createDefaultJuliusToolRegistry); the live root routes tool effects through the executor shell port and does not build a registry' },
  { path: 'src/relay/workspace/julius-tools/local-artifact-store.ts', reason: 'the durable staged→finalized artifact store (StagedArtifactStorePort); the live root uses an in-process artifact exchange, recorded as debt in docs/JULIUS_BETA_READINESS.md' },
];

/** Directories the trace does not enter. Crossing edges are reported, never hidden. */
const BOUNDARIES = [
  {
    prefix: 'src/relay/mission/repository-target/',
    reason: "Relay's Mission repository-target domain (how a Mission targets, authorizes and observes a git repository). Julius consumes only its RepositoryPermission vocabulary through the C.A.R.D. and the bootstrap request; the module — and the Relay protocol, coordination, LLMOps and economics layers it pulls in — is Relay's mission lifecycle, not the harness.",
  },
  {
    prefix: 'src/relay/mission/wonderland/',
    reason: 'the pre-Julius Wonderland mission runtime domain, reached only as type imports of the shared relay_wonderland database class whose migrate() Julius calls; none of it participates in Julius behaviour. Its integration layer now READS Julius vocabularies to derive what the world shows — a one-way edge, recorded in KERNEL_DEPENDANT_EXCLUSIONS — and still nothing in it is reachable from the kernel.',
  },
];

/** Files the trace refuses to enter, by excluded category. Each is reached only through a barrel. */
const EXCLUDED_FILES = [
  { path: 'src/relay/mission/julius/julius-runtime-fixtures.ts', category: 'fixtures', reason: 'a complete deterministic Julius deployment in memory — scripted adapters, stepping clock, counting ids — exported by the kernel barrel for tests; the live composition has no import through which a scripted adapter could arrive' },
  { path: 'src/relay/mission/julius/julius-fault-injection.ts', category: 'test harness', reason: 'wraps a store so a named method throws on its Nth call — the chaos instrument the recovery scenarios use; no production caller' },
  { path: 'src/relay/connectors/gpt-architect/fake-architect.ts', category: 'fake', reason: 'the deterministic offline fake of the GPT architect, exported by the connector barrel for the suite and Demo Simulation; the live worker binds runGptArchitect only' },
];

/** Kernel dependants that are neither reached nor declared, and why they stay out. */
const KERNEL_DEPENDANT_EXCLUSIONS = [
  { path: 'src/relay/workspace/julius-tools/node-tool-adapter.ts', reason: 'the local in-process tool adapter (bounded host filesystem + /bin/bash). Since #208 every tool effect goes through the independent executor control plane and the live harness has no import through which this adapter could arrive; it survives for the offline tooling audit and its tests' },
  { path: 'src/relay/mission/wonderland/wonderland-julius-state.ts', reason: "the Wonderland integration layer's read of Julius. It imports JULIUS_MISSION_STATES and JuliusOperationalEventType to derive what the WORLD SHOWS from what the kernel reports, and the direction is strictly one-way: it has no writer, no port, no adapter and nothing the kernel could call. Julius does not know a world exists, which is the same separation the Gauntlet Loop keeps" },
  { path: 'src/relay/mission/wonderland/wonderland-julius-link.ts', reason: "the same layer's composition of the two below — normalize, fold, and label where the events came from. It imports only JuliusOperationalEvent as a type; a Julius deployment that never renders a world neither reaches it nor is affected by it" },
  { path: 'src/relay/mission/wonderland/wonderland-evidence.ts', reason: "the same layer's honesty ladder: it replays a CAPTURE of Julius events through the normalizer and reducer to decide what a claim about the seam is worth. It imports JuliusOperationalEvent as a type only, runs after the fact over a recording, and can neither reach a kernel nor be reached by one — a Julius deployment that never renders a world is unaffected by whether anyone ever grades a capture" },
  { path: 'src/relay/mission/wonderland/wonderland-julius-normalizer.ts', reason: 'the same layer\'s adapter from a JuliusOperationalEvent to a WonderlandEvent. Pure, read-only over one event, and invoked by whatever composes the two — nothing in the kernel imports it, so a Julius deployment that never renders a world is unaffected by its existence' },
];

/**
 * Path-loaded assets: production files the harness needs at runtime but reaches
 * by filename rather than by import. Migrations are DISCOVERED from the
 * runner; the executor script is declared with the evidence that proves the
 * reference, and the run fails if the evidence disappears.
 */
const MIGRATION_RUNNER = 'src/relay/persistence/wonderland-postgres.ts';
const MIGRATION_DIR = 'src/relay/persistence/wonderland-migrations/';
const MIGRATION_IS_JULIUS = (name) => /julius/i.test(name);
const DECLARED_ASSETS = [
  {
    path: 'scripts/julius-docker-executor.sh',
    reason: 'the in-sandbox executor script that runs every untrusted invocation and seals the signed receipt chain; baked into the sandbox image by .github/workflows/julius-real-infra.yml and named by the Docker sandbox adapter',
    evidence: [
      { file: 'src/relay/workspace/julius-tools/docker-sandbox-adapter.ts', mustContain: 'julius-docker-executor.sh' },
      { file: '.github/workflows/julius-real-infra.yml', mustContain: 'scripts/julius-docker-executor.sh' },
    ],
  },
];

/** Files whose name says "julius" but which the trace shows are outside the harness. Reported for completeness. */
const NAMED_JULIUS_OUTSIDE_HARNESS = [
  { path: 'src/relay/integration/terminal/julius-event-port.ts', reason: "Relay-side normalized event SHAPE for the website / Live Terminal / CLI projections; imports nothing from the kernel — a read-only view, not the harness" },
  { path: 'src/relay/integration/terminal/julius-terminal-projection.ts', reason: 'one Julius event → one Relay terminal line; presentation, consumed by the CLI product and UI surfaces' },
  { path: 'src/relay/integration/commands/julius-command-parser.ts', reason: 'operator slash-command text → typed operation REQUEST (Relay side of the boundary); the live entrypoint has no operator command channel' },
  { path: 'src/relay/integration/commands/julius-operation-contracts.ts', reason: 'the Relay-side typed command contracts the parser produces; shape only, policy is Julius’s' },
  { path: 'src/relay/connectors/julius-tools/julius-tools.e2e.test.ts', reason: 'a test' },
  { path: 'scripts/julius-ci-callers.mjs', reason: 'CI/deployment plumbing: builds the executor caller table from root secrets' },
  { path: 'scripts/julius-derive-scoped-credentials.mjs', reason: 'CI/deployment plumbing: derives per-operation credentials for a CI caller' },
  { path: 'scripts/julius-executor-ready.mjs', reason: 'CI/deployment plumbing: waits for the executor to report ready' },
  { path: 'scripts/julius-sibling-e2e.ts', reason: 'the CI sibling-infrastructure end-to-end harness (a test driver)' },
  { path: 'scripts/julius-sibling-support.ts', reason: 'support for the CI sibling harness' },
  { path: 'scripts/julius-provider-independent-evals.ts', reason: 'the CI provider-independent evals (a test driver)' },
];

/* --------------------------------------------------------------- subsystems */

const SUBSYSTEMS = [
  ['MISSION CONTRACT / BOOTSTRAP', 'How an authorized Mission Contract becomes a durable Julius run: the contract shape and its validation, the compiled `JuliusBootstrapRequest`, the `JuliusBootstrapPort` and its production implementation (FK base rows, the CREATED run, acceptance criteria, Project Brain entries, the minimal initial task graph, the transition to READY). Nothing downstream of READY is reachable from here.'],
  ['DURABLE STATE / PROJECT BRAIN', 'The provider-neutral kernel: mission states and the transition table, tasks, evidence, decisions, the worker registry, the ports the runtime depends on, the reference in-memory store that models the durable semantics, and the compiled context snapshot (Project Brain entries → one bounded packet) every worker is handed.'],
  ['TASK GRAPH / SCHEDULER', 'One claimed task all the way through: policy, budget reservation, context compilation, dispatch, evidence, result acceptance, retry and fallback, the verification decision. Claiming (leases, ordinals, dependencies) is a store operation; `JuliusRunLoop.tick()` in the COMPLETION AUTHORITY file drives it.'],
  ['C.A.R.D. POLICY', 'The Compound Agent record Relay owns (slots, activations, pinned revisions, mission defaults, reviewer entitlement) and the evaluator Julius applies to it: ALLOW / DENY / REQUIRE_APPROVAL / LIMITED per operation, never a prompt.'],
  ['WORKER REGISTRY / ROUTING', 'Which registered worker may take a task, in the router’s own order; provider health; dispatch through the adapter with `JuliusDispatchError` as the only failure shape. `JuliusWorkerRegistry` itself is declared in the kernel file.'],
  ['PROMPT ARCHITECT', 'The planning role: the provider-neutral plan contract and its validation gate, the strict JSON schema every answer must satisfy, and the one live OpenAI Responses call with its server-side configuration and offline readiness.'],
  ['CODING AGENT', 'The implementation role: one hosted Claude Agent SDK execution behind a pure safety envelope, pure observation of the run, and readiness that never makes a provider call.'],
  ['INDEPENDENT REVIEWER', 'The judgement role: the Hermes reviewer process runner in an isolated profile, provider identity, usage parsing, and bridge redaction as the last line before any text leaves the process. Independence from the Coding Agent’s vendor is refused, not assumed.'],
  ['AGENT TURN LOOP', 'The bounded, provider-neutral model↔tool loop a worker turn runs inside, and sub-agents that actually execute through the same pipeline under a permission subset. Global completion stays Julius’s decision.'],
  ['TOOLS', 'Tool ids and kinds, invocation requests and results, the tool controller’s C.A.R.D. and budget decisions, sandbox identity and limits, fail-closed tool-lifecycle recovery, settlement, workspace provisioning, and the live shell port that routes every effect to the independent executor.'],
  ['INDEPENDENT EXECUTOR', 'The separate control-plane process Julius cannot reach past: per-operation scoped credentials, strict request schemas, the Docker sandbox adapter, durable receipts and ledgers, signed attestation, the in-sandbox script, and the remote client Julius uses.'],
  ['ARTIFACTS / EVIDENCE', 'Artifact metadata, scope and the staged→finalized store port with its durable local implementation. Evidence facts themselves are kernel types persisted with the run and cited by every verification decision.'],
  ['VERIFICATION', 'Acceptance criteria, reviewer findings, `verifyTask` and `evaluateJuliusVerification`: the gate that decides ACCEPT / REPAIR / HALT from evidence, never from a worker’s say-so.'],
  ['REPAIR', 'A repair round planned from reviewer findings and a REPAIR decision, bounded by the verification policy’s `maxRepairRounds`, routed to a CODING_AGENT as `repair:<taskType>`.'],
  ['RECOVERY / CONTINUATION', 'A deterministic recovery plan derived exclusively from durable state, and autonomy as a decision about continuing after a decision point — never about what is permitted.'],
  ['LEASES / BUDGETS / PERMISSIONS', 'The durable lease protocol (generation fencing, heartbeat, expiry, admission), approvals / pause / resume / cancel as durable operations, and sub-agent authorization (depth, count, permission subset). The run-level spend ceiling is assembled in LIVE PROVIDER COMPOSITION.'],
  ['EVENTS / TRAJECTORIES', 'Every authoritative transition has exactly one event type; the trajectory is the idempotent record of what a run did; observability and evals are projections of it with no high-cardinality labels.'],
  ['PERSISTENCE', 'PostgreSQL authority for Julius: the repositories bound to the runtime ports, the store aggregate the live root composes, the shared `relay_wonderland` database class whose `migrate()` applies the Julius schema, payload redaction, and the Julius migrations themselves.'],
  ['LIVE PROVIDER COMPOSITION', 'C.A.R.D. roles resolved to live adapters — fail closed, naming every missing variable and never a value — the three workers as `JuliusProviderAdapter`s, the run-spend budget, and the assembly of the same runtime shape the deterministic fixtures prove, with production parts in every socket.'],
  ['COMPLETION AUTHORITY', '`JuliusRunLoop.advanceRun` is the only place a run becomes COMPLETED (`MISSION_VERIFIED`: every task terminal, at least one decision, EVERY decision ACCEPT), and the authoritative execution API is the only surface through which anything outside the runtime starts, inspects or controls a run. No worker, adapter or entrypoint writes a run state.'],
];

/** First matching rule wins; exact paths before directory prefixes. */
const FILE_RULES = [
  // Kernel: src/relay/mission/julius — one file, one subsystem.
  ['src/relay/mission/julius/index.ts', 'DURABLE STATE / PROJECT BRAIN'],
  ['src/relay/mission/julius/julius-runtime.ts', 'DURABLE STATE / PROJECT BRAIN'],
  ['src/relay/mission/julius/julius-runtime-ports.ts', 'DURABLE STATE / PROJECT BRAIN'],
  ['src/relay/mission/julius/julius-memory-store.ts', 'DURABLE STATE / PROJECT BRAIN'],
  ['src/relay/mission/julius/julius-context-snapshot.ts', 'DURABLE STATE / PROJECT BRAIN'],
  ['src/relay/mission/julius/julius-state-path.ts', 'DURABLE STATE / PROJECT BRAIN'],
  ['src/relay/mission/julius/julius-task-pipeline.ts', 'TASK GRAPH / SCHEDULER'],
  ['src/relay/mission/julius/julius-execution-coordinator.ts', 'TASK GRAPH / SCHEDULER'],
  ['src/relay/mission/julius/julius-policy.ts', 'C.A.R.D. POLICY'],
  ['src/relay/mission/julius/julius-router.ts', 'WORKER REGISTRY / ROUTING'],
  ['src/relay/mission/julius/julius-agent-turn-loop.ts', 'AGENT TURN LOOP'],
  ['src/relay/mission/julius/julius-subagent-runtime.ts', 'AGENT TURN LOOP'],
  ['src/relay/mission/julius/julius-tools.ts', 'TOOLS'],
  ['src/relay/mission/julius/julius-tool-lifecycle.ts', 'TOOLS'],
  ['src/relay/mission/julius/julius-tool-settlement.ts', 'TOOLS'],
  ['src/relay/mission/julius/julius-sandbox.ts', 'TOOLS'],
  ['src/relay/mission/julius/julius-artifacts.ts', 'ARTIFACTS / EVIDENCE'],
  ['src/relay/mission/julius/julius-verification-runtime.ts', 'VERIFICATION'],
  ['src/relay/mission/julius/julius-repair-runtime.ts', 'REPAIR'],
  ['src/relay/mission/julius/julius-recovery.ts', 'RECOVERY / CONTINUATION'],
  ['src/relay/mission/julius/julius-continuation.ts', 'RECOVERY / CONTINUATION'],
  ['src/relay/mission/julius/julius-lease-protocol.ts', 'LEASES / BUDGETS / PERMISSIONS'],
  ['src/relay/mission/julius/julius-lifecycle-runtime.ts', 'LEASES / BUDGETS / PERMISSIONS'],
  ['src/relay/mission/julius/julius-bounded-runtime.ts', 'LEASES / BUDGETS / PERMISSIONS'],
  ['src/relay/mission/julius/julius-events.ts', 'EVENTS / TRAJECTORIES'],
  ['src/relay/mission/julius/julius-trajectory.ts', 'EVENTS / TRAJECTORIES'],
  ['src/relay/mission/julius/julius-metrics.ts', 'EVENTS / TRAJECTORIES'],
  ['src/relay/mission/julius/julius-run-loop.ts', 'COMPLETION AUTHORITY'],
  ['src/relay/mission/julius/julius-runtime-api.ts', 'COMPLETION AUTHORITY'],
  // Bridge-side composition.
  ['relay-bridge/julius-live-mission.ts', 'MISSION CONTRACT / BOOTSTRAP'],
  ['relay-bridge/julius/bootstrap.ts', 'MISSION CONTRACT / BOOTSTRAP'],
  ['relay-bridge/julius/mission-seed.ts', 'MISSION CONTRACT / BOOTSTRAP'],
  ['relay-bridge/julius/postgres-store.ts', 'PERSISTENCE'],
  ['relay-bridge/julius/executor-effects.ts', 'TOOLS'],
  ['relay-bridge/julius/sandbox-limits.ts', 'TOOLS'],
  ['relay-bridge/julius/live-composition.ts', 'LIVE PROVIDER COMPOSITION'],
  ['relay-bridge/julius/live-workers.ts', 'LIVE PROVIDER COMPOSITION'],
  ['relay-bridge/hosted-coding-agent/', 'CODING AGENT'],
  ['relay-bridge/hermes-reviewer.ts', 'INDEPENDENT REVIEWER'],
  ['relay-bridge/reviewer-harness/hermes/', 'INDEPENDENT REVIEWER'],
  ['relay-bridge/redact.ts', 'INDEPENDENT REVIEWER'],
  // Relay ↔ Julius seam and vocabularies.
  ['src/relay/integration/julius/', 'MISSION CONTRACT / BOOTSTRAP'],
  ['src/relay/mission/contracts.ts', 'MISSION CONTRACT / BOOTSTRAP'],
  ['src/relay/protocol/enums.ts', 'MISSION CONTRACT / BOOTSTRAP'],
  ['src/relay/integration/compound-agent/', 'C.A.R.D. POLICY'],
  ['src/relay/mission/entitlement.ts', 'C.A.R.D. POLICY'],
  // Provider connectors.
  ['src/relay/connectors/gpt-architect/', 'PROMPT ARCHITECT'],
  ['src/relay/mission/prompt-architect/', 'PROMPT ARCHITECT'],
  // Tool substrate and the executor.
  ['src/relay/workspace/julius-tools/workspace-provisioning.ts', 'TOOLS'],
  ['src/relay/workspace/julius-tools/registry.ts', 'TOOLS'],
  ['src/relay/workspace/julius-tools/local-artifact-store.ts', 'ARTIFACTS / EVIDENCE'],
  ['src/relay/workspace/julius-tools/', 'INDEPENDENT EXECUTOR'],
  ['scripts/julius-docker-executor.sh', 'INDEPENDENT EXECUTOR'],
  // Persistence.
  ['src/relay/persistence/', 'PERSISTENCE'],
];

/** Coarse groups for the observed dependency-direction table in the manifest. */
const GROUPS = [
  ['relay-bridge/julius-live-mission.ts', 'entrypoint (relay-bridge/julius-live-mission.ts)'],
  ['relay-bridge/julius/', 'live composition (relay-bridge/julius/)'],
  ['relay-bridge/', 'bridge provider stacks (hosted Claude, Hermes, redaction)'],
  ['src/relay/mission/julius/', 'kernel (src/relay/mission/julius/)'],
  ['src/relay/persistence/', 'persistence (src/relay/persistence/)'],
  ['src/relay/integration/julius/', 'Relay↔Julius port (src/relay/integration/julius/)'],
  ['src/relay/integration/compound-agent/', 'C.A.R.D. record (src/relay/integration/compound-agent/, entitlement)'],
  ['src/relay/mission/entitlement.ts', 'C.A.R.D. record (src/relay/integration/compound-agent/, entitlement)'],
  ['src/relay/workspace/julius-tools/', 'executor + tool substrate (src/relay/workspace/julius-tools/)'],
  ['src/relay/connectors/', 'connectors (gpt-architect, prompt-architect contracts)'],
  ['src/relay/mission/prompt-architect/', 'connectors (gpt-architect, prompt-architect contracts)'],
  ['src/relay/mission/contracts.ts', 'Relay vocabulary (mission/contracts.ts, protocol/enums.ts)'],
  ['src/relay/protocol/', 'Relay vocabulary (mission/contracts.ts, protocol/enums.ts)'],
];

/* ========================================================================== *
 *  MECHANICS
 * ========================================================================== */

const TEST_FILE = /\.(test|spec)\.[cm]?[tj]sx?$/;
const TEST_DIR = /(^|\/)(testing|__tests__|__mocks__|fixtures)\//;
const UI_FILE = (p) => p.endsWith('.tsx') || p.startsWith('src/relay/ui/');
const SOURCE_EXTS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs'];

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const countLines = (buf) => {
  if (buf.length === 0) return 0;
  let n = 0;
  for (let i = 0; i < buf.length; i += 1) if (buf[i] === 0x0a) n += 1;
  return buf[buf.length - 1] === 0x0a ? n : n + 1;
};
const fmt = (n) => n.toLocaleString('en-US');

class Failure extends Error {}
const fail = (message) => { throw new Failure(message); };

function readEdges(relPath) {
  const text = readFileSync(abs(relPath), 'utf8');
  const kind = relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(relPath, text, ts.ScriptTarget.Latest, true, kind);
  const edges = [];
  const allTypeOnly = (elements) => elements.length > 0 && elements.every((element) => element.isTypeOnly === true);
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause;
      const typeOnly = !!clause && (clause.isTypeOnly === true
        || (!clause.name && !!clause.namedBindings && ts.isNamedImports(clause.namedBindings) && allTypeOnly(clause.namedBindings.elements)));
      edges.push({ spec: node.moduleSpecifier.text, typeOnly, form: 'import' });
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const typeOnly = node.isTypeOnly === true
        || (!!node.exportClause && ts.isNamedExports(node.exportClause) && allTypeOnly(node.exportClause.elements));
      edges.push({ spec: node.moduleSpecifier.text, typeOnly, form: 'export-from' });
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)
      && ts.isStringLiteral(node.moduleReference.expression)) {
      edges.push({ spec: node.moduleReference.expression.text, typeOnly: node.isTypeOnly === true, form: 'import-equals' });
    } else if (ts.isCallExpression(node) && node.arguments.length > 0 && ts.isStringLiteralLike(node.arguments[0])) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) edges.push({ spec: node.arguments[0].text, typeOnly: false, form: 'dynamic-import' });
      else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') edges.push({ spec: node.arguments[0].text, typeOnly: false, form: 'require' });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return edges;
}

function resolveSpecifier(fromRel, spec) {
  if (!spec.startsWith('./') && !spec.startsWith('../')) return { external: spec.startsWith('node:') ? 'node' : 'package', name: spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0] };
  const base = resolve(dirname(abs(fromRel)), spec);
  const candidates = [base];
  if (/\.[cm]?js$/.test(base)) candidates.push(base.replace(/\.([cm]?)js$/, '.$1ts'));
  for (const ext of SOURCE_EXTS) candidates.push(base + ext);
  for (const ext of SOURCE_EXTS) candidates.push(resolve(base, `index${ext}`));
  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return { file: rel(candidate) };
  }
  return { unresolved: spec };
}

function classify(relPath) {
  for (const rule of FILE_RULES) {
    const [pattern, subsystem] = rule;
    if (pattern.endsWith('/') ? relPath.startsWith(pattern) : relPath === pattern) return subsystem;
  }
  return null;
}
const groupOf = (relPath) => (GROUPS.find(([prefix]) => (prefix.endsWith('/') ? relPath.startsWith(prefix) : relPath === prefix)) ?? [null, 'other'])[1];

function git(args) {
  try { return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

/* ------------------------------------------------------------------ trace */

function trace() {
  /** @type {Map<string, {role:string, reachedFrom:string|null, reason:string|null, label?:string}>} */
  const included = new Map();
  const crossings = [];      // { from, to, boundary, typeOnly }
  const exclusionHits = [];  // { from, to, category }
  const externals = new Map(); // name -> { kind, importers:Set }
  const edgesByFile = new Map();
  const problems = [];

  const enter = (relPath, role, reachedFrom, reason, label) => {
    if (included.has(relPath)) return;
    if (!existsSync(abs(relPath))) return void problems.push(`${role} file does not exist: ${relPath}`);
    if (TEST_FILE.test(relPath) || TEST_DIR.test(relPath)) return void problems.push(`production Julius reaches a test file: ${relPath} (from ${reachedFrom})`);
    if (UI_FILE(relPath)) return void problems.push(`production Julius reaches a UI file: ${relPath} (from ${reachedFrom})`);
    included.set(relPath, { role, reachedFrom, reason, label });
    const edges = readEdges(relPath);
    edgesByFile.set(relPath, []);
    for (const edge of edges) {
      const resolved = resolveSpecifier(relPath, edge.spec);
      if (resolved.external) {
        const entry = externals.get(resolved.name) ?? { kind: resolved.external, importers: new Set() };
        entry.importers.add(relPath);
        externals.set(resolved.name, entry);
        continue;
      }
      if (resolved.unresolved) { problems.push(`unresolved import "${edge.spec}" in ${relPath}`); continue; }
      const target = resolved.file;
      edgesByFile.get(relPath).push({ to: target, typeOnly: edge.typeOnly, form: edge.form });
      const boundary = BOUNDARIES.find((entry) => target.startsWith(entry.prefix));
      if (boundary) { crossings.push({ from: relPath, to: target, boundary: boundary.prefix, typeOnly: edge.typeOnly }); continue; }
      const excluded = EXCLUDED_FILES.find((entry) => entry.path === target);
      if (excluded) { exclusionHits.push({ from: relPath, to: target, category: excluded.category }); continue; }
      enter(target, 'traced', relPath, null);
    }
  };

  for (const root of ROOTS) enter(root.path, 'root', null, null, root.label);
  const reachedFromRoots = new Set(included.keys());
  for (const declared of DECLARED_NOT_COMPOSED) {
    if (reachedFromRoots.has(declared.path)) problems.push(`declared "not composed" but reached from a root — remove the declaration: ${declared.path}`);
  }
  for (const declared of DECLARED_NOT_COMPOSED) enter(declared.path, 'declared', null, declared.reason);
  for (const excluded of KERNEL_DEPENDANT_EXCLUSIONS) {
    if (included.has(excluded.path)) problems.push(`excluded as a kernel dependant but reached by the trace — reclassify: ${excluded.path}`);
  }
  for (const excluded of EXCLUDED_FILES) {
    if (included.has(excluded.path)) problems.push(`excluded (${excluded.category}) but included — a declared or root file imports it directly: ${excluded.path}`);
  }

  /* Path-loaded assets. */
  const migrations = [];
  const migrationsExcluded = [];
  if (!included.has(MIGRATION_RUNNER)) problems.push(`the migration runner ${MIGRATION_RUNNER} was not reached — migrations cannot be discovered`);
  else {
    const runnerText = readFileSync(abs(MIGRATION_RUNNER), 'utf8');
    const names = [...runnerText.matchAll(/migration\(\s*'([^']+\.sql)'\s*\)/g)].map((match) => match[1]);
    if (names.length === 0) problems.push(`no migration('<file>.sql') registrations found in ${MIGRATION_RUNNER}`);
    for (const name of names) {
      const path = `${MIGRATION_DIR}${name}`;
      if (!existsSync(abs(path))) { problems.push(`registered migration does not exist: ${path}`); continue; }
      if (MIGRATION_IS_JULIUS(name)) migrations.push(path); else migrationsExcluded.push(path);
    }
    for (const path of migrations) included.set(path, { role: 'asset', reachedFrom: MIGRATION_RUNNER, reason: 'Julius schema migration, registered by filename in the migration runner' });
  }
  for (const asset of DECLARED_ASSETS) {
    for (const evidence of asset.evidence) {
      if (!existsSync(abs(evidence.file))) { problems.push(`asset evidence file missing: ${evidence.file}`); continue; }
      if (!readFileSync(abs(evidence.file), 'utf8').includes(evidence.mustContain)) problems.push(`asset ${asset.path} is no longer referenced by ${evidence.file} (expected "${evidence.mustContain}")`);
    }
    if (!existsSync(abs(asset.path))) problems.push(`declared asset does not exist: ${asset.path}`);
    else included.set(asset.path, { role: 'asset', reachedFrom: asset.evidence[0].file, reason: asset.reason });
  }

  /* Drift gate: every kernel dependant is reached, declared or excluded. */
  const kernelDependants = scanKernelDependants();
  const unclassified = kernelDependants.filter((path) => !included.has(path)
    && !KERNEL_DEPENDANT_EXCLUSIONS.some((entry) => entry.path === path)
    && !EXCLUDED_FILES.some((entry) => entry.path === path));
  for (const path of unclassified) problems.push(`unclassified Julius kernel dependant (reach it from a root, declare it, or exclude it with a reason): ${path}`);
  for (const entry of KERNEL_DEPENDANT_EXCLUSIONS) {
    if (!kernelDependants.includes(entry.path)) problems.push(`kernel-dependant exclusion no longer imports the kernel — drop or re-justify it: ${entry.path}`);
  }
  for (const entry of NAMED_JULIUS_OUTSIDE_HARNESS) {
    if (!existsSync(abs(entry.path))) problems.push(`"named julius, outside the harness" entry does not exist: ${entry.path}`);
    if (included.has(entry.path)) problems.push(`listed as outside the harness but included: ${entry.path}`);
  }

  /* Structural invariant the manifest states: nothing under src/relay imports relay-bridge. */
  for (const [from, edges] of edgesByFile) {
    if (!from.startsWith('src/relay/')) continue;
    for (const edge of edges) if (edge.to.startsWith('relay-bridge/')) problems.push(`boundary inversion: ${from} imports ${edge.to}`);
  }

  /* Files: bytes, lines, hashes, subsystem. */
  const files = [...included.entries()].map(([path, meta]) => {
    const buffer = readFileSync(abs(path));
    const subsystem = classify(path);
    if (subsystem === null) problems.push(`included file maps to no subsystem — add a FILE_RULES entry: ${path}`);
    return { path, ...meta, subsystem, bytes: buffer.length, lines: countLines(buffer), sha256: sha256(buffer), buffer, group: groupOf(path) };
  });
  const order = new Map(SUBSYSTEMS.map(([name], index) => [name, index]));
  files.sort((a, b) => (order.get(a.subsystem) ?? 99) - (order.get(b.subsystem) ?? 99) || a.path.localeCompare(b.path));
  for (const [name] of SUBSYSTEMS) {
    if (!files.some((file) => file.subsystem === name)) problems.push(`required subsystem maps to no production file: ${name}`);
  }

  /* Pruned subtree sizes, for the report only (traced without inclusion). */
  const prunedSubtrees = BOUNDARIES.map((boundary) => {
    const seen = new Set();
    const stack = crossings.filter((edge) => edge.boundary === boundary.prefix).map((edge) => edge.to);
    while (stack.length > 0) {
      const path = stack.pop();
      if (seen.has(path) || included.has(path)) continue;
      seen.add(path);
      for (const edge of readEdges(path)) {
        const resolved = resolveSpecifier(path, edge.spec);
        if (resolved.file) stack.push(resolved.file);
      }
    }
    let lines = 0;
    for (const path of seen) lines += countLines(readFileSync(abs(path)));
    return { prefix: boundary.prefix, reason: boundary.reason, files: [...seen].sort(), lines, crossings: crossings.filter((edge) => edge.boundary === boundary.prefix) };
  });

  /* Observed dependency direction between coarse groups. */
  const direction = new Map();
  for (const [from, edges] of edgesByFile) {
    for (const edge of edges) {
      if (!included.has(edge.to)) continue;
      const a = groupOf(from); const b = groupOf(edge.to);
      if (a === b) continue;
      const key = `${a} → ${b}`;
      const entry = direction.get(key) ?? { from: a, to: b, edges: 0, typeOnly: 0 };
      entry.edges += 1; if (edge.typeOnly) entry.typeOnly += 1;
      direction.set(key, entry);
    }
  }

  /* Coverage: represented bytes over the Julius production universe. */
  const universePaths = new Set([
    ...included.keys(),
    ...EXCLUDED_FILES.map((entry) => entry.path),
    ...KERNEL_DEPENDANT_EXCLUSIONS.map((entry) => entry.path),
    ...kernelDependants,
    ...migrationsExcluded.filter((path) => /julius/i.test(path)),
    ...NAMED_JULIUS_OUTSIDE_HARNESS.map((entry) => entry.path).filter((path) => !TEST_FILE.test(path) && !/sibling|evals/.test(path)),
  ]);
  const measure = (paths) => {
    let bytes = 0; let lines = 0;
    for (const path of paths) { if (!existsSync(abs(path))) continue; const buffer = readFileSync(abs(path)); bytes += buffer.length; lines += countLines(buffer); }
    return { files: paths.length, bytes, lines };
  };
  const universe = measure([...universePaths]);
  const represented = { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0), lines: files.reduce((sum, file) => sum + file.lines, 0) };
  const excludedInUniverse = [...universePaths].filter((path) => !included.has(path)).sort();

  return {
    files, crossings, exclusionHits, externals, problems, migrations, migrationsExcluded, kernelDependants, prunedSubtrees,
    direction: [...direction.values()].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to)),
    coverage: { universe, represented, excludedInUniverse, percentBytes: universe.bytes === 0 ? 0 : (represented.bytes / universe.bytes) * 100, percentFiles: universe.files === 0 ? 0 : (represented.files / universe.files) * 100 },
    commit: git(['rev-parse', 'HEAD']) ?? 'unknown',
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']) ?? 'unknown',
    dirty: (git(['status', '--porcelain', '--untracked-files=no']) ?? '') !== '',
  };
}

/** Every production .ts/.tsx under src/, relay-bridge/, relay-hermes-service/ that imports the Julius kernel or the Julius port. */
function scanKernelDependants() {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
      if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
      const relPath = rel(full);
      if (TEST_FILE.test(relPath) || TEST_DIR.test(relPath)) continue;
      if (!readFileSync(full, 'utf8').includes('julius')) continue;
      for (const edge of readEdges(relPath)) {
        const resolved = resolveSpecifier(relPath, edge.spec);
        if (resolved.file && (resolved.file.startsWith('src/relay/mission/julius/') || resolved.file === 'src/relay/integration/julius/julius-port.ts')) { found.push(relPath); break; }
      }
    }
  };
  for (const top of ['src', 'relay-bridge', 'relay-hermes-service']) if (existsSync(abs(top))) walk(abs(top));
  return found.sort();
}

/* ------------------------------------------------------------- rendering */

const RULE = '#'.repeat(100);

function renderExport(result) {
  const { files } = result;
  const total = files.length;
  const width = String(total).length;
  const num = (index) => String(index + 1).padStart(width, '0');
  const subsystemIndex = SUBSYSTEMS.map(([name], index) => {
    const members = files.filter((file) => file.subsystem === name);
    return `  ${String(index + 1).padStart(2, '0')} ${name.padEnd(34, '.')} ${String(members.length).padStart(3)} files ${fmt(members.reduce((sum, file) => sum + file.lines, 0)).padStart(8)} lines`;
  });
  const roleTag = (file) => file.role === 'root' ? 'ROOT' : file.role === 'declared' ? 'NOT-COMPOSED' : file.role === 'asset' ? 'ASSET' : 'traced';
  const fileIndex = files.map((file, index) => `  ${num(index)}  ${String(SUBSYSTEMS.findIndex(([name]) => name === file.subsystem) + 1).padStart(2, '0')}  ${roleTag(file).padEnd(12)} ${fmt(file.lines).padStart(6)} ${fmt(file.bytes).padStart(9)}  ${file.sha256.slice(0, 12)}  ${file.path}`);
  const head = [
    'JULIUS HARNESS SOURCE — single-file inspection export',
    '='.repeat(100),
    'GENERATED FILE — NOT SOURCE OF TRUTH. The modular production files listed below are authoritative.',
    'Julius stays a modular Compound AI harness; this file exists so a person can scroll through it.',
    '',
    `Generator:   ${GENERATOR_PATH}   (regenerate: node ${GENERATOR_PATH}; verify: --check)`,
    `Manifest:    ${DEFAULT_MANIFEST_PATH}`,
    `Commit:      ${result.commit}   working tree: ${result.dirty ? 'DIRTY (tracked changes present)' : 'clean'}   branch: ${result.branch}`,
    `Roots:       ${ROOTS.map((root) => root.path).join('  |  ')}`,
    `Files: ${fmt(total)}   Lines: ${fmt(result.coverage.represented.lines)}   Bytes: ${fmt(result.coverage.represented.bytes)}`,
    '',
    'Every file is reproduced byte-for-byte. The only additions are the FILE / END FILE boundary blocks;',
    'a file\'s content starts on the line after its opening block and is exactly BYTES bytes long. When a',
    'file does not end with a newline, one is inserted before the END FILE block and TRAILING NEWLINE says "no".',
    'Roles: ROOT = production composition root; traced = reached by static import from a root;',
    'NOT-COMPOSED = production Julius module declared by the generator, not reached from the live root;',
    'ASSET = loaded by path at runtime (schema migration, in-sandbox script).',
    '',
    'SUBSYSTEM INDEX',
    ...subsystemIndex,
    '',
    'FILE INDEX',
    `  ${'#'.padStart(width)}  SS  ROLE          LINES     BYTES  SHA256(12)    PATH`,
    ...fileIndex,
    '',
  ].join('\n');

  const chunks = [Buffer.from(`${head}\n`, 'utf8')];
  files.forEach((file, index) => {
    const trailing = file.buffer.length === 0 || file.buffer[file.buffer.length - 1] === 0x0a;
    const roleLine = file.role === 'root' ? `root — ${file.label}`
      : file.role === 'declared' ? `NOT COMPOSED BY THE LIVE ROOT — ${file.reason}`
        : file.role === 'asset' ? `asset — ${file.reason}` : 'traced';
    const header = [
      RULE,
      `# FILE ${num(index)}/${total}`,
      `# PATH:      ${file.path}`,
      `# SUBSYSTEM: ${String(SUBSYSTEMS.findIndex(([name]) => name === file.subsystem) + 1).padStart(2, '0')} ${file.subsystem}`,
      `# ROLE:      ${roleLine}`,
      `# REACHED:   ${file.reachedFrom ?? '(root)'}`,
      `# LINES: ${file.lines}   BYTES: ${file.bytes}   SHA256: ${file.sha256}   TRAILING NEWLINE: ${trailing ? 'yes' : 'no'}`,
      RULE,
      '',
    ].join('\n');
    chunks.push(Buffer.from(header, 'utf8'), file.buffer);
    if (!trailing) chunks.push(Buffer.from('\n', 'utf8'));
    chunks.push(Buffer.from(`${RULE}\n# END FILE ${num(index)}/${total}  ${file.path}\n${RULE}\n\n`, 'utf8'));
  });
  return Buffer.concat(chunks);
}

/** Reconstruct every file from an export buffer and compare hashes against the working tree. */
function verifyExport(buffer) {
  const text = buffer.toString('latin1'); // byte-preserving view for offset arithmetic
  const problems = [];
  let cursor = 0; let count = 0;
  for (;;) {
    const start = text.indexOf(`${RULE}\n# FILE `, cursor);
    if (start < 0) break;
    const headerEnd = text.indexOf(`\n${RULE}\n`, start + RULE.length + 1);
    if (headerEnd < 0) { problems.push('truncated FILE header'); break; }
    const header = text.slice(start, headerEnd);
    const path = /\n# PATH:\s+(.+)/.exec(header)?.[1];
    const bytes = Number(/BYTES: (\d+)/.exec(header)?.[1]);
    const sha = /SHA256: ([0-9a-f]{64})/.exec(header)?.[1];
    const contentStart = headerEnd + RULE.length + 2;
    const content = buffer.subarray(contentStart, contentStart + bytes);
    if (!path || !Number.isFinite(bytes) || !sha) { problems.push(`malformed header near byte ${start}`); break; }
    if (sha256(content) !== sha) problems.push(`export content for ${path} does not match its recorded SHA256`);
    else if (!existsSync(abs(path))) problems.push(`export names a file that no longer exists: ${path}`);
    else if (sha256(readFileSync(abs(path))) !== sha) problems.push(`export is stale for ${path} (working tree differs)`);
    count += 1;
    cursor = contentStart + bytes;
  }
  return { count, problems };
}

function renderManifest(result) {
  const { files } = result;
  const byRole = (file) => file.role === 'root' ? 'root' : file.role === 'declared' ? 'not composed by the live root' : file.role === 'asset' ? 'asset (path-loaded)' : 'traced';
  const table = (rows, headers) => [`| ${headers.join(' | ')} |`, `| ${headers.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`)].join('\n');
  const total = result.coverage.represented;
  const out = [];
  out.push('# JULIUS HARNESS MANIFEST');
  out.push('');
  out.push('**GENERATED by `scripts/export-julius-harness.mjs` — regenerate with `node scripts/export-julius-harness.mjs`; verify with `--check`. Do not edit by hand.**');
  out.push('');
  out.push('The canonical map of Julius, Relay\'s Compound AI harness: what it is, which subsystem does what, the production source files implementing each, the dependency direction the trace observed, and the production composition roots. The single-file export `generated/JULIUS_HARNESS_SOURCE.txt` (gitignored) is an inspection view derived from the same trace; it is **not** source of truth — the modular production files listed here are.');
  out.push('');
  out.push('## Definition');
  out.push('');
  out.push('Julius is the provider-neutral, deterministic orchestration kernel that turns an authorized Mission Contract into a durable run executed by three C.A.R.D. roles — a **Prompt Architect** that plans, a **Coding Agent** that implements, an **Independent Reviewer** that judges — where Julius, never a worker, owns policy, budget, evidence, verification, repair, recovery and completion. It is modular by construction: a kernel with ports, PostgreSQL repositories bound to those ports, provider adapters wired only in the live composition, and an independent executor process that every tool effect must pass through.');
  out.push('');
  out.push('## Production composition roots');
  out.push('');
  for (const root of ROOTS) out.push(`- **${root.label}** — \`${root.path}\`. ${root.detail}`);
  out.push('');
  out.push('## Discovery');
  out.push('');
  out.push('Static import closure from the two roots over the TypeScript AST (value and type edges), stopping at the declared boundaries below; plus declared production modules not reached from the live root (flagged); plus path-loaded assets. Tests, fixtures, fakes and UI are refused by category. A drift gate fails the generator when a production file imports the Julius kernel or port without being reached, declared or explicitly excluded, or when a declaration no longer matches the wiring.');
  out.push('');
  out.push(`Represented: **${fmt(total.files)} production files** across ${SUBSYSTEMS.length}/${SUBSYSTEMS.length} subsystems (${result.files.filter((f) => f.role === 'root').length} roots, ${result.files.filter((f) => f.role === 'traced').length} traced, ${result.files.filter((f) => f.role === 'declared').length} not composed by the live root, ${result.files.filter((f) => f.role === 'asset').length} path-loaded assets). Line and byte totals, the coverage estimate and the commit SHA are printed by the generator and recorded in the export header; they are kept out of this file so it changes only when the file set or its classification changes.`);
  out.push('');
  out.push('## Dependency direction (observed, between coarse groups)');
  out.push('');
  out.push('Edges counted by the trace between included files; "type" = type-only imports, erased at build.');
  out.push('');
  out.push(table(result.direction.map((edge) => [edge.from, edge.to, String(edge.edges), String(edge.typeOnly)]), ['from', 'to', 'edges', 'type']));
  out.push('');
  const groupsInOrder = [...new Set(GROUPS.map(([, name]) => name))];
  for (const group of groupsInOrder) {
    const targets = result.direction.filter((edge) => edge.from === group).map((edge) => edge.to);
    if (targets.length > 0) out.push(`- **${group}** depends on: ${targets.join('; ')}.`);
    else if (result.files.some((file) => file.group === group)) out.push(`- **${group}** depends on nothing outside itself (among included files).`);
  }
  out.push('');
  out.push('No included file under `src/relay` imports `relay-bridge` (the generator fails otherwise).');
  out.push('');
  out.push('## Subsystems');
  out.push('');
  SUBSYSTEMS.forEach(([name, definition], index) => {
    const members = files.filter((file) => file.subsystem === name);
    out.push(`### ${String(index + 1).padStart(2, '0')} ${name}`);
    out.push('');
    out.push(definition);
    out.push('');
    out.push(table(members.map((file) => [`\`${file.path}\``, byRole(file), file.reachedFrom ? `\`${file.reachedFrom}\`` : '—']), ['production source', 'role', 'reached from']));
    out.push('');
  });
  out.push('## Boundaries the trace does not cross');
  out.push('');
  for (const pruned of result.prunedSubtrees) {
    out.push(`- **\`${pruned.prefix}\`** — ${pruned.reason}`);
    out.push(`  Would have pulled ${pruned.files.length} files. Crossing edges: ${pruned.crossings.map((edge) => `\`${edge.from}\` → \`${edge.to}\`${edge.typeOnly ? ' (type-only)' : ''}`).join('; ')}.`);
  }
  out.push('');
  out.push('## Excluded by category');
  out.push('');
  for (const entry of EXCLUDED_FILES) {
    const hits = result.exclusionHits.filter((hit) => hit.to === entry.path).map((hit) => `\`${hit.from}\``);
    out.push(`- **${entry.category}** — \`${entry.path}\`: ${entry.reason}. Reached only via ${hits.join(', ') || 'nothing'}.`);
  }
  for (const entry of KERNEL_DEPENDANT_EXCLUSIONS) out.push(`- **legacy local execution** — \`${entry.path}\`: ${entry.reason}.`);
  out.push(`- **pre-Julius schema** — ${result.migrationsExcluded.map((path) => `\`${path.slice(MIGRATION_DIR.length)}\``).join(', ')} under \`${MIGRATION_DIR}\`: registered by the same migration runner and applied in order before the Julius migrations; Julius tables reference \`relay_wonderland.projects\`, \`mission_contracts\` and \`budget_reservations\` defined there, and 017 is the Gauntlet Loop's own storage, deliberately not Julius's.`);
  out.push('');
  out.push('Named "julius", outside the harness (no kernel dependency, or CI/test drivers):');
  out.push('');
  for (const entry of NAMED_JULIUS_OUTSIDE_HARNESS) out.push(`- \`${entry.path}\` — ${entry.reason}.`);
  out.push('');
  out.push('## Not composed by the live root');
  out.push('');
  out.push('Production Julius modules that implement a Julius port but are not reached from either root. Included in the export and flagged; if one becomes reachable the generator fails until the declaration is removed.');
  out.push('');
  out.push(table(DECLARED_NOT_COMPOSED.map((entry) => [`\`${entry.path}\``, entry.reason]), ['module', 'why the live root does not reach it']));
  out.push('');
  out.push('## External packages observed');
  out.push('');
  const externals = [...result.externals.entries()].sort(([a], [b]) => a.localeCompare(b));
  out.push(table(externals.map(([name, entry]) => [`\`${name}\``, entry.kind]), ['package', 'kind']));
  out.push('');
  out.push('`@anthropic-ai/claude-agent-sdk` is loaded at runtime by `relay-bridge/hosted-coding-agent/hosted-runner.ts` through a dynamic import the AST cannot see (`HOSTED_SDK_PACKAGE`), and the Hermes reviewer is a spawned executable, not a package.');
  out.push('');
  out.push('## Drift gate');
  out.push('');
  out.push('The generator exits 1 when: a required subsystem maps to no file; an included file maps to no subsystem; a production import does not resolve; the trace reaches a test or UI file; a production file imports the kernel or the port without being reached, declared or excluded; a declared "not composed" module is reached from a root; an excluded module is reached; a declared asset loses its reference; a registered migration is missing. `--check` additionally fails when the committed manifest or the export on disk differs from a fresh generation, or when any exported file no longer hashes to its source.');
  out.push('');
  return `${out.join('\n')}`;
}

function renderReport(result, io) {
  const cov = result.coverage;
  const lines = [];
  lines.push('JULIUS HARNESS EXPORT REPORT');
  lines.push(`STATUS: ${result.problems.length === 0 ? 'OK' : `FAILED (${result.problems.length} problem${result.problems.length === 1 ? '' : 's'})`}`);
  for (const problem of result.problems) lines.push(`  ! ${problem}`);
  lines.push(`branch/SHA: ${result.branch} @ ${result.commit}${result.dirty ? ' (working tree dirty)' : ''}`);
  lines.push(`manifest path: ${io.manifestPath}${io.manifestWritten ? ' (written)' : io.check ? (io.manifestCurrent ? ' (current)' : ' (STALE)') : ''}`);
  lines.push(`generator path: ${GENERATOR_PATH}`);
  lines.push(`generated source path: ${io.exportPath}${io.exportWritten ? ' (written)' : io.check ? (io.exportCurrent ? ' (current, all files reconstruct byte-for-byte)' : ' (STALE or corrupt)') : ''}`);
  lines.push(`production files included: ${cov.represented.files}  (roots ${result.files.filter((f) => f.role === 'root').length}, traced ${result.files.filter((f) => f.role === 'traced').length}, not-composed ${result.files.filter((f) => f.role === 'declared').length}, assets ${result.files.filter((f) => f.role === 'asset').length})`);
  lines.push(`lines: ${fmt(cov.represented.lines)}   bytes: ${fmt(cov.represented.bytes)}`);
  lines.push(`subsystem coverage: ${SUBSYSTEMS.filter(([name]) => result.files.some((f) => f.subsystem === name)).length}/${SUBSYSTEMS.length}`);
  for (const [name] of SUBSYSTEMS) {
    const members = result.files.filter((f) => f.subsystem === name);
    lines.push(`  ${name.padEnd(32)} ${String(members.length).padStart(3)} files ${fmt(members.reduce((s, f) => s + f.lines, 0)).padStart(7)} lines`);
  }
  lines.push(`commit SHA: ${result.commit}`);
  lines.push('');
  lines.push('JULIUS HARNESS SOURCE COVERAGE');
  lines.push(`  estimated share of Julius production source represented: ${cov.percentBytes.toFixed(1)}% of bytes, ${cov.percentFiles.toFixed(1)}% of files`);
  lines.push(`  universe: ${cov.universe.files} files / ${fmt(cov.universe.lines)} lines / ${fmt(cov.universe.bytes)} bytes (included ∪ excluded Julius-owned production files)`);
  lines.push(`  production files intentionally excluded (${cov.excludedInUniverse.length}):`);
  for (const path of cov.excludedInUniverse) {
    const why = EXCLUDED_FILES.find((e) => e.path === path)?.reason ?? KERNEL_DEPENDANT_EXCLUSIONS.find((e) => e.path === path)?.reason ?? NAMED_JULIUS_OUTSIDE_HARNESS.find((e) => e.path === path)?.reason ?? (result.migrationsExcluded.includes(path) ? 'pre-Julius schema registered by the same runner' : 'unclassified');
    lines.push(`    - ${path} — ${why}`);
  }
  lines.push(`  boundaries (reached, pruned, outside the harness):`);
  for (const pruned of result.prunedSubtrees) lines.push(`    - ${pruned.prefix} — ${pruned.files.length} files / ${fmt(pruned.lines)} lines behind ${pruned.crossings.length} crossing edge(s)`);
  lines.push(`  excluded categories: tests, fixtures, fakes/mocks, test harnesses, UI (.tsx, src/relay/ui), Wonderland, Relay mission/protocol layers behind the boundaries, legacy local tool execution, docs, CI drivers, node_modules, build output, .env/secrets`);
  lines.push(`  kernel dependants classified: ${result.kernelDependants.length} (reached ${result.kernelDependants.filter((p) => result.files.some((f) => f.path === p && f.role !== 'declared')).length}, declared ${result.kernelDependants.filter((p) => result.files.some((f) => f.path === p && f.role === 'declared')).length}, excluded ${result.kernelDependants.filter((p) => KERNEL_DEPENDANT_EXCLUSIONS.some((e) => e.path === p)).length})`);
  return lines.join('\n');
}

/* ------------------------------------------------------------------- main */

function main(argv) {
  const has = (flag) => argv.includes(flag);
  const opt = (flag, fallback) => { const i = argv.indexOf(flag); return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback; };
  const unknown = argv.filter((a, i) => a.startsWith('--') && !['--check', '--json', '--out', '--manifest-out', '--no-manifest'].includes(a) && !(argv[i - 1] === '--out' || argv[i - 1] === '--manifest-out'));
  if (unknown.length > 0) { process.stderr.write(`unknown option(s): ${unknown.join(' ')}\n`); return 2; }
  const check = has('--check');
  const exportPath = opt('--out', DEFAULT_EXPORT_PATH);
  const manifestPath = opt('--manifest-out', DEFAULT_MANIFEST_PATH);
  // Output paths are resolved from the caller's working directory (absolute paths stay absolute);
  // every repository path elsewhere in this file is repository-relative.
  const outAbs = (value) => resolve(process.cwd(), value);
  const writeManifest = !has('--no-manifest');

  const result = trace();
  const io = { exportPath, manifestPath, check, exportWritten: false, manifestWritten: false, exportCurrent: null, manifestCurrent: null };

  if (result.problems.length === 0) {
    const exportBuffer = renderExport(result);
    const manifestText = renderManifest(result);
    if (check) {
      const exportAbs = outAbs(exportPath);
      if (!existsSync(exportAbs)) result.problems.push(`export missing: ${exportPath} (run the generator)`);
      else {
        const onDisk = readFileSync(exportAbs);
        const verified = verifyExport(onDisk);
        result.problems.push(...verified.problems);
        if (verified.count !== result.files.length) result.problems.push(`export on disk holds ${verified.count} files, a fresh trace yields ${result.files.length}`);
        if (!onDisk.equals(exportBuffer)) result.problems.push(`export on disk differs from a fresh generation: ${exportPath}`);
        io.exportCurrent = verified.problems.length === 0 && onDisk.equals(exportBuffer);
      }
      if (writeManifest) {
        const manifestAbs = outAbs(manifestPath);
        io.manifestCurrent = existsSync(manifestAbs) && readFileSync(manifestAbs, 'utf8') === manifestText;
        if (!io.manifestCurrent) result.problems.push(`manifest is not current: ${manifestPath} (run the generator)`);
      }
    } else {
      mkdirSync(dirname(outAbs(exportPath)), { recursive: true });
      writeFileSync(outAbs(exportPath), exportBuffer);
      io.exportWritten = true;
      const verified = verifyExport(readFileSync(outAbs(exportPath)));
      result.problems.push(...verified.problems);
      if (verified.count !== result.files.length) result.problems.push(`self-check: wrote ${verified.count} reconstructable files, expected ${result.files.length}`);
      if (writeManifest) { writeFileSync(outAbs(manifestPath), manifestText); io.manifestWritten = true; }
    }
  }

  if (has('--json')) {
    const json = {
      status: result.problems.length === 0 ? 'OK' : 'FAILED', problems: result.problems, branch: result.branch, commit: result.commit, dirty: result.dirty,
      generator: GENERATOR_PATH, exportPath, manifestPath,
      files: result.files.map((f) => ({ path: f.path, subsystem: f.subsystem, role: f.role, lines: f.lines, bytes: f.bytes, sha256: f.sha256, reachedFrom: f.reachedFrom })),
      totals: result.coverage.represented, coverage: { percentBytes: result.coverage.percentBytes, percentFiles: result.coverage.percentFiles, universe: result.coverage.universe, excluded: result.coverage.excludedInUniverse },
      subsystems: SUBSYSTEMS.map(([name]) => ({ name, files: result.files.filter((f) => f.subsystem === name).length })),
      boundaries: result.prunedSubtrees.map((p) => ({ prefix: p.prefix, files: p.files.length, lines: p.lines, crossings: p.crossings })),
      kernelDependants: result.kernelDependants, externals: [...result.externals.keys()].sort(),
    };
    process.stdout.write(`${JSON.stringify(json, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReport(result, io)}\n`);
  }
  return result.problems.length === 0 ? 0 : 1;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`export-julius-harness: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
