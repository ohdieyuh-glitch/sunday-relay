import type { JuliusContextSnapshot } from './julius-context-snapshot';
import { guardJuliusPeerResponse } from './julius-peer-channel';
import type { JuliusDispatchAllocation, JuliusErrorCode } from './julius-router';
import type { JuliusContractReviewCharge } from './julius-task-contract';

/**
 * THE CODING AGENT, AS A JULIUS ROLE RATHER THAN A PROVIDER.
 *
 * Julius dispatches coding work without knowing whether the implementation is
 * Claude Code, Codex, Devin, OpenCode, Cursor, Copilot's coding agent or
 * Windsurf. That is only true if two things are true:
 *
 *   1. WHAT A PROVIDER IS SHOWN is a governed request Julius built — the task,
 *      the locked terms, the guidance Julius accepted, the architecture it
 *      holds, the findings a repair must answer — in named sections, so a
 *      provider cannot read architecture context as a contract term or a
 *      rejected packet as an instruction. Nothing else of Julius's internals.
 *
 *   2. WHAT A PROVIDER CAN SAY BACK is a closed outcome: it completed and here
 *      is what it observed, or it failed and here is which kind of failure. A
 *      provider cannot return evidence, a status, a verdict or a completion
 *      through this port — there is no field to put one in. Evidence is minted
 *      by the Julius side of the adapter, from what the independent executor
 *      observed after the provider stopped.
 *
 * THE FAILURE TAXONOMY IS THE PART THAT DECIDES MONEY. A rate limit, an
 * overloaded provider and a dropped stream are transient and worth retrying;
 * exhausted provider credit and a rejected key need an operator and retrying
 * them buys nothing; a context overflow reaches the same wall every time. The
 * live coder used to report every one of those after launch as the same
 * non-retryable worker failure, so a single 429 ended a paid mission.
 *
 * Pure: types, classification and request assembly. No provider, no Node API.
 */

export const JULIUS_CODING_AGENT_CONTRACT_VERSION = 'julius-coding-agent.v1' as const;

/* ------------------------------------------------------------ failures */

export const JULIUS_CODING_AGENT_FAILURES = [
  /** The provider could not be reached or is overloaded. Transient. */
  'PROVIDER_UNAVAILABLE',
  /** Too many requests. Transient. */
  'RATE_LIMITED',
  /** The provider account cannot pay for the call. Needs an operator. */
  'CREDIT_UNAVAILABLE',
  /** The key or configuration was rejected. Needs an operator. */
  'AUTHENTICATION',
  /** The runtime could not start at all. Needs an operator. */
  'LAUNCH_FAILED',
  /** The provider's own time ran out. Transient. */
  'TIMEOUT',
  /** Julius or the operator cancelled the dispatch. */
  'CANCELLED',
  /** The session was cut mid-stream. Transient. */
  'INTERRUPTED',
  /** The provider's process exited underneath the session. Transient. */
  'PROCESS_EXIT',
  /** The provider answered, and the answer could not be read. */
  'MALFORMED_OUTPUT',
  /** The session ended without a result a reader can trust. */
  'PARTIAL_RESPONSE',
  /** A tool inside the session failed in a way the session could not recover. */
  'TOOL_CRASH',
  /** The packet does not fit. Retrying the same packet reaches the same wall. */
  'CONTEXT_OVERFLOW',
  /** A continuation needed state the provider no longer holds. */
  'CONTINUATION_UNAVAILABLE',
  /** The allocation Julius reserved for this dispatch was reached. */
  'COST_CEILING_REACHED',
  /** The runtime did not honour the envelope it was launched under. */
  'ENVELOPE_NOT_HONOURED',
  /** It failed and said nothing a classifier recognises. Unknown is not transient. */
  'UNCLASSIFIED',
] as const;
export type JuliusCodingAgentFailure = (typeof JULIUS_CODING_AGENT_FAILURES)[number];

export interface JuliusCodingAgentFailureDisposition {
  readonly code: JuliusErrorCode;
  /** Whether the same dispatch may be attempted again without anyone acting. */
  readonly retryable: boolean;
  /** Whether a person has to act before anything can change the answer. */
  readonly operatorAction: boolean;
}

