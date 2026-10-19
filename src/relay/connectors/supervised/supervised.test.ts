import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkSupervisedPrerequisites } from './live-runner';
import { runSupervisedContractVerification } from './verify-harness';

/**
 * Supervised workflow tests (Prompt 8.4). FAKE-EXECUTABLE tests only — no
 * provider call, no repository outside the throwaway fixtures. The full
 * orchestration proof lives in the contract harness (also runnable as
 * `npm run relay:supervised:contract-verify`); this file asserts the harness
 * passes, the combined prerequisites gate, and the permanent prohibitions at
 * the source level.
 */

describe('supervised contract verification (offline, fake executables)', () => {
  it('every contract check passes with no provider call', async () => {
    const { checks, failures } = await runSupervisedContractVerification();
    const failed = checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    expect(failed, failed.join('\n')).toEqual([]);
    expect(failures).toBe(0);
    expect(checks.length).toBeGreaterThanOrEqual(30);
  }, 120_000);
});

describe('combined live prerequisites', () => {
  const readyClaude = {
    capabilities: { executablePath: '/usr/bin/claude' } as never,
    authApproved: true, authLoggedIn: true, authSourceClass: 'subscription',
    settingsRisk: 'clean' as const, approvalGranted: true,
  };
  const readyCodex = {
    capabilities: {
      executablePath: '/usr/bin/codex', readOnlySandboxSupported: true,
      selectedRuntimeStrategy: 'exec_structured_review',
    } as never,
    authApproved: true, authStatus: 'ready', configRisk: 'clean' as const, approvalGranted: true,
  };

  it('both agents ready → ready', () => {
    expect(checkSupervisedPrerequisites({ claude: readyClaude, codex: readyCodex })).toEqual({ ready: true });
  });

  it('a Claude prerequisite failure surfaces first with a Manual-Task shape', () => {
    const result = checkSupervisedPrerequisites({
      claude: { ...readyClaude, authLoggedIn: false }, codex: readyCodex,
    });
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.agent).toBe('claude');
      expect(result.manualTitle).toBe('Sign in to Claude Code');
    }
  });

  it('a Codex prerequisite failure blocks the whole supervised run', () => {
    const result = checkSupervisedPrerequisites({
      claude: readyClaude, codex: { ...readyCodex, authApproved: false, authStatus: 'not_ready' },
    });
    expect(result.ready).toBe(false);
    if (!result.ready) {
      expect(result.agent).toBe('codex');
      expect(result.manualTitle).toBe('Sign in to Codex');
    }
  });

  it('missing --confirm-live is never inferred as approval', () => {
    const result = checkSupervisedPrerequisites({
      claude: { ...readyClaude, approvalGranted: false }, codex: readyCodex,
    });
    expect(result.ready).toBe(false);
    if (!result.ready) expect(result.manualTitle).toBe('Confirm the live run');
  });
});

describe('permanent prohibitions (source-level)', () => {
  const here = join(process.cwd(), 'src', 'relay', 'connectors', 'supervised');
  const read = (name: string): string => readFileSync(join(here, name), 'utf8');
  const productionSources = ['contracts.ts', 'live-runner.ts', 'index.ts'];

  it('the runner never seeds or mutates implementation content in the workspace', () => {
    for (const name of productionSources) {
      const content = read(name);
      expect(content.includes('DEFECT_IMPLEMENTATION'), `${name} references a seeded defect`).toBe(false);
      expect(/writeFileSync|appendFileSync/.test(content), `${name} writes files into the workspace`).toBe(false);
    }
  });

  it('no fault injection, planted defect, or forced verdict exists', () => {
    for (const name of productionSources) {
      const content = read(name);
      expect(content.includes('demo.fault_injected'), `${name} emits a fault-injection event`).toBe(false);
      expect(/inject[A-Z_]?[Ff]ault|plant[A-Z_]?[Dd]efect|forceVerdict|forced[A-Z_]?[Vv]erdict/.test(content),
        `${name} contains fault-injection/forced-verdict logic`).toBe(false);
    }
    // Verdicts are read from the parsed reviewer report — never synthesized.
    const runner = read('live-runner.ts');
    expect(runner).toContain('report.verdict');
    expect(runner).toContain('evaluateReviewerGate');
  });

  it('the runner spawns no process directly — it composes the approved adapters', () => {
    for (const name of productionSources) {
      expect(read(name).includes('child_process'), `${name} spawns processes directly`).toBe(false);
    }
  });

  it('the live path is explicit: the sync ports of both adapters still refuse live execution', () => {
    const runner = read('live-runner.ts');
    // The runner uses only the explicit async invoke paths.
    expect(runner).toContain('.invoke(');
    expect(runner).toContain('.invokeReview(');
    expect(runner.includes('.execute(')).toBe(false);
    expect(runner.includes('.review(')).toBe(false);
  });
});
