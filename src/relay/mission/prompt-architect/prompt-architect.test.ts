import { describe, expect, it } from 'vitest';
import {
  NO_ARCHITECT_CAPABILITIES, PROMPT_ARCHITECT_CAPABILITIES, UNKNOWN_ARCHITECT_USAGE,
  type PromptArchitectRecordDraft,
} from './prompt-architect-contracts';
import {
  classifyRecoveredArchitect, idleArchitectRecord, readArchitectRecord,
  sealArchitectRecord, verifyArchitectChecksum,
} from './prompt-architect-record';
import { planNeedsInput, validateArchitectPlan } from './prompt-architect-plan';
import { buildArchitectContext, redactContextText, renderContractInstruction } from './prompt-architect-context';
import {
  ARCHITECT_BRIDGE_REQUIRED_LABEL, ARCHITECT_SIMULATED_LABEL, architectNotification,
  projectPromptArchitect, renderArchitectStatusLines,
} from './prompt-architect-projection';
import { FAKE_ARCHITECT_PLAN } from '../../connectors/gpt-architect/fake-architect';

/** The canonical Prompt Architect: pure, provider-neutral, and unable to
    approve its own work. Zero provider calls. */

const NOW = '2026-08-01T12:00:00.000Z';
const idle = (o: Partial<PromptArchitectRecordDraft> = {}): PromptArchitectRecordDraft => ({
  ...idleArchitectRecord({ missionId: 'm1', projectId: 'p1', missionContractRef: 'contract:1', now: NOW }),
  ...o,
});
const planned = (o: Partial<PromptArchitectRecordDraft> = {}): PromptArchitectRecordDraft => {
  const base = idle();
  const validated = validateArchitectPlan(FAKE_ARCHITECT_PLAN);
  if (!validated.ok) throw new Error('fixture must validate');
  return {
    ...base,
    identity: { ...base.identity, actualRuntime: 'GPT (OpenAI)', requestedModel: 'configured-model',
      actualModel: 'returned-model', executionMode: 'live', runId: 'run-1',
      responseIdRedacted: '…abc123', launchVerified: true },
    capabilities: { ...NO_ARCHITECT_CAPABILITIES, supportsLiveExecution: true, supportsStructuredOutput: true },
    connectionState: 'completed', plan: validated.plan, startedAt: NOW, completedAt: NOW,
    usage: { inputTokens: 812, cachedInputTokens: 0, outputTokens: 431, reasoningTokens: 96,
      totalTokens: 1243, costKnown: false, source: 'provider_reported' },
    provenance: 'live', ...o,
  };
};

describe('the record', () => {
  it('starts idle and claims nothing', () => {
    const record = sealArchitectRecord(idle());
    expect(record.connectionState).toBe('not_connected');
    expect(record.identity.actualModel).toBeNull();
    expect(record.plan).toBeNull();
    expect(record.usage).toEqual(UNKNOWN_ARCHITECT_USAGE);
    expect(record.approvalState).toBe('not_requested');
  });

  it('keeps requested and actual model separate', () => {
    const record = sealArchitectRecord(planned());
    expect(record.identity.requestedModel).toBe('configured-model');
    expect(record.identity.actualModel).toBe('returned-model');
    const view = projectPromptArchitect(record);
    expect(view.requestedModelLabel).toBe('configured-model');
    expect(view.actualModelLabel).toBe('returned-model');
  });

  it('rejects tampering and a future schema', () => {
    const sealed = sealArchitectRecord(planned());
    expect(verifyArchitectChecksum(sealed)).toBe(true);
    const tampered = { ...sealed, approvalState: 'approved' as const };
    expect(verifyArchitectChecksum(tampered)).toBe(false);
    const future = { ...sealed, schemaVersion: 'relay-prompt-architect.v99' };
    const read = readArchitectRecord(future);
    if (read.ok || read.reason !== 'unsupported_version') throw new Error('must be unsupported');
  });

  it('cost is Unknown by contract — a record claiming otherwise is invalid', () => {
    const sealed = sealArchitectRecord(planned());
    expect(sealed.usage.costKnown).toBe(false);
    expect(projectPromptArchitect(sealed).costLabel).toBe('Unknown');
    const lying = { ...sealed, usage: { ...sealed.usage, costKnown: true as never } };
    expect(readArchitectRecord(lying).ok).toBe(false);
  });
});