const DISPOSITIONS: Readonly<Record<JuliusCodingAgentFailure, JuliusCodingAgentFailureDisposition>> = Object.freeze({
  PROVIDER_UNAVAILABLE: { code: 'PROVIDER_UNAVAILABLE', retryable: true, operatorAction: false },
  RATE_LIMITED: { code: 'RATE_LIMIT', retryable: true, operatorAction: false },
  // PROVIDER_UNAVAILABLE and NOT retryable: the provider is unavailable to this
  // account until someone pays. Not BUDGET_DENIED — that is Julius refusing to
  // reserve the MISSION's money, and conflating the two is how a paid run's
  // budget stop was once recorded as a provider error.
  CREDIT_UNAVAILABLE: { code: 'PROVIDER_UNAVAILABLE', retryable: false, operatorAction: true },
  AUTHENTICATION: { code: 'AUTH_CONFIGURATION', retryable: false, operatorAction: true },
  LAUNCH_FAILED: { code: 'AUTH_CONFIGURATION', retryable: false, operatorAction: true },
  TIMEOUT: { code: 'TIMEOUT', retryable: true, operatorAction: false },
  CANCELLED: { code: 'CANCELLED', retryable: false, operatorAction: false },
  INTERRUPTED: { code: 'PROVIDER_UNAVAILABLE', retryable: true, operatorAction: false },
  PROCESS_EXIT: { code: 'PROVIDER_UNAVAILABLE', retryable: true, operatorAction: false },
  MALFORMED_OUTPUT: { code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: false },
  PARTIAL_RESPONSE: { code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: false },
  TOOL_CRASH: { code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: false },
  CONTEXT_OVERFLOW: { code: 'INVALID_REQUEST', retryable: false, operatorAction: false },
  CONTINUATION_UNAVAILABLE: { code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: true },
  COST_CEILING_REACHED: { code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: false },
  ENVELOPE_NOT_HONOURED: { code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: false },
  UNCLASSIFIED: { code: 'WORKER_EXECUTION_FAILURE', retryable: false, operatorAction: false },
});

export const juliusCodingAgentFailureDisposition = (failure: JuliusCodingAgentFailure): JuliusCodingAgentFailureDisposition =>
  DISPOSITIONS[failure];

/** The failure as a machine token for the durable record. */
export const juliusCodingAgentFailureClass = (failure: JuliusCodingAgentFailure): string =>
  `coding_agent_${failure.toLowerCase()}`;

/* ------------------------------------------------------- the provider port */

/**
 * WHAT A PROVIDER OBSERVED ABOUT ITS OWN RUN. Telemetry, never authority:
 * every field is what the provider reported, and unknown is null, not zero.
 */
export interface JuliusCodingAgentObservation {
  readonly providerModel: string | null;
  readonly turns: number | null;
  /** Tool INVOCATIONS, not distinct tool names: ten edits and a read are eleven. */
  readonly toolInvocations: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly costUsdMicros: number | null;
  readonly costBasis: 'PROVIDER_REPORTED' | 'UNKNOWN';
  /**
   * Provider-specific structural facts for the record. Julius narrows them
   * through the diagnostics allowlist on the way to any durable row; a
   * provider cannot put an unlisted key or a free-text value there.
   */
  readonly diagnostics: Readonly<Record<string, unknown>>;
}

/**
 * THE WHOLE VOCABULARY A PROVIDER HAS.
 *
 * `completed` carries the provider's closing text, from which Julius reads the
 * participation block itself — the provider does not pre-parse its own request
 * into authority. `failed` carries the class, what it cost and whether the
 * runtime ever started, so a failure after a paid session is still charged and
 * a failure before launch frees its hold.
 */
export type JuliusCodingAgentProviderOutcome =
  | {
    readonly kind: 'completed';
    readonly finalText: string | null;
    readonly observation: JuliusCodingAgentObservation;
  }
  | {
    readonly kind: 'failed';
    readonly failure: JuliusCodingAgentFailure;
    /** Whether the provider runtime launched: the difference between spending nothing and an unknown amount. */
    readonly runtimeStarted: boolean;
    readonly costUsdMicros: number | null;
    /** A fixed sentence. Never provider prose — that can quote the request, which can quote a credential. */
    readonly safeMessage: string;
    /** The provider's own narrower machine token for the failure, when it has one. */
    readonly providerFailureClass: string | null;
    readonly diagnostics: Readonly<Record<string, unknown>>;
  };

