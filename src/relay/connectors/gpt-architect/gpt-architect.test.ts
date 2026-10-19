import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ARCHITECT_PLAN_SCHEMA, ARCHITECT_PLAN_SCHEMA_NAME } from './plan-schema';
import { evaluateReadiness, readGptArchitectConfig } from './config';
import { runFakeArchitect, FAKE_ARCHITECT_PLAN } from './fake-architect';
import { redactResponseId } from './gpt-runner';
import { boundHandoff, planNeedsInput, validateArchitectPlan } from '../../mission/prompt-architect';

/**
 * The GPT Prompt Architect connector: strict schema, server-only credential
 * handling, safe classification, and a deterministic fake that makes ZERO
 * provider calls. Nothing in this file contacts OpenAI.
 */

describe('server-side credential handling', () => {
  it('reports key PRESENCE only — the value never leaves the reader', () => {
    const config = readGptArchitectConfig({
      OPENAI_API_KEY: 'sk-FAKETESTNOTREALFAKETESTNOTREAL',
      OPENAI_PROMPT_ARCHITECT_MODEL: 'a-model',
      RELAY_PROMPT_ARCHITECT_MODE: 'live',
    });
    expect(config.apiKeyPresent).toBe(true);
    // The config object carries no key field at all.
    expect(JSON.stringify(config)).not.toContain('sk-');
    expect(Object.keys(config)).not.toContain('apiKey');
  });

  it('blocks truthfully when anything required is missing', () => {
    const none = evaluateReadiness(readGptArchitectConfig({}));
    expect(none.ready).toBe(false);
    expect(none.missing).toEqual([
      'OPENAI_API_KEY', 'OPENAI_PROMPT_ARCHITECT_MODEL', 'RELAY_PROMPT_ARCHITECT_MODE=live',
    ]);
    expect(none.blockedReason).toContain('OPENAI_API_KEY');

    // A key alone never enables live execution.
    const keyOnly = evaluateReadiness(readGptArchitectConfig({
      OPENAI_API_KEY: 'sk-FAKETESTNOTREALFAKETESTNOTREAL',
      OPENAI_PROMPT_ARCHITECT_MODEL: 'a-model',
    }));
    expect(keyOnly.ready).toBe(false);
    expect(keyOnly.missing).toEqual(['RELAY_PROMPT_ARCHITECT_MODE=live']);
  });

  it('defines NO VITE-prefixed OpenAI variable anywhere in the connector', () => {
    const dir = __dirname;
    const sources = readdirSync(dir)
      .filter((f) => /\.ts$/.test(f) && !f.includes('.test.'))
      .map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');
    // A VITE_ name would be inlined into the browser bundle by the bundler.
    expect(sources).not.toMatch(/VITE_[A-Z_]*OPENAI/);
    expect(sources).not.toMatch(/VITE_[A-Z_]*API_KEY/);
  });

  it('redacts a provider response id to its tail', () => {
    expect(redactResponseId('resp_abcdef123456')).toBe('…123456');
  });
});

describe('the strict output schema', () => {
  it('forbids extra properties and requires every field at the top level', () => {
    expect(ARCHITECT_PLAN_SCHEMA.additionalProperties).toBe(false);
    expect(ARCHITECT_PLAN_SCHEMA_NAME).toBe('relay_prompt_architect_plan');
    const required = ARCHITECT_PLAN_SCHEMA.required as string[];
    for (const key of ['objectiveSummary', 'requirements', 'architectureDecisions', 'handoff']) {
      expect(required).toContain(key);
    }
  });

  it('makes a self-approved decision structurally impossible', () => {
    const props = ARCHITECT_PLAN_SCHEMA.properties as Record<string, Record<string, unknown>>;
    const decision = (props.architectureDecisions.items as Record<string, Record<string, unknown>>);
    const accepted = (decision.properties as Record<string, Record<string, unknown>>).accepted;
    // The only legal value the model may emit is false.
    expect(accepted.enum).toEqual([false]);
  });

  it('declares no tools and no external research', () => {
    const serialized = JSON.stringify(ARCHITECT_PLAN_SCHEMA);
    expect(serialized).not.toContain('web_search');
    expect(serialized).not.toContain('file_search');
  });
});