describe('recovery', () => {
  it('an unconfirmed in-flight request becomes disconnected, never completed, never repeated', () => {
    const active = sealArchitectRecord(planned({ connectionState: 'planning', plan: null }));
    const after = classifyRecoveredArchitect({ record: active, requestConfirmed: false, now: NOW });
    expect(after.connectionState).toBe('disconnected');
    expect(after.failureClass).toBe('network_disconnected');
    expect(after.failureMessage).toContain('was not repeated');
    expect(after.failureMessage).toContain('new run id');
  });

  it('a completed plan survives a restart', () => {
    const done = sealArchitectRecord(planned());
    const after = classifyRecoveredArchitect({ record: done, requestConfirmed: false, now: NOW });
    expect(after.connectionState).toBe('completed');
    expect(after.plan).not.toBeNull();
  });
});

describe('plan validation is the gate', () => {
  it('accepts the fixture plan and forces decisions to stay unapproved', () => {
    const v = validateArchitectPlan(FAKE_ARCHITECT_PLAN);
    if (!v.ok) throw new Error('fixture must validate');
    expect(v.plan.architectureDecisions.every((d) => d.accepted === false)).toBe(true);
    expect(v.plan.assumptions[0].statement.length).toBeGreaterThan(0);
  });

  it('rejects a pre-accepted decision', () => {
    const hostile = {
      ...FAKE_ARCHITECT_PLAN,
      architectureDecisions: [{ id: 'D1', decision: 'x', rationale: 'y', alternativesConsidered: [], accepted: true }],
    };
    const v = validateArchitectPlan(hostile);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('must reject');
    expect(v.reason).toContain('pre-accepted');
  });

  it('rejects malformed, truncated and unbounded structures', () => {
    expect(validateArchitectPlan(null).ok).toBe(false);
    expect(validateArchitectPlan({}).ok).toBe(false);
    expect(validateArchitectPlan({ ...FAKE_ARCHITECT_PLAN, objectiveSummary: '' }).ok).toBe(false);
    const unbounded = { ...FAKE_ARCHITECT_PLAN, handoff: { ...FAKE_ARCHITECT_PLAN.handoff, allowedFileScope: [] } };
    const v = validateArchitectPlan(unbounded);
    expect(v.ok).toBe(false);
    if (v.ok) throw new Error('must reject');
    expect(v.reason).toContain('allowedFileScope');
  });

  it('rejects a plan claiming work already happened', () => {
    const lying = { ...FAKE_ARCHITECT_PLAN, objectiveSummary: 'Done — files were edited and tests were run.' };
    expect(validateArchitectPlan(lying).ok).toBe(false);
  });

  it('a blocking question means the plan needs input', () => {
    const v = validateArchitectPlan({
      ...FAKE_ARCHITECT_PLAN,
      unresolvedQuestions: [{ id: 'Q1', question: 'which?', blocksImplementation: true }],
    });
    if (!v.ok) throw new Error('must validate');
    expect(planNeedsInput(v.plan)).toBe(true);
    // …and the projection refuses to call the handoff ready.
    const record = sealArchitectRecord(planned({ plan: v.plan }));
    expect(projectPromptArchitect(record).handoffReady).toBe(false);
  });
});

describe('the context builder', () => {
  const block = (id: string, kind: 'mission_contract' | 'project_brain', text: string, required: boolean) =>
    ({ id, kind, text, required });

  it('deduplicates by id and by content', () => {
    const built = buildArchitectContext([
      block('c1', 'mission_contract', 'CONTRACT', true),
      block('c1', 'mission_contract', 'CONTRACT', true),
      block('b1', 'project_brain', 'SAME', false),
      block('b2', 'project_brain', 'SAME', false),
    ], { maxChars: 1000 });
    if (!built.ok) throw new Error('must build');
    expect(built.blocks).toHaveLength(2);
  });

  it('BLOCKS rather than truncating when required context does not fit', () => {
    const built = buildArchitectContext(
      [block('c1', 'mission_contract', 'x'.repeat(500), true)],
      { maxChars: 100 },
    );
    expect(built.ok).toBe(false);
    if (built.ok) throw new Error('must block');
    expect(built.reason).toBe('Prompt Architect blocked — relevant context exceeds the configured limit.');
  });

  it('drops optional blocks and reports them, keeping the contract intact', () => {
    const built = buildArchitectContext([
      block('c1', 'mission_contract', 'CONTRACT', true),
      block('b1', 'project_brain', 'y'.repeat(400), false),
    ], { maxChars: 100 });
    if (!built.ok) throw new Error('must build');
    expect(built.droppedOptional).toEqual(['b1']);
    expect(renderContractInstruction(built.blocks)).toBe('CONTRACT');
  });

  it('redacts secret-shaped keys and values', () => {
    const redacted = redactContextText([
      'OPENAI_API_KEY=sk-FAKETESTNOTREALFAKETESTNOTREAL',
      'note: token = sk-FAKETESTNOTREALabcdefgh',
      'harmless: a normal line',
    ].join('\n'));
    expect(redacted).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
    expect(redacted).toContain('[REDACTED]');
    expect(redacted).toContain('harmless');
  });
});

