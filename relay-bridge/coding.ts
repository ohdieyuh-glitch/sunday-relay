/**
 * CODING AGENT connector (Claude Code) — the honest coding leg.
 *
 * This mirrors the proven `runClaudeProof` / live-runner pipeline exactly
 * (isolated throwaway workspace → real Claude edit → Relay-INDEPENDENT
 * inspection → Relay-run verification → completion policy), with one change:
 * the handoff's objective + acceptance come from the REAL Sunday Alcatraz
 * architect (so "the architect result becomes the coding-agent handoff"),
 * while Relay keeps the fixed safety envelope (claimed file, protected paths,
 * tools, verification command). The agent's report is a CLAIM; Relay's
 * inspection + test run are the EVIDENCE and always win.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { RELAY_PROTOCOL_VERSION } from '../src/relay/protocol/version';
import type {
  AgentHandoffPackage,
  CompletionPolicy,
  EvidenceRecord,
  RelayTask,
} from '../src/relay/protocol/contracts';
import type {
  AuditId,
  ContextVersion,
  IdFactory,
  LedgerVersion,
  PackageId,
  PolicyId,
  ProjectId,
  RunId,
  TaskId,
} from '../src/relay/protocol/ids';
import {
  createWorkspaceService,
  DEFAULT_WORKSPACE_COMMAND_POLICY,
  type WorkspaceCommandPolicy,
  type WorkspacePolicyInput,
} from '../src/relay/workspace';
import { evaluateCompletionPolicy } from '../src/relay/verification/completion';
import {
  CLAUDE_ADAPTER_ID,
  claudePromptFor,
  claudeToolPolicyFor,
} from '../src/relay/connectors/claude-code/adapter';
import {
  DEFAULT_LIVE_LIMITS,
  type ClaudeCodeCapabilityProfile,
  type ClaudeLiveLimits,
} from '../src/relay/connectors/claude-code/contracts';
import { buildSafeEditFixture, RELAY_TEST_ARGS, TEST_FILE } from '../src/relay/connectors/claude-code/fixture';
import { compileRevisionPrompt } from '../src/relay/connectors/claude-code/prompt-compiler';
import { runGit } from '../src/relay/workspace/repository-inspector';
import { buildAttestation, digest, type ExecutionAttestation } from './attestation';
import {
  createLocalClaudeInvoker, type AgentInvoker, type CancelHandle,
} from './agent-invoker';
import { createTerminalCapture, type TerminalCapture } from './coding-terminal';
import { redactPayload, safeText } from './redact';
import type { BridgeEventInput, RelayMissionState } from './types';
import type { CodingTerminalState } from '../src/relay/mission/wire-contracts';

export interface CodingHandoff {
  objective: string;
  instructions: string[];
  acceptanceCriteria: string[];
  constraints: string[];
}

/** Canonical digest of a coding handoff. The mission digests the handoff it
    PERSISTED with the same function the coding leg uses on the handoff it was
    DELIVERED — equality is the proof that they are the same object. */
export function codingHandoffDigest(h: CodingHandoff): string {
  return digest(
    JSON.stringify({
      objective: h.objective,
      instructions: h.instructions,
      acceptanceCriteria: h.acceptanceCriteria,
      constraints: h.constraints,
    }),
  );
}

export interface CodingClaim {
  summary: string;
  filesChanged: string[];
  checksRun: string[];
}

/**
 * The deterministic, Relay-produced evidence for this coding leg. Everything
 * here was read or executed by Relay AFTER the agent exited — none of it comes
 * from the agent's report. It is also the exact artifact the independent
 * reviewer is given, bound by `artifactDigest`.
 */
export interface DeterministicEvidence {
  baseRevision: string;
  allowedFiles: string[];
  prohibitedFiles: string[];
  changedFiles: string[];
  protectedChanges: string[];
  sourceUnchanged: boolean;
  inspectionAssessment: string;
  testCommand: string;
  testPassed: boolean;
  testExitCode: number | null;
  testOutput: string;
  unifiedDiff: string;
  /** Resulting content of the changed files, bounded. */
  changedFileContents: string;
  /** The claimed file's exact bytes after the run, for a bounded repair pass. */
  claimedFileContent: string | null;
  /** Digest over (changed files + diff + resulting content). The reviewer's
      verdict is bound to this exact value. */
  artifactDigest: string;
  relayEvidence: string[];
}