/**
 * THE PORT. One method. A Claude Code session, a Codex task, a Devin session
 * and a scripted fixture all implement exactly this, and nothing in Julius can
 * tell them apart except by `providerKind` on the record.
 */
export interface JuliusCodingAgentProvider {
  readonly providerKind: string;
  execute(request: JuliusCodingAgentRequest, signal?: AbortSignal): Promise<JuliusCodingAgentProviderOutcome>;
}

/* ------------------------------------------------------------ the request */

/** One compiled brain block, with the entry it came from. */
export interface JuliusCodingAgentBlock {
  readonly entryId: string;
  readonly kind: string;
  readonly text: string;
}

/**
 * THE PACKET, SORTED BY WHAT KIND OF AUTHORITY EACH PART HAS.
 *
 * The live coder used to receive every brain block joined with no separator,
 * so the locked terms stood in their own section and the architecture Julius
 * holds, the guidance Julius accepted, the findings a repair must answer and
 * the rest of the mission ran together. A reader that cannot tell advice from
 * a term treats both the same.
 */
export interface JuliusCodingAgentSections {
  /** Guidance Julius ACCEPTED and delivered to this dispatch. Instruction, inside the contract. */
  readonly acceptedGuidance: readonly JuliusCodingAgentBlock[];
  /** The architecture revision(s) in force. Advisory context; the contract wins. */
  readonly architecture: readonly JuliusCodingAgentBlock[];
  /** Review findings this dispatch exists to answer. */
  readonly findings: readonly JuliusCodingAgentBlock[];
  /** Where a paused unit picks up, and what research returned. */
  readonly continuation: readonly JuliusCodingAgentBlock[];
  /** Everything else Julius compiled: objective, requirements, decisions. */
  readonly missionContext: readonly JuliusCodingAgentBlock[];
}

const ACCEPTED_GUIDANCE_PREFIX = 'brain:guidance-answer:';
const ARCHITECTURE_PREFIX = 'brain:architecture:r';
const CONTINUATION_PREFIXES: readonly string[] = ['brain:segment-resume:', 'brain:research-answer:', 'brain:research-served:'];

export function juliusCodingAgentSections(snapshot: JuliusContextSnapshot): JuliusCodingAgentSections {
  const acceptedGuidance: JuliusCodingAgentBlock[] = [];
  const architecture: JuliusCodingAgentBlock[] = [];
  const findings: JuliusCodingAgentBlock[] = [];
  const continuation: JuliusCodingAgentBlock[] = [];
  const missionContext: JuliusCodingAgentBlock[] = [];
  snapshot.packet.blocks.forEach((block, index) => {
    // The compiler pushes a block and its source id together, so position is identity.
    const entryId = snapshot.packet.sourceEntryIds[index] ?? '';
    const item = Object.freeze({ entryId, kind: block.kind, text: block.text });
    if (entryId.startsWith(ACCEPTED_GUIDANCE_PREFIX)) acceptedGuidance.push(item);
    else if (entryId.startsWith(ARCHITECTURE_PREFIX)) architecture.push(item);
    else if (block.kind === 'FINDING') findings.push(item);
    else if (CONTINUATION_PREFIXES.some((prefix) => entryId.startsWith(prefix))) continuation.push(item);
    else missionContext.push(item);
  });
  return Object.freeze({
    acceptedGuidance: Object.freeze(acceptedGuidance), architecture: Object.freeze(architecture),
    findings: Object.freeze(findings), continuation: Object.freeze(continuation), missionContext: Object.freeze(missionContext),
  });
}

/** The entry ids of accepted guidance a packet actually held. What a dispatch was given, by name. */
export const juliusAcceptedGuidanceEntryIds = (entryIds: readonly string[]): readonly string[] =>
  Object.freeze(entryIds.filter((entryId) => entryId.startsWith(ACCEPTED_GUIDANCE_PREFIX)));

