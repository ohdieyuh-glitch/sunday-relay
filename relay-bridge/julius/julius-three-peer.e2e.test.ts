/**
 * THREE PEERS, ONE MISSION, ANY CODING AGENT — WITH NO PROVIDER CALL.
 *
 * The founder's claim: the Prompt Architect, the Coding Agent and the
 * Independent Reviewer are Julius ROLES, not providers. Swap the Coding Agent
 * from Claude Code to a Codex-shaped task API or to anything else and nothing
 * about task ownership, guidance, findings, repair, the architecture check or
 * completion may change — and no component may act as another.
 *
 * WHAT IS REAL. `assembleLiveJuliusRuntime`, the one live composition root, with
 * the production worker registrations; and the Coding Agent is the production
 * `createJuliusCodingAgentAdapter` — prompt assembly from the compiled packet,
 * the independent executor's base, change set, diff and test, participation
 * parsing, evidence shaping — with a provider behind its port. The Claude Code
 * provider is its real module with an injected hosted runner. The only fakes
 * sit at genuine boundaries: each provider's transport, the executor's shell,
 * and the architect's and reviewer's adapters.
 *
 * WHAT IS READ. Only the durable record: the ledger's sequence for order, the
 * store's rows for state. Never a callback's timing.
 */

import { describe, expect, it } from 'vitest';

import {
  JULIUS_PARTICIPATION_MARKER,
  buildJuliusSlotMissionReport,
  createJuliusMemoryStore,
  scriptedAdapter,
  seedJuliusTaskContract,
  type JuliusProviderAdapter,
  type JuliusRecoveryDriver,
  type JuliusRuntimeStore,
  type JuliusTimelineEntry,
  type ScriptedOutcome,
} from '../../src/relay/mission/julius';
import {
  JULIUS_CODING_AGENT_CHARTER,
  renderJuliusCodingAgentPrompt,
  type JuliusCodingAgentProvider,
  type JuliusCodingAgentRequest,
} from '../../src/relay/mission/julius/julius-coding-agent';
import { foldJuliusArchitecture } from '../../src/relay/mission/julius/julius-architecture-state';
import { juliusEvidenceAuthority } from '../../src/relay/mission/julius/julius-worker-authority';
import type { HostedRunInput, HostedRunOutcome, HostedQueryFn } from '../hosted-coding-agent/hosted-runner';
import { compileHostedEnvelope } from '../hosted-coding-agent/hosted-envelope';
import { createClaudeCodeCodingAgentProvider } from './claude-code-coding-provider';
import {
  createCodexShapedCodingAgentProvider,
  createFakeExecutorShell,
  createScriptedCodingAgentProvider,
} from './coding-agent-fixtures';
import {
  architectWorker,
  CODER_WORKER,
  assembleLiveJuliusRuntime,
  createContextAndClaimHandoffs,
  driveJuliusRunToTerminal,
  reviewerWorker,
} from './live-composition';
import { createJuliusCodingAgentAdapter, createLiveArtifactExchange, planRef } from './live-workers';

const RUN = 'run-peers3';
const PROJECT = 'prj-peers3';
const MISSION = 'mission-peers3';
const CEILING = 30_000_000;
const REVIEWER_WORKER = reviewerWorker('hermes');
const ARCHITECT_WORKER = architectWorker({});

const PLAN_EVIDENCE = [{ type: 'ARTIFACT', status: 'PASSED', safeSummary: 'Plan written.' }];
const PASSED_REVIEW = [{ type: 'REVIEW_FINDING', status: 'PASSED', safeSummary: 'No blocking findings.' }];
const FINDING_TEXT = 'A blank label renders as the literal word null.';

const ARCHITECTURE = Object.freeze({
  components: [{ name: 'slug', responsibility: 'Turns a mission label into a URL-safe slug.' }],
  boundaries: [{ name: 'slug()', kind: 'INTERFACE', contract: 'slug(label: string | null) returns a string.', locator: 'src/slug.ts' }],
  dependencies: [], decisions: [],
  assumptions: [{ assumptionId: 'A-1', claim: 'Labels are never null upstream.', state: 'UNVERIFIED', evidenceRefs: [] }],
  openQuestions: [], risks: [],
});
const ALIGNED = Object.freeze({ assessment: 'ALIGNED', claim: 'What was built matches the design.', drift: [], driftingTaskIds: [], evidenceRefs: [] });
const GUIDANCE_OBJECTIVE = 'Treat a null label as the empty slug; never render the word null.';
const GUIDANCE = Object.freeze({
  subObjective: GUIDANCE_OBJECTIVE,
  relevantRequirements: ['A blank label yields an empty slug.'], relevantConstraints: ['Touch only src/slug.ts and its test.'],
  repositoryFindings: ['The exporter passes SQL NULL through as null.'], runtimeFindings: [],
  references: [{ kind: 'REPOSITORY', locator: 'src/slug.ts:1', retrievedAt: 'run-peers3' }],
  recommendedActions: ['Map null to the empty string before slugging.'], additionalProhibitions: [],
  affectedCriterionIds: [], unresolvedQuestions: [],
});