export interface CodingOutcome {
  /** Verified by Relay AND the coding-leg completion policy satisfied. When
      the policy requires an independent review this is FALSE until the
      reviewer has run — the coding leg alone can never complete a mission. */
  verifiedComplete: boolean;
  verificationPassed: boolean;
  /** Relay's own deterministic result: scope preserved AND tests passed. This
      is what gates the reviewer, and it is never the agent's claim. */
  deterministicPassed: boolean;
  inspectionAssessment: string;
  filesChanged: string[]; // REAL — from Relay inspection, not the claim
  protectedChanges: string[];
  sourceUnchanged: boolean;
  completionOutcome: string;
  cancelled: boolean;
  stopped: boolean;
  stopReason: string | null;
  /** The agent's CLAIM (from its report) — pending, never trusted as truth. */
  claim: CodingClaim | null;
  /** Present once the agent process has been observed (launched or failed). */
  attestation: ExecutionAttestation | null;
  /** Present once Relay has inspected + verified the resulting workspace. */
  evidence: DeterministicEvidence | null;
  /** Digest of the handoff package actually compiled for this invocation —
      proof that the persisted handoff is the delivered handoff. */
  deliveredHandoffDigest: string | null;
}

/** Cancellation handle exposed to the mission so a browser Stop can abort a
    live Claude process (SIGTERM → SIGKILL). Declared with the invoker seam and
    re-exported here so existing importers are unaffected. */
export type { CancelHandle } from './agent-invoker';

/**
 * The coding leg's completion policy.
 *
 * The three-role live mission passes `requiresIndependentReview: true`, so
 * this evaluation can never report `satisfied` on the strength of passing
 * tests alone — the reviewer verdict is supplied to the mission-level
 * completion authority (`decideCompletion`), which is the single authority
 * for `verified_complete`.
 */
function buildCompletionPolicy(requiresIndependentReview: boolean): CompletionPolicy {
  return {
    policyId: (requiresIndependentReview ? 'pol_bridge-live-reviewed' : 'pol_bridge-live-lowrisk') as PolicyId,
    riskLevel: requiresIndependentReview ? 'high' : 'low',
    requiredEvidence: [{ evidenceType: 'command', command: `node ${RELAY_TEST_ARGS.join(' ')}`, mustPass: true }],
    requiresIndependentReview,
    requiresHumanApproval: false,
    enforcementRequirements: [],
    acceptedProvenance: ['live'],
  };
}

const MAX_ARTIFACT_FILE_BYTES = 64 * 1024;

/** Read the resulting content of the files Relay itself observed as changed.
    Paths come from Relay's inspection (never the agent) and are re-checked to
    stay inside the isolated workspace before anything is read. */
function readChangedFileContents(workspacePath: string, files: readonly string[]): string {
  const blocks: string[] = [];
  for (const file of files.slice(0, 8)) {
    const target = normalize(join(workspacePath, file));
    if (!target.startsWith(workspacePath + sep)) continue;
    try {
      const raw = readFileSync(target, 'utf8');
      blocks.push(`----- ${file} -----\n${raw.slice(0, MAX_ARTIFACT_FILE_BYTES)}`);
    } catch {
      /* a file Relay saw as changed but cannot read is simply not included */
    }
  }
  return blocks.join('\n\n');
}

function buildHandoff(input: {
  ids: IdFactory;
  now: string;
  projectId: ProjectId;
  runId: RunId;
  taskId: TaskId;
  baseRevision: string;
  claimedFile: string;
  protectedPaths: { forbidden: string[]; readOnly: string[] };
  handoff: CodingHandoff;
}): AgentHandoffPackage {
  // The architect's objective + plan are folded into pkg.objective, which the
  // prompt compiler renders verbatim — so the Coding Agent literally receives
  // the Sunday Alcatraz handoff. The rest is Relay's fixed safety envelope.
  const plan =
    input.handoff.instructions.length > 0
      ? `\n\nImplementation plan from Sunday Alcatraz (Prompt Architect):\n${input.handoff.instructions
          .map((s, i) => `${i + 1}. ${s}`)
          .join('\n')}`
      : '';
  return {
    packageId: input.ids.next('pkg') as PackageId,
    protocolVersion: RELAY_PROTOCOL_VERSION,
    projectId: input.projectId,
    runId: input.runId,
    taskId: input.taskId,
    targetAdapterId: CLAUDE_ADAPTER_ID,
    role: 'coding-agent',
    objective: `${input.handoff.objective}${plan}`,
    responsibilityBoundary: `Edit only ${input.claimedFile} to satisfy the acceptance criteria. Change nothing else.`,
    contextRefs: [`baseRevision:${input.baseRevision}`],
    requiredInputs: [input.claimedFile, TEST_FILE],
    permittedTools: [
      { value: 'Read', enforcement: 'advisory' },
      { value: 'Glob', enforcement: 'advisory' },
      { value: 'Grep', enforcement: 'advisory' },
      { value: 'Edit', enforcement: 'advisory' },
    ],
    permittedFiles: [{ value: input.claimedFile, enforcement: 'advisory' }],
    prohibitedActions: [
      ...input.protectedPaths.forbidden.map((p) => ({ value: `protected:${p}`, enforcement: 'enforced' as const })),
      { value: 'protected:.git', enforcement: 'enforced' as const },
      { value: 'bash', enforcement: 'enforced' as const },
      { value: 'network-egress', enforcement: 'enforced' as const },
      { value: 'git-push', enforcement: 'enforced' as const },
      { value: 'deploy', enforcement: 'enforced' as const },
    ],
    dependencies: [],
    acceptanceCriteria:
      input.handoff.acceptanceCriteria.length > 0
        ? input.handoff.acceptanceCriteria
        : ['The existing test suite passes when Relay runs it.', 'Only the claimed file changed.'],
    requiredEvidence: [`node ${RELAY_TEST_ARGS.join(' ')}`],
    budget: { maxRuntimeMs: DEFAULT_LIVE_LIMITS.maxRuntimeMs },
    stoppingCondition: { description: 'Stop as soon as the tests would pass; do not broaden the change.' },
    expectedReportType: 'implementation',
    contextVersion: 0 as ContextVersion,
    ledgerVersion: 0 as LedgerVersion,
    baseRevision: input.baseRevision,
    createdAt: input.now,
    idempotencyKey: `bridge-live-${input.taskId}` as AgentHandoffPackage['idempotencyKey'],
  };
}

