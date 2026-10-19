import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { liveExecutionScope } from '../julius-live-mission';

/**
 * A PAID RUN NAMES ITS PEER REQUESTS UNDER ITS OWN WORKFLOW ATTEMPT.
 *
 * The live run id is derived from the mission contract — qualification attempts
 * 1-3 all ran as one run id — so the attempt has to come from somewhere else,
 * and the only authority for it on a GitHub-hosted runner is the runner's own
 * `GITHUB_RUN_ID` and `GITHUB_RUN_ATTEMPT`.
 */

describe('the execution scope of a live process', () => {
  it('is the workflow run and attempt on a runner', () => {
    expect(liveExecutionScope({ GITHUB_RUN_ID: '34995797200', GITHUB_RUN_ATTEMPT: '1' })).toBe('gh-34995797200.1');
    expect(liveExecutionScope({ GITHUB_RUN_ID: '34995797200', GITHUB_RUN_ATTEMPT: '2' })).toBe('gh-34995797200.2');
  });

  it('is local anywhere else, and never carries anything an environment could inject but digits', () => {
    expect(liveExecutionScope({})).toBe('local');
    expect(liveExecutionScope({ GITHUB_RUN_ID: '34995797200' })).toBe('local');
    expect(liveExecutionScope({ GITHUB_RUN_ID: '1:peer:review_request', GITHUB_RUN_ATTEMPT: '1' })).toBe('local');
    expect(liveExecutionScope({ GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: '1 ' })).toBe('local');
  });

  it('is handed to the runtime by the entrypoint, and printed before the first dispatch', () => {
    const entry = readFileSync(join(process.cwd(), 'relay-bridge/julius-live-mission.ts'), 'utf8');
    const open = entry.indexOf('assembleLiveJuliusRuntime({');
    const body = entry.slice(open, entry.indexOf('});', open));
    expect(body).toContain('executionScope: liveExecutionScope(env)');
    // Printed by `liveExecutionScopeLine` (P4), so the allowlist's test can generate the line it keeps.
    const printed = entry.indexOf('out(liveExecutionScopeLine(liveExecutionScope(env)))');
    expect(printed).toBeGreaterThan(-1);
    expect(printed, 'before the first dispatch').toBeLessThan(entry.indexOf('await driveJuliusRunToTerminal('));
    expect(readFileSync(join(process.cwd(), 'relay-bridge/julius/live-report-lines.ts'), 'utf8')).toContain('peer execution scope: ${scope}');
    const composition = readFileSync(join(process.cwd(), 'relay-bridge/julius/live-composition.ts'), 'utf8');
    expect(composition).toContain('{ executionScope: options.executionScope }');
  });
});