describe('the projection and notifications', () => {
  it('offline says Relay Bridge required and offers no Start', () => {
    const view = projectPromptArchitect(null, { bridgeAvailable: false });
    expect(view.connectionLabel).toBe('Relay Bridge required');
    expect(view.outcomeLabel).toBe(ARCHITECT_BRIDGE_REQUIRED_LABEL);
    expect(view.canStart).toBe(false);
    expect(view.actualModelLabel).toBe('Unknown');
  });

  it('a refusal is never a completion', () => {
    const view = projectPromptArchitect(sealArchitectRecord(planned({
      connectionState: 'refused', plan: null, failureMessage: 'The provider refused this request.',
    })));
    expect(view.connectionLabel).toBe('Refused');
    expect(view.planReady).toBe(false);
    expect(view.handoffReady).toBe(false);
    expect(view.blocking).toBe(true);
    expect(view.outcomeLabel).not.toContain('ready for review');
  });

  it('completed notification requires a validated plan', () => {
    const noPlan = sealArchitectRecord(planned({ connectionState: 'completed', plan: null }));
    expect(architectNotification(noPlan)).toBeNull();
    const withPlan = sealArchitectRecord(planned());
    expect(architectNotification(withPlan)?.title).toBe('Prompt Architect completed');
  });

  it('started requires verified launch; stopped requires confirmed cancellation', () => {
    const unverified = sealArchitectRecord(planned({
      connectionState: 'planning', plan: null,
      identity: { ...planned().identity, launchVerified: false },
    }));
    expect(architectNotification(unverified)).toBeNull();
    const pendingStop = sealArchitectRecord(planned({ connectionState: 'stopped', cancellationConfirmed: false }));
    expect(architectNotification(pendingStop)).toBeNull();
  });

  it('never advertises external research', () => {
    expect(NO_ARCHITECT_CAPABILITIES.supportsExternalResearch).toBe(false);
    const view = projectPromptArchitect(sealArchitectRecord(planned()));
    expect(view.capabilityLabels).not.toContain('External research');
    expect(PROMPT_ARCHITECT_CAPABILITIES).toHaveLength(7);
  });

  it('discloses a simulated run', () => {
    const view = projectPromptArchitect(sealArchitectRecord(planned({ provenance: 'simulated' })));
    expect(view.disclosure).toBe(ARCHITECT_SIMULATED_LABEL);
  });

  it('the CLI lines come from the same view', () => {
    const view = projectPromptArchitect(sealArchitectRecord(planned()));
    const out = renderArchitectStatusLines('m1', view).join('\n');
    expect(out).toContain(view.actualModelLabel);
    expect(out).toContain(view.connectionLabel);
    expect(out).toContain('Cost:         Unknown');
    expect(out).toContain('(proposed)');
  });
});

describe('boundary', () => {
  it('the pure module reaches no SDK, network, clock or process', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('.', import.meta.url).pathname;
    const combined = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !f.includes('.test.'))
      .map((f) => readFileSync(`${dir}/${f}`, 'utf8')).join('\n');
    expect(combined).not.toMatch(/from\s+['"]openai['"]/);
    expect(combined).not.toMatch(/from\s+['"]node:/);
    expect(combined).not.toMatch(/OPENAI_API_KEY/);
    expect(combined).not.toMatch(/\bfetch\s*\(|Date\.now\s*\(|new Date\(\)/);
  });
});