describe('the deterministic fake makes zero provider calls', () => {
  it('returns a valid plan for the success scenario', () => {
    const outcome = runFakeArchitect('success');
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('success scenario must succeed');
    const validated = validateArchitectPlan(JSON.parse(outcome.outputText));
    expect(validated.ok).toBe(true);
    if (!validated.ok) throw new Error('the fake plan must validate');
    expect(validated.plan.requirements.length).toBeGreaterThan(0);
    expect(validated.plan.architectureDecisions[0].accepted).toBe(false);
  });

  it('covers refusal, malformed, incomplete, timeout and disconnection', () => {
    expect(runFakeArchitect('refused')).toMatchObject({ ok: false, failureClass: 'refused' });
    expect(runFakeArchitect('incomplete')).toMatchObject({ ok: false, failureClass: 'incomplete_response' });
    expect(runFakeArchitect('timeout')).toMatchObject({ ok: false, failureClass: 'timeout' });
    expect(runFakeArchitect('disconnected')).toMatchObject({ ok: false, failureClass: 'network_disconnected' });

    const malformed = runFakeArchitect('malformed');
    expect(malformed.ok).toBe(true);
    if (!malformed.ok) throw new Error('malformed scenario returns a transport success');
    // Transport succeeded, but the CONTENT is not a plan.
    expect(() => JSON.parse(malformed.outputText)).toThrow();
  });

  it('reports unknown usage as null rather than zero', () => {
    const outcome = runFakeArchitect('unknown_usage');
    if (!outcome.ok) throw new Error('scenario must succeed');
    expect(outcome.usage.inputTokens).toBeNull();
    expect(outcome.usage.totalTokens).toBeNull();
  });

  it('surfaces a blocking question as needing input', () => {
    const outcome = runFakeArchitect('success_needs_input');
    if (!outcome.ok) throw new Error('scenario must succeed');
    const validated = validateArchitectPlan(JSON.parse(outcome.outputText));
    if (!validated.ok) throw new Error('plan must validate');
    expect(planNeedsInput(validated.plan)).toBe(true);
  });

  it('imports no OpenAI SDK', () => {
    const source = readFileSync(join(__dirname, 'fake-architect.ts'), 'utf8');
    expect(source).not.toContain("from 'openai'");
  });
});

describe('the handoff can never widen permissions', () => {
  it('drops file scope and tools the Mission Contract does not allow', () => {
    const validated = validateArchitectPlan(FAKE_ARCHITECT_PLAN);
    if (!validated.ok) throw new Error('fixture plan must validate');
    const bounded = boundHandoff(validated.plan.handoff, {
      missionContractRef: 'contract:real',
      environmentRef: 'env:worktree',
      // The contract allows ONE of the two paths and neither extra tool.
      allowedFileScope: ['src/url.ts'],
      grantedTools: ['Read files'],
      prohibitedActions: ['Do not deploy.'],
    });
    expect(bounded.handoff.allowedFileScope).toEqual(['src/url.ts']);
    expect(bounded.rejectedFileScope).toEqual(['src/url.test.ts']);
    expect(bounded.handoff.grantedTools).toEqual(['Read files']);
    expect(bounded.rejectedTools).toEqual(['Edit assigned files']);
    // Prohibitions accumulate; identity comes from the contract.
    expect(bounded.handoff.prohibitedActions).toContain('Do not deploy.');
    expect(bounded.handoff.missionContractRef).toBe('contract:real');
    expect(bounded.handoff.environmentRef).toBe('env:worktree');
  });
});