/**
 * WHAT JULIUS PERMITS THIS DISPATCH TO DO.
 *
 * Stated, not granted by statement: a provider told it may edit files does not
 * thereby gain the right, and one that edits outside `permittedPaths` is caught
 * from what the executor observed after the session, whatever the provider
 * believed it was allowed.
 */
export interface JuliusCodingAgentPermissions {
  readonly mayEditFiles: true;
  /** Commands run through the independent executor, never inside the session. */
  readonly mayRunCommands: false;
  readonly mayUseNetwork: false;
  readonly permittedPaths: readonly string[];
  readonly outOfScope: readonly string[];
  readonly prohibitedActions: readonly string[];
}

export interface JuliusCodingAgentRequest {
  readonly version: typeof JULIUS_CODING_AGENT_CONTRACT_VERSION;
  readonly identity: {
    readonly runId: string;
    readonly missionId: string;
    readonly taskId: string;
    readonly taskType: string;
    readonly contextId: string;
  };
  /** The worktree the provider may touch. The executor enforces it; the request only names it. */
  readonly workspacePath: string;
  /** The locked terms, as Julius proved them at the gate. Null only for an unbound composition. */
  readonly contract: JuliusContractReviewCharge | null;
  readonly plan: string;
  readonly sections: JuliusCodingAgentSections;
  readonly permissions: JuliusCodingAgentPermissions;
  /** The evidence this task must end with. Julius captures it; the provider does not author it. */
  readonly requiredEvidence: readonly string[];
  readonly budget: { readonly usdMicros: number | null };
  /** How to ask Julius for something mid-task, and what the mission lets this slot read. */
  readonly protocol: { readonly participation: string; readonly researchAuthority: string };
}

export function buildJuliusCodingAgentRequest(input: {
  readonly snapshot: JuliusContextSnapshot;
  readonly taskId: string;
  readonly taskType: string;
  readonly contextId: string;
  readonly workspacePath: string;
  readonly plan: string;
  readonly contract: JuliusContractReviewCharge | undefined;
  readonly allocation: JuliusDispatchAllocation | undefined;
  readonly participationProtocol: string;
  readonly researchAuthority: string;
}): JuliusCodingAgentRequest {
  const contract = input.contract ?? null;
  return Object.freeze({
    version: JULIUS_CODING_AGENT_CONTRACT_VERSION,
    identity: Object.freeze({
      runId: input.snapshot.runId, missionId: input.snapshot.packet.missionId,
      taskId: input.taskId, taskType: input.taskType, contextId: input.contextId,
    }),
    workspacePath: input.workspacePath,
    contract,
    plan: input.plan,
    sections: juliusCodingAgentSections(input.snapshot),
    permissions: Object.freeze({
      mayEditFiles: true as const, mayRunCommands: false as const, mayUseNetwork: false as const,
      permittedPaths: Object.freeze([...(contract?.permittedPaths ?? [])]),
      outOfScope: Object.freeze([...(contract?.outOfScope ?? [])]),
      prohibitedActions: Object.freeze([...(contract?.prohibitedActions ?? [])]),
    }),
    requiredEvidence: Object.freeze([...(contract?.requiredEvidence ?? [])]),
    budget: Object.freeze({ usdMicros: input.allocation?.usdMicros ?? null }),
    protocol: Object.freeze({ participation: input.participationProtocol, researchAuthority: input.researchAuthority }),
  });
}

/* ---------------------------------------------------------- the rendering */

/**
 * THE ROLE, AS EVERY CODING PROVIDER IS TOLD IT. Governed text, not a provider's
 * system prompt: which sections bind, which advise, and what the role can never
 * say about its own work.
 */
export const JULIUS_CODING_AGENT_CHARTER = [
  'You are the Coding Agent for a Relay mission run by Julius, the mission controller.',
  'Implement exactly what the mission context and the architect plan below require, by editing files in this workspace only.',
  'Do not run commands; verification is executed separately by an independent executor.',
  'The TASK CONTRACT binds you. ACCEPTED GUIDANCE is instruction Julius accepted inside that contract. ARCHITECTURE CONTEXT is advisory: where it disagrees with the contract, the contract wins.',
  'You implement; you do not review or approve your own work, and completion is decided by Julius.',
].join(' ');