/* ------------------------------------------------------------------ the mission */

function seed(store: ReturnType<typeof createJuliusMemoryStore>): void {
  store.seedRun({
    runId: RUN, missionId: MISSION, projectId: PROJECT, state: 'READY',
    cardRevision: 'card-peers3', missionContractRevision: 1, projectBrainRevision: 0, version: 1,
  });
  store.seedTask(RUN, {
    taskId: 'plan-1', missionId: MISSION, parentTaskId: null, dependencyIds: [],
    requiredEvidenceTypes: ['ARTIFACT'], taskType: 'plan', role: 'PROMPT_ARCHITECT', ordinal: 0, state: 'RUNNABLE',
  });
  store.seedTask(RUN, {
    taskId: 'build-1', missionId: MISSION, parentTaskId: null, dependencyIds: ['plan-1'],
    requiredEvidenceTypes: ['TEST'], taskType: 'build', role: 'CODING_AGENT', ordinal: 1, state: 'BLOCKED',
  });
  const seeded = seedJuliusTaskContract({
    runId: RUN, taskId: 'build-1', missionContractRevision: 1,
    objective: 'Normalize a mission label into a slug.',
    requirements: ['A blank label yields an empty slug.'], constraints: ['Touch only the slug module and its test.'],
    acceptanceCriteria: [{ id: 'AC-1', text: 'The slug test passes.', blocking: true }],
    filesInScope: ['src/slug.ts', 'src/slug.test.ts'], filesOutOfScope: [], spendUsd: 30, repairCycles: 3, requiredEvidence: ['TEST'],
  });
  if (!seeded.seeded) throw new Error(`fixture contract not derivable: ${seeded.reasonCode}`);
  void store.putTaskContract({ projectId: PROJECT, contract: seeded.contract, occurredAt: '2026-09-16T00:00:00.000Z' });
  store.seedCriteria(RUN, [{ criterionId: 'AC-1', description: 'The slug test passes.', requiredEvidenceTypes: [] }]);
  store.seedBrain(RUN, [{
    entryId: 'brain-objective', kind: 'OBJECTIVE', text: 'OBJECTIVE: normalize a mission label into a slug.',
    taskIds: [], allowedRoles: ['PROMPT_ARCHITECT', 'CODING_AGENT', 'INDEPENDENT_REVIEWER'], sensitivity: 'INTERNAL',
  }]);
}

const block = (prose: string, body: Record<string, unknown>): string =>
  `${prose}\n${JULIUS_PARTICIPATION_MARKER}\n${JSON.stringify(body)}\n`;
const REPORT = (summary: string) => ({
  outcome: 'IMPLEMENTED', summary, filesTouched: ['src/slug.ts', 'src/slug.test.ts'], testsRun: ['npm test'],
  remainingUncertainty: [], blockedReason: null,
});

/** What the coder writes at the end of each dispatch, in order: ask, implement, repair. */
interface CoderLines { readonly ask: string; readonly implement: string; readonly repair: string }
const HONEST: CoderLines = {
  ask: block('I cannot tell from the workspace what a null label should become.', {
    guidanceRequest: {
      question: 'What should slug() return for a null label?',
      blockedOn: ['the exporter is not in this workspace'], attempted: ['read src/slug.ts'], relevantPaths: ['src/slug.ts'],
    },
    segmentResume: { completedSoFar: ['wrote the failing test'], nextIntent: 'implement the null case' },
  }),
  implement: block('Implemented.', { report: REPORT('slug() handles labels.') }),
  repair: block('Repaired.', { report: REPORT('A blank label now yields an empty slug.') }),
};

type ProviderName = 'claude-code' | 'codex-shaped' | 'generic';
const PROVIDERS: readonly ProviderName[] = ['claude-code', 'codex-shaped', 'generic'];

/** The failures a provider reports, in order, on its repair dispatches — each in its own vocabulary. */
type InjectedFailure = 'RATE_LIMITED' | 'CREDIT_UNAVAILABLE';

