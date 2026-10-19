import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fail, relayError, type RelayResult } from '../../protocol/errors';
import type { EventDraft } from '../../protocol/envelopes';
import type { IdFactory, ProjectId, RunId, TaskId, WorkspaceRefId } from '../../protocol/ids';
import type { AdapterDescriptor, ReviewRequest, ReviewResult, ReviewerAdapterPort } from '../ports';
import {
  DEFAULT_REVIEWER_LIMITS, type CodexReviewerCapabilityProfile, type CodexReviewerLimits,
  type RelayReviewReport,
} from './contracts';
import { buildCodexEnvironment } from './environment';
import { compileReviewerPermissions } from './permission-compiler';
import {
  compileReviewerPrompt, reviewReportJsonSchema, type ReviewerPromptContext,
} from './reviewer-prompt-compiler';
import { runCodexProcess, type CodexRunHandle, type CodexRunOutcome } from './process-runner';
import { reviewerStreamIsStructurallyValid } from './stream-parser';
import { normalizeCodexReview } from './event-normalizer';
import { parseReviewReport, type ExpectedReview } from './report-parser';
import { createReviewerSessionManager, type ReviewerSessionAssociation } from './session-manager';

/**
 * Codex Reviewer adapter (Prompt 8.3) — implements the provider-neutral
 * `ReviewerAdapterPort`. The sync `review()` REFUSES live execution (mirroring
 * the Claude adapter's sync refusal): a real Codex review runs only through the
 * explicit async live path with an isolated workspace and founder approval.
 * The adapter is READ-ONLY, never marks itself independent, never resolves
 * findings, never approves release — Relay Core owns all of that.
 */

export const CODEX_REVIEWER_ADAPTER_ID = 'codex-reviewer-local';

export const codexReviewerDescriptor: AdapterDescriptor = {
  adapterId: CODEX_REVIEWER_ADAPTER_ID,
  roles: ['reviewer'],
  displayName: 'Codex (local login) — independent reviewer',
  provenance: 'live',
  enforcement: {
    'read-only-sandbox': 'enforced',
    'workspace-inspection': 'enforced',
    'config-isolation': 'enforced',
    'network-disabled': 'enforced',
    'no-file-modification': 'enforced',
    'reviewer-independence': 'enforced',
  },
  simulatedPolicies: [],
};

export interface CodexReviewInvocationInput {
  executablePath: string;
  capabilities: CodexReviewerCapabilityProfile;
  association: ReviewerSessionAssociation;
  promptContext: ReviewerPromptContext;
  workspacePath: string;
  expected: ExpectedReview;
  attempt: 1 | 2;
  resumeSessionId?: string;
  model?: string | null;
  limits?: CodexReviewerLimits;
  baseEnv?: Record<string, string | undefined>;
  now: string;
}

export interface CodexReviewInvocationResult {
  outcome: CodexRunOutcome;
  events: EventDraft[];
  sessionId: string | null;
  structurallyValid: boolean;
  structuralReason?: string;
  report: RelayResult<RelayReviewReport>;
  args: string[];
  appliedIsolation: string[];
  unsupportedIsolation: string[];
  grantedEnvKeys: string[];
  strippedEnvKeys: string[];
}

export interface CodexReviewerAdapter extends ReviewerAdapterPort {
  readonly kind: 'codex-reviewer-local';
  invokeReview(
    input: CodexReviewInvocationInput,
    onHandle?: (handle: CodexRunHandle) => void,
  ): Promise<CodexReviewInvocationResult>;
  readonly sessions: ReturnType<typeof createReviewerSessionManager>;
}

export function createCodexReviewerAdapter(deps: { now: () => string; ids: IdFactory }): CodexReviewerAdapter {
  const sessions = createReviewerSessionManager(deps.now);

  async function invokeReview(
    input: CodexReviewInvocationInput,
    onHandle?: (handle: CodexRunHandle) => void,
  ): Promise<CodexReviewInvocationResult> {
    const limits = input.limits ?? DEFAULT_REVIEWER_LIMITS;
    const filtered = buildCodexEnvironment(input.baseEnv ?? process.env);

    // Per-invocation IO dir for the schema + output-last-message files. It is
    // NOT the workspace, so writing here never touches the review target.
    const ioDir = mkdtempSync(join(tmpdir(), 'relay-codex-io-'));
    const schemaPath = input.capabilities.outputSchemaSupported ? join(ioDir, 'review-schema.json') : null;
    const outputPath = join(ioDir, 'review-report.json');
    if (schemaPath) writeFileSync(schemaPath, JSON.stringify(reviewReportJsonSchema()), 'utf8');

    const permissions = compileReviewerPermissions({
      capabilities: input.capabilities,
      workspacePath: input.workspacePath,
      outputSchemaPath: schemaPath,
      outputLastMessagePath: outputPath,
      resumeSessionId: input.resumeSessionId,
      model: input.model ?? null,
    });

    const prompt = compileReviewerPrompt(input.promptContext);

    let outcome: CodexRunOutcome;
    try {
      outcome = await runCodexProcess(
        {
          executablePath: input.executablePath,
          args: permissions.args,
          prompt,
          cwd: input.workspacePath,
          env: filtered.env,
          outputLastMessagePath: outputPath,
          maxRuntimeMs: limits.maxRuntimeMs,
          maxStdoutBytes: limits.maxStdoutBytes,
          maxStderrBytes: limits.maxStderrBytes,
        },
        () => input.now,
        onHandle,
      );
    } finally {
      // Best-effort cleanup of the IO dir after the runner has read the file.
      try {
        rmSync(ioDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }

    const parsed = outcome.parsed;
    const structural = reviewerStreamIsStructurallyValid(parsed);
    const reportReceived = structural.ok && !outcome.cancelled && !outcome.timedOut && !outcome.spawnError;

    const report: RelayResult<RelayReviewReport> = reportReceived
      ? parseReviewReport(outcome.finalMessage, input.expected, limits)
      : fail(relayError('invalid-report', structural.reason ?? 'Reviewer did not complete a valid run.'));

    const events = normalizeCodexReview(
      {
        projectId: input.association.projectId, runId: input.association.runId, taskId: input.association.taskId,
        workspaceId: input.association.workspaceId, reviewId: input.association.reviewId,
        adapterId: CODEX_REVIEWER_ADAPTER_ID, attempt: input.attempt, now: input.now,
      },
      parsed,
      { cancelled: outcome.cancelled, timedOut: outcome.timedOut, spawnError: outcome.spawnError, reportReceived: report.ok },
    );

    return {
      outcome, events, sessionId: parsed.sessionId, structurallyValid: structural.ok,
      structuralReason: structural.reason, report, args: permissions.args,
      appliedIsolation: permissions.appliedIsolation, unsupportedIsolation: permissions.unsupportedIsolation,
      grantedEnvKeys: filtered.grantedKeys, strippedEnvKeys: filtered.strippedKeys,
    };
  }

  const adapter: CodexReviewerAdapter = {
    kind: 'codex-reviewer-local',
    descriptor: codexReviewerDescriptor,
    sessions,
    // The provider-neutral sync port refuses live execution — a real Codex
    // review runs only through the explicit async live path with approval.
    review(_request: ReviewRequest): RelayResult<ReviewResult> {
      return fail(relayError('illegal-transition',
        'Live Codex review is available only through the explicit async live path (relay codex run --confirm-live).'));
    },
    invokeReview,
  };
  return adapter;
}

export type { ReviewerSessionAssociation, ExpectedReview };
export type { ProjectId, RunId, TaskId, WorkspaceRefId };