/**
 * THE LOCKED TERMS AS THE CODER READS THEM — the same document the independent
 * reviewer will grade against. Every line is a closed field of the contract: no
 * mission ids, no provider text, no prose of another worker's.
 */
export function renderJuliusCodingAgentContract(contract: JuliusContractReviewCharge): string {
  const list = (items: readonly string[], empty: string) => (items.length === 0 ? `    - ${empty}` : items.map((item) => `    - ${item}`).join('\n'));
  return [
    '--- TASK CONTRACT (locked; the reviewer grades against exactly this) ---',
    `  CONTRACT: ${contract.binding.contractId} revision ${String(contract.binding.contractRevision)}`,
    `  BINDING DIGEST: ${contract.binding.bindingDigest}`,
    `  ROUND: ${contract.stage}`,
    `  OBJECTIVE: ${contract.objective}`,
    `  RESPONSIBILITY BOUNDARY: ${contract.responsibilityBoundary}`,
    `  IN SCOPE:\n${list(contract.inScope, '(none stated)')}`,
    `  OUT OF SCOPE:\n${list(contract.outOfScope, '(none)')}`,
    `  PERMITTED PATHS:\n${list(contract.permittedPaths, '(none stated)')}`,
    `  PROHIBITED ACTIONS:\n${list(contract.prohibitedActions, '(none)')}`,
    `  BLOCKING ACCEPTANCE CRITERIA:\n${list(contract.blockingCriteria, '(none stated)')}`,
    `  REVIEW CRITERIA (what the independent reviewer will check):\n${list(contract.contractReviewCriteria, '(none stated)')}`,
    `  REQUIRED EVIDENCE: ${contract.requiredEvidence.join(', ') || '(none stated)'}`,
    `  REQUIRED CHECKS:\n${list(contract.requiredChecks, '(none stated)')}`,
    `  FAILURE CONDITIONS:\n${list(contract.failureConditions, '(none stated)')}`,
    `  STOPPING CONDITION: ${contract.stoppingCondition}`,
  ].join('\n');
}

const section = (heading: string, blocks: readonly JuliusCodingAgentBlock[]): string[] =>
  blocks.length === 0 ? [] : [heading, blocks.map((block) => block.text).join('\n\n')];

/**
 * THE REQUEST AS ONE PROMPT, for every provider that takes text.
 *
 * Canonical, so a Claude-Code-shaped session and a Codex-shaped one are handed
 * the same words in the same order and differ only in transport. The order is
 * deliberate: the plan the coder builds, then the terms the build is held to,
 * then the guidance Julius accepted inside those terms, then the architecture
 * context that informs but cannot override them, then the findings a repair
 * must answer, then where paused work resumes — and last, how to ask instead of
 * guessing, so it is the most recent thing read before the work starts.
 */
export function renderJuliusCodingAgentPrompt(request: JuliusCodingAgentRequest, charter: string): string {
  const { sections } = request;
  return [
    charter,
    '--- MISSION CONTEXT ---',
    sections.missionContext.map((block) => block.text).join(''),
    '--- ARCHITECT PLAN ---',
    request.plan,
    ...(request.contract === null ? [] : [renderJuliusCodingAgentContract(request.contract)]),
    ...section('--- ACCEPTED GUIDANCE (Julius accepted it after independent review; follow it inside the contract above) ---', sections.acceptedGuidance),
    ...section('--- ARCHITECTURE CONTEXT (advisory design state; where it disagrees with the contract, the contract wins) ---', sections.architecture),
    ...section('--- REVIEW FINDINGS THIS WORK MUST ANSWER ---', sections.findings),
    ...section('--- WHERE THIS WORK RESUMES ---', sections.continuation),
    request.protocol.participation,
    request.protocol.researchAuthority,
  ].join('\n\n');
}

/* ------------------------------------------------ what the workspace shows */

export const JULIUS_WORKSPACE_CHANGE_KINDS = ['MODIFIED', 'ADDED', 'DELETED', 'RENAMED', 'UNTRACKED', 'OTHER'] as const;
export type JuliusWorkspaceChangeKind = (typeof JULIUS_WORKSPACE_CHANGE_KINDS)[number];