/** A provider behind the port, shaped like the named one, answering each dispatch from `lines`. */
function providerFor(
  name: ProviderName, lines: CoderLines, repairFailures: readonly InjectedFailure[] = [],
): JuliusCodingAgentProvider & { readonly requests: JuliusCodingAgentRequest[] } {
  const requests: JuliusCodingAgentRequest[] = [];
  let repairs = 0;
  let failing: InjectedFailure | null = null;
  const textFor = (request: JuliusCodingAgentRequest): string => (request.identity.taskType.startsWith('repair:')
    ? lines.repair
    : request.identity.taskId.startsWith('segment:') ? lines.implement : lines.ask);
  let inner: JuliusCodingAgentProvider;
  if (name === 'claude-code') {
    let current: JuliusCodingAgentRequest | null = null;
    const hosted = async (input: HostedRunInput): Promise<HostedRunOutcome> => (failing !== null ? {
      // What the hosted runtime really says: an API error after the session started.
      kind: 'refused', refusalCode: 'coder_provider_error_after_init', safeMessage: 'The hosted run failed after it started.',
      observation: {
        initSeen: true, sessionId: 'sess', actualModel: 'claude-x', runtimeVersion: 't', apiKeySource: 'env', reportedCwd: input.workspacePath,
        reportedTools: ['Read', 'Edit'], toolTargets: [], toolsUsed: [], toolInvocations: 1, permissionDenials: 0, numTurns: 1, durationMs: 1,
        usage: { inputTokens: 100, outputTokens: 0, totalCostUsd: 0.01, source: 'runtime_reported' },
        streamUsage: { messages: 1, abortedMessages: 1, inputTokens: 100, outputTokens: 0, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        resultSubtype: 'error_during_execution', isError: true, thinkingBlocksOmitted: 0, unknownMessageCount: 0,
        finalText: failing === 'RATE_LIMITED'
          ? 'API Error: 429 {"type":"rate_limit_error"}'
          : 'API Error: 400 {"message":"Your credit balance is too low to access the Anthropic API."}',
      },
      envelope: compileHostedEnvelope({ workspacePath: input.workspacePath }), startedAt: 't', completedAt: 't',
    } : {
      kind: 'completed',
      observation: {
        initSeen: true, sessionId: 'sess', actualModel: 'claude-x', runtimeVersion: 't', apiKeySource: 'env', reportedCwd: input.workspacePath,
        reportedTools: ['Read', 'Edit'], toolTargets: [], toolsUsed: ['Edit'], toolInvocations: 6, permissionDenials: 0, numTurns: 4, durationMs: 1,
        usage: { inputTokens: 900, outputTokens: 300, totalCostUsd: 0.05, source: 'runtime_reported' },
        streamUsage: { messages: 4, abortedMessages: 0, inputTokens: 880, outputTokens: 290, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 },
        resultSubtype: 'success', isError: false, finalText: textFor(current!), thinkingBlocksOmitted: 0, unknownMessageCount: 0,
      },
      envelope: compileHostedEnvelope({ workspacePath: input.workspacePath }), startedAt: 't', completedAt: 't',
    }) as never;
    const claude = createClaudeCodeCodingAgentProvider({
      apiKey: 'FAKETESTNOTREAL', requestedModel: 'claude-x', run: hosted as never,
      queryLoader: async () => (() => (async function* () { /* the hosted runtime is never loaded in this rig */ })()) as HostedQueryFn,
    });
    inner = { providerKind: claude.providerKind, async execute(request, signal) { current = request; return claude.execute(request, signal); } };
  } else if (name === 'codex-shaped') {
    inner = createCodexShapedCodingAgentProvider({
      renderPrompt: (request) => renderJuliusCodingAgentPrompt(request, JULIUS_CODING_AGENT_CHARTER),
      // Codex-shaped: no turn count and no tool count, so both are UNKNOWN — never zero.
      respond: (_prompt, request) => (failing !== null
        ? { status: 'failed', error: { code: failing === 'RATE_LIMITED' ? 'rate_limit_exceeded' : 'insufficient_quota' }, usage: { input_tokens: 100, output_tokens: 0 } }
        : { status: 'completed', output_text: textFor(request), model: 'codex-x', usage: { input_tokens: 900, output_tokens: 300, cost_usd: 0.05 } }),
    });
  } else {
    const generic = createScriptedCodingAgentProvider({ script: [{ kind: 'completed' }] });
    inner = {
      providerKind: generic.providerKind,
      async execute(request) {
        if (failing !== null) {
          return {
            kind: 'failed', failure: failing, runtimeStarted: true, costUsdMicros: null,
            safeMessage: 'The generic coding provider failed.', providerFailureClass: null, diagnostics: {},
          };
        }
        const outcome = await generic.execute(request);
        return outcome.kind === 'completed' ? { ...outcome, finalText: textFor(request) } : outcome;
      },
    };
  }
  return {
    providerKind: inner.providerKind,
    requests,
    async execute(request, signal) {
      requests.push(request);
      failing = null;
      if (request.identity.taskType.startsWith('repair:')) {
        failing = repairFailures[repairs] ?? null;
        repairs += 1;
      }
      return inner.execute(request, signal);
    },
  };
}

/** A scripted adapter that answers by task, so a peer's script cannot drift out of step with the mission. */
function byTask(worker: Parameters<typeof scriptedAdapter>[0], pick: (taskId: string, taskType: string) => Promise<ScriptedOutcome> | ScriptedOutcome) {
  const dispatches: string[] = [];
  const adapter: JuliusProviderAdapter = {
    adapterId: worker.adapterId,
    async dispatch(input) {
      dispatches.push(input.taskId);
      return scriptedAdapter(worker, [await pick(input.taskId, input.taskType ?? '')]).dispatch(input);
    },
  };
  return { adapter, dispatches };
}

interface Hostility {
  /** The architect also hands back a review verdict and test evidence. */
  readonly architect?: boolean;
  /** The reviewer also hands back an implementation and an architecture. */
  readonly reviewer?: boolean;
  /** The coder's lines, when they reach for authority. */
  readonly coder?: CoderLines;
  /** What the Coding Agent's provider reports on its repair dispatches, in order, before it answers. */
  readonly repairFailures?: readonly InjectedFailure[];
}

async function driveMission(providerName: ProviderName, hostility: Hostility = {}) {
  const memory = createJuliusMemoryStore();
  const handoffs = createContextAndClaimHandoffs(memory as unknown as JuliusRuntimeStore & JuliusRecoveryDriver);
  seed(memory);

  const artifacts = createLiveArtifactExchange();
  artifacts.put(planRef(RUN), JSON.stringify({ objective: 'Normalize a mission label.', steps: ['edit src/slug.ts', 'test it'] }));
  const provider = providerFor(providerName, hostility.coder ?? HONEST, hostility.repairFailures ?? []);
  const shell = createFakeExecutorShell({
    status: [' M src/slug.ts', '?? src/slug.test.ts'],
    diff: 'diff --git a/src/slug.ts b/src/slug.ts\n+export const slug = (label: string | null) => (label ?? "").toLowerCase();\n',
    untrackedDiff: 'diff --git a/src/slug.test.ts b/src/slug.test.ts\n+test("blank", () => expect(slug(null)).toBe(""));\n',
  });
  const coder = createJuliusCodingAgentAdapter({
    worker: CODER_WORKER, contexts: handoffs.contexts, artifacts, projectId: PROJECT,
    workspacePath: '/workspace/mission', testCommand: 'npm test', shell, provider,
  });

  const architect = byTask(ARCHITECT_WORKER, (_taskId, taskType) => {
    const reach = hostility.architect === true
      ? { reviewVerdict: { verdict: 'CONTINUE', claim: 'The plan is fine.' }, evidence: [...PLAN_EVIDENCE, { type: 'TEST', status: 'PASSED', safeSummary: 'I ran the tests.' }] }
      : {};
    if (taskType === 'plan') return { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null, architecture: ARCHITECTURE, ...reach };
    if (taskType === 'guidance') return { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null, guidance: GUIDANCE };
    if (taskType === 'architecture') return { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null, architecture: ARCHITECTURE, consistency: ALIGNED };
    return { kind: 'succeed', evidence: PLAN_EVIDENCE, usdMicros: null };
  });
  const reviewer = byTask(REVIEWER_WORKER, async (_taskId, taskType) => {
    if (taskType === 'review:build') {
      return {
        kind: 'succeed', usdMicros: null,
        evidence: [{ type: 'REVIEW_FINDING', status: 'FAILED', safeSummary: FINDING_TEXT }],
        reviewVerdict: { verdict: 'REPAIR_REQUIRED', category: 'missed_acceptance_criterion', claim: FINDING_TEXT },
        ...(hostility.reviewer === true
          ? { implementation: { providerKind: 'reviewer', workspace: { captured: true, changes: [] } }, architecture: { ...ARCHITECTURE, components: [] } }
          : {}),
      };
    }
    if (taskType === 'review:repair:build') {
      // The re-review answers about the finding it was asked about, by the identity Julius gave it.
      const raised = await memory.findingsForRun(RUN, PROJECT);
      return {
        kind: 'succeed', usdMicros: null, evidence: PASSED_REVIEW,
        reviewVerdict: {
          verdict: 'CONTINUE', claim: 'The blank label is handled and tested.',
          resolutions: raised.map((finding) => ({ findingId: finding.findingId, status: 'RESOLVED', claim: 'The new test asserts the empty slug.' })),
        },
      };
    }
    return { kind: 'succeed', evidence: PASSED_REVIEW, usdMicros: null };
  });

  const runtime = assembleLiveJuliusRuntime({
    store: handoffs.store,
    entries: [
      { worker: ARCHITECT_WORKER, adapter: architect.adapter },
      { worker: CODER_WORKER, adapter: coder },
      { worker: REVIEWER_WORKER, adapter: reviewer.adapter },
    ],
    cardRevision: 'card-peers3', spendCeilingUsdMicros: CEILING, maxRepairRounds: 3,
  });
  const outcome = await driveJuliusRunToTerminal({
    loop: runtime.loop, store: handoffs.store, runId: RUN, projectId: PROJECT, verification: runtime.verification,
  });

  const timeline: JuliusTimelineEntry[] = [];
  let sinceSequence = 0;
  for (;;) {
    const page = await memory.timeline({ runId: RUN, projectId: PROJECT, sinceSequence, limit: 500 });
    timeline.push(...page.entries);
    if (page.entries.length === 0 || !page.hasMore) break;
    sinceSequence = Math.max(...page.entries.map((entry) => entry.sequence));
  }
  return { outcome, timeline, memory, provider, shell, architect, reviewer };
}

type Drive = Awaited<ReturnType<typeof driveMission>>;
const ofType = (drive: Drive, type: string) => drive.timeline.filter((entry) => entry.type === type);
const firstAt = (drive: Drive, match: (entry: JuliusTimelineEntry) => boolean): number => {
  const found = drive.timeline.find(match);
  return found === undefined ? -1 : found.sequence;
};

const GUIDANCE_TASK = 'guidance:build-1:1:task';
const CONTINUATION = 'segment:build-1:2:task';
/** The review judged the continuation that finished the work, so the repair is of that segment. */
const REPAIR = 'repair:segment:build-1:2:task:1:task';

/**
 * WHAT A MISSION MEANT, with every provider-specific number removed. Two
 * missions with the same trace made the same Julius decisions about the same
 * work for the same reasons, whoever the Coding Agent was.
 */
const VOLATILE = /usd|cost|micros|token|provider|invocation|model|runtime|ms$|At$|digest|hash|contextId|characters|toolCalls|turns|basis|allocated|settled|reservation|envelope|diagnostic/iu;
const SEMANTIC_TYPES = new Set([
  'task.claimed', 'verification.decided', 'repair.scheduled', 'finding.recorded', 'finding.transitioned',
  'checkpoint.recorded', 'checkpoint.verdict', 'guidance.issued', 'guidance.delivered', 'guidance.consumed',
  'peer.request.opened', 'peer.request.transitioned', 'review.verdict.applied',
  'architecture.recorded', 'architecture.unchanged', 'architecture.trigger.raised', 'architecture.assessed',
  'coder.scope.violated', 'coder.report.refused', 'worker.channel.refused', 'evidence.refused',
  'run.completed', 'run.failed',
]);
const semanticTrace = (drive: Drive): readonly string[] => drive.timeline
  .filter((entry) => SEMANTIC_TYPES.has(entry.type))
  .map((entry) => {
    const facts = Object.fromEntries(Object.entries(entry.facts).filter(([key]) => !VOLATILE.test(key)).sort(([a], [b]) => a.localeCompare(b)));
    return `${entry.type}|${String(entry.taskId)}|${JSON.stringify(facts).replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/gu, '<instant>')}`;
  });

/* ------------------------------------------------------------------ P29 */

describe('P29 — the three-peer lifecycle, end to end, under every Coding Agent', () => {
  it.each(PROVIDERS)('%s: architect designs, coder asks, architect answers, reviewer checks, coder resumes, repairs, the design is checked, Julius completes', async (name) => {
    const drive = await driveMission(name);
    expect(drive.outcome.state).toBe('COMPLETED');
    expect(drive.outcome.stalled).toBe(false);

    const at = {
      planAccepted: firstAt(drive, (entry) => entry.type === 'verification.decided' && entry.taskId === 'plan-1' && entry.facts.action === 'ACCEPT'),
      architectureRecorded: firstAt(drive, (entry) => entry.type === 'architecture.recorded' && entry.taskId === 'plan-1'),
      coderClaimed: firstAt(drive, (entry) => entry.type === 'task.claimed' && entry.taskId === 'build-1'),
      asked: firstAt(drive, (entry) => entry.type === 'checkpoint.recorded' && entry.taskId === 'build-1' && entry.facts.trigger === 'GUIDANCE_REQUESTED'),
      // PR #271: a coder's question about the design is a reason to consult the architect about the design itself.
      questionConsulted: firstAt(drive, (entry) => entry.type === 'architecture.assessed' && String(entry.taskId).includes('CODER_GUIDANCE_QUESTION')),
      architectAnswered: firstAt(drive, (entry) => entry.type === 'guidance.issued'),
      guidanceReviewed: firstAt(drive, (entry) => entry.type === 'task.claimed' && entry.taskId === `${GUIDANCE_TASK}:review`),
      guidanceAccepted: firstAt(drive, (entry) => entry.type === 'verification.decided' && entry.taskId === GUIDANCE_TASK && entry.facts.action === 'ACCEPT'),
      delivered: firstAt(drive, (entry) => entry.type === 'guidance.delivered'),
      resumed: firstAt(drive, (entry) => entry.type === 'task.claimed' && entry.taskId === CONTINUATION),
      consumed: firstAt(drive, (entry) => entry.type === 'guidance.consumed' && entry.taskId === CONTINUATION),
      challenged: firstAt(drive, (entry) => entry.type === 'review.verdict.applied' && entry.facts.verdict === 'REPAIR_REQUIRED'),
      repairClaimed: firstAt(drive, (entry) => entry.type === 'task.claimed' && entry.taskId === REPAIR),
      addressed: firstAt(drive, (entry) => entry.type === 'finding.transitioned' && entry.facts.move === 'REPAIR_SUCCEEDED'),
      resolved: firstAt(drive, (entry) => entry.type === 'finding.transitioned' && entry.facts.move === 'REVIEWER_RESOLVED'),
      designChecked: firstAt(drive, (entry) => entry.type === 'architecture.assessed' && String(entry.taskId).includes('PRE_COMPLETION_CHECK') && entry.facts.assessment === 'ALIGNED'),
      completed: firstAt(drive, (entry) => entry.type === 'run.completed'),
    };
    for (const [moment, sequence] of Object.entries(at)) expect(sequence, `${name}: ${moment} is on the record`).toBeGreaterThan(-1);
    const order = Object.entries(at).sort(([, a], [, b]) => a - b).map(([moment]) => moment);
    // Architecture recorded with the plan and accepted with it; the rest in causal order.
    expect(order.filter((moment) => moment !== 'architectureRecorded')).toEqual([
      'planAccepted', 'coderClaimed', 'asked', 'questionConsulted', 'architectAnswered', 'guidanceReviewed', 'guidanceAccepted', 'delivered',
      'resumed', 'consumed', 'challenged', 'repairClaimed', 'addressed', 'resolved', 'designChecked', 'completed',
    ]);
    expect(at.architectureRecorded).toBeLessThan(at.coderClaimed);

    // The coder was handed what Julius decided, and only that, at each dispatch.
    const byTaskId = new Map(drive.provider.requests.map((request) => [request.identity.taskId, request]));
    expect([...byTaskId.keys()]).toEqual(['build-1', CONTINUATION, REPAIR]);
    expect(byTaskId.get('build-1')!.sections.acceptedGuidance).toEqual([]);
    const textOf = (blocks: readonly { readonly text: string }[]) => blocks.map((item) => item.text).join('\n');
    expect(textOf(byTaskId.get(CONTINUATION)!.sections.acceptedGuidance)).toContain(GUIDANCE_OBJECTIVE);
    expect(textOf(byTaskId.get(REPAIR)!.sections.acceptedGuidance), 'carried into the repair').toContain(GUIDANCE_OBJECTIVE);
    expect(textOf(byTaskId.get(REPAIR)!.sections.findings), 'the repair was shown what it must answer').toContain(FINDING_TEXT);
    for (const request of drive.provider.requests) {
      expect(textOf(request.sections.architecture), 'every dispatch saw the design in force').toContain('slug()');
      expect(request.permissions.permittedPaths).toEqual(['src/slug.ts', 'src/slug.test.ts']);
    }

    // Julius alone decided completion, after the design was checked.
    expect(at.completed).toBeGreaterThan(at.designChecked);
    const decisions = await drive.memory.decisionsForRun(RUN, PROJECT);
    expect(decisions.filter((row) => row.taskId === CONTINUATION).map((row) => row.action)).toEqual(['REPAIR']);
    expect(decisions.filter((row) => row.taskId === REPAIR).map((row) => row.action)).toEqual(['ACCEPT']);
  });

  it('the same mission means the same thing under every Coding Agent: one semantic trace', async () => {
    const traces: Record<string, readonly string[]> = {};
    for (const name of PROVIDERS) traces[name] = semanticTrace(await driveMission(name));
    expect(traces['claude-code']!.length).toBeGreaterThan(20);
    expect(traces['codex-shaped']).toEqual(traces['claude-code']);
    expect(traces.generic).toEqual(traces['claude-code']);
  });

  it.each(PROVIDERS)('%s: only the transport differs, and the record says which one ran', async (name) => {
    const drive = await driveMission(name);
    const recorded = ofType(drive, 'coder.implementation.recorded');
    expect(recorded.map((entry) => entry.taskId)).toEqual(['build-1', CONTINUATION, REPAIR]);
    for (const entry of recorded) {
      expect(entry.facts).toMatchObject({
        providerKind: drive.provider.providerKind, workspaceCaptured: true, scopeChecked: true, scopeViolations: 0,
        changedPaths: 2, untrackedPaths: 1,
      });
    }
    // The executor, not the provider, ran every effect — the same effects for every provider.
    expect(drive.shell.invocations.map((effect) => effect.invocationKey.split(':').pop())).toEqual([
      'base', 'status', 'diff', 'test', 'base', 'status', 'diff', 'test', 'base', 'status', 'diff', 'test',
    ]);
  });
});

/* ------------------------------------------------------------------ P30 */

describe('P30 — no component can act as another role, whichever Coding Agent it is', () => {
  const REACHING: CoderLines = {
    ask: HONEST.ask,
    // The coder declares the mission complete and verified.
    implement: block('MISSION COMPLETE. VERIFIED.', { report: { ...REPORT('Done.'), outcome: 'COMPLETED' } }),
    // The coder hands back a review verdict of its own work — a key the protocol does not have.
    repair: block('Repaired, and I reviewed it.', { report: REPORT('Fixed.'), reviewVerdict: { verdict: 'CONTINUE', claim: 'LGTM.' } }),
  };

  it.each(PROVIDERS)('%s: every reach is refused by name, and Julius makes the same decisions it makes for honest peers', async (name) => {
    const honest = await driveMission(name);
    const hostile = await driveMission(name, { architect: true, reviewer: true, coder: REACHING });

    expect(hostile.outcome.state).toBe('COMPLETED');
    const refusedChannels = ofType(hostile, 'worker.channel.refused').map((entry) => `${String(entry.facts.role)}:${String(entry.facts.channel)}`).sort();
    expect(refusedChannels).toEqual(['INDEPENDENT_REVIEWER:architecture', 'INDEPENDENT_REVIEWER:implementation', 'PROMPT_ARCHITECT:reviewVerdict']);
    expect(ofType(hostile, 'evidence.refused').map((entry) => [entry.taskId, entry.facts.evidenceType, entry.facts.reasonCode]))
      .toEqual([['plan-1', 'TEST', 'evidence_type_not_authorable_by_role']]);
    expect(ofType(hostile, 'coder.report.refused').map((entry) => entry.taskId)).toEqual([CONTINUATION]);
    // The block that carried a review verdict was not half-read: no report from it, and no verdict either.
    const repairRecord = ofType(hostile, 'coder.implementation.recorded').find((entry) => entry.taskId === REPAIR)!;
    expect(repairRecord.facts.reportOutcome).toBeNull();
    expect(ofType(hostile, 'review.verdict.applied').every((entry) => String(entry.facts.reviewTaskId).endsWith(':review'))).toBe(true);

    // The design in force is the architect's; the reviewer's architecture never landed.
    const design = foldJuliusArchitecture(hostile.timeline.map((entry) => ({ type: entry.type, facts: entry.facts, taskId: entry.taskId })))!;
    expect(design.components.map((component) => component.name)).toEqual(['slug']);

    const decisionsOf = async (drive: Drive) => (await drive.memory.decisionsForRun(RUN, PROJECT)).map((row) => `${row.taskId}:${row.action}`);
    expect(await decisionsOf(hostile)).toEqual(await decisionsOf(honest));
  });

  it.each(PROVIDERS)('%s: every dispatch ran under its own role, and every fact a worker authored is one its role may author', async (name) => {
    const drive = await driveMission(name);
    const tasks = new Map((await drive.memory.tasksForRun(RUN, PROJECT)).map((row) => [row.taskId, row]));
    for (const entry of ofType(drive, 'worker.effort')) {
      expect(entry.facts.role, `${String(entry.taskId)} ran as its own role`).toBe(tasks.get(String(entry.taskId))!.role);
    }
    const coderTasks = [...tasks.values()].filter((row) => row.role === 'CODING_AGENT').map((row) => row.taskType).sort();
    expect(coderTasks, 'the coder ran only coding work').toEqual(['build', 'build', 'repair:build']);
    for (const evidence of await drive.memory.evidenceForRun(RUN, PROJECT)) {
      const role = tasks.get(evidence.taskId)!.role;
      expect(juliusEvidenceAuthority(role, evidence.type).ok, `${role} may author ${evidence.type}`).toBe(true);
    }
    for (const entry of ofType(drive, 'architecture.recorded').concat(ofType(drive, 'architecture.assessed'))) {
      expect(tasks.get(String(entry.taskId))!.role, `${entry.type} on ${String(entry.taskId)}`).toBe('PROMPT_ARCHITECT');
    }
    const issued = ofType(drive, 'guidance.issued');
    expect(issued).toHaveLength(1);
    expect(issued[0]!.workerId, 'the answer was the architect\'s, written about the task that asked').toBe(ARCHITECT_WORKER.workerId);
    for (const entry of ofType(drive, 'review.verdict.applied')) {
      expect(tasks.get(String(entry.facts.reviewTaskId))!.role).toBe('INDEPENDENT_REVIEWER');
    }
    // An honest mission refuses nothing: the refusals above are not noise the rig always makes.
    for (const type of ['worker.channel.refused', 'evidence.refused', 'coder.report.refused', 'coder.scope.violated']) {
      expect(ofType(drive, type), `${name}: ${type}`).toEqual([]);
    }
  });
});

/* ------------------------------------------------------------------ P31 */

describe('P31 — effort parity is observed, never enforced, and unknown stays unknown', () => {
  it.each(PROVIDERS)('%s: the slot report places all three peers, and a count the provider did not report is not zero', async (name) => {
    const drive = await driveMission(name);
    const report = buildJuliusSlotMissionReport({
      runId: RUN, policy: null, policyVersion: 'observational', ceilingUsdMicros: CEILING,
      rows: drive.timeline.map((entry) => ({ type: entry.type, taskId: entry.taskId, facts: entry.facts, sequence: entry.sequence })) as never,
    });
    expect(drive.outcome.state, 'a parity reading outside the band stops nothing').toBe('COMPLETED');
    expect(Object.keys(report.parity.ratioToCoder).sort()).toEqual(expect.arrayContaining(['INDEPENDENT_REVIEWER', 'PROMPT_ARCHITECT']));
    const coderEffort = ofType(drive, 'worker.effort').filter((entry) => entry.facts.role === 'CODING_AGENT');
    expect(coderEffort).toHaveLength(3);
    for (const entry of coderEffort) {
      expect(entry.facts.inputTokens).toBe(name === 'generic' ? 300 : 900);
      // Claude Code reports tool invocations; a Codex-shaped task API reports none, which is Unknown.
      expect(entry.facts.toolCalls).toBe(name === 'codex-shaped' ? null : name === 'claude-code' ? 6 : 4);
    }
  });
});

/* ------------------------------------------------------------------ P32 */

describe('P32 — a provider failure during a repair fabricates nothing, whichever Coding Agent reports it', () => {
  it.each(PROVIDERS)('%s: a rate limit on the repair is retried, the failed attempt leaves no evidence, and the mission ends as if it never happened', async (name) => {
    const honest = await driveMission(name);
    const drive = await driveMission(name, { repairFailures: ['RATE_LIMITED'] });

    expect(drive.outcome.state).toBe('COMPLETED');
    const retried = ofType(drive, 'retry.scheduled').filter((entry) => entry.taskId === REPAIR);
    expect(retried).toHaveLength(1);
    expect(retried[0]!.facts).toMatchObject({ code: 'RATE_LIMIT', errorRetryable: true, diag_codingAgentFailure: 'RATE_LIMITED' });
    // Two dispatches of the repair; evidence from one.
    expect(drive.provider.requests.filter((request) => request.identity.taskId === REPAIR)).toHaveLength(2);
    const repairEvidence = (await drive.memory.evidenceForRun(RUN, PROJECT)).filter((row) => row.taskId === REPAIR);
    expect(repairEvidence.map((row) => row.type).sort()).toEqual(['DIFF', 'TEST']);
    // Nothing was addressed on the strength of the failed attempt.
    const retriedAt = retried[0]!.sequence;
    const addressedAt = firstAt(drive, (entry) => entry.type === 'finding.transitioned' && entry.facts.move === 'REPAIR_SUCCEEDED');
    expect(addressedAt).toBeGreaterThan(retriedAt);
    const decisionsOf = async (run: Drive) => (await run.memory.decisionsForRun(RUN, PROJECT)).map((row) => `${row.taskId}:${row.action}`);
    expect(await decisionsOf(drive)).toEqual(await decisionsOf(honest));
  });

  it.each(PROVIDERS)('%s: credit exhaustion on the repair needs an operator — no success, no evidence, no review, no resolution, no completion', async (name) => {
    const drive = await driveMission(name, { repairFailures: ['CREDIT_UNAVAILABLE', 'CREDIT_UNAVAILABLE', 'CREDIT_UNAVAILABLE'] });

    expect(drive.outcome.state).not.toBe('COMPLETED');
    expect(drive.provider.requests.filter((request) => request.identity.taskId === REPAIR), 'never retried as if transient').toHaveLength(1);
    expect(ofType(drive, 'retry.scheduled').filter((entry) => entry.taskId === REPAIR)).toEqual([]);
    const failed = ofType(drive, 'task.failed').filter((entry) => entry.taskId === REPAIR);
    expect(failed).toHaveLength(1);
    expect(failed[0]!.facts).toMatchObject({ code: 'PROVIDER_UNAVAILABLE', errorRetryable: false, diag_codingAgentFailure: 'CREDIT_UNAVAILABLE', diag_operatorActionRequired: true });

    expect((await drive.memory.evidenceForRun(RUN, PROJECT)).filter((row) => row.taskId === REPAIR)).toEqual([]);
    expect(ofType(drive, 'coder.implementation.recorded').map((entry) => entry.taskId)).not.toContain(REPAIR);
    expect(ofType(drive, 'task.claimed').map((entry) => entry.taskId), 'nothing to review').not.toContain(`${REPAIR}:review`);
    expect(ofType(drive, 'finding.transitioned'), 'the finding was neither addressed nor resolved').toEqual([]);
    const decisions = await drive.memory.decisionsForRun(RUN, PROJECT);
    expect(decisions.some((row) => row.taskId === REPAIR && row.action === 'ACCEPT')).toBe(false);
    expect(ofType(drive, 'run.completed')).toEqual([]);
    expect((await drive.memory.tasksForRun(RUN, PROJECT)).find((row) => row.taskId === REPAIR)!.state).toBe('FAILED');
  });
});