export async function runCodingMission(input: {
  handoff: CodingHandoff;
  /**
   * A SECOND PASS OVER WORK A REVIEWER REJECTED.
   *
   * Absent means a first attempt, which is every existing caller. Present
   * means the Reviewer returned blocking findings and Relay is giving the
   * Coding Agent one bounded chance to address them.
   *
   * `priorContents` is the reviewed result, written into the fresh workspace
   * before the agent runs. The workspace is disposable and rebuilt per call,
   * so without this the agent would repair a file it had never written. Using
   * the CONTENT Relay recorded — rather than replaying a diff — means the
   * agent resumes from exactly the bytes the Reviewer read and the artifact
   * digest describes.
   */
  revision?: {
    readonly findingSummaries: readonly string[];
    readonly priorContents: Readonly<Record<string, string>>;
  };
  executablePath: string;
  capabilities: ClaudeCodeCapabilityProfile;
  now: () => string;
  ids: IdFactory;
  baseEnv?: Record<string, string | undefined>;
  limits?: ClaudeLiveLimits;
  /** Emit a normalized progress event (mission assigns sequence + at). */
  emit: (e: BridgeEventInput) => void;
  /** Report a coding-internal state transition so the mission phase advances. */
  onState?: (s: RelayMissionState) => void;
  /** Receives the cancel handle as soon as the process starts. */
  registerHandle?: (h: CancelHandle) => void;
  /** True if a cancellation was requested before/while running. */
  isCancelRequested?: () => boolean;
  /** Receives every Coding Agent terminal snapshot as it changes. The mission
      stores the latest and the browser polls for it. */
  publishTerminal?: (t: CodingTerminalState) => void;
  /** Display label for the controlled project the agent may touch. */
  projectLabel?: string;
  /** The live three-role mission passes TRUE — the coding leg then cannot
      self-complete and the reviewer becomes mandatory. Defaults to the
      previous low-risk behaviour so existing offline flows are unchanged. */
  requiresIndependentReview?: boolean;
  /** Mission identity carried into the execution attestation. */
  missionId?: string;
  missionRevision?: string;
  /**
   * The occupant the mission BOUND to this role.
   *
   * The requested half of the attestation is derived from it. It used to be a
   * literal `'Claude Code'` / `'claude-code-local'` / `'subscription'` written
   * three lines apart, which was merely redundant while one runtime could ever
   * hold the slot and became a misreport the moment a second one could — a
   * hosted Agent-SDK run is API-billed, and an attestation saying
   * `subscription` names the wrong payer.
   *
   * The ACTUAL half is never taken from here. It stays what this function
   * observed: the adapter it really drove.
   */
  /**
   * WHICH SURFACE RUNS THE AGENT — the one step of this leg that depends on it.
   *
   * Absent means the local installed CLI, which is what every caller before
   * the seam existed was doing. Everything else here — fixture, worktree,
   * handoff, prompt, inspection, `node --test`, completion policy — is
   * surface-independent and must never be duplicated for a second surface.
   */
  invokeAgent?: AgentInvoker;
  /** How the terminal names the runtime this mission asked for. */
  runtimeLabel?: string;
  requestedOccupant?: {
    /** The name the RUNTIME calls itself — `actorMatches` compares this with
     *  what the adapter reports, so both halves need one vocabulary. Building
     *  it from the UI label made the comparison answer false on the happy
     *  path, hiding a genuine swap among the normal ones. */
    readonly actorName: string;
    readonly adapterId: string;
    /**
     * The REGISTRY's vocabulary, translated below.
     *
     * Two vocabularies exist and neither is wrong: the registry says how an
     * occupant is paid for (`api`), the attestation says what a run consumed
     * (`api_billed`, which `isPaidApiCall` tests for exactly).
     *
     * `none` is the offline fake pipeline and becomes `simulated`, NOT
     * `subscription`. An earlier version narrowed this to two values and
     * claimed the other two would be "a type error rather than a billing path
     * invented at run time"; nothing enforced that, and the single call site
     * mapped everything-not-`api` to `subscription` — attesting a run that
     * spent nothing as subscription-paid.
     *
     * `unknown` maps to the attestation's own `unknown`, NEVER to a value that
     * asserts something. An earlier version mapped it to `none`, which becomes
     * `simulated` — a positive claim that a run spent nothing, made about a
     * cost nobody knows. "Unknown is not zero" is one of this product's
     * load-bearing rules; trading an honest dead branch for a dishonest live
     * one is not dead-code removal.
     */
    readonly billingPath: 'subscription' | 'api' | 'none' | 'unknown';
  };
}): Promise<CodingOutcome> {
  const { executablePath, capabilities, now, ids, emit } = input;
  const limits = input.limits ?? DEFAULT_LIVE_LIMITS;
  const requiresIndependentReview = input.requiresIndependentReview ?? false;

  const outcome: CodingOutcome = {
    verifiedComplete: false,
    verificationPassed: false,
    deterministicPassed: false,
    inspectionAssessment: 'unsupported_inspection',
    filesChanged: [],
    protectedChanges: [],
    sourceUnchanged: true,
    completionOutcome: 'unsatisfied',
    cancelled: false,
    stopped: false,
    stopReason: null,
    claim: null,
    attestation: null,
    evidence: null,
    deliveredHandoffDigest: null,
  };

  const fixture = buildSafeEditFixture();
  const projectId = ids.next('prj') as ProjectId;
  const runId = ids.next('run') as RunId;
  const taskId = ids.next('tsk') as TaskId;
  const cleanup = () => {
    try {
      rmSync(fixture.fixtureRoot, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  // The terminal capture is created as soon as the permission envelope is
  // known; until then there is nothing truthful to show.
  let terminal: TerminalCapture | null = null;

  const stop = (reason: string): CodingOutcome => {
    outcome.stopped = true;
    outcome.stopReason = safeText(reason);
    if (terminal) {
      terminal.note({
        kind: 'notice',
        truth: 'system_notice',
        text: `Relay stopped this run: ${outcome.stopReason}`,
      });
      terminal.markEnded();
      terminal.setStatus(outcome.cancelled ? 'cancelled' : 'failed');
    }
    return outcome;
  };

  const verifyPolicy: WorkspaceCommandPolicy = {
    ...DEFAULT_WORKSPACE_COMMAND_POLICY,
    rules: [
      { executable: 'node', description: 'fixture test runner', allowedFirstArgs: ['--version', '--test'] },
      { executable: 'git', description: 'read-only inspection' },
    ],
  };
  const workspace = createWorkspaceService({ ids, now, commandPolicy: verifyPolicy });

  try {
    if (input.isCancelRequested?.()) {
      outcome.cancelled = true;
      return stop('Mission cancelled before the coding agent started.');
    }

    const prepared = workspace.prepareWorkspace({
      projectId,
      runId,
      taskId,
      sourceRepositoryPath: fixture.sourceRepo,
      cleanupPolicy: 'remove_on_success',
    });
    if (!prepared.ok) return stop(`Workspace preparation failed: ${prepared.error.message}`);
    const ws = prepared.value.value.workspace;

    const pkg = buildHandoff({
      ids,
      now: now(),
      projectId,
      runId,
      taskId,
      baseRevision: fixture.baselineRevision,
      claimedFile: fixture.claimedFile,
      protectedPaths: fixture.protectedPaths,
      handoff: input.handoff,
    });
    const toolPolicy = claudeToolPolicyFor(pkg, capabilities);

    /**
     * A REPAIR RESUMES FROM THE REVIEWED BYTES, not from the stub.
     *
     * Only files the first attempt was allowed to claim are restored — a
     * repair that could seed an unclaimed path would widen scope through the
     * back door, which is the thing `repairExpandsFileClaims` exists to
     * refuse one layer up.
     */
    if (input.revision !== undefined) {
      for (const [relative, content] of Object.entries(input.revision.priorContents)) {
        if (relative !== fixture.claimedFile) continue;
        const target = normalize(join(ws.workspacePath, relative));
        if (!target.startsWith(ws.workspacePath + sep)) continue;
        writeFileSync(target, content, 'utf8');
      }
    }

    const prompt = input.revision === undefined
      ? claudePromptFor({
        pkg,
        runId,
        taskId,
        workspaceRelativeRoot: '.',
        readOnlyFiles: fixture.protectedPaths.readOnly,
        protectedFiles: [...fixture.protectedPaths.forbidden, '.git'],
        relayVerificationCommands: [`node ${RELAY_TEST_ARGS.join(' ')}`],
        limits,
      })
      : compileRevisionPrompt({
        runId,
        taskId,
        findingSummaries: [...input.revision.findingSummaries],
        relayVerificationCommands: [`node ${RELAY_TEST_ARGS.join(' ')}`],
      });

    // Delivery proof: the handoff Relay was given is the handoff compiled into
    // the prompt this one invocation receives. A prompt that does not carry the
    // architect's objective is a wiring defect, not something to paper over.
    outcome.deliveredHandoffDigest = codingHandoffDigest(input.handoff);

    /**
     * DELIVERY PROOF, AGAINST WHAT EACH PROMPT IS SUPPOSED TO CARRY.
     *
     * A first attempt must carry the architect's objective; a prompt that does
     * not is a wiring defect rather than something to paper over.
     *
     * A REPAIR PROMPT MUST NOT. `compileRevisionPrompt` is deliberately narrow
     * — "do not restart or broaden the task", findings only — so it never
     * restates the objective. Applying the first-attempt check to it stopped
     * every repair in production with "The compiled prompt did not carry the
     * Prompt Architect handoff", which was true and was not a defect: the
     * check was asking the wrong question of the right prompt.
     *
     * The equivalent proof for a repair is that it carries the findings it
     * exists to address. A repair prompt missing them would send the agent
     * back to work with nothing to fix.
     */
    if (input.revision === undefined) {
      if (input.handoff.objective.trim() && !prompt.includes(input.handoff.objective.trim())) {
        return stop('The compiled prompt did not carry the Prompt Architect handoff.');
      }
    } else {
      const undelivered = input.revision.findingSummaries.filter((f) => !prompt.includes(f));
      if (undelivered.length > 0) {
        return stop('The repair prompt did not carry the reviewer findings it must address.');
      }
    }

    emit({
      role: 'coding_agent',
      category: 'coding_agent',
      truth: 'system_notice',
      // The occupant the mission BOUND — the stream narrated "Claude Code"
      // regardless of which surface was about to run, which is the defect the
      // role registry exists to make impossible.
      headline: `${safeText(input.runtimeLabel ?? 'Claude Code')} session started.`,
      detail: 'Working in an isolated throwaway workspace. Source repository protected.',
    });

    // Terminal capture — the permission envelope below is the one actually
    // compiled for this invocation, not a description of it.
    terminal = createTerminalCapture({
      executionId: String(runId).slice(-8),
      projectLabel: input.projectLabel ?? 'Relay controlled fixture (throwaway repository)',
      // The terminal is built BEFORE the agent runs, so this names the runtime
      // the mission REQUESTED. What actually answered is observed afterwards
      // and carried by the attestation, which is where the two can differ.
      runtime: input.runtimeLabel ?? 'Claude Code (local CLI)',
      permissions: {
        allowedTools: toolPolicy.allowedTools.length ? toolPolicy.allowedTools : toolPolicy.availableTools,
        allowedFiles: [fixture.claimedFile],
        protectedPaths: [...fixture.protectedPaths.forbidden, ...fixture.protectedPaths.readOnly, '.git'],
        deniedCapabilities: ['Bash', 'network egress', 'git push', 'deploy'],
      },
      now,
      publish: (t) => input.publishTerminal?.(t),
    });
    terminal.note({
      kind: 'session',
      truth: 'system_notice',
      text: `${safeText(input.runtimeLabel ?? 'Claude Code')} session started in an isolated `
        + 'throwaway workspace. Source repository protected.',
    });
    terminal.markStarted();
    terminal.setStatus('live');

    const invokeAgent = input.invokeAgent ?? createLocalClaudeInvoker({ executablePath, capabilities });
    const invocation = await invokeAgent({
      association: { projectId, runId, taskId, workspaceId: ws.workspaceId, adapterId: CLAUDE_ADAPTER_ID },
      pkg,
      workspacePath: ws.workspacePath,
      toolPolicy,
      prompt,
      limits,
      baseEnv: input.baseEnv,
      registerHandle: (h) => input.registerHandle?.(h),
      now,
      ids,
      requestedModel: null,
    });

    // The connector's own normalized lifecycle events are the terminal body:
    // real session records, real observed tool activity with real targets,
    // and the real process outcome. Hidden reasoning was already dropped by
    // the stream parser and is never reconstructed here.
    terminal.setExternalSession(invocation.sessionId);
    terminal.ingestConnectorEvents([...invocation.events]);
    terminal.markEnded(invocation.outcome.completedAt);

    /**
     * One attestation for the one process that actually ran.
     *
     * REQUESTED comes from the bound occupant; ACTUAL is what this function
     * drove, which is the Claude Code adapter — a constant here because this
     * function invokes exactly one adapter, and naming it from the request
     * would be the identity literal in a new costume. When the two differ the
     * attestation shows it, which is the entire purpose of two fields.
     *
     * Absent binding falls back to the local identity: every caller before
     * role slots existed drove this same adapter, so that is what they were
     * requesting, and it keeps `runCodingMission` usable from the offline
     * harnesses unchanged.
     */
    const requestedOccupant = input.requestedOccupant ?? {
      actorName: 'Claude Code',
      adapterId: CLAUDE_ADAPTER_ID,
      billingPath: 'subscription' as const,
    };
    // Computed once and used by both the attestation and the terminal, which
    // previously carried two independent literals that happened to agree.
    const codingBillingPath = requestedOccupant.billingPath === 'api'
      ? 'api_billed' as const
      : requestedOccupant.billingPath === 'none'
        ? 'simulated' as const
        : requestedOccupant.billingPath === 'subscription'
          ? 'subscription' as const
          : 'unknown' as const;
    const codingAttestation = buildAttestation({
      missionId: input.missionId ?? String(taskId),
      missionRevision: input.missionRevision,
      role: 'coding_agent',
      requestedActor: requestedOccupant.actorName,
      // OBSERVED, from the surface that ran — not the constant this file used
      // to write, which was correct only while one surface could ever run.
      actualActor: invocation.actualActor,
      requestedRuntime: requestedOccupant.adapterId,
      actualRuntime: invocation.actualRuntimeId,
      // `api` in the registry is `api_billed` here, which is the value
      // `isPaidApiCall` tests for. Translated, never aliased.
      billingPath: codingBillingPath,
      // The model that ANSWERED, when the surface reported one. Absent stays
      // absent — a requested model is not evidence that it ran.
      ...(invocation.actualModel === null ? {} : { model: invocation.actualModel }),
      // OBSERVED, not inferred from the absence of an error. A run cancelled
      // or timed out during startup has no error and never launched — it was
      // attested as launched, and the website then rendered it API PAID.
      launchVerified: invocation.outcome.launchObserved && !invocation.outcome.launchFailed,
      completionVerified:
        !invocation.outcome.launchFailed &&
        !invocation.outcome.timedOut &&
        !invocation.outcome.cancelled &&
        invocation.structurallyValid &&
        invocation.report.ok,
      fallbackOccurred: false,
      inputDigest: digest(prompt),
      startedAt: invocation.outcome.startedAt,
      completedAt: invocation.outcome.completedAt,
    });
    outcome.attestation = codingAttestation;
    terminal.setAttestation({
      attestationId: codingAttestation.attestationId,
      // Observed, so the website can name the agent that did the work.
      actualActor: codingAttestation.actualActor,
      actualRuntime: codingAttestation.actualRuntime,
      launchVerified: codingAttestation.launchVerified,
      completionVerified: codingAttestation.completionVerified,
      fallbackOccurred: codingAttestation.fallbackOccurred,
      // The same computed value the attestation carries, not a second literal
      // beside it. These two were independent strings that happened to agree.
      billingPath: codingBillingPath,
    });

    if (invocation.outcome.cancelled) {
      outcome.cancelled = true;
      return stop('The coding agent was cancelled.');
    }
    if (invocation.outcome.timedOut) return stop('The coding agent timed out.');
    if (invocation.outcome.launchFailed) {
      // The surface's own sentence when it has one — "could not start" alone
      // gave an operator nothing to act on for a permanently missing runtime.
      const why = invocation.structuralReason?.trim();
      return stop(why === undefined || why === ''
        ? 'The coding agent could not start.'
        : `The coding agent could not start: ${why.replace(/\.$/, '')}.`);
    }
    if (!invocation.structurallyValid) {
      // The reason is the surface's own sentence, which already says what
      // happened — an unusable stream, an envelope the runtime did not honour,
      // a spend ceiling. Prefixing it with "output was not usable" asserted a
      // cause for all three. A trailing full stop is not doubled.
      const reason = (invocation.structuralReason ?? 'the reason was not reported').trim();
      return stop(`The coding agent run could not be trusted: ${reason.replace(/\.$/, '')}.`);
    }
    if (!invocation.report.ok) {
      return stop(`The coding agent report could not be trusted: ${invocation.report.error.message}`);
    }

    // The agent's CLAIM (never trusted over inspection).
    const report = invocation.report.value;
    const claimChecks: string[] = [];
    if (Array.isArray(report.testsClaimed) && report.testsClaimed.length) {
      claimChecks.push(`Reported ${report.testsClaimed.length} test check(s)`);
    }
    if (Array.isArray(report.commandsClaimed) && report.commandsClaimed.length) {
      claimChecks.push(`Reported ${report.commandsClaimed.length} command(s)`);
    }
    if (!claimChecks.length) claimChecks.push('Reported completing the task');
    outcome.claim = {
      summary: safeText(report.summary || 'Coding agent reported completion.'),
      filesChanged: (report.filesChanged ?? []).map((f) => safeText(f)),
      checksRun: claimChecks,
    };
    emit({
      role: 'coding_agent',
      category: 'coding_agent',
      truth: 'agent_claim',
      headline: 'Work submitted — pending Relay verification.',
      detail: outcome.claim.summary,
      meta: outcome.claim.filesChanged[0] ? `CLAIM ${outcome.claim.filesChanged[0]}` : undefined,
      done: true,
    });
    terminal.setClaim(outcome.claim);
    terminal.note({
      kind: 'claim',
      truth: 'agent_claim',
      text: `Claim submitted — ${outcome.claim.summary}`,
      target: outcome.claim.filesChanged[0],
    });
    input.onState?.('claim_submitted');

    // Relay independently inspects — the report cannot override this.
    const policyInput: WorkspacePolicyInput = {
      protectedPaths: fixture.protectedPaths,
      claimedWritePaths: [fixture.claimedFile],
    };
    const inspection = workspace.inspectWorkspace(ws.workspaceId, policyInput);
    if (!inspection.ok) return stop(`Workspace inspection failed: ${inspection.error.message}`);
    const insp = inspection.value.value;
    outcome.inspectionAssessment = insp.assessment;
    outcome.filesChanged = insp.claimedChanges.map((f) => safeText(f));
    outcome.protectedChanges = insp.protectedChanges.map((f) => safeText(f));

    terminal.setChangedFiles(outcome.filesChanged);

    if (insp.assessment !== 'allowed') {
      terminal.note({
        kind: 'inspection',
        truth: 'relay_evidence',
        text:
          insp.assessment === 'clean'
            ? 'Relay inspection: no file changed — nothing to verify.'
            : `Relay inspection: unauthorized change detected (${insp.assessment}).`,
      });
      emit({
        role: 'relay',
        category: 'workspace_inspection',
        truth: 'relay_evidence',
        headline:
          insp.assessment === 'clean'
            ? 'Relay inspection: no file changed — nothing to verify.'
            : `Relay inspection: unauthorized change detected (${safeText(insp.assessment)}).`,
      });
      return stop(`Workspace inspection rejected the change (${insp.assessment}).`);
    }
    emit({
      role: 'relay',
      category: 'workspace_inspection',
      truth: 'relay_evidence',
      headline: 'Claimed files match changed files. No protected files touched.',
      detail: `${insp.claimedChanges.length} claimed file changed · source worktree unchanged.`,
    });
    terminal.note({
      kind: 'inspection',
      truth: 'relay_evidence',
      text: `Relay inspection: claimed files match changed files (${insp.claimedChanges.length}); no protected file touched.`,
      target: outcome.filesChanged[0],
    });

    // The REAL resulting diff, read by Relay from the isolated worktree after
    // the agent exited. Read-only git, bounded and sanitized before display.
    const diffResult = runGit(['diff', '--unified=3'], ws.workspacePath);
    terminal.setDiff(diffResult.ok ? diffResult.value : null);

    input.onState?.('relay_verifying');

    // Relay — not Claude — runs the deterministic verification.
    const verify = await workspace.executeCommand({
      commandId: `bridge-live-verify-${taskId}`,
      projectId,
      runId,
      taskId,
      workspaceId: ws.workspaceId,
      executable: 'node',
      args: RELAY_TEST_ARGS,
      expectedPurpose: 'fixture test verification',
      timeoutMs: 60_000,
    });
    if (!verify.ok) return stop(`Verification could not run: ${verify.error.message}`);
    const verifyResult = verify.value.value;
    outcome.verificationPassed = verifyResult.status === 'completed';

    const verifyCommand = `node ${RELAY_TEST_ARGS.join(' ')}`;
    terminal.note({
      kind: 'command',
      truth: 'relay_evidence',
      text: `Relay ran the required verification: ${verifyCommand}`,
    });
    terminal.setTest({
      command: verifyCommand,
      status: outcome.verificationPassed ? 'passed' : 'failed',
      exitCode: verifyResult.exitCode,
      // Already bounded + secret-sanitized by the workspace runner; the
      // terminal sanitizer bounds and scrubs it again before display.
      output: [verifyResult.stdout, verifyResult.stderr].filter((s) => s.trim().length > 0).join('\n'),
    });

    const sourceCheck = workspace.verifySourceUnchanged(ws.workspaceId);
    outcome.sourceUnchanged = sourceCheck.ok ? !sourceCheck.value.value.changed : false;

    // ---- The reviewed artifact. Captured by Relay from the isolated
    // workspace after the agent exited, BEFORE the workspace is cleaned up,
    /**
     * THE REVIEWER READS THESE. THEY ARE NOT DISPLAY STRINGS.
     *
     * Both were `safeText`, which truncates at 600 characters — so Hermes has
     * been reviewing a 600-character fragment of the diff and a 600-character
     * fragment of the resulting file, then being asked whether the
     * implementation satisfies the objective. It answered well anyway on a
     * fixture small enough to fit; on anything larger it would have been
     * judging a stump.
     *
     * This is the third place a display sanitizer reached a machine-read
     * payload, after the hosted execution report and the Reviewer's own
     * verdict. `redactPayload` keeps the part that is about safety — no
     * provider secret, no absolute host path — and drops the screen-space
     * bound. The real ceiling is `MAX_ARTIFACT_FILE_BYTES`, applied per file
     * where the content is read.
     */
    const unifiedDiff = diffResult.ok ? redactPayload(diffResult.value) : '';
    const changedFileContents = redactPayload(readChangedFileContents(ws.workspacePath, outcome.filesChanged));

    /**
     * THE CLAIMED FILE'S EXACT BYTES, for a repair that must resume from what
     * the Reviewer read rather than from the stub. Kept separate from
     * `changedFileContents` because that one is a formatted, multi-file digest
     * meant for a reader, and parsing it back would be guessing.
     */
    const claimedFileContent = ((): string | null => {
      const target = normalize(join(ws.workspacePath, fixture.claimedFile));
      if (!target.startsWith(ws.workspacePath + sep)) return null;
      try {
        return readFileSync(target, 'utf8').slice(0, MAX_ARTIFACT_FILE_BYTES);
      } catch {
        return null;
      }
    })();
    const testOutput = safeText(
      [verifyResult.stdout, verifyResult.stderr].filter((s) => s.trim().length > 0).join('\n'),
    );
    const relayEvidence = [
      `Relay inspection assessment: ${insp.assessment}`,
      `Changed files (Relay-observed): ${outcome.filesChanged.join(', ') || '(none)'}`,
      `Protected files changed: ${outcome.protectedChanges.join(', ') || '(none)'}`,
      `Source worktree unchanged: ${outcome.sourceUnchanged ? 'yes' : 'NO'}`,
      `Relay ran ${verifyCommand} → exit ${verifyResult.exitCode ?? 'unknown'} (${
        outcome.verificationPassed ? 'passed' : 'failed'
      })`,
    ];
    outcome.deterministicPassed =
      outcome.verificationPassed && insp.assessment === 'allowed' && outcome.protectedChanges.length === 0 && outcome.sourceUnchanged;
    outcome.evidence = {
      baseRevision: fixture.baselineRevision,
      allowedFiles: [fixture.claimedFile],
      prohibitedFiles: [...fixture.protectedPaths.forbidden, ...fixture.protectedPaths.readOnly, '.git'],
      changedFiles: [...outcome.filesChanged],
      protectedChanges: [...outcome.protectedChanges],
      sourceUnchanged: outcome.sourceUnchanged,
      inspectionAssessment: insp.assessment,
      testCommand: verifyCommand,
      testPassed: outcome.verificationPassed,
      testExitCode: verifyResult.exitCode,
      testOutput,
      unifiedDiff,
      changedFileContents,
      claimedFileContent,
      artifactDigest: digest(
        JSON.stringify({
          baseRevision: fixture.baselineRevision,
          changedFiles: outcome.filesChanged,
          unifiedDiff,
          changedFileContents,
        }),
      ),
      relayEvidence,
    };

    const evidence: EvidenceRecord[] = [...workspace.collectEvidence()];

    const task: RelayTask = {
      taskId,
      projectId,
      runId,
      objective: pkg.objective,
      category: 'implementation',
      status: 'working',
      ownerAssignmentId: null,
      dependencies: [],
      claimedFiles: [fixture.claimedFile],
      claimedResources: [],
      acceptanceCriteria: pkg.acceptanceCriteria,
      completionPolicyId: buildCompletionPolicy(requiresIndependentReview).policyId,
      contextVersion: 0 as ContextVersion,
      baseRevision: fixture.baselineRevision,
      createdAt: now(),
      updatedAt: now(),
      priority: 1,
    };
    const completion = evaluateCompletionPolicy({
      policy: buildCompletionPolicy(requiresIndependentReview),
      task,
      evidence,
      currentRepositoryRevision: fixture.baselineRevision,
      currentTime: now(),
      enforcementCapabilities: { 'worktree-isolation': 'enforced' },
    });
    outcome.completionOutcome = completion.outcome;
    outcome.verifiedComplete = completion.outcome === 'satisfied' && outcome.verificationPassed;

    emit({
      role: 'relay',
      category: 'verification',
      truth: 'relay_evidence',
      headline: outcome.verificationPassed
        ? 'Required tests passed under Relay verification.'
        : 'Relay verification did not pass.',
      detail: `Tests ${outcome.verificationPassed ? 'passed' : 'failed'} · file-claim policy ${
        insp.assessment === 'allowed' ? 'passed' : 'failed'
      } · protected-path policy ${outcome.protectedChanges.length === 0 ? 'passed' : 'failed'} · source-worktree ${
        outcome.sourceUnchanged ? 'protected' : 'MODIFIED'
      }.`,
      done: true,
    });
    terminal.note({
      kind: 'verification',
      truth: 'relay_evidence',
      text: outcome.verificationPassed
        ? 'Required tests passed under Relay verification.'
        : 'Relay verification did not pass.',
    });
    // The TERMINAL reports the Coding Agent's own execution, which is finished
    // and deterministically verified at this point. Mission completion is a
    // separate authority (the reviewer has not run yet) and is never implied
    // here — the terminal never claims the mission is complete.
    terminal.setStatus(outcome.deterministicPassed ? 'complete' : 'failed');

    // Void the audit id so ids stay monotonic in parity with the CLI proof.
    void (ids.next('aud') as AuditId);
    workspace.cleanupWorkspace(ws.workspaceId, { authorizeRemoval: true });
    return outcome;
  } finally {
    cleanup();
  }
}