export interface JuliusWorkspaceChange {
  readonly path: string;
  readonly change: JuliusWorkspaceChangeKind;
}

export const JULIUS_WORKSPACE_LIMITS = Object.freeze({
  /** Paths kept on the record. A change set larger than this is recorded as truncated, never silently cut. */
  paths: 400,
  pathChars: 512,
  /** Paths named in a ledger fact. The full set is counted; only this many are listed. */
  listedPaths: 20,
});

const SAFE_PATH = /^[^\u0000-\u001f\u007f]+$/u;

/**
 * THE CHANGE SET, FROM THE EXECUTOR'S OWN `git status --porcelain=v1 -z
 * --untracked-files=all`.
 *
 * NUL-separated, so a path with spaces or newlines is one path. A rename carries
 * its source as a second NUL field, which is consumed and not reported as a
 * change of its own. Untracked files are included — `git diff` alone never saw
 * them, so a coder whose whole contribution was new files used to look like a
 * coder who had done nothing.
 */
export function parseJuliusWorkspaceStatus(porcelain: string): { readonly changes: readonly JuliusWorkspaceChange[]; readonly truncated: boolean } {
  const fields = porcelain.split('\u0000');
  const changes: JuliusWorkspaceChange[] = [];
  let truncated = false;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!;
    if (field.length < 4) continue;
    const code = field.slice(0, 2);
    const path = field.slice(3);
    if (code[0] === 'R' || code[1] === 'R' || code[0] === 'C' || code[1] === 'C') index += 1;
    if (!SAFE_PATH.test(path) || path.length > JULIUS_WORKSPACE_LIMITS.pathChars) continue;
    const change: JuliusWorkspaceChangeKind = code === '??' ? 'UNTRACKED'
      : code.includes('R') ? 'RENAMED'
        : code.includes('A') ? 'ADDED'
          : code.includes('D') ? 'DELETED'
            : code.includes('M') ? 'MODIFIED'
              : 'OTHER';
    if (changes.some((existing) => existing.path === path)) continue;
    if (changes.length >= JULIUS_WORKSPACE_LIMITS.paths) { truncated = true; break; }
    changes.push(Object.freeze({ path, change }));
  }
  return Object.freeze({ changes: Object.freeze(changes), truncated });
}

/** One glob-ish contract path as a matcher: `**` crosses directories, `*` does not, a bare directory covers what is under it. */
const pathMatcher = (pattern: string): ((path: string) => boolean) => {
  const clean = pattern.trim().replace(/^\.\//u, '');
  if (clean === '' ) return () => false;
  if (!/[*?]/u.test(clean)) {
    const base = clean.replace(/\/+$/u, '');
    return (path) => path === base || path.startsWith(`${base}/`);
  }
  const source = clean
    .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\?/gu, '[^/]')
    .replace(/\u0000/gu, '.*');
  const expression = new RegExp(`^${source}$`, 'u');
  return (path) => expression.test(path);
};

export const JULIUS_SCOPE_RULES = ['OUTSIDE_PERMITTED_PATHS', 'OUT_OF_SCOPE'] as const;
export type JuliusScopeRule = (typeof JULIUS_SCOPE_RULES)[number];

export interface JuliusScopeViolation {
  readonly path: string;
  readonly rule: JuliusScopeRule;
}

/**
 * WHAT THE WORK TOUCHED THAT THE AGREEMENT DID NOT ALLOW.
 *
 * The locked contract's `permittedPaths` and out-of-scope paths used to exist
 * only as prompt text: stated to the coder, stated to the reviewer, and checked
 * by nothing. A provider told it may edit `src/slug.ts` and editing
 * `src/persistence/` instead was caught only if a reviewer happened to notice.
 *
 * An EMPTY permitted list constrains nothing — the mission did not state a
 * scope, and inventing one would refuse work nobody forbade. An out-of-scope
 * path is refused whatever the permitted list says. `prohibitedActions` are
 * prose and are not checked mechanically here: pretending a sentence is a rule
 * would be a check that passes by construction.
 */
export function juliusScopeViolations(input: {
  readonly changes: readonly JuliusWorkspaceChange[];
  readonly permittedPaths: readonly string[];
  readonly outOfScope: readonly string[];
}): readonly JuliusScopeViolation[] {
  const permitted = input.permittedPaths.filter((path) => path.trim() !== '').map(pathMatcher);
  const excluded = input.outOfScope.filter((path) => path.trim() !== '').map(pathMatcher);
  const violations: JuliusScopeViolation[] = [];
  for (const { path } of input.changes) {
    if (excluded.some((matches) => matches(path))) violations.push(Object.freeze({ path, rule: 'OUT_OF_SCOPE' }));
    else if (permitted.length > 0 && !permitted.some((matches) => matches(path))) {
      violations.push(Object.freeze({ path, rule: 'OUTSIDE_PERMITTED_PATHS' }));
    }
  }
  return Object.freeze(violations);
}

/* ------------------------------------------------- what the coder reports */

export const JULIUS_CODING_AGENT_REPORT_OUTCOMES = ['IMPLEMENTED', 'PARTIALLY_IMPLEMENTED', 'BLOCKED', 'NO_CHANGE_NEEDED'] as const;
export type JuliusCodingAgentReportOutcome = (typeof JULIUS_CODING_AGENT_REPORT_OUTCOMES)[number];

export const JULIUS_CODING_AGENT_REPORT_LIMITS = Object.freeze({
  summaryChars: 400,
  entryChars: 240,
  filesTouched: 50,
  testsRun: 20,
  uncertainty: 10,
});

/**
 * THE CODER'S ACCOUNT OF ITS OWN WORK — CLAIMS, NOT EVIDENCE.
 *
 * What files it believes it touched and which tests it believes it ran are
 * recorded as what it SAID, beside what the executor OBSERVED, and the two are
 * compared rather than one being trusted. What it is uncertain about and why it
 * is blocked are things only the coder knows, and they are worth the record.
 *
 * What it can never say is that the work is done in Julius's sense: the
 * authority guard refuses an outcome of COMPLETED or VERIFIED, and any field
 * naming a mission-owned term, before a single field is read.
 */
export interface JuliusCodingAgentReport {
  readonly outcome: JuliusCodingAgentReportOutcome;
  readonly summary: string;
  readonly filesTouched: readonly string[];
  readonly testsRun: readonly string[];
  readonly remainingUncertainty: readonly string[];
  readonly blockedReason: string | null;
}

export type JuliusCodingAgentReportReading =
  | { readonly ok: true; readonly report: JuliusCodingAgentReport }
  | { readonly ok: false; readonly reasonCode: string };

const reportLine = (value: unknown, limit: number): string | null => {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (cleaned.length === 0 || cleaned.length > limit) return null;
  if (/(?:api[_-]?key|authorization|bearer|token|secret|password)\s*[=:]/iu.test(cleaned)) return null;
  return cleaned;
};

const reportList = (value: unknown, limit: number): readonly string[] | null => {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > limit) return null;
  const out: string[] = [];
  for (const item of value) {
    const line = reportLine(item, JULIUS_CODING_AGENT_REPORT_LIMITS.entryChars);
    if (line === null) return null;
    if (!out.includes(line)) out.push(line);
  }
  return Object.freeze(out);
};

const REPORT_KEYS: readonly string[] = ['outcome', 'summary', 'filesTouched', 'testsRun', 'remainingUncertainty', 'blockedReason'];

export function sanitizeJuliusCodingAgentReport(value: unknown): JuliusCodingAgentReportReading {
  const guarded = guardJuliusPeerResponse(value);
  if (!guarded.ok) return { ok: false, reasonCode: guarded.reasonCode };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, reasonCode: 'coding_agent_report_shape_refused' };
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some((key) => !REPORT_KEYS.includes(key))) return { ok: false, reasonCode: 'coding_agent_report_unknown_field' };
  const word = typeof source.outcome === 'string' ? source.outcome.trim().toUpperCase() : '';
  if (!(JULIUS_CODING_AGENT_REPORT_OUTCOMES as readonly string[]).includes(word)) return { ok: false, reasonCode: 'coding_agent_report_outcome_unknown' };
  const outcome = word as JuliusCodingAgentReportOutcome;
  const summary = reportLine(source.summary, JULIUS_CODING_AGENT_REPORT_LIMITS.summaryChars);
  if (summary === null) return { ok: false, reasonCode: 'coding_agent_report_summary_invalid' };
  const filesTouched = reportList(source.filesTouched, JULIUS_CODING_AGENT_REPORT_LIMITS.filesTouched);
  const testsRun = reportList(source.testsRun, JULIUS_CODING_AGENT_REPORT_LIMITS.testsRun);
  const remainingUncertainty = reportList(source.remainingUncertainty, JULIUS_CODING_AGENT_REPORT_LIMITS.uncertainty);
  if (filesTouched === null || testsRun === null || remainingUncertainty === null) return { ok: false, reasonCode: 'coding_agent_report_list_invalid' };
  const blockedReason = source.blockedReason === undefined || source.blockedReason === null
    ? null : reportLine(source.blockedReason, JULIUS_CODING_AGENT_REPORT_LIMITS.entryChars);
  if (source.blockedReason !== undefined && source.blockedReason !== null && blockedReason === null) {
    return { ok: false, reasonCode: 'coding_agent_report_blocked_reason_invalid' };
  }
  // BLOCKED WITHOUT A REASON IS NOT A REPORT. And a reason on work that is not
  // blocked is two answers.
  if (outcome === 'BLOCKED' && blockedReason === null) return { ok: false, reasonCode: 'coding_agent_report_blocked_without_reason' };
  if (outcome !== 'BLOCKED' && blockedReason !== null) return { ok: false, reasonCode: 'coding_agent_report_reason_without_block' };
  return {
    ok: true,
    report: Object.freeze({ outcome, summary, filesTouched, testsRun, remainingUncertainty, blockedReason }),
  };
}

/* --------------------------------------------- the implementation record */

/**
 * WHAT THE JULIUS SIDE OF THE ADAPTER HANDS THE KERNEL ABOUT ONE DISPATCH.
 *
 * `workspace` is what the independent executor observed; `report` is what the
 * coder said, unsanitised. The kernel reads both, recomputes scope against the
 * locked contract itself, and never takes the adapter's word for a violation or
 * its absence.
 */
export interface JuliusCodingAgentImplementation {
  readonly providerKind: string;
  readonly workspace: {
    readonly captured: boolean;
    readonly changes: readonly JuliusWorkspaceChange[];
    readonly truncated: boolean;
  };
  readonly report: unknown;
}

const PROVIDER_KIND = /^[a-z0-9][a-z0-9._-]{0,63}$/u;

/** Rebuild the adapter's record from an allowlist. Null when it cannot be read at all. */
export function readJuliusCodingAgentImplementation(value: unknown): JuliusCodingAgentImplementation | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const providerKind = typeof source.providerKind === 'string' && PROVIDER_KIND.test(source.providerKind) ? source.providerKind : null;
  const workspace = source.workspace;
  if (providerKind === null || workspace === null || typeof workspace !== 'object' || Array.isArray(workspace)) return null;
  const ws = workspace as Record<string, unknown>;
  if (typeof ws.captured !== 'boolean' || !Array.isArray(ws.changes)) return null;
  const changes: JuliusWorkspaceChange[] = [];
  let truncated = ws.truncated === true;
  for (const item of ws.changes) {
    if (item === null || typeof item !== 'object') return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.path !== 'string' || !SAFE_PATH.test(entry.path) || entry.path.length > JULIUS_WORKSPACE_LIMITS.pathChars) return null;
    if (typeof entry.change !== 'string' || !(JULIUS_WORKSPACE_CHANGE_KINDS as readonly string[]).includes(entry.change)) return null;
    if (changes.length >= JULIUS_WORKSPACE_LIMITS.paths) { truncated = true; break; }
    changes.push(Object.freeze({ path: entry.path, change: entry.change as JuliusWorkspaceChangeKind }));
  }
  return Object.freeze({
    providerKind,
    workspace: Object.freeze({ captured: ws.captured, changes: Object.freeze(changes), truncated }),
    report: source.report,
  });
}
